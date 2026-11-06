/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

import type { Context } from 'hono'
import { buildLayout } from '../../site'
import { loadRoster } from '../../services/roster'
import { rosterCanOperate } from '../../domain/roster.mjs'
import { escapeHtml } from '../../lib/html'
export async function renderStaffMobileOperations(c:Context,user:any,forcedStage?:'pickup'|'return'){
 const data=await loadRoster(c,user),stage=forcedStage||(['pickup','return'].includes(String(c.req.query('stage')))?c.req.query('stage'):undefined),search=String(c.req.query('q')||'').trim().toLowerCase();
 const tasks=data.tasks.filter(t=>t.day===data.today&&(!stage||t.kind===stage)&&(!search||[t.orderNo,t.deviceName,t.customer].some(value=>value.toLowerCase().includes(search)))&&(user.role==='ADMIN'||t.employeeId===user.id||data.requests.some(r=>r.employeeId===user.id&&r.taskId===t.id&&r.status==='APPROVED')));
 const rows=await Promise.all(tasks.map(async task=>{const permission=rosterCanOperate({employeeId:user.id,role:user.role,task,shifts:data.published,grants:data.requests,business:data.business,now:data.now});return `<article class="mobile-task-card"><div class="mobile-task-card__time"><strong>${task.kind==='pickup'?'自提':'归还'}</strong><span>${task.start}–${task.end}</span></div><div class="mobile-task-card__body"><a class="mono" href="/staff/orders/${encodeURIComponent(task.orderId)}">${escapeHtml(task.orderNo)}</a><span>${escapeHtml(task.customer)} · ${escapeHtml(task.deviceName)}</span><small>${task.collection?'待收款':task.received?'待验机':task.service?'加价时段':''}</small></div>${permission.allowed?`<a class="button button-primary" ${task.kind==='return'&&!task.collection?'data-workspace-modal':''} href="/staff/orders/${encodeURIComponent(task.orderId)}/${task.kind==='pickup'?'handover':task.collection?'inspection':task.received?'inspection?fragment=1':'receive-return'}">${task.kind==='pickup'?'交付':task.collection?'收款':task.received?'验机':'登记归还'}</a>`:`<a class="button button-secondary" href="/staff/roster">${escapeHtml(permission.reason||'申请临时操作')}</a>`}</article>`}));
 const title=stage==='pickup'?'今日自提':stage==='return'?'今日归还':'今日取还任务';return buildLayout(title,`<div class="inner-heading"><div><p class="section-code">TODAY / OPERATIONS</p><h1>${title}</h1><p>${data.today}</p></div><a class="button button-secondary" href="/staff/roster">我的排班</a></div><form method="get" class="mobile-task-search"><input class="form-control" type="search" name="q" value="${escapeHtml(search)}" placeholder="搜索订单号、客户、设备"><button class="button button-primary">搜索</button></form><section class="mobile-task-list">${rows.join('')||'<p class="empty-state">今天没有待处理任务</p>'}</section>`,user,{compactStaffNav:true,currentPath:stage?'/staff/mobile/'+stage:'/staff/mobile/today'})
}
