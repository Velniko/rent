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
import worker from '../src/index'
import { createAuthSession } from '../src/site'
import { renderAdminRefunds } from '../src/pages/admin/refunds'
import { getAdminDashboardData } from '../src/services/adminDashboard'

async function setup(t: any, status: string, withPayment = false) {
  const sqlite = new DatabaseSync(':memory:')
  t.after(() => sqlite.close())
  for (const name of readdirSync(new URL('../migrations/', import.meta.url)).filter(name => name.endsWith('.sql')).sort()) sqlite.exec(readFileSync(new URL(`../migrations/${name}`, import.meta.url), 'utf8'))
  sqlite.exec("INSERT INTO users (id, name, email, role, balance) VALUES ('ignore-customer', '客户', 'ignore-customer@example.test', 'CUSTOMER', 12), ('ignore-admin', '管理员', 'ignore-admin@example.test', 'ADMIN', 0)")
  sqlite.exec("INSERT INTO devices (id, name, model, pricePerDay, depositAmount, serialNumber, status) VALUES ('ignore-device', '电脑', 'Test', 20, 100, 'IGNORE-SN', 'available')")
  sqlite.prepare("INSERT INTO orders (id, userId, deviceId, startDate, endDate, rentalPeriod, totalAmount, depositAmount, status, paymentMethod, deposit_status, settlement_status, refundMethod) VALUES ('ignore-order', 'ignore-customer', 'ignore-device', '2090-01-01', '2090-01-07', 6, 220, 100, ?, 'balance', 'HELD', 'PENDING', 'balance')").run(status)
  if (withPayment) sqlite.exec("INSERT INTO payments (id, rental_id, customer_id, payment_method, amount, deposit_amount, rental_amount, status) VALUES ('ignore-payment', 'ignore-order', 'ignore-customer', 'balance', 220, 100, 120, 'paid')")
  const db = {
    prepare(sql: string) {
      let values: any[] = []
      const statement = {
        bind(...input: any[]) { values = input; return statement },
        async first() { return sqlite.prepare(sql).get(...values) || null },
        async all() { return { results: sqlite.prepare(sql).all(...values) } },
        async run() { return { success: true, meta: { changes: Number(sqlite.prepare(sql).run(...values).changes) } } },
      }
      return statement
    },
    async batch(statements: any[]) { return Promise.all(statements.map(statement => statement.run())) },
  }
  const env = { RENT: db }
  const session = await createAuthSession({ env } as any, 'ignore-admin')
  const ignore = () => worker.fetch(new Request('https://rent.example.test/admin/orders/ignore-order/ignore-refund', {
    method: 'POST', body: new URLSearchParams({ note: '已核对，无需退款' }),
    headers: { Cookie: `session=${session.token}`, Origin: 'https://rent.example.test', 'Sec-Fetch-Site': 'same-origin' },
  }), env, { waitUntil() {} } as any)
  const app = new Hono()
  app.get('/', async c => c.html(await renderAdminRefunds(c, { id: 'ignore-admin', role: 'ADMIN' })))
  const queue = async () => (await app.request('https://rent.example.test/', {}, env)).text()
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('Ignoring a refund must not make an external request') })
  return { sqlite, ignore, queue, env }
}

for (const status of ['completed', 'cancelled']) {
  for (const withPayment of [false, true]) {
    test(`${status} refund can be ignored ${withPayment ? 'with' : 'without'} a payment without creating financial records`, async t => {
      const { sqlite, ignore, queue, env } = await setup(t, status, withPayment)
      const pendingBefore = (await getAdminDashboardData({ env } as any)).stats.pendingDeposits
      assert.match(await queue(), /action="\/admin\/orders\/ignore-order\/ignore-refund"/)
      const response = await ignore()
      assert.equal(response.status, 302, await response.text())
      assert.equal(response.headers.get('location'), '/admin/refunds')
      const order = sqlite.prepare("SELECT * FROM orders WHERE id = 'ignore-order'").get()!
      assert.ok(order.refund_ignored_at)
      assert.equal(order.refund_ignored_by, 'ignore-admin')
      assert.equal(order.refund_ignore_reason, '已核对，无需退款')
      assert.equal(order.status, status)
      assert.equal(order.deposit_status, 'HELD')
      assert.equal(order.settlement_status, 'PENDING')
      assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM payment_refunds WHERE order_id = 'ignore-order'").get()?.count, 0)
      assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM payments WHERE rental_id = 'ignore-order'").get()?.count, withPayment ? 1 : 0)
      if (withPayment) assert.equal(sqlite.prepare("SELECT status FROM payments WHERE id = 'ignore-payment'").get()?.status, 'paid')
      assert.equal(sqlite.prepare("SELECT balance FROM users WHERE id = 'ignore-customer'").get()?.balance, 12)
      const audit = sqlite.prepare("SELECT * FROM audit_logs WHERE target_id = 'ignore-order' AND action = 'REFUND_IGNORED'").all()
      assert.equal(audit.length, 1)
      assert.equal(audit[0].actor_id, 'ignore-admin')
      assert.equal(audit[0].reason, '已核对，无需退款')
      assert.doesNotMatch(await queue(), /action="\/admin\/orders\/ignore-order\/ignore-refund"/)
      assert.equal((await getAdminDashboardData({ env } as any)).stats.pendingDeposits, pendingBefore - 1)
      assert.equal((await ignore()).status, 409)
      assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE target_id = 'ignore-order' AND action = 'REFUND_IGNORED'").get()?.count, 1)
    })
  }
}

test('ignoring an order with an already completed refund is rejected', async t => {
  const { sqlite, ignore } = await setup(t, 'cancelled', true)
  sqlite.exec("INSERT INTO payment_refunds (id, order_id, payment_id, type, refundable_amount, refund_amount, status, processed_by) VALUES ('existing-refund', 'ignore-order', 'ignore-payment', 'cancellation', 220, 220, 'succeeded', 'ignore-admin')")
  const response = await ignore()
  assert.equal(response.status, 409)
  assert.equal(await response.text(), '该订单已经处理过退款')
  assert.equal(sqlite.prepare("SELECT refund_ignored_at FROM orders WHERE id = 'ignore-order'").get()?.refund_ignored_at, null)
})

test('an active rental cannot be marked as an ignored refund', async t => {
  const { sqlite, ignore } = await setup(t, 'active')
  const response = await ignore()
  assert.equal(response.status, 409)
  assert.equal(await response.text(), '该订单没有待处理退款')
  assert.equal(sqlite.prepare("SELECT refund_ignored_at FROM orders WHERE id = 'ignore-order'").get()?.refund_ignored_at, null)
})

test('refund pagination excludes ignored orders from its total as well as its rows', async t => {
  const { sqlite, ignore, queue } = await setup(t, 'cancelled')
  sqlite.exec("DELETE FROM orders WHERE id <> 'ignore-order'")
  const insert = sqlite.prepare("INSERT INTO orders (id, userId, deviceId, startDate, endDate, rentalPeriod, totalAmount, depositAmount, status, paymentMethod) VALUES (?, 'ignore-customer', 'ignore-device', '2090-01-01', '2090-01-07', 6, 220, 100, 'cancelled', 'balance')")
  for (let i = 0; i < 12; i++) insert.run(`refund-pagination-${i}`)
  assert.match(await queue(), /共 13 条/)
  assert.equal((await ignore()).status, 302)
  assert.match(await queue(), /共 12 条/)
})
