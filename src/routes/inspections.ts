/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

import type { WorkspaceApp } from './types'
import { nanoid } from 'nanoid'
import { renderForbidden } from '../pages/public/notFound'
import { renderStaffPreInspection } from '../pages/staff/preInspection'
import { renderInspectionView } from '../pages/public/inspectionView'
import { canStaffReadRosterOrder } from '../services/roster'
import { readInspectionPhotos } from '../lib/inspectionPhotos'
import { readManualInspectionFields, PRE_INSPECTION_SOURCE } from '../lib/inspection'
import { getOrderById, getUserById, sanitizePlainText, staffOrderPath } from '../site'

export function registerInspectionRoutes(app: WorkspaceApp) {
  app.get('/staff/orders/:orderId/pre-inspection', async (c) => {
    const user = c.get('user')
    if (!user || !['STAFF', 'ADMIN'].includes(user.role)) return c.html(renderForbidden(), 403)
    return c.html(await renderStaffPreInspection(c, user, c.req.param('orderId')))
  })

  app.post('/staff/orders/:orderId/pre-inspection', async (c) => {
    const user = c.get('user')
    if (!user || !['STAFF', 'ADMIN'].includes(user.role)) return c.html(renderForbidden(), 403)
    const orderId = c.req.param('orderId')
    const order = await getOrderById(c, orderId)
    if (!order || ['completed', 'cancelled'].includes(String(order.status)) || order.handover_completed_at) return c.text('当前订单不能填写出租前验机', 409)
    const customer = await getUserById(c, order.userId)
    if (user.role === 'STAFF' && customer?.staffId !== user.id && !await canStaffReadRosterOrder(c, user, order.id)) return c.html(renderForbidden(), 403)
    const form = await c.req.parseBody({ all: true })
    let inspectionPhotos; try { inspectionPhotos = await readInspectionPhotos(c, user, form) } catch (error) { return c.text(error instanceof Error ? error.message : '操作失败，请重试', 400) }
    const inspectionInput = readManualInspectionFields(form as any)
    if (inspectionInput.missing.length) return c.text(`请填写：${inspectionInput.missing.map(label => `验机-${label}`).join('、')}`, 400)
    const batteryCycles = form.batteryCycles === '' || form.batteryCycles == null ? null : Number(form.batteryCycles)
    if (batteryCycles !== null && (!Number.isInteger(batteryCycles) || batteryCycles < 0)) return c.text('电池循环次数无效', 400)
    const batteryHealth = sanitizePlainText(String(form.batteryHealth || ''), 100).trim()
    const inspectionNotes = sanitizePlainText(String(form.inspectionNotes || ''), 2000).trim()
    const existing = await c.env.RENT.prepare("SELECT id, snapshot_json FROM device_inspections WHERE deleted_at IS NULL AND rental_id = ? AND inspection_type = 'before_rental' ORDER BY created_at DESC LIMIT 1").bind(orderId).first() as any
    let snapshot: Record<string, any> = {}
    try { snapshot = JSON.parse(existing?.snapshot_json || '{}') } catch (_) { }
    Object.assign(snapshot, inspectionInput.checks, { batteryCycles, batteryHealth, inspectionNotes, inspectionDate: new Date().toISOString().slice(0, 10), inspectionBy: user.name || user.id, source: PRE_INSPECTION_SOURCE, inspectionPhotos })
    await (existing?.id
      ? c.env.RENT.prepare('UPDATE device_inspections SET snapshot_json = ?, differences_json = ?, performed_by = ?, created_at = CURRENT_TIMESTAMP WHERE id = ?').bind(JSON.stringify(snapshot), JSON.stringify({}), user.id, existing.id)
      : c.env.RENT.prepare("INSERT INTO device_inspections (id, device_id, rental_id, inspection_type, snapshot_json, differences_json, performed_by) VALUES (?, ?, ?, 'before_rental', ?, ?, ?)").bind(`inspection-${nanoid(12)}`, order.deviceId, orderId, JSON.stringify(snapshot), JSON.stringify({}), user.id)
    ).run()
    await c.env.RENT.prepare('UPDATE devices SET inspection_requested_at = NULL WHERE id = ?').bind(order.deviceId).run()
    return c.req.query('fragment') === '1' ? c.text('已保存') : c.redirect(staffOrderPath(order))
  })

  app.get('/inspection/view/:id', async (c) => {
    return c.html(await renderInspectionView(c, c.req.param('id'), c.get('user')))
  })
}
