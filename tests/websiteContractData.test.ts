/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync, readdirSync } from 'node:fs'
import { URL } from 'node:url'
import { ensureContractForOrder, getContractVariableData, getOrderById, insertOrder, renderContractVariables } from '../src/site'

const template = '{pickup_time}|{return_time}|{return_method}|{return_date}|{pickup_location}|{return_location}'
const contract = { id: 'contract', rentalId: 'order', contractNumber: 'CN1', content: template, signedAt: null, status: 'pending_sign' } as any

async function setup(t: any) {
  const sqlite = new DatabaseSync(':memory:')
  t.after(() => sqlite.close())
  for (const name of readdirSync(new URL('../migrations/', import.meta.url)).filter(name => name.endsWith('.sql')).sort()) {
    sqlite.exec(readFileSync(new URL(`../migrations/${name}`, import.meta.url), 'utf8'))
  }
  sqlite.exec("INSERT INTO users (id, name, email, role, phone) VALUES ('customer', '客户', 'customer@example.test', 'CUSTOMER', '0412345678'); INSERT INTO devices (id, name, model, serialNumber, pricePerDay, depositAmount, status) VALUES ('device', '电脑', 'Test', 'SN1', 30, 200, 'available');")
  const db = {
    prepare(sql: string) {
      let values: any[] = []
      const statement = {
        bind(...args: any[]) { values = args; return statement },
        async first() { return sqlite.prepare(sql).get(...values) || null },
        async all() { return { results: sqlite.prepare(sql).all(...values) } },
        async run() { return { meta: { changes: Number(sqlite.prepare(sql).run(...values).changes) } } },
      }
      return statement
    },
  }
  const c = { env: { RENT: db }, req: { url: 'https://rent.example.test/admin/order-review' } } as any
  await insertOrder(c, {
    id: 'order', orderNo: 'OD1', userId: 'customer', deviceId: 'device',
    startDate: '2090-10-31', endDate: '2090-11-01', rentalPeriod: 1, status: 'approved',
    paymentMethod: 'card', totalAmount: 230, depositAmount: 200, dailyRate: 30, contractId: '', signedAt: null,
    pickupTimeSlot: 'morning', returnTimeSlot: 'afternoon', pickupLocation: '门店', returnLocation: '到店归还',
    deliveryMethod: 'Pickup', createdAt: new Date().toISOString(),
  })
  return { sqlite, c }
}

test('website order pickup and return selections reach the generated contract', async t => {
  const { sqlite, c } = await setup(t)
  const order = (await getOrderById(c, 'order'))!
  const generated = await ensureContractForOrder(c, order)
  const data = await getContractVariableData(c, generated, order)
  assert.equal(renderContractVariables(template, generated, order, {}, {}, data), '9:00–12:00|13:00–20:00|StoreReturn|2090-11-01|门店|到店归还')
  // 约定归还日期不应被当成已经归还，也不应产生逾期费用。
  assert.equal(data.return_status, '')
  assert.equal(data.late_days, 0)
  assert.equal(data.return_date, undefined)
  assert.equal(sqlite.prepare('SELECT contractId FROM orders WHERE id = ?').get('order')?.contractId, generated.id)
})

test('contract payment fields use the successful Stripe payment and Melbourne time', async t => {
  const { sqlite, c } = await setup(t)
  sqlite.exec(`INSERT INTO payments (id, rental_id, customer_id, payment_method, amount, rental_amount, deposit_amount, status, paid_at, stripe_payment_intent_id, transaction_id)
    VALUES ('paid', 'order', 'customer', 'card', 230, 30, 200, 'paid', '2026-10-30 14:15:00', 'pi_paid', 'TXN-local'),
           ('pending', 'order', 'customer', 'card', 230, 30, 200, 'pending', NULL, 'pi_pending', NULL);
    UPDATE payments SET created_at = '2090-01-01' WHERE id = 'pending';`)
  const order = (await getOrderById(c, 'order'))!
  const data = await getContractVariableData(c, contract, order)
  assert.equal(data.payment_reference, 'pi_paid')
  assert.equal(data.payment_date, '2026-10-31 01:15')
  assert.equal(renderContractVariables('{payment_date}|{payment_reference}', contract, order, {}, {}, data), '2026-10-31 01:15|pi_paid')
})

test('confirmed authorization supplies its reference without a paid date or paid amounts', async t => {
  const { sqlite, c } = await setup(t)
  sqlite.exec(`INSERT INTO payments (id, rental_id, customer_id, payment_method, amount, rental_amount, deposit_amount, status, stripe_payment_intent_id)
    VALUES ('auth', 'order', 'customer', 'card', 230, 30, 200, 'pending', 'pi_auth');`)
  let order = (await getOrderById(c, 'order'))!
  const pending = await getContractVariableData(c, contract, order)
  assert.equal(pending.payment_reference, '')
  assert.equal(pending.payment_date, '')
  sqlite.exec("UPDATE orders SET deposit_status = 'HELD', stripe_deposit_payment_intent_id = 'pi_auth' WHERE id = 'order'")
  order = (await getOrderById(c, 'order'))!
  const authorized = await getContractVariableData(c, contract, order)
  assert.equal(authorized.payment_reference, 'pi_auth')
  assert.equal(authorized.payment_date, '')
  assert.equal(authorized.rent_paid, '0.00')
  assert.equal(authorized.deposit_paid, '0.00')
  assert.equal(authorized.amount_due, '230.00')
  assert.equal(renderContractVariables('{payment_date}|{payment_reference}', contract, order, {}, {}, authorized), 'N/A|pi_auth')
})

test('bank transfer references still use approved payment proofs', async t => {
  const { sqlite, c } = await setup(t)
  sqlite.exec(`INSERT INTO payments (id, rental_id, customer_id, payment_method, amount, rental_amount, deposit_amount, status, paid_at, transaction_id)
    VALUES ('bank', 'order', 'customer', 'bank_transfer', 230, 30, 200, 'paid', '2026-10-30 14:15:00', 'TXN-local');
    INSERT INTO payment_proofs (id, payment_id, reference_number, status) VALUES ('proof', 'bank', 'BANK-REFERENCE', 'approved'), ('rejected', 'bank', 'REJECTED', 'rejected');`)
  const data = await getContractVariableData(c, contract, (await getOrderById(c, 'order'))!)
  assert.equal(data.payment_reference, 'BANK-REFERENCE')
  assert.equal(data.payment_date, '2026-10-31 01:15')
})

test('existing contracts with missing arrangements use saved order values', () => {
  const order = { pickup_time_slot: '07:30', return_time_slot: '18:00', end_date: '2090-11-01', pickup_location: '门店', return_location: '到店归还' }
  const existing = { ...contract, contract_data: JSON.stringify({ pickup_time: '', return_time: '', return_method: '' }) }
  assert.equal(renderContractVariables(template, existing, order), '07:30|18:00|StoreReturn|2090-11-01|门店|到店归还')
})

test('delivery slots render as time ranges and explicit contract arrangements are preserved', () => {
  const order = { pickupTimeSlot: 'delivery_morning', returnTimeSlot: 'delivery_afternoon', deliveryMethod: 'Delivery', returnLocation: '到店归还', endDate: '2090-11-01' }
  assert.equal(renderContractVariables('{pickup_time}|{return_time}|{return_method}', contract, order), '9:00–12:00|13:00–19:00|StoreReturn')
  const stored = { ...contract, contract_data: { pickup_time: '10:30', return_time: '16:30', return_method: 'CourierPickup', return_date: '2090-11-02' } }
  assert.equal(renderContractVariables('{pickup_time}|{return_time}|{return_method}|{return_date}', stored, order), '10:30|16:30|CourierPickup|2090-11-02')
  assert.equal(renderContractVariables('{pickup_time}|{return_time}', contract, { pickupTimeSlot: 'morning_service', returnTimeSlot: 'evening_service' }), '7:00–8:00|21:00–23:00')
})
