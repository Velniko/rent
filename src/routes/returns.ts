/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

import type { WorkspaceApp } from './types'
import { renderForbidden } from '../pages/public/notFound'
import { nanoid } from 'nanoid'
import { renderReturnQueue } from '../pages/staff/returnQueue'
import { renderStaffInspection } from '../pages/staff/inspection'
import { registerOrderReturn, renderReturnRegistration } from '../services/returnOperations'
import { RosterError, canStaffReadRosterOrder } from '../services/roster'
import { readInspectionPhotos } from '../lib/inspectionPhotos'
import { resolveImageUrls } from '../services/objectStorage'
import { buildLayout, formatMelbourneDate, canTransitionOrder, getOrderById, getUserById, getDeviceById, recordDeviceLifecycle, releaseDeviceIfUnbooked, staffOrderPath } from '../site'
import { chargeOverdueReturns, refundUnusedRentalDays, settleCompletedOrderAuthorization } from '../actions/stripePayments'
import { computeOrderSettlementStatus } from '../domain/orderSettlement'
import { createAuditLog } from '../services/audit'

export function registerReturnRoutes(app: WorkspaceApp) {
app.get('/admin/returns',async c=>{const user=c.get('user');if(user?.role!=='ADMIN')return c.html(renderForbidden(),403);return c.html(await renderReturnQueue(c,user))})
app.get('/staff/returns',async c=>{const user=c.get('user');if(!user||!['STAFF','ADMIN'].includes(user.role))return c.html(renderForbidden(),403);return c.html(await renderReturnQueue(c,user))})
app.get('/staff/orders/:orderId/receive-return',async c=>{const user=c.get('user');if(!user||!['STAFF','ADMIN'].includes(user.role))return c.html(renderForbidden(),403);const order=await getOrderById(c,c.req.param('orderId'));if(!order)return c.text('订单不存在',404);return c.html(c.req.query('fragment')==='1'?renderReturnRegistration(order):buildLayout('登记归还',renderReturnRegistration(order),user))})
app.post('/staff/orders/:orderId/receive-return',async c=>{const user=c.get('user');if(!user||!['STAFF','ADMIN'].includes(user.role))return c.html(renderForbidden(),403);try{await registerOrderReturn(c,user,c.req.param('orderId'));return c.redirect(user.role==='ADMIN'?'/admin/orders/'+c.req.param('orderId'):'/staff/orders/'+c.req.param('orderId'),303)}catch(error){if(error instanceof RosterError)return c.text(error.message,error.status);throw error}})


app.get('/staff/orders/:orderId/inspection', async (c) => {
  const user = c.get('user')
  if (!user || !['STAFF', 'ADMIN'].includes(user.role)) return c.html(renderForbidden(), 403)
  const order = await getOrderById(c, c.req.param('orderId'))
  const customer = order ? await getUserById(c, order.userId) : null
  if (order && user.role === 'STAFF' && customer?.staffId !== user.id && !await canStaffReadRosterOrder(c,user,order.id)) return c.html(renderForbidden(), 403)
  if(order&&order.status!=='completed'&&c.req.query('fragment')!=='1')return c.redirect(user.role==='ADMIN'?'/admin/orders/'+encodeURIComponent(order.id):staffOrderPath(order))
  return c.html(await renderStaffInspection(c, user, c.req.param('orderId')))
})

app.post('/staff/orders/:orderId/inspection', async (c) => {
  const user = c.get('user')
  if (!user || !['STAFF', 'ADMIN'].includes(user.role)) return c.html(renderForbidden(), 403)
  let order = await getOrderById(c, c.req.param('orderId'))
  if (!order || !['active', 'extended', 'overdue', 'suspended', 'pending_return'].includes(String(order.status))) return c.text('当前订单不能验机', 409)
  const returnCustomer = await getUserById(c, order.userId)
  if (user.role === 'STAFF' && returnCustomer?.staffId !== user.id && !await canStaffReadRosterOrder(c,user,order.id)) return c.html(renderForbidden(), 403)
  if (!order.return_received_at) return c.text('请先登记归还',409)
  if(!canTransitionOrder(order.status,'completed'))return c.text('当前订单不能验机',409)
  const form = await c.req.parseBody({all:true})
  const damageFound = String(form.damageFound || '') === 'yes'
  let inspectionPhotos: Record<string,string> = {}
  if (damageFound) { try { inspectionPhotos=await readInspectionPhotos(c,user,form) } catch(error){ return c.text(error instanceof Error?error.message:'操作失败，请重试',400) } }
  const allowedCheck = new Set(['正常', '异常', '未测试'])
  const checks: Record<string, string> = {}
  for (const [input, field] of [['screenCondition', 'screen_condition'], ['keyboardCondition', 'keyboard_condition'], ['trackpadCondition', 'trackpad_condition'], ['bodyCondition', 'body_condition'], ['cameraCondition', 'camera_condition'], ['wifiCondition', 'wifi_condition'], ['powerTest', 'power_test']]) {
    const value = String(form[input] || '')
    if (damageFound) {
      if (!allowedCheck.has(value)) return c.text(`${input} 检查结果无效`, 400)
      checks[field] = value
    } else checks[field] = allowedCheck.has(value) ? value : '未测试'
  }
  const replacementCost = damageFound ? Number(form.replacementCost || 0) : 0
  const batteryCycles = form.batteryCycles ? Number(form.batteryCycles) : null
  if (!Number.isFinite(replacementCost) || replacementCost < 0 || (batteryCycles !== null && (!Number.isInteger(batteryCycles) || batteryCycles < 0))) return c.text('费用或电池循环次数无效', 400)
  const damageDescription = damageFound ? String(form.damageDescription || '').trim().slice(0, 2000) : ''
  if (damageFound && !damageDescription) return c.text('请填写损坏说明', 400)
  const now = new Date().toISOString()
  const receivedDate = formatMelbourneDate(order.return_received_at)
  const contract = await c.env.RENT.prepare('SELECT id FROM contracts WHERE orderId = ? AND deleted_at IS NULL ORDER BY createdAt DESC LIMIT 1').bind(order.id).first() as any
  if (!contract && order.is_manual !== 1) return c.text('订单缺少合同', 409)
  const beforeInspection = await c.env.RENT.prepare("SELECT snapshot_json FROM device_inspections WHERE deleted_at IS NULL AND device_id = ? AND inspection_type = 'before_rental' ORDER BY created_at DESC LIMIT 1").bind(order.deviceId).first() as any
  let inspectionSnapshot: Record<string, any> = {}
  try { inspectionSnapshot = JSON.parse(beforeInspection?.snapshot_json || '{}') } catch (_) { }
  let damagePhotos = ''
  if (damageFound) {
    try { damagePhotos = (await resolveImageUrls(form.damagePhotoFiles, form.damagePhotos, c, 'rent/damage-photos', 5)).join('\n') } catch (error: any) { return c.text(error.message, 400) }
    if (!damagePhotos) return c.text('记录损坏时必须提供至少一张损坏照片链接', 400)
  }
  await chargeOverdueReturns(c, new Date(), order.id)
  order = (await getOrderById(c, order.id))!
  if (order.deposit_payment_mode === 'PREAUTH') {
    if (!/^\d+(\.\d{1,2})?$/.test(String(form.replacementCost || '0')) || (replacementCost > 0 && !damageDescription)) return c.text('请填写有效的损坏扣款金额和损坏说明', 400)
    if (replacementCost + Number(order.overdue_deposit_applied || 0) > Number(order.depositAmount || 0)) return c.text('扣款金额不能高于押金金额', 400)
  }
  try {
    await refundUnusedRentalDays(c, user, order, receivedDate)
  } catch (error: any) {
    return c.text(error.message || '未使用租金退款失败，订单暂未完成', 502)
  }
  Object.assign(inspectionSnapshot, checks, { batteryCycles, batteryHealth: String(form.batteryHealth || '').trim().slice(0, 100), damageDescription, damagePhotos, replacementCost: replacementCost.toFixed(2), returnDate: receivedDate, inspectionBy: user.name || user.id, inspectionPhotos })
  const inspectionId = `inspection-${nanoid(12)}`
  const returnDevice = await getDeviceById(c, order.deviceId)
  // 订单进 completed 的这一刻押金往往还没结清（HELD/PENDING）——settlement_status
  // 要单独反映这个事实，不能让“已完成”看起来什么都办完了。
  const settlementStatusOnCompletion = computeOrderSettlementStatus({ status: 'completed', deposit_status: order.deposit_status, overdue_outstanding_amount: order.overdue_outstanding_amount })
  await c.env.RENT.batch([
    c.env.RENT.prepare("UPDATE orders SET status = 'completed', order_status = 'COMPLETED', payment_status = COALESCE(payment_status, 'PAID'), rental_status = 'COMPLETED', return_received_at = COALESCE(return_received_at, CURRENT_TIMESTAMP), return_received_by = COALESCE(return_received_by, ?), settlement_status = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?").bind(user.id, settlementStatusOnCompletion, order.id),
    c.env.RENT.prepare("INSERT INTO rental_status_history (id, rental_id, old_status, new_status, trigger_type, triggered_by, reason) VALUES (?, ?, ?, 'RETURNED', 'MANUAL', ?, ?), (?, ?, 'RETURNED', 'COMPLETED', 'SYSTEM', ?, ?)").bind(`rsh-${nanoid(16)}`, order.id, order.rental_status || 'RETURN_PENDING', user.id, '工作人员收到设备并开始归还验机', `rsh-${nanoid(16)}`, order.id, user.id, '归还验机完成'),
    c.env.RENT.prepare('INSERT INTO device_inspections (id, device_id, rental_id, inspection_type, snapshot_json, differences_json) VALUES (?, ?, ?, \'after_return\', ?, ?)').bind(inspectionId, order.deviceId, order.id, JSON.stringify(inspectionSnapshot), JSON.stringify({})),
    c.env.RENT.prepare("INSERT OR IGNORE INTO order_fulfillment_records (id, order_id, record_type, device_serial_number, accessories_json, condition_snapshot_json, notes, recorded_by) VALUES (?, ?, 'RETURN', ?, '[]', ?, ?, ?)").bind(`return-${nanoid(12)}`, order.id, String(returnDevice?.serialNumber || ''), JSON.stringify(inspectionSnapshot), damageDescription || null, user.id),
    ...(damageDescription ? [c.env.RENT.prepare("INSERT INTO damage_cases (id, order_id, device_id, description, photo_urls, estimated_cost_cents, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(`damage-${nanoid(12)}`, order.id, order.deviceId, damageDescription, damagePhotos, Math.round(replacementCost * 100), user.id)] : []),
  ])
  await c.env.RENT.prepare("UPDATE order_fulfillment_records SET condition_snapshot_json=? WHERE order_id=? AND record_type='RETURN'").bind(JSON.stringify(inspectionSnapshot),order.id).run()
  if (contract) await c.env.RENT.prepare("UPDATE contracts SET contract_data=json_set(COALESCE(contract_data,'{}'),'$.inspection_date',?,'$.inspection_by',?) WHERE id=?").bind(receivedDate,user.name||user.id,contract.id).run()
  if (damageDescription) await recordDeviceLifecycle(c, order.deviceId, 'DAMAGED', { orderId: order.id, reason: damageDescription, changedBy: user.id })
  else await releaseDeviceIfUnbooked(c, order.deviceId, { orderId: order.id, reason: '归还验机完成', changedBy: user.id })
  await createAuditLog(c, { actor: user, action: damageDescription ? 'RETURN_INSPECTION_COMPLETED_WITH_DAMAGE' : 'RETURN_INSPECTION_COMPLETED', targetType: 'ORDER', targetId: order.id, before: { status: order.status, rentalStatus: order.rental_status }, after: { status: 'completed', rentalStatus: 'COMPLETED', inspectionId, damageReported: Boolean(damageDescription) }, reason: damageDescription || '归还验机完成' })
  const settlementResponse = await settleCompletedOrderAuthorization(c, user, order.id)
  if (settlementResponse && settlementResponse.status >= 400) return settlementResponse
  return c.redirect(user.role === 'ADMIN' ? `/admin/orders/${order.id}` : staffOrderPath(order))
})

}
