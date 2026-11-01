/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

import type { Context } from 'hono'
import { buildRefundAllocation, canTransitionOrder, issueCreditNote, createNotification, logError } from '../site'
import { stripeRequest } from '../stripe'

export const CUSTOMER_REFUND_STATUSES: Record<string, string> = { pending: '退款申请待审核', processing: '退款处理中', approved: '退款申请已通过', rejected: '退款申请已驳回' }
export const REFUND_METHOD_LABELS: Record<string, string> = { stripe: '信用卡（Stripe）', bank_transfer: '银行转账', alipay: '支付宝', wechat: '微信', balance: '账户余额' }
export function canRequestCustomerRefund(order: any): boolean {
  return Boolean(order && !order.deleted_at && !order.handover_completed_at && ['draft', 'pending_approval', 'approved', 'awaiting_signature', 'pending_payment', 'paid', 'pending_pickup'].includes(order.status) && canTransitionOrder(order.status, 'cancelled'))
}

export interface CustomerRefundPayment { id: string; amount: number; processingFee: number; method: string; channel: string; intent: string; status: string; authorization: boolean; refundAmount: number; releaseAmount: number; fee: number }
export interface CustomerRefundQuote { total: number; serviceFee: number; paid: number; authorized: number; released: number; fee: number; refund: number; payments: CustomerRefundPayment[] }
const cents = (value: number) => Math.round(value * 100)

export async function getCustomerRefundQuote(c: Context, order: any): Promise<CustomerRefundQuote> {
  if (!canRequestCustomerRefund(order)) throw new Error('设备已取货或订单已结束，不能申请退款')
  if (await c.env.RENT.prepare("SELECT id FROM payment_refunds WHERE order_id = ? AND status IN ('pending', 'succeeded') LIMIT 1").bind(order.id).first()) throw new Error('该订单已有退款记录，请联系管理员')
  const rows = ((await c.env.RENT.prepare("SELECT * FROM payments WHERE rental_id = ? AND (status = 'paid' OR (status = 'pending' AND payment_method = 'card' AND stripe_payment_intent_id = ? AND ? = 'PREAUTH' AND ? = 'HELD')) ORDER BY id").bind(order.id, order.stripe_deposit_payment_intent_id || '', order.deposit_payment_mode || '', order.deposit_status || '').all()).results || []) as any[]
  const total = Number(order.totalAmount), serviceFee = Number(order.serviceFee || 0)
  if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(serviceFee) || serviceFee < 0) throw new Error('订单金额无效')
  const payments: CustomerRefundPayment[] = rows.map(p => {
    const amount = Number(p.amount), method = String(p.payment_method)
    const channel = p.payment_provider === 'square' || method === 'balance' ? 'balance' : method === 'card' ? 'stripe' : method
    if (!Number.isFinite(amount) || amount <= 0 || String(p.currency).toUpperCase() !== 'AUD' || !REFUND_METHOD_LABELS[channel] || (channel === 'stripe' && !p.stripe_payment_intent_id)) throw new Error('付款记录无效，请联系管理员')
    return { id: p.id, amount, processingFee: Number(p.processing_fee || 0), method, channel, intent: String(p.stripe_payment_intent_id || ''), status: p.status, authorization: p.status === 'pending', refundAmount: 0, releaseAmount: 0, fee: 0 }
  })
  const paidCents = payments.reduce((sum, p) => sum + cents(p.amount), 0)
  if (!paidCents) throw new Error('暂无已到账付款，不能申请退款')
  const feeCents = Math.round(cents(total) * 5 / 100)
  if (feeCents > paidCents) throw new Error('已付款金额不足以扣除退款手续费，请联系管理员')
  const refundCents = paidCents - feeCents
  const allocations = refundCents > 0 ? buildRefundAllocation(payments.map(p => ({ id: p.id, amount: p.amount })), refundCents / 100) : []
  for (const payment of payments) {
    const returned = allocations.find(a => a.id === payment.id)?.amount || 0
    payment.refundAmount = payment.authorization ? 0 : returned
    payment.releaseAmount = payment.authorization ? returned : 0
    payment.fee = (cents(payment.amount) - cents(returned)) / 100
  }
  const sum = (select: (p: CustomerRefundPayment) => number) => payments.reduce((n, p) => n + cents(select(p)), 0) / 100
  return { total, serviceFee, paid: sum(p => p.authorization ? 0 : p.amount), authorized: sum(p => p.authorization ? p.amount : 0), released: sum(p => p.releaseAmount), fee: feeCents / 100, refund: sum(p => p.refundAmount), payments }
}

export async function customerRefundQuoteToken(quote: CustomerRefundQuote): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(quote)))
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

export async function getCustomerRefundRequest(c: Context, orderId: string): Promise<any> {
  return c.env.RENT.prepare('SELECT * FROM customer_refund_requests WHERE order_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1').bind(orderId).first()
}

// A delayed payment webhook must not leave a captured card payment outside the quote.
export async function prepareCustomerRefundPayments(c: Context, order: any, quote: CustomerRefundQuote): Promise<void> {
  const pending = ((await c.env.RENT.prepare("SELECT * FROM payments WHERE rental_id = ? AND payment_method = 'card' AND COALESCE(payment_provider, 'stripe') = 'stripe' AND status = 'pending'").bind(order.id).all()).results || []) as any[]
  for (const payment of pending) {
    let intentId = payment.stripe_payment_intent_id
    if (payment.stripe_checkout_session_id) {
      const checkout = await stripeRequest(c, `checkout/sessions/${encodeURIComponent(payment.stripe_checkout_session_id)}`)
      if (checkout.status === 'open') await stripeRequest(c, `checkout/sessions/${encodeURIComponent(checkout.id)}/expire`, new URLSearchParams())
      intentId = typeof checkout.payment_intent === 'string' ? checkout.payment_intent : checkout.payment_intent?.id
    }
    if (!intentId) continue
    const intent = await stripeRequest(c, `payment_intents/${encodeURIComponent(intentId)}`)
    if (intent.currency !== 'aud' || intent.metadata?.order_id !== order.id || intent.metadata?.customer_id !== order.userId || Number(intent.amount) !== cents(Number(payment.amount))) throw new Error('Stripe 支付数据与订单不匹配')
    if (intent.status === 'succeeded') {
      const amount = Number(intent.amount_received)
      if (!Number.isSafeInteger(amount) || amount <= 0 || amount > cents(Number(payment.amount))) throw new Error('Stripe 支付数据与订单不匹配')
      await c.env.RENT.prepare("UPDATE payments SET status = 'paid', amount = ?, stripe_payment_intent_id = ?, paid_at = COALESCE(paid_at, CURRENT_TIMESTAMP) WHERE id = ? AND status = 'pending'").bind(amount / 100, intentId, payment.id).run()
      throw new Error('订单或付款已变化，请驳回后重新申请')
    }
    if (quote.payments.some(p => p.id === payment.id && p.authorization)) {
      if (intent.status !== 'requires_capture') throw new Error('信用卡预授权状态已变化，请联系管理员')
    } else {
      if (!['requires_capture', 'requires_payment_method', 'requires_confirmation', 'requires_action', 'canceled'].includes(intent.status)) throw new Error('Stripe 正在确认付款，请稍后重试')
      if (intent.status !== 'canceled') await stripeRequest(c, `payment_intents/${encodeURIComponent(intentId)}/cancel`, new URLSearchParams(), `customer-refund-unused-${payment.id}`)
      await c.env.RENT.prepare("UPDATE payments SET status = 'failed' WHERE id = ? AND status = 'pending'").bind(payment.id).run()
    }
  }
}

// Completion and its source ledger entry are committed together; retries cannot credit twice.
export async function finishCustomerRefundPayment(c: Context, admin: any, refund: any): Promise<void> {
  const request = await c.env.RENT.prepare('SELECT * FROM customer_refund_requests WHERE id = ?').bind(refund.customer_request_id).first() as any
  if (!request || !['processing', 'approved'].includes(request.status)) throw new Error('退款申请尚未通过审核')
  const amount = Number(refund.refund_amount)
  const results = await c.env.RENT.batch([
    ...(refund.refund_method === 'balance' ? [
      c.env.RENT.prepare("UPDATE users SET balance = balance + ? WHERE id = ? AND EXISTS (SELECT 1 FROM payment_refunds WHERE id = ? AND status = 'pending')").bind(amount, request.customer_id, refund.id),
      c.env.RENT.prepare("INSERT OR IGNORE INTO balance_transactions (id, user_id, amount, balance_after, type, reason, created_by) SELECT ?, id, ?, balance, 'refund_credit', '取消订单退款（已扣 5% 手续费）', ? FROM users WHERE id = ? AND EXISTS (SELECT 1 FROM payment_refunds WHERE id = ? AND status = 'pending')").bind(`bt-${refund.id}`, amount, admin.id, request.customer_id, refund.id),
    ] : []),
    c.env.RENT.prepare("INSERT OR IGNORE INTO financial_ledger_entries (id, entry_number, entry_type, amount, customer_id, order_id, source_type, source_id, description, created_by) SELECT ?, ?, 'REFUND', ?, ?, ?, 'PAYMENT_REFUND', id, '取消订单退款（已扣 5% 手续费）', ? FROM payment_refunds WHERE id = ? AND status = 'pending'")
      .bind(`fle-${refund.id}`, `FLE-${crypto.randomUUID()}`, -amount, request.customer_id, request.order_id, admin.id, refund.id),
    c.env.RENT.prepare("UPDATE payment_refunds SET status = 'succeeded', processed_by = ? WHERE id = ? AND status = 'pending'").bind(admin.id, refund.id),
    c.env.RENT.prepare("UPDATE payments SET status = 'refunded', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND EXISTS (SELECT 1 FROM payment_refunds WHERE id = ? AND status = 'succeeded')").bind(refund.payment_id, refund.id),
  ])
  const updated = results[results.length - 2]
  if (!updated.meta?.changes) return
  await c.env.RENT.prepare("UPDATE orders SET payment_status = 'REFUNDED', deposit_status = CASE WHEN depositAmount > 0 THEN 'REFUNDED' ELSE 'NOT_REQUIRED' END, deposit_held_amount = 0, deposit_refund_at = CURRENT_TIMESTAMP WHERE id = ? AND NOT EXISTS (SELECT 1 FROM payment_refunds WHERE customer_request_id = ? AND status <> 'succeeded')").bind(request.order_id, request.id).run()
  // Invoice/email failures must not undo a refund that already completed.
  try {
    const processingFee = Number(refund.refunded_processing_fee || 0)
    if (amount > 0) await issueCreditNote(c, request.order_id, Math.max(0, amount - processingFee), processingFee, refund.id)
    await createNotification(c, { recipientId: request.customer_id, senderId: admin.id, type: 'refund_completed', title: '订单退款已完成', message: `退款 ${amount.toFixed(2)} AUD，退款手续费合计 ${Number(request.fee_amount).toFixed(2)} AUD。`, orderId: request.order_id, dedupeKey: `customer-refund-complete:${refund.id}` })
  } catch (error) { await logError(c, 'ERROR', '退款凭证或通知生成失败', error instanceof Error ? error : new Error(String(error)), { refundId: refund.id }) }
}

export async function executeCustomerRefund(c: Context, admin: any, requestId: string): Promise<void> {
  const request = await c.env.RENT.prepare("SELECT * FROM customer_refund_requests WHERE id = ? AND status IN ('processing', 'approved')").bind(requestId).first() as any
  if (!request) throw new Error('退款申请不存在或已处理')
  const refunds = ((await c.env.RENT.prepare("SELECT r.*, p.stripe_payment_intent_id FROM payment_refunds r JOIN payments p ON p.id = r.payment_id WHERE r.customer_request_id = ? AND r.status = 'pending' ORDER BY r.id").bind(request.id).all()).results || []) as any[]
  let waiting = false
  for (const refund of refunds) {
    if (!['stripe', 'balance'].includes(refund.refund_method)) continue
    const { hasOpenPaymentDispute } = await import('../actions/stripePayments')
    if (await hasOpenPaymentDispute(c, refund.payment_id)) throw new Error('该笔付款存在未解决的拒付争议，暂不能退款')
    const source = (JSON.parse(request.quote_json) as CustomerRefundQuote).payments.find(p => p.id === refund.payment_id)
    if (source?.authorization) {
      let intent = await stripeRequest(c, `payment_intents/${encodeURIComponent(source.intent)}`)
      if (intent.currency !== 'aud' || intent.metadata?.order_id !== request.order_id || intent.metadata?.customer_id !== request.customer_id || Number(intent.amount) !== cents(source.amount)) throw new Error('Stripe 支付数据与订单不匹配')
      if (intent.status === 'requires_capture') {
        intent = source.fee > 0
          ? await stripeRequest(c, `payment_intents/${encodeURIComponent(source.intent)}/capture`, new URLSearchParams({ amount_to_capture: String(cents(source.fee)) }), `customer-refund-capture-${refund.id}`)
          : await stripeRequest(c, `payment_intents/${encodeURIComponent(source.intent)}/cancel`, new URLSearchParams(), `customer-refund-release-${refund.id}`)
      }
      if (source.fee > 0 ? intent.status !== 'succeeded' || Number(intent.amount_received) !== cents(source.fee) : intent.status !== 'canceled') throw new Error('信用卡预授权状态已变化，请联系管理员')
      await c.env.RENT.prepare("UPDATE payments SET amount = ?, rental_amount = ?, deposit_amount = 0, processing_fee = 0, status = 'refunded', updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(source.fee, source.fee, source.id).run()
    }
    if (refund.refund_method === 'stripe' && Number(refund.refund_amount) > 0) {
      // Recover a successful remote refund after a lost response or D1 write failure.
      let remote = refund.stripe_refund_id ? await stripeRequest(c, `refunds/${encodeURIComponent(refund.stripe_refund_id)}`) : null
      if (!remote) {
        const list = await stripeRequest(c, `refunds?payment_intent=${encodeURIComponent(refund.stripe_payment_intent_id)}&limit=100`)
        remote = (list.data || []).find((r: any) => r.metadata?.customer_refund_id === refund.id && !['failed', 'canceled'].includes(r.status))
        if (!remote) {
          const failed = (list.data || []).find((r: any) => r.metadata?.customer_refund_id === refund.id && ['failed', 'canceled'].includes(r.status))
          remote = await stripeRequest(c, 'refunds', new URLSearchParams({ payment_intent: refund.stripe_payment_intent_id, amount: String(cents(Number(refund.refund_amount))), reason: 'requested_by_customer', 'metadata[order_id]': request.order_id, 'metadata[type]': 'cancellation', 'metadata[customer_refund_id]': refund.id }), `customer-refund-${refund.id}${failed ? `-${failed.id}` : ''}`)
        }
      }
      if (Number(remote.amount) !== cents(Number(refund.refund_amount)) || remote.currency !== 'aud' || remote.payment_intent !== refund.stripe_payment_intent_id) throw new Error('Stripe 退款金额与申请不匹配')
      await c.env.RENT.prepare('UPDATE payment_refunds SET stripe_refund_id = ? WHERE id = ?').bind(remote.id, refund.id).run()
      if (remote.status !== 'succeeded') {
        if (['failed', 'canceled'].includes(remote.status)) await c.env.RENT.prepare('UPDATE payment_refunds SET stripe_refund_id = NULL WHERE id = ?').bind(refund.id).run()
        waiting = true
        continue
      }
    }
    await finishCustomerRefundPayment(c, admin, refund)
  }
  if (waiting) throw new Error('Stripe 退款尚未成功，请稍后重试')
  await c.env.RENT.prepare("UPDATE customer_refund_requests SET status = 'approved' WHERE id = ?").bind(request.id).run()
}

export async function handleCustomerRefundWebhook(c: Context, remote: any): Promise<void> {
  const refund = await c.env.RENT.prepare(`SELECT r.*, p.stripe_payment_intent_id, cr.reviewed_by FROM payment_refunds r
    JOIN payments p ON p.id = r.payment_id JOIN customer_refund_requests cr ON cr.id = r.customer_request_id
    WHERE r.refund_method = 'stripe' AND (r.stripe_refund_id = ? OR r.id = ?) LIMIT 1`)
    .bind(String(remote.id || ''), String(remote.metadata?.customer_refund_id || '')).first() as any
  if (!refund || refund.status === 'succeeded') return
  if (Number(remote.amount) !== cents(Number(refund.refund_amount)) || remote.currency !== 'aud' || remote.payment_intent !== refund.stripe_payment_intent_id) throw new Error('Stripe 退款金额与申请不匹配')
  if (remote.status === 'succeeded') {
    await c.env.RENT.prepare('UPDATE payment_refunds SET stripe_refund_id = ? WHERE id = ?').bind(remote.id, refund.id).run()
    await finishCustomerRefundPayment(c, { id: refund.reviewed_by }, refund)
    await c.env.RENT.prepare("UPDATE customer_refund_requests SET status = 'approved' WHERE id = ? AND NOT EXISTS (SELECT 1 FROM payment_refunds WHERE customer_request_id = ? AND status = 'pending' AND refund_method IN ('stripe', 'balance'))").bind(refund.customer_request_id, refund.customer_request_id).run()
  } else if (['failed', 'canceled'].includes(remote.status)) {
    await c.env.RENT.prepare('UPDATE payment_refunds SET stripe_refund_id = NULL WHERE id = ? AND status = \'pending\'').bind(refund.id).run()
    await c.env.RENT.prepare("UPDATE customer_refund_requests SET status = 'processing' WHERE id = ?").bind(refund.customer_request_id).run()
  }
}
