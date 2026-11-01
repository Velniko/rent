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
 * 30 天为一个月、7 天为一周。余数达到该周期的 80% 时收整期价格，
 * 否则继续按下一档拆分（24 天收月租、6 天收周租）。
 */
export function rentalPriceBreakdown(device: RentalPricingDeviceLike, rentalDays: number) {
  const days = Math.max(0, Math.floor(Number(rentalDays) || 0))
  const dailyRate = Math.max(0, numericValue(device.pricePerDay, device.price_per_day, device.dailyRate))
  const weeklyDiscount = Math.min(100, Math.max(0, numericValue(device.weeklyDiscountPercent, device.weekly_discount_percent)))
  const monthlyDiscount = Math.min(100, Math.max(0, numericValue(device.monthlyDiscountPercent, device.monthly_discount_percent)))
  const monthlyDays = (Math.floor(days / 30) + (days % 30 >= 24 ? 1 : 0)) * 30
  const remainingAfterMonthly = Math.max(0, days - monthlyDays)
  const weeklyDays = (Math.floor(remainingAfterMonthly / 7) + (remainingAfterMonthly % 7 >= 6 ? 1 : 0)) * 7
  const dailyDays = Math.max(0, remainingAfterMonthly - weeklyDays)
  const monthlyFee = monthlyDays / 30 * roundCurrency(30 * dailyRate * (1 - monthlyDiscount / 100))
  const weeklyFee = weeklyDays / 7 * roundCurrency(7 * dailyRate * (1 - weeklyDiscount / 100))
  const dailyFee = dailyDays * dailyRate
  return {
    monthlyCount: monthlyDays / 30, weeklyCount: weeklyDays / 7, dailyDays,
    originalAmount: roundCurrency((monthlyDays + weeklyDays + dailyDays) * dailyRate),
    monthlyDiscountAmount: roundCurrency(monthlyDays * dailyRate - monthlyFee),
    weeklyDiscountAmount: roundCurrency(weeklyDays * dailyRate - weeklyFee),
    total: roundCurrency(monthlyFee + weeklyFee + dailyFee),
  }
}

export function calculateRentalFee(device: RentalPricingDeviceLike, rentalDays: number): number {
  return rentalPriceBreakdown(device, rentalDays).total
}

/** 页面报价复用同一个计算函数，避免客户端漏用月租或周租规则。 */
export function rentalPricingClientScript(): string {
  return `(() => { ${numericValue.toString()}; ${roundCurrency.toString()}; return ${rentalPriceBreakdown.toString()}; })()`
}
