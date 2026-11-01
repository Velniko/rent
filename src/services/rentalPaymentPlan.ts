/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

import type { Context } from 'hono'
import { getOrderById, getDeviceById, getSystemSettings } from '../site'
import { rentalPricingSnapshot } from '../domain/monthlyRental'
import { stripeRequest } from '../stripe'

export const RENTAL_PAYMENT_CHOICE_DAYS = 60

export function canChooseRentalPaymentPlan(order: { rentalPeriod?: unknown; status?: string }): boolean {
  return Number(order.rentalPeriod) >= RENTAL_PAYMENT_CHOICE_DAYS && ['draft', 'pending_approval', 'approved', 'awaiting_signature', 'pending_payment'].includes(String(order.status))
}

export async function setRentalPaymentPlan(c: Context, order: any, requested: unknown) {
  const mode = String(requested || '')
  if (!['MONTHLY', 'FULL'].includes(mode)) throw new Error('请选择月付或一次性付清')
  if (mode === 'MONTHLY' && !getSystemSettings().paymentMethods.stripe) throw new Error('Stripe 支付当前未启用')
  if (!canChooseRentalPaymentPlan(order)) throw new Error('租期满60天且未付款时可修改付款计划')
  const paid = await c.env.RENT.prepare("SELECT id FROM payments WHERE rental_id = ? AND status IN ('paid', 'refunded') LIMIT 1").bind(order.id).first()
  if (paid) throw new Error('已有付款，不能修改付款计划')
  const device = await getDeviceById(c, order.deviceId)
  if (!device) throw new Error('设备不存在')
  let pricing: any = {}
  try { pricing = JSON.parse(order.rental_pricing_json || rentalPricingSnapshot(device)) } catch { throw new Error('订单定价信息无效') }
  if (order.billing_mode === mode && pricing.billingMode === mode) return order
  // 停用旧表单后再改金额，避免两种付款计划同时可以扣款。
  const payments = ((await c.env.RENT.prepare("SELECT * FROM payments WHERE rental_id = ? AND status IN ('pending', 'failed') AND (stripe_checkout_session_id IS NOT NULL OR stripe_payment_intent_id IS NOT NULL)").bind(order.id).all()).results || []) as any[]
  for (const payment of payments) {
    let intentId = payment.stripe_payment_intent_id
    if (payment.stripe_checkout_session_id) {
      const session = await stripeRequest(c, `checkout/sessions/${encodeURIComponent(payment.stripe_checkout_session_id)}`)
      if (session.status === 'complete') throw new Error('Stripe 正在确认付款，请稍后重试')
      if (session.status === 'open') await stripeRequest(c, `checkout/sessions/${encodeURIComponent(session.id)}/expire`, new URLSearchParams())
      intentId = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id || intentId
    }
    if (intentId) {
      const intent = await stripeRequest(c, `payment_intents/${encodeURIComponent(intentId)}`)
      if (['succeeded', 'processing'].includes(intent.status)) throw new Error('Stripe 正在确认付款，请稍后重试')
      if (intent.status !== 'canceled') await stripeRequest(c, `payment_intents/${encodeURIComponent(intentId)}/cancel`, new URLSearchParams(), `payment-plan-cancel-${intentId}`)
    }
  }
  const originalDeposit = Number(pricing.depositAmountBeforeWaiver ?? (Number(order.depositAmount) > 0 ? order.depositAmount : device.depositAmount))
  const deposit = mode === 'FULL' ? 0 : originalDeposit
  const total = Number((Number(order.totalAmount) - Number(order.depositAmount || 0) + deposit).toFixed(2))
  if (!Number.isFinite(total) || total < 0 || !Number.isFinite(originalDeposit) || originalDeposit < 0) throw new Error('订单金额无效')
  const snapshot = JSON.stringify({ ...pricing, billingMode: mode, depositAmountBeforeWaiver: originalDeposit })
  const result = await c.env.RENT.prepare(`UPDATE orders SET billing_mode = ?, rental_pricing_json = ?, depositAmount = ?, totalAmount = ?, deposit_payment_mode = 'PAID', deposit_status = ?, deposit_held_amount = 0, stripe_deposit_payment_intent_id = NULL, paymentMethod = CASE WHEN ? = 'MONTHLY' THEN 'card' ELSE paymentMethod END, payment_provider = CASE WHEN ? = 'MONTHLY' THEN 'stripe' ELSE payment_provider END, updatedAt = CURRENT_TIMESTAMP
    WHERE id = ? AND status IN ('draft', 'pending_approval', 'approved', 'awaiting_signature', 'pending_payment')
    AND NOT EXISTS (SELECT 1 FROM payments WHERE rental_id = orders.id AND status IN ('paid', 'refunded'))`)
    .bind(mode, snapshot, deposit, total, deposit > 0 ? 'PENDING' : 'NOT_REQUIRED', mode, mode, order.id).run()
  if (!result.meta?.changes) throw new Error('已有付款，不能修改付款计划')
  const actor = c.get?.('user') as any
  await c.env.RENT.batch([
    c.env.RENT.prepare("DELETE FROM rental_installments WHERE order_id = ? AND status != 'paid'").bind(order.id),
    c.env.RENT.prepare("UPDATE payments SET status = 'failed', updated_at = CURRENT_TIMESTAMP WHERE rental_id = ? AND status = 'pending'").bind(order.id),
    c.env.RENT.prepare("INSERT INTO audit_logs (id, actor_id, actor_role, action, target_type, target_id, before_json, after_json, reason) VALUES (?, ?, ?, 'RENTAL_PAYMENT_PLAN_SELECTED', 'ORDER', ?, ?, ?, '客户选择付款计划')")
      .bind(`audit-${crypto.randomUUID()}`, actor?.id || null, actor?.role || null, order.id, JSON.stringify({ billingMode: order.billing_mode, depositAmount: order.depositAmount }), JSON.stringify({ billingMode: mode, depositAmount: deposit })),
  ])
  return (await getOrderById(c, order.id))!
}
