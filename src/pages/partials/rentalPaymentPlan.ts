/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

import { canChooseRentalPaymentPlan } from '../../services/rentalPaymentPlan'
import { isMonthlyRental, buildMonthlyRentalInstallments } from '../../domain/monthlyRental'
import { formatCurrency } from '../../site'
import { escapeHtml } from '../../lib/html'
import { getStripeProcessingFeeRate } from '../../actions/stripePayments'

export function renderRentalPaymentPlan(order: any, device: any, action: string): string {
  if (!canChooseRentalPaymentPlan(order)) return ''
  let pricing: any = {}
  try { pricing = JSON.parse(order.rental_pricing_json || '{}') } catch { return '' }
  const deposit = Number(pricing.depositAmountBeforeWaiver ?? (Number(order.depositAmount) > 0 ? order.depositAmount : device?.depositAmount || 0))
  const rent = Number(order.totalAmount) - Number(order.depositAmount || 0)
  const monthly = buildMonthlyRentalInstallments({ ...order, totalAmount: rent + deposit, depositAmount: deposit, deposit_method: 'card_hold' }, device || {}, getStripeProcessingFeeRate())[0]
  const upfront = Number((rent + Math.round(rent * 100 * getStripeProcessingFeeRate()) / 100).toFixed(2))
  const selected = isMonthlyRental(order)
  return `<section class="panel" style="margin:20px 0"><h3>租金付款计划</h3><form method="post" action="${escapeHtml(action)}"><div class="payment-options"><label class="payment-option"><input type="radio" onchange="this.form.requestSubmit()" name="billingMode" value="MONTHLY" ${selected ? 'checked' : ''} required><span><strong>月付</strong><small>首期 ${formatCurrency(monthly.amount)}（含押金 ${formatCurrency(deposit)}）</small></span></label><label class="payment-option"><input type="radio" onchange="this.form.requestSubmit()" name="billingMode" value="FULL" ${selected ? '' : 'checked'} required><span><strong>一次性付清（免押金）</strong><small>信用卡合计 ${formatCurrency(upfront)}</small></span></label></div><button class="button button-secondary" type="submit">更新付款计划</button></form></section>`
}
