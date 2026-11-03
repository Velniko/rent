/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { getCustomerRiskAssessment, getCustomerRiskLevels } from '../src/services/risk'
import { applyOrderRiskDeposit } from '../src/services/riskDeposit'

function setup(t: any) {
  const db = new DatabaseSync(':memory:')
  t.after(() => db.close())
  db.exec(`CREATE TABLE users (id TEXT, role TEXT, balance REAL, identity_status TEXT);
    INSERT INTO users VALUES ('customer', 'CUSTOMER', 0, 'VERIFIED');
    CREATE TABLE orders (id TEXT PRIMARY KEY, userId TEXT, status TEXT, payment_status TEXT, handover_overdue INTEGER DEFAULT 0, deposit_deduction_amount REAL DEFAULT 0, depositAmount REAL, totalAmount REAL, rental_pricing_json TEXT, deposit_status TEXT, discount_amount REAL DEFAULT 0, contractSigned INTEGER DEFAULT 0, updatedAt TEXT);
    CREATE TABLE payments (id TEXT, rental_id TEXT, customer_id TEXT, status TEXT, amount REAL);
    CREATE TABLE payment_refunds (order_id TEXT, status TEXT, refund_amount REAL, type TEXT);
    CREATE TABLE damage_cases (order_id TEXT, liability_status TEXT);
    CREATE TABLE risk_flags (customer_id TEXT, flag_type TEXT, severity TEXT, status TEXT, expires_at TEXT, created_at TEXT);`)
  const c: any = { env: { RENT: { prepare(sql: string) {
    let values: any[] = []
    return { bind(...args: any[]) { values = args; return this },
      async first() { return db.prepare(sql).get(...values) || null },
      async all() { return { results: db.prepare(sql).all(...values) } },
      async run() { const result = db.prepare(sql).run(...values); return { meta: { changes: result.changes } } } }
  } } } }
  function completed(count: number) {
    for (let i = 0; i < count; i++) db.prepare("INSERT INTO orders (id, userId, status, payment_status) VALUES (?, 'customer', 'completed', 'PAID')").run('history-' + i)
  }
  return { db, c, completed }
}

test('list and individual ratings agree; normal deposit returns do not hurt good customers', async t => {
  const { db, c, completed } = setup(t)
  completed(5)
  db.exec("INSERT INTO payments VALUES ('payment', 'history-0', 'customer', 'paid', 600); INSERT INTO payment_refunds VALUES ('history-0', 'succeeded', 500, 'deposit')")
  const risk = await getCustomerRiskAssessment(c, 'customer')
  assert.equal(risk.level, 'VERY_LOW')
  assert.equal(risk.score, 0)
  assert.deepEqual((await getCustomerRiskLevels(c, ['customer'])).get('customer'), risk)
  db.exec("INSERT INTO payment_refunds VALUES ('history-0', 'succeeded', 300, 'cancellation')")
  assert.equal((await getCustomerRiskAssessment(c, 'customer')).score, 25)
  assert.equal((await getCustomerRiskAssessment(c, 'missing')).blocked, true)
})

test('unpaid and overdue completed orders cannot earn reduced deposits', async t => {
  const { db, c, completed } = setup(t)
  completed(2)
  assert.equal((await getCustomerRiskAssessment(c, 'customer')).level, 'LOW')
  db.exec("UPDATE orders SET payment_status = 'PENDING' WHERE id = 'history-0'")
  assert.equal((await getCustomerRiskAssessment(c, 'customer')).level, 'NORMAL')
  db.exec("UPDATE orders SET payment_status = 'PAID', handover_overdue = 1 WHERE id = 'history-0'")
  assert.equal((await getCustomerRiskAssessment(c, 'customer')).level, 'NORMAL')
})

test('unsigned contract deposit is adjusted once and remains frozen after risk changes', async t => {
  const { db, c, completed } = setup(t)
  completed(2)
  db.exec(`INSERT INTO orders (id, userId, status, depositAmount, totalAmount, rental_pricing_json) VALUES ('new', 'staff', 'draft', 300, 500, '{"baseDepositAmount":300}')`)
  const order: any = { ...db.prepare("SELECT * FROM orders WHERE id = 'new'").get(), rentalPeriod: 7 }
  await applyOrderRiskDeposit(c, order, 'customer')
  assert.equal(order.depositAmount, 150)
  assert.equal(order.totalAmount, 350)
  assert.equal(JSON.parse(order.rental_pricing_json).baseDepositAmount, 300)
  db.exec("UPDATE users SET balance = -1")
  await applyOrderRiskDeposit(c, order, 'customer')
  assert.equal(order.depositAmount, 150)
  assert.equal(db.prepare("SELECT totalAmount FROM orders WHERE id = 'new'").get()!.totalAmount, 350)
})

test('paid contracts keep their historical deposit', async t => {
  const { db, c } = setup(t)
  db.exec("INSERT INTO payments VALUES ('paid', 'new', 'customer', 'paid', 500)")
  const order: any = { id: 'new', status: 'pending_payment', depositAmount: 300, totalAmount: 500 }
  await applyOrderRiskDeposit(c, order, 'customer')
  assert.equal(order.depositAmount, 300)
  assert.equal(order.rental_pricing_json, undefined)
})


test('deposit-scoped coupons are repriced before the customer confirms the deposit', async t => {
  const { db, c, completed } = setup(t)
  completed(2)
  db.exec(`ALTER TABLE orders ADD COLUMN deviceId TEXT;
    ALTER TABLE orders ADD COLUMN coupon_code TEXT;
    CREATE TABLE devices (id TEXT, pricePerDay REAL, depositAmount REAL, deleted_at TEXT);
    INSERT INTO devices VALUES ('device', 20, 300, NULL);
    CREATE TABLE coupons (code TEXT, deleted_at TEXT, active INTEGER, starts_at TEXT, expires_at TEXT, max_uses INTEGER, used_count INTEGER, discount_type TEXT, discount_value REAL, applicable_components TEXT);
    INSERT INTO coupons VALUES ('HALF', NULL, 1, NULL, NULL, NULL, 0, 'percent', 50, 'DEPOSIT_FEE');
    INSERT INTO orders (id, userId, status, depositAmount, totalAmount, discount_amount, deviceId, coupon_code) VALUES ('new', 'staff', 'draft', 300, 290, 150, 'device', 'HALF')`)
  const order: any = { ...db.prepare("SELECT * FROM orders WHERE id='new'").get(), rentalPeriod: 7 }
  await applyOrderRiskDeposit(c, order, 'customer')
  assert.equal(order.depositAmount, 150)
  assert.equal(order.discount_amount, 75)
  assert.equal(order.totalAmount, 215)
})
