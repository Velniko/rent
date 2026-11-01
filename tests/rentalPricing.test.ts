/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

import test from 'node:test'
import assert from 'node:assert/strict'
import { calculateRentalFee, parseDeviceDiscountPercent, rentalPriceBreakdown, rentalPricingClientScript } from '../src/domain/rentalPricing'

test('rental periods and remaining days use the selected rental tier daily rate', () => {
  const device = { pricePerDay: 100, weeklyDiscountPercent: 10, monthlyDiscountPercent: 20 }
  assert.equal(calculateRentalFee(device, 6), 600)
  assert.equal(calculateRentalFee(device, 7), 630)
  assert.equal(calculateRentalFee(device, 30), 2400)
  assert.equal(calculateRentalFee(device, 45), 3750)
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


test('monthly and weekly remainders are prorated instead of rounded up', () => {
  const device = { pricePerDay: 100, weeklyDiscountPercent: 10, monthlyDiscountPercent: 20 }
  for (const [days, fee] of [[5,500],[6,600],[7,630],[10,930],[13,1230],[20,1860],[21,1890],[23,2090],[24,2190],[25,2290],[29,2620],[30,2400],[31,2490],[35,2850],[45,3750],[53,4240],[54,4320],[60,4800],[90,7200],[110,9000],[111,8880],[113,9040],[114,9120],[115,9200],[120,9600]]) assert.equal(calculateRentalFee(device, days), fee, `${days} days`)
  const price = rentalPriceBreakdown(device, 115)
  assert.equal(price.monthlyCount, 3)
  assert.equal(price.monthlyRemainderDays, 25)
  assert.equal(price.originalAmount, 11500)
  assert.equal(price.monthlyDiscountAmount, 2300)
  const week = rentalPriceBreakdown(device, 10)
  assert.equal(week.weeklyCount, 1)
  assert.equal(week.weeklyRemainderDays, 0)
  assert.equal(week.weeklyDiscountAmount, 70)
})


test('browser quotes use the same discounts and rounding as the server', () => {
  const quote = new Function('return ' + rentalPricingClientScript())()
  const device = {pricePerDay:19.99,weeklyDiscountPercent:11.5,monthlyDiscountPercent:27}
  for(let days=1;days<=366;days++) assert.deepEqual(quote(device,days),rentalPriceBreakdown(device,days),`${days} days`)
})


test('30-day minimum and 21-day remainder boundary preserve fractional days', () => {
  const device = {pricePerDay:100,weeklyDiscountPercent:10,monthlyDiscountPercent:20}
  for (const [days, amount] of [[6.5,650],[21,1890],[24,2190],[29,2620],[30,2400],[30.5,2445],[50,4200],[50.5,4245],[51,4080],[110,9000],[115,9200]]) assert.equal(calculateRentalFee(device,days),amount,`${days} days`)
})
