/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

import { buildLayout, formatCurrency, getSystemSettings } from '../../site'
import type { Context } from 'hono'
import { renderStripePaymentBox } from '../partials/stripePaymentSection'
import { renderSquareGiftCardPaymentBox } from '../partials/squareGiftCardPayment'
import { renderBankTransferReference } from '../partials/bankTransferReference'

export function renderCustomerBalanceTopUp(c: Context, user: any, error = '', pending?: any, payTopup?: any, success = false) {
  const settings = getSystemSettings()
  const bank = settings.bankDetails || {} as any
  const feeRate = 0
  const squareFeeRate = Math.min(1, Math.max(0, Number(settings.paymentMethods?.squareProcessingFeeRate ?? 0.022)))
  const isSquareTopUp = String(payTopup?.payment_method || '') === 'square'
  const payFee = payTopup ? Math.round(Number(payTopup.amount) * (isSquareTopUp ? squareFeeRate : feeRate) * 100) / 100 : 0
  const payTotal = payTopup ? Number(payTopup.amount) + payFee : 0
  const squarePaid = payTopup && isSquareTopUp ? Number(payTopup.square_paid_amount || 0) : 0
  const squareRemaining = Math.max(0, Number((payTotal - squarePaid).toFixed(2)))
  const pendingSquareTarget = pending && Number(pending.square_paid_amount || 0) > 0 ? Number(pending.amount) + Math.round(Number(pending.amount) * squareFeeRate * 100) / 100 : 0
  const pendingAmount = pendingSquareTarget > 0 ? Math.max(0, Number((pendingSquareTarget - Number(pending.square_paid_amount || 0)).toFixed(2))) : Number(pending?.amount || 0)
  let paymentBox = ''
  if (payTopup) {
    if (!isSquareTopUp) {
      paymentBox = `<p class="form-text">卡信息由 Stripe 处理，本站不保存卡号。</p>${renderStripePaymentBox({ intentUrl: `/customer/balance/top-up/${payTopup.id}/intent`, returnUrl: `/customer/balance/top-up?success=1`, buttonLabel: `支付 ${formatCurrency(payTotal)}`, domId: 'topup-stripe-pay' })}`
    } else if (squarePaid > 0) {
      const remainderBox = squareRemaining > 0
        ? `<div class="payment-card"><h4>剩余充值付款</h4><p>请选择 Stripe 或银行转账支付剩余 ${formatCurrency(squareRemaining)}。余额不能用于充值余额。</p>${settings.paymentMethods.stripe ? `<p class="form-text">卡信息由 Stripe 处理。</p>${renderStripePaymentBox({ intentUrl: `/customer/balance/top-up/${payTopup.id}/intent`, returnUrl: `/customer/balance/top-up?success=1`, buttonLabel: `支付剩余 ${formatCurrency(squareRemaining)}`, domId: 'topup-stripe-pay' })}` : ''}${settings.paymentMethods.bankTransfer ? `<form method="post" action="/customer/balance/top-up/${payTopup.id}/select-transfer" style="margin-top:12px"><button class="button button-secondary" type="submit">选择银行转账</button></form>` : ''}</div>`
        : ''
      paymentBox = `<div class="payment-card"><p>礼品卡已扣除 ${formatCurrency(squarePaid)}，充值剩余应付 <strong>${formatCurrency(squareRemaining)}</strong>。</p></div>${remainderBox}`
    } else {
      paymentBox = renderSquareGiftCardPaymentBox({ configUrl: `/customer/balance/top-up/${payTopup.id}/square/config`, paymentUrl: `/customer/balance/top-up/${payTopup.id}/square/payment`, returnUrl: `/customer/balance/top-up?success=1`, buttonLabel: `使用礼品卡充值 ${formatCurrency(payTotal)}`, domId: 'topup-square-gift-card-pay', showStripeRemainder: false })
    }
  }
  const squareReloadScript = `<script>(function(){window.addEventListener('square-payment-updated',function(event){if(Number((event.detail||{}).squarePaidAmountCents||0)>0)window.setTimeout(function(){window.location.reload()},250)})})();</script>`
  const body = `<div class="entity-header"><div class="identity-strip mono"><span>ACCOUNT / TOP UP</span><span>WALLET FUNDING</span></div><div class="entity-heading"><div><p class="section-code">WALLET</p><h2>余额充值</h2></div><strong class="balance-hero-value">${formatCurrency(user.balance)}</strong></div></div>
    ${success ? `<div data-flash-notice class="page-notification page-notification--success">付款已提交，到账后余额自动更新。</div>` : ''}
    ${error ? `<div data-flash-notice class="page-notification page-notification--error">${error}</div>` : ''}
    ${payTopup ? `<div class="panel"><h3>${isSquareTopUp ? '礼品卡充值' : '信用卡充值'}</h3>
      <dl class="data-list" style="margin:8px 0">
        <div><dt>充值金额</dt><dd>${formatCurrency(payTopup.amount)}</dd></div>
        ${isSquareTopUp ? `<div><dt>礼品卡手续费（${(squareFeeRate * 100).toFixed(2)}%）</dt><dd>${formatCurrency(payFee)}</dd></div><div><dt><strong>礼品卡扣款</strong></dt><dd><strong>${formatCurrency(payTotal)}</strong></dd></div>` : `<div><dt><strong>信用卡最终扣款</strong></dt><dd><strong>${formatCurrency(payTotal)}</strong></dd></div>`}
      </dl>
      ${paymentBox}
      <div class="record-actions" style="margin-top:14px"><a href="/customer/balance/top-up" class="button button-secondary">取消并更换金额</a></div>
    </div>
    <div class="record-actions"><a href="/customer/balance" class="button button-secondary">返回余额</a></div>` : `
    ${pending ? `<div class="panel"><h3>${pending.payment_method === 'alipay' ? '支付宝' : pending.payment_method === 'wechat' ? '微信' : '银行转账'}充值待审核</h3><p>本次需转账：<strong>${formatCurrency(pendingAmount)}</strong>${pendingSquareTarget > 0 ? `（充值到账金额 ${formatCurrency(pending.amount)}，礼品卡已扣 ${formatCurrency(Number(pending.square_paid_amount || 0))}）` : ''}${pending.cny_amount ? ` / <strong>CNY ${Number(pending.cny_amount).toFixed(2)}</strong>` : ''}。提交凭证后由管理员审核。</p>${pending.payment_method === 'bank_transfer' ? `<dl class="data-list"><div><dt>银行</dt><dd>${bank.bankName || '—'}</dd></div><div><dt>账户名</dt><dd>${bank.accountName || '—'}</dd></div><div><dt>BSB</dt><dd class="mono">${bank.bsb || '—'}</dd></div><div><dt>账号</dt><dd class="mono">${bank.account || '—'}</dd></div></dl>${renderBankTransferReference(pending.transfer_code)}` : `<img src="${pending.payment_method === 'alipay' ? settings.rmbPayment.alipayQrUrl : settings.rmbPayment.wechatQrUrl}" alt="收款码" style="max-width:240px;display:block;margin:12px 0">`}<form method="post" enctype="multipart/form-data" action="/customer/balance/top-up/transfer" class="record-form"><input type="hidden" name="id" value="${pending.id}"><label class="form-label">付款 Reference</label><input class="form-control" name="reference" required maxlength="100"><label class="form-label">付款凭证图片</label><input class="form-control" name="imageFile" type="file" accept="image/jpeg,image/png,image/webp" required><label class="form-label">备注（选填）</label><textarea class="form-control" name="note" maxlength="500"></textarea><button class="button button-primary" type="submit">提交付款凭证</button></form><form method="post" action="/customer/balance/top-up/cancel" class="record-actions" style="margin-top:12px" data-site-confirm="取消本次待付款充值？取消后可重新选择。"><input type="hidden" name="id" value="${pending.id}"><button class="button button-secondary" name="next" value="top-up" type="submit">取消并更换金额/方式</button><button class="button button-secondary" name="next" value="balance" type="submit">取消并返回余额</button></form></div>` : `<div class="panel"><form method="post" action="/customer/balance/top-up" class="record-form"><label class="form-label" for="amount">充值金额（AUD）</label><input class="form-control" id="amount" name="amount" type="number" min="1" max="10000" step="0.01" required placeholder="例如 100.00"><p class="form-text">礼品卡手续费以付款金额为准。</p><div class="rmb-amount" id="rmbAmount" hidden></div><div class="record-actions"><button class="button button-primary" name="method" value="card" type="submit" ${settings.paymentMethods.stripe ? '' : 'disabled'}>信用卡充值</button><button class="button button-primary" name="method" value="square" type="submit" ${settings.paymentMethods.square ? '' : 'disabled'}>礼品卡充值</button><button class="button button-secondary" name="method" value="bank_transfer" type="submit" ${settings.paymentMethods.bankTransfer ? '' : 'disabled'}>银行转账充值</button><button class="button button-secondary rmb-method" name="method" value="alipay" type="submit" ${settings.paymentMethods.alipay && settings.rmbPayment.alipayQrUrl ? '' : 'disabled'}>支付宝充值</button><button class="button button-secondary rmb-method" name="method" value="wechat" type="submit" ${settings.paymentMethods.wechat && settings.rmbPayment.wechatQrUrl ? '' : 'disabled'}>微信充值</button></div></form><script>(()=>{const amount=document.getElementById('amount'),out=document.getElementById('rmbAmount');document.querySelectorAll('.rmb-method').forEach(b=>b.addEventListener('click',async()=>{if(!amount.value)return;const r=await fetch('/api/payment/aud-cny?amount='+encodeURIComponent(amount.value));if(r.ok){const d=await r.json();out.hidden=false;out.textContent='预计到账金额：CNY '+Number(d.cnyAmount).toFixed(2)+'（实时汇率）';}}));})();</script></div>`}
    <div class="record-actions"><a href="/customer/balance" class="button button-secondary">返回余额</a></div>${squareReloadScript}`}`
  return buildLayout('余额充值 - 电脑租赁管理系统', body, user)
}
