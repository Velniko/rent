/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

import { canStaffReadRosterOrder } from '../../services/roster'
import type { Context } from 'hono'
import { getOrderById, getUserById, getContractByOrderId, createNotification, createAuditLog, staffOrderPath, loadSystemSettingsFromDB } from '../../site'
import { canPreparePickup } from '../../domain/pickupPreparation'
import { sendPickupReminderEmail } from '../../services/notifications'

export async function prepareOrderPickup(c: Context, user: any, orderId: string): Promise<Response> {
  if (!user || !['STAFF', 'ADMIN'].includes(user.role)) return c.text('无权操作', 403)
  const order = await getOrderById(c, orderId)
  if (!order) return c.text('订单不存在', 404)
  const customer = await getUserById(c, order.userId)
  if (user.role === 'STAFF' && customer?.staffId !== user.id && !await canStaffReadRosterOrder(c,user,order.id)) return c.text('无权操作', 403)
  const contract = await getContractByOrderId(c, order.id)
  if (!canPreparePickup(order, contract)) return c.text('当前订单不能准备取货', 409)
  await loadSystemSettingsFromDB(c)
  const email = String(customer?.email || '').trim()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.endsWith('@invalid.local')) return c.text('客户邮箱不可用，请先更新邮箱', 400)
  if (await c.env.RENT.prepare("SELECT id FROM customer_refund_requests WHERE order_id = ? AND status IN ('pending', 'processing', 'approved')").bind(order.id).first()) return c.text('退款申请待处理，不能准备取货', 409)
  const device = await c.env.RENT.prepare('SELECT lifecycle_status, deleted_at FROM devices WHERE id = ?').bind(order.deviceId).first() as any
  if (!device || device.deleted_at || !['READY', 'RESERVED'].includes(device.lifecycle_status)) return c.text('设备当前不可取货', 409)
  if (await c.env.RENT.prepare("SELECT id FROM maintenance_records WHERE device_id = ? AND status IN ('OPEN', 'IN_PROGRESS', 'DATA_CLEAN', 'SYSTEM_RESET', 'CLIENT_CHECK') LIMIT 1").bind(order.deviceId).first()) return c.text('请先完成设备维护', 409)
  if (await c.env.RENT.prepare("SELECT id FROM orders WHERE deviceId = ? AND id <> ? AND deleted_at IS NULL AND status IN ('active', 'extended', 'overdue', 'suspended', 'pending_return', 'returned') LIMIT 1").bind(order.deviceId, order.id).first()) return c.text('设备当前不可取货', 409)
  const path = user.role === 'ADMIN' ? `/admin/orders/${encodeURIComponent(order.id)}` : staffOrderPath(order)
  if (order.pickup_ready_email_sent_at) return c.redirect(`${path}?pickupReady=sent`, 303)
  // Claim delivery atomically; overlapping button clicks must not send multiple emails.
  // A crashed request can be retried after five minutes.
  const attempt = new Date().toISOString()
  const result = await c.env.RENT.prepare(`UPDATE orders SET pickup_ready_at = COALESCE(pickup_ready_at, CURRENT_TIMESTAMP), pickup_ready_by = COALESCE(pickup_ready_by, ?), pickup_ready_email_attempt_at = ?, pickup_notice_base_url = ?
    WHERE id = ? AND deviceId = ? AND userId = ? AND status = ? AND startDate = ? AND pickupTimeSlot IS ? AND deleted_at IS NULL AND handover_completed_at IS NULL
      AND pickup_ready_email_sent_at IS NULL
      AND (pickup_ready_email_attempt_at IS NULL OR julianday(pickup_ready_email_attempt_at) <= julianday('now', '-5 minutes'))
      AND NOT EXISTS (SELECT 1 FROM customer_refund_requests WHERE order_id = orders.id AND status IN ('pending', 'processing', 'approved'))`)
    .bind(user.id, attempt, new URL(c.req.url).origin, order.id, order.deviceId, order.userId, order.status, order.startDate, order.pickupTimeSlot || null).run() as any
  if (!Number(result.meta?.changes ?? result.changes ?? 0)) return c.redirect(`${path}?pickupReady=busy`, 303)
  let sent = false
  try {
    const prepared = await getOrderById(c, order.id)
    await createNotification(c, { recipientId: order.userId, senderId: user.id, type: 'pickup_reminder', title: '设备准备完成', titleEn: 'Device ready for pickup', messageEn: `Your order ${order.orderNo || order.id} is ready. Please collect it at the scheduled time and show the pickup QR code in your email.`, message: `您的订单 ${order.orderNo || order.id} 已准备完成，请按预约时间取货，并出示邮件中的取货二维码。`, orderId: order.id, dedupeKey: `pickup-ready:${order.id}:${prepared?.pickup_ready_at || attempt}`, notifyByEmail: false })
    const delivery = await sendPickupReminderEmail(c, { recipientId: order.userId, orderId: order.id, attempt }, customer, email)
    sent = delivery.ok
  } catch (error) {
    console.error('Pickup preparation email failed:', error)
  } finally {
    await c.env.RENT.prepare('UPDATE orders SET pickup_ready_email_sent_at = CASE WHEN ? THEN CURRENT_TIMESTAMP ELSE NULL END, pickup_ready_email_attempt_at = NULL WHERE id = ? AND pickup_ready_email_attempt_at = ?')
      .bind(sent ? 1 : 0, order.id, attempt).run()
  }
  if (!order.pickup_ready_at) await createAuditLog(c, { actor: user, action: 'PICKUP_PREPARED', targetType: 'ORDER', targetId: order.id, after: { deviceId: order.deviceId, emailSent: sent } })
  return c.redirect(`${path}?pickupReady=${sent ? 'sent' : 'failed'}`, 303)
}
