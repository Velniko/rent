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
import { escapeHtml } from '../src/lib/html'
import { readAnnouncementForm, renderAnnouncementContent } from '../src/domain/announcement'
import { extractInlineScripts } from './helpers'

test('announcement validation retains long HTML and rejects excess content without slicing', () => {
  const message = '<h2>通知</h2><p>' + '内容'.repeat(12000) + '</p><p>结尾</p>'
  assert.equal(readAnnouncementForm({ title: '通知', message, titleEn: 'Notice', messageEn: '<p>English notice</p>' }).message, message)
  assert.throws(() => readAnnouncementForm({ title: '通知', message: 'x'.repeat(50001), titleEn: 'Notice', messageEn: 'English' }), /50000/)
  assert.throws(() => readAnnouncementForm({ title: '通知', message, titleEn: '', messageEn: '' }), /中文和英文/)
  const rendered = renderAnnouncementContent(message + '<script>alert(1)</script><a href="javascript:alert(1)" onclick="alert(1)">链接</a>')
  assert.match(rendered, /<h2>通知<\/h2>/)
  assert.match(rendered, /<p>结尾<\/p>/)
  assert.doesNotMatch(rendered, /script|onclick|javascript:/)
  assert.equal(renderAnnouncementContent('第一行\n第二行'), '第一行<br>第二行')
})

test('publishing, editing and reading a bilingual announcement preserve complete HTML for every recipient', async t => {
  const sqlite = new DatabaseSync(':memory:')
  t.after(() => sqlite.close())
  for (const file of readdirSync(new URL('../migrations/', import.meta.url)).filter(name => name.endsWith('.sql')).sort()) sqlite.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8'))
  sqlite.exec("INSERT INTO users (id, name, email, role) VALUES ('admin', '管理员', 'admin@example.test', 'ADMIN'), ('customer1', '客户一', 'one@example.test', 'CUSTOMER'), ('customer2', '客户二', 'two@example.test', 'CUSTOMER')")
  sqlite.exec("UPDATE users SET status = 'inactive' WHERE id NOT IN ('admin', 'customer1', 'customer2')")
  const db = { prepare(sql: string) {
    let values: any[] = []
    const statement = { bind(...input: any[]) { values = input; return statement }, async first() { return sqlite.prepare(sql).get(...values) || null }, async all() { return { results: sqlite.prepare(sql).all(...values) } }, async run() { return { success: true, meta: { changes: Number(sqlite.prepare(sql).run(...values).changes) } } } }
    return statement
  }, async batch(statements: any[]) { return Promise.all(statements.map(statement => statement.run())) } }
  const env = { RENT: db }, context = { env } as any
  const adminSession = await createAuthSession(context, 'admin'), customerSession = await createAuthSession(context, 'customer1')
  const request = (path: string, fields?: Record<string, string>, token = adminSession.token) => {
    const body = fields ? new FormData() : undefined
    for (const [key, value] of Object.entries(fields || {})) body!.set(key, value)
    return worker.fetch(new Request(`https://rent.example.test${path}`, { method: fields ? 'POST' : 'GET', ...(body ? { body } : {}), headers: { Cookie: `session=${token}`, Origin: 'https://rent.example.test', 'Sec-Fetch-Site': 'same-origin' } }), env, { waitUntil() {} } as any)
  }
  const original = { title: '店铺假期通知', message: '<h2>店铺休业</h2><p>' + '中文内容'.repeat(5500) + '</p><p>尾部_END</p>', titleEn: 'Holiday closure', messageEn: '<h2>Holiday closure</h2><p>' + 'English'.repeat(3500) + '</p><p>TAIL_END</p>' }
  const published = await request('/notifications/announcement', original)
  assert.equal(published.status, 302, await published.text())
  const rows = sqlite.prepare("SELECT * FROM notifications WHERE type = 'announcement'").all() as any[]
  assert.equal(rows.length, 2)
  for (const row of rows) { assert.equal(row.message, original.message); assert.equal(row.title_en, original.titleEn); assert.equal(row.message_en, original.messageEn) }
  const archive = await (await request('/admin/announcements')).text()
  assert.ok(archive.includes(escapeHtml(original.message)))
  assert.ok(archive.includes(escapeHtml(original.messageEn)))
  assert.match(archive, /name="messageEn"/)
  assert.match(archive, /class="form-control announcement-source"/)
  for (const script of extractInlineScripts(archive)) assert.doesNotThrow(() => new Function(script))
  const changed = { ...original, message: original.message + '<ul><li>更新_ZH</li></ul>', messageEn: original.messageEn + '<ul><li>UPDATED_EN</li></ul>' }
  assert.equal((await request(`/admin/announcements/${rows[0].id}`, changed)).status, 302)
  for (const row of sqlite.prepare("SELECT * FROM notifications WHERE type = 'announcement'").all() as any[]) { assert.equal(row.message, changed.message); assert.equal(row.message_en, changed.messageEn) }
  const payload = await (await request('/notifications/unread', undefined, customerSession.token)).json() as any
  assert.equal(payload.notifications[0].title_en, original.titleEn)
  assert.match(payload.notifications[0].message_html, /更新_ZH/)
  assert.match(payload.notifications[0].message_html_en, /UPDATED_EN/)
  const customerRow = rows.find(row => row.recipient_id === 'customer1')
  const detail = await (await request(`/notifications/${customerRow.id}`, undefined, customerSession.token)).text()
  assert.match(detail, /data-lang="en" data-i18n-ignore hidden/)
  assert.match(detail, /<ul><li>UPDATED_EN<\/li><\/ul>/)
  assert.equal((await request(`/admin/announcements/${rows[0].id}`, { ...changed, message: 'x'.repeat(50001) })).status, 400)
  assert.equal((sqlite.prepare('SELECT message FROM notifications WHERE id = ?').get(rows[0].id) as any).message, changed.message)
})
