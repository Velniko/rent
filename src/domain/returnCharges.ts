/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

import { returnOverdueDays } from './pickupHold'

const money = (value: number) => Math.round(value * 100) / 100
export function returnChargeQuote(order: any, dailyRate: number, now = new Date(), charges?: Array<{ charge_date: string; rental_amount: number; handling_fee: number }>) {
  const received = order.return_received_at ? new Date(`${String(order.return_received_at).replace(' ', 'T').replace(/Z$/, '')}Z`) : now
  const days = order.is_manual === 1 ? null : returnOverdueDays(order, received)
  let calculated = days === null ? 0 : 25 + days * Math.max(0, dailyRate)
  if (charges && days !== null) {
    const dates = new Set(charges.map(charge => charge.charge_date))
    calculated = charges.reduce((sum, charge) => sum + Number(charge.rental_amount) + Number(charge.handling_fee), 0)
    for (let day = 0; day <= days; day++) {
      const date = new Date(`${order.endDate}T00:00:00Z`)
      date.setUTCDate(date.getUTCDate() + day)
      if (!dates.has(date.toISOString().slice(0, 10))) calculated += day === 0 ? 25 : Math.max(0, dailyRate)
    }
  }
  if (order.return_received_at) calculated = 0
  const total = money(Math.max(Number(order.overdue_charge_total || 0), calculated))
  const otherDeductions = Math.max(0, Number(order.deposit_deduction_amount || 0) - Number(order.overdue_deposit_applied || 0))
  const depositAvailable = Math.max(0, Number(order.deposit_held_amount || 0) - otherDeductions)
  const depositApplied = money(Math.min(total, order.return_received_at ? Math.max(0, Number(order.overdue_deposit_applied || 0)) : depositAvailable))
  const collected = money(Math.max(0, Number(order.overdue_collected_amount || 0)))
  return { overdueDays: days, total, depositApplied, collected, amountDue: money(Math.max(0, total - depositApplied - collected)) }
}

export function returnQuoteToken(order: any, quote: ReturnType<typeof returnChargeQuote>): string {
  return [order.id, order.endDate, order.returnTimeSlot || '', quote.total, quote.depositApplied, quote.collected, quote.amountDue].join(':')
}
