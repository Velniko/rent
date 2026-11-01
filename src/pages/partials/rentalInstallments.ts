/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

import type { Context } from 'hono'
import { formatCurrency, sanitizePlainText } from '../../site'
import { getRentalInstallments, melbourneToday } from '../../services/monthlyRentalPayments'
import { renderStripePaymentBox } from './stripePaymentSection'

export async function renderRentalInstallments(c: Context, order: any, customer = false): Promise<string> {
  if (order.billing_mode !== 'MONTHLY') return ''
  const plan = await getRentalInstallments(c, order.id)
  const labels: Record<string, string> = { pending: '待付款', processing: '处理中', paid: '已付款', failed: '扣款失败', cancelled: '已取消' }
  const canPay = customer && !['cancelled', 'completed'].includes(order.status)
  return `<section class="panel" style="margin-top:20px"><h3>月租付款计划</h3><p>每 30 天支付一期租金，押金随首期收取。</p><div class="table-responsive"><table><thead><tr><th>期数</th><th>付款日期</th><th>租金及服务费</th><th>押金</th><th>支付手续费</th><th>本期合计</th><th>状态</th></tr></thead><tbody>${plan.map(part => `<tr><td>${part.installment_number}</td><td>${sanitizePlainText(part.due_date)}</td><td>${formatCurrency(part.rental_amount)}</td><td>${formatCurrency(part.deposit_amount)}</td><td>${formatCurrency(part.processing_fee)}</td><td>${formatCurrency(part.amount)}</td><td>${labels[part.status] || '待付款'}</td></tr>`).join('')}</tbody></table></div>${canPay ? plan.filter(part => ['pending', 'failed'].includes(part.status) && part.due_date <= melbourneToday() && plan.filter(earlier => earlier.installment_number < part.installment_number).every(earlier => earlier.status === 'paid')).map(part => renderStripePaymentBox({ intentUrl: `/customer/orders/${encodeURIComponent(order.id)}/installments/${encodeURIComponent(part.id)}/stripe/intent`, returnUrl: `/customer/orders/${encodeURIComponent(order.id)}`, buttonLabel: '支付本期租金', domId: `installment-${part.installment_number}` })).join('') : ''}</section>`
}
