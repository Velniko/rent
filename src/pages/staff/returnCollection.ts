/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

import type { Context } from 'hono'
import { buildLayout } from '../../site'
import { escapeHtml } from '../../lib/html'
import { formatCurrency } from '../../lib/format'
import { getReturnCollection, RETURN_PAYMENT_METHODS } from '../../services/returnCollections'
import { getStripeConfigSummary } from '../../stripe'

export async function renderReturnCollection(c: Context, user: any, id: string, error = '') {
  const { collection, order, customer } = await getReturnCollection(c, user, id)
  const path = `/staff/return-collections/${encodeURIComponent(id)}`
  const pendingCard = collection.payment_method === 'card' && collection.status === 'pending'
  const amount = Number(collection.amount) + Number(collection.processing_fee)
  const stripeTest = pendingCard && (await getStripeConfigSummary(c)).mode === 'test'
  const stripeUrl = `https://dashboard.stripe.com/${stripeTest ? 'test/' : ''}customers/${encodeURIComponent(collection.stripe_customer_id)}`
  const body = `<div class="page-header"><div><h2>归还收款</h2><p>${escapeHtml(order.orderNo || order.id)}</p></div><a class="button button-secondary" href="/staff/orders/${encodeURIComponent(order.id)}/inspection">返回归还页</a></div>${error ? `<div data-flash-notice class="page-notification page-notification--error">${escapeHtml(error)}</div>` : ''}<section class="panel"><div class="section-title"><h3>${collection.status === 'paid' ? '已收款' : collection.status === 'cancelled' ? '已取消' : '待付款'}</h3><span>${escapeHtml(RETURN_PAYMENT_METHODS[collection.payment_method] || collection.payment_method)}</span></div><dl class="data-list"><div><dt>客户</dt><dd>${escapeHtml(customer.name)}</dd></div><div><dt>逾期补款</dt><dd>${formatCurrency(Number(collection.amount))}</dd></div>${Number(collection.processing_fee) > 0 ? `<div><dt>Stripe 手续费</dt><dd>${formatCurrency(Number(collection.processing_fee))}</dd></div>` : ''}<div><dt>收款金额</dt><dd><strong>${formatCurrency(amount)}</strong></dd></div></dl>${pendingCard ? `<div class="grid grid-2"><div class="form-group"><label class="form-label" for="stripe-pos-amount">收款金额（AUD）</label><input class="form-control" id="stripe-pos-amount" readonly value="${amount.toFixed(2)}"><button class="button button-secondary" type="button" data-copy-input="stripe-pos-amount">复制金额</button></div><div class="form-group"><label class="form-label" for="stripe-pos-reference">收款备注</label><input class="form-control" id="stripe-pos-reference" readonly value="${escapeHtml(collection.reference)}"><button class="button button-secondary" type="button" data-copy-input="stripe-pos-reference">复制收款备注</button></div></div><p><strong>${escapeHtml(customer.name)}</strong> · ${escapeHtml(customer.email)}</p><p>${stripeTest ? '测试环境请使用 Dashboard 网页。' : '在 Stripe App 选择该客户并填写收款备注。'}</p><a class="button button-primary" href="${stripeUrl}" target="_blank" rel="noopener noreferrer">前往 Stripe 收款</a> <a class="button button-secondary" href="${path}">刷新收款状态</a><form method="post" action="${path}/verify-stripe" style="margin-top:20px"><label class="form-label" for="stripe-receipt-id">Stripe 交易号</label><input class="form-control" id="stripe-receipt-id" name="receiptId" placeholder="pi_ 或 ch_ 开头" required><button class="button button-primary" type="submit">核验到账</button></form>` : ''}${collection.status === 'pending' ? `<form method="post" action="${path}/cancel" style="margin-top:20px"><label class="form-check"><input type="checkbox" name="confirmUnpaid" value="1" required>确认尚未收款</label><button class="button button-secondary" type="submit">取消当前收款</button></form>` : ''}${collection.status === 'paid' ? `<a class="button button-primary" href="/staff/orders/${encodeURIComponent(order.id)}/inspection">继续归还</a>` : ''}</section>`
  const copyScript = pendingCard ? `<script>(()=>{document.querySelectorAll('[data-copy-input]').forEach(button=>button.addEventListener('click',async()=>{const input=document.getElementById(button.getAttribute('data-copy-input'));if(!input)return;try{await navigator.clipboard.writeText(input.value)}catch(_){input.focus();input.select();document.execCommand('copy')}}))})();</script>` : ''
  return buildLayout('归还收款', body + copyScript, user, { compactStaffNav: true, currentPath: '/staff/mobile/return' })
}
