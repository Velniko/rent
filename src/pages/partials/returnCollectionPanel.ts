/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

import type { Context } from 'hono'
import { escapeHtml } from '../../lib/html'
import { formatCurrency } from '../../lib/format'
import { returnQuoteToken } from '../../domain/returnCharges'
import { enabledReturnPaymentMethods, getReturnChargeQuote } from '../../services/returnCollections'

export async function renderReturnCollectionPanel(c: Context, order: any): Promise<string> {
  const quote = await getReturnChargeQuote(c, order)
  if (quote.total <= 0) return ''
  const pending = await c.env.RENT.prepare("SELECT id FROM return_collections WHERE order_id = ? AND status = 'pending'").bind(order.id).first() as any
  return `<section class="panel return-collection-panel"><div class="section-title"><h3>归还费用</h3><strong>${quote.amountDue > 0 ? '待收款' : '已结清'}</strong></div><dl class="data-list"><div><dt>逾期费用</dt><dd>${formatCurrency(quote.total)}</dd></div><div><dt>押金抵扣</dt><dd>${formatCurrency(quote.depositApplied)}</dd></div><div><dt>已收款</dt><dd>${formatCurrency(quote.collected)}</dd></div><div><dt>应付金额</dt><dd><strong>${formatCurrency(quote.amountDue)}</strong></dd></div></dl>${pending ? `<a class="button button-primary" href="/staff/return-collections/${encodeURIComponent(pending.id)}">查看当前收款</a>` : quote.amountDue > 0 ? `<form method="post" action="/staff/orders/${encodeURIComponent(order.id)}/return-collection" id="return-collection-form"><input type="hidden" name="quoteToken" value="${escapeHtml(returnQuoteToken(order, quote))}"><label class="form-label" for="return-payment-method">收款方式</label><select class="form-control" id="return-payment-method" name="paymentMethod" required>${enabledReturnPaymentMethods().map(([method, label]) => `<option value="${method}">${label}</option>`).join('')}</select><label class="form-check" id="return-received-label"><input type="checkbox" name="confirmReceived" value="1" required><span id="return-received-text">已确认收到款项</span></label><button class="button button-primary" type="submit" id="return-collection-submit">确认收款</button></form><script>(()=>{const form=document.getElementById('return-collection-form'),method=document.getElementById('return-payment-method'),label=document.getElementById('return-received-label'),text=document.getElementById('return-received-text'),button=document.getElementById('return-collection-submit');if(!form||!method)return;const sync=()=>{const stripe=method.value==='card';label.hidden=stripe;form.elements.confirmReceived.required=!stripe;text.textContent=method.value==='balance'?'客户已同意扣减余额':'已确认收到款项';button.textContent=stripe?'前往 Stripe 收款':'确认收款'};method.addEventListener('change',sync);sync()})();</script>` : ''}</section>`
}
