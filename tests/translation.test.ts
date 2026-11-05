/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

import test from 'node:test'
import type { TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { extractInlineScripts } from './helpers'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { URL } from 'node:url'
import { Hono } from 'hono'
import { getTranslationConfig, getTranslationConfigSummary, saveTranslationConfig } from '../src/translationConfig'
import { translateTexts, handleTranslation, TranslationError, readTranslationJson } from '../src/services/translation'
import { TRANSLATION_CLIENT_SCRIPT } from '../src/lib/translationClient'
import { renderAdminApiSettings } from '../src/pages/admin/apiSettings'
import worker from '../src/index'

async function setup(t: TestContext, options: Record<string, unknown> = {}) {
  const sqlite = new DatabaseSync(':memory:')
  t.after(() => sqlite.close())
  sqlite.exec('CREATE TABLE systemSettings (key TEXT PRIMARY KEY, value TEXT, updatedAt TEXT, deleted_at TEXT)')
  sqlite.exec(readFileSync(new URL('../migrations/0178_add_translation_cache.sql', import.meta.url), 'utf8'))
  const db = { prepare(sql: string) {
    let values: any[] = []
    return { bind(...args: any[]) { values = args; return this },
      async first() { return sqlite.prepare(sql).get(...values) || null },
      async all() { return { results: sqlite.prepare(sql).all(...values) } },
      async run() { const result = sqlite.prepare(sql).run(...values); return { meta: { changes: Number(result.changes) } } } }
  }, async batch(statements: any[]) {
    sqlite.exec('BEGIN')
    try { const results = []; for (const statement of statements) results.push(await statement.run()); sqlite.exec('COMMIT'); return results }
    catch (error) { sqlite.exec('ROLLBACK'); throw error }
  } }
  const c: any = { env: { RENT: db, SETTINGS_ENCRYPTION_KEY: 'translation-test-master' } }
  await saveTranslationConfig(c, { enabled: true, provider: 'deepl', deeplApiKey: 'test-deepl-secret:fx', googleApiKey: 'test-google-secret', ...options })
  const calls: Array<{ url: string; headers: Headers; body: any }> = []
  t.mock.method(globalThis, 'fetch', async (url: any, init: any) => {
    const body = JSON.parse(init.body)
    calls.push({ url: String(url), headers: new Headers(init.headers), body })
    assert.ok(init.signal instanceof AbortSignal)
    return Response.json(body.text ? { translations: body.text.map((text: string) => ({ text: `English ${text}` })) }
      : { data: { translations: body.q.map(() => ({ translatedText: 'Tom &amp; Jerry &#39;PC&#39; &#x1F4BB;' })) } })
  })
  const input = (texts: string[], extra = {}) => ({ texts, sourceLang: 'zh', targetLang: 'en', ...extra })
  return { sqlite, c, calls, input }
}

test('translation keys are encrypted, masked, preserved when blank, and cleared individually', async t => {
  const { c, sqlite } = await setup(t)
  const stored = String(sqlite.prepare("SELECT value FROM systemSettings WHERE key='translationConfig'").get()!.value)
  assert.doesNotMatch(stored, /test-deepl-secret|test-google-secret/)
  assert.equal((await getTranslationConfig(c)).deeplApiKey, 'test-deepl-secret:fx')
  assert.doesNotMatch(JSON.stringify(await getTranslationConfigSummary(c)), /test-deepl-secret|test-google-secret/)
  await saveTranslationConfig(c, { deeplApiKey: '', provider: 'google', deeplPlan: 'pro', dailyByteLimit: 3000 })
  assert.equal((await getTranslationConfig(c)).deeplApiKey, 'test-deepl-secret:fx')
  await saveTranslationConfig(c, { clearDeepl: true })
  assert.equal((await getTranslationConfig(c)).deeplApiKey, '')
  assert.equal((await getTranslationConfig(c)).googleApiKey, 'test-google-secret')
  await assert.rejects(() => saveTranslationConfig(c, { dailyByteLimit: -1 }))
  await assert.rejects(() => saveTranslationConfig(c, { googleApiKey: 'key\nsecret' }))
  const wrongKey = { env: { ...c.env, SETTINGS_ENCRYPTION_KEY: 'different' } } as any
  assert.equal((await getTranslationConfig(wrongKey)).googleApiKey, '')
})

test('DeepL translates only distinct missing text and persists exact UTF-8 byte counts', async t => {
  const { c, sqlite, calls, input } = await setup(t)
  const first = await translateTexts(c, input(['你好', '电脑💻', '你好']))
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, 'https://api-free.deepl.com/v2/translate')
  assert.equal(calls[0].headers.get('Authorization'), 'DeepL-Auth-Key test-deepl-secret:fx')
  assert.deepEqual(calls[0].body, { text: ['你好', '电脑💻'], source_lang: 'ZH', target_lang: 'EN-GB' })
  assert.equal(first.translations[0].sourceBytes, 6)
  assert.equal(first.translations[1].sourceBytes, 10)
  assert.equal(first.translations[0].translatedBytes, new TextEncoder().encode('English 你好').length)
  assert.ok(first.translations.every(row => !row.cached))
  const second = await translateTexts(c, input(['你好', '电脑💻']))
  assert.ok(second.translations.every(row => row.cached))
  assert.equal(calls.length, 1)
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM translation_cache').get()!.n, 2)
  assert.equal(sqlite.prepare('SELECT source_bytes FROM translation_daily_usage').get()!.source_bytes, 16)
  await translateTexts(c, input(['你好', '新增内容']))
  assert.deepEqual(calls[1].body.text, ['新增内容'])
})

test('Google uses its own cache, authenticates in a header and decodes escaped text safely', async t => {
  const { c, calls, input } = await setup(t, { provider: 'google' })
  const result = await translateTexts(c, input(['电脑']))
  assert.equal(calls[0].url, 'https://translation.googleapis.com/language/translate/v2')
  assert.equal(calls[0].headers.get('X-Goog-Api-Key'), 'test-google-secret')
  assert.deepEqual(calls[0].body, { q: ['电脑'], source: 'zh', target: 'en', format: 'text' })
  assert.equal(result.translations[0].text, "Tom & Jerry 'PC' 💻")
  await translateTexts(c, input(['电脑']), 'deepl')
  assert.equal(calls.length, 2)
  await translateTexts(c, input(['电脑']))
  assert.equal(calls.length, 2)
})

test('cache keys distinguish exact source text and language pairs; auto detection omits source', async t => {
  const { c, calls, input } = await setup(t, { deeplPlan: 'pro' })
  await translateTexts(c, input(['电脑']))
  await translateTexts(c, input(['电脑 ']))
  await translateTexts(c, input(['电脑'], { targetLang: 'ja' }))
  await translateTexts(c, input(['电脑'], { sourceLang: 'auto' }))
  assert.equal(calls.length, 4)
  assert.equal(calls[0].url, 'https://api.deepl.com/v2/translate')
  assert.equal(calls[3].body.source_lang, undefined)
})

test('existing translations remain usable with API disabled or the daily budget exhausted', async t => {
  const { c, calls, input } = await setup(t, { dailyByteLimit: 6 })
  await translateTexts(c, input(['你好']))
  await assert.rejects(() => translateTexts(c, input(['新增'])), (error: any) => error.status === 429)
  assert.equal(calls.length, 1)
  await saveTranslationConfig(c, { enabled: false, dailyByteLimit: 0, clearDeepl: true })
  const cached = await translateTexts(c, input(['你好']))
  assert.equal(cached.translations[0].cached, true)
  await assert.rejects(() => translateTexts(c, input(['未翻译'])), (error: any) => error.status === 503)
  assert.equal(calls.length, 1)
})

test('concurrent workers cannot pay to translate the same missing phrase twice', async t => {
  const { c, calls, input } = await setup(t)
  let finish!: () => void, started!: () => void
  const gate = new Promise<void>(resolve => { finish = resolve })
  const beginning = new Promise<void>(resolve => { started = resolve })
  t.mock.method(globalThis, 'fetch', async () => { started(); await gate; calls.push({} as any); return Response.json({ translations: [{ text: 'Computer' }] }) })
  const first = translateTexts(c, input(['电脑']))
  await beginning
  await assert.rejects(() => translateTexts(c, input(['电脑'])), (error: any) => error.status === 409)
  finish()
  await first
  assert.equal((await translateTexts(c, input(['电脑']))).translations[0].cached, true)
  assert.equal(calls.length, 1)
})

test('provider failures never enter the cache, expose secrets or leave an unrecoverable lock', async t => {
  const { c, sqlite, input } = await setup(t)
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('secret upstream key') })
  await assert.rejects(() => translateTexts(c, input(['电脑'])), (error: any) => error.status === 502 && !error.message.includes('secret'))
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM translation_cache').get()!.n, 0)
  t.mock.method(globalThis, 'fetch', async () => Response.json({ translations: [] }))
  await assert.rejects(() => translateTexts(c, input(['电脑'])), (error: any) => error.status === 502)
  t.mock.method(globalThis, 'fetch', async () => Response.json({ translations: [{ text: 'Computer' }] }))
  assert.equal((await translateTexts(c, input(['电脑']))).translations[0].text, 'Computer')
})

test('translation API validates batches, providers, languages and streamed body byte limits', async t => {
  const { c, calls, input } = await setup(t)
  for (const body of [null, {}, { texts: [] }, input(['']), input(Array(21).fill('电脑')), input(['你'.repeat(1366)]), input(['x'], { provider: 'https://evil.test' }), input(['x'], { targetLang: 'auto' }), input(['x'], { targetLang: 'unknown' })]) {
    await assert.rejects(() => translateTexts(c, body), TranslationError)
  }
  const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(9000)); controller.enqueue(new Uint8Array(9000)); controller.close() } })
  await assert.rejects(() => readTranslationJson(stream), (error: any) => error.status === 413)
  assert.equal(calls.length, 0)
  const app = new Hono<{ Bindings: Record<string, unknown> }>()
  app.post('/api/translate/:provider', context => { Object.assign(context.env, c.env); return handleTranslation(context) })
  const request = (provider: string, body: string) => app.request('/api/translate/' + provider, { method: 'POST', body, headers: { 'Content-Type': 'application/json' } }, {})
  assert.equal((await request('deepl', '{')).status, 400)
  const response = await request('google', JSON.stringify(input(['电脑'])))
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('Cache-Control'), 'no-store')
  assert.equal((await response.json() as any).provider, 'google')
})

test('API settings expose both providers and valid scripts without exposing credentials', async t => {
  const { c } = await setup(t)
  const summary = await getTranslationConfigSummary(c)
  const html = renderAdminApiSettings({ role: 'ADMIN' }, {}, {}, {}, {}, {}, {}, {}, summary)
  assert.match(html, /deeplApiKey/)
  assert.match(html, /googleTranslationApiKey/)
  assert.doesNotMatch(html, /test-deepl-secret|test-google-secret/)
  const scripts = extractInlineScripts(html)
  assert.ok(scripts.length > 0)
  for (const script of scripts) assert.doesNotThrow(() => new Function(script))
  assert.doesNotThrow(() => new Function(TRANSLATION_CLIENT_SCRIPT))
})


test('translation endpoints enforce rate limits for encoded provider paths and reject cross-site calls', async t => {
  const { c, sqlite } = await setup(t)
  sqlite.exec('CREATE TABLE security_rate_limits (scope TEXT, client_key TEXT, bucket INTEGER, request_count INTEGER, PRIMARY KEY(scope, client_key, bucket))')
  const send = (origin = 'https://rent.example.test', body = '{}') => worker.fetch(new Request('https://rent.example.test/api/translate/%64eepl', {
    method: 'POST', headers: { Origin: origin, 'CF-Connecting-IP': '203.0.113.12', 'Content-Type': 'application/json' }, body,
  }), c.env, { waitUntil() {} } as any)
  assert.equal((await send('https://other.example.test')).status, 403)
  assert.equal((await send('https://rent.example.test', JSON.stringify({ texts: ['电脑'], sourceLang: 'zh', targetLang: 'en' }))).status, 200)
  for (let i = 0; i < 19; i++) assert.equal((await send()).status, 400)
  assert.equal((await send()).status, 429)
  const asset = await worker.fetch(new Request('https://rent.example.test/translation.js'), c.env, { waitUntil() {} } as any)
  assert.equal(asset.status, 200)
  assert.equal(await asset.text(), TRANSLATION_CLIENT_SCRIPT)
})
