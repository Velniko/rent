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
 * 未满 30 天按整周和日租计；满 30 天后，零头不足 21 天按周租日价，
 * 满 21 天按月租日价折算，不把零头进位为整期。
 */
export function rentalPriceBreakdown(device: RentalPricingDeviceLike, rentalDays: number) {
  const days = Math.max(0, Number(rentalDays) || 0)
  const dailyRate = Math.max(0, numericValue(device.pricePerDay, device.price_per_day, device.dailyRate))
  const weeklyDiscount = Math.min(100, Math.max(0, numericValue(device.weeklyDiscountPercent, device.weekly_discount_percent)))
  const monthlyDiscount = Math.min(100, Math.max(0, numericValue(device.monthlyDiscountPercent, device.monthly_discount_percent)))
  const remainder = days % 30
  const monthlyDays = days >= 30 ? Math.floor(days / 30) * 30 + (remainder >= 21 ? remainder : 0) : 0
  const remainingDays = days - monthlyDays
  const weeklyDays = days >= 30 ? remainingDays : Math.floor(remainingDays / 7) * 7
  const dailyDays = remainingDays - weeklyDays
  const monthlyFee = roundCurrency(monthlyDays / 30 * roundCurrency(30 * dailyRate * (1 - monthlyDiscount / 100)))
  const weeklyFee = roundCurrency(weeklyDays / 7 * roundCurrency(7 * dailyRate * (1 - weeklyDiscount / 100)))
  const originalAmount = roundCurrency(days * dailyRate)
  const monthlyDiscountAmount = roundCurrency(monthlyDays * dailyRate - monthlyFee)
  const weeklyDiscountAmount = roundCurrency(weeklyDays * dailyRate - weeklyFee)
  return {
    monthlyCount: Math.floor(monthlyDays / 30), monthlyRemainderDays: monthlyDays % 30,
    weeklyCount: Math.floor(weeklyDays / 7), weeklyRemainderDays: weeklyDays % 7, dailyDays,
    originalAmount, monthlyDiscountAmount, weeklyDiscountAmount,
    total: roundCurrency(originalAmount - monthlyDiscountAmount - weeklyDiscountAmount),
  }
}

export function calculateRentalFee(device: RentalPricingDeviceLike, rentalDays: number): number {
  return rentalPriceBreakdown(device, rentalDays).total
}

/** 页面报价复用同一个计算函数，避免客户端漏用月租或周租规则。 */
export function rentalPricingClientScript(): string {
  return `(() => { ${numericValue.toString()}; ${roundCurrency.toString()}; return ${rentalPriceBreakdown.toString()}; })()`
}
