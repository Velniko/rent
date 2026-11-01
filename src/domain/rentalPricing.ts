/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

export interface RentalPricingDeviceLike {
  pricePerDay?: number | string | null
  price_per_day?: number | string | null
  dailyRate?: number | string | null
  weeklyDiscountPercent?: number | string | null
  weekly_discount_percent?: number | string | null
  monthlyDiscountPercent?: number | string | null
  monthly_discount_percent?: number | string | null
  weeklyDiscountOverride?: number | string | null
  weekly_discount_override?: number | string | null
  monthlyDiscountOverride?: number | string | null
  monthly_discount_override?: number | string | null
}

export function resolveRentalDiscounts(device: RentalPricingDeviceLike, defaults: { weeklyDiscountPercent: number; monthlyDiscountPercent: number }) {
  const weeklyDiscountOverride = device.weeklyDiscountOverride !== undefined ? device.weeklyDiscountOverride : device.weekly_discount_override !== undefined ? device.weekly_discount_override : device.weeklyDiscountPercent ?? device.weekly_discount_percent ?? null
  const monthlyDiscountOverride = device.monthlyDiscountOverride !== undefined ? device.monthlyDiscountOverride : device.monthly_discount_override !== undefined ? device.monthly_discount_override : device.monthlyDiscountPercent ?? device.monthly_discount_percent ?? null
  return {
    weeklyDiscountOverride: weeklyDiscountOverride == null ? null : Number(weeklyDiscountOverride),
    monthlyDiscountOverride: monthlyDiscountOverride == null ? null : Number(monthlyDiscountOverride),
    weeklyDiscountPercent: Number(weeklyDiscountOverride ?? defaults.weeklyDiscountPercent),
    monthlyDiscountPercent: Number(monthlyDiscountOverride ?? defaults.monthlyDiscountPercent),
  }
}

export function parseDeviceDiscountPercent(value: unknown): number | null {
  if (value == null || String(value).trim() === '') return 0
  const percent = Number(value)
  if (!Number.isFinite(percent) || percent < 0 || percent > 100) return null
  return Number(percent.toFixed(2))
}

function numericValue(...values: unknown[]): number {
  for (const value of values) {
    const number = Number(value)
    if (Number.isFinite(number)) return number
  }
  return 0
}

function roundCurrency(value: number): number {
  return Number(value.toFixed(2))
}

/**
 * Calculates rental fees using 30-day monthly blocks, then 7-day weekly
 * blocks, then any remaining daily rental days.
 */
export function calculateRentalFee(device: RentalPricingDeviceLike, rentalDays: number): number {
  const days = Math.max(0, Math.floor(Number(rentalDays) || 0))
  const dailyRate = Math.max(0, numericValue(device.pricePerDay, device.price_per_day, device.dailyRate))
  const weeklyDiscount = Math.min(100, Math.max(0, numericValue(device.weeklyDiscountPercent, device.weekly_discount_percent)))
  const monthlyDiscount = Math.min(100, Math.max(0, numericValue(device.monthlyDiscountPercent, device.monthly_discount_percent)))
  const monthlyDays = Math.floor(days / 30) * 30
  const remainingAfterMonthly = days - monthlyDays
  const weeklyDays = Math.floor(remainingAfterMonthly / 7) * 7
  const dailyDays = remainingAfterMonthly - weeklyDays
  const monthlyFee = monthlyDays * dailyRate * (1 - monthlyDiscount / 100)
  const weeklyFee = weeklyDays * dailyRate * (1 - weeklyDiscount / 100)
  const dailyFee = dailyDays * dailyRate
  return roundCurrency(monthlyFee + weeklyFee + dailyFee)
}
