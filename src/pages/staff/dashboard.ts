/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

import { buildLayout } from '../../site'
import { escapeHtml } from '../../lib/html'
export function renderStaffDashboard(user:any,data:any){
 const roster=data.roster,tasks=roster?.tasks?.filter((t:any)=>t.day===roster.today&&(user.role==='ADMIN'||t.employeeId===user.id||roster.requests.some((r:any)=>r.employeeId===user.id&&r.taskId===t.id&&r.status==='APPROVED')))||[];
 const pickup=tasks.filter((t:any)=>t.kind==='pickup'),returns=tasks.filter((t:any)=>t.kind==='return'),inspection=returns.filter((t:any)=>t.received);
 const body=`<div class="inner-heading"><div><p class="section-code">DAILY OPERATIONS</p><h1>工作台</h1><p>${escapeHtml(user.name)} · ${escapeHtml(roster?.today||'')}</p></div><a class="button button-secondary" href="/staff/roster">我的排班</a></div><section class="roster-readings"><a href="/staff/returns"><span>待验机</span><strong>${inspection.length}<small>台</small></strong></a><a href="/staff/mobile/pickup"><span>今日自提</span><strong>${pickup.length}<small>项</small></strong></a><a href="/staff/mobile/return"><span>今日归还</span><strong>${returns.length}<small>项</small></strong></a></section><section class="panel"><div class="section-title"><h3>需要你处理</h3><a class="link-button" href="/staff/roster">查看排班</a></div><div class="roster-my-tasks">${[...inspection,...tasks.filter((t:any)=>!inspection.includes(t))].map((task:any)=>`<article><span class="roster-task-time mono">${escapeHtml(task.start)}</span><div><strong>${task.received?'待验机':task.kind==='pickup'?'自提':'归还'} · ${escapeHtml(task.deviceName)}</strong><p class="mono">${escapeHtml(task.orderNo)}</p><span>${escapeHtml(task.customer)}</span></div><a class="button button-secondary" href="/staff/orders/${encodeURIComponent(task.orderId)}">查看订单</a></article>`).join('')||'<p class="empty-state">今天没有待处理任务</p>'}</div></section>`;
 return buildLayout('员工工作台',body,user,{currentPath:'/staff/dashboard'})
}
