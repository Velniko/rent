/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

import type { Context } from 'hono'
import { canStaffReadRosterOrder } from '../../services/roster'
import { renderInspectionPhotos } from '../../lib/inspectionPhotos'
import { renderManualInspectionFields, inspectionText, isPreInspectionComplete } from '../../lib/inspection'
import { buildLayout, getOrderById, getUserById, getDeviceById, sanitizePlainText, staffOrderPath } from '../../site'

export async function renderStaffPreInspection(c: Context, user: any, orderId: string) {
  const order = await getOrderById(c, orderId)
  if (!order || ['completed', 'cancelled'].includes(String(order.status)) || order.handover_completed_at) return buildLayout('无法验机', '<div class="panel"><h2>当前订单不能填写出租前验机</h2></div>', user)
  const customer = await getUserById(c, order.userId)
  if (user.role !== 'ADMIN' && customer?.staffId !== user.id && !await canStaffReadRosterOrder(c, user, order.id)) return buildLayout('无权操作', '<div class="panel"><h2>无权操作</h2></div>', user)
  const device = await getDeviceById(c, order.deviceId)
  const existing = await c.env.RENT.prepare("SELECT id, snapshot_json FROM device_inspections WHERE deleted_at IS NULL AND rental_id = ? AND inspection_type = 'before_rental' ORDER BY created_at DESC LIMIT 1").bind(order.id).first() as any
  let snapshot: Record<string, any> = {}
  try { snapshot = JSON.parse(existing?.snapshot_json || '{}') } catch (_) { }
  const completedNote = isPreInspectionComplete(snapshot)
    ? `<p class="form-text">已由 ${sanitizePlainText(String(snapshot.inspectionBy || ''), 80)} 于 ${sanitizePlainText(String(snapshot.inspectionDate || ''), 20)} 确认，可在取货前随时修改。<a href="/inspection/view/${existing.id}">查看报告</a></p>`
    : '<p class="form-text">设备在线时会自动预填检测结果，请在取货前人工核对后保存。</p>'
  const render = (title: string, body: string) => c.req?.query?.('fragment') === '1' ? body : buildLayout(title, body, user, { compactStaffNav: true })
  return render('出租前验机', `<div class="page-header"><div><p class="section-code">PRE-RENTAL INSPECTION</p><h2>出租前验机报告</h2><p>${sanitizePlainText(String(device?.name || order.deviceId), 200)}</p></div><a class="button button-secondary" href="${staffOrderPath(order)}">返回订单</a></div><div class="panel">${completedNote}<form enctype="multipart/form-data" method="post" action="/staff/orders/${order.id}/pre-inspection" data-site-confirm="确认出租前验机结果无误？"><div class="grid grid-2">${renderManualInspectionFields(snapshot)}</div>${renderInspectionPhotos()}<div class="grid grid-2"><div class="form-group"><label class="form-label" for="batteryCycles">电池循环次数</label><input class="form-control" id="batteryCycles" type="number" min="0" name="batteryCycles" value="${inspectionText(snapshot.batteryCycles, 20)}"></div><div class="form-group"><label class="form-label" for="batteryHealth">电池健康</label><input class="form-control" id="batteryHealth" name="batteryHealth" value="${inspectionText(snapshot.batteryHealth, 100)}" placeholder="例如 92%"></div></div><div class="form-group"><label class="form-label" for="inspectionNotes">验机备注</label><textarea class="form-control" id="inspectionNotes" name="inspectionNotes" maxlength="2000" placeholder="记录外观、配件或其他异常">${inspectionText(snapshot.inspectionNotes, 2000)}</textarea></div><button class="button button-primary" type="submit">保存验机报告</button></form></div>`)
}
