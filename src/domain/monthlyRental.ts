/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

import { calculateRentalFee, type RentalPricingDeviceLike } from './rentalPricing'
import { LONG_TERM_RENTAL_DAYS } from './paymentPlan'

export interface RentalInstallment {
  id: string; order_id: string; installment_number: number; due_date: string; period_end: string;
  rental_amount: number; deposit_amount: number; processing_fee: number; amount: number;
  status: string; payment_id?: string; stripe_payment_intent_id?: string; last_error?: string;
}

export function isMonthlyRental(order: { billing_mode?: string; rentalPeriod?: number; paymentProvider?: unknown; payment_provider?: unknown }): boolean {
  return order.billing_mode === 'MONTHLY' || (Number(order.rentalPeriod) >= LONG_TERM_RENTAL_DAYS && String(order.paymentProvider || order.payment_provider || 'stripe') === 'stripe')
}

export function rentalPricingSnapshot(device: RentalPricingDeviceLike): string {
  return JSON.stringify({ pricePerDay: Number(device.pricePerDay ?? device.price_per_day ?? device.dailyRate ?? 0), weeklyDiscountPercent: Number(device.weeklyDiscountPercent ?? device.weekly_discount_percent ?? 0), monthlyDiscountPercent: Number(device.monthlyDiscountPercent ?? device.monthly_discount_percent ?? 0) })
}

// 每期租金使用下单时的月租/周租价格；优惠按各期租金占比分摊，尾期吸收分币误差。
export function buildMonthlyRentalInstallments(order: any, device: RentalPricingDeviceLike, feeRate: number): RentalInstallment[] {
  const days = Number(order.rentalPeriod)
  const start = Date.parse(`${order.startDate}T00:00:00Z`)
  if (!Number.isFinite(days) || days < LONG_TERM_RENTAL_DAYS || days > 366 || !Number.isFinite(start)) throw new Error('月付租期无效')
  const pricing = order.rental_pricing_json ? JSON.parse(order.rental_pricing_json) : device
  const toCents = (value: unknown) => Math.round(Number(value || 0) * 100)
  const deposit = toCents(order.depositAmount)
  const extras = toCents(order.serviceFee ?? order.service_fee) + toCents(order.deliveryFee ?? order.delivery_fee)
  const netRental = toCents(order.totalAmount) - deposit - extras
  if (![deposit, extras, netRental].every(value => Number.isSafeInteger(value) && value >= 0)) throw new Error('订单金额无效')
  const monthlyRent = calculateRentalFee(pricing, 30)
  const grossRental = toCents(calculateRentalFee(pricing, days))
  const fullMonths = Math.floor(days / 30)
  const weights = Array.from({ length: Math.ceil(days / 30) }, (_, index) => index < fullMonths ? toCents(monthlyRent) : Math.max(0, grossRental - fullMonths * toCents(monthlyRent)))
  const weightTotal = weights.reduce((sum, amount) => sum + amount, 0)
  let allocated = 0
  const date = (offset: number) => new Date(start + offset * 86400000).toISOString().slice(0, 10)
  return weights.map((weight, index) => {
    const rent = index === weights.length - 1 ? netRental - allocated : Math.min(netRental - allocated, Math.round(netRental * (weightTotal ? weight / weightTotal : 1 / weights.length)))
    allocated += rent
    const rental = rent + (index === 0 ? extras : 0)
    const paidDeposit = index === 0 && (order.deposit_method || 'card_hold') === 'card_hold' ? deposit : 0
    const fee = Math.round((rental + paidDeposit) * feeRate)
    return { id: `ri-${order.id}-${index + 1}`, order_id: order.id, installment_number: index + 1, due_date: date(index * 30), period_end: index === weights.length - 1 ? order.endDate : date((index + 1) * 30), rental_amount: rental / 100, deposit_amount: paidDeposit / 100, processing_fee: fee / 100, amount: (rental + paidDeposit + fee) / 100, status: 'pending' }
  })
}
