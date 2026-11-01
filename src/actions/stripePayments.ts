/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

import type { Context } from 'hono'
import { nanoid } from 'nanoid'
import { ensureOrderNumber, getOrderById, getUserById, getSystemSettings, loadSystemSettingsFromDB, issueInvoice, issueCreditNote, enqueueRentalUserCreation, recordBalanceTransaction, recordExternalRentalFlow, recordFinancialLedgerEntry, generateReferenceNumber, recordDeviceLifecycle, revokeReferralRewardForOrder, claimWebhookEvent, markWebhookProcessed, markWebhookFailed, buildRefundAllocation, mapStripeDisputeStatus, applyPendingPaymentCancellation, logError, updateOrderStatus, createAuditLog } from '../site'
import { createNotification } from '../services/notifications'
import { stripeRequest, verifyStripeWebhook, getStripePublishableKey } from '../stripe'
import { squareRequest } from '../square'
import { releaseCouponForOrder } from './coupons'
import { depositAuthorizationWindowDays, depositPaymentModeForOrder, depositPaymentModeForRental, isCardDepositSettled, normalizeSecurityDepositMethod, type DepositPaymentMode } from '../domain/paymentPlan'
import { computeOrderSettlementStatus } from '../domain/orderSettlement'
import { isPickupHoldExpired, returnOverdueDays } from '../domain/pickupHold'

function cents(value: number): number {
  return Math.round(Number(value) * 100)
}

// issueInvoice / issueCreditNote 必须各自独立 try/catch，绝不能被同一个 try 块里
// 其它后处理步骤（记录设备状态、发放推荐奖励等）的异常连带跳过——那样会导致订单
// 已经 status = 'paid' 却永久没有发票，且只在 console.error 里看不见任何记录。
async function issueInvoiceSafely(c: Context, orderId: string, contextLabel: string): Promise<void> {
  try {
    await issueInvoice(c, orderId)
  } catch (error: any) {
    await logError(c, 'CRITICAL', `Stripe 发票开具失败：${contextLabel}`, error, { orderId })
  }
}

async function issueCreditNoteSafely(c: Context, orderId: string, amount: number, refundedProcessingFee: number, refundKey: string, contextLabel: string): Promise<void> {
  try {
    await issueCreditNote(c, orderId, amount, refundedProcessingFee, refundKey)
  } catch (error: any) {
    await logError(c, 'CRITICAL', `Stripe 贷记单开具失败：${contextLabel}`, error, { orderId, amount, refundedProcessingFee })
  }
}

async function completeSplitSquarePayment(c: Context, squarePaymentId: string, expectedCents: number): Promise<any> {
  if (!squarePaymentId) throw new Error('缺少礼品卡授权记录')
  let payment = await squareRequest(c, `/v2/payments/${encodeURIComponent(squarePaymentId)}`, undefined, 'GET')
  if (String(payment?.status || '').toUpperCase() !== 'COMPLETED') {
    if (String(payment?.status || '').toUpperCase() !== 'APPROVED') throw new Error('礼品卡授权尚未完成')
    payment = await squareRequest(c, `/v2/payments/${encodeURIComponent(squarePaymentId)}/complete`, {}, 'POST')
  }
  if (String(payment?.status || '').toUpperCase() !== 'COMPLETED') throw new Error('礼品卡扣款尚未完成')
  if (Number(payment?.amount_money?.amount || 0) !== expectedCents || String(payment?.amount_money?.currency || '').toUpperCase() !== 'AUD') throw new Error('礼品卡付款金额或币种不匹配')
  return payment
}

// 完善.md —— 一笔付款只要还有未结案的拒付争议，就不允许再走任何正常退款。
// 所有退款入口（押金退款、提前归还退款、取消退款、银行转账补款）统一调用。
export async function hasOpenPaymentDispute(c: Context, paymentId: string): Promise<boolean> {
  if (!paymentId) return false
  const row = await c.env.RENT.prepare(
    "SELECT 1 FROM payment_disputes WHERE payment_id = ? AND status IN ('DISPUTE_OPENED', 'DISPUTE_UNDER_REVIEW') LIMIT 1"
  ).bind(paymentId).first()
  return Boolean(row)
}

export const STRIPE_PROCESSING_FEE_RATE = 0.025
export function getStripeProcessingFeeRate(): number {
  return Math.min(1, Math.max(0, Number(getSystemSettings().paymentMethods.processingFeeRate ?? STRIPE_PROCESSING_FEE_RATE)))
}

function orderServiceFee(order: any): number {
  return Math.max(0, Number(order.serviceFee ?? order.service_fee ?? 0))
}

function orderDeposit(order: any): number {
  return Math.max(0, Number(order.depositAmount ?? order.deposit_amount ?? 0))
}

// Stripe 后台展示用的收款说明。付款成功前订单号还没生成，先用内部 id 兜底，
// 付款/预授权成功分配到正式订单号后由 refreshStripePaymentDescriptions 补写。
function orderPaymentLabel(order: any): string {
  return `设备租赁订单 ${order.orderNo || order.id}`
}

async function refreshStripePaymentDescriptions(c: Context, orderId: string): Promise<void> {
  const order = await getOrderById(c, orderId)
  if (!order?.orderNo) return
  const label = orderPaymentLabel(order)
  const rows = await c.env.RENT.prepare(
    "SELECT stripe_payment_intent_id, deposit_amount, rental_amount FROM payments WHERE rental_id = ? AND payment_method = 'card' AND stripe_payment_intent_id IS NOT NULL"
  ).bind(orderId).all() as any
  for (const row of (rows.results || []) as any[]) {
    const intentId = String(row.stripe_payment_intent_id || '')
    if (!/^pi_[A-Za-z0-9_]+$/.test(intentId)) continue
    const hasDeposit = Number(row.deposit_amount || 0) > 0
    const hasRent = Number(row.rental_amount || 0) > 0
    const item = hasDeposit && hasRent ? '租金+押金预授权' : hasDeposit ? '押金预授权' : '租金及服务费'
    await stripeRequest(c, `payment_intents/${intentId}`, new URLSearchParams({ description: `${label}｜${item}` })).catch(() => {})
  }
}

export async function resolveDepositPaymentMode(c: Context, order: any, paymentMethodId = ''): Promise<DepositPaymentMode> {
  const rentalPeriod = Number(order.rentalPeriod ?? order.rental_period ?? 0)
  const savedPaymentMethodId = paymentMethodId || String(order.stripe_payment_method_id || '')
  let cardBrand = ''
  if (/^pm_[A-Za-z0-9_]+$/.test(savedPaymentMethodId)) {
    const paymentMethod = await stripeRequest(c, `payment_methods/${savedPaymentMethodId}`).catch(() => null)
    cardBrand = String(paymentMethod?.card?.brand || '')
  }
  return depositPaymentModeForRental(rentalPeriod, true, cardBrand)
}

// 余额充值改用站内 Payment Element：创建（或按金额变化更新）一个 PaymentIntent，
// 返回 client_secret + publishable key 给页面初始化 Stripe.js，不再跳转 Stripe 托管页。
export async function createBalanceTopUpIntent(c: Context, user: any, topUpId: string): Promise<{ clientSecret: string; publishableKey: string; amountCents: number }> {
  await loadSystemSettingsFromDB(c)
  if (!getSystemSettings().paymentMethods.stripe) throw new Error('信用卡支付当前未启用')
  const topup = await c.env.RENT.prepare("SELECT * FROM balance_topups WHERE id = ? AND user_id = ? AND status = 'pending'").bind(topUpId, user.id).first() as any
  if (!topup) throw new Error('充值记录不存在或已处理')
  const baseCents = cents(Number(topup.amount))
  const squareTargetCents = baseCents + Math.round(baseCents * Number(getSystemSettings().paymentMethods.squareProcessingFeeRate ?? 0.022))
  const squarePaidCents = Math.max(0, cents(Number(topup.square_paid_amount || 0)))
  const isSquareRemainder = String(topup.payment_method) === 'square' && squarePaidCents > 0
  const feeCents = isSquareRemainder ? 0 : Math.round(baseCents * getStripeProcessingFeeRate())
  const chargedCents = isSquareRemainder ? Math.max(0, squareTargetCents - squarePaidCents) : baseCents + feeCents
  if (!Number.isInteger(chargedCents) || chargedCents <= 0) throw new Error('充值金额无效')

  const intent = await upsertPaymentIntent(c, {
    existingIntentId: topup.stripe_payment_intent_id ? String(topup.stripe_payment_intent_id) : '',
    amountCents: chargedCents,
    receiptEmail: user.email,
    metadata: {
      topup_id: topUpId,
      customer_id: String(user.id),
      processing_fee: String(feeCents),
      ...(isSquareRemainder ? { type: 'square_residual_topup', square_payment_id: String(topup.transaction_id || ''), target_amount: String(squareTargetCents), square_approved_amount: String(squarePaidCents), remainder_amount: String(chargedCents) } : {}),
    },
    idempotencyKey: `${isSquareRemainder ? 'square-residual-topup' : 'topup-pi'}-${topUpId}`,
    description: isSquareRemainder ? `账户余额充值｜礼品卡差额｜${topUpId}` : `账户余额充值｜${topUpId}`,
  })
  await c.env.RENT.prepare("UPDATE balance_topups SET stripe_payment_intent_id = ?, processing_fee = ?, status = 'pending', updated_at = CURRENT_TIMESTAMP WHERE id = ?")
    .bind(intent.id, feeCents / 100, topUpId).run()
  return { clientSecret: intent.client_secret as string, publishableKey: await getStripePublishableKey(c), amountCents: chargedCents }
}

// 创建或复用一个处于可支付状态的 PaymentIntent。金额可能因优惠码 / 时段服务费在
// 签约那一步发生变化，所以已存在的 PI 会先尝试改金额；若它已经进入处理 / 成功等
// 不可改状态，则新建一个。
async function upsertPaymentIntent(c: Context, opts: {
  existingIntentId?: string
  amountCents: number
  receiptEmail?: string
  metadata: Record<string, string>
  idempotencyKey: string
  paymentMethodId?: string
  customerId?: string
  confirmNow?: boolean
  setupFutureUsage?: 'off_session'
  captureMethod?: 'manual'
  description?: string
}): Promise<any> {
  const reusableStatuses = ['requires_payment_method', 'requires_confirmation', 'requires_action', 'processing']
  if (opts.existingIntentId) {
    const current = await stripeRequest(c, `payment_intents/${opts.existingIntentId}`).catch(() => null)
    if (current && reusableStatuses.includes(String(current.status)) && String(current.status) !== 'processing') {
      const params = new URLSearchParams({ amount: String(opts.amountCents), currency: 'aud' })
      if (opts.paymentMethodId) params.set('payment_method', opts.paymentMethodId)
      if (opts.customerId) params.set('customer', opts.customerId)
      if (opts.setupFutureUsage) params.set('setup_future_usage', opts.setupFutureUsage)
      if (opts.captureMethod) {
        params.set('capture_method', opts.captureMethod)
        params.set('payment_method_types[0]', 'card')
        params.set('automatic_payment_methods[enabled]', 'false')
        params.set('payment_method_options[card][request_extended_authorization]', 'if_available')
      }
      if (opts.description) params.set('description', opts.description)
      if (opts.confirmNow) { params.set('confirm', 'true'); params.set('off_session', 'true') }
      Object.entries(opts.metadata).forEach(([key, value]) => params.set(`metadata[${key}]`, value))
      if (opts.receiptEmail) params.set('receipt_email', opts.receiptEmail)
      const updated = await stripeRequest(c, `payment_intents/${opts.existingIntentId}`, params)
      if (updated?.client_secret) return updated
    } else if (current?.status === 'requires_capture') {
      if (Number(current.amount) !== opts.amountCents || String(current.currency).toLowerCase() !== 'aud' || current.metadata?.type !== opts.metadata.type) throw new Error('已有信用卡预授权，金额或支付方式变更前请先取消原授权')
      return current
    } else if (current && current.status === 'succeeded') {
      // 已经付过款：直接返回，调用方据此判断无需再收款。
      return current
    }
  }
  const params = new URLSearchParams({
    amount: String(opts.amountCents),
    currency: 'aud',
    'automatic_payment_methods[enabled]': 'true',
  })
  if (opts.paymentMethodId) params.set('payment_method', opts.paymentMethodId)
  if (opts.customerId) params.set('customer', opts.customerId)
  if (opts.setupFutureUsage) params.set('setup_future_usage', opts.setupFutureUsage)
  if (opts.captureMethod) {
    params.set('capture_method', opts.captureMethod)
    params.delete('automatic_payment_methods[enabled]')
    params.set('payment_method_types[0]', 'card')
    params.set('payment_method_options[card][request_extended_authorization]', 'if_available')
  }
  if (opts.description) params.set('description', opts.description)
  if (opts.confirmNow) { params.set('confirm', 'true'); params.set('off_session', 'true') }
  if (opts.receiptEmail) params.set('receipt_email', opts.receiptEmail)
  Object.entries(opts.metadata).forEach(([key, value]) => params.set(`metadata[${key}]`, value))
  const created = await stripeRequest(c, 'payment_intents', params, `${opts.idempotencyKey}-${nanoid(8)}`)
  if (!created?.client_secret) throw new Error('Stripe 未返回有效支付凭据')
  return created
}

/** 兼容旧订单：仅为尚未建立完整订单授权的订单创建押金预授权。 */
async function createDepositAuthorization(c: Context, order: any, paymentMethodId: string): Promise<void> {
  if (normalizeSecurityDepositMethod(order.deposit_method, 'card_hold') !== 'card_hold') return
  const depositAmount = orderDeposit(order)
  if (depositAmount <= 0) {
    await c.env.RENT.prepare("UPDATE orders SET deposit_payment_mode = 'PREAUTH', deposit_status = 'NOT_REQUIRED', deposit_held_amount = 0 WHERE id = ?").bind(order.id).run()
    return
  }
  const existingId = String((order as any).stripe_deposit_payment_intent_id || '')
  if (existingId) {
    const existing = await stripeRequest(c, `payment_intents/${existingId}`).catch(() => null)
    if (existing && ['requires_capture', 'succeeded'].includes(String(existing.status))) return
  }
  const paymentMethod = await stripeRequest(c, `payment_methods/${paymentMethodId}`)
  const customer = await getUserById(c, order.userId)
  if (!customer) throw new Error('无法读取押金预授权对应的客户资料')
  const customerId = await ensureStripeCustomerForPaymentMethod(c, customer, paymentMethodId)
  const cardBrand = String(paymentMethod.card?.brand || '').toLowerCase()
  const authorizationWindowDays = depositAuthorizationWindowDays(cardBrand)
  const rentalPeriod = Number(order.rentalPeriod ?? order.rental_period ?? 0)
  const requiresExtendedWindow = rentalPeriod > authorizationWindowDays
  const createParams = new URLSearchParams({
    amount: String(cents(depositAmount)),
    currency: 'aud',
    ...(customerId ? { customer: customerId } : {}),
    payment_method: paymentMethodId,
    // 手动扣款（预授权）不是所有账户默认启用的自动支付方式（Klarna / Afterpay / Link 等）都支持，
    // 不显式限定为 card 会导致 Stripe 报 "not eligible for the requested card features"。
    'payment_method_types[0]': 'card',
    capture_method: 'manual',
    description: `${orderPaymentLabel(order)}｜押金预授权`,
    'metadata[order_id]': String(order.id),
    'metadata[type]': 'deposit_authorization',
    'metadata[deposit_amount]': String(cents(depositAmount)),
    'metadata[card_brand]': cardBrand || 'unknown',
    'metadata[authorization_window_days]': String(authorizationWindowDays),
  })
  // 先创建（不 confirm），再单独 confirm——这样"先尝试延长授权、失败后退回标准授权"这两次
  // 尝试落在同一个 PaymentIntent 上，不会在 Stripe 后台留下一个作废的重复对象。
  const created = await stripeRequest(c, 'payment_intents', createParams, `deposit-auth-${order.id}`)
  const confirmParams = () => new URLSearchParams({ off_session: 'true', 'expand[]': 'latest_charge' })
  let intent: any
  try {
    const params = confirmParams()
    if (authorizationWindowDays === 30 && requiresExtendedWindow) params.set('payment_method_options[card][request_extended_authorization]', 'if_available')
    intent = await stripeRequest(c, `payment_intents/${created.id}/confirm`, params, `deposit-auth-confirm-${order.id}`)
  } catch (error) {
    if (!(authorizationWindowDays === 30 && requiresExtendedWindow)) {
      await stripeRequest(c, `payment_intents/${created.id}/cancel`, new URLSearchParams()).catch(() => {})
      throw error
    }
    try {
      intent = await stripeRequest(c, `payment_intents/${created.id}/confirm`, confirmParams(), `deposit-auth-confirm-standard-${order.id}`)
    } catch (retryError) {
      await stripeRequest(c, `payment_intents/${created.id}/cancel`, new URLSearchParams()).catch(() => {})
      throw retryError
    }
  }
  if (!['requires_capture', 'succeeded'].includes(String(intent.status))) throw new Error('押金预授权未完成，请重新验证信用卡。')
  if (requiresExtendedWindow) {
    const cardDetails = intent.latest_charge?.payment_method_details?.card
    const captureBefore = Number(cardDetails?.capture_before || 0)
    const extendedEnabled = String(cardDetails?.extended_authorization?.status || '').toLowerCase() === 'enabled'
    const requiredCaptureBefore = Math.floor(Date.now() / 1000) + rentalPeriod * 86400
    if (!extendedEnabled || captureBefore < requiredCaptureBefore) {
      if (intent.status === 'requires_capture') await stripeRequest(c, `payment_intents/${intent.id}/cancel`, new URLSearchParams())
      await c.env.RENT.prepare("UPDATE orders SET deposit_payment_mode = 'SETUP_INTENT', stripe_deposit_payment_intent_id = NULL, deposit_status = 'NOT_REQUIRED', deposit_held_amount = 0 WHERE id = ?").bind(order.id).run()
      return
    }
  }
  const paymentId = `p-${nanoid(12)}`
  await c.env.RENT.batch([
    c.env.RENT.prepare(`INSERT OR IGNORE INTO payments (id, rental_id, customer_id, payment_method, amount, deposit_amount, rental_amount, currency, status, stripe_payment_intent_id)
      VALUES (?, ?, ?, 'card', ?, ?, 0, 'AUD', 'pending', ?)`)
      .bind(paymentId, order.id, order.userId, depositAmount, depositAmount, intent.id),
    c.env.RENT.prepare("UPDATE orders SET deposit_payment_mode = 'PREAUTH', stripe_deposit_payment_intent_id = ?, deposit_status = 'HELD', deposit_paid_at = COALESCE(deposit_paid_at, CURRENT_TIMESTAMP), deposit_held_amount = ? WHERE id = ?")
      .bind(intent.id, depositAmount, order.id),
  ])
}

/** 长期订单先用 SetupIntent 验证并保存卡片，再单独收取租金。 */
export async function createOrderSetupIntent(c: Context, user: any, orderId: string): Promise<{ clientSecret: string; publishableKey: string }> {
  await loadSystemSettingsFromDB(c)
  if (!getSystemSettings().paymentMethods.stripe) throw new Error('Stripe 支付当前未启用')
  if (user?.role !== 'CUSTOMER') throw new Error('Stripe 付款必须使用客户资料')
  const order = await getOrderById(c, orderId)
  if (!order || order.userId !== user.id) throw new Error('订单不存在或无权访问')
  if (order.status !== 'pending_payment') throw new Error('该订单当前不能支付')
  if (depositPaymentModeForOrder(order) !== 'SETUP_INTENT') throw new Error('该订单不需要长期租赁卡片验证')

  const existingId = String((order as any).stripe_setup_intent_id || '')
  if (/^seti_[A-Za-z0-9_]+$/.test(existingId)) {
    const existing = await stripeRequest(c, `setup_intents/${existingId}`).catch(() => null)
    if (existing && existing.customer && ['requires_payment_method', 'requires_confirmation', 'requires_action'].includes(String(existing.status)) && existing.client_secret) {
      const existingCustomerId = stripeCustomerId(existing.customer)
      await syncStripeCustomerProfile(c, existingCustomerId, user)
      await c.env.RENT.prepare('UPDATE users SET stripe_customer_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(existingCustomerId, user.id).run()
      return { clientSecret: existing.client_secret, publishableKey: await getStripePublishableKey(c) }
    }
  }
  const customer = await ensureStripeCustomerForPaymentMethod(c, user, '')
  const intent = await stripeRequest(c, 'setup_intents', new URLSearchParams({
    customer,
    usage: 'off_session',
    'automatic_payment_methods[enabled]': 'true',
    'metadata[order_id]': String(order.id),
    'metadata[customer_id]': String(user.id),
    'metadata[type]': 'rental_setup',
  }), `order-setup-${order.id}`)
  await c.env.RENT.prepare('UPDATE orders SET stripe_setup_intent_id = ? WHERE id = ?').bind(intent.id, order.id).run()
  return { clientSecret: intent.client_secret as string, publishableKey: await getStripePublishableKey(c) }
}

function stripeCustomerId(customer: any): string {
  return typeof customer === 'string' ? customer : String(customer?.id || '')
}

export function stripeCustomerProfile(user: any): URLSearchParams {
  return new URLSearchParams({
    email: String(user.email || ''),
    name: String(user.name || ''),
    phone: String(user.phone || ''),
    'metadata[source]': 'rent-rental-payment',
    'metadata[user_id]': String(user.id || ''),
  })
}

async function syncStripeCustomerProfile(c: Context, customerId: string, user: any): Promise<void> {
  if (!/^cus_[A-Za-z0-9_]+$/.test(customerId)) throw new Error('Stripe 客户资料无效，请重试')
  await stripeRequest(c, `customers/${customerId}`, stripeCustomerProfile(user))
}

async function ensureStripeCustomerForPaymentMethod(c: Context, user: any, paymentMethodId: string): Promise<string> {
  const userId = String(user.id || '')
  const email = String(user.email || '').trim().toLowerCase()

  if (paymentMethodId) {
    const paymentMethod = await stripeRequest(c, `payment_methods/${paymentMethodId}`)
    const existingCustomer = stripeCustomerId(paymentMethod.customer)
    if (existingCustomer) {
      await syncStripeCustomerProfile(c, existingCustomer, user)
      await c.env.RENT.prepare('UPDATE users SET stripe_customer_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(existingCustomer, userId).run()
      return existingCustomer
    }
  }

  const storedCustomerId = String(user.stripe_customer_id || user.stripeCustomerId || '')
  if (storedCustomerId) {
    const existing = await stripeRequest(c, `customers/${encodeURIComponent(storedCustomerId)}`).catch(() => null)
    if (existing?.id) {
      await syncStripeCustomerProfile(c, storedCustomerId, user)
      if (paymentMethodId) await stripeRequest(c, `payment_methods/${paymentMethodId}/attach`, new URLSearchParams({ customer: storedCustomerId }), `rent-payment-method-attach-${paymentMethodId}`)
      return storedCustomerId
    }
  }

  // 兼容迁移前已经创建过的客户：只复用本系统标记过的 Stripe Customer，
  // 避免仅凭邮箱误用其他系统的客户资料。
  if (email) {
    const existingCustomers = await stripeRequest(c, `customers?email=${encodeURIComponent(email)}&limit=10`).catch(() => null)
    const existing = (existingCustomers?.data || []).find((candidate: any) =>
      String(candidate?.metadata?.user_id || '') === userId || String(candidate?.metadata?.source || '') === 'rent-rental-payment'
    )
    if (existing?.id) {
      const existingId = String(existing.id)
      await syncStripeCustomerProfile(c, existingId, user)
      if (paymentMethodId) await stripeRequest(c, `payment_methods/${paymentMethodId}/attach`, new URLSearchParams({ customer: existingId }), `rent-payment-method-attach-${paymentMethodId}`)
      await c.env.RENT.prepare('UPDATE users SET stripe_customer_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(existingId, userId).run()
      return existingId
    }
  }

  const customer = await stripeRequest(c, 'customers', stripeCustomerProfile(user), `rent-customer-${userId || crypto.randomUUID()}`)
  const customerId = String(customer.id || '')
  if (!/^cus_[A-Za-z0-9_]+$/.test(customerId)) throw new Error('Stripe 客户资料创建失败，请重试')
  if (paymentMethodId) await stripeRequest(c, `payment_methods/${paymentMethodId}/attach`, new URLSearchParams({ customer: customerId }), `rent-payment-method-attach-${paymentMethodId}`)
  await c.env.RENT.prepare('UPDATE users SET stripe_customer_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(customerId, userId).run()
  return customerId
}

/** 校验长期订单的 SetupIntent 后，使用已保存的 PaymentMethod 收取租金。 */
export async function completeOrderSetupIntent(c: Context, user: any, orderId: string, setupIntentId: string): Promise<{ alreadyPaid?: boolean; clientSecret?: string; publishableKey?: string }> {
  if (!/^seti_[A-Za-z0-9_]+$/.test(setupIntentId)) throw new Error('信用卡验证信息无效，请重新验证')
  if (user?.role !== 'CUSTOMER') throw new Error('Stripe 付款必须使用客户资料')
  const order = await getOrderById(c, orderId)
  if (!order || order.userId !== user.id) throw new Error('订单不存在或无权访问')
  if (depositPaymentModeForOrder(order) !== 'SETUP_INTENT') throw new Error('该订单不是长期租赁订单')
  const intent = await stripeRequest(c, `setup_intents/${setupIntentId}`)
  if (String(intent.metadata?.order_id || '') !== String(order.id) || String(intent.metadata?.customer_id || '') !== String(user.id)) throw new Error('信用卡验证信息与订单不匹配')
  const paymentMethodId = typeof intent.payment_method === 'string' ? intent.payment_method : String(intent.payment_method?.id || '')
  if (intent.status !== 'succeeded' || !/^pm_[A-Za-z0-9_]+$/.test(paymentMethodId)) throw new Error('请先完成信用卡验证')
  const depositMode = await resolveDepositPaymentMode(c, order, paymentMethodId)
  await c.env.RENT.prepare('UPDATE orders SET stripe_setup_intent_id = ?, stripe_payment_method_id = ? WHERE id = ?')
    .bind(setupIntentId, paymentMethodId, order.id).run()
  await c.env.RENT.prepare('UPDATE orders SET deposit_payment_mode = ? WHERE id = ?').bind(depositMode, order.id).run()
  return createOrderPaymentIntent(c, user, order.id, true)
}

// 订单支付（自助结账 + 签约付款步骤共用）：为一笔待付款订单创建 / 更新 PaymentIntent，
// 并把 payments 行的金额、手续费、stripe_payment_intent_id 落库为 pending。
export async function createOrderPaymentIntent(c: Context, user: any, orderId: string, confirmNow = false): Promise<{ clientSecret: string; publishableKey: string; amountCents: number; alreadyPaid?: boolean; authorized?: boolean }> {
  await loadSystemSettingsFromDB(c)
  if (!getSystemSettings().paymentMethods.stripe) throw new Error('Stripe 支付当前未启用')
  if (user?.role !== 'CUSTOMER') throw new Error('Stripe 付款必须使用客户资料')
  const order = await getOrderById(c, orderId)
  if (!order || order.userId !== user.id) throw new Error('订单不存在或无权访问')
  if (order.status === 'paid') return { clientSecret: '', publishableKey: '', amountCents: 0, alreadyPaid: true }
  if (order.status !== 'pending_payment') throw new Error('该订单当前不能支付')

  // Square 礼品卡先扣租金及服务费；之后只为“礼品卡差额 + 押金”建立
  // 一笔 Stripe PaymentIntent，避免重复收取已经由礼品卡支付的金额。
  if (String(order.paymentProvider || order.payment_provider || '') === 'square') {
    const squarePayment = await c.env.RENT.prepare("SELECT * FROM payments WHERE rental_id = ? AND payment_provider = 'square' AND payment_method = 'card' ORDER BY created_at DESC LIMIT 1").bind(order.id).first() as any
    const squarePaidCents = Math.max(0, cents(Number(squarePayment?.square_paid_amount || 0)))
    const squareTargetCents = squarePayment ? Math.max(0, cents(Number(squarePayment.amount || 0))) : 0
    if (squarePayment && squarePaidCents > 0 && squareTargetCents > 0) {
      const remainingRentalCents = Math.max(0, squareTargetCents - squarePaidCents)
      const depositCents = String((order as any).deposit_status || '').toUpperCase() === 'PENDING' ? cents(orderDeposit(order)) : 0
      const remainderCents = remainingRentalCents + depositCents
      if (remainderCents <= 0) return { clientSecret: '', publishableKey: '', amountCents: 0, alreadyPaid: true }
      const existing = await c.env.RENT.prepare("SELECT * FROM payments WHERE rental_id = ? AND payment_provider = 'stripe' AND payment_method = 'card' AND status = 'pending' AND deposit_amount = ? AND rental_amount = ? ORDER BY created_at DESC LIMIT 1").bind(order.id, depositCents / 100, remainingRentalCents / 100).first() as any
      const intent = await upsertPaymentIntent(c, {
        existingIntentId: existing?.stripe_payment_intent_id ? String(existing.stripe_payment_intent_id) : '',
        amountCents: remainderCents,
        receiptEmail: user.email,
        metadata: { order_id: String(order.id), customer_id: String(user.id), type: 'square_residual_order', square_payment_id: String(squarePayment.square_payment_id || squarePayment.transaction_id || ''), target_amount: String(squareTargetCents), square_approved_amount: String(squarePaidCents), remainder_amount: String(remainderCents), deposit_amount: String(depositCents) },
        idempotencyKey: `square-residual-order-${order.id}`,
        description: `${orderPaymentLabel(order)}｜礼品卡差额及押金`,
      })
      const paymentId = String(existing?.id || `p-${nanoid(12)}`)
      const paymentStatus = intent.status === 'succeeded' ? 'paid' : 'pending'
      if (existing) {
        await c.env.RENT.prepare("UPDATE payments SET stripe_payment_intent_id = ?, amount = ?, deposit_amount = ?, rental_amount = ?, processing_fee = 0, status = ?, paid_at = CASE WHEN ? = 'paid' THEN COALESCE(paid_at, CURRENT_TIMESTAMP) ELSE paid_at END, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(intent.id, remainderCents / 100, depositCents / 100, remainingRentalCents / 100, paymentStatus, paymentStatus, paymentId).run()
      } else {
        await c.env.RENT.prepare("INSERT INTO payments (id, rental_id, customer_id, payment_method, payment_provider, amount, deposit_amount, rental_amount, processing_fee, currency, status, paid_at, stripe_payment_intent_id, square_payment_id) VALUES (?, ?, ?, 'card', 'stripe', ?, ?, ?, 0, 'AUD', ?, CASE WHEN ? = 'paid' THEN CURRENT_TIMESTAMP ELSE NULL END, ?, ?)").bind(paymentId, order.id, user.id, remainderCents / 100, depositCents / 100, remainingRentalCents / 100, paymentStatus, paymentStatus, intent.id, String(squarePayment.square_payment_id || squarePayment.transaction_id || '')).run()
      }
      if (paymentStatus === 'paid') return { clientSecret: '', publishableKey: '', amountCents: remainderCents, alreadyPaid: true }
      return { clientSecret: intent.client_secret as string, publishableKey: await getStripePublishableKey(c), amountCents: remainderCents }
    }
  }

  const depositAmount = orderDeposit(order)
  const savedPaymentMethodId = String((order as any).stripe_payment_method_id || '')
  const stripeCustomerId = await ensureStripeCustomerForPaymentMethod(c, user, savedPaymentMethodId)
  const depositMethod = normalizeSecurityDepositMethod(order.deposit_method, 'card_hold')
  const depositMode = depositMethod === 'card_hold' ? await resolveDepositPaymentMode(c, order, savedPaymentMethodId) : 'PAID'
  if (depositMode === 'SETUP_INTENT' && !savedPaymentMethodId) throw new Error('该订单需要先验证并保存信用卡')
  const { baseCents, feeCents, chargedCents } = stripePaymentAmounts(order.totalAmount, depositAmount, orderServiceFee(order))
  if (!Number.isInteger(baseCents) || baseCents <= 0) throw new Error('订单金额无效')
  const fullAuthorization = depositMode === 'PREAUTH' && depositAmount > 0
  if (depositMode !== depositPaymentModeForOrder(order)) {
    await c.env.RENT.prepare('UPDATE orders SET deposit_payment_mode = ? WHERE id = ?').bind(depositMode, order.id).run()
  }
  if (depositMode === 'SETUP_INTENT') {
    await c.env.RENT.prepare("UPDATE orders SET deposit_status = 'NOT_REQUIRED', deposit_held_amount = 0 WHERE id = ?").bind(order.id).run()
  }

  // 短期订单只建立一笔完整预授权：授权上限包含租金、押金和租金手续费。
  const existing = await c.env.RENT.prepare("SELECT id, stripe_payment_intent_id, status, rental_amount FROM payments WHERE rental_id = ? AND payment_method = 'card' AND COALESCE(payment_provider, 'stripe') = 'stripe' AND rental_amount > 0 ORDER BY created_at DESC LIMIT 1").bind(order.id).first() as any
  // 只有已经覆盖当前租金及配送费的 Stripe 付款才不能把原 PaymentIntent 改成预授权；
  // 不完整或其它支付渠道的历史记录不能让本次收款漏掉租金。
  const existingPaidCoversRental = paidRentalPaymentCoversOrder(existing, order.totalAmount, depositAmount)
  const reuseExistingPayment = Boolean(existing && (existing.status !== 'paid' || existingPaidCoversRental))
  const useFullAuthorization = fullAuthorization && !existingPaidCoversRental
  const authorizationCents = useFullAuthorization
    ? stripeAuthorizationAmount(order.totalAmount, depositAmount, orderServiceFee(order))
    : chargedCents

  // 旧官网申请只冻结押金；先释放旧授权，再建立合并授权，避免同时冻结两笔押金。
  const legacyAuthorizationId = String((order as any).stripe_deposit_payment_intent_id || '')
  if (useFullAuthorization && legacyAuthorizationId && legacyAuthorizationId !== String(existing?.stripe_payment_intent_id || '')) {
    const legacyPayment = await c.env.RENT.prepare("SELECT id FROM payments WHERE rental_id = ? AND stripe_payment_intent_id = ? AND status = 'pending' AND rental_amount = 0 AND deposit_amount > 0").bind(order.id, legacyAuthorizationId).first() as any
    if (legacyPayment) {
      const legacyIntent = await stripeRequest(c, `payment_intents/${legacyAuthorizationId}`)
      if (String(legacyIntent.metadata?.order_id || '') !== order.id || Number(legacyIntent.amount) !== cents(depositAmount) || String(legacyIntent.currency).toLowerCase() !== 'aud') throw new Error('Stripe 订单预授权数据不匹配')
      if (legacyIntent.status === 'requires_capture') await stripeRequest(c, `payment_intents/${legacyAuthorizationId}/cancel`, new URLSearchParams(), `replace-deposit-auth-${order.id}`)
      else if (legacyIntent.status !== 'canceled') throw new Error('已有信用卡预授权，金额或支付方式变更前请先取消原授权')
      await c.env.RENT.batch([
        c.env.RENT.prepare("UPDATE payments SET status = 'failed', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'pending'").bind(legacyPayment.id),
        c.env.RENT.prepare("UPDATE orders SET stripe_deposit_payment_intent_id = NULL, deposit_status = 'PENDING', deposit_held_amount = 0 WHERE id = ? AND stripe_deposit_payment_intent_id = ?").bind(order.id, legacyAuthorizationId),
      ])
    }
  }

  const intent = await upsertPaymentIntent(c, {
    existingIntentId: reuseExistingPayment && existing?.stripe_payment_intent_id ? String(existing.stripe_payment_intent_id) : '',
    amountCents: authorizationCents,
    receiptEmail: user.email,
    metadata: {
      order_id: order.id,
      customer_id: String(user.id),
      processing_fee: String(feeCents),
      rental_amount: String(cents(order.totalAmount - orderDeposit(order))),
      deposit_amount: String(useFullAuthorization ? cents(depositAmount) : 0),
      service_fee: String(cents(orderServiceFee(order))),
      type: useFullAuthorization ? 'rental_authorization' : 'rental_payment',
    },
    idempotencyKey: `order-pi-${order.id}`,
    paymentMethodId: savedPaymentMethodId,
    customerId: stripeCustomerId,
    confirmNow,
    setupFutureUsage: depositMode === 'PREAUTH' ? 'off_session' : undefined,
    captureMethod: useFullAuthorization ? 'manual' : undefined,
    description: `${orderPaymentLabel(order)}｜${useFullAuthorization ? '租金+押金预授权' : '租金及服务费'}`,
  })
  const alreadyPaid = intent.status === 'succeeded'
  const authorized = useFullAuthorization && intent.status === 'requires_capture' && confirmNow
  if (authorized && (Number(intent.amount) !== authorizationCents || Number(intent.amount_capturable) !== authorizationCents || String(intent.currency).toLowerCase() !== 'aud' || intent.capture_method !== 'manual' || String(intent.metadata?.order_id || '') !== order.id || String(intent.metadata?.customer_id || '') !== String(user.id) || intent.metadata?.type !== 'rental_authorization')) throw new Error('Stripe 订单预授权数据不匹配')
  if (!alreadyPaid && !intent.client_secret) throw new Error('Stripe 未返回有效支付凭据')
  const paymentStatus = alreadyPaid ? 'paid' : 'pending'

  if (reuseExistingPayment) {
    await c.env.RENT.prepare('UPDATE payments SET stripe_payment_intent_id = ?, amount = ?, processing_fee = ?, deposit_amount = ?, rental_amount = ?, status = ?, paid_at = CASE WHEN ? = \'paid\' THEN COALESCE(paid_at, CURRENT_TIMESTAMP) ELSE paid_at END, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .bind(intent.id, authorizationCents / 100, feeCents / 100, useFullAuthorization ? depositAmount : 0, order.totalAmount - depositAmount, paymentStatus, paymentStatus, existing.id).run()
  } else {
    await c.env.RENT.prepare(`
      INSERT INTO payments (id, rental_id, customer_id, payment_method, amount, deposit_amount, rental_amount, processing_fee, currency, status, paid_at, stripe_payment_intent_id)
      VALUES (?, ?, ?, 'card', ?, ?, ?, ?, 'AUD', ?, ?, ?)
    `).bind(`p-${nanoid(12)}`, order.id, user.id, authorizationCents / 100, useFullAuthorization ? depositAmount : 0, order.totalAmount - depositAmount, feeCents / 100, paymentStatus, alreadyPaid ? new Date().toISOString() : null, intent.id).run()
  }
  if (useFullAuthorization && intent.status === 'requires_capture' && savedPaymentMethodId) {
    await c.env.RENT.prepare("UPDATE orders SET stripe_deposit_payment_intent_id = ?, deposit_payment_mode = 'PREAUTH', deposit_status = 'HELD', deposit_paid_at = COALESCE(deposit_paid_at, CURRENT_TIMESTAMP), deposit_held_amount = ? WHERE id = ?")
      .bind(intent.id, depositAmount, order.id).run()
  }
  // 官网在申请时已完成授权，Webhook 可能早于审核；审核后直接确认该授权，不再次扣款。
  if (authorized) {
    await c.env.RENT.prepare("UPDATE orders SET status = 'paid', order_status = 'CONFIRMED', payment_status = 'PAID', rental_status = 'READY_FOR_PICKUP', stripe_deposit_payment_intent_id = ?, deposit_status = 'HELD', deposit_paid_at = COALESCE(deposit_paid_at, CURRENT_TIMESTAMP), deposit_held_amount = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ? AND status = 'pending_payment'").bind(intent.id, depositAmount, order.id).run()
    await ensureOrderNumber(c, order.id, intent.id)
    await issueInvoiceSafely(c, order.id, 'createOrderPaymentIntent authorization')
    await recordDeviceLifecycle(c, order.deviceId, 'RESERVED', { orderId: order.id, reason: '信用卡预授权成功' })
    await refreshStripePaymentDescriptions(c, order.id)
    await enqueueRentalUserCreation(c, await getOrderById(c, order.id))
    return { clientSecret: '', publishableKey: '', amountCents: authorizationCents, alreadyPaid: true, authorized: true }
  }
  if (alreadyPaid) {
    // 先分配正式订单号，这样接下来（若有）单独建立的押金预授权 PaymentIntent
    // 创建时就能直接带上正式单号，不用等后面再补刷描述。
    order.orderNo = await ensureOrderNumber(c, order.id).catch(() => order.orderNo)
  }
  if (fullAuthorization && !useFullAuthorization && alreadyPaid) {
    // 租金已经扣款成功；押金预授权失败不该让整个付款请求报错，否则客户会看到"支付失败"
    // 但实际租金已经扣款的矛盾状态。留给 webhook 的兜底逻辑或人工跟进即可。
    try {
      await createDepositAuthorization(c, order, savedPaymentMethodId)
    } catch (error: any) {
      // 失败后 order.deposit_payment_mode 仍然停在 PREAUTH，但 Stripe 侧从未真正
      // 建立预授权——不记录就没人知道，日后结算押金时只会看到"未找到押金预授权记录"。
      await logError(c, 'CRITICAL', 'Deposit authorization failed after rent payment succeeded', error, { orderId: order.id })
    }
  }
  if (alreadyPaid) {
    await c.env.RENT.prepare("UPDATE orders SET status = 'paid', order_status = 'CONFIRMED', payment_status = 'PAID', rental_status = 'READY_FOR_PICKUP', updatedAt = CURRENT_TIMESTAMP WHERE id = ?").bind(order.id).run()
    // confirmNow 可能直接返回 succeeded，不一定会再触发可依赖的 webhook；
    // 付款在签约后完成时也必须在这里补开发票。开票失败不能让整个付款请求报 500——
    // 订单和付款都已落库为 paid，客户不该看到"支付失败"；失败要能被查到才能补开。
    await issueInvoiceSafely(c, order.id, 'createOrderPaymentIntent confirmNow')
    // useFullAuthorization 的合并授权在拿到正式订单号之前就已创建，这里把 Stripe
    // 侧描述统一刷新成正式的 OD 单号。
    await refreshStripePaymentDescriptions(c, order.id)
    return { clientSecret: '', publishableKey: '', amountCents: authorizationCents, alreadyPaid: true }
  }
  return { clientSecret: intent.client_secret as string, publishableKey: await getStripePublishableKey(c), amountCents: authorizationCents }
}

/** 礼品卡订单的押金单独使用 Stripe 收取；礼品卡本身不参与押金退款。 */
export async function createSquareDepositPaymentIntent(c: Context, user: any, orderId: string): Promise<{ clientSecret: string; publishableKey: string; amountCents: number; alreadyPaid?: boolean }> {
  await loadSystemSettingsFromDB(c)
  if (!getSystemSettings().paymentMethods.stripe) throw new Error('Stripe 支付当前未启用')
  if (user?.role !== 'CUSTOMER') throw new Error('Stripe 付款必须使用客户资料')
  const order = await getOrderById(c, orderId)
  if (!order || order.userId !== user.id) throw new Error('订单不存在或无权访问')
  if (String(order.paymentProvider || order.payment_provider || '') !== 'square') throw new Error('该订单不是礼品卡订单')
  if (!['pending_payment', 'paid', 'pending_pickup'].includes(String(order.status))) throw new Error('该订单当前不能支付押金')
  const depositAmount = orderDeposit(order)
  if (depositAmount <= 0 || String((order as any).deposit_status || '').toUpperCase() !== 'PENDING') throw new Error('该订单当前没有待收取的押金')
  const submittedTransferProof = await c.env.RENT.prepare("SELECT pp.id FROM payment_proofs pp JOIN payments p ON p.id = pp.payment_id WHERE p.rental_id = ? AND p.deposit_amount > 0 AND pp.status = 'submitted' LIMIT 1").bind(order.id).first()
  if (submittedTransferProof) throw new Error('押金转账凭证正在审核中，请等待审核完成后再付款')

  const amountCents = cents(depositAmount)
  const existing = await c.env.RENT.prepare("SELECT id, stripe_payment_intent_id, status FROM payments WHERE rental_id = ? AND payment_method = 'card' AND payment_provider = 'stripe' AND rental_amount = 0 AND deposit_amount > 0 ORDER BY created_at DESC LIMIT 1").bind(order.id).first() as any
  if (existing?.status === 'paid') return { clientSecret: '', publishableKey: '', amountCents, alreadyPaid: true }
  const intent = await upsertPaymentIntent(c, {
    existingIntentId: existing?.stripe_payment_intent_id ? String(existing.stripe_payment_intent_id) : '',
    amountCents,
    receiptEmail: user.email,
    metadata: { order_id: String(order.id), customer_id: String(user.id), deposit_amount: String(amountCents), type: 'square_deposit_payment' },
    idempotencyKey: `square-deposit-${order.id}`,
    description: `${orderPaymentLabel(order)}｜押金`,
  })
  const alreadyPaid = intent.status === 'succeeded'
  const paymentId = String(existing?.id || `p-${nanoid(12)}`)
  if (existing) {
    await c.env.RENT.prepare("UPDATE payments SET stripe_payment_intent_id = ?, amount = ?, deposit_amount = ?, rental_amount = 0, processing_fee = 0, status = ?, paid_at = CASE WHEN ? = 'paid' THEN COALESCE(paid_at, CURRENT_TIMESTAMP) ELSE paid_at END, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .bind(intent.id, depositAmount, depositAmount, alreadyPaid ? 'paid' : 'pending', alreadyPaid ? 'paid' : 'pending', paymentId).run()
  } else {
    await c.env.RENT.prepare("INSERT INTO payments (id, rental_id, customer_id, payment_method, payment_provider, amount, deposit_amount, rental_amount, processing_fee, currency, status, paid_at, stripe_payment_intent_id) VALUES (?, ?, ?, 'card', 'stripe', ?, ?, 0, 0, 'AUD', ?, CASE WHEN ? = 'paid' THEN CURRENT_TIMESTAMP ELSE NULL END, ?)")
      .bind(paymentId, order.id, user.id, depositAmount, depositAmount, alreadyPaid ? 'paid' : 'pending', alreadyPaid ? 'paid' : 'pending', intent.id).run()
  }
  if (alreadyPaid) {
    await c.env.RENT.prepare("UPDATE orders SET deposit_method = 'card_hold', deposit_payment_mode = 'PAID', deposit_status = 'PAID', refundMethod = 'original', deposit_paid_at = COALESCE(deposit_paid_at, CURRENT_TIMESTAMP), deposit_held_amount = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ? AND deposit_status = 'PENDING'").bind(depositAmount, order.id).run()
    return { clientSecret: '', publishableKey: '', amountCents, alreadyPaid: true }
  }
  return { clientSecret: intent.client_secret as string, publishableKey: await getStripePublishableKey(c), amountCents }
}

export function stripePaymentAmounts(orderTotal: number, depositAmount = 0, serviceFee = 0): { baseCents: number; feeCents: number; chargedCents: number } {
  const baseCents = cents(orderTotal)
  const depositCents = Math.max(0, cents(depositAmount))
  // total 已包含租金、时段服务费和押金；手续费覆盖前两项，只排除押金。
  const immediatelyPaidCents = Math.max(0, baseCents - depositCents)
  const feeCents = Math.round(immediatelyPaidCents * getStripeProcessingFeeRate())
  return { baseCents: immediatelyPaidCents, feeCents, chargedCents: immediatelyPaidCents + feeCents }
}

export function stripeAuthorizationAmount(orderTotal: number, depositAmount = 0, serviceFee = 0): number {
  const amounts = stripePaymentAmounts(orderTotal, depositAmount, serviceFee)
  return amounts.chargedCents + Math.max(0, cents(depositAmount))
}

export function paidRentalPaymentCoversOrder(payment: any, orderTotal: number, depositAmount = 0): boolean {
  const requiredRentalCents = Math.max(0, cents(orderTotal) - cents(depositAmount))
  return String(payment?.status || '').toLowerCase() === 'paid' && cents(payment?.rental_amount || 0) >= requiredRentalCents
}

const TRANSFER_PAYMENT_METHODS = new Set(['bank_transfer', 'alipay', 'wechat'])

function orderChargeableAmount(order: any): number {
  const total = Math.max(0, Number(order.totalAmount ?? order.total_amount ?? 0))
  const deposit = orderDeposit(order)
  // 押金始终在订单价格调整之外单独结算；差价只针对租金、服务费等实际收取项目。
  return Number(Math.max(0, total - deposit).toFixed(2))
}

function paymentPrincipal(payment: any): number {
  if (Number(payment.rental_amount || 0) === 0 && Number(payment.deposit_amount || 0) > 0) return 0
  const componentTotal = Number(payment.rental_amount || 0) + Number(payment.deposit_amount || 0)
  return Number((componentTotal || Math.max(0, Number(payment.amount || 0) - Number(payment.processing_fee || 0))).toFixed(2))
}

export interface OrderPriceAdjustmentSummary {
  chargeableTotal: number
  paidPrincipal: number
  refundedPrincipal: number
  netPaidPrincipal: number
  amountDue: number
  processingFee: number
  chargedAmount: number
  pendingIncrease: any | null
  pendingDepositRefund: number
}

export function summarizeOrderPriceAdjustment(order: any, payments: any[], adjustments: any[]): OrderPriceAdjustmentSummary {
  const chargeableTotal = orderChargeableAmount(order)
  const paidPrincipal = Number(payments.filter(payment => ['paid', 'refunded'].includes(String(payment.status))).reduce((sum, payment) => sum + paymentPrincipal(payment), 0).toFixed(2))
  const refundedPrincipal = Number(adjustments.filter(adjustment => adjustment.direction === 'decrease' && adjustment.status === 'succeeded' && !(adjustment.refund_method === 'pending_deposit' && !Number(adjustment.deposit_refunded || 0))).reduce((sum, adjustment) => sum + Number(adjustment.amount || 0), 0).toFixed(2))
  const netPaidPrincipal = Math.max(0, Number((paidPrincipal - refundedPrincipal).toFixed(2)))
  const amountDue = Math.max(0, Number((chargeableTotal - netPaidPrincipal).toFixed(2)))
  const processingFee = Number((amountDue ? cents(amountDue) * getStripeProcessingFeeRate() : 0).toFixed(2)) / 100
  const pendingIncrease = adjustments.find(adjustment => adjustment.direction === 'increase' && adjustment.status === 'pending') || null
  const pendingDepositRefund = Number(adjustments.filter(adjustment => adjustment.direction === 'decrease' && adjustment.status === 'succeeded' && adjustment.refund_method === 'pending_deposit' && !Number(adjustment.deposit_refunded || 0)).reduce((sum, adjustment) => sum + Number(adjustment.amount || 0), 0).toFixed(2))
  return { chargeableTotal, paidPrincipal, refundedPrincipal, netPaidPrincipal, amountDue, processingFee, chargedAmount: Number((amountDue + processingFee).toFixed(2)), pendingIncrease, pendingDepositRefund }
}

export function balanceAfterPriceAdjustment(balance: unknown, difference: unknown): number {
  return Number((Number(balance || 0) - Math.max(0, Number(difference || 0))).toFixed(2))
}

export async function getOrderPriceAdjustmentSummary(c: Context, order: any): Promise<OrderPriceAdjustmentSummary> {
  const [payments, adjustments] = await Promise.all([
    c.env.RENT.prepare("SELECT amount, deposit_amount, rental_amount, processing_fee, status FROM payments WHERE rental_id = ?").bind(order.id).all(),
    c.env.RENT.prepare("SELECT * FROM order_price_adjustments WHERE order_id = ? ORDER BY created_at DESC").bind(order.id).all(),
  ])
  return summarizeOrderPriceAdjustment(order, (payments.results || []) as any[], (adjustments.results || []) as any[])
}

async function priceAdjustmentRows(c: Context, orderId: string): Promise<any[]> {
  return ((await c.env.RENT.prepare("SELECT * FROM order_price_adjustments WHERE order_id = ? ORDER BY created_at DESC").bind(orderId).all()).results || []) as any[]
}

async function priceAdjustmentPaymentSources(c: Context, orderId: string): Promise<any[]> {
  const result = await c.env.RENT.prepare("SELECT p.*, COALESCE((SELECT SUM(ra.amount) FROM refund_allocations ra WHERE ra.payment_id = p.id), 0) AS allocated_refunds, COALESCE((SELECT SUM(a.amount) FROM order_price_adjustments a WHERE a.payment_id = p.id AND a.direction = 'decrease' AND a.status = 'succeeded'), 0) AS adjustment_refunds FROM payments p WHERE p.rental_id = ? AND p.status IN ('paid', 'refunded') ORDER BY p.created_at").bind(orderId).all()
  return (result.results || []) as any[]
}

export type OrderPriceAdjustmentRefundMethod = 'balance' | 'stripe' | 'pending_deposit'

/** 把订单修改表单中的退款选择映射到实际执行渠道，并拒绝不适用的渠道。 */
export function resolveOrderPriceAdjustmentRefundMethod(requested: unknown, orderPaymentMethod: unknown, source: any): OrderPriceAdjustmentRefundMethod {
  const choice = String(requested || '').trim()
  const paymentMethod = String(orderPaymentMethod || '').trim()
  if (!choice || choice === 'auto') {
    if (TRANSFER_PAYMENT_METHODS.has(paymentMethod)) return 'pending_deposit'
    if (source?.payment_method === 'card' && source.stripe_payment_intent_id) return 'stripe'
    return 'balance'
  }
  if (choice === 'balance') return 'balance'
  if (choice === 'pending_deposit') {
    if (!TRANSFER_PAYMENT_METHODS.has(paymentMethod)) throw new Error('只有转账类订单可以将差价并入押金退款')
    return 'pending_deposit'
  }
  if (choice === 'original') {
    if (source?.payment_method !== 'card' || !source.stripe_payment_intent_id) throw new Error('原路退款需要可用的 Stripe 信用卡付款记录')
    return 'stripe'
  }
  throw new Error('降价退款方式无效')
}

export async function createOrderPriceAdjustmentIntent(c: Context, user: any, orderId: string): Promise<{ clientSecret: string; publishableKey: string; amountCents: number; alreadyPaid?: boolean }> {
  await loadSystemSettingsFromDB(c)
  if (!getSystemSettings().paymentMethods.stripe) throw new Error('Stripe 支付当前未启用')
  if (user?.role !== 'CUSTOMER') throw new Error('差价支付必须使用客户资料')
  const order = await getOrderById(c, orderId)
  if (!order || order.userId !== user.id) throw new Error('订单不存在或无权访问')
  if (['pending_payment', 'completed', 'cancelled'].includes(String(order.status))) throw new Error('该订单当前不能支付差价')
  const summary = await getOrderPriceAdjustmentSummary(c, order)
  if (summary.amountDue <= 0) return { clientSecret: '', publishableKey: '', amountCents: 0, alreadyPaid: true }
  const feeCents = cents(summary.processingFee)
  const amountCents = cents(summary.amountDue) + feeCents
  const pending = summary.pendingIncrease
  const adjustmentId = String(pending?.id || `opa-${nanoid(12)}`)
  if (pending) {
    await c.env.RENT.prepare('UPDATE order_price_adjustments SET before_total = ?, after_total = ?, amount = ?, processing_fee = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = \'pending\'')
      .bind(Number(order.totalAmount) - summary.amountDue, Number(order.totalAmount), summary.amountDue, summary.processingFee, adjustmentId).run()
  } else {
    await c.env.RENT.prepare("INSERT INTO order_price_adjustments (id, order_id, direction, before_total, after_total, amount, processing_fee, status, created_by) VALUES (?, ?, 'increase', ?, ?, ?, ?, 'pending', ?)")
      .bind(adjustmentId, order.id, Number(order.totalAmount) - summary.amountDue, Number(order.totalAmount), summary.amountDue, summary.processingFee, user.id).run()
  }
  const existingPayment = pending?.payment_id ? await c.env.RENT.prepare('SELECT * FROM payments WHERE id = ?').bind(pending.payment_id).first() as any : null
  const intent = await upsertPaymentIntent(c, {
    existingIntentId: existingPayment?.stripe_payment_intent_id ? String(existingPayment.stripe_payment_intent_id) : '',
    amountCents,
    receiptEmail: user.email,
    customerId: await ensureStripeCustomerForPaymentMethod(c, user, ''),
    metadata: { order_id: order.id, customer_id: String(user.id), type: 'price_adjustment', adjustment_id: adjustmentId, amount: String(cents(summary.amountDue)), processing_fee: String(feeCents) },
    idempotencyKey: `price-adjustment-pi-${adjustmentId}`,
    description: `${orderPaymentLabel(order)}｜订单差价补款`,
  })
  const alreadyPaid = intent.status === 'succeeded'
  const paymentId = String(existingPayment?.id || `p-${nanoid(12)}`)
  if (existingPayment) {
    await c.env.RENT.prepare("UPDATE payments SET payment_method = 'card', amount = ?, rental_amount = ?, processing_fee = ?, stripe_payment_intent_id = ?, status = ?, paid_at = CASE WHEN ? = 'paid' THEN COALESCE(paid_at, CURRENT_TIMESTAMP) ELSE paid_at END, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .bind(amountCents / 100, summary.amountDue, summary.processingFee, intent.id, alreadyPaid ? 'paid' : 'pending', alreadyPaid ? 'paid' : 'pending', paymentId).run()
  } else {
    await c.env.RENT.prepare("INSERT INTO payments (id, rental_id, customer_id, payment_method, amount, deposit_amount, rental_amount, processing_fee, currency, status, stripe_payment_intent_id, paid_at) VALUES (?, ?, ?, 'card', ?, 0, ?, ?, 'AUD', ?, ?, CASE WHEN ? = 'paid' THEN CURRENT_TIMESTAMP ELSE NULL END)")
      .bind(paymentId, order.id, user.id, amountCents / 100, summary.amountDue, summary.processingFee, alreadyPaid ? 'paid' : 'pending', intent.id, alreadyPaid ? 'paid' : 'pending').run()
  }
  await c.env.RENT.prepare("UPDATE order_price_adjustments SET payment_id = ?, status = CASE WHEN ? = 'paid' THEN 'succeeded' ELSE status END, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(paymentId, alreadyPaid ? 'paid' : 'pending', adjustmentId).run()
  if (alreadyPaid) return { clientSecret: '', publishableKey: '', amountCents: 0, alreadyPaid: true }
  return { clientSecret: intent.client_secret as string, publishableKey: await getStripePublishableKey(c), amountCents }
}

export async function createOrderPriceAdjustmentTransferPayment(c: Context, user: any, orderId: string, requestedPaymentMethod?: string): Promise<{ paymentId: string; amount: number; cnyAmount?: number }> {
  if (user?.role !== 'CUSTOMER') throw new Error('差价支付必须使用客户资料')
  const order = await getOrderById(c, orderId)
  if (!order || order.userId !== user.id) throw new Error('订单不存在或无权访问')
  const paymentMethod = String(requestedPaymentMethod || order.paymentMethod || '').trim()
  if (['pending_payment', 'completed', 'cancelled'].includes(String(order.status)) || !TRANSFER_PAYMENT_METHODS.has(paymentMethod)) throw new Error('该订单当前不能提交转账差价')
  const summary = await getOrderPriceAdjustmentSummary(c, order)
  if (summary.amountDue <= 0) throw new Error('当前没有待支付差价')
  const adjustmentId = String(summary.pendingIncrease?.id || `opa-${nanoid(12)}`)
  if (summary.pendingIncrease) await c.env.RENT.prepare("UPDATE order_price_adjustments SET before_total = ?, after_total = ?, amount = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'pending'").bind(Number(order.totalAmount) - summary.amountDue, Number(order.totalAmount), summary.amountDue, adjustmentId).run()
  else await c.env.RENT.prepare("INSERT INTO order_price_adjustments (id, order_id, direction, before_total, after_total, amount, processing_fee, status, created_by) VALUES (?, ?, 'increase', ?, ?, ?, 0, 'pending', ?)").bind(adjustmentId, order.id, Number(order.totalAmount) - summary.amountDue, Number(order.totalAmount), summary.amountDue, user.id).run()
  const payment = summary.pendingIncrease?.payment_id ? await c.env.RENT.prepare("SELECT id FROM payments WHERE id = ? AND status = 'pending'").bind(summary.pendingIncrease.payment_id).first() as any : null
  if (payment) {
    await c.env.RENT.prepare('UPDATE payments SET payment_method = ?, amount = ?, rental_amount = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = \'pending\'').bind(paymentMethod, summary.amountDue, summary.amountDue, payment.id).run()
    return { paymentId: payment.id, amount: summary.amountDue }
  }
  const paymentId = `p-${nanoid(12)}`
  await c.env.RENT.batch([
    c.env.RENT.prepare("INSERT INTO payments (id, rental_id, customer_id, payment_method, amount, deposit_amount, rental_amount, processing_fee, currency, status) VALUES (?, ?, ?, ?, ?, 0, ?, 0, 'AUD', 'pending')").bind(paymentId, order.id, user.id, paymentMethod, summary.amountDue, summary.amountDue),
    c.env.RENT.prepare('UPDATE order_price_adjustments SET payment_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(paymentId, adjustmentId),
  ])
  return { paymentId, amount: summary.amountDue }
}

export async function applyBalanceOrderPriceIncrease(c: Context, opts: { orderId: string; beforeTotal: number; afterTotal: number; adjustmentId: string; actorId?: string | null }): Promise<{ amount: number; balanceAfter: number; paid: boolean }> {
  if (opts.afterTotal <= opts.beforeTotal) return { amount: 0, balanceAfter: 0, paid: true }
  const order = await getOrderById(c, opts.orderId)
  if (!order || String(order.paymentMethod || '') !== 'balance') throw new Error('余额差价对应的订单无效')
  const beforeOrder = { ...order, totalAmount: opts.beforeTotal }
  const difference = Number(Math.max(0, orderChargeableAmount(order) - orderChargeableAmount(beforeOrder)).toFixed(2))
  if (!difference) return { amount: 0, balanceAfter: 0, paid: true }
  const existing = await c.env.RENT.prepare('SELECT status, amount FROM order_price_adjustments WHERE id = ? AND order_id = ?').bind(opts.adjustmentId, order.id).first() as any
  if (existing?.status === 'succeeded') {
    const current = await c.env.RENT.prepare('SELECT balance FROM users WHERE id = ?').bind(order.userId).first() as any
    return { amount: Number(existing.amount || 0), balanceAfter: Number(current?.balance || 0), paid: true }
  }
  const userRow = await c.env.RENT.prepare('SELECT balance FROM users WHERE id = ?').bind(order.userId).first() as any
  const currentBalance = Number(userRow?.balance || 0)
  const balanceAfter = balanceAfterPriceAdjustment(currentBalance, difference)
  const paid = currentBalance >= difference
  const paymentId = `p-${nanoid(12)}`
  await c.env.RENT.batch([
    c.env.RENT.prepare('UPDATE users SET balance = ROUND(balance - ?, 2), updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(difference, order.userId),
    c.env.RENT.prepare("INSERT INTO balance_transactions (id, user_id, amount, balance_after, type, reason, created_by) VALUES (?, ?, ?, ?, 'rental_payment_debit', ?, ?)").bind(`bt-${nanoid(12)}`, order.userId, -difference, balanceAfter, paid ? '订单涨价，余额支付差价' : '订单涨价，余额不足形成待补差价', opts.actorId || null),
    c.env.RENT.prepare("INSERT INTO payments (id, rental_id, customer_id, payment_method, amount, deposit_amount, rental_amount, processing_fee, currency, status, transaction_id, paid_at) VALUES (?, ?, ?, 'balance', ?, 0, ?, 0, 'AUD', ?, ?, CASE WHEN ? = 'paid' THEN CURRENT_TIMESTAMP ELSE NULL END)").bind(paymentId, order.id, order.userId, difference, difference, paid ? 'paid' : 'pending', paid ? `BAL-${nanoid(10)}` : null, paid ? 'paid' : 'pending'),
    c.env.RENT.prepare("INSERT INTO order_price_adjustments (id, order_id, direction, before_total, after_total, amount, processing_fee, payment_id, status, created_by) VALUES (?, ?, 'increase', ?, ?, ?, 0, ?, ?, ?)").bind(opts.adjustmentId, order.id, opts.beforeTotal, opts.afterTotal, difference, paymentId, paid ? 'succeeded' : 'pending', opts.actorId || null),
  ])
  return { amount: difference, balanceAfter, paid }
}

export async function balancePriceAdjustmentSettlementStatements(c: Context, order: any, adjustment: any): Promise<any[]> {
  if (String(order.paymentMethod || '') !== 'balance' || String(adjustment.status || '') !== 'pending' || Number(adjustment.balance_offset_applied || 0)) return []
  const current = await c.env.RENT.prepare('SELECT balance FROM users WHERE id = ?').bind(order.userId).first() as any
  const amount = Number(adjustment.amount || 0)
  const balanceAfter = Number((Number(current?.balance || 0) + amount).toFixed(2))
  return [
    c.env.RENT.prepare('UPDATE users SET balance = ROUND(balance + ?, 2), updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(amount, order.userId),
    c.env.RENT.prepare("INSERT INTO balance_transactions (id, user_id, amount, balance_after, type, reason, created_by) VALUES (?, ?, ?, ?, 'price_adjustment_settlement', ?, NULL)").bind(`bt-pa-${adjustment.id}`, order.userId, amount, balanceAfter, '补交订单差价，冲销余额欠款'),
    c.env.RENT.prepare("UPDATE order_price_adjustments SET status = 'succeeded', balance_offset_applied = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'pending'").bind(adjustment.id),
  ]
}

export async function settleBalancePriceAdjustment(c: Context, orderId: string, adjustmentId: string): Promise<void> {
  const order = await getOrderById(c, orderId)
  const adjustment = await c.env.RENT.prepare("SELECT * FROM order_price_adjustments WHERE id = ? AND order_id = ? AND direction = 'increase'").bind(adjustmentId, orderId).first() as any
  if (!order || !adjustment) throw new Error('余额差价记录不存在')
  const statements = await balancePriceAdjustmentSettlementStatements(c, order, adjustment)
  if (statements.length) await c.env.RENT.batch(statements)
}

export async function applyOrderPriceAdjustment(c: Context, opts: { orderId: string; beforeTotal: number; afterTotal: number; adjustmentId: string; actorId?: string | null; refundMethod?: unknown }): Promise<{ amount: number; pendingDepositRefund?: boolean }> {
  if (opts.afterTotal >= opts.beforeTotal) return { amount: 0 }
  const order = await getOrderById(c, opts.orderId)
  if (!order) throw new Error('价格调整对应的订单不存在')
  const beforeOrder = { ...order, totalAmount: opts.beforeTotal }
  const difference = Number(Math.max(0, orderChargeableAmount(beforeOrder) - orderChargeableAmount(order)).toFixed(2))
  if (!difference) return { amount: 0 }
  const rows = await priceAdjustmentRows(c, order.id)
  const existing = rows.find(row => row.id === opts.adjustmentId)
  if (existing?.status === 'succeeded') return { amount: Number(existing.amount || 0), pendingDepositRefund: existing.refund_method === 'pending_deposit' }
  const payments = await priceAdjustmentPaymentSources(c, order.id)
  const paidPrincipal = payments.reduce((sum, payment) => sum + paymentPrincipal(payment), 0)
  const priorRefunds = rows.filter(row => row.id !== opts.adjustmentId && row.direction === 'decrease' && row.status === 'succeeded').reduce((sum, row) => sum + Number(row.amount || 0), 0)
  const refundAmount = Number(Math.min(difference, Math.max(0, paidPrincipal - priorRefunds - orderChargeableAmount(order))).toFixed(2))
  if (refundAmount <= 0) return { amount: 0 }
  if (!existing) await c.env.RENT.prepare("INSERT INTO order_price_adjustments (id, order_id, direction, before_total, after_total, amount, status, created_by) VALUES (?, ?, 'decrease', ?, ?, ?, 'pending', ?)").bind(opts.adjustmentId, order.id, opts.beforeTotal, opts.afterTotal, refundAmount, opts.actorId || null).run()
  const adjustment = existing || { id: opts.adjustmentId, amount: refundAmount, status: 'pending' }
  const source = payments.find(payment => Number(payment.amount || 0) - Number(payment.allocated_refunds || 0) - Number(payment.adjustment_refunds || 0) >= refundAmount)
  const orderPaymentMethod = String(order.paymentMethod || '')
  // 礼品卡不可原路退款；所有 Square 来源的订单退款都必须进入客户余额。
  const refundMethod = String(source?.payment_provider || '') === 'square'
    ? 'balance'
    : resolveOrderPriceAdjustmentRefundMethod(opts.refundMethod, orderPaymentMethod, source)
  let stripeRefundId: string | null = null
  if (refundMethod === 'stripe') {
    if (await hasOpenPaymentDispute(c, source.id)) throw new Error('该笔付款存在未解决的拒付争议，暂不能自动退款')
    if (!adjustment.stripe_refund_id) {
      const refund = await stripeRequest(c, 'refunds', new URLSearchParams({ payment_intent: source.stripe_payment_intent_id, amount: String(cents(refundAmount)), 'metadata[order_id]': order.id, 'metadata[type]': 'price_adjustment', 'metadata[adjustment_id]': opts.adjustmentId }), `price-adjustment-refund-${opts.adjustmentId}`)
      if (refund.status !== 'succeeded') throw new Error('价格差价 Stripe 退款尚未成功，请稍后重试')
      stripeRefundId = refund.id
    } else stripeRefundId = adjustment.stripe_refund_id
  }
  const statements = [c.env.RENT.prepare("UPDATE order_price_adjustments SET amount = ?, refund_method = ?, stripe_refund_id = ?, status = 'succeeded', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'pending'").bind(refundAmount, refundMethod, stripeRefundId, opts.adjustmentId)]
  if (refundMethod === 'balance') statements.push(c.env.RENT.prepare('UPDATE users SET balance = balance + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(refundAmount, order.userId))
  await c.env.RENT.batch(statements)
  if (refundMethod === 'balance') await recordBalanceTransaction(c, order.userId, refundAmount, 'refund_credit', '订单降价差价退回账户余额', opts.actorId || null)
  const completed = await c.env.RENT.prepare('SELECT id FROM order_price_adjustments WHERE id = ? AND status = \'succeeded\'').bind(opts.adjustmentId).first() as any
  if (completed && refundMethod !== 'pending_deposit') {
    await recordFinancialLedgerEntry(c, { entryType: 'REFUND', amount: -refundAmount, customerId: order.userId, orderId: order.id, sourceType: 'ORDER_PRICE_ADJUSTMENT', sourceId: completed.id, description: '订单降价差价退款', createdBy: opts.actorId || null, metadata: { refundMethod } })
    await issueCreditNoteSafely(c, order.id, refundAmount, 0, `price-adjustment-${opts.adjustmentId}`, 'applyOrderPriceAdjustment')
  }
  return { amount: refundAmount, pendingDepositRefund: refundMethod === 'pending_deposit' }
}

export function stripeCheckoutItems(order: any): Array<{ name: string; amountCents: number }> {
  const totalCents = cents(order.totalAmount)
  const serviceFeeCents = cents(order.serviceFee ?? order.service_fee ?? 0)
  const depositCents = cents(order.depositAmount || 0)
  if (depositCents < 0 || depositCents > totalCents) throw new Error('订单押金金额无效')
  const rentalCents = totalCents - depositCents - serviceFeeCents
  const period = Number(order.rentalPeriod ?? order.rental_period ?? 0)
  const rentalLabel = period > 0
    ? `设备租金（${period} 天，${order.startDate} 至 ${order.endDate}）`
    : `设备租金（${order.startDate} 至 ${order.endDate}）`
  const feeCents = stripePaymentAmounts(order.totalAmount, order.depositAmount || 0, order.serviceFee ?? order.service_fee ?? 0).feeCents
  return [
    { name: rentalLabel, amountCents: rentalCents },
    { name: '自取/归还时段服务费', amountCents: serviceFeeCents },
    { name: `Stripe 租金及服务费支付手续费（${(getStripeProcessingFeeRate() * 100).toString()}%）`, amountCents: feeCents },
  ].filter(item => item.amountCents > 0)
}

export function refundableDepositFee(refundAmount: number, payment: any): number {
  // 押金不再进入 Stripe 的收费本金，因此不存在“押金对应手续费”可退。
  return 0
}

// Thin back-compat wrapper over the shared refund allocation engine in site.ts.
export function allocateProportionalRefund(sources: Array<{ id: string; amount: number; refunded?: number }>, refundAmount: number): Array<{ id: string; amount: number }> {
  return buildRefundAllocation(sources, refundAmount, 'proportional').map(({ id, amount }) => ({ id, amount }))
}

function melbourneDate(): string {
  const parts = new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Melbourne', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date())
  const value = Object.fromEntries(parts.map(part => [part.type, part.value]))
  return `${value.year}-${value.month}-${value.day}`
}

export async function handleStripeWebhook(c: Context): Promise<Response> {
  const rawBody = await c.req.text()
  const payloadDigest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(rawBody))
  const payloadHash = Array.from(new Uint8Array(payloadDigest)).map(byte => byte.toString(16).padStart(2, '0')).join('')
  let event: any
  try {
    event = await verifyStripeWebhook(c, rawBody, c.req.header('stripe-signature'))
  } catch (error: any) {
    // Always acknowledge Stripe delivery at the HTTP layer. Invalid payloads
    // are rejected from business processing and logged for investigation;
    // returning 4xx here only causes Stripe to retry the same bad delivery.
    console.error('Stripe webhook verification failed:', error?.message || error)
    return c.json({ received: false, accepted: false, reason: 'verification_failed' }, 400)
  }

  const claim = await claimWebhookEvent(c, { provider: 'stripe', eventId: event.id, eventType: event.type, payloadHash })
  if (!claim.firstDelivery && claim.status === 'PROCESSED') return c.json({ received: true, duplicate: true })
  // A prior delivery that stalled at RECEIVED/FAILED falls through and is
  // reprocessed. Every business statement below is idempotent (status-guarded
  // UPDATEs / INSERT OR IGNORE), so a safe retry cannot double-apply.

  const session = event.data?.object
  const statements: any[] = []
  let paidOrderId = ''
  let authorizedOrderId = ''
  let disputedOrderId = ''
  let disputedCustomerId = ''
  let disputedStripeId = ''
  if (['checkout.session.completed', 'checkout.session.async_payment_succeeded'].includes(event.type)) {
    const topupId = String(session?.metadata?.topup_id || '')
    if (topupId) {
      const topup = await c.env.RENT.prepare("SELECT * FROM balance_topups WHERE id = ? AND status = 'pending'").bind(topupId).first() as any
      const customerId = String(session?.metadata?.customer_id || '')
      const expected = topup ? cents(topup.amount) + Math.round(cents(topup.amount) * getStripeProcessingFeeRate()) : 0
      if (!topup || topup.user_id !== customerId || Number(session.amount_total) !== expected || session.payment_status !== 'paid') return c.text('Stripe 充值数据不匹配', 400)
      const user = await c.env.RENT.prepare('SELECT balance FROM users WHERE id = ?').bind(customerId).first() as any
      const next = Number((Number(user?.balance || 0) + Number(topup.amount)).toFixed(2))
      statements.push(c.env.RENT.prepare("UPDATE balance_topups SET status = 'paid', transaction_id = ?, paid_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(String(session.payment_intent || session.id), topupId), c.env.RENT.prepare('UPDATE users SET balance = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(next, customerId), c.env.RENT.prepare("INSERT INTO balance_transactions (id, user_id, amount, balance_after, type, reason, created_by) VALUES (?, ?, ?, ?, 'top_up_card', ?, NULL)").bind(`bt-${nanoid(12)}`, customerId, topup.amount, next, `信用卡充值（含手续费 ${Number(topup.processing_fee || 0).toFixed(2)} AUD）`))
      paidOrderId = ''
    } else {
      const orderId = String(session?.metadata?.order_id || '')
      const customerId = String(session?.metadata?.customer_id || '')
      const order = await getOrderById(c, orderId)
      paidOrderId = orderId
      const payment = await c.env.RENT.prepare('SELECT rental_id, customer_id, amount, processing_fee FROM payments WHERE stripe_checkout_session_id = ?').bind(session.id).first() as any
      const expected = order ? stripePaymentAmounts(order.totalAmount, orderDeposit(order), orderServiceFee(order)) : null
      if (!order || !payment || !expected || payment.rental_id !== order.id || payment.customer_id !== customerId || cents(payment.amount) !== expected.chargedCents || cents(payment.processing_fee) !== expected.feeCents || order.userId !== customerId || String(session.currency).toLowerCase() !== 'aud' || Number(session.amount_total) !== expected.chargedCents || session.payment_status !== 'paid') {
        return c.text('Stripe 支付数据与订单不匹配', 400)
      }
      statements.push(
        c.env.RENT.prepare(`UPDATE payments SET status = 'paid', stripe_payment_intent_id = ?, transaction_id = COALESCE(transaction_id, ?), paid_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE stripe_checkout_session_id = ?`)
          .bind(String(session.payment_intent || ''), generateReferenceNumber('TXN'), session.id),
        c.env.RENT.prepare("UPDATE orders SET status = 'paid', paymentMethod = 'card', updatedAt = CURRENT_TIMESTAMP WHERE id = ? AND status = 'pending_payment'").bind(order.id),
      )
    }
  } else if (['checkout.session.async_payment_failed', 'checkout.session.expired'].includes(event.type)) {
    const failedOrderId = String(session?.metadata?.order_id || '')
    statements.push(
      c.env.RENT.prepare("UPDATE payments SET status = 'failed', updated_at = CURRENT_TIMESTAMP WHERE stripe_checkout_session_id = ? AND status = 'pending'").bind(session.id),
    )
  } else if (event.type === 'payment_intent.amount_capturable_updated') {
    const payment = await c.env.RENT.prepare("SELECT id, rental_id, customer_id, amount, deposit_amount FROM payments WHERE stripe_payment_intent_id = ? AND status = 'pending'").bind(session.id).first() as any
    if (payment && Number(payment.deposit_amount || 0) > 0 && String(session?.metadata?.type || '') === 'rental_authorization') {
      const order = await getOrderById(c, payment.rental_id)
      const expectedAuthorization = order ? stripeAuthorizationAmount(order.totalAmount, orderDeposit(order), orderServiceFee(order)) : 0
      const capturableCents = Number(session?.amount_capturable || 0)
      const paymentMethodId = typeof session?.payment_method === 'string' ? session.payment_method : String(session?.payment_method?.id || '')
      if (!order || session.status !== 'requires_capture' || session.capture_method !== 'manual' || String(session.currency).toLowerCase() !== 'aud' || String(session.metadata?.order_id || '') !== order.id || String(session.metadata?.customer_id || '') !== String(order.userId) || payment.customer_id !== String(order.userId) || payment.rental_id !== order.id || cents(payment.amount) !== expectedAuthorization || Number(session.amount) !== expectedAuthorization || capturableCents !== expectedAuthorization) return c.text('Stripe 订单预授权数据不匹配', 400)
      statements.push(
        c.env.RENT.prepare("UPDATE orders SET deposit_payment_mode = 'PREAUTH', stripe_deposit_payment_intent_id = ?, deposit_status = CASE WHEN deposit_status = 'PENDING' THEN 'HELD' ELSE deposit_status END, deposit_paid_at = COALESCE(deposit_paid_at, CURRENT_TIMESTAMP), deposit_held_amount = ? WHERE id = ? AND deposit_refund_at IS NULL AND deposit_status IN ('PENDING', 'HELD', 'REFUND_PENDING') AND status NOT IN ('cancelled', 'completed')")
          .bind(session.id, Number(payment.deposit_amount), order.id),
        c.env.RENT.prepare("UPDATE orders SET status = 'paid', order_status = 'CONFIRMED', payment_status = 'PAID', rental_status = 'READY_FOR_PICKUP', paymentMethod = 'card', stripe_payment_method_id = COALESCE(NULLIF(?, ''), stripe_payment_method_id), stripe_deposit_payment_intent_id = ?, deposit_status = 'HELD', deposit_paid_at = COALESCE(deposit_paid_at, CURRENT_TIMESTAMP), deposit_held_amount = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ? AND status = 'pending_payment'")
          .bind(paymentMethodId, session.id, Number(payment.deposit_amount), order.id),
      )
      if (order.status === 'pending_payment') authorizedOrderId = order.id
    }
  } else if (event.type === 'payment_intent.succeeded') {
    // 站内 Payment Element 路径：付款对象是 PaymentIntent（session 即该对象），
    // 按 stripe_payment_intent_id 匹配落库的 pending 记录。
    const topupId = String(session?.metadata?.topup_id || '')
    const paidCents = Number(session?.amount_received ?? session?.amount ?? 0)
    if (session?.status !== 'succeeded' || String(session?.currency).toLowerCase() !== 'aud') return c.text('Stripe 支付状态无效', 400)
    const adjustmentId = String(session?.metadata?.adjustment_id || '')
    if (String(session?.metadata?.type || '') === 'price_adjustment' && adjustmentId) {
      const adjustment = await c.env.RENT.prepare("SELECT * FROM order_price_adjustments WHERE id = ? AND direction = 'increase'").bind(adjustmentId).first() as any
      const payment = await c.env.RENT.prepare('SELECT * FROM payments WHERE stripe_payment_intent_id = ?').bind(session.id).first() as any
      const order = adjustment ? await getOrderById(c, adjustment.order_id) : null
      const expected = adjustment ? cents(adjustment.amount) + cents(adjustment.processing_fee) : 0
      const isSquareSplit = String(session?.metadata?.square_split || '') === '1'
      const expectedStripeCents = isSquareSplit ? Number(session?.metadata?.remainder_amount || 0) : expected
      if (!adjustment || !payment || !order || adjustment.payment_id !== payment.id || payment.rental_id !== order.id || payment.customer_id !== String(order.userId) || String(session?.metadata?.customer_id || '') !== String(order.userId) || paidCents !== expectedStripeCents) return c.text('Stripe 差价支付数据不匹配', 400)
      if (isSquareSplit) await completeSplitSquarePayment(c, String(payment.square_payment_id || session?.metadata?.square_payment_id || ''), Number(session?.metadata?.target_amount || expected))
      const balanceSettlement = await balancePriceAdjustmentSettlementStatements(c, order, adjustment)
      statements.push(
        c.env.RENT.prepare("UPDATE payments SET status = 'paid', transaction_id = COALESCE(transaction_id, ?), paid_at = COALESCE(paid_at, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'pending'").bind(generateReferenceNumber('TXN'), payment.id),
        ...(balanceSettlement.length ? balanceSettlement : [c.env.RENT.prepare("UPDATE order_price_adjustments SET status = 'succeeded', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'pending'").bind(adjustment.id)]),
      )
      paidOrderId = ''
    } else {
      const authorization = await c.env.RENT.prepare("SELECT id, rental_id, customer_id FROM payments WHERE stripe_payment_intent_id = ? AND rental_amount = 0 AND deposit_amount > 0 AND (square_payment_id IS NULL OR square_payment_id = '')").bind(session.id).first() as any
      if (authorization) {
      const order = await getOrderById(c, authorization.rental_id)
      if (!order || authorization.customer_id !== String(order.userId) || paidCents <= 0 || paidCents > cents(orderDeposit(order))) return c.text('Stripe 押金预授权数据不匹配', 400)
      statements.push(c.env.RENT.prepare("UPDATE payments SET status = 'paid', amount = ?, transaction_id = COALESCE(transaction_id, ?), paid_at = COALESCE(paid_at, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP WHERE id = ?")
        .bind(paidCents / 100, session.id, authorization.id))
      if (String(session?.metadata?.type || '') === 'square_deposit_payment') {
        if (paidCents !== cents(orderDeposit(order)) || String(order.paymentProvider || order.payment_provider || '') !== 'square') return c.text('Stripe Square 订单押金数据不匹配', 400)
        statements.push(c.env.RENT.prepare("UPDATE orders SET deposit_method = 'card_hold', deposit_payment_mode = 'PAID', deposit_status = 'PAID', refundMethod = 'original', deposit_paid_at = COALESCE(deposit_paid_at, CURRENT_TIMESTAMP), deposit_held_amount = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ? AND deposit_status = 'PENDING'").bind(paidCents / 100, order.id))
      }
      paidOrderId = ''
      } else if (topupId) {
      const topup = await c.env.RENT.prepare("SELECT * FROM balance_topups WHERE id = ? AND stripe_payment_intent_id = ? AND status = 'pending'").bind(topupId, session.id).first() as any
      const customerId = String(session?.metadata?.customer_id || '')
      const isSquareSplit = ['square_split_topup', 'square_residual_topup'].includes(String(session?.metadata?.type || ''))
      const expected = isSquareSplit ? Number(session?.metadata?.remainder_amount || 0) : (topup ? cents(topup.amount) + Math.round(cents(topup.amount) * getStripeProcessingFeeRate()) : 0)
      if (!topup || topup.user_id !== customerId || paidCents !== expected) return c.text('Stripe 充值数据不匹配', 400)
      if (isSquareSplit) await completeSplitSquarePayment(c, String(session?.metadata?.square_payment_id || topup.transaction_id || ''), Number(session?.metadata?.target_amount || 0))
      const user = await c.env.RENT.prepare('SELECT balance FROM users WHERE id = ?').bind(customerId).first() as any
      const next = Number((Number(user?.balance || 0) + Number(topup.amount)).toFixed(2))
      statements.push(
        c.env.RENT.prepare("UPDATE balance_topups SET status = 'paid', transaction_id = ?, paid_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'pending'").bind(String(session.id), topupId),
        c.env.RENT.prepare('UPDATE users SET balance = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(next, customerId),
        c.env.RENT.prepare("INSERT OR IGNORE INTO balance_transactions (id, user_id, amount, balance_after, type, reason, created_by) VALUES (?, ?, ?, ?, 'top_up_card', ?, NULL)").bind(`bt-${topup.id}`, customerId, topup.amount, next, `礼品卡+Stripe 差额充值（含手续费 ${Number(topup.processing_fee || 0).toFixed(2)} AUD）`),
      )
      } else {
      const orderId = String(session?.metadata?.order_id || '')
      const customerId = String(session?.metadata?.customer_id || '')
      const order = await getOrderById(c, orderId)
      paidOrderId = orderId
      const payment = await c.env.RENT.prepare('SELECT rental_id, customer_id, amount, deposit_amount, rental_amount, processing_fee, square_payment_id FROM payments WHERE stripe_payment_intent_id = ?').bind(session.id).first() as any
      // 不是本站站内 Payment Element 建的 PI（例如历史 Checkout 流程遗留），静默确认，
      // 交给对应的 checkout.session.* 事件处理，避免 Stripe 反复重投。
      if (!payment) { paidOrderId = ''; return c.json({ received: true, ignored: true }) }
      const isFullAuthorization = Number(payment?.deposit_amount || 0) > 0 && String(session?.metadata?.type || '') === 'rental_authorization'
      if (!order || !payment || payment.rental_id !== order.id || payment.customer_id !== customerId || String(session?.metadata?.customer_id || '') !== String(order.userId)) return c.text('Stripe 支付数据不匹配', 400)
      const paymentType = String(session?.metadata?.type || '')
      const isSquareSplit = paymentType === 'square_split_order'
      const isSquareResidual = paymentType === 'square_residual_order'
      if (isSquareResidual) {
        const expectedRemainder = Number(session?.metadata?.remainder_amount || 0)
        const targetAmount = Number(session?.metadata?.target_amount || 0)
        const depositAmount = Number(session?.metadata?.deposit_amount || 0)
        const expectedRental = Math.max(0, targetAmount - Number(session?.metadata?.square_approved_amount || 0))
        if (!expectedRemainder || !targetAmount || paidCents !== expectedRemainder || cents(payment.amount) !== expectedRemainder || cents(payment.rental_amount) !== expectedRental || cents(payment.deposit_amount) !== depositAmount || !payment.square_payment_id) return c.text('Stripe 礼品卡剩余付款数据不匹配', 400)
        await completeSplitSquarePayment(c, String(payment.square_payment_id), targetAmount)
        statements.push(
          c.env.RENT.prepare("UPDATE payments SET status = 'paid', transaction_id = COALESCE(transaction_id, ?), paid_at = COALESCE(paid_at, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP WHERE stripe_payment_intent_id = ? AND status != 'paid'").bind(generateReferenceNumber('TXN'), session.id),
          c.env.RENT.prepare("UPDATE orders SET status = 'paid', order_status = 'CONFIRMED', payment_status = 'PAID', rental_status = 'READY_FOR_PICKUP', paymentMethod = 'card', payment_provider = 'square', deposit_status = CASE WHEN ? > 0 THEN 'PAID' ELSE deposit_status END, deposit_paid_at = CASE WHEN ? > 0 THEN COALESCE(deposit_paid_at, CURRENT_TIMESTAMP) ELSE deposit_paid_at END, deposit_held_amount = CASE WHEN ? > 0 THEN ? ELSE deposit_held_amount END, stripe_payment_method_id = COALESCE(NULLIF(?, ''), stripe_payment_method_id), updatedAt = CURRENT_TIMESTAMP WHERE id = ? AND status = 'pending_payment'").bind(depositAmount, depositAmount, depositAmount, depositAmount / 100, String(session.payment_method || ''), order.id),
        )
      } else if (isSquareSplit) {
        const expectedRemainder = Number(session?.metadata?.remainder_amount || 0)
        const targetAmount = Number(session?.metadata?.target_amount || 0)
        if (!expectedRemainder || !targetAmount || paidCents !== expectedRemainder || cents(payment.amount) !== targetAmount || !payment.square_payment_id) return c.text('Stripe 礼品卡差额支付数据不匹配', 400)
        await completeSplitSquarePayment(c, String(payment.square_payment_id), targetAmount)
        statements.push(
          c.env.RENT.prepare(`UPDATE payments SET status = 'paid', transaction_id = COALESCE(transaction_id, ?), paid_at = COALESCE(paid_at, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP WHERE stripe_payment_intent_id = ? AND status != 'paid'`)
            .bind(generateReferenceNumber('TXN'), session.id),
          c.env.RENT.prepare("UPDATE orders SET status = 'paid', order_status = 'CONFIRMED', payment_status = 'PAID', rental_status = 'READY_FOR_PICKUP', paymentMethod = 'card', payment_provider = 'square', stripe_payment_method_id = COALESCE(stripe_payment_method_id, ?), updatedAt = CURRENT_TIMESTAMP WHERE id = ? AND status = 'pending_payment'").bind(String(session.payment_method || ''), order.id),
        )
      } else if (isFullAuthorization) {
        const minimumCapture = cents(Number(payment.rental_amount || 0) + Number(payment.processing_fee || 0))
        const maximumCapture = cents(payment.amount)
        if (paidCents < minimumCapture || paidCents > maximumCapture) return c.text('Stripe 订单捕获金额不匹配', 400)
        statements.push(
          c.env.RENT.prepare(`UPDATE payments SET status = 'paid', amount = ?, transaction_id = COALESCE(transaction_id, ?), paid_at = COALESCE(paid_at, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP WHERE stripe_payment_intent_id = ? AND status != 'paid'`)
            .bind(paidCents / 100, generateReferenceNumber('TXN'), session.id),
          c.env.RENT.prepare("UPDATE orders SET status = 'paid', order_status = 'CONFIRMED', payment_status = 'PAID', rental_status = 'READY_FOR_PICKUP', paymentMethod = 'card', stripe_payment_method_id = COALESCE(NULLIF(?, ''), stripe_payment_method_id), updatedAt = CURRENT_TIMESTAMP WHERE id = ? AND status = 'pending_payment'").bind(String(session.payment_method || ''), order.id),
        )
      } else {
        const expected = stripePaymentAmounts(order.totalAmount, orderDeposit(order), orderServiceFee(order))
        if (cents(payment.amount) !== expected.chargedCents || cents(payment.processing_fee) !== expected.feeCents || paidCents !== expected.chargedCents) return c.text('Stripe 支付数据不匹配', 400)
        statements.push(
          c.env.RENT.prepare(`UPDATE payments SET status = 'paid', transaction_id = COALESCE(transaction_id, ?), paid_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE stripe_payment_intent_id = ? AND status != 'paid'`)
            .bind(generateReferenceNumber('TXN'), session.id),
          c.env.RENT.prepare("UPDATE orders SET status = 'paid', paymentMethod = 'card', stripe_payment_method_id = COALESCE(stripe_payment_method_id, ?), updatedAt = CURRENT_TIMESTAMP WHERE id = ? AND status = 'pending_payment'").bind(String(session.payment_method || ''), order.id),
        )
      }
      }
    }
  } else if (event.type === 'payment_intent.payment_failed') {
    statements.push(
      c.env.RENT.prepare("UPDATE payments SET status = 'failed', updated_at = CURRENT_TIMESTAMP WHERE stripe_payment_intent_id = ? AND status = 'pending' AND square_payment_id IS NULL").bind(session.id),
      c.env.RENT.prepare("UPDATE balance_topups SET status = 'failed', updated_at = CURRENT_TIMESTAMP WHERE stripe_payment_intent_id = ? AND status = 'pending' AND transaction_id IS NULL").bind(session.id),
    )
  } else if (event.type === 'charge.dispute.created') {
    const dispute = session
    const disputedPayment = await c.env.RENT.prepare('SELECT p.id, p.rental_id, p.customer_id, o.deviceId AS device_id FROM payments p LEFT JOIN orders o ON o.id = p.rental_id WHERE p.stripe_payment_intent_id = ?').bind(String(dispute?.payment_intent || '')).first() as any
    if (disputedPayment) {
      const dueBy = dispute.evidence_details?.due_by ? new Date(Number(dispute.evidence_details.due_by) * 1000).toISOString() : null
      statements.push(c.env.RENT.prepare('INSERT OR IGNORE INTO payment_disputes (id, stripe_dispute_id, payment_id, order_id, customer_id, device_id, amount, currency, reason, status, evidence_due_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(`pd-${nanoid(12)}`, String(dispute.id), disputedPayment.id, disputedPayment.rental_id, disputedPayment.customer_id, disputedPayment.device_id || null, Number(dispute.amount || 0) / 100, String(dispute.currency || 'aud').toUpperCase(), String(dispute.reason || ''), 'DISPUTE_OPENED', dueBy))
      disputedOrderId = String(disputedPayment.rental_id || '')
      disputedCustomerId = String(disputedPayment.customer_id || '')
      disputedStripeId = String(dispute.id || '')
    }
  } else if (event.type === 'charge.dispute.updated') {
    // 举证期 / Stripe 状态变化时刷新——仅在争议尚未结案时更新。
    const dispute = session
    const dueBy = dispute.evidence_details?.due_by ? new Date(Number(dispute.evidence_details.due_by) * 1000).toISOString() : null
    statements.push(c.env.RENT.prepare("UPDATE payment_disputes SET status = ?, evidence_due_by = COALESCE(?, evidence_due_by), updated_at = CURRENT_TIMESTAMP WHERE stripe_dispute_id = ? AND status IN ('DISPUTE_OPENED', 'DISPUTE_UNDER_REVIEW')")
      .bind(mapStripeDisputeStatus(String(dispute?.status || '')), dueBy, String(dispute?.id || '')))
  } else if (event.type === 'charge.dispute.closed') {
    const dispute = session
    const mappedStatus = mapStripeDisputeStatus(String(dispute?.status || ''))
    // 败诉即资金已被划走：把争议金额记为真实财务影响（管理员之后可在后台修正）。
    const lostImpact = mappedStatus === 'DISPUTE_LOST' ? Number(dispute?.amount || 0) / 100 : null
    statements.push(c.env.RENT.prepare("UPDATE payment_disputes SET status = ?, result = ?, financial_impact = COALESCE(financial_impact, ?), updated_at = CURRENT_TIMESTAMP WHERE stripe_dispute_id = ? AND status IN ('DISPUTE_OPENED', 'DISPUTE_UNDER_REVIEW')")
      .bind(mappedStatus, String(dispute?.status || ''), lostImpact, String(dispute?.id || '')))
  }
  statements.push(c.env.RENT.prepare("INSERT OR IGNORE INTO stripe_webhook_events (event_id, event_type, payload_hash, processing_status, received_at) VALUES (?, ?, ?, 'PROCESSED', CURRENT_TIMESTAMP)").bind(event.id, event.type, payloadHash))
  try {
    await c.env.RENT.batch(statements)
  } catch (error: any) {
    if (String(error.message).includes('UNIQUE')) return c.json({ received: true, duplicate: true })
    await markWebhookFailed(c, claim.recordId, error?.message || String(error))
    throw error
  }
  await markWebhookProcessed(c, claim.recordId)

  const response = c.json({ received: true })
  if (paidOrderId) {
    try {
      const paidOrder = await getOrderById(c, paidOrderId)
      await ensureOrderNumber(c, paidOrderId, String(session.payment_intent || session.id || ''))
      if (paidOrder) {
        paidOrder.orderNo = (await c.env.RENT.prepare('SELECT orderNo FROM orders WHERE id = ?').bind(paidOrderId).first() as any)?.orderNo || paidOrder.orderNo
        await recordExternalRentalFlow(c, paidOrder.userId, Number(paidOrder.totalAmount) - orderDeposit(paidOrder), '信用卡', null, paidOrder.id)
        await recordDeviceLifecycle(c, paidOrder.deviceId, 'RESERVED', { orderId: paidOrder.id, reason: '信用卡付款成功' })
        if (depositPaymentModeForOrder(paidOrder) === 'PREAUTH' && !String((paidOrder as any).stripe_deposit_payment_intent_id || '') && String((paidOrder as any).stripe_payment_method_id || '')) {
          await createDepositAuthorization(c, paidOrder, String((paidOrder as any).stripe_payment_method_id))
        }
        await c.env.RENT.prepare("UPDATE coupon_redemptions SET status = 'REDEEMED', redeemed_at = CURRENT_TIMESTAMP WHERE order_id = ? AND status = 'RESERVED'").bind(paidOrder.id).run()
      }
    } catch (error: any) {
      await logError(c, 'ERROR', 'Stripe webhook post-processing failed', error, { orderId: paidOrderId, eventId: event.id, eventType: event.type })
    }
    // 发票开具必须独立于上面的后处理步骤：设备状态、推荐奖励等任一环节抛错都不该
    // 连带跳过开票，否则订单已经 status = 'paid' 却永久没有发票（且旧代码只有
    // console.error，没有任何可查询记录）。
    await issueInvoiceSafely(c, paidOrderId, `webhook ${event.type}`)
    try {
      await refreshStripePaymentDescriptions(c, paidOrderId)
      await enqueueRentalUserCreation(c, await getOrderById(c, paidOrderId))
    } catch (error: any) {
      await logError(c, 'ERROR', 'Stripe webhook post-processing (descriptions/user) failed', error, { orderId: paidOrderId, eventId: event.id, eventType: event.type })
    }
  }
  if (authorizedOrderId) {
    await issueInvoiceSafely(c, authorizedOrderId, 'webhook authorization')
    try {
      const authorizedOrder = await getOrderById(c, authorizedOrderId)
      if (authorizedOrder) {
        await recordDeviceLifecycle(c, authorizedOrder.deviceId, 'RESERVED', { orderId: authorizedOrder.id, reason: '信用卡预授权成功' })
        await ensureOrderNumber(c, authorizedOrder.id, String(session.id || ''))
        await refreshStripePaymentDescriptions(c, authorizedOrderId)
        await enqueueRentalUserCreation(c, authorizedOrder)
      }
    } catch (error: any) {
      await logError(c, 'ERROR', 'Stripe authorization post-processing failed', error, { orderId: authorizedOrderId, eventId: event.id, eventType: event.type })
    }
  }
  if (disputedOrderId) {
    try {
      await revokeReferralRewardForOrder(c, disputedOrderId, 'Stripe 拒付争议')
    } catch (error: any) {
      await logError(c, 'ERROR', 'Stripe webhook dispute post-processing failed', error, { orderId: disputedOrderId, eventId: event.id, eventType: event.type })
    }
  }
  if (disputedCustomerId && disputedStripeId) {
    // Chargeback 自动升起 CHARGEBACK 风险标记（完善.md），阻止该客户继续自助下单。
    try {
      const existing = await c.env.RENT.prepare("SELECT id FROM risk_flags WHERE customer_id = ? AND flag_type = 'CHARGEBACK' AND status = 'ACTIVE' LIMIT 1").bind(disputedCustomerId).first() as any
      let flagId = existing?.id as string | undefined
      if (!flagId) {
        flagId = `rk-${nanoid(12)}`
        await c.env.RENT.prepare("INSERT INTO risk_flags (id, customer_id, flag_type, severity, reason, evidence, created_by) VALUES (?, ?, 'CHARGEBACK', 'HIGH', ?, ?, 'system')")
          .bind(flagId, disputedCustomerId, 'Stripe 拒付争议自动标记', `stripe_dispute:${disputedStripeId}`).run()
      }
      await c.env.RENT.prepare('UPDATE payment_disputes SET risk_flag_id = ? WHERE stripe_dispute_id = ? AND risk_flag_id IS NULL').bind(flagId, disputedStripeId).run()
    } catch (error: any) {
      // 拒付风控标记打不上，客户还能继续自助下单——这个失败必须能被看见才能人工补标。
      await logError(c, 'CRITICAL', 'Stripe webhook chargeback risk-flag failed', error, { customerId: disputedCustomerId, stripeDisputeId: disputedStripeId, eventId: event.id })
    }
  }

  return response
}

async function paidPayment(c: Context, order: any, component: 'rental' | 'deposit' = 'rental'): Promise<any> {
  if (component === 'deposit' && String(order.paymentProvider || order.payment_provider || '') === 'square') {
    const depositPayment = await c.env.RENT.prepare("SELECT * FROM payments WHERE rental_id = ? AND status = 'paid' AND rental_amount = 0 AND deposit_amount > 0 ORDER BY paid_at DESC LIMIT 1").bind(order.id).first() as any
    if (depositPayment) return depositPayment
  }
  let payment = await c.env.RENT.prepare("SELECT * FROM payments WHERE rental_id = ? AND status = 'paid' ORDER BY CASE WHEN rental_amount > 0 THEN 0 ELSE 1 END, rental_amount DESC, paid_at DESC LIMIT 1").bind(order.id).first() as any
  if (payment) return payment
  const method = ['card', 'bank_transfer', 'balance'].includes(order.paymentMethod) ? order.paymentMethod : 'bank_transfer'
  const paymentId = `p-${nanoid(12)}`
  await c.env.RENT.prepare(`
    INSERT INTO payments (id, rental_id, customer_id, payment_method, amount, deposit_amount, rental_amount, currency, status, transaction_id, paid_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'AUD', 'paid', ?, CURRENT_TIMESTAMP)
  `).bind(paymentId, order.id, order.userId, method, order.totalAmount, order.depositAmount, order.totalAmount - order.depositAmount, generateReferenceNumber('TXN')).run()
  return c.env.RENT.prepare('SELECT * FROM payments WHERE id = ?').bind(paymentId).first()
}

function refundChannel(order: any, payment: any): 'balance' | 'stripe' | 'bank_transfer' | 'unavailable' {
  if ((order.refundMethod ?? 'balance') !== 'original') return 'balance'
  // Square Gift Card payments do not have a Stripe payment intent. Keep their
  // refund path on the internal customer balance until a Square refund flow is
  // added, instead of accidentally treating them as Stripe card payments.
  if (String(payment?.payment_provider || '') === 'square') return 'balance'
  if (payment.payment_method === 'card') return payment.stripe_payment_intent_id ? 'stripe' : 'unavailable'
  if (payment.payment_method === 'bank_transfer') return 'bank_transfer'
  return 'balance'
}

function cancellationRefundChannel(payment: any): 'balance' | 'stripe' | 'bank_transfer' | 'unavailable' {
  if (String(payment?.payment_provider || '') === 'square') return 'balance'
  if (payment?.payment_method === 'balance') return 'balance'
  if (payment?.payment_method === 'card') return payment.stripe_payment_intent_id ? 'stripe' : 'unavailable'
  if (payment?.payment_method === 'bank_transfer') return 'bank_transfer'
  return 'unavailable'
}

export function stripeDepositSettlementCaptureAmount(payment: any, deductionAmount: number, refundMethod = 'original'): number {
  if (refundMethod === 'balance') return Math.max(0, Number(payment?.amount || 0))
  const rentalAmount = Math.max(0, Number(payment?.rental_amount || 0))
  const processingFee = Math.max(0, Number(payment?.processing_fee || 0))
  return Number((rentalAmount + processingFee + Math.max(0, deductionAmount)).toFixed(2))
}

function validateDepositDeduction(form: Record<string, any>, depositAmount: number, deductionAmount: number): { category: string; reason: string } | Response {
  const category = String(form.deductionCategory || '').trim()
  const reason = String(form.deductionReason || '').trim()
  const validCategories = new Set(['DAMAGE', 'MISSING_ACCESSORY', 'LATE_FEE', 'DEVICE_NOT_RETURNED', 'OTHER'])
  if (deductionAmount > 0 && !validCategories.has(category)) return new Response('请选择有效的押金扣款类别', { status: 400 })
  if (deductionAmount > 0 && !reason) return new Response('扣除押金时必须填写原因', { status: 400 })
  if (deductionAmount > depositAmount) return new Response('扣款金额不能高于押金金额', { status: 400 })
  return { category, reason }
}

async function settlePreauthorizedDeposit(c: Context, admin: any, order: any, form: Record<string, any>): Promise<Response> {
  const depositAmount = orderDeposit(order)
  const authorizationId = String((order as any).stripe_deposit_payment_intent_id || '')
  const payment = authorizationId
    ? await c.env.RENT.prepare('SELECT * FROM payments WHERE stripe_payment_intent_id = ? LIMIT 1').bind(authorizationId).first() as any
    : null
  if (!authorizationId || !payment) return c.text('未找到押金预授权记录，无法结算', 409)
  if (await hasOpenPaymentDispute(c, payment.id)) return c.text('该笔押金预授权存在未解决的拒付争议，暂不能结算', 409)
  const refundText = String(form.refundAmount ?? '').trim()
  const refundAmount = Number(refundText)
  const previous = Number((await c.env.RENT.prepare("SELECT COALESCE(SUM(refund_amount), 0) AS amount FROM payment_refunds WHERE order_id = ? AND type = 'deposit' AND status = 'succeeded'").bind(order.id).first() as any)?.amount || 0)
  const remaining = Number(Math.max(0, depositAmount - previous).toFixed(2))
  if (!/^\d+(\.\d{1,2})?$/.test(refundText) || !Number.isFinite(refundAmount) || refundAmount < 0 || refundAmount > remaining) return c.text(`退款金额无效：本次最多可释放 ${remaining.toFixed(2)}`, 400)
  const totalReleased = Number((previous + refundAmount).toFixed(2))
  const deductionAmount = Number(Math.max(0, depositAmount - totalReleased).toFixed(2))
  if (deductionAmount < Number((order as any).overdue_deposit_applied || 0)) return c.text('退款金额不能覆盖已计入的逾期归还费用', 409)
  const deduction = validateDepositDeduction(form, depositAmount, deductionAmount)
  if (deduction instanceof Response) return deduction
  const fullAuthorization = Number(payment.rental_amount || 0) > 0
  const selectedRefundMethod = String(form.refundMethod || order.refundMethod || 'balance')
  if (!['balance', 'original'].includes(selectedRefundMethod)) return c.text('退款方式无效', 400)
  const refundToBalance = selectedRefundMethod === 'balance'
  // 退余额时完整捕获后将可退押金入账；原路退回时只捕获应收金额，释放未用押金。
  const captureAmount = stripeDepositSettlementCaptureAmount(payment, deductionAmount, selectedRefundMethod)
  if (captureAmount > Number(payment.amount || 0)) return c.text('捕获金额超过信用卡预授权上限', 409)

  let intent = await stripeRequest(c, `payment_intents/${authorizationId}`).catch(() => null)
  if (!intent || !['requires_capture', 'succeeded', 'canceled'].includes(String(intent.status))) return c.text('押金预授权状态无效，无法结算', 409)
  if (String(intent.currency).toLowerCase() !== 'aud' || String(intent.metadata?.order_id || '') !== order.id) return c.text('信用卡预授权与订单不匹配', 409)
  if (captureAmount > 0 && intent.status === 'canceled') return c.text('信用卡预授权已取消或过期，尚未收取租金及扣款，请先重新收款', 409)
  if (intent.status === 'requires_capture') {
    if (Number(intent.amount_capturable || 0) < cents(captureAmount)) return c.text('信用卡可捕获金额不足，无法结算', 409)
    if (captureAmount > 0) {
      const amountToCapture = String(cents(captureAmount))
      // v2 不再传 final_capture；同一授权和金额的重试仍复用同一键。
      intent = await stripeRequest(c, `payment_intents/${authorizationId}/capture`, new URLSearchParams({ amount_to_capture: amountToCapture }), `deposit-capture-v2-${order.id}-${authorizationId}-${amountToCapture}`)
    } else {
      intent = await stripeRequest(c, `payment_intents/${authorizationId}/cancel`, new URLSearchParams(), `deposit-release-${order.id}`)
    }
  }
  // 网络或数据库中断后的重试也必须核对实际捕获金额，不能把过期或错误扣款当作结算成功。
  if (captureAmount > 0 && (intent.status !== 'succeeded' || Number(intent.amount_received) !== cents(captureAmount))) return c.text('信用卡实际扣款与结算金额不一致，请核实后重试', 409)
  if (captureAmount === 0 && intent.status !== 'canceled') return c.text('信用卡预授权尚未释放，无法结算', 409)

  const nextStatus = deductionAmount >= depositAmount ? 'FORFEITED' : deductionAmount > 0 ? 'PARTIALLY_DEDUCTED' : 'REFUNDED'
  const statements: any[] = [
    c.env.RENT.prepare("UPDATE payments SET status = ?, amount = ?, transaction_id = COALESCE(transaction_id, ?), paid_at = CASE WHEN ? > 0 THEN COALESCE(paid_at, CURRENT_TIMESTAMP) ELSE paid_at END, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .bind(captureAmount > 0 ? 'paid' : 'refunded', captureAmount, authorizationId, captureAmount, payment.id),
    c.env.RENT.prepare("UPDATE orders SET refundMethod = ?, deposit_status = ?, deposit_deduction_amount = ?, deposit_refund_amount = ?, deposit_held_amount = 0, deposit_refund_at = CURRENT_TIMESTAMP, settlement_status = ? WHERE id = ?")
      .bind(selectedRefundMethod, nextStatus, deductionAmount, refundToBalance ? totalReleased : 0, computeOrderSettlementStatus({ status: order.status, deposit_status: nextStatus }), order.id),
    c.env.RENT.prepare("UPDATE devices SET status = 'available' WHERE id = ? AND lifecycle_status NOT IN ('DAMAGED', 'MAINTENANCE', 'RETIRED')").bind(order.deviceId),
    // 原路释放没有实际退款；退余额则记录实际入账的可退押金。
    c.env.RENT.prepare(`INSERT INTO payment_refunds (id, refund_number, order_id, payment_id, type, refundable_amount, refund_amount, refunded_processing_fee, deduction_amount, deduction_category, deduction_reason, status, processed_by, refund_method)
      VALUES (?, ?, ?, ?, 'deposit', ?, ?, 0, ?, ?, ?, 'succeeded', ?, ?)`)
      .bind(`rf-${nanoid(12)}`, generateReferenceNumber('RFD'), order.id, payment.id, depositAmount, refundToBalance ? refundAmount : 0, deductionAmount, deductionAmount > 0 ? deduction.category : null, deductionAmount > 0 ? deduction.reason : refundToBalance ? '押金退款退回账户余额' : '押金预授权全额释放', admin.id, refundToBalance ? 'balance' : 'stripe'),
  ]
  // 原授权分配保留为历史事实，追加释放金额，避免将未捕获的押金计为实收。
  if (!refundToBalance && refundAmount > 0) statements.push(c.env.RENT.prepare("INSERT OR IGNORE INTO payment_allocations (id, payment_id, order_id, allocation_type, amount) VALUES (?, ?, ?, 'DEPOSIT', ?)").bind(`pa-release-${payment.id}`, payment.id, order.id, -refundAmount))
  if (refundToBalance && refundAmount > 0) statements.push(c.env.RENT.prepare('UPDATE users SET balance = balance + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(refundAmount, order.userId))
  await c.env.RENT.batch(statements)
  if (refundToBalance && refundAmount > 0) await recordBalanceTransaction(c, order.userId, refundAmount, 'refund_credit', '押金退款退回账户余额', admin.id)
  if (fullAuthorization && intent.status === 'succeeded') await issueInvoiceSafely(c, order.id, 'settlePreauthorizedDeposit')
  return c.redirect(`/admin/orders/${order.id}`, 303)
}

async function settleSetupIntentDeposit(c: Context, admin: any, order: any, form: Record<string, any>): Promise<Response> {
  const depositAmount = orderDeposit(order)
  const deductionText = String(form.deductionAmount ?? '0').trim()
  const deductionAmount = Number(deductionText)
  if (!/^\d+(\.\d{1,2})?$/.test(deductionText) || !Number.isFinite(deductionAmount) || deductionAmount < 0) return c.text('扣款金额无效', 400)
  if (deductionAmount < Number(order.overdue_deposit_applied || 0)) return c.text('扣款金额不能低于已计入的逾期归还费用', 409)
  const deduction = validateDepositDeduction(form, depositAmount, deductionAmount)
  if (deduction instanceof Response) return deduction
  if (deductionAmount === 0) {
    await c.env.RENT.prepare("UPDATE orders SET deposit_status = 'NOT_REQUIRED', deposit_deduction_amount = 0, deposit_refund_amount = 0, deposit_refund_at = CURRENT_TIMESTAMP, settlement_status = ? WHERE id = ?").bind(computeOrderSettlementStatus({ status: order.status, deposit_status: 'NOT_REQUIRED' }), order.id).run()
    return c.redirect(`/admin/orders/${order.id}`, 303)
  }
  const paymentMethodId = String((order as any).stripe_payment_method_id || '')
  if (!/^pm_[A-Za-z0-9_]+$/.test(paymentMethodId)) return c.text('订单没有可用于长期租赁结算的已验证信用卡', 409)
  const paymentMethod = await stripeRequest(c, `payment_methods/${paymentMethodId}`)
  const customerId = typeof paymentMethod.customer === 'string' ? paymentMethod.customer : String(paymentMethod.customer?.id || '')
  const intent = await stripeRequest(c, 'payment_intents', new URLSearchParams({
    amount: String(cents(deductionAmount)), currency: 'aud', ...(customerId ? { customer: customerId } : {}), payment_method: paymentMethodId,
    confirm: 'true', off_session: 'true',
    'metadata[order_id]': String(order.id), 'metadata[type]': 'deposit_charge',
    'metadata[deduction_amount]': String(cents(deductionAmount)),
  }), `deposit-charge-${order.id}`)
  if (intent.status !== 'succeeded') return c.text('长期租赁押金扣款尚未成功，请改由客服处理', 502)
  const paymentId = `p-${nanoid(12)}`
  await c.env.RENT.batch([
    c.env.RENT.prepare(`INSERT INTO payments (id, rental_id, customer_id, payment_method, amount, deposit_amount, rental_amount, currency, status, transaction_id, paid_at, stripe_payment_intent_id, processing_fee)
      VALUES (?, ?, ?, 'card', ?, ?, 0, 'AUD', 'paid', ?, CURRENT_TIMESTAMP, ?, 0)`)
      .bind(paymentId, order.id, order.userId, deductionAmount, deductionAmount, intent.id, intent.id),
    c.env.RENT.prepare(`INSERT INTO payment_refunds (id, refund_number, order_id, payment_id, type, refundable_amount, refund_amount, refunded_processing_fee, deduction_amount, deduction_category, deduction_reason, status, processed_by, refund_method)
      VALUES (?, ?, ?, ?, 'deposit', 0, 0, 0, ?, ?, ?, 'succeeded', ?, 'stripe')`)
      .bind(`rf-${nanoid(12)}`, generateReferenceNumber('RFD'), order.id, paymentId, deductionAmount, deduction.category, deduction.reason, admin.id),
    c.env.RENT.prepare("UPDATE orders SET deposit_status = ?, deposit_deduction_amount = ?, deposit_refund_amount = 0, deposit_refund_at = CURRENT_TIMESTAMP, settlement_status = ? WHERE id = ?")
      .bind(deductionAmount >= depositAmount ? 'FORFEITED' : 'PARTIALLY_DEDUCTED', deductionAmount, computeOrderSettlementStatus({ status: order.status, deposit_status: deductionAmount >= depositAmount ? 'FORFEITED' : 'PARTIALLY_DEDUCTED' }), order.id),
  ])
  return c.redirect(`/admin/orders/${order.id}`, 303)
}

export async function refundDeposit(c: Context, admin: any, orderId: string, form: Record<string, any>): Promise<Response> {
  const order = await getOrderById(c, orderId)
  if (!order) return c.text('订单不存在', 404)
  if (order.status !== 'completed') return c.text('只有已归还并完成的订单才能处理押金', 409)
  const depositMode = depositPaymentModeForOrder(order)
  if (depositMode !== 'PAID') {
    const settled = await c.env.RENT.prepare("SELECT id FROM payment_refunds WHERE order_id = ? AND type = 'deposit' AND status = 'succeeded' LIMIT 1").bind(order.id).first()
    if (isCardDepositSettled(order, Boolean(settled))) return c.text('该笔押金已结算，不能重复处理', 409)
  }
  if (depositMode === 'PREAUTH') {
    // 逾期任务会提前把押金标为扣除，但预授权仍需在归还时实际请款。
    const overdueDeduction = Number(order.overdue_deposit_applied || 0) > 0 && ['PARTIALLY_DEDUCTED', 'FORFEITED'].includes(String(order.deposit_status || ''))
    if (!['HELD', 'REFUND_PENDING'].includes(String(order.deposit_status || '')) && !overdueDeduction) return c.text('该笔信用卡预授权已结算或未完成授权，不能重复处理', 409)
    return settlePreauthorizedDeposit(c, admin, order, form)
  }
  if (depositMode === 'SETUP_INTENT') return settleSetupIntentDeposit(c, admin, order, form)
  const payment = await paidPayment(c, order, 'deposit')
  if (await hasOpenPaymentDispute(c, payment.id)) return c.text('该笔付款存在未解决的拒付争议，暂不能退款', 409)
  const refundedResult = await c.env.RENT.prepare(`
    SELECT COALESCE(SUM(refund_amount), 0) AS refunded_amount
    FROM payment_refunds
    WHERE payment_id = ? AND type = 'deposit' AND status = 'succeeded'
  `).bind(payment.id).first() as any
  const previouslyRefunded = Number(refundedResult?.refunded_amount || 0)
  const selectedRefundMethod = String(form.refundMethod || order.refundMethod || 'balance')
  if (!['balance', 'original', 'bank_transfer'].includes(selectedRefundMethod)) return c.text('退款方式无效', 400)
  if (selectedRefundMethod === 'bank_transfer') order.refundMethod = 'original'
  else order.refundMethod = selectedRefundMethod as any
  if (selectedRefundMethod === 'bank_transfer') {
    const bankAccount = { bsb: String(form.refundBsb || order.refundBsb || '').trim(), number: String(form.refundAccountNumber || order.refundAccountNumber || '').trim(), name: String(form.refundAccountName || order.refundAccountName || '').trim() }
    if (!/^\d{3}-?\d{3}$/.test(bankAccount.bsb) || !/^\d{4,10}$/.test(bankAccount.number) || !bankAccount.name) return c.text('银行转账退款需要完整的 BSB、账号和账户名', 400)
    order.refundBsb = bankAccount.bsb; order.refundAccountNumber = bankAccount.number; order.refundAccountName = bankAccount.name
    payment.payment_method = 'bank_transfer'
  }
  const refundText = String(form.refundAmount ?? '').trim()
  const refundAmount = Number(refundText)
  const depositAmount = Math.max(Number(payment.deposit_amount || 0), orderDeposit(order))
  const remainingRefundable = Number(Math.max(0, depositAmount - previouslyRefunded).toFixed(2))
  const pendingPriceRefund = Number((await c.env.RENT.prepare("SELECT COALESCE(SUM(amount), 0) AS amount FROM order_price_adjustments WHERE order_id = ? AND direction = 'decrease' AND status = 'succeeded' AND refund_method = 'pending_deposit' AND deposit_refunded = 0").bind(order.id).first() as any)?.amount || 0)
  const remainingTotalRefundable = Number((remainingRefundable + pendingPriceRefund).toFixed(2))
  if (!/^\d+(\.\d{1,2})?$/.test(refundText) || !Number.isFinite(refundAmount) || refundAmount < 0 || refundAmount > remainingTotalRefundable || (pendingPriceRefund > 0 && refundAmount < pendingPriceRefund)) return c.text(`退款金额无效：本次应至少包含差价 ${pendingPriceRefund.toFixed(2)} AUD，最多可退 ${remainingTotalRefundable.toFixed(2)} AUD`, 400)
  const priceRefundAmount = Math.min(pendingPriceRefund, refundAmount)
  const depositRefundAmount = Number((refundAmount - priceRefundAmount).toFixed(2))
  const totalRefunded = Number((previouslyRefunded + depositRefundAmount).toFixed(2))
  const deductionAmount = Number(Math.max(0, depositAmount - totalRefunded).toFixed(2))
  if (deductionAmount < Number((order as any).overdue_deposit_applied || 0)) return c.text('退款金额不能覆盖已计入的逾期归还费用', 409)
  const refundedProcessingFee = refundableDepositFee(depositRefundAmount, payment)
  const totalRefundAmount = Number((refundAmount + refundedProcessingFee).toFixed(2))
  const refundItem = String(form.refundItem || 'deposit').trim()
  const customRefundItem = String(form.customRefundItem || '').trim()
  if (refundItem === 'other' && !customRefundItem) return c.text('请输入其他退款项目名称', 400)
  const refundItemLabel = refundItem === 'other' ? customRefundItem : '押金退款'
  const reason = String(form.deductionReason || '').trim()
  const deductionCategory = String(form.deductionCategory || '').trim()
  const validDeductionCategories = new Set(['DAMAGE', 'MISSING_ACCESSORY', 'LATE_FEE', 'DEVICE_NOT_RETURNED', 'OTHER'])
  if (deductionAmount > 0 && !validDeductionCategories.has(deductionCategory)) return c.text('请选择有效的押金扣款类别', 400)
  const recordedReason = reason ? `${refundItemLabel}；${reason}` : refundItemLabel
  if (deductionAmount > 0 && !reason) return c.text('扣除押金时必须填写原因', 400)

  await c.env.RENT.prepare('UPDATE orders SET refundMethod = ?, refundBsb = ?, refundAccountNumber = ?, refundAccountName = ? WHERE id = ?').bind(order.refundMethod, order.refundBsb || null, order.refundAccountNumber || null, order.refundAccountName || null, order.id).run()

  let stripeRefundId: string | null = null
  let channel = refundChannel(order, payment)
  const isStripeDepositPayment = String(payment?.payment_provider || '') === 'stripe' && Number(payment?.rental_amount || 0) === 0 && Number(payment?.deposit_amount || 0) > 0
  const stripeRefundToBalance = isStripeDepositPayment && channel === 'balance'
  if (channel === 'unavailable' && refundAmount > 0) return c.text('历史信用卡付款没有 Stripe 交易编号，无法原路退款；请先将退款方式改为余额', 409)
  if (channel === 'unavailable') channel = 'balance'
  if (channel === 'bank_transfer' && (!order.refundBsb || !order.refundAccountNumber || !order.refundAccountName)) return c.text('订单缺少银行退款账户信息', 409)
  if (depositRefundAmount > 0 && (channel === 'stripe' || stripeRefundToBalance)) {
    const params = new URLSearchParams({
      payment_intent: payment.stripe_payment_intent_id,
      amount: String(cents(totalRefundAmount)),
      'metadata[order_id]': order.id,
      'metadata[type]': 'deposit',
    })
    const refund = await stripeRequest(c, 'refunds', params, `deposit-refund-${order.id}`)
    if (refund.status !== 'succeeded') return c.text('Stripe 押金退款尚未成功，请稍后重试', 502)
    stripeRefundId = refund.id
  }

  const isBankTransfer = channel === 'bank_transfer'
  const nextDepositStatus = isBankTransfer ? 'REFUND_PENDING' : totalRefunded >= depositAmount ? 'REFUNDED' : totalRefunded <= 0 ? 'FORFEITED' : 'PARTIALLY_REFUNDED'
  await c.env.RENT.batch([
    c.env.RENT.prepare(`INSERT INTO payment_refunds (id, refund_number, order_id, payment_id, type, refundable_amount, refund_amount, refunded_processing_fee, deduction_amount, deduction_category, deduction_reason, stripe_refund_id, status, processed_by, refund_method, refund_bsb, refund_account_number, refund_account_name) VALUES (?, ?, ?, ?, 'deposit', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(`rf-${nanoid(12)}`, generateReferenceNumber('RFD'), order.id, payment.id, remainingRefundable, depositRefundAmount, refundedProcessingFee, deductionAmount, deductionAmount > 0 ? deductionCategory : null, recordedReason, stripeRefundId, isBankTransfer ? 'pending' : 'succeeded', admin.id, channel, isBankTransfer ? order.refundBsb : null, isBankTransfer ? order.refundAccountNumber : null, isBankTransfer ? order.refundAccountName : null),
    ...(priceRefundAmount > 0 ? [c.env.RENT.prepare("UPDATE order_price_adjustments SET deposit_refunded = 1, updated_at = CURRENT_TIMESTAMP WHERE order_id = ? AND direction = 'decrease' AND status = 'succeeded' AND refund_method = 'pending_deposit' AND deposit_refunded = 0").bind(order.id)] : []),
    ...(totalRefundAmount > 0 && channel === 'balance' ? [c.env.RENT.prepare('UPDATE users SET balance = balance + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(totalRefundAmount, order.userId)] : []),
    c.env.RENT.prepare("UPDATE orders SET deposit_status = ?, deposit_deduction_amount = ?, deposit_refund_amount = ?, deposit_refund_at = CURRENT_TIMESTAMP, settlement_status = ? WHERE id = ?").bind(nextDepositStatus, deductionAmount, totalRefunded, computeOrderSettlementStatus({ status: order.status, deposit_status: nextDepositStatus }), order.id),
    c.env.RENT.prepare("UPDATE devices SET status = 'available' WHERE id = ?").bind(order.deviceId),
  ])
  if (totalRefundAmount > 0 && channel === 'balance') await recordBalanceTransaction(c, order.userId, totalRefundAmount, 'refund_credit', `${refundItemLabel}退回账户余额`, admin.id)
  if (!isBankTransfer) {
    const refund = await c.env.RENT.prepare("SELECT id FROM payment_refunds WHERE order_id = ? AND type = 'deposit' AND status = 'succeeded' ORDER BY created_at DESC LIMIT 1").bind(order.id).first() as any
    if (refund) await recordFinancialLedgerEntry(c, { entryType: 'REFUND', amount: -totalRefundAmount, customerId: order.userId, orderId: order.id, sourceType: 'PAYMENT_REFUND', sourceId: refund.id, description: refundItemLabel, createdBy: admin.id, metadata: { channel, principal: refundAmount, processingFee: refundedProcessingFee } })
    if (refundAmount > 0) await issueCreditNoteSafely(c, order.id, refundAmount, refundedProcessingFee, `deposit-${nanoid(12)}`, 'refundDeposit')
  }
  return c.redirect(`/admin/orders/${order.id}`, 303)
}

export async function executeApprovedDepositSettlement(c: Context, actor: any, settlementId: string, orderId: string, form: Record<string, any>): Promise<Response> {
  const claim = await c.env.RENT.prepare("UPDATE deposit_settlements SET status = 'EXECUTED', executed_by = ?, executed_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'APPROVED'").bind(actor.id, settlementId).run() as any
  if (!claim.meta?.changes) return c.text('该押金结算单已被处理，请刷新页面', 409)
  let response: Response
  try {
    await c.env.RENT.prepare("UPDATE orders SET deposit_status = 'REFUND_PENDING', settlement_status = 'PENDING' WHERE id = ? AND deposit_payment_mode = 'PREAUTH'").bind(orderId).run()
    response = await refundDeposit(c, actor, orderId, form)
  } catch (error: any) {
    response = c.text(error.message || '押金退款失败', 502)
  }
  if (response.status >= 400) {
    await c.env.RENT.prepare("UPDATE deposit_settlements SET status = 'APPROVED', executed_by = NULL, executed_at = NULL WHERE id = ? AND status = 'EXECUTED'").bind(settlementId).run()
  } else {
    await createAuditLog(c, { actor, action: 'DEPOSIT_SETTLEMENT_EXECUTED', targetType: 'DEPOSIT_SETTLEMENT', targetId: settlementId, before: { status: 'APPROVED' }, after: { status: 'EXECUTED' } })
  }
  return response
}

/** 设备归还后结算完整预授权；失败保留批准的金额，供管理员原样重试。 */
export async function settleCompletedOrderAuthorization(c: Context, actor: any, orderId: string): Promise<Response | null> {
  const order = await getOrderById(c, orderId)
  if (!order || order.status !== 'completed' || depositPaymentModeForOrder(order) !== 'PREAUTH') return null
  const settled = await c.env.RENT.prepare("SELECT id FROM payment_refunds WHERE order_id = ? AND type = 'deposit' AND status = 'succeeded' LIMIT 1").bind(order.id).first()
  if (isCardDepositSettled(order, Boolean(settled))) return null
  let settlement = await c.env.RENT.prepare('SELECT * FROM deposit_settlements WHERE order_id = ?').bind(order.id).first() as any
  if (!settlement) {
    const inspection = await c.env.RENT.prepare("SELECT snapshot_json FROM device_inspections WHERE rental_id = ? AND inspection_type = 'after_return' AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1").bind(order.id).first() as any
    const snapshot = JSON.parse(inspection?.snapshot_json || '{}')
    const damageAmount = Number(snapshot.replacementCost || 0)
    const overdueAmount = Math.max(0, Number(order.overdue_deposit_applied || 0))
    const deductionAmount = Number((damageAmount + overdueAmount).toFixed(2))
    const depositAmount = orderDeposit(order)
    const form = { deductionCategory: damageAmount > 0 ? 'DAMAGE' : overdueAmount > 0 ? 'LATE_FEE' : '', deductionReason: [damageAmount > 0 ? String(snapshot.damageDescription || '').trim() : '', overdueAmount > 0 ? `逾期费用 AUD$${overdueAmount.toFixed(2)}` : ''].filter(Boolean).join('；') }
    const deduction = validateDepositDeduction(form, depositAmount, deductionAmount)
    if (!Number.isFinite(damageAmount) || damageAmount < 0) return c.text('扣款金额无效', 400)
    if (deduction instanceof Response) return deduction
    const refundAmount = Number((depositAmount - deductionAmount).toFixed(2))
    const refundMethod = order.refundMethod === 'balance' ? 'balance' : 'original'
    const settlementId = `dst-${nanoid(12)}`
    const document = { orderId: order.id, depositAmount, refundAmount, deductionAmount, ...form, refundMethod, requestedBy: actor.id }
    await c.env.RENT.prepare("INSERT INTO deposit_settlements (id, order_id, deposit_amount, refund_amount, deduction_amount, deduction_category, deduction_reason, refund_method, status, requested_by, settlement_number, document_snapshot) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'APPROVED', ?, ?, ?) ON CONFLICT(order_id) DO NOTHING")
      .bind(settlementId, order.id, depositAmount, refundAmount, deductionAmount, form.deductionCategory || null, form.deductionReason || null, refundMethod, actor.id, generateReferenceNumber('DST'), JSON.stringify(document)).run()
    settlement = await c.env.RENT.prepare('SELECT * FROM deposit_settlements WHERE order_id = ?').bind(order.id).first() as any
  }
  if (settlement?.status !== 'APPROVED') return c.text('该押金结算单已被处理，请刷新页面', 409)
  const response = await executeApprovedDepositSettlement(c, actor, settlement.id, order.id, {
    refundAmount: Number(settlement.refund_amount).toFixed(2), refundMethod: settlement.refund_method,
    deductionCategory: settlement.deduction_category || '', deductionReason: settlement.deduction_reason || '',
  })
  if (response.status >= 400) await logError(c, 'ERROR', '归还后信用卡预授权结算失败', new Error(await response.clone().text()), { orderId })
  return response
}

export async function refundUnusedRentalDays(c: Context, admin: any, order: any, returnedDate: string): Promise<void> {
  const end = new Date(`${order.endDate}T00:00:00Z`).getTime()
  const returned = new Date(`${returnedDate}T00:00:00Z`).getTime()
  const unusedDays = Math.max(0, Math.ceil((end - returned) / 86400000))
  const amount = Number((unusedDays * Number(order.dailyRate || 0)).toFixed(2))
  if (!amount) return
  const existing = await c.env.RENT.prepare("SELECT id FROM payment_refunds WHERE order_id = ? AND type = 'early_return' AND status IN ('pending', 'succeeded')").bind(order.id).first()
  if (existing) return
  const payment = await paidPayment(c, order)
  if (await hasOpenPaymentDispute(c, payment.id)) throw new Error('该笔付款存在未解决的拒付争议，暂不能退还未使用租金')
  let channel = refundChannel(order, payment)
  if (channel === 'unavailable') channel = 'balance'
  if (channel === 'bank_transfer') {
    await c.env.RENT.prepare(`INSERT INTO payment_refunds (id, refund_number, order_id, payment_id, type, refundable_amount, refund_amount, deduction_amount, status, processed_by, refund_method, refund_bsb, refund_account_number, refund_account_name, deduction_reason) VALUES (?, ?, ?, ?, 'early_return', ?, ?, 0, 'pending', ?, 'bank_transfer', ?, ?, ?, ?)`)
      .bind(`rf-${nanoid(12)}`, generateReferenceNumber('RFD'), order.id, payment.id, amount, amount, admin.id, order.refundBsb || null, order.refundAccountNumber || null, order.refundAccountName || null, `提前归还，未使用 ${unusedDays} 天租金`)
      .run()
    return
  }
  let stripeRefundId: string | null = null
  if (channel === 'stripe') {
    const refund = await stripeRequest(c, 'refunds', new URLSearchParams({ payment_intent: payment.stripe_payment_intent_id, amount: String(cents(amount)), 'metadata[order_id]': order.id, 'metadata[type]': 'early_return' }), `early-return-refund-${order.id}`)
    if (refund.status !== 'succeeded') throw new Error('未使用租金退款尚未成功，请稍后重试')
    stripeRefundId = refund.id
  }
  await c.env.RENT.batch([
    c.env.RENT.prepare(`INSERT INTO payment_refunds (id, refund_number, order_id, payment_id, type, refundable_amount, refund_amount, deduction_amount, stripe_refund_id, status, processed_by, refund_method) VALUES (?, ?, ?, ?, 'early_return', ?, ?, 0, ?, 'succeeded', ?, ?)`)
      .bind(`rf-${nanoid(12)}`, generateReferenceNumber('RFD'), order.id, payment.id, amount, amount, stripeRefundId, admin.id, channel),
    ...(channel === 'balance' ? [c.env.RENT.prepare('UPDATE users SET balance = balance + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(amount, order.userId)] : []),
  ])
  if (channel === 'balance') await recordBalanceTransaction(c, order.userId, amount, 'refund_credit', `提前归还未使用租金退款`, admin.id)
  const refund = await c.env.RENT.prepare("SELECT id FROM payment_refunds WHERE order_id = ? AND type = 'early_return' AND status = 'succeeded' ORDER BY created_at DESC LIMIT 1").bind(order.id).first() as any
  if (refund) await recordFinancialLedgerEntry(c, { entryType: 'REFUND', amount: -amount, customerId: order.userId, orderId: order.id, sourceType: 'PAYMENT_REFUND', sourceId: refund.id, description: '提前归还未使用租金退款', createdBy: admin.id, metadata: { channel } })
  await issueCreditNoteSafely(c, order.id, amount, 0, `early-${nanoid(12)}`, 'refundUnusedRentalDays')
}

// 客户主动取消自己的待支付订单：尚未发生实际扣款（无论是常规 PaymentIntent 还是
// 短租的一次性预授权），取消时会一并告诉 Stripe 放弃未结算的 PaymentIntent（见
// applyPendingPaymentCancellation），无需退款。
export async function cancelPendingPaymentOrderByCustomer(c: Context, user: any, orderId: string): Promise<void> {
  const order = await getOrderById(c, orderId)
  if (!order || order.userId !== user.id) throw new Error('订单不存在或无权访问')
  if (order.status !== 'pending_payment') throw new Error('该订单当前不是待支付状态，不能取消')
  const cancelled = await applyPendingPaymentCancellation(c, order as any)
  if (!cancelled) throw new Error('订单状态已变化，请刷新后重试')
  await revokeReferralRewardForOrder(c, order.id, '客户取消待支付订单')
}

export async function cancelAndRefund(c: Context, admin: any, orderId: string, reason?: string, options: { deductionAmount?: number; deductionReason?: string; allowedStatuses?: string[] } = {}): Promise<Response> {
  const order = await getOrderById(c, orderId)
  if (!order) return c.text('订单不存在', 404)
  if (options.allowedStatuses?.length && !options.allowedStatuses.includes(String(order.status))) return c.text('订单状态已变化，不能自动取消', 409)
  const mayReleasePendingAuthorization = order.status === 'pending_payment' && String((order as any).deposit_payment_mode || '') === 'PREAUTH'
  const canCancelBeforeHandover = !order.handover_completed_at && !['cancelled', 'completed', 'returned', 'pending_return'].includes(String(order.status))
  if (!canCancelBeforeHandover && !mayReleasePendingAuthorization) return c.text('只有尚未交付的订单可取消', 409)
  const existingRefund = await c.env.RENT.prepare("SELECT id FROM payment_refunds WHERE order_id = ? AND type = 'cancellation' AND status = 'succeeded'").bind(order.id).first()
  if (existingRefund) return c.text('该订单已经全额退款', 409)
  const payment = await c.env.RENT.prepare("SELECT * FROM payments WHERE rental_id = ? AND (status = 'paid' OR (status = 'pending' AND payment_method = 'card' AND stripe_payment_intent_id = (SELECT stripe_deposit_payment_intent_id FROM orders WHERE id = ?))) ORDER BY CASE WHEN status = 'paid' THEN 0 ELSE 1 END, paid_at DESC LIMIT 1").bind(order.id, order.id).first() as any
  if (!payment) return c.text('未找到已结算付款，不能自动退款', 409)
  if (await hasOpenPaymentDispute(c, payment.id)) return c.text('该笔付款存在未解决的拒付争议，暂不能退款', 409)
  const channel = cancellationRefundChannel(payment)
  if (channel === 'unavailable') return c.text('未找到信用卡原路退款所需的 Stripe 交易记录，不能改为余额退款', 409)
  if (payment.status === 'pending') {
    const intent = await stripeRequest(c, `payment_intents/${payment.stripe_payment_intent_id}`).catch(() => null)
    if (!intent || !['requires_capture', 'canceled'].includes(String(intent.status))) return c.text('信用卡预授权状态无效，暂不能取消订单', 409)
    if (intent.status === 'requires_capture') await stripeRequest(c, `payment_intents/${payment.stripe_payment_intent_id}/cancel`, new URLSearchParams(), `cancellation-release-${order.id}`)
    await c.env.RENT.batch([
      c.env.RENT.prepare(`INSERT INTO payment_refunds (id, refund_number, order_id, payment_id, type, refundable_amount, refund_amount, deduction_amount, status, processed_by, refund_method, deduction_reason) VALUES (?, ?, ?, ?, 'cancellation', ?, 0, 0, 'succeeded', ?, 'stripe', '预授权已释放，未发生实际扣款')`)
        .bind(`rf-${nanoid(12)}`, generateReferenceNumber('RFD'), order.id, payment.id, Number(payment.amount || 0), admin.id),
      c.env.RENT.prepare("UPDATE payments SET status = 'failed', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'pending'").bind(payment.id),
      c.env.RENT.prepare("UPDATE orders SET status = 'cancelled', updatedAt = CURRENT_TIMESTAMP WHERE id = ?").bind(order.id),
      c.env.RENT.prepare("UPDATE contracts SET status = 'cancelled', updatedAt = CURRENT_TIMESTAMP WHERE orderId = ? AND status IN ('draft', 'pending_sign', 'signed')").bind(order.id),
      c.env.RENT.prepare("UPDATE devices SET status = 'available' WHERE id = ?").bind(order.deviceId),
    ])
    await releaseCouponForOrder(c, order.id)
    await revokeReferralRewardForOrder(c, order.id, '订单取消并释放预授权')
    await createNotification(c, { recipientId: order.userId, senderId: admin.id, type: 'rental_cancelled', title: '订单已取消', message: `您的订单 ${order.orderNo || order.id} 已取消${reason ? `，原因：${reason}` : ''}。`, orderId: order.id })
    return c.redirect(`/admin/orders/${order.id}`, 303)
  }
  if (channel === 'bank_transfer' && (!order.refundBsb || !order.refundAccountNumber || !order.refundAccountName)) return c.text('订单缺少银行退款账户信息', 409)
  const refundableAmount = Number(payment.amount || 0)
  if (!Number.isFinite(refundableAmount) || refundableAmount <= 0) return c.text('原始付款金额无效，不能自动退款', 409)
  const deductionAmount = Number(Math.min(refundableAmount, Math.max(0, Number(options.deductionAmount || 0))).toFixed(2))
  const refundAmount = Number((refundableAmount - deductionAmount).toFixed(2))
  const deductionReason = deductionAmount > 0 ? String(options.deductionReason || '取消订单操作手续费') : null
  const refundedProcessingFee = Math.min(refundAmount, Math.max(0, Number(payment.processing_fee || 0)))

  if (channel === 'bank_transfer') {
    await c.env.RENT.batch([
      c.env.RENT.prepare(`INSERT INTO payment_refunds (id, refund_number, order_id, payment_id, type, refundable_amount, refund_amount, deduction_amount, status, processed_by, refund_method, refund_bsb, refund_account_number, refund_account_name, deduction_reason) VALUES (?, ?, ?, ?, 'cancellation', ?, ?, ?, 'pending', ?, 'bank_transfer', ?, ?, ?, ?)`)
        .bind(`rf-${nanoid(12)}`, generateReferenceNumber('RFD'), order.id, payment.id, refundableAmount, refundAmount, deductionAmount, admin.id, order.refundBsb, order.refundAccountNumber, order.refundAccountName, deductionReason || '租前取消，等待管理员银行转账'),
      c.env.RENT.prepare("UPDATE payments SET status = 'refunded', updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(payment.id),
      c.env.RENT.prepare("UPDATE orders SET status = 'cancelled', updatedAt = CURRENT_TIMESTAMP WHERE id = ?").bind(order.id),
      c.env.RENT.prepare("UPDATE contracts SET status = 'cancelled', updatedAt = CURRENT_TIMESTAMP WHERE orderId = ? AND status IN ('draft', 'pending_sign', 'signed')").bind(order.id),
      c.env.RENT.prepare("UPDATE devices SET status = 'available' WHERE id = ?").bind(order.deviceId),
    ])
    await releaseCouponForOrder(c, order.id)
    await revokeReferralRewardForOrder(c, order.id, '订单取消并退款')
    await createNotification(c, { recipientId: order.userId, senderId: admin.id, type: 'rental_cancelled', title: '订单已取消', message: `您的订单 ${order.orderNo || order.id} 已取消，退款将通过银行转账处理${deductionAmount ? `，已扣除 AUD ${deductionAmount.toFixed(2)} 操作手续费` : ''}${reason ? `，原因：${reason}` : ''}。`, orderId: order.id })
    return c.redirect(`/admin/orders/${order.id}`, 303)
  }

  let stripeRefundId: string | null = null
  if (channel === 'stripe' && refundAmount > 0) {
    const params = new URLSearchParams({ payment_intent: payment.stripe_payment_intent_id, amount: String(cents(refundAmount)), 'metadata[order_id]': order.id, 'metadata[type]': 'cancellation' })
    const refund = await stripeRequest(c, 'refunds', params, `cancellation-refund-${order.id}`)
    if (refund.status !== 'succeeded') return c.text('Stripe 全额退款尚未成功，请稍后重试', 502)
    stripeRefundId = refund.id
  }

  await c.env.RENT.batch([
    c.env.RENT.prepare(`INSERT INTO payment_refunds (id, refund_number, order_id, payment_id, type, refundable_amount, refund_amount, refunded_processing_fee, deduction_amount, deduction_reason, stripe_refund_id, status, processed_by, refund_method, refund_bsb, refund_account_number, refund_account_name) VALUES (?, ?, ?, ?, 'cancellation', ?, ?, ?, ?, ?, ?, 'succeeded', ?, ?, ?, ?, ?)`)
      .bind(`rf-${nanoid(12)}`, generateReferenceNumber('RFD'), order.id, payment.id, refundableAmount, refundAmount, refundedProcessingFee, deductionAmount, deductionReason, stripeRefundId, admin.id, channel, null, null, null),
    ...(channel === 'balance' ? [c.env.RENT.prepare('UPDATE users SET balance = balance + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(refundAmount, order.userId)] : []),
    c.env.RENT.prepare("UPDATE payments SET status = 'refunded', updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(payment.id),
    c.env.RENT.prepare("UPDATE orders SET status = 'cancelled', updatedAt = CURRENT_TIMESTAMP WHERE id = ?").bind(order.id),
    c.env.RENT.prepare("UPDATE contracts SET status = 'cancelled', updatedAt = CURRENT_TIMESTAMP WHERE orderId = ? AND status IN ('draft', 'pending_sign', 'signed')").bind(order.id),
    c.env.RENT.prepare("UPDATE devices SET status = 'available' WHERE id = ?").bind(order.deviceId),
  ])
  await releaseCouponForOrder(c, order.id)
  await revokeReferralRewardForOrder(c, order.id, '订单取消并退款')
  if (channel === 'balance' && refundAmount > 0) await recordBalanceTransaction(c, order.userId, refundAmount, 'refund_credit', deductionAmount ? '取消订单退款（已扣操作手续费）' : '取消订单全额退款', admin.id)
  if (refundAmount > 0) await issueCreditNoteSafely(c, order.id, Math.max(0, refundAmount - refundedProcessingFee), refundedProcessingFee, `cancellation-${nanoid(12)}`, 'cancelAndRefund')
  await c.env.RENT.prepare("INSERT INTO order_change_history (id, order_id, change_type, before_json, after_json, reason, changed_by) VALUES (?, ?, 'CANCELLATION', ?, ?, ?, ?)").bind(`och-${nanoid(12)}`, order.id, JSON.stringify({ status: order.status, deviceId: order.deviceId }), JSON.stringify({ status: 'cancelled', deviceReleased: true }), reason || '取消订单并退款', admin.id).run()
  const refund = await c.env.RENT.prepare("SELECT id FROM payment_refunds WHERE order_id = ? AND type = 'cancellation' AND status = 'succeeded' ORDER BY created_at DESC LIMIT 1").bind(order.id).first() as any
  if (refund && refundAmount > 0) await recordFinancialLedgerEntry(c, { entryType: 'REFUND', amount: -refundAmount, customerId: order.userId, orderId: order.id, sourceType: 'PAYMENT_REFUND', sourceId: refund.id, description: deductionAmount ? '取消订单退款（已扣操作手续费）' : '取消订单全额退款', createdBy: admin.id, metadata: { channel, refundedProcessingFee, deductionAmount } })
  await createNotification(c, { recipientId: order.userId, senderId: admin.id, type: 'refund_completed', title: refundAmount > 0 ? '订单已取消并退款' : '订单已取消', message: `您的订单 ${order.orderNo || order.id} 已取消${refundAmount > 0 ? `并退款 ${refundAmount.toFixed(2)} AUD` : ''}${deductionAmount ? `，已扣除 AUD ${deductionAmount.toFixed(2)} 操作手续费` : ''}${reason ? `，原因：${reason}` : ''}。`, orderId: order.id })
  return c.redirect(`/admin/orders/${order.id}`, 303)
}

export async function expireMissedPickupOrders(c: Context, now = new Date()): Promise<{ expired: number; failed: number }> {
  const administrator = await c.env.RENT.prepare("SELECT id FROM users WHERE role = 'ADMIN' AND COALESCE(status, 'active') = 'active' ORDER BY created_at ASC LIMIT 1").first() as any
  if (!administrator?.id) throw new Error('没有可用于处理逾期取货退款的管理员账户')
  const candidates = ((await c.env.RENT.prepare("SELECT * FROM orders WHERE status IN ('paid', 'pending_pickup') AND handover_completed_at IS NULL AND COALESCE(deliveryMethod, 'Pickup') <> 'Delivery'").all()).results || []) as any[]
  let expired = 0
  let failed = 0
  for (const order of candidates) {
    if (!isPickupHoldExpired(order, now)) continue
    const response = await cancelAndRefund(c, administrator, String(order.id), '超过预约取货时间 2 小时，设备已释放', {
      deductionAmount: 25,
      deductionReason: '超过预约取货时间 2 小时操作手续费',
      allowedStatuses: ['paid', 'pending_pickup'],
    })
    if (response.status >= 400) {
      failed++
      await logError(c, 'ERROR', '自动取消逾期未取货订单失败', new Error(`退款响应 ${response.status}`), { orderId: order.id })
    } else {
      expired++
    }
  }
  return { expired, failed }
}

function dateAfter(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`)
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}

export async function chargeOverdueReturns(c: Context, now = new Date()): Promise<{ overdue: number; charged: number }> {
  const administrator = await c.env.RENT.prepare("SELECT id FROM users WHERE role = 'ADMIN' AND COALESCE(status, 'active') = 'active' ORDER BY created_at ASC LIMIT 1").first() as any
  if (!administrator?.id) throw new Error('没有可用于处理逾期归还的管理员账户')
  const candidates = ((await c.env.RENT.prepare("SELECT o.*, d.pricePerDay FROM orders o LEFT JOIN devices d ON d.id = o.deviceId WHERE o.status IN ('active', 'extended', 'overdue') AND o.return_received_at IS NULL").all()).results || []) as any[]
  let overdue = 0
  let charged = 0
  for (const order of candidates) {
    if (order.is_manual === 1) continue
    const overdueDays = returnOverdueDays(order, now)
    if (overdueDays === null) continue
    overdue++
    const dailyRate = Math.max(0, Number(order.dailyRate || order.pricePerDay || 0))
    const charges = [{ date: String(order.endDate), rental: 0, fee: 25 }, ...Array.from({ length: overdueDays }, (_, index) => ({ date: dateAfter(String(order.endDate), index + 1), rental: dailyRate, fee: 0 }))]
    const before = await c.env.RENT.prepare('SELECT COUNT(*) AS count FROM overdue_return_charges WHERE order_id = ?').bind(order.id).first() as any
    for (const charge of charges) {
      await c.env.RENT.prepare('INSERT OR IGNORE INTO overdue_return_charges (id, order_id, charge_date, rental_amount, handling_fee) VALUES (?, ?, ?, ?, ?)').bind(`orc-${nanoid(12)}`, order.id, charge.date, charge.rental, charge.fee).run()
    }
    const summary = await c.env.RENT.prepare('SELECT COALESCE(SUM(rental_amount + handling_fee), 0) AS total FROM overdue_return_charges WHERE order_id = ?').bind(order.id).first() as any
    const total = Number(Number(summary?.total || 0).toFixed(2))
    const previousDepositApplied = Math.max(0, Number(order.overdue_deposit_applied || 0))
    const otherDepositDeductions = Math.max(0, Number(order.deposit_deduction_amount || 0) - previousDepositApplied)
    const depositHeld = Math.max(0, Number(order.deposit_held_amount || 0))
    const depositAvailable = Math.max(0, depositHeld - otherDepositDeductions)
    const depositApplied = Number(Math.min(total, depositAvailable).toFixed(2))
    const outstanding = Number(Math.max(0, total - depositApplied).toFixed(2))
    const previousOutstanding = Math.max(0, Number(order.overdue_outstanding_amount || 0))
    const amountAdded = Number(Math.max(0, outstanding - previousOutstanding).toFixed(2))
    const nextDepositStatus = depositApplied <= 0 ? order.deposit_status : depositApplied >= depositHeld ? 'FORFEITED' : 'PARTIALLY_DEDUCTED'
    await c.env.RENT.prepare("UPDATE orders SET totalAmount = totalAmount + ?, overdue_charge_total = ?, overdue_deposit_applied = ?, overdue_outstanding_amount = ?, deposit_deduction_amount = ?, deposit_status = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?")
      .bind(amountAdded, total, depositApplied, outstanding, Number((otherDepositDeductions + depositApplied).toFixed(2)), nextDepositStatus, order.id).run()
    if (String(order.status) !== 'overdue') await updateOrderStatus(c, order.id, 'overdue', { reason: '超过预约归还时间 2 小时' })
    const after = await c.env.RENT.prepare('SELECT COUNT(*) AS count FROM overdue_return_charges WHERE order_id = ?').bind(order.id).first() as any
    const addedRows = Math.max(0, Number(after?.count || 0) - Number(before?.count || 0))
    if (addedRows > 0) {
      charged += addedRows
      await createNotification(c, {
        recipientId: order.userId, senderId: administrator.id, type: 'rental_overdue',
        title: '设备归还已逾期',
        message: `订单 ${order.orderNo || order.id} 已超过预约归还时间 2 小时。已计入一次 AUD 25.00 逾期处理手续费${overdueDays ? `及 ${overdueDays} 天逾期租金` : ''}；将优先从押金扣除，押金不足部分为待补款。`,
        orderId: order.id, dedupeKey: `rental-overdue:${order.id}:${charges.at(-1)?.date}`,
      })
    }
  }
  return { overdue, charged }
}

// 补救：订单已经进入 cancelled，但当初的自动退款（Stripe/余额）没有成功写入
// payment_refunds（例如 Stripe 请求失败/超时），导致订单永久卡在待退款队列里且
// 没有任何可点击的操作。cancelAndRefund 本身要求订单尚未取消，无法重用来重试，
// 这里单独补一条路径，只补做退款本身，不重复处理合同/设备/优惠券（取消时已处理）。
export async function retryCancellationRefund(c: Context, admin: any, orderId: string): Promise<Response> {
  const order = await getOrderById(c, orderId)
  if (!order) return c.text('订单不存在', 404)
  if (order.status !== 'cancelled') return c.text('只有已取消的订单可以重试退款', 409)
  const existingRefund = await c.env.RENT.prepare("SELECT id FROM payment_refunds WHERE order_id = ? AND type = 'cancellation'").bind(order.id).first()
  if (existingRefund) return c.text('该订单已经有退款记录', 409)
  const payment = await c.env.RENT.prepare("SELECT * FROM payments WHERE rental_id = ? AND status = 'paid' ORDER BY paid_at DESC LIMIT 1").bind(order.id).first() as any
  if (!payment) return c.text('未找到已结算付款，不能自动退款', 409)
  if (await hasOpenPaymentDispute(c, payment.id)) return c.text('该笔付款存在未解决的拒付争议，暂不能退款', 409)
  const channel = cancellationRefundChannel(payment)
  if (channel === 'unavailable') return c.text('未找到信用卡原路退款所需的 Stripe 交易记录，不能改为余额退款', 409)
  const refundAmount = Number(payment.amount || 0)
  if (!Number.isFinite(refundAmount) || refundAmount <= 0) return c.text('原始付款金额无效，不能自动退款', 409)
  const refundedProcessingFee = Math.max(0, Number(payment.processing_fee || 0))

  if (channel === 'bank_transfer') {
    if (!order.refundBsb || !order.refundAccountNumber || !order.refundAccountName) return c.text('订单缺少银行退款账户信息', 409)
    await c.env.RENT.batch([
      c.env.RENT.prepare(`INSERT INTO payment_refunds (id, refund_number, order_id, payment_id, type, refundable_amount, refund_amount, deduction_amount, status, processed_by, refund_method, refund_bsb, refund_account_number, refund_account_name, deduction_reason) VALUES (?, ?, ?, ?, 'cancellation', ?, ?, 0, 'pending', ?, 'bank_transfer', ?, ?, ?, '租前取消，等待管理员银行转账（重试）')`)
        .bind(`rf-${nanoid(12)}`, generateReferenceNumber('RFD'), order.id, payment.id, refundAmount, refundAmount, admin.id, order.refundBsb, order.refundAccountNumber, order.refundAccountName),
      c.env.RENT.prepare("UPDATE payments SET status = 'refunded', updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(payment.id),
    ])
    await createNotification(c, { recipientId: order.userId, senderId: admin.id, type: 'rental_cancelled', title: '订单退款处理中', message: `您的订单 ${order.orderNo || order.id} 的退款将通过银行转账处理。`, orderId: order.id })
    return c.redirect(`/admin/orders/${order.id}`, 303)
  }

  let stripeRefundId: string | null = null
  if (channel === 'stripe') {
    const params = new URLSearchParams({ payment_intent: payment.stripe_payment_intent_id, amount: String(cents(refundAmount)), 'metadata[order_id]': order.id, 'metadata[type]': 'cancellation' })
    const refund = await stripeRequest(c, 'refunds', params, `cancellation-refund-retry-${order.id}`)
    if (refund.status !== 'succeeded') return c.text('Stripe 全额退款尚未成功，请稍后重试', 502)
    stripeRefundId = refund.id
  }

  await c.env.RENT.batch([
    c.env.RENT.prepare(`INSERT INTO payment_refunds (id, refund_number, order_id, payment_id, type, refundable_amount, refund_amount, refunded_processing_fee, deduction_amount, stripe_refund_id, status, processed_by, refund_method, refund_bsb, refund_account_number, refund_account_name) VALUES (?, ?, ?, ?, 'cancellation', ?, ?, ?, 0, ?, 'succeeded', ?, ?, ?, ?, ?)`)
      .bind(`rf-${nanoid(12)}`, generateReferenceNumber('RFD'), order.id, payment.id, refundAmount, refundAmount, refundedProcessingFee, stripeRefundId, admin.id, channel, null, null, null),
    ...(channel === 'balance' ? [c.env.RENT.prepare('UPDATE users SET balance = balance + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(refundAmount, order.userId)] : []),
    c.env.RENT.prepare("UPDATE payments SET status = 'refunded', updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(payment.id),
  ])
  if (channel === 'balance') await recordBalanceTransaction(c, order.userId, refundAmount, 'refund_credit', '取消订单全额退款（重试）', admin.id)
  await issueCreditNoteSafely(c, order.id, Math.max(0, refundAmount - refundedProcessingFee), refundedProcessingFee, `cancellation-retry-${nanoid(12)}`, 'retryCancellationRefund')
  await c.env.RENT.prepare("INSERT INTO order_change_history (id, order_id, change_type, before_json, after_json, reason, changed_by) VALUES (?, ?, 'CANCELLATION', ?, ?, ?, ?)").bind(`och-${nanoid(12)}`, order.id, JSON.stringify({ status: order.status }), JSON.stringify({ status: 'cancelled', refundRetried: true }), '重试取消订单退款', admin.id).run()
  const refund = await c.env.RENT.prepare("SELECT id FROM payment_refunds WHERE order_id = ? AND type = 'cancellation' AND status = 'succeeded' ORDER BY created_at DESC LIMIT 1").bind(order.id).first() as any
  if (refund) await recordFinancialLedgerEntry(c, { entryType: 'REFUND', amount: -refundAmount, customerId: order.userId, orderId: order.id, sourceType: 'PAYMENT_REFUND', sourceId: refund.id, description: '取消订单全额退款（重试）', createdBy: admin.id, metadata: { channel, refundedProcessingFee } })
  await createNotification(c, { recipientId: order.userId, senderId: admin.id, type: 'refund_completed', title: '订单已退款', message: `您的订单 ${order.orderNo || order.id} 已退款 ${refundAmount.toFixed(2)} AUD。`, orderId: order.id })
  return c.redirect(`/admin/orders/${order.id}`, 303)
}

// 忽略只关闭退款待办，不要求付款记录，也不生成退款或修改实际收付款状态。
export async function ignorePendingRefund(c: Context, admin: any, orderId: string, note?: string): Promise<void> {
  const order = await getOrderById(c, orderId)
  if (!order) throw new Error('订单不存在')
  if (order.refund_ignored_at) throw new Error('该订单已忽略退款')
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Australia/Melbourne' })
  if (!['completed', 'cancelled'].includes(order.status) && !(order.status === 'paid' && order.startDate > today)) throw new Error('该订单没有待处理退款')
  const existingRefund = await c.env.RENT.prepare("SELECT id FROM payment_refunds WHERE order_id = ? AND status = 'succeeded'").bind(order.id).first()
  if (existingRefund || (order.status === 'completed' && order.settlement_status === 'SETTLED')) throw new Error('该订单已经处理过退款')
  const reason = String(note || '').trim().slice(0, 300) || '管理员标记为无需退款'
  const result = await c.env.RENT.prepare("UPDATE orders SET refund_ignored_at = CURRENT_TIMESTAMP, refund_ignored_by = ?, refund_ignore_reason = ? WHERE id = ? AND refund_ignored_at IS NULL AND NOT EXISTS (SELECT 1 FROM payment_refunds r WHERE r.order_id = orders.id AND r.status = 'succeeded')")
    .bind(admin.id, reason, order.id).run()
  if (!result.meta?.changes) throw new Error('该订单已经处理过退款')
}

export async function completeBankTransferRefund(c: Context, admin: any, refundId: string): Promise<void> {
  const pending = await c.env.RENT.prepare("SELECT * FROM payment_refunds WHERE id = ? AND type IN ('cancellation', 'early_return', 'deposit') AND refund_method = 'bank_transfer' AND status = 'pending'").bind(refundId).first() as any
  if (!pending) throw new Error('退款记录不存在或已经处理')
  if (await hasOpenPaymentDispute(c, String(pending.payment_id || ''))) throw new Error('该笔付款存在未解决的拒付争议，暂不能放款')
  const result = await c.env.RENT.prepare("UPDATE payment_refunds SET status = 'succeeded', processed_by = ?, created_at = CURRENT_TIMESTAMP WHERE id = ? AND type IN ('cancellation', 'early_return', 'deposit') AND refund_method = 'bank_transfer' AND status = 'pending'").bind(admin.id, refundId).run()
  if (!result.meta?.changes) throw new Error('退款记录不存在或已经处理')
  if (pending.type !== 'deposit') return

  const order = await getOrderById(c, pending.order_id)
  if (!order) return
  const payment = await c.env.RENT.prepare('SELECT deposit_amount FROM payments WHERE id = ?').bind(pending.payment_id).first() as any
  const depositAmount = Math.max(Number(payment?.deposit_amount || 0), orderDeposit(order))
  const totalRefunded = Number((await c.env.RENT.prepare("SELECT COALESCE(SUM(refund_amount), 0) AS amount FROM payment_refunds WHERE payment_id = ? AND type = 'deposit' AND status = 'succeeded'").bind(pending.payment_id).first() as any)?.amount || 0)
  const totalRefundAmount = Number(pending.refund_amount || 0) + Number(pending.refunded_processing_fee || 0)
  const nextDepositStatus = totalRefunded >= depositAmount ? 'REFUNDED' : totalRefunded <= 0 ? 'FORFEITED' : 'PARTIALLY_REFUNDED'
  await c.env.RENT.prepare("UPDATE orders SET deposit_status = ?, deposit_refund_amount = ?, deposit_refund_at = CURRENT_TIMESTAMP, settlement_status = ? WHERE id = ?")
    .bind(nextDepositStatus, totalRefunded, computeOrderSettlementStatus({ status: order.status, deposit_status: nextDepositStatus }), order.id).run()
  const refund = await c.env.RENT.prepare("SELECT id FROM payment_refunds WHERE order_id = ? AND type = 'deposit' AND status = 'succeeded' ORDER BY created_at DESC LIMIT 1").bind(order.id).first() as any
  if (refund) await recordFinancialLedgerEntry(c, { entryType: 'REFUND', amount: -totalRefundAmount, customerId: order.userId, orderId: order.id, sourceType: 'PAYMENT_REFUND', sourceId: refund.id, description: '押金退款（银行转账）', createdBy: admin.id, metadata: { channel: 'bank_transfer', principal: Number(pending.refund_amount || 0), processingFee: Number(pending.refunded_processing_fee || 0) } })
  if (Number(pending.refund_amount || 0) > 0) await issueCreditNote(c, order.id, Number(pending.refund_amount || 0), Number(pending.refunded_processing_fee || 0), `deposit-${nanoid(12)}`)
  await createNotification(c, { recipientId: order.userId, senderId: admin.id, type: 'deposit_refunded', title: '押金退款已完成', message: `您的订单 ${order.orderNo || order.id} 押金退款 AUD ${totalRefundAmount.toFixed(2)} 已通过银行转账完成，请注意查收。`, orderId: order.id })
}
