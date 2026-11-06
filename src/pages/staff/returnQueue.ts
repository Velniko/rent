/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */
import type { Context } from 'hono'
import { buildLayout } from '../../site'
import { getDB } from '../../db/client'
import { escapeHtml } from '../../lib/html'
import { loadRoster } from '../../services/roster'
export async function renderReturnQueue(c:Context,user:any) {
 const roster=await loadRoster(c,user),ids=new Set(roster.tasks.filter(t=>t.kind==='return'&&(t.employeeId===user.id||roster.requests.some(r=>r.employeeId===user.id&&r.taskId===t.id&&r.status==='APPROVED'))).map(t=>t.orderId))
 const result=await getDB(c).prepare("SELECT o.id,o.orderNo,o.return_received_at,o.endDate,d.name AS deviceName,u.name AS customer FROM orders o JOIN devices d ON d.id=o.deviceId JOIN users u ON u.id=o.userId WHERE o.deleted_at IS NULL AND o.status IN ('active','extended','overdue','suspended','pending_return') ORDER BY (o.return_received_at IS NULL),o.endDate,o.id").all()
 const orders=(result.results||[]).filter((o:any)=>user.role==='ADMIN'||ids.has(o.id))
 const body=`<div class="inner-heading"><div><p class="section-code">RETURN OPERATIONS</p><h1>归还管理</h1></div><a class="button button-secondary" href="${user.role==='ADMIN'?'/admin/orders':'/staff/roster'}">${user.role==='ADMIN'?'全部订单':'我的排班'}</a></div><section class="panel"><div class="table-wrapper"><table><thead><tr><th>订单 / 设备</th><th>客户</th><th>归还日期</th><th>状态</th><th>操作</th></tr></thead><tbody>${orders.map((o:any)=>`<tr><td><a href="/${user.role==='ADMIN'?'admin':'staff'}/orders/${encodeURIComponent(o.id)}" class="mono">${escapeHtml(o.orderNo||o.id)}</a><small class="cell-sub">${escapeHtml(o.deviceName)}</small></td><td>${escapeHtml(o.customer)}</td><td>${escapeHtml(o.endDate)}</td><td><span class="badge ${o.return_received_at?'badge-warning':'badge-info'}">${o.return_received_at?'待验机':'待归还'}</span></td><td>${o.return_received_at?`<a class="button button-sm button-primary" data-workspace-modal href="/staff/orders/${encodeURIComponent(o.id)}/inspection?fragment=1">验机</a>`:`<a class="button button-sm button-secondary" data-workspace-modal href="/staff/orders/${encodeURIComponent(o.id)}/receive-return">登记归还</a>`}</td></tr>`).join('')||'<tr><td colspan="5">暂无待处理归还</td></tr>'}</tbody></table></div></section>`
 return buildLayout('归还管理',body,user)
}
