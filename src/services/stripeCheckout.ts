/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

import type { Context } from 'hono'
import { stripeRequest } from '../stripe'

const CHECKOUT_VERSION = '2026-10-28.endive'
export const CHECKOUT_INTEGRATION = 'rent_checkout_v1'
export type StripeCheckoutItem = { name: string; amountCents: number }

// Checkout 自己创建 PaymentIntent。创建 Session 时 PI 可能尚不存在，不能用 cs_ 冒充 pi_。
export async function upsertStripeCheckout(c: Context, opts: {
  existingSessionId?: string
  amountCents: number
  customerId: string
  metadata: Record<string, string>
  items: StripeCheckoutItem[]
  returnUrl: string
  idempotencyKey: string
  description?: string
  captureMethod?: 'manual'
  setupFutureUsage?: 'off_session'
}): Promise<any> {
  if (!opts.items.length || opts.items.some(item => !item.name.trim() || !Number.isSafeInteger(item.amountCents) || item.amountCents <= 0)
      || opts.items.reduce((sum, item) => sum + item.amountCents, 0) !== opts.amountCents) throw new Error('Stripe 付款明细与合计不匹配')
  const params = new URLSearchParams({
    mode: 'payment', ui_mode: 'elements', customer: opts.customerId,
    return_url: opts.returnUrl, 'adaptive_pricing[enabled]': 'false',
    'metadata[integration]': CHECKOUT_INTEGRATION,
    'payment_intent_data[metadata][integration]': CHECKOUT_INTEGRATION,
  })
  opts.items.forEach((item, index) => {
    params.set(`line_items[${index}][price_data][currency]`, 'aud')
    params.set(`line_items[${index}][price_data][unit_amount]`, String(item.amountCents))
    params.set(`line_items[${index}][price_data][product_data][name]`, item.name)
    params.set(`line_items[${index}][quantity]`, '1')
  })
  for (const [key, value] of Object.entries(opts.metadata)) {
    params.set(`metadata[${key}]`, value)
    params.set(`payment_intent_data[metadata][${key}]`, value)
  }
  if (opts.description) params.set('payment_intent_data[description]', opts.description)
  if (opts.setupFutureUsage) params.set('payment_intent_data[setup_future_usage]', opts.setupFutureUsage)
  if (opts.captureMethod) {
    params.set('payment_intent_data[capture_method]', opts.captureMethod)
    params.set('payment_method_types[0]', 'card')
    params.set('payment_method_options[card][request_extended_authorization]', 'if_available')
  }
  params.sort()
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(params.toString()))
  const fingerprint = Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, '0')).join('')
  params.set('metadata[request_fingerprint]', fingerprint)
  const previousId = opts.existingSessionId || ''
  if (previousId) {
    const current = await stripeRequest(c, `checkout/sessions/${encodeURIComponent(previousId)}?expand[]=payment_intent`, undefined, undefined, CHECKOUT_VERSION)
    if (current.status === 'complete') {
      const intent = current.payment_intent
      if (!intent?.id) throw new Error('Stripe 正在确认付款，请稍后重试')
      return { ...intent, checkout_session_id: current.id }
    }
    if (current.status === 'open' && current.metadata?.request_fingerprint === fingerprint) {
      if (Number(current.amount_total) !== opts.amountCents || current.currency !== 'aud' || !current.client_secret) throw new Error('Stripe 付款摘要数据不匹配')
      return { id: typeof current.payment_intent === 'string' ? current.payment_intent : current.payment_intent?.id || null, client_secret: current.client_secret, status: 'requires_payment_method', checkout_session_id: current.id }
    }
    // 价格变化先停用旧 Session，禁止两份不同金额的支付表单同时有效。
    if (current.status === 'open') await stripeRequest(c, `checkout/sessions/${encodeURIComponent(previousId)}/expire`, new URLSearchParams(), undefined, CHECKOUT_VERSION)
  }
  const session = await stripeRequest(c, 'checkout/sessions', params, `${opts.idempotencyKey}-checkout-${previousId || 'new'}-${fingerprint.slice(0, 32)}`, CHECKOUT_VERSION)
  if (!session?.client_secret || !session?.id) throw new Error('Stripe 未返回有效支付凭据')
  return { id: null, client_secret: session.client_secret, status: 'requires_payment_method', checkout_session_id: session.id }
}

// PI Webhook 可能先于 checkout.session.completed。通过已落库的 Session 校验归属，
// 再关联真实 PI，让原有的金额核验、预授权、充值和发票逻辑继续处理。
export async function linkStripeCheckoutIntent(c: Context, intent: any): Promise<void> {
  if (intent?.metadata?.integration !== CHECKOUT_INTEGRATION) return
  const topupId = String(intent.metadata.topup_id || '')
  const recordId = topupId || String(intent.metadata.payment_record_id || '')
  const table = topupId ? 'balance_topups' : 'payments'
  const record = await c.env.RENT.prepare(`SELECT * FROM ${table} WHERE id = ?`).bind(recordId).first() as any
  if (!record?.stripe_checkout_session_id) throw new Error('Stripe 付款摘要记录不存在')
  const session = await stripeRequest(c, `checkout/sessions/${encodeURIComponent(record.stripe_checkout_session_id)}`, undefined, undefined, CHECKOUT_VERSION)
  const paymentIntentId = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id
  const customerId = String(topupId ? record.user_id : record.customer_id)
  const expectedCents = topupId && record.payment_method === 'square' && Number(record.square_paid_amount || 0) > 0
    ? Number(intent.metadata.remainder_amount)
    : Math.round((Number(record.amount) + (topupId ? Number(record.processing_fee || 0) : 0)) * 100)
  if (paymentIntentId !== intent.id || String(session.metadata?.customer_id || '') !== customerId
      || String(intent.metadata.customer_id || '') !== customerId || session.metadata?.integration !== CHECKOUT_INTEGRATION
      || Number(session.amount_total) !== Number(intent.amount) || (!record.stripe_payment_intent_id && Number(session.amount_total) !== expectedCents) || session.currency !== 'aud' || intent.currency !== 'aud'
      || (record.stripe_payment_intent_id && record.stripe_payment_intent_id !== intent.id)) throw new Error('Stripe 付款摘要数据不匹配')
  await c.env.RENT.prepare(`UPDATE ${table} SET stripe_payment_intent_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND stripe_checkout_session_id = ? AND (stripe_payment_intent_id IS NULL OR stripe_payment_intent_id = ?)`).bind(intent.id, recordId, session.id, intent.id).run()
}

export async function expireStripeCheckout(c: Context, sessionId: unknown): Promise<void> {
  if (!/^cs_[A-Za-z0-9_]+$/.test(String(sessionId || ''))) return
  const session = await stripeRequest(c, `checkout/sessions/${sessionId}`, undefined, undefined, CHECKOUT_VERSION)
  if (session.status === 'open') await stripeRequest(c, `checkout/sessions/${sessionId}/expire`, new URLSearchParams(), undefined, CHECKOUT_VERSION)
}
