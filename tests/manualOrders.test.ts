/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync, readdirSync } from 'node:fs'
import { URL } from 'node:url'
import { Hono } from 'hono'
import { parseManualOrder, canEditManualOrder } from '../src/domain/manualOrders'
import { registerOrderScanningRoutes } from '../src/routes/orderScanning'
import { registerReturnRoutes } from '../src/routes/returns'
import { saveAdminManualOrder } from '../src/actions/admin/manualOrders'
import { renderAdminOrderDetail } from '../src/pages/admin/orderDetail'
import { renderAdminManualOrder } from '../src/pages/admin/manualOrder'
import { ensureContractForOrder, getOrderById, runDataConsistencyChecks } from '../src/site'
import { extractInlineScripts } from './helpers'

const migrations = readdirSync(new URL('../migrations/', import.meta.url)).filter(name => name.endsWith('.sql')).sort()
const migrationSql = (name: string) => readFileSync(new URL(`../migrations/${name}`, import.meta.url), 'utf8')

function setup(role = 'ADMIN') {
  const sqlite = new DatabaseSync(':memory:')
  sqlite.exec('PRAGMA foreign_keys = OFF')
  for (const name of migrations) sqlite.exec(migrationSql(name))
  sqlite.exec("INSERT INTO devices (id, name, model, pricePerDay, depositAmount, serialNumber, status, lifecycle_status) VALUES ('d-1', '电脑一', 'Test', 30, 200, 'SN1', 'available', 'READY'), ('d-2', '电脑二', 'Test', 40, 300, 'SN2', 'available', 'READY'); INSERT INTO users (id, name, email, role) VALUES ('admin', '管理员', 'admin@example.test', 'ADMIN'), ('customer', '客户', 'customer@example.test', 'CUSTOMER');")
  sqlite.exec('PRAGMA foreign_keys = ON')
  const db = {
    prepare(sql: string) {
      let values: any[] = []
      const query = {
        bind(...input: any[]) { values = input; return query },
        async first() { return sqlite.prepare(sql).get(...values) || null },
        async all() { return { results: sqlite.prepare(sql).all(...values) } },
        async run() { const result = sqlite.prepare(sql).run(...values); return { success: true, meta: { changes: Number(result.changes) } } },
      }
      return query
    },
    async batch(statements: any[]) { return Promise.all(statements.map(statement => statement.run())) },
  }
  const app = new Hono<any>()
  app.use('*', async (c, next) => { c.set('user', role ? { id: 'admin', role } : null); await next() })
  registerOrderScanningRoutes(app)
  registerReturnRoutes(app)
  app.post('/admin/orders/new', c => saveAdminManualOrder(c))
  app.post('/admin/orders/:id/edit', c => saveAdminManualOrder(c, c.req.param('id')))
  app.get('/admin/orders/new', async c => c.html(await renderAdminManualOrder(c, c.get('user'))))
  app.get('/admin/orders/:id', async c => c.html(await renderAdminOrderDetail(c, c.get('user'), c.req.param('id'))))
  const request = (path: string, data?: Record<string, string>) => app.request(`https://example.test${path}`, data ? { method: 'POST', body: new URLSearchParams(data) } : {}, { RENT: db })
  return { sqlite, db, request }
}

test('device, full dates and pickup/return time slots are required; other fields are optional and malformed values are rejected', () => {
  assert.equal(parseManualOrder({}).error, '请选择设备')
  assert.equal(parseManualOrder({ deviceId: 'd-1' }).error, '请填写起租日期和归还日期')
  assert.equal(parseManualOrder({ deviceId: 'd-1', startDate: '2026-10-20' }).error, '请填写起租日期和归还日期')
  assert.equal(parseManualOrder({ deviceId: 'd-1', endDate: '2026-10-20' }).error, '请填写起租日期和归还日期')
  for (const fields of [
    { startDate: '2026-02-30', endDate: '2026-10-25' }, { startDate: 'invalid', endDate: '2026-10-25' },
    { startDate: '2026-10-20', endDate: '2026-10-19' }, { startDate: '2026-10-20', endDate: '2026-10-25' },
    { startDate: '2026-10-20', startPeriod: 'AM', endDate: '2026-10-25' },
    { startDate: '2026-10-20', startPeriod: 'PM', endDate: '2026-10-20', endPeriod: 'AM' },
    { startDate: '2026-10-20', startPeriod: 'AM', endDate: '2026-10-25', endPeriod: 'PM', rentalAmount: '-1' },
    { startDate: '2026-10-20', startPeriod: 'AM', endDate: '2026-10-25', endPeriod: 'PM', depositAmount: 'NaN' },
    { startDate: '2026-10-20', startPeriod: 'AM', endDate: '2026-10-25', endPeriod: 'PM', rentalAmount: '0.001' },
    { startDate: '2026-10-20', startPeriod: 'AM', endDate: '2026-10-25', endPeriod: 'PM', paymentMethod: 'invalid' },
    { startDate: '2026-10-20', startPeriod: 'AM', endDate: '2026-10-25', endPeriod: 'PM', status: 'paid' },
  ]) assert.ok(parseManualOrder({ deviceId: 'd-1', ...fields }).error)
  const parsed = parseManualOrder({ deviceId: 'd-1', startDate: '2026-10-20', startPeriod: 'AM', endDate: '2026-10-25', endPeriod: 'PM' })
  assert.ok(parsed.data)
  assert.equal(parsed.data.userId, null)
  assert.equal(parsed.data.startPeriod, 'AM')
  assert.equal(parsed.data.endPeriod, 'PM')
  assert.equal(parsed.data.totalAmount, 0)
  assert.equal(canEditManualOrder({ is_manual: 1, status: 'completed' }), false)
  assert.equal(canEditManualOrder({ is_manual: 1, status: 'cancelled' }), false)
})

test('admin can create with device+dates+time slots, edit optional fields, swap equipment and use the shared return workflow', async () => {
  const { sqlite, db, request } = setup()
  const created = await request('/admin/orders/new', { deviceId: 'd-1', startDate: '2026-10-10', startPeriod: 'AM', endDate: '2026-10-15', endPeriod: 'PM' })
  assert.equal(created.status, 303)
  const path = created.headers.get('location')!
  const id = path.split('/').at(-1)!
  const row = () => sqlite.prepare('SELECT * FROM orders WHERE id = ?').get(id) as any
  assert.equal(row().is_manual, 1)
  assert.equal(row().userId, null)
  assert.equal(row().startDate, '2026-10-10')
  assert.equal(row().contractId, null)
  assert.equal(row().payment_status, 'UNPAID')
  assert.equal(await runDataConsistencyChecks({ env: { RENT: db } } as any), 0)
  assert.equal(row().status, 'active')
  assert.equal(sqlite.prepare("SELECT status FROM devices WHERE id='d-1'").get()?.status, 'rented')
  const html = await (await request(path)).text()
  assert.match(html, /订单管理操作/)
  assert.match(html, /登记归还/)
  assert.match(html, new RegExp(`/admin/orders/${id}/edit`))
  assert.doesNotMatch(html, /#scan|合同签署流程/)
  for (const script of extractInlineScripts(html)) assert.doesNotThrow(() => new Function(script))
  const edited = await request(`${path}/edit`, { deviceId: 'd-2', userId: 'customer', startDate: '2026-10-20', startPeriod: 'AM', endDate: '2026-10-25', endPeriod: 'PM', rentalAmount: '120', depositAmount: '50', rentalNote: '<b>备注</b>' })
  assert.equal(edited.status, 303)
  assert.equal(row().userId, 'customer')
  assert.equal(row().totalAmount, 170)
  assert.equal(row().rentalNote, '备注')
  assert.equal(sqlite.prepare("SELECT status FROM devices WHERE id='d-1'").get()?.status, 'available')
  assert.equal(sqlite.prepare("SELECT status FROM devices WHERE id='d-2'").get()?.status, 'rented')
  // 不重新提供日期/时段时缺少必填项，编辑失败，原记录不变。
  assert.equal((await request(`${path}/edit`, { deviceId: 'd-2' })).status, 400)
  assert.equal(row().userId, 'customer')
  // 保留日期/时段，仅清空其余选填字段。
  assert.equal((await request(`${path}/edit`, { deviceId: 'd-2', startDate: '2026-10-20', startPeriod: 'AM', endDate: '2026-10-25', endPeriod: 'PM' })).status, 303)
  assert.equal(row().userId, null)
  assert.equal(row().totalAmount, 0)
  assert.equal((await request(`${path}/edit`, { deviceId: 'd-2', startDate: '2026-10-20', startPeriod: 'AM', endDate: '2026-10-25', endPeriod: 'PM', status: 'completed' })).status, 409)
  assert.equal((await request(`/staff/orders/${id}/inspection`, { damageFound: 'no' })).status, 409)
  assert.equal((await request(`/staff/orders/${id}/receive-return`, { received: '1' })).status, 303)
  assert.equal(row().status, 'pending_return')
  assert.equal((await request(`/staff/orders/${id}/inspection`, { damageFound: 'no' })).status, 302)
  assert.equal(row().status, 'completed')
  assert.ok(row().return_received_at)
  assert.equal(sqlite.prepare("SELECT status FROM devices WHERE id='d-2'").get()?.status, 'available')
  assert.equal((await request(`${path}/edit`, { deviceId: 'd-2', startDate: '2026-10-20', startPeriod: 'AM', endDate: '2026-10-25', endPeriod: 'PM', rentalAmount: '999' })).status, 409)
  assert.equal(row().totalAmount, 0)
  assert.doesNotMatch(await (await request(path)).text(), /保存修改/)
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM contracts').get()?.n, 0)
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM payments').get()?.n, 0)
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE action LIKE 'MANUAL_ORDER_%'").get()?.n, 3)
  const order = await getOrderById({ env: { RENT: db } } as any, id)
  await assert.rejects(() => ensureContractForOrder({ env: { RENT: db } } as any, order!), /手动订单无需创建合同/)
  sqlite.close()
})

test('creation rejects missing devices, unavailable devices, invalid customers, missing dates and conflicting bookings', async () => {
  const { sqlite, request } = setup()
  assert.equal((await request('/admin/orders/new', {})).status, 400)
  assert.equal((await request('/admin/orders/new', { deviceId: 'missing' })).status, 400)
  assert.equal((await request('/admin/orders/new', { deviceId: 'd-1', startDate: '2027-01-01', startPeriod: 'AM', endDate: '2027-01-05', endPeriod: 'PM', userId: 'admin' })).status, 400)
  assert.equal((await request('/admin/orders/new', { deviceId: 'd-1' })).status, 400)
  const first = await request('/admin/orders/new', { deviceId: 'd-1', startDate: '2027-01-01', startPeriod: 'AM', endDate: '2027-01-05', endPeriod: 'PM' })
  assert.equal(first.status, 303)
  assert.equal((await request('/admin/orders/new', { deviceId: 'd-1', startDate: '2027-01-01', startPeriod: 'AM', endDate: '2027-01-05', endPeriod: 'PM' })).status, 409)
  // 历史遗留的无日期手动订单（迁移前数据）仍会占用设备，阻止新订单创建。
  sqlite.exec("UPDATE devices SET status = 'available' WHERE id='d-1'")
  sqlite.exec("INSERT INTO orders (id, deviceId, is_manual, status, rentalPeriod, totalAmount, depositAmount, orderNo) VALUES ('legacy-undated', 'd-1', 1, 'active', 0, 0, 0, 'LEGACY1')")
  assert.equal((await request('/admin/orders/new', { deviceId: 'd-1', startDate: '2028-01-01', startPeriod: 'AM', endDate: '2028-01-05', endPeriod: 'PM' })).status, 409)
  sqlite.close()
})

test('device stays selectable for a new manual order once an earlier dated order has passed its rental period, even if it was never marked returned', async () => {
  const { sqlite, request } = setup()
  const created = await request('/admin/orders/new', { deviceId: 'd-1', startDate: '2026-01-01', startPeriod: 'AM', endDate: '2026-01-05', endPeriod: 'PM' })
  assert.equal(created.status, 303)
  assert.equal(sqlite.prepare("SELECT status FROM devices WHERE id='d-1'").get()?.status, 'rented')
  const second = await request('/admin/orders/new', { deviceId: 'd-1', startDate: '2026-02-01', startPeriod: 'AM', endDate: '2026-02-05', endPeriod: 'PM' })
  assert.equal(second.status, 303)
  sqlite.close()
})

test('filling in both dates requires a pickup/return time slot and blocks half-day collisions with other orders', async () => {
  const { sqlite, request } = setup()
  assert.equal((await request('/admin/orders/new', { deviceId: 'd-1', startDate: '2026-03-01', endDate: '2026-03-05' })).status, 400)
  assert.equal((await request('/admin/orders/new', { deviceId: 'd-1', startDate: '2026-03-01', startPeriod: 'AM', endDate: '2026-03-05' })).status, 400)
  assert.equal((await request('/admin/orders/new', { deviceId: 'd-1', startDate: '2026-03-01', startPeriod: 'PM', endDate: '2026-03-01', endPeriod: 'AM' })).status, 400)
  const first = await request('/admin/orders/new', { deviceId: 'd-1', startDate: '2026-03-01', startPeriod: 'AM', endDate: '2026-03-05', endPeriod: 'PM' })
  assert.equal(first.status, 303)
  // 新订单的取货时段恰好等于上一笔订单的归还时段（同一天下午），日期区间不重叠但半天时段冲突，应被拦截。
  assert.equal((await request('/admin/orders/new', { deviceId: 'd-1', startDate: '2026-03-05', startPeriod: 'PM', endDate: '2026-03-08', endPeriod: 'AM' })).status, 409)
  // 另一台设备同一天下午归还，与 d-1 无关，可以正常创建。
  assert.equal((await request('/admin/orders/new', { deviceId: 'd-2', startDate: '2026-03-05', startPeriod: 'PM', endDate: '2026-03-08', endPeriod: 'AM' })).status, 303)
  sqlite.close()
})

test('only admins can write manual orders and only the device is required in the form', async () => {
  for (const role of ['STAFF', 'CUSTOMER', '']) {
    const { sqlite, request } = setup(role)
    assert.equal((await request('/admin/orders/new', { deviceId: 'd-1' })).status, 403)
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM orders').get()?.n, 0)
    sqlite.close()
  }
  const { sqlite, request } = setup()
  const html = await (await request('/admin/orders/new')).text()
  const required = [...html.matchAll(/<(?:input|select|textarea)\b[^>]*\brequired\b[^>]*>/g)].map(match => match[0])
  assert.deepEqual(required.map(tag => tag.match(/name="(\w+)"/)?.[1]).sort(), ['deviceId', 'endDate', 'endPeriod', 'startDate', 'startPeriod'])
  sqlite.close()
})

test('migration preserves all existing order columns, data, indexes and triggers', () => {
  const sqlite = new DatabaseSync(':memory:')
  sqlite.exec('PRAGMA foreign_keys = OFF')
  for (const name of migrations.filter(name => name < '0159')) sqlite.exec(migrationSql(name))
  sqlite.exec("INSERT INTO users (id, name, email, role) VALUES ('c1', '客户', 'c1@example.test', 'CUSTOMER'); INSERT INTO devices (id, name, model, pricePerDay, depositAmount, serialNumber) VALUES ('d1', '电脑', 'Test', 30, 200, 'SN1');")
  sqlite.exec("INSERT INTO orders (id, userId, deviceId, startDate, endDate, rentalPeriod, totalAmount, depositAmount, status, payment_provider, square_gift_card_id, overdue_charge_total) VALUES ('old', 'c1', 'd1', '2026-01-01', '2026-01-02', 1, 123, 23, 'completed', 'stripe', 'gift', 25)")
  const before = sqlite.prepare('SELECT * FROM orders').get()
  const objects = () => sqlite.prepare("SELECT name, type FROM sqlite_master WHERE tbl_name='orders' AND type IN ('index','trigger') ORDER BY name").all()
  const oldObjects = objects()
  sqlite.exec('BEGIN; ' + migrationSql('0159_admin_manual_orders.sql') + ' COMMIT;')
  const { is_manual, ...after } = sqlite.prepare('SELECT * FROM orders').get()!
  assert.deepEqual(after, { ...before })
  assert.equal(is_manual, 0)
  assert.deepEqual(objects(), oldObjects)
  assert.throws(() => sqlite.exec("INSERT INTO orders (id, deviceId, rentalPeriod, totalAmount, depositAmount) VALUES ('bad', 'd1', 0, 0, 0)"), /CHECK constraint/)
  sqlite.close()
})

test('manual orders can select rented equipment outside existing rental dates and reject overlapping bookings', async () => {
  const { sqlite, request } = setup()
  sqlite.exec("INSERT INTO orders (id, userId, deviceId, startDate, endDate, rentalPeriod, totalAmount, depositAmount, status) VALUES ('existing', 'customer', 'd-1', '2026-10-01', '2026-10-05', 4, 120, 0, 'active'); UPDATE devices SET status='rented', lifecycle_status='RENTED' WHERE id='d-1'")
  const html = await (await request('/admin/orders/new')).text()
  assert.match(html, /value="d-1"/)
  assert.equal((await request('/admin/orders/new', { deviceId: 'd-1', startDate: '2026-10-02', endDate: '2026-10-04' })).status, 409)
  assert.equal((await request('/admin/orders/new', { deviceId: 'd-1', startDate: '2026-11-01', endDate: '2026-11-05' })).status, 303)
  assert.equal(sqlite.prepare("SELECT status FROM orders WHERE id='existing'").get()?.status, 'active')
  assert.equal((await request('/admin/orders/new', { deviceId: 'd-1', startDate: '2026-11-02', endDate: '2026-11-04' })).status, 409)
  sqlite.exec("UPDATE devices SET status='maintenance' WHERE id='d-2'")
  assert.doesNotMatch(await (await request('/admin/orders/new')).text(), /value="d-2"/)
  assert.equal((await request('/admin/orders/new', { deviceId: 'd-2', startDate: '2026-12-01', endDate: '2026-12-05' })).status, 409)
  sqlite.close()
})
