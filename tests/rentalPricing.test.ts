/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

import test from 'node:test'
import assert from 'node:assert/strict'
import { calculateRentalFee, parseDeviceDiscountPercent, rentalPriceBreakdown, rentalPricingClientScript } from '../src/domain/rentalPricing'

test('device rental discounts apply to monthly and weekly blocks with 80 percent rounding', () => {
  const device = { pricePerDay: 100, weeklyDiscountPercent: 10, monthlyDiscountPercent: 20 }
  assert.equal(calculateRentalFee(device, 6), 630)
  assert.equal(calculateRentalFee(device, 7), 630)
  assert.equal(calculateRentalFee(device, 30), 2400)
  assert.equal(calculateRentalFee(device, 45), 3760)
})

test('device rental discount percentages accept 0 through 100 only', () => {
  assert.equal(parseDeviceDiscountPercent(''), 0)
  assert.equal(parseDeviceDiscountPercent('12.345'), 12.35)
  assert.equal(parseDeviceDiscountPercent('0'), 0)
  assert.equal(parseDeviceDiscountPercent('100'), 100)
  assert.equal(parseDeviceDiscountPercent('-1'), null)
  assert.equal(parseDeviceDiscountPercent('100.01'), null)
  assert.equal(parseDeviceDiscountPercent('nope'), null)
})


test('rental remainder rounds up at 24 days per month and 6 days per week', () => {
  const device = { pricePerDay: 100, weeklyDiscountPercent: 10, monthlyDiscountPercent: 20 }
  for (const [days, fee] of [[5,500],[6,630],[7,630],[20,1890],[23,2090],[24,2400],[25,2400],[29,2400],[30,2400],[53,4490],[54,4800],[60,4800],[90,7200],[110,9090],[113,9290],[114,9600],[115,9600],[120,9600]]) assert.equal(calculateRentalFee(device, days), fee, `${days} days`)
})


test('browser quotes use the same discounts and rounding as the server', () => {
  const quote = new Function('return ' + rentalPricingClientScript())()
  const device = {pricePerDay:19.99,weeklyDiscountPercent:11.5,monthlyDiscountPercent:27}
  for(let days=1;days<=366;days++) assert.deepEqual(quote(device,days),rentalPriceBreakdown(device,days),`${days} days`)
})
