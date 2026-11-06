/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

import type { Context } from 'hono'
import { nanoid } from 'nanoid'
import { getOrderById, getUserById, getDeviceById, hasDeviceBookingConflict, getDeviceRentalRules, recordDeviceLifecycle, releaseDeviceIfUnbooked, createAuditLog } from '../../site'
import { insertManualOrder, updateManualOrder } from '../../db/repositories'
import { canEditManualOrder, parseManualOrder } from '../../domain/manualOrders'
import { hasReturnScan } from '../../services/orderScanning'
import { renderAdminManualOrder } from '../../pages/admin/manualOrder'

export async function saveAdminManualOrder(c: Context, orderId?: string) {
  const admin = c.get('user')
  if (!admin || admin.role !== 'ADMIN') return c.text('仅管理员可操作手动订单', 403)
  const order = orderId ? await getOrderById(c, orderId) : null
  if (orderId && !order) return c.notFound()
  if (order && !canEditManualOrder(order)) return c.text('该订单不能修改，已完成或已取消的手动订单不可编辑', 409)
  const form = await c.req.parseBody()
  const fail = async (message: string, status: 400 | 409 = 400) => c.html(await renderAdminManualOrder(c, admin, order, message, form), status)
  const parsed = parseManualOrder(order ? form : { ...form, status: 'active' }, order?.status)
  if (parsed.error) return fail(parsed.error)
  const data = parsed.data!
  if(order&&data.status!==order.status&&['completed','pending_return'].includes(data.status)&&(!order.return_received_at||data.deviceId!==order.deviceId||data.userId!==(order.userId||null)||!await hasReturnScan(c,order)))return fail('请先扫码并确认归还',409)
  const device = await getDeviceById(c, data.deviceId)
  if (!device) return fail('所选设备不存在')
  if (data.userId) {
    const customer = await getUserById(c, data.userId)
    if (!customer || customer.role !== 'CUSTOMER' || customer.status === 'inactive' || customer.deletedAt) return fail('请选择有效的客户账户')
  }
  const closing = ['completed', 'cancelled'].includes(data.status)
  if (!closing) {
    if (data.deviceId !== order?.deviceId && ['maintenance', 'retired'].includes(device.status)) return fail('所选设备当前不可租用', 409)
    const rules = await getDeviceRentalRules(c, data.deviceId)
    const conflict = data.startDate && data.endDate
      ? await hasDeviceBookingConflict(c, data.deviceId, data.startDate, data.endDate, order?.id, rules.bufferDays, data.startPeriod || undefined, data.endPeriod || undefined)
      : Boolean(await c.env.RENT.prepare("SELECT id FROM orders WHERE deviceId = ? AND id != ? AND status NOT IN ('completed', 'cancelled') LIMIT 1").bind(data.deviceId, order?.id || '').first())
    const undated = await c.env.RENT.prepare("SELECT id FROM orders WHERE deviceId = ? AND id != ? AND is_manual = 1 AND status NOT IN ('completed', 'cancelled') AND (startDate IS NULL OR endDate IS NULL) LIMIT 1").bind(data.deviceId, order?.id || '').first()
    if (conflict || undated) return fail('所选设备存在未结束的订单或租期冲突', 409)
    if (data.startDate && data.endDate) {
      const sameDayBookings = ((await c.env.RENT.prepare("SELECT startDate, endDate, startPeriod, endPeriod FROM orders WHERE deviceId = ? AND id != ? AND status NOT IN ('completed', 'cancelled') AND (startDate = ? OR endDate = ? OR startDate = ? OR endDate = ?)")
        .bind(data.deviceId, order?.id || '', data.startDate, data.startDate, data.endDate, data.endDate).all()).results || []) as any[]
      if (sameDayBookings.some(item => (item.startDate === data.startDate && item.startPeriod === data.startPeriod) || (item.endDate === data.startDate && item.endPeriod === data.startPeriod))) return fail('该设备的取货时段已被出租', 409)
      if (sameDayBookings.some(item => (item.startDate === data.endDate && item.startPeriod === data.endPeriod) || (item.endDate === data.endDate && item.endPeriod === data.endPeriod))) return fail('该设备的归还时段已被出租', 409)
    }
  }
  const id = order?.id || `o-${nanoid(12)}`
  if (order) {
    if (!await updateManualOrder(c, id, data, order.status)) return c.text('订单状态已变化，请刷新页面', 409)
  } else {
    await insertManualOrder(c, id, data, admin.id)
  }
  if (closing) await releaseDeviceIfUnbooked(c, data.deviceId)
  else await recordDeviceLifecycle(c, data.deviceId, data.status === 'pending_return' ? 'INSPECTION' : 'RENTED', { orderId: id, reason: '管理员维护手动订单', changedBy: admin.id })
  if (order && order.deviceId !== data.deviceId) await releaseDeviceIfUnbooked(c, order.deviceId)
  await createAuditLog(c, { actor: admin, action: order ? 'MANUAL_ORDER_UPDATED' : 'MANUAL_ORDER_CREATED', targetType: 'ORDER', targetId: id, before: order || undefined, after: data })
  return c.redirect(`/admin/orders/${encodeURIComponent(id)}`, 303)
}
