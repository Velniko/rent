/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync, readdirSync } from 'node:fs'
import { URL } from 'node:url'
import { createHash } from 'node:crypto'
import { runInNewContext } from 'node:vm'
import worker from '../src/index'
import { createAuthSession, MAINTENANCE_CHECK_TYPES, releaseDeviceIfUnbooked, updateOrderStatus } from '../src/site'
import { renderAdminDevices } from '../src/pages/admin/devices'
import { renderAdminDeviceCalendar } from '../src/pages/admin/deviceCalendar'
import { testOrderScanCookie, extractInlineScripts, testInspectionFiles } from './helpers'

async function setup(t: any, depositStatus = 'HELD', mode = 'PAID') {
  const sqlite = new DatabaseSync(':memory:')
  t.after(() => sqlite.close())
  for (const name of readdirSync(new URL('../migrations/', import.meta.url)).filter(name => name.endsWith('.sql')).sort()) sqlite.exec(readFileSync(new URL(`../migrations/${name}`, import.meta.url), 'utf8'))
  sqlite.exec("INSERT INTO users (id, name, email, role) VALUES ('release-admin', '管理员', 'release-admin@example.test', 'ADMIN'), ('release-customer', '客户', 'release-customer@example.test', 'CUSTOMER'); INSERT INTO devices (id, name, model, serialNumber, pricePerDay, depositAmount, status, lifecycle_status) VALUES ('release-device', '电脑', 'Test', 'RELEASE-SN', 20, 200, 'rented', 'RENTED');")
  sqlite.prepare("INSERT INTO orders (id, userId, deviceId, startDate, endDate, rentalPeriod, totalAmount, depositAmount, status, rental_status, deposit_status, deposit_payment_mode) VALUES ('release-order', 'release-customer', 'release-device', '2026-01-01', '2026-01-02', 1, 220, 200, 'active', 'ACTIVE', ?, ?)").run(depositStatus, mode)
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
    async batch(statements: any[]) { const result = []; for (const statement of statements) result.push(await statement.run()); return result },
  }
  const context = { env: { RENT: db,CLOUDINARY_CLOUD_NAME:'demo',CLOUDINARY_API_KEY:'key',CLOUDINARY_API_SECRET:'secret' } } as any
  const session = await createAuthSession(context, 'release-admin')
  const request = async (path: string, form: Record<string, string|File>, method = 'POST') => worker.fetch(new Request(`https://rent.example.test${path}`, {
    method, body: method === 'GET' ? undefined : (Object.values(form).some(v=>v instanceof File)?Object.entries(form).reduce((body,[key,value])=>{body.set(key,value);return body},new FormData()):new URLSearchParams(form as Record<string,string>)), headers: { Cookie: `session=${session.token}${await testOrderScanCookie(sqlite,'release-admin',path,form)}`, Origin: 'https://rent.example.test', 'Sec-Fetch-Site': 'same-origin' },
  }), context.env, { waitUntil() {} } as any)
  return { sqlite, context, request }
}

for (const depositStatus of ['HELD', 'REFUND_PENDING', 'REFUNDED']) test(`completion releases the device with deposit ${depositStatus}`, async t => {
  const { sqlite, context } = await setup(t, depositStatus)
  await updateOrderStatus(context, 'release-order', 'completed')
  const device = sqlite.prepare("SELECT status, lifecycle_status FROM devices WHERE id = 'release-device'").get()!
  assert.equal(device.status, 'available')
  assert.equal(device.lifecycle_status, 'READY')
  const order = sqlite.prepare("SELECT status, deposit_status FROM orders WHERE id = 'release-order'").get()!
  assert.equal(order.status, 'completed')
  assert.equal(order.deposit_status, depositStatus)
  assert.ok(sqlite.prepare("SELECT return_received_at FROM orders WHERE id = 'release-order'").get()?.return_received_at)
})

for (const mode of ['PAID', 'PREAUTH']) for (const status of ['returned', 'completed']) test(`${status} records the return date for ${mode} orders without a deposit`, async t => {
  const { sqlite, context } = await setup(t, 'PENDING', mode)
  sqlite.exec('UPDATE orders SET depositAmount = 0')
  await updateOrderStatus(context, 'release-order', status)
  assert.ok(sqlite.prepare("SELECT return_received_at FROM orders WHERE id = 'release-order'").get()?.return_received_at)
  sqlite.exec("UPDATE orders SET return_received_at = '2026-10-30 20:00:00'")
  await updateOrderStatus(context, 'release-order', status)
  assert.equal(sqlite.prepare("SELECT return_received_at FROM orders WHERE id = 'release-order'").get()?.return_received_at, '2026-10-30 20:00:00')
})

for (const legacy of [false, true]) test(`early completion frees the calendar after the Melbourne return date (${legacy ? 'legacy' : 'recorded'} return)`, async t => {
  const { sqlite, context } = await setup(t)
  sqlite.exec("UPDATE orders SET startDate = '2026-10-01', endDate = '2026-11-15'")
  await updateOrderStatus(context, 'release-order', 'completed')
  sqlite.exec('DROP TRIGGER update_orders_updated_at')
  sqlite.prepare("UPDATE orders SET return_received_at = ?, updatedAt = '2026-10-30 20:00:00'").run(legacy ? null : '2026-10-30 20:00:00')
  const html = await renderAdminDeviceCalendar(context, { id: 'release-admin', role: 'ADMIN' })
  const script = extractInlineScripts(html).find(script => script.includes("getElementById('fleet-calendar')"))!
  class Element {
    children: Element[] = []
    textContent = ''
    value = ''
    className = ''
    replaceChildren() { this.children = [] }
    appendChild(child: Element) { this.children.push(child) }
    append(...children: Element[]) { this.children.push(...children) }
    addEventListener() {}
  }
  const elements = new Map<string, Element>()
  runInNewContext(script, {
    Date: class extends Date { constructor(value?: string | number | Date) { super(value === undefined ? '2026-11-01T00:00:00Z' : value instanceof Date ? value.getTime() : value) } },
    document: { getElementById(id: string) { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id) }, createElement() { return new Element() } },
  })
  const cells = elements.get('fleet-calendar')!.children
  const day = (date: string, outside = false) => cells.find(cell => cell.children[0].textContent === date && cell.className.includes('is-outside') === outside)!
  assert.equal(day('30', true).children.length, 2, 'past rental remains visible')
  assert.equal(day('31', true).children.length, 1, 'early return frees the original remaining dates')
  assert.equal(day('1').children.length, 1)
  assert.equal(sqlite.prepare("SELECT endDate FROM orders WHERE id = 'release-order'").get()?.endDate, '2026-11-15', 'contract date stays intact')
  assert.equal(sqlite.prepare("SELECT status FROM devices WHERE id = 'release-device'").get()?.status, 'available')
})

test('normal return inspection releases the device while the deposit is still held', async t => {
  const { sqlite, request } = await setup(t)
  t.mock.method(globalThis,'fetch',async()=>Response.json({secure_url:'https://res.cloudinary.com/demo/image/upload/inspection.png'}))
  assert.equal((await request('/staff/orders/release-order/receive-return',{received:'1'})).status,303)
  sqlite.exec("INSERT INTO contracts (id, orderId, contractNumber, content) VALUES ('release-contract', 'release-order', 'RELEASE-CONTRACT', '<p>合同</p>')")
  assert.equal((await request('/staff/orders/release-order/inspection?fragment=1', {}, 'GET')).status, 200)
  assert.equal(sqlite.prepare("SELECT lifecycle_status FROM devices WHERE id = 'release-device'").get()?.lifecycle_status, 'RETURNED')
  assert.equal((await request('/staff/orders/release-order/inspection', { screenCondition: 'invalid' })).status, 400)
  assert.equal(sqlite.prepare("SELECT lifecycle_status FROM devices WHERE id = 'release-device'").get()?.lifecycle_status, 'RETURNED')
  const response = await request('/staff/orders/release-order/inspection', {...testInspectionFiles(),
    screenCondition: '正常', keyboardCondition: '正常', trackpadCondition: '正常', bodyCondition: '正常', cameraCondition: '正常', wifiCondition: '正常', powerTest: '正常', replacementCost: '0',
  })
  assert.equal(response.status, 302)
  assert.equal(sqlite.prepare("SELECT deposit_status FROM orders WHERE id = 'release-order'").get()?.deposit_status, 'HELD')
  assert.equal(sqlite.prepare("SELECT lifecycle_status FROM devices WHERE id = 'release-device'").get()?.lifecycle_status, 'READY')
  assert.equal(sqlite.prepare("SELECT status FROM devices WHERE id = 'release-device'").get()?.status, 'available')
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM device_lifecycle_events WHERE next_status = 'RETURNED'").get()?.count, 1)
  const event = sqlite.prepare("SELECT order_id, changed_by FROM device_lifecycle_events WHERE next_status = 'READY'").get()!
  assert.equal(event.order_id, 'release-order')
  assert.equal(event.changed_by, 'release-admin')
  assert.doesNotMatch(renderAdminDevices({ id: 'release-admin', role: 'ADMIN' }, [{ id: 'release-device', name: '电脑', status: 'available', lifecycleStatus: 'READY' }]), /待上架|确认上架|\/devices\/release-device\/relist/)
  assert.doesNotMatch(await (await request('/admin/devices/relist', {}, 'GET')).text(), /href="\/admin\/devices\/release-device\/relist"/)
})

test('completion also clears a stale rented status when the lifecycle is already ready', async t => {
  const { sqlite, context } = await setup(t)
  sqlite.exec("UPDATE devices SET lifecycle_status = 'READY' WHERE id = 'release-device'")
  await updateOrderStatus(context, 'release-order', 'completed')
  assert.equal(sqlite.prepare("SELECT status FROM devices WHERE id = 'release-device'").get()?.status, 'available')
})

test('failed authorization settlement cannot prevent force completion from releasing the device', async t => {
  const { sqlite, request } = await setup(t, 'HELD', 'PREAUTH')
  t.mock.method(globalThis, 'fetch', async () => new Response('upstream unavailable', { status: 503 }))
  const response = await request('/admin/orders/release-order/update', { status: 'completed', force: '1',deviceConfirmed:'1',reason:'设备已收回' })
  assert.ok(response.status >= 400)
  assert.equal(sqlite.prepare("SELECT status FROM orders WHERE id = 'release-order'").get()?.status, 'completed')
  assert.equal(sqlite.prepare("SELECT deposit_status FROM orders WHERE id = 'release-order'").get()?.deposit_status, 'REFUND_PENDING')
  assert.equal(sqlite.prepare("SELECT lifecycle_status FROM devices WHERE id = 'release-device'").get()?.lifecycle_status, 'READY')
})

for (const status of ['extended', 'overdue', 'suspended', 'returned']) test(`another ${status} rental still holds the device`, async t => {
  const { sqlite, context } = await setup(t)
  sqlite.prepare("INSERT INTO orders (id, userId, deviceId, rentalPeriod, totalAmount, depositAmount, status, is_manual) VALUES ('other-rental', 'release-customer', 'release-device', 0, 0, 0, ?, 1)").run(status)
  await updateOrderStatus(context, 'release-order', 'completed')
  assert.equal(sqlite.prepare("SELECT status FROM devices WHERE id = 'release-device'").get()?.status, 'rented')
})

for (const lifecycle of ['DAMAGED', 'MAINTENANCE', 'RETIRED']) test(`automatic release preserves ${lifecycle} devices`, async t => {
  const { sqlite, context } = await setup(t)
  sqlite.exec("UPDATE orders SET status = 'completed'")
  sqlite.prepare('UPDATE devices SET lifecycle_status = ?').run(lifecycle)
  const before = sqlite.prepare("SELECT status, lifecycle_status FROM devices WHERE id = 'release-device'").get()
  await releaseDeviceIfUnbooked(context, 'release-device')
  assert.deepEqual(sqlite.prepare("SELECT status, lifecycle_status FROM devices WHERE id = 'release-device'").get(), before)
})

test('automatic release waits for unfinished maintenance', async t => {
  const { sqlite, context } = await setup(t)
  sqlite.exec("UPDATE orders SET status = 'completed'; UPDATE devices SET lifecycle_status = 'INSPECTION'; INSERT INTO maintenance_records (id, device_id, maintenance_type, status, description, created_by) VALUES ('maintenance', 'release-device', 'REPAIR', 'OPEN', '维修', 'release-admin')")
  await releaseDeviceIfUnbooked(context, 'release-device')
  assert.equal(sqlite.prepare("SELECT lifecycle_status FROM devices WHERE id = 'release-device'").get()?.lifecycle_status, 'INSPECTION')
})

test('completed repairs open the manual listing page and remain unavailable until confirmed', async t => {
  const { sqlite, request } = await setup(t)
  sqlite.exec("UPDATE orders SET status = 'completed'; UPDATE devices SET lifecycle_status = 'MAINTENANCE', device_mode = 'maintenance'; INSERT INTO maintenance_records (id, device_id, maintenance_type, status, description, created_by) VALUES ('repair', 'release-device', 'REPAIR', 'CLIENT_CHECK', '维修', 'release-admin')")
  assert.equal((await request('/admin/maintenance/repair/advance', {})).status, 409)
  for (const check of MAINTENANCE_CHECK_TYPES) sqlite.prepare('INSERT INTO maintenance_preparation_checks (id, maintenance_id, check_type, passed, verified_by) VALUES (?, ?, ?, 1, ?)').run(`check-${check}`, 'repair', check, 'release-admin')
  const completed = await request('/admin/maintenance/repair/advance', {})
  assert.equal(completed.status, 303)
  assert.equal(completed.headers.get('location'), '/admin/devices/release-device/relist')
  assert.equal(sqlite.prepare('SELECT status FROM maintenance_records').get()?.status, 'COMPLETED')
  assert.equal(sqlite.prepare("SELECT status FROM devices WHERE id = 'release-device'").get()?.status, 'maintenance', 'after repair completion')
  assert.equal(sqlite.prepare("SELECT lifecycle_status FROM devices WHERE id = 'release-device'").get()?.lifecycle_status, 'MAINTENANCE')
  const queue = await request('/admin/devices/relist', {}, 'GET')
  assert.equal(queue.status, 200)
  const queueHtml = await queue.text()
  assert.match(queueHtml, /href="\/admin\/devices\/release-device\/relist">上架<\/a>/)
  assert.match(queueHtml, /<summary>设备管理[\s\S]*?href="\/admin\/devices\/relist"[\s\S]*?设备上架/)
  const html = renderAdminDevices({ id: 'release-admin', role: 'ADMIN' }, [{ id: 'release-device', name: '电脑', status: 'maintenance', lifecycleStatus: 'MAINTENANCE' }])
  assert.match(html, /href="\/admin\/devices\/release-device\/relist">上架<\/a>/)
  const page = await request('/admin/devices/release-device/relist', {}, 'GET')
  assert.equal(page.status, 200)
  const pageHtml = await page.text()
  assert.match(pageHtml, /维修完成/)
  assert.match(pageHtml, />确认上架<\/button>/)
  assert.equal(sqlite.prepare("SELECT status FROM devices WHERE id = 'release-device'").get()?.status, 'maintenance', 'after listing GET')
  assert.equal((await request('/admin/devices/release-device/relist', {})).status, 303)
  assert.equal(sqlite.prepare("SELECT lifecycle_status FROM devices WHERE id = 'release-device'").get()?.lifecycle_status, 'READY')
  assert.equal(sqlite.prepare("SELECT status FROM devices WHERE id = 'release-device'").get()?.status, 'available')
  assert.equal(sqlite.prepare("SELECT device_mode FROM devices WHERE id = 'release-device'").get()?.device_mode, 'normal')
  assert.doesNotMatch(await (await request('/admin/devices/relist', {}, 'GET')).text(), /href="\/admin\/devices\/release-device\/relist"/)
  assert.equal((await request('/admin/devices/release-device/relist', {})).status, 409)
})

for (const maintenanceType of ['REPAIR', 'RETURN_PREPARATION']) test(`agent completion preserves the listing flow for ${maintenanceType}`, async t => {
  const { sqlite, context } = await setup(t)
  sqlite.exec("UPDATE orders SET status = 'completed'; UPDATE devices SET lifecycle_status = 'MAINTENANCE', status = 'maintenance', device_mode = 'maintenance' WHERE id = 'release-device'")
  sqlite.prepare("UPDATE devices SET agent_token_hash = ? WHERE id = 'release-device'").run(createHash('sha256').update('repair-agent-token').digest('hex'))
  sqlite.prepare("INSERT INTO maintenance_records (id, device_id, maintenance_type, status, description, created_by) VALUES ('repair', 'release-device', ?, 'CLIENT_CHECK', '维修', 'release-admin')").run(maintenanceType)
  for (const check of MAINTENANCE_CHECK_TYPES) sqlite.prepare('INSERT INTO maintenance_preparation_checks (id, maintenance_id, check_type, passed, verified_by) VALUES (?, ?, ?, 1, ?)').run(`check-${check}`, 'repair', check, 'release-admin')
  sqlite.exec("INSERT INTO device_commands (id, device_id, command_type, payload, status, created_by, expires_at) VALUES ('repair-command', 'release-device', 'CHECK_UPDATE', '{}', 'SENT', 'release-admin', datetime('now', '+1 day'))")
  const response = await worker.fetch(new Request('https://rent.example.test/api/device-agent/command-results', {
    method: 'POST', headers: { Authorization: 'Bearer repair-agent-token', 'Content-Type': 'application/json' },
    body: JSON.stringify({ commandId: 'repair-command', success: true, resultCode: 'OK' }),
  }), context.env, { waitUntil() {} } as any)
  assert.equal(response.status, 200, await response.text())
  assert.equal(sqlite.prepare("SELECT status FROM maintenance_records WHERE id = 'repair'").get()?.status, 'COMPLETED')
  assert.equal(sqlite.prepare("SELECT lifecycle_status FROM devices WHERE id = 'release-device'").get()?.lifecycle_status, maintenanceType === 'REPAIR' ? 'MAINTENANCE' : 'READY')
  assert.equal(sqlite.prepare("SELECT status FROM devices WHERE id = 'release-device'").get()?.status, maintenanceType === 'REPAIR' ? 'maintenance' : 'available')
})

for (const scenario of ['open', 'failed', 'active-rental', 'unauthorized', 'retired']) test(`manual listing rejects ${scenario}`, async t => {
  const { sqlite, request } = await setup(t)
  sqlite.exec("UPDATE orders SET status = 'completed'; UPDATE devices SET lifecycle_status = 'MAINTENANCE'; INSERT INTO maintenance_records (id, device_id, maintenance_type, status, description, created_by) VALUES ('repair', 'release-device', 'REPAIR', 'COMPLETED', '维修', 'release-admin')")
  if (scenario === 'open') sqlite.exec("UPDATE maintenance_records SET status = 'CLIENT_CHECK'")
  if (scenario === 'failed') sqlite.exec("UPDATE maintenance_records SET status = 'FAILED'")
  if (scenario === 'active-rental') sqlite.exec("UPDATE orders SET status = 'active'")
  if (scenario === 'unauthorized') sqlite.exec("UPDATE users SET role = 'CUSTOMER' WHERE id = 'release-admin'")
  if (scenario === 'retired') sqlite.exec("UPDATE devices SET lifecycle_status = 'RETIRED'")
  const before = sqlite.prepare("SELECT status, lifecycle_status FROM devices WHERE id = 'release-device'").get()
  const queue = await request('/admin/devices/relist', {}, 'GET')
  assert.equal(queue.status, scenario === 'unauthorized' ? 403 : 200)
  assert.doesNotMatch(await queue.text(), /href="\/admin\/devices\/release-device\/relist"/)
  const page = await request('/admin/devices/release-device/relist', {}, 'GET')
  assert.equal(page.status, scenario === 'unauthorized' ? 403 : 200)
  assert.doesNotMatch(await page.text(), />确认上架<\/button>/)
  assert.equal((await request('/admin/devices/release-device/relist', {})).status, scenario === 'unauthorized' ? 403 : 409)
  assert.deepEqual(sqlite.prepare("SELECT status, lifecycle_status FROM devices WHERE id = 'release-device'").get(), before)
})

for (const scenario of ['normal', 'active-rental', 'maintenance', 'damage', 'missing-inspection', 'latest-damage', 'deleted-inspection']) test(`historical return migration handles ${scenario}`, async t => {
  const { sqlite } = await setup(t)
  sqlite.exec("UPDATE orders SET status = 'completed'; UPDATE devices SET lifecycle_status = 'RETURNED'; INSERT INTO device_inspections (id, device_id, rental_id, inspection_type, snapshot_json) VALUES ('return-check', 'release-device', 'release-order', 'after_return', '{\"damageDescription\":\"\"}')")
  if (scenario === 'active-rental') sqlite.exec("INSERT INTO orders (id, userId, deviceId, status, rentalPeriod, totalAmount, depositAmount, is_manual) VALUES ('other', 'release-customer', 'release-device', 'active', 1, 220, 200, 1)")
  if (scenario === 'maintenance') sqlite.exec("INSERT INTO maintenance_records (id, device_id, maintenance_type, status, description, created_by) VALUES ('maintenance', 'release-device', 'REPAIR', 'OPEN', '维修', 'release-admin')")
  if (scenario === 'damage') sqlite.exec("UPDATE device_inspections SET snapshot_json = '{\"damageDescription\":\"屏幕损坏\"}'")
  if (scenario === 'missing-inspection') sqlite.exec('DELETE FROM device_inspections')
  if (scenario === 'latest-damage') sqlite.exec("INSERT INTO device_inspections (id, device_id, rental_id, inspection_type, snapshot_json) VALUES ('latest-return', 'release-device', 'release-order', 'after_return', '{\"damageDescription\":\"屏幕损坏\"}')")
  if (scenario === 'deleted-inspection') sqlite.exec('UPDATE device_inspections SET deleted_at = CURRENT_TIMESTAMP')
  const migration = readFileSync(new URL('../migrations/0169_release_inspected_returned_devices.sql', import.meta.url), 'utf8')
  sqlite.exec(migration)
  sqlite.exec(migration)
  assert.equal(sqlite.prepare("SELECT lifecycle_status FROM devices WHERE id = 'release-device'").get()?.lifecycle_status, scenario === 'normal' ? 'READY' : 'RETURNED')
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM device_lifecycle_events WHERE id LIKE 'dle-auto-return-%'").get()?.count, scenario === 'normal' ? 1 : 0)
})
