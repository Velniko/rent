/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync, readdirSync } from 'node:fs'
import { URL } from 'node:url'
import worker from '../src/index'
import { createAuthSession } from '../src/site'
import { readWebsiteAdvertisementForm } from '../src/domain/websiteAdvertisements'
import { extractInlineScripts } from './helpers'

const fields = { title: '假期促销', message: '<h2>广告正文</h2><p>促销内容</p>', titleEn: 'Holiday offer', messageEn: '<p>Holiday promotion</p>' }

test('website advertisements validate complete bilingual content and Melbourne expiry times', () => {
  assert.equal(readWebsiteAdvertisementForm(fields).expiresAt, null)
  assert.equal(readWebsiteAdvertisementForm({ ...fields, expiresAt: '2026-11-20T17:00' }).expiresAt, '2026-11-20 06:00:00')
  assert.equal(readWebsiteAdvertisementForm({ ...fields, expiresAt: '2026-06-20T17:00' }).expiresAt, '2026-06-20 07:00:00')
  for (const expiresAt of ['invalid', '2026-02-30T12:00', '2026-10-04T02:30']) assert.throws(() => readWebsiteAdvertisementForm({ ...fields, expiresAt }), /格式无效/)
  assert.throws(() => readWebsiteAdvertisementForm({ ...fields, messageEn: '' }), /中文和英文/)
  assert.throws(() => readWebsiteAdvertisementForm({ ...fields, message: 'x'.repeat(50001) }), /50000/)
})

test('administrators publish, edit and unpublish website ads without sending customer notifications', async t => {
  const sqlite = new DatabaseSync(':memory:')
  t.after(() => sqlite.close())
  for (const file of readdirSync(new URL('../migrations/', import.meta.url)).filter(name => name.endsWith('.sql')).sort()) sqlite.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8'))
  sqlite.exec("INSERT INTO users (id, name, email, role) VALUES ('ad-admin', '管理员', 'ad-admin@example.test', 'ADMIN'), ('ad-customer', '客户', 'ad-customer@example.test', 'CUSTOMER'), ('ad-staff', '员工', 'ad-staff@example.test', 'STAFF')")
  const db = { prepare(sql: string) {
    let values: any[] = []
    const statement = { bind(...input: any[]) { values = input; return statement }, async first() { return sqlite.prepare(sql).get(...values) || null }, async all() { return { results: sqlite.prepare(sql).all(...values) } }, async run() { return { success: true, meta: { changes: Number(sqlite.prepare(sql).run(...values).changes) } } } }
    return statement
  }, async batch(statements: any[]) { return Promise.all(statements.map(statement => statement.run())) } }
  const env = { RENT: db }, context = { env } as any
  const admin = await createAuthSession(context, 'ad-admin'), customer = await createAuthSession(context, 'ad-customer'), staff = await createAuthSession(context, 'ad-staff')
  const request = (path: string, values?: Record<string, string>, token = admin.token, origin = 'https://rent.example.test') => {
    const body = values ? new FormData() : undefined
    for (const [key, value] of Object.entries(values || {})) body!.set(key, value)
    return worker.fetch(new Request('https://rent.example.test' + path, { method: values ? 'POST' : 'GET', ...(body ? { body } : {}), headers: { Cookie: `session=${token}`, Origin: origin, 'Sec-Fetch-Site': origin === 'https://rent.example.test' ? 'same-origin' : 'cross-site' } }), env, { waitUntil() {} } as any)
  }
  const path = '/admin/website-advertisements'
  for (const token of [customer.token, staff.token]) {
    assert.equal((await request(path, undefined, token)).status, 403)
    assert.equal((await request(path, fields, token)).status, 403)
  }
  assert.equal((await request(path, fields, admin.token, 'https://evil.example')).status, 403)
  assert.equal((await request(path, { ...fields, titleEn: '' })).status, 400)
  const countBefore = sqlite.prepare('SELECT COUNT(*) AS count FROM notifications').get() as any
  const response = await request(path, { ...fields, expiresAt: '2026-11-20T17:00' })
  assert.equal(response.status, 303, await response.text())
  let row = sqlite.prepare('SELECT * FROM website_advertisements').get() as any
  assert.equal(row.message, fields.message)
  assert.equal(row.message_en, fields.messageEn)
  assert.equal(row.expires_at, '2026-11-20 06:00:00')
  assert.equal(row.active, 1)
  assert.deepEqual(sqlite.prepare('SELECT COUNT(*) AS count FROM notifications').get(), countBefore)
  const archive = await (await request(path)).text()
  assert.match(archive, /官网广告|Website advertisements/)
  assert.match(archive, /name="messageEn"/)
  assert.match(archive, /2026-11-20T17:00/)
  assert.match(archive, /&lt;h2&gt;广告正文&lt;\/h2&gt;/)
  for (const script of extractInlineScripts(archive)) assert.doesNotThrow(() => new Function(script))
  assert.equal((await request(path + '/' + row.id, { ...fields, message: '<p>更新后的广告</p>' })).status, 303)
  row = sqlite.prepare('SELECT * FROM website_advertisements').get() as any
  assert.equal(row.message, '<p>更新后的广告</p>')
  for (const token of [customer.token, staff.token]) {
    assert.equal((await request(path + '/' + row.id, fields, token)).status, 403)
    assert.equal((await request(path + '/' + row.id + '/toggle', { active: '0' }, token)).status, 403)
  }
  assert.equal((await request(path + '/' + row.id + '/toggle', { active: '0' })).status, 303)
  assert.equal((sqlite.prepare('SELECT active FROM website_advertisements').get() as any).active, 0)
  assert.equal((await request(path + '/' + row.id + '/toggle', { active: '1' })).status, 303)
  assert.equal((sqlite.prepare('SELECT active FROM website_advertisements').get() as any).active, 1)
  assert.equal((await request(path + '/' + row.id + '/toggle', { active: 'invalid' })).status, 400)
  assert.equal((await request(path + '/missing', fields)).status, 404)
  assert.equal((await request(path + '/missing/toggle', { active: '0' })).status, 404)
})
