/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

import type { Context } from 'hono'
import { getOrderById, createAuditLog, createNotification, generateReferenceNumber, updateOrderStatus, releaseDeviceIfUnbooked, revokeReferralRewardForOrder } from '../../site'
import { getCustomerRefundQuote, prepareCustomerRefundPayments, executeCustomerRefund, finishCustomerRefundPayment, type CustomerRefundQuote } from '../../services/customerRefunds'
import { hasOpenPaymentDispute } from '../stripePayments'

export async function approveCustomerRefund(c: Context, admin: any, requestId: string): Promise<void> {
  const request = await c.env.RENT.prepare('SELECT * FROM customer_refund_requests WHERE id = ?').bind(requestId).first() as any
  if (!request || !['pending', 'processing'].includes(request.status)) throw new Error('退款申请不存在或已处理')
  const order = await getOrderById(c, request.order_id)
  if (!order) throw new Error('订单不存在')
  const quote = JSON.parse(request.quote_json) as CustomerRefundQuote
  if (request.status === 'pending') {
    const current = await getCustomerRefundQuote(c, order)
    if (JSON.stringify(quote) !== JSON.stringify(current)) throw new Error('订单或付款已变化，请驳回后重新申请')
    for (const payment of quote.payments) if (await hasOpenPaymentDispute(c, payment.id)) throw new Error('该笔付款存在未解决的拒付争议，暂不能退款')
    await prepareCustomerRefundPayments(c, order, quote)
    const results = await c.env.RENT.batch([
      c.env.RENT.prepare("UPDATE customer_refund_requests SET status = 'processing', reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'pending' AND EXISTS (SELECT 1 FROM orders WHERE id = customer_refund_requests.order_id AND status = ? AND handover_completed_at IS NULL AND deleted_at IS NULL AND totalAmount = ? AND serviceFee = ?)").bind(admin.id, request.id, order.status, quote.total, quote.serviceFee),
      c.env.RENT.prepare("UPDATE orders SET status = 'cancelled', order_status = 'CANCELLED', rental_status = 'CANCELLED', payment_status = 'REFUND_PENDING', refund_ignored_at = NULL, refund_ignored_by = NULL, refund_ignore_reason = NULL, updatedAt = CURRENT_TIMESTAMP WHERE id = ? AND EXISTS (SELECT 1 FROM customer_refund_requests WHERE id = ? AND status = 'processing' AND reviewed_by = ?)").bind(order.id, request.id, admin.id),
      ...quote.payments.map((payment, index) => c.env.RENT.prepare(`INSERT OR IGNORE INTO payment_refunds (id, refund_number, order_id, payment_id, type, refundable_amount, refund_amount, deduction_amount, deduction_reason, refunded_processing_fee, status, processed_by, refund_method, refund_bsb, refund_account_number, refund_account_name, customer_request_id)
        SELECT ?, ?, order_id, ?, 'cancellation', ?, ?, ?, ?, ?, 'pending', ?, ?, refund_bsb, refund_account_number, refund_account_name, id FROM customer_refund_requests WHERE id = ? AND status = 'processing' AND reviewed_by = ?`)
        .bind(`${request.id}-${index}`, generateReferenceNumber('RFD'), payment.id, payment.authorization ? payment.fee : payment.amount, payment.refundAmount, payment.fee, quote.fee > 0 ? '退款手续费（订单总额的 5%）' : '取消订单全额退款', Math.min(payment.refundAmount, payment.processingFee), admin.id, payment.channel, request.id, admin.id)),
    ])
    if (!results[0].meta?.changes) throw new Error('退款申请不存在或已处理')
    await createAuditLog(c, { actor: admin, action: 'CUSTOMER_REFUND_APPROVED', targetType: 'ORDER', targetId: order.id, after: { requestId: request.id, ...quote } })
  }
  // Resume cleanup and payouts after an interrupted approval.
  await updateOrderStatus(c, order.id, 'cancelled', { reason: '客户退款申请审核通过', triggeredBy: admin.id })
  await releaseDeviceIfUnbooked(c, order.deviceId, { orderId: order.id, reason: '客户退款申请审核通过', changedBy: admin.id })
  await revokeReferralRewardForOrder(c, order.id, '客户退款申请审核通过')
  await c.env.RENT.prepare("UPDATE orders SET payment_status = 'REFUND_PENDING' WHERE id = ?").bind(order.id).run()
  await executeCustomerRefund(c, admin, request.id)
  await c.env.RENT.prepare("UPDATE orders SET payment_status = CASE WHEN EXISTS (SELECT 1 FROM payment_refunds WHERE customer_request_id = ? AND status = 'pending') THEN 'REFUND_PENDING' ELSE 'REFUNDED' END WHERE id = ?").bind(request.id, order.id).run()
  await createNotification(c, { recipientId: request.customer_id, senderId: admin.id, type: 'customer_refund_approved', title: '退款申请已通过', message: `退款 ${quote.refund.toFixed(2)} AUD${quote.fee > 0 ? `，已扣除手续费 ${quote.fee.toFixed(2)} AUD` : ''}。`, orderId: order.id, dedupeKey: `customer-refund-approved:${request.id}` })
}

export async function rejectCustomerRefund(c: Context, admin: any, requestId: string, note: string): Promise<void> {
  if (!note.trim()) throw new Error('请填写驳回原因')
  const request = await c.env.RENT.prepare("SELECT * FROM customer_refund_requests WHERE id = ? AND status = 'pending'").bind(requestId).first() as any
  if (!request) throw new Error('退款申请不存在或已处理')
  const result = await c.env.RENT.prepare("UPDATE customer_refund_requests SET status = 'rejected', reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP, review_note = ? WHERE id = ? AND status = 'pending'").bind(admin.id, note.trim().slice(0, 300), request.id).run()
  if (!result.meta?.changes) throw new Error('退款申请不存在或已处理')
  await createAuditLog(c, { actor: admin, action: 'CUSTOMER_REFUND_REJECTED', targetType: 'ORDER', targetId: request.order_id, reason: note })
  await createNotification(c, { recipientId: request.customer_id, senderId: admin.id, type: 'customer_refund_rejected', title: '退款申请已驳回', message: note.trim().slice(0, 300), orderId: request.order_id, dedupeKey: `customer-refund-rejected:${request.id}` })
}

export async function completeCustomerManualRefund(c: Context, admin: any, refundId: string): Promise<void> {
  const refund = await c.env.RENT.prepare("SELECT * FROM payment_refunds WHERE id = ? AND customer_request_id IS NOT NULL AND refund_method IN ('bank_transfer', 'alipay', 'wechat') AND status = 'pending'").bind(refundId).first() as any
  if (!refund) throw new Error('退款记录不存在或已经处理')
  if (await hasOpenPaymentDispute(c, refund.payment_id)) throw new Error('该笔付款存在未解决的拒付争议，暂不能放款')
  await finishCustomerRefundPayment(c, admin, refund)
  await createAuditLog(c, { actor: admin, action: 'CUSTOMER_REFUND_COMPLETED', targetType: 'ORDER', targetId: refund.order_id, after: { refundId, amount: refund.refund_amount } })
}
