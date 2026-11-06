/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */
import type { Context } from 'hono'
import { validateHostedImageUrls, getOrderById, canTransitionOrder, recordDeviceLifecycle, createAuditLog } from '../site'
import { getDB } from '../db/client'
import { INSPECTION_PHOTOS } from '../lib/inspectionPhotos'
import { escapeHtml } from '../lib/html'
import { chargeOverdueReturns } from '../actions/stripePayments'
import { RosterError } from './roster'
export function renderReturnRegistration(order:any) {
 return `<form method="post" action="/staff/orders/${encodeURIComponent(order.id)}/receive-return"><div class="section-title"><h2>登记归还</h2><button class="button button-secondary" type="button" data-close-dialog>关闭</button></div><p class="mono">${escapeHtml(order.orderNo||order.id)}</p><label class="form-label">归还备注<textarea class="form-control" name="notes" maxlength="1000" rows="3"></textarea></label><label class="workspace-checkbox"><input type="checkbox" name="received" value="1" required>已收到设备及配件</label><p class="workspace-form-error" role="alert" hidden></p><div class="record-actions"><button class="button button-secondary" type="button" data-close-dialog>取消</button><button class="button button-primary" type="submit">确认归还</button></div></form>`
}
export async function registerOrderReturn(c:Context,user:any,orderId:string) {
 let order=await getOrderById(c,orderId);const form=await c.req.parseBody()
 if(!order||!['active','extended','overdue','suspended','pending_return'].includes(String(order.status))||order.return_received_at)throw new RosterError('订单已归还或当前不能归还',409)
 if(order.status!=='pending_return'&&!canTransitionOrder(order.status,'pending_return'))throw new RosterError('当前订单不能登记归还',409)
 if(String(form.received)!=='1')throw new RosterError('请确认已收到设备及配件')
 const receivedAt=new Date().toISOString(),notes=String(form.notes||'').trim().slice(0,1000),id='return-'+crypto.randomUUID(),db=getDB(c)
 await chargeOverdueReturns(c,new Date(receivedAt),order.id)
 order=await getOrderById(c,orderId);if(!order||order.return_received_at||!['active','extended','overdue','suspended','pending_return'].includes(String(order.status)))throw new RosterError('订单已归还或当前不能归还',409)
 // The unique fulfillment row makes a second receipt fail and rolls back the entire batch.
 const result=await db.batch([
  db.prepare("INSERT INTO order_fulfillment_records (id,order_id,record_type,device_serial_number,accessories_json,condition_snapshot_json,notes,recorded_by) SELECT ?,?,'RETURN','','[]','{}',?,? WHERE EXISTS (SELECT 1 FROM orders WHERE id=? AND status=? AND return_received_at IS NULL)").bind(id,order.id,notes,user.id,order.id,order.status),
  db.prepare("UPDATE orders SET status='pending_return',rental_status='RETURNED',return_received_at=?,return_received_by=?,updatedAt=CURRENT_TIMESTAMP WHERE id=? AND return_received_at IS NULL AND status=?").bind(receivedAt,user.id,order.id,order.status),
  db.prepare("INSERT INTO rental_status_history (id,rental_id,old_status,new_status,trigger_type,triggered_by,reason) SELECT ?,?,?,'RETURNED','MANUAL',?,? WHERE EXISTS (SELECT 1 FROM order_fulfillment_records WHERE id=?)").bind(crypto.randomUUID(),order.id,order.rental_status||'ACTIVE',user.id,notes||'已收到设备',id)
 ])
 if(Number(result[0].meta.changes)!==1||Number(result[1].meta.changes)!==1)throw new RosterError('订单已被更新，请刷新后重试',409)
 await recordDeviceLifecycle(c,order.deviceId,'RETURNED',{orderId:order.id,changedBy:user.id,reason:'已收到设备，待验机'})
 await createAuditLog(c,{actor:user,action:'RETURN_RECEIVED',targetType:'ORDER',targetId:order.id,before:{status:order.status},after:{status:'pending_return'},reason:notes||'已收到设备'})
}
export async function renderOrderOperations(c:Context,orderId:string) {
 const rows=await getDB(c).prepare("SELECT a.action,a.reason,a.created_at,u.name AS actor FROM audit_logs a LEFT JOIN users u ON u.id=a.actor_id WHERE a.target_type='ORDER' AND a.target_id=? AND a.action IN ('RETURN_RECEIVED','RETURN_INSPECTION_COMPLETED','RETURN_INSPECTION_COMPLETED_WITH_DAMAGE','ORDER_FORCE_COMPLETED_RELISTED','HANDOVER_COMPLETED') ORDER BY a.created_at DESC,a.rowid DESC LIMIT 50").bind(orderId).all()
 const labels:Record<string,string>={RETURN_RECEIVED:'登记归还',RETURN_INSPECTION_COMPLETED:'归还验机完成',RETURN_INSPECTION_COMPLETED_WITH_DAMAGE:'归还验机 · 有损坏',ORDER_FORCE_COMPLETED_RELISTED:'强制完成并上架',HANDOVER_COMPLETED:'设备已交付'}
 const inspections=await getDB(c).prepare("SELECT inspection_type,snapshot_json,created_at FROM device_inspections WHERE rental_id=? AND deleted_at IS NULL AND inspection_type IN ('before_rental','after_return') ORDER BY created_at DESC LIMIT 10").bind(orderId).all()
 const photos=(inspections.results||[]).map((row:any)=>{let snapshot:any={};try{snapshot=JSON.parse(row.snapshot_json||'{}')}catch{};const cards=INSPECTION_PHOTOS.map(([key,label])=>{const value=snapshot.inspectionPhotos?.[key];if(!value)return '';let url='';try{url=validateHostedImageUrls(String(value))[0]||''}catch{};return url?`<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer"><strong>${label}</strong><img src="${escapeHtml(url)}" alt="${label}" loading="lazy" style="width:100%;max-height:180px;object-fit:contain"></a>`:''}).join('');return cards?`<details><summary>${row.inspection_type==='before_rental'?'出租前验机':'归还验机'} · ${escapeHtml(row.created_at)}</summary><div class="inspection-photo-grid">${cards}</div></details>`:''}).join('')
 return `<section class="panel"><div class="section-title"><h3>取还操作记录</h3></div><div class="roster-log-list">${(rows.results||[]).map((r:any)=>`<article><span class="roster-log-dot"></span><span class="mono">${escapeHtml(r.created_at)}</span><div class="roster-log-content"><strong>${labels[r.action]||escapeHtml(r.action)}</strong><p>${escapeHtml(r.reason||'')}</p></div><span>${escapeHtml(r.actor||'系统')}</span></article>`).join('')||'<p class="empty-state">暂无取还操作记录</p>'}</div>${photos}</section>`
}
