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
import { expireRentalLinkDrafts } from '../src/services/rentalLinks'
import { extractInlineScripts } from './helpers'

async function setup(t: any) {
  const sqlite = new DatabaseSync(':memory:')
  for (const name of readdirSync(new URL('../migrations/', import.meta.url)).filter(name => name.endsWith('.sql')).sort()) sqlite.exec(readFileSync(new URL(`../migrations/${name}`, import.meta.url), 'utf8'))
  sqlite.exec("INSERT INTO users (id, name, email, role, status, account_status) VALUES ('link-admin', '链接管理员', 'link-admin@example.test', 'ADMIN', 'active', 'active'), ('link-staff', '链接员工', 'link-staff@example.test', 'STAFF', 'active', 'active'); INSERT INTO devices (id, name, model, serialNumber, pricePerDay, depositAmount, weekly_discount_percent, monthly_discount_percent, weekly_discount_override, monthly_discount_override, status, lifecycle_status) VALUES ('link-device', '游戏笔记本', 'RTX 4060', 'LINK-SN', 30, 200, 10, 20, 10, 20, 'available', 'READY'), ('other-device', '其他设备', 'Other', 'OTHER-SN', 60, 500, 0, 0, NULL, NULL, 'available', 'READY');")
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
    async batch(statements: any[]) { const results = []; for (const statement of statements) results.push(await statement.run()); return results },
  }
  const env = { RENT: db }
  const context = { env } as any
  const admin = await createAuthSession(context, 'link-admin'), staff = await createAuthSession(context, 'link-staff')
  const request = (path: string, data?: Record<string, string>, actor: 'admin' | 'staff' | null = null) => worker.fetch(new Request(new URL(path, 'https://rent.example.test').toString(), {
    ...(data ? { method: 'POST', body: new URLSearchParams(data) } : {}),
    headers: { Origin: 'https://rent.example.test', 'Sec-Fetch-Site': 'same-origin', ...(actor ? { Cookie: `session=${actor === 'admin' ? admin.token : staff.token}` } : {}) },
  }), env as any, { waitUntil() { } } as any)
  const create = async () => {
    const response = await request('/admin/rental-links', { deviceId: 'link-device', title: '笔记本自助租赁', pickupLocation: '墨尔本门店', returnLocation: '墨尔本门店' }, 'admin')
    assert.equal(response.status, 303)
    const link = sqlite.prepare('SELECT * FROM rental_links ORDER BY rowid DESC LIMIT 1').get() as any
    assert.ok(link)
    return { ...link, path: `/rent/${link.token}` }
  }
  t.after(() => sqlite.close())
  return { sqlite, request, create, context }
}

const dates = { startDate: '2090-01-02', endDate: '2090-01-09', startPeriod: 'AM', endPeriod: 'AM' }
const nextDates = { startDate: '2090-01-12', endDate: '2090-01-19', startPeriod: 'AM', endPeriod: 'AM' }

test('admin unavailable date ranges survive editing and block rentals throughout the range', async t => {
  const { sqlite, request, create } = await setup(t)
  const link = await create()
  const form = { name: '游戏笔记本', brand: 'Test', model: 'RTX 4060', serialNumber: 'LINK-SN', pricePerDay: '30', depositAmount: '200', status: 'available', agentStatus: 'unregistered', deviceMode: 'normal', unavailableDates: '2090-01-02 ： 2090-12-31, 2091-01-05' }
  const save = await request('/admin/devices/link-device/edit', form, 'admin')
  assert.equal(save.status, 302)
  const activeDates = () => sqlite.prepare("SELECT unavailable_date FROM device_unavailable_dates WHERE device_id = 'link-device' AND deleted_at IS NULL ORDER BY unavailable_date").all().map(row => row.unavailable_date)
  assert.equal(activeDates().length, 365)
  assert.equal(activeDates()[0], '2090-01-02')
  assert.equal(activeDates().at(-2), '2090-12-31')
  const html = await (await request('/admin/devices/link-device/edit', undefined, 'admin')).text()
  assert.match(html, /name="unavailableDates" value="2090-01-02:2090-12-31, 2091-01-05"/)
  for (const range of [dates, { ...dates, startDate: '2090-06-01', endDate: '2090-06-08' }]) assert.match((await request(link.path, range)).headers.get('location')!, /\?error=/)
  const before = activeDates()
  const invalid = await request('/admin/devices/link-device/edit', { ...form, name: '不应保存', unavailableDates: '2090-02-30:2090-03-05' }, 'admin')
  assert.equal(invalid.status, 400)
  assert.deepEqual(activeDates(), before)
  assert.equal(sqlite.prepare("SELECT name FROM devices WHERE id = 'link-device'").get()?.name, form.name)
  assert.equal((await request('/admin/devices/link-device/edit', { ...form, unavailableDates: '' }, 'admin')).status, 302)
  assert.equal(activeDates().length, 0)
})

test('only admins can create and toggle permanent links, and list pages render valid scripts', async t => {
  const { sqlite, request, create } = await setup(t)
  assert.equal((await request('/admin/rental-links')).status, 403)
  assert.equal((await request('/admin/rental-links', { deviceId: 'link-device' }, 'staff')).status, 403)
  const link = await create()
  assert.match(link.token, /^[A-Za-z0-9_-]{32}$/)
  assert.equal(link.enabled, 1)
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM orders').get()?.n, 0)
  const html = await (await request('/admin/rental-links', undefined, 'admin')).text()
  assert.match(html, /复制链接/)
  for (const script of extractInlineScripts(html)) assert.doesNotThrow(() => new Function(script))
  assert.equal((await request(`/admin/rental-links/${link.id}/toggle`, { enabled: '0' }, 'staff')).status, 403)
  await request(`/admin/rental-links/${link.id}/toggle`, { enabled: '0' }, 'admin')
  assert.equal((await request(link.path)).status, 404)
  assert.equal((await request(link.path, dates)).status, 404)
  await request(`/admin/rental-links/${link.id}/toggle`, { enabled: '1' }, 'admin')
  assert.equal((await request(link.path)).status, 200)
})

test('the same link creates independent orders and private signing tokens for non-overlapping rentals', async t => {
  const { sqlite, request, create } = await setup(t)
  const link = await create()
  const first = await request(link.path, { ...dates, deviceId: 'other-device', totalAmount: '0', depositAmount: '0', lateFeePerDay: '9999', pickupLocation: '伪造地点', couponCode: 'FORGED' })
  assert.equal(first.status, 303)
  assert.match(first.headers.get('location')!, /\/contract\/sign\?token=/)
  const second = await request(link.path, nextDates)
  assert.equal(second.status, 303)
  assert.match(second.headers.get('location')!, /\/contract\/sign\?token=/)
  assert.notEqual(first.headers.get('location'), second.headers.get('location'))
  const orders = sqlite.prepare('SELECT * FROM orders ORDER BY startDate').all() as any[]
  assert.equal(orders.length, 2)
  assert.ok(orders.every(order => order.rental_link_id === link.id && order.deviceId === 'link-device' && order.status === 'draft'))
  assert.equal(orders[0].totalAmount, 389)
  assert.equal(orders[0].depositAmount, 200)
  assert.equal(orders[0].pickupLocation, '墨尔本门店')
  assert.equal(orders[0].coupon_code, null)
  const contracts = sqlite.prepare('SELECT *, (julianday(signExpiresAt)-julianday())*1440 AS expiry_minutes FROM contracts WHERE orderId IN (?, ?)').all(...orders.map(order => order.id)) as any[]
  assert.equal(contracts.length, 2)
  assert.ok(contracts.every(contract => contract.status === 'pending_sign' && contract.expiry_minutes > 29 && contract.expiry_minutes <= 30.1 && contract.late_fee_per_day === 0))
  assert.equal(sqlite.prepare('SELECT enabled FROM rental_links WHERE id = ?').get(link.id)?.enabled, 1)
  const html = await (await request(link.path)).text()
  assert.match(html, /2090-01-02/)
  const visibleHtml = extractInlineScripts(html).reduce((result, script) => result.replace(script, ''), html)
  assert.doesNotMatch(visibleHtml, /2090-01-02|暂不可选的租期|已预订的租期|设备维护或店铺不可用日期/)
  assert.match(html, /id="rental-calendar"/)
  for (const script of extractInlineScripts(html)) assert.doesNotThrow(() => new Function(script))
  assert.doesNotMatch(html, /link-admin@example.test|link-staff@example.test/)
  assert.ok(!contracts.some(contract => html.includes(contract.signToken)))
  assert.ok(!orders.some(order => html.includes(order.id)))
  const signPage = await request(first.headers.get('location')!)
  assert.equal(signPage.status, 200)
  assert.match(await signPage.text(), /阅读并同意租赁协议/)
})

test('concurrent submissions cannot reserve the same date range twice', async t => {
  const { sqlite, request, create } = await setup(t)
  const link = await create()
  const responses = await Promise.all([request(link.path, dates), request(link.path, dates)])
  assert.equal(responses.filter(response => response.headers.get('location')?.includes('/contract/sign?token=')).length, 1)
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM orders').get()?.n, 1)
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM contracts').get()?.n, 1)
})

test('database guards protect against overlapping ordinary orders and rescheduling', async t => {
  const { sqlite, request, create } = await setup(t)
  const link = await create()
  await request(link.path, dates)
  const insert = sqlite.prepare("INSERT INTO orders (id, userId, deviceId, startDate, endDate, rentalPeriod, totalAmount, depositAmount, status) VALUES (?, 'link-admin', 'link-device', ?, ?, 7, 100, 0, 'pending_approval')")
  assert.throws(() => insert.run('ordinary', dates.startDate, dates.endDate), /RENTAL_LINK_BOOKING_CONFLICT/)
  insert.run('ordinary', nextDates.startDate, nextDates.endDate)
  assert.throws(() => sqlite.prepare('UPDATE orders SET startDate = ?, endDate = ? WHERE id = ?').run(dates.startDate, dates.endDate, 'ordinary'), /RENTAL_LINK_BOOKING_CONFLICT/)
  sqlite.exec("UPDATE orders SET status = 'cancelled'")
  assert.equal((await request(link.path, dates)).headers.get('location')?.includes('/contract/sign?token='), true)
})

test('expired unsigned reservations release dates but signed or pending-payment orders remain protected', async t => {
  const { sqlite, request, create, context } = await setup(t)
  const link = await create()
  await request(link.path, dates)
  await request(link.path, nextDates)
  const rows = sqlite.prepare('SELECT id FROM orders ORDER BY startDate').all() as any[]
  sqlite.prepare("UPDATE orders SET createdAt = datetime('now', '-31 minutes')").run()
  sqlite.prepare("UPDATE orders SET status = 'pending_payment' WHERE id = ?").run(rows[1].id)
  assert.equal(await expireRentalLinkDrafts(context), 1)
  assert.equal(sqlite.prepare('SELECT status FROM orders WHERE id = ?').get(rows[0].id)?.status, 'cancelled')
  assert.equal(sqlite.prepare('SELECT status FROM orders WHERE id = ?').get(rows[1].id)?.status, 'pending_payment')
  assert.equal((await request(link.path, dates)).headers.get('location')?.includes('/contract/sign?token='), true)
  assert.equal((await request(link.path, nextDates)).headers.get('location')?.includes('/contract/sign?token='), false)
})

test('invalid dates, maintenance blocks, buffers and undated manual rentals prevent booking', async t => {
  const { sqlite, request, create } = await setup(t)
  const link = await create()
  for (const form of [{ ...dates, startDate: '2090-02-30' }, { ...dates, endDate: '2089-12-01' }, { ...dates, startPeriod: 'invalid' }, { ...dates, endDate: '2099-01-01' }]) {
    const response = await request(link.path, form)
    assert.match(response.headers.get('location')!, /\?error=/)
  }
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM orders').get()?.n, 0)
  sqlite.exec("INSERT INTO device_unavailable_dates (device_id, unavailable_date) VALUES ('link-device', '2090-01-03')")
  assert.match((await request(link.path, dates)).headers.get('location')!, /\?error=/)
  sqlite.exec('DELETE FROM device_unavailable_dates')
  sqlite.exec("UPDATE devices SET buffer_days = 2 WHERE id = 'link-device'")
  await request(link.path, dates)
  assert.match((await request(link.path, { ...nextDates, startDate: '2090-01-10' })).headers.get('location')!, /\?error=/)
  sqlite.exec("UPDATE orders SET status='cancelled'; INSERT INTO orders (id, userId, deviceId, rentalPeriod, totalAmount, depositAmount, status, is_manual) VALUES ('undated', NULL, 'link-device', 0, 0, 0, 'active', 1)")
  const html = await (await request(link.path)).text()
  assert.match(html, /尚未确定归还日期/)
  assert.match((await request(link.path, dates)).headers.get('location')!, /\?error=/)
})

for (const websiteOrder of [false, true]) {
  test(`contract flow continues without a signature for ${websiteOrder ? 'website' : 'staff'} orders`, async t => {
    const { sqlite, request, create, context } = await setup(t)
    context.env.SETTINGS_ENCRYPTION_KEY = 'contract-flow-test-key'
    t.mock.method(globalThis, 'fetch', async (input: any) => {
      assert.equal(String(input), 'https://api.frankfurter.app/latest?from=AUD&to=CNY')
      return Response.json({ rates: { CNY: 4.7 } })
    })
    const link = await create()
    await request(link.path, dates)
    const contract = sqlite.prepare('SELECT * FROM contracts LIMIT 1').get() as any
    if (websiteOrder) sqlite.prepare("UPDATE orders SET status = 'approved' WHERE id = ?").run(contract.orderId)
    const path = `/contract/sign?token=${contract.signToken}`
    const beforeConsent = await request(`${path}&step=4`, {})
    assert.ok(new URL(beforeConsent.headers.get('location')!, 'https://rent.example.test').searchParams.has('error'))
    const beforeInfo = await request(`${path}&step=2`, { firstName: 'Alice', lastName: 'Chen', email: 'alice@example.test', phoneCode: '+61', phone: '0412345678' })
    assert.equal(new URL(beforeInfo.headers.get('location')!, 'https://rent.example.test').searchParams.get('error'), '请先同意租赁协议。')
    await request(`${path}&step=1`, { agreeTerms: 'on' })
    const infoPage = await (await request(`${path}&step=2`)).text()
    assert.doesNotMatch(infoPage, /name="esignSignature"|signature-section|signatureCanvas/)
    for (const script of extractInlineScripts(infoPage)) assert.doesNotThrow(() => new Function(script))
    const saved = await request(`${path}&step=2`, { firstName: 'Alice', lastName: 'Chen', email: 'alice@example.test', phoneCode: '+61', phone: '0412345678' })
    assert.equal(saved.headers.get('location'), `${path}&step=4`)
    const session = JSON.parse(String(sqlite.prepare('SELECT session_data FROM sign_sessions WHERE token = ?').get(contract.signToken)?.session_data))
    assert.equal(session.userInfo.name, 'Alice Chen')
    assert.equal(session.userInfo.esignSignature, undefined)
    for (const step of [3, 4]) {
      const confirmationPage = await (await request(`${path}&step=${step}`)).text()
      assert.doesNotMatch(confirmationPage, /name="esignSignature"|signatureCanvas|手写签名/)
      assert.match(confirmationPage, /name="pickupTimeSlot"/)
      for (const script of extractInlineScripts(confirmationPage)) assert.doesNotThrow(() => new Function(script))
    }
    const legacyStep = await request(`${path}&step=3`, {})
    assert.equal(legacyStep.headers.get('location'), `${path}&step=4`)
    const confirmation = await request(`${path}&step=4`, {})
    assert.equal(new URL(confirmation.headers.get('location')!, 'https://rent.example.test').searchParams.get('error'), '请选择可用的取货和归还时间')
    sqlite.prepare("UPDATE orders SET deliveryMethod = 'Delivery' WHERE id = ?").run(contract.orderId)
    const completed = await request(`${path}&step=4`, { pickupTimeSlot: 'delivery_morning', returnTimeSlot: 'delivery_afternoon', paymentMethod: 'bank_transfer', refundMethod: 'original', refundBsb: '123456', refundAccountNumber: '12345678', refundAccountName: 'Alice Chen', transferReference: 'TEST-REF', transferProofUrl: 'https://example.com/proof.png' })
    assert.equal(completed.status, 200, completed.headers.get('location') || '')
    const signed = sqlite.prepare('SELECT * FROM contracts WHERE id = ?').get(contract.id) as any
    assert.equal(signed.status, 'signed')
    assert.equal(JSON.parse(signed.contract_data).esign_signature, undefined)
    assert.ok(signed.signed_content)
  })
}
