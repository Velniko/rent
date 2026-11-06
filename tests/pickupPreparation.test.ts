/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { URL } from 'node:url'
import { readFileSync, readdirSync } from 'node:fs'
import worker from '../src/index'
import { testOrderScanCookie, seedTestRoster, testInspectionFiles } from './helpers'
import { createAuthSession, getOrderById, invalidateSystemSettingsCache } from '../src/site'
import { createDueDateNotifications, sendScheduledPickupReminders } from '../src/services/notifications'
import { pickupAppointmentAt } from '../src/domain/pickupPreparation'
import { MANUAL_INSPECTION_CHECKS } from '../src/lib/inspection'
import { renderPickupPreparation } from '../src/pages/partials/pickupPreparation'

async function setup(t: any) {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2089-12-31T20:30:00Z') })
  const sqlite = new DatabaseSync(':memory:')
  t.after(() => sqlite.close())
  for (const name of readdirSync(new URL('../migrations/', import.meta.url)).filter(name => name.endsWith('.sql')).sort()) sqlite.exec(readFileSync(new URL(`../migrations/${name}`, import.meta.url), 'utf8'))
  sqlite.exec(`INSERT INTO users (id, name, email, role, staff_id) VALUES
    ('staff', '员工', 'staff@example.test', 'STAFF', NULL), ('other-staff', '其他员工', 'other@example.test', 'STAFF', NULL),
    ('other-customer', '其他客户', 'other-customer@example.test', 'CUSTOMER', 'other-staff'),
    ('admin', '管理员', 'admin@example.test', 'ADMIN', NULL), ('customer', '客户<img src=x>', 'customer@example.test', 'CUSTOMER', 'staff');
    INSERT INTO devices (id, name, model, pricePerDay, depositAmount, serialNumber, status, lifecycle_status) VALUES ('device', '电脑', 'Test', 20, 100, 'PICKUP-SN', 'available', 'READY'), ('replacement', '替换设备', 'Test', 20, 100, 'PICKUP-SN-2', 'available', 'READY');
    INSERT INTO orders (id, orderNo, userId, deviceId, startDate, endDate, rentalPeriod, totalAmount, depositAmount, status, paymentMethod, deliveryMethod, pickupLocation, pickupTimeSlot) VALUES ('pickup-order', 'OD-PICKUP', 'customer', 'device', '2090-01-01', '2090-01-07', 6, 220, 100, 'paid', 'card', 'Pickup', '墨尔本门店', '09:30');`)
  seedTestRoster(sqlite,'staff')
  sqlite.prepare("INSERT OR REPLACE INTO systemSettings(key,value) VALUES ('rentalRules',?)").run(JSON.stringify({businessHours:{start:'07:00',end:'20:00'},serviceFeeHours:[{start:'21:00',end:'23:00'}]}))
  const db = {
    prepare(sql: string) {
      let values: any[] = []
      const query = {
        bind(...input: any[]) { values = input; return query },
        async first() { return sqlite.prepare(sql).get(...values) || null },
        async all() { return { results: sqlite.prepare(sql).all(...values) } },
        async run() { return { success: true, meta: { changes: Number(sqlite.prepare(sql).run(...values).changes) } } },
      }
      return query
    },
    async batch(statements: any[]) { return Promise.all(statements.map(statement => statement.run())) },
  }
  invalidateSystemSettingsCache()
  const scanCookies=new Map<string,string>()
  const env = { RENT: db, CLOUDINARY_CLOUD_NAME:'demo',CLOUDINARY_API_KEY:'key',CLOUDINARY_API_SECRET:'secret',RESEND_API_KEY: 'pickup-test-key', EMAIL_FROM: 'sender@example.test' }
  const sessions = new Map<string, string>()
  for (const id of ['staff', 'other-staff', 'admin', 'customer', 'other-customer']) sessions.set(id, (await createAuthSession({ env } as any, id)).token)
  const request = async (actor = 'staff', path = '/staff/orders/pickup-order/prepare-pickup', method = 'POST', form?: Record<string, string|File>) => worker.fetch(new Request(`https://rent.example.test${path}`, {
    method, body: form ? (Object.values(form).some(v=>v instanceof File)?Object.entries(form).reduce((body,[key,value])=>{body.set(key,value);return body},new FormData()):new URLSearchParams(form as Record<string,string>)) : undefined, headers: { Cookie: `session=${sessions.get(actor) || ''}${scanCookies.get(actor)||await testOrderScanCookie(sqlite,actor,path,form)}`, Origin: 'https://rent.example.test', 'Sec-Fetch-Site': 'same-origin' },
  }), env, { waitUntil() {} } as any)
  const scan = async (actor:string,code:string,source='camera') => {
    const call=(operation:string,body:any)=>worker.fetch(new Request('https://rent.example.test/staff/mobile/scan/'+operation,{method:'POST',body:JSON.stringify(body),headers:{Cookie:'session='+sessions.get(actor)+(scanCookies.get(actor)||''),Origin:'https://rent.example.test','Sec-Fetch-Site':'same-origin','Content-Type':'application/json'}}),env,{waitUntil(){}} as any)
    const verified=await call('verify',{code,source});if(!verified.ok)return verified
    scanCookies.set(actor,'; '+verified.headers.get('set-cookie')!.split(';')[0])
    const order=await verified.json() as any
    return call('confirm',{orderId:order.orderId,stage:order.stage})
  }
  const sent: any[] = []
  let emailOk = true, beforeSend: (() => Promise<void>) | undefined
  t.mock.method(globalThis, 'fetch', async (url: any, init: any) => {
    if(String(url).startsWith('https://api.cloudinary.com/'))return Response.json({secure_url:'https://res.cloudinary.com/demo/image/upload/inspection.png'})
    assert.equal(String(url), 'https://api.resend.com/emails')
    sent.push(JSON.parse(init.body))
    await beforeSend?.()
    return Response.json(emailOk ? { id: 'email-pickup' } : { message: 'Rejected' }, { status: emailOk ? 200 : 503 })
  })
  const scheduled = async () => {
    const pending: Promise<unknown>[] = []
    await worker.scheduled({ cron: '* * * * *', scheduledTime: Date.now() } as any, env, { waitUntil(promise: Promise<unknown>) { pending.push(promise) } } as any)
    await Promise.all(pending)
  }
  const reminders = () => sendScheduledPickupReminders({ env, req: { url: 'https://scheduled-event' } } as any)
  const row = () => sqlite.prepare("SELECT * FROM orders WHERE id = 'pickup-order'").get()!
  return { sqlite, env, request, scan, sent, row, scheduled, reminders, failEmail: () => { emailOk = false }, restoreEmail: () => { emailOk = true }, beforeSend: (callback: () => Promise<void>) => { beforeSend = callback } }
}

test('assigned staff marks equipment ready and sends pickup details and a scannable QR exactly once', async t => {
  const f = await setup(t)
  const response = await f.request()
  assert.equal(response.status, 303, await response.text())
  assert.match(response.headers.get('location')!, /pickupReady=sent/)
  assert.ok(f.row().pickup_ready_at)
  assert.equal(f.row().pickup_ready_by, 'staff')
  assert.ok(f.row().pickup_ready_email_sent_at)
  assert.equal(f.row().pickup_ready_email_attempt_at, null)
  assert.equal(f.row().status, 'paid')
  assert.equal(f.row().handover_completed_at, null)
  assert.equal(f.sent.length, 1)
  assert.deepEqual(f.sent[0].to, ['customer@example.test'])
  const code=String(f.sqlite.prepare("SELECT verification_code FROM order_verification_codes WHERE order_id='pickup-order'").get()!.verification_code)
  assert.match(code,/^[A-Z0-9]{6}$/);assert.match(code,/[A-Z]/);assert.match(code,/[0-9]/);assert.ok(f.sent[0].html.includes(code))
  assert.match(f.sent[0].html, /取货二维码/)
  assert.match(f.sent[0].html, /客户&lt;img src=x&gt;/)
  assert.match(f.sent[0].html, /2090-01-01/)
  assert.match(f.sent[0].html, /墨尔本门店/)
  const image = /<img[^>]+src="(https:\/\/quickchart\.io\/qr[^\"]+)"/.exec(f.sent[0].html)![1].replace(/&amp;/g, '&')
  assert.equal(new URL(image).searchParams.get('text'), 'https://rent.example.test/pickup/pickup-order')
  assert.equal((await f.request()).status, 303)
  assert.equal(f.sent.length, 1)
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM notifications WHERE type = 'pickup_reminder'").get()!.n, 1)
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE action = 'PICKUP_PREPARED'").get()!.n, 1)
  const order = (await getOrderById({ env: f.env } as any, 'pickup-order'))!
  assert.match(renderPickupPreparation(order), /准备完成/)
  assert.doesNotMatch(renderPickupPreparation(order), /<form/)
})

test('admin may prepare; unrelated staff and customers cannot trigger pickup emails', async t => {
  const f = await setup(t)
  for (const actor of ['other-staff', 'customer', 'anonymous']) assert.equal((await f.request(actor)).status, 403)
  assert.equal(f.sent.length, 0)
  assert.equal(f.row().pickup_ready_at, null)
  assert.equal((await f.request('admin')).status, 303)
  assert.equal(f.row().pickup_ready_by, 'admin')
  assert.match((await f.request('admin')).headers.get('location')!, /^\/admin\/orders\/pickup-order/)
  assert.equal(f.sent.length, 1)
})

test('failed email keeps ready state and allows retry without duplicating the customer notification', async t => {
  const f = await setup(t)
  f.failEmail()
  assert.match((await f.request()).headers.get('location')!, /pickupReady=failed/)
  const readyAt = f.row().pickup_ready_at
  assert.ok(readyAt)
  assert.equal(f.row().pickup_ready_email_sent_at, null)
  assert.match(renderPickupPreparation((await getOrderById({ env: f.env } as any, 'pickup-order'))!), /重发取货邮件/)
  f.restoreEmail()
  assert.match((await f.request()).headers.get('location')!, /pickupReady=sent/)
  assert.equal(f.row().pickup_ready_at, readyAt)
  assert.equal(f.sent.length, 2)
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM notifications WHERE type = 'pickup_reminder'").get()!.n, 1)
})

test('overlapping clicks do not send twice; an abandoned claim can be retried', async t => {
  const f = await setup(t)
  f.beforeSend(async () => { assert.match((await f.request()).headers.get('location')!, /pickupReady=busy/) })
  assert.equal((await f.request()).status, 303)
  assert.equal(f.sent.length, 1)
  f.sqlite.exec("UPDATE orders SET pickup_ready_email_sent_at = NULL, pickup_ready_email_attempt_at = datetime('now', '-6 minutes')")
  assert.match((await f.request()).headers.get('location')!, /pickupReady=sent/)
  assert.equal(f.sent.length, 2)
})

test('unpaid, completed, handed-over, delivery, unavailable equipment and refund orders cannot be prepared', async t => {
  const f = await setup(t)
  for (const status of ['pending_payment', 'approved', 'active', 'completed', 'cancelled']) {
    f.sqlite.prepare('UPDATE orders SET status = ?').run(status)
    assert.equal((await f.request()).status, 409, status)
  }
  f.sqlite.exec("UPDATE orders SET status = 'paid', deliveryMethod = 'Delivery'")
  assert.equal((await f.request()).status, 409)
  f.sqlite.exec("UPDATE orders SET deliveryMethod = 'Pickup', handover_completed_at = CURRENT_TIMESTAMP")
  assert.equal((await f.request()).status, 409)
  f.sqlite.exec("UPDATE orders SET handover_completed_at = NULL; UPDATE devices SET lifecycle_status = 'MAINTENANCE' WHERE id = 'device'")
  assert.equal((await f.request()).status, 409)
  f.sqlite.exec("UPDATE devices SET lifecycle_status = 'READY'; INSERT INTO customer_refund_requests (id, order_id, customer_id, order_total, service_fee, paid_amount, fee_amount, refund_amount, quote_json, reason) VALUES ('refund', 'pickup-order', 'customer', 220, 0, 220, 11, 209, '{}', '退款')")
  assert.equal((await f.request()).status, 409)
  assert.equal(f.row().pickup_ready_at, null)
  assert.equal(f.sent.length, 0)
})

test('changing the assigned equipment clears preparation; the new device must be prepared separately', async t => {
  const f = await setup(t)
  await f.request()
  f.sqlite.exec("UPDATE orders SET deviceId = 'replacement'")
  assert.equal(f.row().pickup_ready_at, null)
  assert.equal(f.row().pickup_ready_email_sent_at, null)
  assert.equal(f.row().pickup_ready_by, null)
  assert.equal((await f.request()).status, 303)
  assert.equal(f.sent.length, 2)
})

test('today’s automatic reminders do not announce unprepared devices or duplicate the ready email', async t => {
  const f = await setup(t)
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Melbourne', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  f.sqlite.prepare('UPDATE orders SET startDate = ?').run(today)
  const c = { env: f.env, req: { url: 'https://rent.example.test/cron' } } as any
  await createDueDateNotifications(c)
  assert.equal(f.sent.length, 0)
  await f.request()
  await createDueDateNotifications(c)
  assert.equal(f.sent.length, 1)
})

test('signed orders awaiting pickup can be prepared before the manual handover', async t => {
  const f = await setup(t)
  f.sqlite.exec("UPDATE orders SET status = 'approved'; INSERT INTO contracts (id, orderId, contractNumber, content, status) VALUES ('contract', 'pickup-order', 'CONTRACT-PICKUP', '<p>合同</p>', 'signed')")
  assert.match((await f.request()).headers.get('location')!, /pickupReady=sent/)
  assert.equal(f.sent.length, 1)
  assert.equal(f.row().status, 'approved')
})

test('a disabled email template reports failure and can be retried after enabling it', async t => {
  const f = await setup(t)
  f.sqlite.exec("UPDATE email_templates SET enabled = 0 WHERE id = 'pickup_reminder'")
  assert.match((await f.request()).headers.get('location')!, /pickupReady=failed/)
  assert.ok(f.row().pickup_ready_at)
  assert.equal(f.row().pickup_ready_email_sent_at, null)
  assert.equal(f.sent.length, 0)
  f.sqlite.exec("UPDATE email_templates SET enabled = 1 WHERE id = 'pickup_reminder'")
  assert.match((await f.request()).headers.get('location')!, /pickupReady=sent/)
  assert.equal(f.sent.length, 1)
})

test('staff, admin and handover pages expose the preparation button and the completed state', async t => {
  const f = await setup(t)
  for (const [actor, path] of [['staff', '/staff/orders/pickup-order'], ['admin', '/admin/orders/pickup-order'], ['staff', '/staff/orders/pickup-order/handover']]) {
    const response = await f.request(actor, path, 'GET')
    assert.equal(response.status, 200)
    assert.match(await response.text(), /准备完成并通知客户/)
  }
  await f.request()
  const response = await f.request('staff', '/staff/orders/pickup-order', 'GET')
  const html = await response.text()
  assert.match(html, /准备完成/)
  assert.match(html, /取货邮件已发送/)
  assert.doesNotMatch(html, /准备完成并通知客户/)
})


test('pickup QR variable follows its saved template position without an extra appended QR', async t => {
  const f = await setup(t)
  const saved = await f.request('admin', '/admin/email-templates/pickup_reminder', 'POST', {
    subject: '取货 {order_number}', body: '<p>BEFORE-QR</p>{pickup_qr_code}<p>AFTER-QR {customer_name}</p>', theme_color: '#123456',
  })
  assert.equal(saved.status, 302)
  assert.match((await f.request()).headers.get('location')!, /pickupReady=sent/)
  const html = f.sent[0].html as string
  assert.match(html, /BEFORE-QR[\s\S]*<img[^>]+quickchart\.io[\s\S]*AFTER-QR/)
  assert.equal((html.match(/https:\/\/quickchart\.io\/qr/g) || []).length, 1)
  assert.doesNotMatch(html, /\{pickup_qr_code\}|&lt;img src=&quot;https:\/\/quickchart/)
  assert.match(html, /客户&lt;img src=x&gt;/)
  const editor = await f.request('admin', '/admin/email-templates', 'GET')
  assert.equal(editor.status, 200)
  const page = await editor.text()
  assert.match(page, /<code>\{pickup_qr_code\}<\/code>/)
  assert.ok((page.match(/<code>\{pickup_qr_code\}<\/code>/g) || []).length > 1)
})

test('removing the pickup QR variable removes the image from the email', async t => {
  const f = await setup(t)
  f.sqlite.prepare("UPDATE email_templates SET body = ? WHERE id = 'pickup_reminder'").run('<p>请按预约时间取货。</p>')
  await f.request()
  assert.equal(f.sent.length, 1)
  assert.doesNotMatch(f.sent[0].html, /quickchart\.io|取货二维码/)
})

test('QR template migration preserves custom content and adds the variable only once', async t => {
  const f = await setup(t)
  f.sqlite.prepare("UPDATE email_templates SET body = ?, subject = ? WHERE id = 'pickup_reminder'").run('<p>自定义取货安排</p>', '自定义主题')
  const sql = readFileSync(new URL('../migrations/0175_add_pickup_qr_template_variable.sql', import.meta.url), 'utf8')
  f.sqlite.exec(sql)
  f.sqlite.exec(sql)
  const template = f.sqlite.prepare("SELECT body, subject FROM email_templates WHERE id = 'pickup_reminder'").get()!
  assert.match(String(template.body), /^<p>自定义取货安排<\/p>/)
  assert.equal(template.subject, '自定义主题')
  assert.equal((String(template.body).match(/\{pickup_qr_code\}/g) || []).length, 1)
})

test('pickup appointments resolve to Melbourne instants across winter, summer and midnight', () => {
  const cases = [
    ['2026-11-02', '14:00', '2026-11-02T03:00:00Z'],
    ['2026-06-01', '14:00', '2026-06-01T04:00:00Z'],
    ['2026-11-03', '00:30', '2026-11-02T13:30:00Z'],
    ['2026-10-04', '04:00', '2026-10-03T17:00:00Z'],
    ['2026-04-05', '04:00', '2026-04-04T18:00:00Z'],
  ]
  for (const [startDate, pickupTimeSlot, expected] of cases) {
    assert.equal(pickupAppointmentAt({ startDate, pickupTimeSlot }), Date.parse(expected), `${startDate} ${pickupTimeSlot}`)
  }
  assert.equal(pickupAppointmentAt({ startDate: '2026-11-02', pickupTimeSlot: 'morning' }, { businessHours: { start: '10:30', end: '20:00' } }), Date.parse('2026-11-01T23:30:00Z'))
  assert.equal(pickupAppointmentAt({ startDate: '2026-11-02', pickupTimeSlot: 'evening_service' }), Date.parse('2026-11-02T10:00:00Z'))
  for (const [startDate, pickupTimeSlot] of [['2026-02-30', '09:30'], ['2026-11-02', ''], ['2026-11-02', '24:00'], ['2026-11-02', 'invalid'], ['2026-10-04', '02:30']]) {
    assert.equal(pickupAppointmentAt({ startDate, pickupTimeSlot }), null)
  }
})

test('preparation is enabled days before pickup and immediately notifies the customer', async t => {
  const f = await setup(t)
  t.mock.timers.setTime(Date.parse('2089-12-29T20:30:00Z'))
  for (const actor of ['staff', 'admin']) {
    const page = await f.request(actor, `/${actor}/orders/pickup-order`, 'GET')
    assert.equal(page.status, 200)
    assert.doesNotMatch(await page.text(), /<button[^>]* disabled>准备完成并通知客户/)
  }
  assert.match((await f.request()).headers.get('location')!, /pickupReady=sent/)
  assert.equal(f.sent.length, 1)
  assert.ok(f.row().pickup_ready_at)
  assert.equal(f.row().pickup_notice_base_url, 'https://rent.example.test')
})

test('missing appointment time does not block marking equipment ready', async t => {
  const f = await setup(t)
  f.sqlite.exec('UPDATE orders SET pickupTimeSlot = NULL')
  const order = (await getOrderById({ env: f.env } as any, 'pickup-order'))!
  assert.doesNotMatch(renderPickupPreparation(order), /<button[^>]* disabled/)
  assert.equal((await f.request()).status, 303)
  assert.equal(f.sent.length, 1)
  assert.equal(await sendScheduledPickupReminders({ env: f.env, req: { url: 'https://scheduled-event' } } as any), 0)
})

test('ready notice is immediate, with one additional email and site notification at 2 hours and 30 minutes', async t => {
  const f = await setup(t)
  const twoHours = Date.parse('2089-12-31T20:30:00Z')
  t.mock.timers.setTime(twoHours - 86_400_000)
  assert.equal((await f.request()).status, 303)
  assert.equal(f.sent.length, 1)
  t.mock.timers.setTime(twoHours - 1000)
  assert.equal(await f.reminders(), 0)
  t.mock.timers.setTime(twoHours)
  await f.scheduled()
  assert.equal(f.sent.length, 2)
  assert.match(f.sent[1].subject, /2 小时/)
  assert.match(f.sent[1].html, /距离预约取货还有 2 小时/)
  const image = /<img[^>]+src="(https:\/\/quickchart\.io\/qr[^\"]+)"/.exec(f.sent[1].html)![1].replace(/&amp;/g, '&')
  assert.equal(new URL(image).origin, 'https://quickchart.io')
  assert.equal(new URL(image).searchParams.get('text'), 'https://rent.example.test/pickup/pickup-order')
  assert.doesNotMatch(f.sent[1].html, /scheduled-event/)
  assert.ok(f.row().pickup_reminder_2h_sent_at)
  assert.equal(await f.reminders(), 0)
  t.mock.timers.setTime(twoHours + 90 * 60 * 1000 - 1000)
  assert.equal(await f.reminders(), 0)
  t.mock.timers.setTime(twoHours + 90 * 60 * 1000)
  await f.scheduled()
  assert.equal(f.sent.length, 3)
  assert.match(f.sent[2].subject, /30 分钟/)
  assert.ok(f.row().pickup_reminder_30m_sent_at)
  assert.equal(await f.reminders(), 0)
  assert.equal(f.sent.length, 3)
  for (const type of ['pickup_reminder', 'pickup_reminder_2h', 'pickup_reminder_30m']) {
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM notifications WHERE type = ?').get(type)!.n, 1)
  }
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM scheduled_job_runs WHERE job_name = 'send_pickup_reminders' AND status = 'SUCCESS'").get()!.n, 2)
  for (const job of ['expire_missed_pickups', 'expire_rental_link_drafts', 'charge_overdue_returns', 'charge_monthly_rentals']) {
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM scheduled_job_runs WHERE job_name = ?').get(job)!.n, 2)
  }
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM scheduled_job_runs WHERE job_name = 'cancel_expired_pending_payments'").get()!.n, 1)
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM scheduled_job_runs WHERE job_name = 'cleanup_expired_contracts'").get()!.n, 0)
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM scheduled_job_runs WHERE job_name = 'deliver_c2c_emails' AND status = 'SUCCESS'").get()!.n, 2)
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM scheduled_job_runs WHERE job_name = 'rental_payout_requests' AND status = 'SUCCESS'").get()!.n, 2)
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM scheduled_job_runs').get()!.n, 17)
})

test('concurrent ticks send once and retry failed email without duplicating the site notification', async t => {
  const f = await setup(t)
  await f.request()
  f.failEmail()
  assert.equal(await f.reminders(), 0)
  assert.equal(f.row().pickup_reminder_2h_sent_at, null)
  assert.equal(f.row().pickup_reminder_attempt_at, null)
  f.restoreEmail()
  f.beforeSend(async () => { assert.equal(await f.reminders(), 0) })
  assert.equal(await f.reminders(), 1)
  assert.equal(f.sent.length, 3)
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM notifications WHERE type = 'pickup_reminder_2h'").get()!.n, 1)
})

test('reminders stop after handover, cancellation, deletion, or a delivery-method change', async t => {
  const f = await setup(t)
  await f.request()
  for (const [column, value] of [['status', 'active'], ['status', 'cancelled'], ['handover_completed_at', '2090-01-01 00:00:00'], ['deleted_at', '2090-01-01 00:00:00'], ['deliveryMethod', 'Delivery']]) {
    f.sqlite.exec("UPDATE orders SET status = 'paid', handover_completed_at = NULL, deleted_at = NULL, deliveryMethod = 'Pickup', pickup_ready_at = CURRENT_TIMESTAMP")
    f.sqlite.prepare(`UPDATE orders SET ${column} = ?`).run(value)
    assert.equal(await f.reminders(), 0, column)
  }
  assert.equal(f.sent.length, 1)
})

test('unprepared and refund-pending equipment receives no pickup reminders', async t => {
  const f = await setup(t)
  assert.equal(await f.reminders(), 0)
  await f.request()
  f.sqlite.exec("INSERT INTO customer_refund_requests (id, order_id, customer_id, order_total, service_fee, paid_amount, fee_amount, refund_amount, quote_json, reason) VALUES ('refund', 'pickup-order', 'customer', 220, 0, 220, 11, 209, '{}', '退款')")
  assert.equal(await f.reminders(), 0)
  assert.equal(f.sent.length, 1)
})

test('rescheduling resets reminder delivery and uses the new appointment', async t => {
  const f = await setup(t)
  await f.request()
  assert.equal(await f.reminders(), 1)
  f.sqlite.exec("UPDATE orders SET pickupTimeSlot = '10:30'")
  assert.equal(f.row().pickup_reminder_2h_sent_at, null)
  assert.equal(f.row().pickup_reminder_30m_sent_at, null)
  assert.equal(await f.reminders(), 0)
  t.mock.timers.setTime(Date.parse('2089-12-31T21:30:00Z'))
  assert.equal(await f.reminders(), 1)
  assert.match(f.sent[2].html, /10:30/)
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM notifications WHERE type = 'pickup_reminder_2h'").get()!.n, 2)
})

test('late recovery skips the outdated 2-hour notice and never reminds after appointment time', async t => {
  const f = await setup(t)
  await f.request()
  t.mock.timers.setTime(Date.parse('2089-12-31T22:05:00Z'))
  assert.equal(await f.reminders(), 1)
  assert.match(f.sent[1].subject, /30 分钟/)
  assert.equal(f.row().pickup_reminder_2h_sent_at, null)
  t.mock.timers.setTime(Date.parse('2089-12-31T22:30:00Z'))
  assert.equal(await f.reminders(), 0)
  assert.equal(f.sent.length, 2)
})

test('an abandoned reminder claim can be retried and disabled templates do not mark delivery successful', async t => {
  const f = await setup(t)
  await f.request()
  f.sqlite.exec("UPDATE orders SET pickup_reminder_attempt_at = '2089-12-31T20:24:00Z'; UPDATE email_templates SET enabled = 0 WHERE id = 'pickup_reminder_2h'")
  assert.equal(await f.reminders(), 0)
  assert.equal(f.row().pickup_reminder_2h_sent_at, null)
  f.sqlite.exec("UPDATE email_templates SET enabled = 1 WHERE id = 'pickup_reminder_2h'")
  assert.equal(await f.reminders(), 1)
  assert.equal(f.sent.length, 2)
})

test('midnight pickup reminders are sent on the preceding Melbourne date', async t => {
  const f = await setup(t)
  await f.request()
  f.sqlite.exec("UPDATE orders SET startDate = '2090-01-02', pickupTimeSlot = '00:30'")
  t.mock.timers.setTime(Date.parse('2090-01-01T11:29:59Z'))
  assert.equal(await f.reminders(), 0)
  t.mock.timers.setTime(Date.parse('2090-01-01T11:30:00Z'))
  assert.equal(await f.reminders(), 1)
  assert.match(f.sent[1].subject, /2 小时/)
  t.mock.timers.setTime(Date.parse('2090-01-01T13:00:00Z'))
  assert.equal(await f.reminders(), 1)
  assert.match(f.sent[2].subject, /30 分钟/)
})


const pickupForm = () => ({
  ...testInspectionFiles(),deviceSerialNumber: 'PICKUP-SN', accessories: '电源适配器，充电线', conditionNotes: '外观和功能已核对',
  customerConfirmed: '1', customerConfirmationName: '取货客户', batteryCycles: '120', batteryHealth: '95%', inspectionNotes: '取货前检查完成',
  ...Object.fromEntries(MANUAL_INSPECTION_CHECKS.map(([field]) => [field, '正常'])),
})

const preInspectionForm = () => ({
  ...testInspectionFiles(), batteryCycles: '120', batteryHealth: '95%', inspectionNotes: '出租前检查完成',
  ...Object.fromEntries(MANUAL_INSPECTION_CHECKS.map(([field]) => [field, '正常'])),
})

test('email QR follows the staff scan and handover flow and completes pickup exactly once', async t => {
  const f = await setup(t)
  await f.request()
  const image = /<img[^>]+src="(https:\/\/quickchart\.io\/qr[^\"]+)"/.exec(f.sent[0].html)![1].replace(/&amp;/g, '&')
  const payload = new URL(image).searchParams.get('text')!
  assert.equal(payload, 'https://rent.example.test/pickup/pickup-order')
  const opened = await f.request('staff', new URL(payload).pathname, 'GET')
  assert.equal(opened.status, 302)
  const scanPath = opened.headers.get('location')!
  assert.equal(scanPath, '/staff/mobile#scan')
  const scanned = await f.scan('staff', payload)
  assert.equal(scanned.status, 200)
  const next = (await scanned.json() as any).next
  assert.equal(next, '/staff/orders/pickup-order/handover')
  const handover = await f.request('staff', next, 'GET')
  assert.equal(handover.status, 200)
  assert.match(await handover.text(), /出租前验机报告/)
  assert.equal(f.row().status, 'paid', 'opening the QR must not mark pickup complete')
  const path = '/staff/orders/pickup-order/pickup'
  assert.equal((await f.request('staff', path, 'POST', {})).status, 400)
  assert.equal((await f.request('staff', path, 'POST', { ...pickupForm(), deviceSerialNumber: 'WRONG-SN' })).status, 409)
  assert.equal((await f.request('staff', path, 'POST', { ...pickupForm(), customerConfirmed: '0' })).status, 400)
  assert.equal(f.row().status, 'paid')
  assert.equal((await f.request('staff', '/staff/orders/pickup-order/pre-inspection', 'POST', preInspectionForm())).status, 302)
  const completed = await f.request('staff', path, 'POST', pickupForm())
  assert.equal(completed.status, 302, await completed.text())
  assert.equal(f.row().status, 'active')
  assert.ok(f.row().handover_completed_at)
  assert.equal(f.row().handover_by, 'staff')
  assert.equal(f.sqlite.prepare("SELECT lifecycle_status FROM devices WHERE id = 'device'").get()!.lifecycle_status, 'RENTED')
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM order_fulfillment_records WHERE order_id = 'pickup-order' AND record_type = 'HANDOVER'").get()!.n, 1)
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM device_inspections WHERE rental_id = 'pickup-order' AND inspection_type = 'before_rental'").get()!.n, 1)
  assert.equal((await f.request('staff', path, 'POST', pickupForm())).status, 403)
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM order_fulfillment_records WHERE order_id = 'pickup-order' AND record_type = 'HANDOVER'").get()!.n, 1)
  assert.equal(await f.reminders(), 0)
})

test('QR links preserve login and ownership checks; customer cannot confirm pickup', async t => {
  const f = await setup(t)
  const anonymous = await f.request('anonymous', '/pickup/pickup-order', 'GET')
  assert.equal(anonymous.status, 302)
  assert.equal(new URL(anonymous.headers.get('location')!, 'https://rent.example.test').searchParams.get('redirect'), '/pickup/pickup-order')
  const owner = await f.request('customer', '/pickup/pickup-order', 'GET')
  assert.equal(owner.status, 302)
  assert.equal(owner.headers.get('location'), '/customer/orders/pickup-order')
  assert.equal((await f.request('other-customer', '/pickup/pickup-order', 'GET')).status, 403)
  const path = '/staff/orders/pickup-order/pickup'
  assert.equal((await f.request('customer', path, 'POST', pickupForm())).status, 401)
  assert.equal((await f.request('other-staff', path, 'POST', pickupForm())).status, 403)
  const scanPath = '/staff/mobile/scan?code=' + encodeURIComponent('https://rent.example.test/pickup/pickup-order')
  const denied = await f.scan('other-staff','https://rent.example.test/pickup/pickup-order')
  assert.equal(denied.status, 403)
  assert.match(await denied.text(), /你没有权限处理该客户的订单|当前未排班/)
  assert.equal((await f.request('other-staff', '/staff/orders/pickup-order/handover', 'GET')).status, 403)
  assert.equal(f.row().handover_completed_at, null)
})

test('admin can scan pickup QR; invalid, cancelled and deleted orders cannot be handed over', async t => {
  const f = await setup(t)
  const scanPath = '/staff/mobile/scan?code=' + encodeURIComponent('RENT-PICKUP:pickup-order')
  const scan = await f.scan('admin','RENT-PICKUP:pickup-order')
  assert.equal(scan.status, 200)
  assert.equal((await scan.json() as any).next, '/staff/orders/pickup-order/handover')
  assert.equal((await f.request('admin', '/staff/mobile/scan?code=invalid-code', 'GET')).status, 403)
  assert.equal((await f.request('admin', '/pickup/missing-order', 'GET')).status, 404)
  f.sqlite.exec("UPDATE orders SET status = 'cancelled'")
  assert.equal((await f.request('admin', scanPath, 'GET')).status, 403)
  assert.equal((await f.request('admin', '/staff/orders/pickup-order/handover', 'GET')).status, 302)
  assert.equal((await f.request('admin', '/staff/orders/pickup-order/pickup', 'POST', pickupForm())).status, 409)
  f.sqlite.exec("UPDATE orders SET status = 'paid', deleted_at = CURRENT_TIMESTAMP")
  assert.equal((await f.request('admin', '/pickup/pickup-order', 'GET')).status, 404)
  assert.equal((await f.request('admin', scanPath, 'GET')).status, 403)
  assert.equal(f.row().handover_completed_at, null)
})

test('order numbers and their last six characters cannot bypass verification', async t => {
  const f = await setup(t)
  f.sqlite.exec("UPDATE orders SET orderNo='OD-20900101-AB12CD'")
  for(const actor of ['staff','admin'])for(const code of ['AB12CD','ab12cd','OD-20900101-AB12CD','RENT-PICKUP:pickup-order']) {
    assert.equal((await f.request(actor,'/staff/mobile/scan?code='+encodeURIComponent(code),'GET')).status,403)
  }
  const page=await f.request('staff','/staff/mobile','GET')
  const html=await page.text();assert.match(html,/6 位取还校验码/);assert.doesNotMatch(html,/输入订单号或后 6 位/)
  assert.equal((await f.scan('staff','AB12CD','code')).status,400)
})

test('verification codes are case-insensitive and unrelated to order number suffixes', async t => {
  const f=await setup(t)
  f.sqlite.exec("INSERT INTO order_verification_codes(order_id,verification_code) VALUES ('pickup-order','A7K2P9')")
  for(const code of ['A7K2P9','a7k2p9',' a7K2p9 ']){
    const response=await f.scan('staff',code,'code');assert.equal(response.status,200)
    assert.equal((await response.json() as any).next,'/staff/orders/pickup-order/handover')
  }
  assert.equal((await f.scan('other-staff','A7K2P9','code')).status,403)
  assert.equal((await f.scan('staff','https://evil.test/pickup/pickup-order')).status,400)
  assert.equal((await f.scan('staff','pickup-order')).status,400)
})
