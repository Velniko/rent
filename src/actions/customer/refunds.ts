/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

import type { Context } from 'hono'
import { nanoid } from 'nanoid'
import { getOrderById, createAuditLog, createNotification, sanitizePlainText } from '../../site'
import { customerRefundQuoteToken, getCustomerRefundQuote, getCustomerRefundRequest } from '../../services/customerRefunds'

export async function submitCustomerRefund(c: Context, user: any, orderId: string, form: Record<string, unknown>): Promise<void> {
  const order = await getOrderById(c, orderId)
  if (!order || order.userId !== user.id) throw new Error('订单不存在或无权访问')
  if (form.confirmRefund !== '1') throw new Error('请确认退款手续费后再提交')
  const existing = await getCustomerRefundRequest(c, orderId)
  if (existing && existing.status !== 'rejected') throw new Error('退款申请已提交，请勿重复申请')
  const quote = await getCustomerRefundQuote(c, order)
  if (String(form.quoteToken || '') !== await customerRefundQuoteToken(quote)) throw new Error('退款金额已变化，请重新确认')
  const reason = sanitizePlainText(form.reason, 300).trim()
  if (!reason) throw new Error('请填写退款原因')
  const needsBank = quote.payments.some(p => p.channel === 'bank_transfer')
  const bsb = String(form.refundBsb || '').replace(/\D/g, ''), account = String(form.refundAccountNumber || '').replace(/\s/g, ''), name = sanitizePlainText(form.refundAccountName, 120).trim()
  if (needsBank && (!/^\d{6}$/.test(bsb) || !/^\d{4,10}$/.test(account) || !name)) throw new Error('请填写正确的银行退款账户')
  const id = `crr-${nanoid(16)}`
  await c.env.RENT.prepare(`INSERT INTO customer_refund_requests (id, order_id, customer_id, order_total, service_fee, paid_amount, fee_amount, refund_amount, quote_json, reason, refund_bsb, refund_account_number, refund_account_name)
    SELECT ?, id, userId, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? FROM orders WHERE id = ? AND userId = ? AND handover_completed_at IS NULL AND deleted_at IS NULL AND status = ? AND totalAmount = ? AND serviceFee = ?`)
    .bind(id, quote.total, quote.serviceFee, quote.paid, quote.fee, quote.refund, JSON.stringify(quote), reason, needsBank ? bsb : null, needsBank ? account : null, needsBank ? name : null, order.id, user.id, order.status, quote.total, quote.serviceFee).run().then((result: any) => { if (!result.meta?.changes) throw new Error('退款金额已变化，请重新确认') })
  await createAuditLog(c, { actor: user, action: 'CUSTOMER_REFUND_REQUESTED', targetType: 'ORDER', targetId: order.id, after: { requestId: id, ...quote }, reason })
  const admins = ((await c.env.RENT.prepare("SELECT id FROM users WHERE role = 'ADMIN' AND status = 'active'").all()).results || []) as any[]
  for (const admin of admins) await createNotification(c, { recipientId: admin.id, senderId: user.id, type: 'customer_refund_requested', title: '客户退款申请待审核', message: `订单 ${order.orderNo || order.id}，申请退款 ${quote.refund.toFixed(2)} AUD，手续费 ${quote.fee.toFixed(2)} AUD。`, orderId: order.id, dedupeKey: `customer-refund-request:${id}:${admin.id}` })
}
