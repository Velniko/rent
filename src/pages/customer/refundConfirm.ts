/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

import type { Context } from 'hono'
import { buildLayout, getOrderById, formatCurrency } from '../../site'
import { escapeHtml } from '../../lib/html'
import { getCustomerRefundQuote, customerRefundQuoteToken, getCustomerRefundRequest, CUSTOMER_REFUND_STATUSES, REFUND_METHOD_LABELS } from '../../services/customerRefunds'

export async function renderCustomerRefundConfirm(c: Context, user: any, orderId: string): Promise<string> {
  const order = await getOrderById(c, orderId)
  if (!order || order.userId !== user.id) return buildLayout('申请退款', '<div class="panel"><h2>订单不存在或无权访问</h2></div>', user)
  const back = `<a class="button button-secondary" href="/customer/orders/${encodeURIComponent(order.id)}">返回订单详情</a>`
  const request = await getCustomerRefundRequest(c, order.id)
  if (request && request.status !== 'rejected') return buildLayout('申请退款', `<div class="panel"><h2>${CUSTOMER_REFUND_STATUSES[request.status]}</h2>${back}</div>`, user)
  try {
    const quote = await getCustomerRefundQuote(c, order)
    const needsBank = quote.payments.some(p => p.channel === 'bank_transfer')
    return buildLayout('确认申请退款', `<section class="panel"><div class="section-title"><h2>确认申请退款</h2>${back}</div>
      <dl class="data-list"><div><dt>订单总额</dt><dd>${formatCurrency(quote.total)}</dd></div><div><dt>服务费</dt><dd>${formatCurrency(quote.serviceFee)}</dd></div><div><dt>已付款金额</dt><dd>${formatCurrency(quote.paid)}</dd></div>${quote.authorized > 0 ? `<div><dt>预授权金额</dt><dd>${formatCurrency(quote.authorized)}</dd></div><div><dt>预计释放预授权</dt><dd>${formatCurrency(quote.released)}</dd></div>` : ''}<div><dt>${Number(quote.fee) > 0 ? '退款手续费（订单总额的 5%）' : '退款手续费'}</dt><dd>${formatCurrency(quote.fee)}</dd></div><div><dt>预计退款金额</dt><dd><strong>${formatCurrency(quote.refund)}</strong></dd></div></dl>
      <h3>退款方式</h3><dl class="data-list">${quote.payments.map(p => `<div><dt>${REFUND_METHOD_LABELS[p.channel]}</dt><dd>${formatCurrency(p.refundAmount + p.releaseAmount)}${p.authorization ? '（释放预授权）' : ''}</dd></div>`).join('')}</dl>
      <form method="post" action="/customer/orders/${encodeURIComponent(order.id)}/refund-request">
        <input type="hidden" name="quoteToken" value="${await customerRefundQuoteToken(quote)}">
        <div class="form-group"><label class="form-label" for="refundReason">退款原因</label><textarea class="form-control" id="refundReason" name="reason" maxlength="300" required></textarea></div>
        ${needsBank ? `<div class="grid grid-2"><div class="form-group"><label class="form-label" for="refundBsb">退款 BSB</label><input class="form-control" id="refundBsb" name="refundBsb" pattern="[0-9]{3}-?[0-9]{3}" value="${escapeHtml(order.refundBsb || '')}" required></div><div class="form-group"><label class="form-label" for="refundAccountNumber">退款银行账号</label><input class="form-control" id="refundAccountNumber" name="refundAccountNumber" pattern="[0-9]{4,10}" value="${escapeHtml(order.refundAccountNumber || '')}" required></div><div class="form-group"><label class="form-label" for="refundAccountName">退款账户名</label><input class="form-control" id="refundAccountName" name="refundAccountName" maxlength="120" value="${escapeHtml(order.refundAccountName || '')}" required></div></div>` : ''}
        <label class="form-check"><input type="checkbox" name="confirmRefund" value="1" required>${quote.fee > 0 ? '我确认扣除订单总额 5% 的退款手续费' : '我确认申请全额退款'}</label>
        <button class="button button-danger" type="submit">确认并提交退款申请</button>
      </form></section>`, user)
  } catch (error: any) {
    return buildLayout('申请退款', `<div class="panel"><h2>申请退款</h2><p>${escapeHtml(error.message)}</p>${back}</div>`, user)
  }
}
