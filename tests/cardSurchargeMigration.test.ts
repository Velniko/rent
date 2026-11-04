/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync, readdirSync } from 'node:fs'
import { URL } from 'node:url'

test('card surcharge migration changes future unlinked installments and preserves issued payment quotes', t => {
  const db = new DatabaseSync(':memory:')
  t.after(() => db.close())
  const directory = new URL('../migrations/', import.meta.url)
  const name = '0180_disable_card_payment_surcharges.sql'
  for (const file of readdirSync(directory).filter(file => file.endsWith('.sql') && file < name).sort()) db.exec(readFileSync(new URL(file, directory), 'utf8'))
  db.exec(`UPDATE systemSettings SET value = '{"stripe":true,"bankTransfer":true,"processingFeeRate":0.025,"squareProcessingFeeRate":0.022}' WHERE key = 'paymentMethods';
    INSERT INTO users (id, name, email, role) VALUES ('fee-customer', '客户', 'fees@example.test', 'CUSTOMER');
    INSERT INTO devices (id, name, model, pricePerDay, depositAmount, serialNumber, status) VALUES ('fee-device', '电脑', 'Test', 20, 100, 'FEE-SN', 'available');
    INSERT INTO orders (id, userId, deviceId, startDate, endDate, rentalPeriod, totalAmount, depositAmount, status) VALUES ('fee-order', 'fee-customer', 'fee-device', '2026-01-01', '2026-04-01', 90, 300, 0, 'active');
    INSERT INTO payments (id, rental_id, customer_id, payment_method, amount, rental_amount, deposit_amount, processing_fee, status, stripe_payment_intent_id) VALUES
      ('paid-fee', 'fee-order', 'fee-customer', 'card', 102.5, 100, 0, 2.5, 'paid', 'pi_paid'),
      ('pending-fee', 'fee-order', 'fee-customer', 'card', 102.5, 100, 0, 2.5, 'pending', 'pi_pending');
    INSERT INTO rental_installments (id, order_id, installment_number, due_date, period_end, rental_amount, processing_fee, amount, status, payment_id) VALUES
      ('paid', 'fee-order', 1, '2026-01-01', '2026-01-31', 100, 2.5, 102.5, 'paid', 'paid-fee'),
      ('issued', 'fee-order', 2, '2026-01-31', '2026-03-02', 100, 2.5, 102.5, 'pending', 'pending-fee'),
      ('future', 'fee-order', 3, '2026-03-02', '2026-04-01', 100, 2.5, 102.5, 'pending', NULL);`)
  const payments = db.prepare('SELECT * FROM payments ORDER BY id').all()
  const migration = readFileSync(new URL(name, directory), 'utf8')
  db.exec(migration)
  const settings = JSON.parse(String(db.prepare("SELECT value FROM systemSettings WHERE key = 'paymentMethods'").get()?.value))
  assert.deepEqual(settings, { stripe: true, bankTransfer: true, processingFeeRate: 0, squareProcessingFeeRate: 0.022 })
  assert.deepEqual(db.prepare('SELECT * FROM payments ORDER BY id').all(), payments)
  assert.equal(db.prepare("SELECT amount FROM rental_installments WHERE id = 'paid'").get()?.amount, 102.5)
  assert.equal(db.prepare("SELECT processing_fee FROM rental_installments WHERE id = 'issued'").get()?.processing_fee, 2.5)
  assert.equal(db.prepare("SELECT amount FROM rental_installments WHERE id = 'future'").get()?.amount, 100)
  assert.equal(db.prepare("SELECT processing_fee FROM rental_installments WHERE id = 'future'").get()?.processing_fee, 0)
  db.exec(migration)
  assert.equal(db.prepare("SELECT amount FROM rental_installments WHERE id = 'future'").get()?.amount, 100)
})
