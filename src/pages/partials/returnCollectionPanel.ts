/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

import type { Context } from 'hono'
import { escapeHtml } from '../../lib/html'
import { formatCurrency } from '../../lib/format'
import { getUserById } from '../../site'
import { returnQuoteToken } from '../../domain/returnCharges'
import { enabledReturnPaymentMethods, getReturnChargeQuote } from '../../services/returnCollections'

export async function renderReturnCollectionPanel(c: Context, order: any): Promise<string> {
  const quote = await getReturnChargeQuote(c, order)
  if (quote.total <= 0) return ''
  const pending = await c.env.RENT.prepare("SELECT id FROM return_collections WHERE order_id = ? AND status = 'pending'").bind(order.id).first() as any
  const summary = `<dl class="data-list"><div><dt>逾期费用</dt><dd>${formatCurrency(quote.total)}</dd></div><div><dt>押金抵扣</dt><dd>${formatCurrency(quote.depositApplied)}</dd></div><div><dt>已收款</dt><dd>${formatCurrency(quote.collected)}</dd></div><div><dt>应付金额</dt><dd><strong>${formatCurrency(quote.amountDue)}</strong></dd></div></dl>`
  if (pending) return `<section class="panel return-collection-panel"><div class="section-title"><h3>归还费用</h3><strong>待收款</strong></div>${summary}<a class="button button-primary" href="/staff/return-collections/${encodeURIComponent(pending.id)}">查看当前收款</a></section>`
  if (quote.amountDue <= 0) return `<section class="panel return-collection-panel"><div class="section-title"><h3>归还费用</h3><strong>已结清</strong></div>${summary}</section>`
  const customer = await getUserById(c, order.userId)
  const methods = enabledReturnPaymentMethods()
  const paidMethods = methods.filter(([method]) => method !== 'balance' && method !== 'card')
  const balanceAvailable = methods.some(([method]) => method === 'balance') && Number(customer?.balance || 0) >= quote.amountDue
  const cardAvailable = methods.some(([method]) => method === 'card')
  const actionUrl = `/staff/orders/${encodeURIComponent(order.id)}/return-collection`
  const token = escapeHtml(returnQuoteToken(order, quote))
  const paidForm = paidMethods.length ? `<form method="post" action="${actionUrl}" id="rc-paid-form" hidden><input type="hidden" name="quoteToken" value="${token}"><label class="form-label" for="rc-paid-method">支付方式</label><select class="form-control" id="rc-paid-method" name="paymentMethod" required>${paidMethods.map(([method, label]) => `<option value="${method}">${label}</option>`).join('')}</select><label class="form-check"><input type="checkbox" name="confirmReceived" value="1" required> 已确认收到款项</label><button class="button button-primary" type="submit">确认支付</button><button class="button button-secondary" type="button" id="rc-paid-cancel">取消</button></form>` : ''
  const balanceForm = balanceAvailable ? `<form method="post" action="${actionUrl}" id="rc-balance-form" hidden><input type="hidden" name="quoteToken" value="${token}"><input type="hidden" name="paymentMethod" value="balance"><input type="hidden" name="confirmReceived" value="1"></form>` : ''
  const cardForm = cardAvailable ? `<form method="post" action="${actionUrl}" style="display:inline-block;margin-top:8px"><input type="hidden" name="quoteToken" value="${token}"><input type="hidden" name="paymentMethod" value="card"><button class="button button-secondary" type="submit">Stripe App 收款</button></form>` : ''
  return `<section class="panel return-collection-panel"><div class="section-title"><h3>归还费用</h3><strong>待收款</strong></div>${summary}<div class="return-collection-actions" id="rc-actions">${paidMethods.length ? '<button class="button button-primary" type="button" id="rc-paid-btn">已支付</button>' : ''}${balanceAvailable ? '<button class="button button-secondary" type="button" id="rc-balance-btn">余额扣除</button>' : ''}<button class="button button-secondary" type="button" id="rc-close-btn">关闭</button></div>${paidForm}${balanceForm}${cardForm}<script>(()=>{const actions=document.getElementById('rc-actions'),section=actions&&actions.closest('.return-collection-panel'),paidForm=document.getElementById('rc-paid-form'),balanceForm=document.getElementById('rc-balance-form');document.getElementById('rc-paid-btn')&&document.getElementById('rc-paid-btn').addEventListener('click',()=>{paidForm.hidden=false;actions.hidden=true});document.getElementById('rc-paid-cancel')&&document.getElementById('rc-paid-cancel').addEventListener('click',()=>{paidForm.hidden=true;actions.hidden=false});document.getElementById('rc-balance-btn')&&document.getElementById('rc-balance-btn').addEventListener('click',()=>{if(confirm('确认客户已同意从余额扣除该费用？'))balanceForm.submit()});document.getElementById('rc-close-btn')&&document.getElementById('rc-close-btn').addEventListener('click',()=>{if(section)section.hidden=true})})();</script></section>`
}
