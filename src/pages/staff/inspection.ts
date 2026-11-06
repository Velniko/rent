/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

import type { Context } from 'hono'
import { canStaffReadRosterOrder } from '../../services/roster'
import { renderInspectionPhotos } from '../../lib/inspectionPhotos'
import { renderReturnCollectionPanel } from '../partials/returnCollectionPanel'
import { depositPaymentModeForOrder } from '../../domain/paymentPlan'
import { buildLayout, getOrderById, getUserById, getDeviceById, sanitizePlainText } from '../../site'

export async function renderStaffInspection(c: Context, user: any, orderId: string) {
  const order = await getOrderById(c, orderId)
  if (!order || !['active', 'extended', 'overdue', 'suspended', 'pending_return', 'completed'].includes(order.status)) return buildLayout('无法验机', '<div class="panel"><h2>当前订单不能执行归还验机</h2></div>', user)
  const customer = await getUserById(c, order.userId)
  if (user.role !== 'ADMIN' && customer?.staffId !== user.id && !await canStaffReadRosterOrder(c,user,order.id)) return buildLayout('无权操作', '<div class="panel"><h2>无权操作</h2></div>', user)
  const collectionPanel = await renderReturnCollectionPanel(c, order)
  if (order.status === 'completed') return buildLayout('归还收款', `${collectionPanel}<p><a class="button button-secondary" href="/staff/mobile/return">返回归还列表</a></p>`, user, { compactStaffNav: true, currentPath: '/staff/mobile/return' })
  if(!order.return_received_at)return '<div class="panel"><h2>请先登记归还</h2></div>'
  const preauth = depositPaymentModeForOrder(order) === 'PREAUTH'
  const device = await getDeviceById(c, order.deviceId)
  const latestInspection = await c.env.RENT.prepare("SELECT snapshot_json, created_at FROM device_inspections WHERE deleted_at IS NULL AND device_id = ? AND inspection_type = 'before_rental' ORDER BY created_at DESC LIMIT 1").bind(order.deviceId).first() as any
  let automatic: any = {}
  try { automatic = JSON.parse(latestInspection?.snapshot_json || '{}') } catch (_) {}
  const value = (key: string) => sanitizePlainText(String((device as any)?.[key] || ''), 300)
  const storage = Number((device as any)?.agent_storage_free_bytes)
  const storageText = Number.isFinite(storage) && storage > 0 ? `${(storage / 1073741824).toFixed(1)} GB` : ''
  const systemStatus = [
    ['状态', value('agent_status') === 'online' ? '在线' : value('agent_status') || '未知'],
    ['主机名', value('agent_hostname')], ['操作系统', value('agent_os_version')], ['CPU', value('agent_cpu')],
    ['内存', Number((device as any)?.agent_memory_mb) > 0 ? `${Number((device as any).agent_memory_mb)} MB` : ''],
    ['系统盘剩余空间', storageText], ['最后上报', value('agent_last_seen_at')]
  ].filter(([, item]) => item).map(([label, item]) => `<div><dt>${label}</dt><dd>${item}</dd></div>`).join('')
  const checks = [['screenCondition','屏幕','screen'],['keyboardCondition','键盘','keyboard'],['trackpadCondition','触控板','touchpad'],['bodyCondition','外壳','body'],['cameraCondition','摄像头','camera'],['wifiCondition','WiFi','wifi'],['powerTest','开机测试','power']]
  const automaticResult = (key: string) => key === 'body' ? '未测试' : /(已识别|已连接|通过)/.test(String(automatic[key] || '')) ? '正常' : '未测试'
  const fields = checks.map(([name,label,key]) => { const selected = automaticResult(key); return `<div class="form-group"><label class="form-label" for="${name}">${label}</label><select class="form-control" id="${name}" name="${name}" required>${['正常','异常','未测试'].map(value => `<option value="${value}"${value === selected ? ' selected' : ''}>${value}</option>`).join('')}</select></div>` }).join('')
  const batteryCycles = Number.isInteger(Number(automatic.batteryCycles)) && Number(automatic.batteryCycles) >= 0 ? String(automatic.batteryCycles) : ''
  const batteryHealth = sanitizePlainText(String(automatic.batteryHealth || ''), 100).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const autoNote = latestInspection ? `<p class="form-text">已用出租前记录预填，请人工核对机身状况。</p>` : '<p class="form-text">暂无出租前验机记录，请人工完成检查。</p>'
  const render=(title:string,body:string,..._args:any[])=>c.req?.query?.('fragment')==='1'?body:buildLayout(title,body,user)
  return render('归还验机', `${collectionPanel}<div class="panel"><div class="section-title"><h2>归还后验机</h2><button class="button button-secondary" type="button" data-close-dialog>关闭</button><span>${sanitizePlainText(String(device?.name || order.deviceId), 200)}</span></div>${systemStatus ? `<section class="panel" style="margin:16px 0;background:#f5f8fb"><h3>EXE 最近一次系统状态</h3><dl class="data-list">${systemStatus}</dl>${autoNote}</section>` : '<div class="alert">暂无 EXE 系统状态，请确认设备已联网并运行管理软件。</div>'}<form enctype="multipart/form-data" method="post" action="/staff/orders/${order.id}/inspection" data-site-confirm="${preauth ? '确认验机结果及扣款金额，并结算信用卡预授权？' : '提交后订单将完成归还，确认验机结果无误？'}"><div class="grid grid-2">${fields}</div>${renderInspectionPhotos()}<div class="grid grid-2"><div class="form-group"><label class="form-label">电池循环次数</label><input class="form-control" type="number" min="0" name="batteryCycles" value="${batteryCycles}"></div><div class="form-group"><label class="form-label">电池健康</label><input class="form-control" name="batteryHealth" value="${batteryHealth}" placeholder="例如 92%（人工确认）"></div></div><div class="form-group"><label class="form-label">损坏说明（无损坏可留空）</label><textarea class="form-control" name="damageDescription" rows="3"></textarea></div><div class="grid grid-2"><div class="form-group"><label class="form-label">损坏照片</label><input class="form-control" type="file" name="damagePhotoFiles" accept="image/jpeg,image/png,image/webp" multiple></div><div class="form-group"><label class="form-label">${preauth ? '损坏扣款金额（AUD）' : '预计更换/维修费用（AUD）'}</label><input class="form-control" type="number" min="0" step="0.01" name="replacementCost" value="0"></div></div><button class="button button-primary" type="submit">${preauth ? '保存验机并结算' : '保存验机并完成归还'}</button></form></div>`, user, { compactStaffNav: true, currentPath: '/staff/mobile/return' })
}
