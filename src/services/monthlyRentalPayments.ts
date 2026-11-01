/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

import type { Context } from 'hono'
import { buildMonthlyRentalInstallments, rentalPricingSnapshot, type RentalInstallment } from '../domain/monthlyRental'
import { getDeviceById, getOrderById, getSystemSettings, loadSystemSettingsFromDB, ensureOrderNumber, issueInvoice, recordFinancialLedgerEntry, recordDeviceLifecycle, enqueueRentalUserCreation, generateReferenceNumber, logError } from '../site'
import { stripeRequest, getStripePublishableKey } from '../stripe'
import { upsertStripeCheckout } from './stripeCheckout'
import { createNotification } from './notifications'

const cents = (value: unknown) => Math.round(Number(value || 0) * 100)
const feeRate = () => Math.min(1, Math.max(0, Number(getSystemSettings().paymentMethods.processingFeeRate ?? 0.025)))

export async function getRentalInstallments(c: Context, orderId: string): Promise<RentalInstallment[]> {
  return ((await c.env.RENT.prepare('SELECT * FROM rental_installments WHERE order_id = ? ORDER BY installment_number').bind(orderId).all()).results || []) as RentalInstallment[]
}

export async function prepareMonthlyRental(c: Context, order: any): Promise<RentalInstallment[]> {
  const paid = await c.env.RENT.prepare("SELECT id FROM payments WHERE rental_id = ? AND status = 'paid' LIMIT 1").bind(order.id).first()
  if (paid) throw new Error('已有付款，请刷新订单')
  const device = await getDeviceById(c, order.deviceId)
  if (!device) throw new Error('设备不存在')
  const plan = buildMonthlyRentalInstallments({ ...order, deposit_method: 'card_hold' }, device, feeRate())
  // 停用旧的全额付款表单，不能留下仍然可以扣整段租金的入口。
  const legacy = ((await c.env.RENT.prepare("SELECT * FROM payments WHERE rental_id = ? AND status = 'pending' AND id NOT IN (SELECT payment_id FROM rental_installments WHERE payment_id IS NOT NULL)").bind(order.id).all()).results || []) as any[]
  for (const payment of legacy) {
    if (payment.stripe_checkout_session_id) {
      const session = await stripeRequest(c, `checkout/sessions/${payment.stripe_checkout_session_id}`)
      if (session.status === 'complete') throw new Error('Stripe 正在确认付款，请稍后重试')
      if (session.status === 'open') await stripeRequest(c, `checkout/sessions/${session.id}/expire`, new URLSearchParams())
    }
    if (payment.stripe_payment_intent_id) {
      const intent = await stripeRequest(c, `payment_intents/${payment.stripe_payment_intent_id}`)
      if (['succeeded', 'processing'].includes(intent.status)) throw new Error('Stripe 正在确认付款，请稍后重试')
      if (intent.status !== 'canceled') await stripeRequest(c, `payment_intents/${intent.id}/cancel`, new URLSearchParams())
    }
    await c.env.RENT.prepare("UPDATE payments SET status = 'failed' WHERE id = ? AND status = 'pending'").bind(payment.id).run()
  }
  await c.env.RENT.batch([
    c.env.RENT.prepare("UPDATE orders SET billing_mode = 'MONTHLY', rental_pricing_json = COALESCE(rental_pricing_json, ?), deposit_method = 'card_hold', deposit_payment_mode = 'PAID', deposit_status = CASE WHEN depositAmount > 0 THEN 'PENDING' ELSE 'NOT_REQUIRED' END WHERE id = ? AND status = 'pending_payment'").bind(rentalPricingSnapshot(device), order.id),
    ...plan.map(part => c.env.RENT.prepare(`INSERT INTO rental_installments (id, order_id, installment_number, due_date, period_end, rental_amount, deposit_amount, processing_fee, amount) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET due_date = excluded.due_date, period_end = excluded.period_end, rental_amount = excluded.rental_amount, deposit_amount = excluded.deposit_amount, processing_fee = excluded.processing_fee, amount = excluded.amount WHERE rental_installments.status IN ('pending', 'failed')`)
      .bind(part.id, part.order_id, part.installment_number, part.due_date, part.period_end, part.rental_amount, part.deposit_amount, part.processing_fee, part.amount)),
  ])
  return getRentalInstallments(c, order.id)
}

async function ensureInstallmentPayment(c: Context, order: any, part: RentalInstallment): Promise<any> {
  const paymentId = part.payment_id || `p-${part.id}`
  await c.env.RENT.batch([
    c.env.RENT.prepare(`INSERT INTO payments (id, rental_id, customer_id, payment_method, amount, rental_amount, deposit_amount, processing_fee, currency, status) VALUES (?, ?, ?, 'card', ?, ?, ?, ?, 'AUD', 'pending')
      ON CONFLICT(id) DO UPDATE SET amount = excluded.amount, rental_amount = excluded.rental_amount, deposit_amount = excluded.deposit_amount, processing_fee = excluded.processing_fee WHERE payments.status IN ('pending', 'failed')`)
      .bind(paymentId, order.id, order.userId, part.amount, part.rental_amount, part.deposit_amount, part.processing_fee),
    c.env.RENT.prepare('UPDATE rental_installments SET payment_id = ? WHERE id = ?').bind(paymentId, part.id),
  ])
  return c.env.RENT.prepare('SELECT * FROM payments WHERE id = ?').bind(paymentId).first()
}

async function installmentIntent(c: Context, order: any, part: RentalInstallment, payment: any, customerId: string): Promise<any> {
  if (payment.stripe_payment_intent_id) return stripeRequest(c, `payment_intents/${payment.stripe_payment_intent_id}`)
  const params = new URLSearchParams({ amount: String(cents(part.amount)), currency: 'aud', customer: customerId, payment_method: order.stripe_payment_method_id, 'payment_method_types[0]': 'card', setup_future_usage: 'off_session', 'metadata[type]': 'rental_installment', 'metadata[installment_id]': part.id, 'metadata[order_id]': order.id, 'metadata[customer_id]': order.userId, 'metadata[payment_record_id]': payment.id, description: `设备租赁订单 ${order.orderNo || order.id}｜第 ${part.installment_number} 期租金` })
  // 创建与确认分开，先落库真实 PI，Webhook 即使早于确认响应也能核验。
  const intent = await stripeRequest(c, 'payment_intents', params, `monthly-create-${part.id}`)
  await c.env.RENT.batch([c.env.RENT.prepare('UPDATE payments SET stripe_payment_intent_id = ? WHERE id = ?').bind(intent.id, payment.id), c.env.RENT.prepare('UPDATE rental_installments SET stripe_payment_intent_id = ? WHERE id = ?').bind(intent.id, part.id)])
  return intent
}

export async function createMonthlyRentalCheckout(c: Context, user: any, order: any, customerId: string, installmentId?: string, confirmNow = false) {
  const plan = order.status === 'pending_payment' ? await prepareMonthlyRental(c, order) : await getRentalInstallments(c, order.id)
  const part = plan.find(row => installmentId ? row.id === installmentId : row.installment_number === 1)
  if (!part || part.status === 'cancelled' || order.return_received_at || ['completed', 'cancelled', 'returned', 'pending_return'].includes(order.status)) throw new Error('该订单当前不能支付')
  if (part.status === 'paid') return { clientSecret: '', publishableKey: '', amountCents: cents(part.amount), alreadyPaid: true }
  if (part.installment_number > 1 && part.due_date > melbourneToday()) throw new Error('尚未到付款日期')
  if (plan.some(earlier => earlier.installment_number < part.installment_number && earlier.status !== 'paid')) throw new Error('请先支付上一期租金')
  const payment = await ensureInstallmentPayment(c, order, part)
  let intent: any
  if (!payment.stripe_checkout_session_id && (payment.stripe_payment_intent_id || (confirmNow && order.stripe_payment_method_id))) {
    intent = await installmentIntent(c, order, part, payment, customerId)
    if (confirmNow && ['requires_confirmation', 'requires_payment_method'].includes(intent.status)) intent = await stripeRequest(c, `payment_intents/${intent.id}/confirm`, new URLSearchParams({ off_session: 'true' }), `monthly-confirm-${part.id}`)
    if (intent.status === 'processing') throw new Error('Stripe 正在确认付款，请稍后重试')
    if (intent.status === 'canceled') throw new Error('该笔付款已取消，请联系工作人员')
  } else {
    intent = await upsertStripeCheckout(c, {
      existingSessionId: payment.stripe_checkout_session_id, customerId, amountCents: cents(part.amount),
      items: [
        { name: `设备月租（${part.due_date} 至 ${part.period_end}）`, amountCents: cents(part.rental_amount) },
        { name: '押金', amountCents: cents(part.deposit_amount) },
        { name: '信用卡支付手续费', amountCents: cents(part.processing_fee) },
      ].filter(item => item.amountCents > 0),
      metadata: { type: 'rental_installment', installment_id: part.id, payment_record_id: payment.id, order_id: order.id, customer_id: user.id },
      returnUrl: new URL(`/customer/orders/${encodeURIComponent(order.id)}`, c.req.url).href,
      idempotencyKey: part.id, setupFutureUsage: 'off_session',
      description: `设备租赁订单 ${order.orderNo || order.id}｜第 ${part.installment_number} 期租金${part.deposit_amount ? '及押金' : ''}`,
    })
    await c.env.RENT.prepare('UPDATE payments SET stripe_checkout_session_id = ?, stripe_payment_intent_id = ? WHERE id = ?').bind(intent.checkout_session_id, intent.id, payment.id).run()
  }
  if (intent.status === 'succeeded') await settleRentalInstallment(c, intent)
  return { clientSecret: intent.status === 'succeeded' ? '' : intent.client_secret, publishableKey: await getStripePublishableKey(c), amountCents: cents(part.amount), alreadyPaid: intent.status === 'succeeded' }
}

export async function settleRentalInstallment(c: Context, intent: any): Promise<void> {
  const part = await c.env.RENT.prepare('SELECT * FROM rental_installments WHERE id = ?').bind(String(intent.metadata?.installment_id || '')).first() as RentalInstallment | null
  const payment = part?.payment_id ? await c.env.RENT.prepare('SELECT * FROM payments WHERE id = ?').bind(part.payment_id).first() as any : null
  const order = part ? await getOrderById(c, part.order_id) : null
  const stripeCustomer = typeof intent.customer === 'string' ? intent.customer : intent.customer?.id
  const customer = order ? await c.env.RENT.prepare('SELECT stripe_customer_id FROM users WHERE id = ?').bind(order.userId).first() as any : null
  if (!part || !payment || !order || intent.metadata?.type !== 'rental_installment' || intent.status !== 'succeeded' || intent.currency !== 'aud' || Number(intent.amount_received) !== cents(part.amount)
      || Number(intent.amount) !== cents(part.amount) || cents(payment.amount) !== cents(part.amount) || payment.stripe_payment_intent_id !== intent.id
      || intent.metadata?.order_id !== order.id || intent.metadata?.customer_id !== order.userId || intent.metadata?.payment_record_id !== payment.id
      || payment.customer_id !== order.userId || payment.rental_id !== order.id || cents(payment.rental_amount) !== cents(part.rental_amount) || cents(payment.deposit_amount) !== cents(part.deposit_amount) || cents(payment.processing_fee) !== cents(part.processing_fee)
      || !stripeCustomer || stripeCustomer !== customer?.stripe_customer_id) throw new Error('Stripe 月付数据不匹配')
  const paymentMethod = typeof intent.payment_method === 'string' ? intent.payment_method : intent.payment_method?.id
  if (!/^pm_[A-Za-z0-9_]+$/.test(paymentMethod || '')) throw new Error('Stripe 月付数据不匹配')
  if (payment.status === 'refunded') return
  await c.env.RENT.batch([
    c.env.RENT.prepare("UPDATE payments SET status = 'paid', transaction_id = COALESCE(transaction_id, ?), paid_at = COALESCE(paid_at, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status IN ('pending', 'failed')").bind(generateReferenceNumber('TXN'), payment.id),
    c.env.RENT.prepare("UPDATE rental_installments SET status = 'paid', stripe_payment_intent_id = ?, paid_at = COALESCE(paid_at, CURRENT_TIMESTAMP), last_error = NULL WHERE id = ?").bind(intent.id, part.id),
    c.env.RENT.prepare("UPDATE orders SET stripe_payment_method_id = ?, deposit_payment_mode = 'PAID', deposit_status = CASE WHEN ? > 0 AND deposit_status IN ('PENDING', 'NOT_REQUIRED') THEN 'PAID' ELSE deposit_status END, deposit_held_amount = CASE WHEN ? > 0 THEN ? ELSE deposit_held_amount END, deposit_paid_at = CASE WHEN ? > 0 THEN COALESCE(deposit_paid_at, CURRENT_TIMESTAMP) ELSE deposit_paid_at END, updatedAt = CURRENT_TIMESTAMP WHERE id = ?")
      .bind(paymentMethod, part.deposit_amount, part.deposit_amount, part.deposit_amount, part.deposit_amount, order.id),
    ...(part.installment_number === 1 ? [c.env.RENT.prepare("UPDATE orders SET status = 'paid', order_status = 'CONFIRMED', payment_status = 'PAID', rental_status = 'READY_FOR_PICKUP', paymentMethod = 'card', updatedAt = CURRENT_TIMESTAMP WHERE id = ? AND status = 'pending_payment'").bind(order.id), c.env.RENT.prepare("UPDATE coupon_redemptions SET status = 'REDEEMED', redeemed_at = CURRENT_TIMESTAMP WHERE order_id = ? AND status = 'RESERVED'").bind(order.id)] : []),
  ])
  // 流水按本期实际收款登记；重放 Webhook 复用付款来源，不重复计入整段租金。
  await recordFinancialLedgerEntry(c, { entryType: 'PAYMENT', amount: part.amount, customerId: order.userId, orderId: order.id, sourceType: 'RENTAL_INSTALLMENT', sourceId: part.id, description: '月租付款', metadata: { paymentId: payment.id, depositAmount: part.deposit_amount, processingFee: part.processing_fee } })
  await ensureOrderNumber(c, order.id, intent.id)
  if (part.installment_number === 1 && order.status === 'pending_payment') {
    await recordDeviceLifecycle(c, order.deviceId, 'RESERVED', { orderId: order.id, reason: '首期月租付款成功' })
    await enqueueRentalUserCreation(c, await getOrderById(c, order.id))
  }
  await issueInvoice(c, order.id)
}

export function melbourneToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Melbourne', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}

async function installmentFailure(c: Context, part: RentalInstallment, order: any, message: string): Promise<void> {
  const result = await c.env.RENT.prepare("UPDATE rental_installments SET status = 'failed', last_error = ? WHERE id = ? AND status != 'paid'").bind(message.slice(0, 300), part.id).run()
  if (!result.meta?.changes) return
  await c.env.RENT.prepare("UPDATE payments SET status = 'failed', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'pending'").bind(part.payment_id || `p-${part.id}`).run()
  await createNotification(c, { recipientId: order.userId, type: 'payment_failed', title: '月租扣款未完成', message: `第 ${part.installment_number} 期租金 AUD ${part.amount.toFixed(2)} 未支付，请前往订单完成付款。`, orderId: order.id, dedupeKey: `installment-failed:${part.id}` })
  const admins = ((await c.env.RENT.prepare("SELECT id FROM users WHERE role = 'ADMIN' AND status = 'active'").all()).results || []) as any[]
  for (const admin of admins) await createNotification(c, { recipientId: admin.id, type: 'payment_failed', title: '月租扣款未完成', message: `订单 ${order.orderNo || order.id} 第 ${part.installment_number} 期未支付。`, orderId: order.id, dedupeKey: `installment-failed:${part.id}:${admin.id}` })
}

export async function chargeDueRentalInstallments(c: Context): Promise<number> {
  await loadSystemSettingsFromDB(c)
  if (!getSystemSettings().paymentMethods.stripe) return 0
  const rows = ((await c.env.RENT.prepare(`SELECT i.* FROM rental_installments i JOIN orders o ON o.id = i.order_id
    WHERE i.installment_number > 1 AND i.due_date <= ? AND o.billing_mode = 'MONTHLY' AND o.deleted_at IS NULL
    AND o.status IN ('paid', 'pending_pickup', 'active', 'extended', 'overdue', 'suspended') AND o.return_received_at IS NULL
    AND (i.status = 'pending' OR (i.status = 'processing' AND i.attempted_at < datetime('now', '-15 minutes')))
    AND NOT EXISTS (SELECT 1 FROM rental_installments earlier WHERE earlier.order_id = i.order_id AND earlier.installment_number < i.installment_number AND earlier.status != 'paid')
    ORDER BY i.due_date LIMIT 50`).bind(melbourneToday()).all()).results || []) as RentalInstallment[]
  let count = 0
  for (const part of rows) {
    const claim = await c.env.RENT.prepare("UPDATE rental_installments SET status = 'processing', attempted_at = CURRENT_TIMESTAMP WHERE id = ? AND (status = 'pending' OR (status = 'processing' AND attempted_at < datetime('now', '-15 minutes')))").bind(part.id).run()
    if (!claim.meta?.changes) continue
    const order = await getOrderById(c, part.order_id) as any
    if (!order || order.return_received_at || !['paid', 'pending_pickup', 'active', 'extended', 'overdue', 'suspended'].includes(order.status)) {
      await c.env.RENT.prepare("UPDATE rental_installments SET status = 'cancelled' WHERE id = ? AND status = 'processing'").bind(part.id).run()
      continue
    }
    try {
      if (cents(part.amount) === 0) {
        await c.env.RENT.prepare("UPDATE rental_installments SET status = 'paid', paid_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'processing'").bind(part.id).run()
        count++
        continue
      }
      const customer = await c.env.RENT.prepare('SELECT stripe_customer_id FROM users WHERE id = ?').bind(order.userId).first() as any
      if (!customer?.stripe_customer_id || !order.stripe_payment_method_id) throw new Error('缺少已保存的信用卡')
      const payment = await ensureInstallmentPayment(c, order, part)
      let intent = await installmentIntent(c, order, part, payment, customer.stripe_customer_id)
      if (['requires_confirmation', 'requires_payment_method'].includes(intent.status)) intent = await stripeRequest(c, `payment_intents/${intent.id}/confirm`, new URLSearchParams({ off_session: 'true' }), `monthly-confirm-${part.id}`)
      if (intent.status === 'succeeded') { await settleRentalInstallment(c, intent); count++ }
      else if (intent.status !== 'processing') await installmentFailure(c, part, order, '请重新完成信用卡付款')
    } catch (error: any) {
      await installmentFailure(c, part, order, error.message || '信用卡扣款失败')
      await logError(c, 'ERROR', '月租自动扣款未完成', error, { orderId: order.id, installmentId: part.id })
    }
  }
  return count
}
