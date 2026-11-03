/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

import test from 'node:test'
import assert from 'node:assert/strict'
import { runInNewContext } from 'node:vm'
import { TRANSLATION_CLIENT_SCRIPT } from '../src/lib/translationClient'

function browser() {
  const jobs = new Map<number, () => void>(), observers: Array<() => void> = [], events = new Map<string, () => void>()
  let sequence = 0, finish!: (response: Response) => void
  const calls: any[] = []
  const device: any = { children: [], textContent: '公开设备', closest: () => null }
  Object.defineProperty(device, 'innerHTML', { set() { throw new Error('Translations must be plain text') } })
  const privateText = { textContent: '客户私密资料' }
  const document: any = { documentElement: { lang: 'en' }, body: {}, readyState: 'complete',
    querySelectorAll(selector: string) { assert.equal(selector, '[data-api-translate]'); return [device] } }
  const window: any = { addEventListener(name: string, callback: () => void) { events.set(name, callback) } }
  runInNewContext(TRANSLATION_CLIENT_SCRIPT, { document, window, TextEncoder, console,
    fetch(url: string, init: any) { calls.push({ url, ...init }); return new Promise<Response>(resolve => { finish = resolve }) },
    setTimeout(callback: () => void) { const id = ++sequence; jobs.set(id, callback); return id },
    clearTimeout(id: number) { jobs.delete(id) },
    MutationObserver: class { constructor(callback: () => void) { observers.push(callback) } observe() {} },
  })
  async function flush() {
    for (let i = 0; i < 5; i++) {
      const pending = [...jobs.values()]; jobs.clear(); pending.forEach(job => job())
      await new Promise(resolve => setImmediate(resolve))
    }
  }
  return { calls, device, privateText, window, document, observers, events, flush, respond(text: string) { finish(Response.json({ ok: true, translations: [{ text }] })) } }
}

test('only explicitly marked public text is translated, restored on Chinese, and rendered as text', async () => {
  const b = browser()
  await b.flush()
  assert.equal(b.calls.length, 1)
  assert.deepEqual(JSON.parse(b.calls[0].body).texts, ['公开设备'])
  assert.equal(b.calls[0].url, '/api/translate')
  b.respond('<img src=x onerror=alert(1)>')
  await b.flush()
  assert.equal(b.device.textContent, '<img src=x onerror=alert(1)>')
  assert.equal(b.privateText.textContent, '客户私密资料')
  b.document.documentElement.lang = 'zh-CN'; b.observers[0]()
  await b.flush()
  assert.equal(b.device.textContent, '公开设备')
  b.document.documentElement.lang = 'en'; b.events.get('geekslope:language-change')!()
  await b.flush()
  assert.equal(b.calls.length, 1)
  assert.equal(b.device.textContent, '<img src=x onerror=alert(1)>')
})

test('a late API response cannot change a page that has switched back to Chinese', async () => {
  const b = browser()
  await b.flush()
  b.document.documentElement.lang = 'zh-CN'; b.events.get('site-language-change')!()
  await b.flush()
  b.respond('Public computer')
  await b.flush()
  assert.equal(b.device.textContent, '公开设备')
  b.document.documentElement.lang = 'en'; b.observers[0]()
  await b.flush()
  assert.equal(b.device.textContent, 'Public computer')
  assert.equal(b.calls.length, 1)
})

test('the public browser API coalesces identical in-flight calls', async () => {
  const b = browser()
  const first = b.window.SiteTranslation.translate(['公开设备'])
  const second = b.window.SiteTranslation.translate(['公开设备'])
  assert.equal(first, second)
  assert.equal(b.calls.length, 1)
  b.respond('Public computer')
  assert.deepEqual(Array.from(await first), ['Public computer'])
})
