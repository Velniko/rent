/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

import type { Context } from 'hono'
import { nanoid } from 'nanoid'
import { getOrderById, getUserById, getDeviceById, getSystemSettings, loadSystemSettingsFromDB, createAuditLog, recordBalanceTransaction, recordFinancialLedgerEntry } from '../site'
import { returnChargeQuote, returnQuoteToken } from '../domain/returnCharges'

export const RETURN_PAYMENT_METHODS: Record<string, string> = { cash: '现金', bank_transfer: '银行转账', balance: '账户余额', alipay: '支付宝', wechat: '微信', card: 'Stripe App' }
const cents = (value: unknown) => Math.round(Number(value || 0) * 100)
export const RETURN_ORDER_STATUSES = ['active', 'extended', 'overdue', 'suspended', 'pending_return', 'completed']

export async function getReturnCollectionOrder(c: Context, user: any, orderId: string) {
  if (!user || !['STAFF', 'ADMIN'].includes(user.role)) throw new Error('无权操作')
  const order = await getOrderById(c, orderId)
  if (!order || !RETURN_ORDER_STATUSES.includes(order.status)) throw new Error('当前订单不能收取归还费用')
  const customer = await getUserById(c, order.userId)
  if (!customer || (user.role === 'STAFF' && customer.staffId !== user.id)) throw new Error('无权操作')
  return { order, customer }
}

export async function getReturnChargeQuote(c: Context, order: any) {
  const device = await getDeviceById(c, order.deviceId)
  const charges = ((await c.env.RENT.prepare('SELECT charge_date, rental_amount, handling_fee FROM overdue_return_charges WHERE order_id = ?').bind(order.id).all()).results || []) as Array<{ charge_date: string; rental_amount: number; handling_fee: number }>
  return returnChargeQuote(order, Number((order as any).dailyRate || device?.pricePerDay || device?.dailyRate || 0), new Date(), charges)
}

export function enabledReturnPaymentMethods(): Array<[string, string]> {
  const settings = getSystemSettings().paymentMethods
  const enabled: Record<string, boolean> = { cash: true, bank_transfer: settings.bankTransfer, balance: settings.balancePayment, alipay: settings.alipay, wechat: settings.wechat, card: settings.stripe }
  return Object.entries(RETURN_PAYMENT_METHODS).filter(([method]) => enabled[method])
}

async function recordCollectionLedger(c: Context, collection: any) {
  await recordFinancialLedgerEntry(c, { entryType: 'PAYMENT', amount: Number(collection.amount) + Number(collection.processing_fee), customerId: collection.customer_id, orderId: collection.order_id, sourceType: 'RETURN_COLLECTION', sourceId: collection.id, description: '归还逾期费用收款', createdBy: collection.created_by, metadata: { method: collection.payment_method, processingFee: collection.processing_fee, paymentId: collection.payment_id } })
}

async function settleCollection(c: Context, collection: any, intentId?: string) {
  const result = await c.env.RENT.prepare("UPDATE return_collections SET status = 'paid', stripe_payment_intent_id = ?, paid_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'pending'").bind(intentId || null, collection.id).run() as any
  if (Number(result.meta?.changes || 0)) {
    if (collection.payment_method === 'balance') await recordBalanceTransaction(c, collection.customer_id, -Number(collection.amount), 'return_fee', '归还逾期费用', collection.created_by)
    await createAuditLog(c, { actor: await getUserById(c, collection.created_by), action: 'RETURN_FEE_COLLECTED', targetType: 'ORDER', targetId: collection.order_id, after: { collectionId: collection.id, amount: collection.amount, method: collection.payment_method, stripePaymentIntentId: intentId || null } })
  }
  const current = await c.env.RENT.prepare('SELECT * FROM return_collections WHERE id = ?').bind(collection.id).first() as any
  if (current?.status === 'paid') await recordCollectionLedger(c, current)
}

export async function startReturnCollection(c: Context, user: any, orderId: string, form: Record<string, unknown>): Promise<string> {
  await loadSystemSettingsFromDB(c)
  let { order, customer } = await getReturnCollectionOrder(c, user, orderId)
  const method = String(form.paymentMethod || '')
  if (!enabledReturnPaymentMethods().some(([value]) => value === method)) throw new Error('请选择可用的收款方式')
  const quote = await getReturnChargeQuote(c, order)
  if (String(form.quoteToken || '') !== returnQuoteToken(order, quote)) throw new Error('应收金额已变化，请刷新页面')
  if (quote.amountDue <= 0) throw new Error('当前没有待收费用')
  if (method !== 'card' && form.confirmReceived !== '1') throw new Error(method === 'balance' ? '请确认客户同意扣减余额' : '请确认已收到款项')
  const { chargeOverdueReturns, ensureStripeCustomerForPaymentMethod, getStripeProcessingFeeRate } = await import('../actions/stripePayments')
  if (!order.return_received_at) await chargeOverdueReturns(c, new Date(), order.id)
  order = (await getOrderById(c, orderId))!
  const fresh = await getReturnChargeQuote(c, order)
  if (returnQuoteToken(order, fresh) !== returnQuoteToken(order, quote)) throw new Error('应收金额已变化，请刷新页面')
  const pending = await c.env.RENT.prepare("SELECT * FROM return_collections WHERE order_id = ? AND status = 'pending'").bind(order.id).first() as any
  if (pending) {
    if (pending.payment_method !== method || cents(pending.amount) !== cents(fresh.amountDue)) throw new Error('请先完成或取消当前收款')
    if (method !== 'card') await settleCollection(c, pending)
    return pending.id
  }
  const id = `rc-${nanoid(16)}`, paymentId = `payment-${nanoid(16)}`
  const fee = method === 'card' ? Math.round(cents(fresh.amountDue) * getStripeProcessingFeeRate()) / 100 : 0
  const stripeCustomer = method === 'card' ? await ensureStripeCustomerForPaymentMethod(c, customer, '') : null
  await c.env.RENT.batch([
    c.env.RENT.prepare("INSERT INTO payments (id, rental_id, customer_id, payment_method, amount, rental_amount, deposit_amount, processing_fee, status, payment_provider) VALUES (?, ?, ?, ?, ?, ?, 0, ?, 'pending', ?)").bind(paymentId, order.id, customer.id, method, fresh.amountDue + fee, fresh.amountDue, fee, method === 'card' ? 'stripe' : 'internal'),
    c.env.RENT.prepare('INSERT INTO return_collections (id, order_id, customer_id, amount, processing_fee, payment_method, payment_id, stripe_customer_id, reference, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(id, order.id, customer.id, fresh.amountDue, fee, method, paymentId, stripeCustomer, `RETURN-${id}`, user.id),
  ])
  if (method !== 'card') {
    const collection = await c.env.RENT.prepare('SELECT * FROM return_collections WHERE id = ?').bind(id).first()
    await settleCollection(c, collection)
  }
  return id
}

export async function getReturnCollection(c: Context, user: any, collectionId: string) {
  const collection = await c.env.RENT.prepare('SELECT * FROM return_collections WHERE id = ?').bind(collectionId).first() as any
  if (!collection) throw new Error('收款记录不存在')
  const context = await getReturnCollectionOrder(c, user, collection.order_id)
  return { collection, ...context }
}

async function applyStripeReceipt(c: Context, collection: any, receipt: any) {
  if (!receipt || collection.payment_method !== 'card' || receipt.currency !== 'aud' || Number(receipt.amount_cents) !== cents(Number(collection.amount) + Number(collection.processing_fee))
    || receipt.customer_id !== collection.stripe_customer_id || String(receipt.description).trim() !== collection.reference) throw new Error('Stripe 付款与客户、订单或金额不匹配')
  if (collection.status === 'cancelled') throw new Error('该收款单已取消，请联系管理员核对 Stripe 付款')
  await settleCollection(c, collection, receipt.intent_id)
}

// Only called after the shared webhook signature check. No card details or client secrets are stored.
export async function handleStripeReturnReceipt(c: Context, event: any) {
  const intent = event.data?.object
  if (event.type !== 'payment_intent.succeeded' || intent?.status !== 'succeeded' || intent.currency !== 'aud') throw new Error('Stripe 付款状态或币种无效')
  const amount = Number(intent.amount_received)
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount !== Number(intent.amount)) throw new Error('Stripe 实收金额无效')
  const receipt = { intent_id: intent.id, charge_id: typeof intent.latest_charge === 'string' ? intent.latest_charge : intent.latest_charge?.id || null, customer_id: typeof intent.customer === 'string' ? intent.customer : intent.customer?.id || null, amount_cents: amount, currency: intent.currency, description: String(intent.description || '').trim(), created_at: Number(intent.created || 0) }
  await c.env.RENT.prepare('INSERT OR IGNORE INTO stripe_pos_receipts (intent_id, charge_id, event_id, customer_id, amount_cents, currency, description, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(receipt.intent_id, receipt.charge_id, event.id, receipt.customer_id, receipt.amount_cents, receipt.currency, receipt.description, receipt.created_at).run()
  const collection = await c.env.RENT.prepare('SELECT * FROM return_collections WHERE reference = ?').bind(receipt.description).first() as any
  if (collection) await applyStripeReceipt(c, collection, receipt)
}

export async function verifyReturnStripeReceipt(c: Context, user: any, collectionId: string, value: unknown) {
  const { collection } = await getReturnCollection(c, user, collectionId)
  if (collection.status === 'paid') return
  const receiptId = String(value || '').trim()
  if (!/^(?:pi|ch)_[A-Za-z0-9]+$/.test(receiptId)) throw new Error('请输入有效的 Stripe 交易号')
  const receipt = await c.env.RENT.prepare('SELECT * FROM stripe_pos_receipts WHERE intent_id = ? OR charge_id = ?').bind(receiptId, receiptId).first()
  if (!receipt) throw new Error('尚未收到 Stripe 到账通知，请稍后重试')
  await applyStripeReceipt(c, collection, receipt)
}

export async function cancelReturnCollection(c: Context, user: any, collectionId: string, confirmed: boolean) {
  const { collection } = await getReturnCollection(c, user, collectionId)
  if (!confirmed) throw new Error('请确认尚未收款')
  if (collection.status !== 'pending') throw new Error('收款记录已处理')
  if (collection.payment_method === 'card') {
    const receipt = await c.env.RENT.prepare('SELECT * FROM stripe_pos_receipts WHERE description = ?').bind(collection.reference).first()
    if (receipt) { await applyStripeReceipt(c, collection, receipt); throw new Error('Stripe 已到账，不能取消收款') }
  }
  await c.env.RENT.batch([
    c.env.RENT.prepare("UPDATE return_collections SET status = 'cancelled' WHERE id = ? AND status = 'pending'").bind(collectionId),
    c.env.RENT.prepare("UPDATE payments SET status = 'failed' WHERE id = ? AND status = 'pending' AND EXISTS (SELECT 1 FROM return_collections WHERE id = ? AND status = 'cancelled')").bind(collection.payment_id, collectionId),
  ])
}
