/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

import test from 'node:test'
import assert from 'node:assert/strict'
import { isMonthlyRental } from '../src/domain/monthlyRental'

test('explicit full-payment rentals never enter monthly collection', () => {
  for (const days of [1, 7, 30, 59, 60, 90, 120, 365]) {
    assert.equal(isMonthlyRental({ billing_mode: 'FULL', rentalPeriod: days, payment_provider: 'stripe', rental_pricing_json: JSON.stringify({ billingMode: 'FULL', pricePerDay: 25 }) }), false)
  }
})

test('monthly choices and legacy long rentals retain monthly billing', () => {
  assert.equal(isMonthlyRental({ billing_mode: 'MONTHLY', rentalPeriod: 120 }), true)
  for (const snapshot of [undefined, null, '{}', '{"pricePerDay":25}', 'invalid']) {
    assert.equal(isMonthlyRental({ billing_mode: 'FULL', rentalPeriod: 120, rental_pricing_json: snapshot }), true)
  }
  for (const days of [7,30,59]) assert.equal(isMonthlyRental({ billing_mode: 'FULL', rentalPeriod: days }), false)
  assert.equal(isMonthlyRental({ billing_mode: 'FULL', rentalPeriod: 60 }), true)
  // Already-established monthly plans retain their historical schedule.
  assert.equal(isMonthlyRental({ billing_mode: 'MONTHLY', rentalPeriod: 30 }), true)
  assert.equal(isMonthlyRental({ billing_mode: 'FULL', rentalPeriod: 120, payment_provider: 'square' }), false)
})
