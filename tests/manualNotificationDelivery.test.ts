/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

import test from 'node:test'
import assert from 'node:assert/strict'
import { extractInlineScripts } from './helpers'
import { DatabaseSync } from 'node:sqlite'
import { URL } from 'node:url'
import { readFileSync, readdirSync } from 'node:fs'
import worker from '../src/index'
import { createAuthSession, invalidateSystemSettingsCache } from '../src/site'
import { saveEmailConfig } from '../src/emailConfig'
import { createNotificationWithDelivery } from '../src/services/notifications'
import { setSmtpConnector } from './fixtures/cloudflareSockets'

async function fixture(t: any) {
  const sqlite = new DatabaseSync(':memory:')
  t.after(() => sqlite.close())
  for (const file of readdirSync(new URL('../migrations/', import.meta.url)).filter(name => name.endsWith('.sql')).sort()) sqlite.exec(readFileSync(new URL('../migrations/' + file, import.meta.url), 'utf8'))
  sqlite.exec(`INSERT INTO users (id,name,email,role,status,account_type,access_level,staff_id) VALUES
    ('admin','管理员','admin@example.test','ADMIN','active','formal','ADMIN',NULL),
    ('staff','员工','staff@example.test','STAFF','active','formal','STAFF',NULL),
    ('customer','客户甲','first@example.test','CUSTOMER','active','formal','CUSTOMER','staff'),
    ('other','客户乙','second@example.test','CUSTOMER','active','formal','CUSTOMER',NULL);
    INSERT INTO in_app_notification_templates (id,name,title,message) VALUES ('chosen','测试模板','模板主题','<p>模板正文</p>');
    INSERT OR REPLACE INTO email_templates (id,name,subject,body,format) VALUES ('site_notification','站内通知邮件','{title}','<h2>{title}</h2><p>{customer_name}</p>{message}','html');`)
  const db = { prepare(sql: string) { let args: any[] = []; const statement = {
    bind(...values: any[]) { args = values; return statement },
    async first() { return sqlite.prepare(sql).get(...args) || null },
    async all() { return { results: sqlite.prepare(sql).all(...args) } },
    async run() { return { success: true, meta: { changes: Number(sqlite.prepare(sql).run(...args).changes) } } },
  }; return statement }, async batch(statements: any[]) { const results = []; for (const statement of statements) results.push(await statement.run()); return results } }
  const env: any = { RENT: db, SETTINGS_ENCRYPTION_KEY: 'test-notification-settings-key' }
  const context: any = { env, req: { url: 'https://rent.example.test/notifications' } }
  const tokens = new Map<string, string>()
  for (const user of ['admin', 'staff', 'customer']) tokens.set(user, (await createAuthSession(context, user)).token)
  invalidateSystemSettingsCache()
  const request = (path: string, actor = 'admin', form?: URLSearchParams | Record<string, string>, origin = 'https://rent.example.test') => worker.fetch(new Request(('https://rent.example.test' + path).split('#')[0], {
    method: form ? 'POST' : 'GET', body: form instanceof URLSearchParams ? form : form ? new URLSearchParams(form) : undefined,
    headers: { Cookie: `session=${tokens.get(actor) || ''}`, Origin: origin, 'Sec-Fetch-Site': origin === 'https://rent.example.test' ? 'same-origin' : 'cross-site', 'CF-Connecting-IP': actor },
  }), env, { waitUntil() {} } as any)
  const configureSmtp = async () => {
    await saveEmailConfig(context, { host: 'smtp.example.test', port: 465, user: 'sender@example.test', password: 'test-only-password', from: 'sender@example.test', encryption: 'ssl' })
    sqlite.exec(`INSERT OR REPLACE INTO systemSettings (key,value) VALUES ('notificationChannels','{"emailProvider":"smtp"}')`)
  }
  const row = (sql: string, ...args: any[]) => sqlite.prepare(sql).get(...args) as any
  return { sqlite, env, context, request, configureSmtp, row }
}

function smtpServer(options: { rejectData?: boolean } = {}) {
  const messages: string[] = []
  let connections = 0
  setSmtpConnector(() => {
    connections++
    let reader: ReadableStreamDefaultController<Uint8Array>, end!: () => void, closed = false, data = false
    const reply = (value: string) => reader.enqueue(new TextEncoder().encode(value + '\r\n'))
    return {
      readable: new ReadableStream({ start(controller) { reader = controller; reply('220 Test SMTP') } }),
      writable: new WritableStream({ write(bytes) {
        const line = new TextDecoder().decode(bytes).replace(/\r\n$/, '')
        if (data) { messages.push(line); data = false; reply(options.rejectData ? '550 Message rejected by test server' : '250 Message accepted'); return }
        if (line.startsWith('EHLO ')) reply('250-test\r\n250 AUTH PLAIN')
        else if (line.startsWith('AUTH PLAIN ')) reply('235 Authenticated')
        else if (line.startsWith('MAIL FROM:') || line.startsWith('RCPT TO:')) reply('250 OK')
        else if (line === 'DATA') { data = true; reply('354 Send data') }
        else throw new Error('Unexpected SMTP command')
      } }),
      upgraded: false, secureTransport: 'on',
      opened: Promise.resolve({}), closed: new Promise<void>(resolve => { end = resolve }),
      async close() { if (!closed) { reader.close(); closed = true }; end() },
      startTls() { throw new Error('SSL test must not downgrade') },
    } as Socket
  })
  return { messages, connections: () => connections }
}

const send = { recipientId: 'customer', templateId: 'chosen', delivery: 'in_app_email' }

test('selected templates send through SMTP without an API key, to every selected recipient', async t => {
  const f = await fixture(t); await f.configureSmtp(); const smtp = smtpServer()
  const form = new URLSearchParams(send); form.append('recipientId', 'other')
  const response = await f.request('/notifications/send', 'admin', form)
  assert.equal(response.status, 303)
  assert.match(response.headers.get('location') || '', /sent=2&emailSent=2&emailFailed=0/)
  assert.equal(smtp.connections(), 2)
  assert.equal(f.row("SELECT COUNT(*) n FROM notifications WHERE type='manual'").n, 2)
  assert.equal(f.row("SELECT COUNT(*) n FROM email_events WHERE status='SENT' AND event_type='SITE_NOTIFICATION'").n, 2)
  const event = f.row("SELECT * FROM email_events WHERE recipient='first@example.test'")
  assert.equal(event.subject, '模板主题')
  assert.match(event.html_body, /模板正文/)
  assert.match(event.html_body, /客户甲/)
  assert.equal(event.retry_count, 1)
  assert.ok(event.provider_message_id)
  assert.ok(event.sent_at)
  const retry = await f.request('/notifications/send', 'admin', send)
  assert.equal(retry.status, 303)
  assert.equal(smtp.connections(), 3, 'a deliberate second send is not permanently deduplicated by message contents')
})

test('SMTP failures are recorded and surfaced; concurrent retry sends only once', async t => {
  const f = await fixture(t); await f.configureSmtp(); smtpServer({ rejectData: true })
  const response = await f.request('/notifications/send', 'admin', send)
  assert.match(response.headers.get('location') || '', /emailSent=0&emailFailed=1/)
  assert.equal(f.row("SELECT COUNT(*) n FROM notifications WHERE type='manual'").n, 1)
  const event = f.row("SELECT * FROM email_events WHERE event_type='SITE_NOTIFICATION'")
  assert.equal(event.status, 'FAILED'); assert.match(event.error_message, /550/)
  const smtp = smtpServer()
  const results = await Promise.all([f.request(`/manager/email-events/${event.id}/retry`, 'admin', {}), f.request(`/manager/email-events/${event.id}/retry`, 'admin', {})])
  assert.deepEqual(results.map(result => result.status).sort(), [303, 409])
  assert.equal(smtp.connections(), 1)
  assert.equal(f.row('SELECT * FROM email_events WHERE id=?', event.id).status, 'SENT')
  assert.equal(f.row('SELECT * FROM email_events WHERE id=?', event.id).retry_count, 2)
})

test('missing transport and disabled templates produce a visible failure rather than silent success', async t => {
  const f = await fixture(t)
  const response = await f.request('/notifications/send', 'admin', send)
  assert.match(response.headers.get('location') || '', /emailSent=0&emailFailed=1/)
  assert.match(f.row('SELECT * FROM email_events').error_message, /not configured/)
  await f.configureSmtp(); const smtp = smtpServer()
  f.sqlite.exec("UPDATE email_templates SET enabled=0 WHERE id='site_notification'")
  const disabled = await f.request('/notifications/send', 'admin', send)
  assert.match(disabled.headers.get('location') || '', /emailFailed=1/)
  assert.equal(smtp.connections(), 0)
  assert.equal(f.row("SELECT COUNT(*) n FROM email_events WHERE error_message='请先启用站内通知邮件模板'").n, 1)
  const page = await f.request(response.headers.get('location') || '')
  const html = await page.text()
  assert.match(html, /邮件失败：/); assert.match(html, /查看邮件发送记录/)
  const scripts = extractInlineScripts(html)
  assert.ok(scripts.length > 0)
  for (const script of scripts) assert.doesNotThrow(() => new Function(script))
})

test('explicit in-app-only delivery does not attempt email, even when SMTP is configured', async t => {
  const f = await fixture(t); await f.configureSmtp(); const smtp = smtpServer()
  const response = await f.request('/notifications/send', 'admin', { ...send, delivery: 'in_app_only' })
  assert.match(response.headers.get('location') || '', /sent=1&emailSent=0&emailFailed=0&delivery=in_app_only/)
  assert.equal(smtp.connections(), 0); assert.equal(f.row('SELECT COUNT(*) n FROM email_events').n, 0)
  assert.equal(f.row("SELECT COUNT(*) n FROM notifications WHERE type='manual'").n, 1)
})

test('email-only manual templates and custom messages stay out of inboxes and unread counts', async t => {
  const f = await fixture(t); await f.configureSmtp(); const smtp = smtpServer()
  const contents: Record<string, string>[] = [{ templateId: 'chosen' }, { templateId: 'custom', title: '仅邮件标题', message: '<p>仅邮件正文</p>' }]
  for (const content of contents) {
    const response = await f.request('/notifications/send', 'admin', { recipientId: 'customer', delivery: 'email_only', ...content })
    assert.equal(response.status, 303)
    assert.match(response.headers.get('location') || '', /sent=1&emailSent=1&emailFailed=0&delivery=email_only/)
    const resultPage = await (await f.request(response.headers.get('location') || '')).text()
    assert.match(resultPage, /邮件已提交：/)
    assert.doesNotMatch(resultPage, /站内通知已发送：/)
  }
  assert.equal(smtp.connections(), 2)
  assert.equal(f.row("SELECT COUNT(*) n FROM email_events WHERE status='SENT'").n, 2)
  assert.equal(f.row("SELECT COUNT(*) n FROM notifications WHERE recipient_id='customer' AND in_app=1").n, 0)
  assert.deepEqual((await (await f.request('/notifications/unread', 'customer')).json() as any).notifications, [])
  assert.deepEqual(await (await f.request('/notifications/recent', 'customer')).json(), { notifications: [], unreadCount: 0 })
  const record = f.row("SELECT id FROM notifications WHERE recipient_id='customer' LIMIT 1")
  assert.equal((await f.request('/notifications/' + record.id, 'customer')).status, 404)
})

test('email-only defaults persist, apply to automatic and manual delivery, and allow manual overrides', async t => {
  const f = await fixture(t); await f.configureSmtp(); const smtp = smtpServer()
  assert.equal((await f.request('/admin/notifications/settings', 'admin', { defaultDelivery: 'email_only' })).status, 302)
  assert.equal(JSON.parse(f.row("SELECT value FROM systemSettings WHERE key='notificationSettings'").value).defaultDelivery, 'email_only')
  const settings = await (await f.request('/admin/notifications/settings')).text()
  assert.match(settings, /value="email_only" checked/)
  const compose = await (await f.request('/notifications/compose')).text()
  assert.match(compose, /value="email_only" selected/)
  const manual = await f.request('/notifications/send', 'staff', { recipientId: 'customer', templateId: 'chosen' })
  assert.match(manual.headers.get('location') || '', /emailSent=1&emailFailed=0&delivery=email_only/)
  const automatic = { recipientId: 'customer', type: 'feedback_reward', title: '自动邮件', message: '自动邮件正文', dedupeKey: 'auto-email-only' }
  assert.equal((await createNotificationWithDelivery(f.context, automatic)).inserted, true)
  assert.equal((await createNotificationWithDelivery(f.context, automatic)).inserted, false)
  assert.equal(f.row("SELECT COUNT(*) n FROM notifications WHERE recipient_id='customer' AND in_app=1").n, 0)
  assert.equal(smtp.connections(), 2)
  await f.request('/notifications/send', 'admin', { ...send, delivery: 'in_app_only' })
  assert.equal(smtp.connections(), 2)
  assert.equal(f.row("SELECT COUNT(*) n FROM notifications WHERE recipient_id='customer' AND in_app=1").n, 1)
  await f.request('/notifications/send', 'admin', send)
  assert.equal(smtp.connections(), 3)
  assert.equal(f.row("SELECT COUNT(*) n FROM notifications WHERE recipient_id='customer' AND in_app=1").n, 2)
})

test('failed email-only messages can be retried without creating an inbox message', async t => {
  const f = await fixture(t); await f.configureSmtp(); smtpServer({ rejectData: true })
  const response = await f.request('/notifications/send', 'admin', { ...send, delivery: 'email_only' })
  assert.match(response.headers.get('location') || '', /emailSent=0&emailFailed=1/)
  const event = f.row('SELECT * FROM email_events')
  assert.equal(event.status, 'FAILED')
  const smtp = smtpServer()
  assert.equal((await f.request(`/manager/email-events/${event.id}/retry`, 'admin', {})).status, 303)
  assert.equal(smtp.connections(), 1)
  assert.equal(f.row('SELECT * FROM email_events').status, 'SENT')
  assert.equal(f.row('SELECT COUNT(*) n FROM notifications WHERE in_app=1').n, 0)
})

test('manual email results respect default delivery and notification deduplication', async t => {
  const f = await fixture(t); await f.configureSmtp(); const smtp = smtpServer()
  const input = { recipientId: 'customer', type: 'manual', title: '通知', message: '正文', notifyByEmail: true, dedupeKey: 'one-notification' }
  assert.equal((await createNotificationWithDelivery(f.context, input)).email?.ok, true)
  const duplicate = await createNotificationWithDelivery(f.context, input)
  assert.equal(duplicate.inserted, false); assert.equal(duplicate.email, null)
  assert.equal(smtp.connections(), 1)
  f.sqlite.exec(`INSERT OR REPLACE INTO systemSettings (key,value) VALUES ('notificationSettings','{"defaultDelivery":"in_app_only"}')`)
  invalidateSystemSettingsCache()
  const form: any = { recipientId: 'customer', templateId: 'chosen' }
  const response = await f.request('/notifications/send', 'admin', form)
  assert.match(response.headers.get('location') || '', /delivery=in_app_only/)
  assert.equal(smtp.connections(), 1)
})

test('sending and email history enforce roles, recipient ownership, and same-origin writes', async t => {
  const f = await fixture(t)
  assert.equal((await f.request('/notifications/send', 'customer', send)).status, 403)
  assert.equal((await f.request('/notifications/send', 'staff', { ...send, recipientId: 'other' })).status, 400)
  assert.equal((await f.request('/notifications/send', 'admin', send, 'https://evil.example.test')).status, 403)
  assert.equal((await f.request('/manager/email-events', 'customer')).status, 403)
  assert.equal(f.row('SELECT COUNT(*) n FROM email_events').n, 0)
})

test('all roles share the inbox while publishing lives on a separate protected page', async t => {
  const f = await fixture(t)
  for (const actor of ['admin', 'staff', 'customer']) {
    f.sqlite.prepare('INSERT INTO notifications (id,recipient_id,type,title,message) VALUES (?,?,?,?,?)').run(actor + '-notice', actor, 'manual', actor + '-private-title', '通知正文')
    const response = await f.request('/notifications', actor)
    assert.equal(response.status, 200)
    const html = await response.text()
    assert.match(html, /<h2>通知中心<\/h2>/)
    assert.ok(html.includes(actor + '-private-title'))
    for (const other of ['admin', 'staff', 'customer'].filter(other => other !== actor)) assert.ok(!html.includes(other + '-private-title'))
    assert.doesNotMatch(html, /action="\/notifications\/(?:send|announcement)"/)
  }
  const legacy = await f.request('/admin/notifications?page=2')
  assert.equal(legacy.status, 302)
  assert.equal(legacy.headers.get('location'), '/notifications?page=2')
  assert.equal((await f.request('/notifications/compose', 'customer')).status, 403)
  assert.equal((await f.request('/notifications/compose', 'guest')).headers.get('location'), '/login')
  assert.equal((await f.request('/notifications/compose?mode=announcement', 'staff')).status, 403)
  const staff = await (await f.request('/notifications/compose', 'staff')).text()
  assert.match(staff, /value="customer"/)
  assert.doesNotMatch(staff, /value="other"|action="\/notifications\/announcement"/)
  const manual = await (await f.request('/notifications/compose')).text()
  const announcement = await (await f.request('/notifications/compose?mode=announcement')).text()
  assert.match(manual, /<h2>发布通知<\/h2>/)
  assert.match(manual, /action="\/notifications\/send"/)
  assert.doesNotMatch(manual, /action="\/notifications\/announcement"/)
  assert.match(announcement, /action="\/notifications\/announcement"/)
  assert.doesNotMatch(announcement, /action="\/notifications\/send"/)
  for (const html of [manual, announcement, staff]) for (const script of extractInlineScripts(html)) assert.doesNotThrow(() => new Function(script))
})

test('manual send and announcement publishing return to the independent compose page', async t => {
  const f = await fixture(t)
  const sent = await f.request('/notifications/send', 'admin', { ...send, delivery: 'in_app_only' })
  assert.match(sent.headers.get('location') || '', /^\/notifications\/compose\?sent=1/)
  const published = await f.request('/notifications/announcement', 'admin', { title: '通告测试', message: '中文内容', titleEn: 'Test announcement', messageEn: 'English content' })
  assert.equal(published.status, 302)
  assert.equal(published.headers.get('location'), '/notifications/compose?mode=announcement&published=1')
  const result = await (await f.request(published.headers.get('location') || '')).text()
  assert.match(result, /通告已发布/)
})


test('selected template account variables are filled for each recipient without injecting HTML', async t => {
  const f = await fixture(t); await f.configureSmtp(); smtpServer()
  f.sqlite.exec("UPDATE users SET name='<img src=x onerror=alert(1)>甲' WHERE id='customer'; UPDATE in_app_notification_templates SET title='您好 {customer_name}', message='<p>收件人：{customer_name} · {customer_email}</p><p><strong>{update_date}</strong></p>' WHERE id='chosen'")
  const response = await f.request('/notifications/send', 'admin', send)
  assert.equal(response.status, 303)
  const event = f.row('SELECT * FROM email_events')
  assert.doesNotMatch(event.subject, /\{customer_name\}/)
  assert.match(event.html_body, /&lt;img/)
  assert.doesNotMatch(event.html_body, /<img src=x/)
  assert.match(event.html_body, /first@example.test/)
  assert.match(event.html_body, /<strong>\d{4}年\d{2}月\d{2}日<\/strong>/)
  assert.doesNotMatch(event.html_body, /\{update_date\}/)
})
