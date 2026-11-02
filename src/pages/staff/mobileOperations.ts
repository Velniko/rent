/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

import type { Context } from 'hono'
import { buildLayout, staffOrderPath } from '../../site'

const escapeHtml = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character] || character))

const slotLabels: Record<string, string> = {
  morning_service: '07:00–08:00',
  delivery_morning: '09:00–12:00',
  morning: '09:00–12:00',
  afternoon: '13:00–20:00',
  delivery_afternoon: '13:00–19:00',
  evening_service: '21:00–23:00',
}

const statusLabels: Record<string, string> = {
  approved: '待签署/付款',
  paid: '待取货',
  pending_pickup: '待取货',
  active: '租赁中',
  extended: '已延期',
  overdue: '已逾期',
  suspended: '已暂停',
  pending_return: '待归还验机',
  completed: '待收款',
}

export async function renderStaffMobileOperations(c: Context, user: any, forcedStage?: 'pickup' | 'return') {
  const search = String(c.req.query('q') || '').trim().slice(0, 100)
  const stage = forcedStage || (['pickup', 'return'].includes(String(c.req.query('stage') || '')) ? String(c.req.query('stage')) : '')
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Melbourne', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  const staffFilter = user.role === 'STAFF' ? ' AND u.staff_id = ?' : ''
  const taskQuery = `
    WITH tasks AS (
      SELECT o.id AS order_id, o.orderNo AS order_no, o.status, u.name AS customer_name, d.name AS device_name,
             o.startDate AS task_date, 'pickup' AS task_type,
             COALESCE(o.pickupTimeSlot, CASE WHEN o.startPeriod = 'PM' THEN 'afternoon' ELSE 'morning' END) AS task_slot,
             o.pickupLocation AS task_location,
             CASE COALESCE(o.pickupTimeSlot, CASE WHEN o.startPeriod = 'PM' THEN 'afternoon' ELSE 'morning' END)
               WHEN 'morning_service' THEN 0 WHEN 'morning' THEN 1 WHEN 'delivery_morning' THEN 1
               WHEN 'afternoon' THEN 2 WHEN 'delivery_afternoon' THEN 2 WHEN 'evening_service' THEN 3 ELSE 9 END AS task_order
      FROM orders o JOIN users u ON u.id = o.userId JOIN devices d ON d.id = o.deviceId
      WHERE o.deleted_at IS NULL AND date(o.startDate) = ? AND o.status IN ('approved', 'paid', 'pending_pickup')${staffFilter}
      UNION ALL
      SELECT o.id AS order_id, o.orderNo AS order_no, o.status, u.name AS customer_name, d.name AS device_name,
             o.endDate AS task_date, 'return' AS task_type,
             COALESCE(o.returnTimeSlot, CASE WHEN o.endPeriod = 'PM' THEN 'afternoon' ELSE 'morning' END) AS task_slot,
             o.returnLocation AS task_location,
             CASE COALESCE(o.returnTimeSlot, CASE WHEN o.endPeriod = 'PM' THEN 'afternoon' ELSE 'morning' END)
               WHEN 'morning_service' THEN 0 WHEN 'morning' THEN 1 WHEN 'delivery_morning' THEN 1
               WHEN 'afternoon' THEN 2 WHEN 'delivery_afternoon' THEN 2 WHEN 'evening_service' THEN 3 ELSE 9 END AS task_order
      FROM orders o JOIN users u ON u.id = o.userId JOIN devices d ON d.id = o.deviceId
      WHERE o.deleted_at IS NULL AND ${forcedStage === 'return' ? "(date(o.endDate) <= ? OR o.status = 'completed') AND (o.status IN ('active', 'extended', 'overdue', 'suspended', 'pending_return') OR (o.status = 'completed' AND o.overdue_outstanding_amount > 0))" : "date(o.endDate) = ? AND o.status IN ('active', 'extended', 'overdue', 'suspended', 'pending_return')"}${staffFilter}
    )
    SELECT * FROM tasks
    WHERE ${stage ? 'task_type = ? AND (' : '('}LOWER(COALESCE(order_id, '')) LIKE ?
       OR LOWER(COALESCE(order_no, '')) LIKE ?
       OR LOWER(COALESCE(customer_name, '')) LIKE ?
       OR LOWER(COALESCE(device_name, '')) LIKE ?
    )
    ORDER BY task_order ASC, CASE WHEN task_type = 'pickup' THEN 0 ELSE 1 END ASC, order_no ASC
  `
  const searchLike = `%${search.toLowerCase()}%`
  const bindings: unknown[] = [today]
  if (user.role === 'STAFF') bindings.push(user.id)
  bindings.push(today)
  if (user.role === 'STAFF') bindings.push(user.id)
  if (stage) bindings.push(stage)
  bindings.push(searchLike, searchLike, searchLike, searchLike)
  const result = await c.env.RENT.prepare(taskQuery).bind(...bindings).all()
  const tasks = ((result.results || []) as any[]).map(task => ({
    ...task,
    orderNo: String(task.order_no || task.order_id || ''),
    taskType: String(task.task_type),
    taskSlot: String(task.task_slot || ''),
  }))
  const pickupCount = tasks.filter(task => task.taskType === 'pickup').length
  const returnCount = tasks.filter(task => task.taskType === 'return').length

  const taskRows = tasks.map(task => {
    const isPickup = task.taskType === 'pickup'
    const order = { id: String(task.order_id), orderNo: task.order_no }
    const canOpenAction = isPickup
      ? ['paid', 'pending_pickup'].includes(String(task.status))
      : ['active', 'extended', 'overdue', 'suspended', 'pending_return', 'completed'].includes(String(task.status))
    const actionHref = canOpenAction
      ? isPickup ? `/staff/orders/${encodeURIComponent(task.order_id)}/handover` : `/staff/orders/${encodeURIComponent(task.order_id)}/inspection`
      : staffOrderPath(order)
    const actionLabel = canOpenAction ? (isPickup ? '去取货' : task.status === 'completed' ? '去收款' : '去验机') : '查看订单'
    return `<article class="mobile-task-card ${isPickup ? 'is-pickup' : 'is-return'}">
      <div class="mobile-task-card__time"><strong>${isPickup ? '取货' : '归还'}</strong><span>${escapeHtml(slotLabels[task.taskSlot] || task.taskSlot || '时段待确认')}</span></div>
      <div class="mobile-task-card__body"><strong>${escapeHtml(task.orderNo)}</strong><span>${escapeHtml(task.customer_name || '未知客户')} · ${escapeHtml(task.device_name || '未知设备')}</span><small>${!isPickup && forcedStage ? `${escapeHtml(task.task_date)} · ` : ''}${escapeHtml(task.task_location || '地点待确认')} · ${escapeHtml(statusLabels[String(task.status)] || String(task.status))}</small></div>
      <a class="button button-sm ${isPickup ? 'button-primary' : 'button-info'}" href="${actionHref}">${actionLabel}</a>
    </article>`
  }).join('')

  const pageTitle = forcedStage ? (stage === 'pickup' ? '取货订单' : '归还订单') : stage === 'pickup' ? '今日取货' : stage === 'return' ? '今日归还' : '今日租赁任务'
  const pagePath = forcedStage ? `/staff/mobile/${forcedStage}` : '/staff/mobile/today'
  const clearHref = forcedStage ? pagePath : stage ? `/staff/mobile/today?stage=${stage}` : '/staff/mobile/today'
  const body = `<div class="mobile-operations-page">
    <nav class="mobile-page-crumbs" aria-label="面包屑"><a href="/staff/mobile">工作台</a><span aria-hidden="true">/</span><span>${forcedStage ? (stage === 'pickup' ? '取货' : '归还') : '今日任务'}</span></nav>
    <div class="page-header"><div><p class="section-code">TODAY / RENTAL OPS</p><h2>${pageTitle}</h2><p>${today}</p></div><a class="button button-secondary" href="/staff/orders">全部订单</a></div>
    <form class="mobile-task-search" method="get" action="${pagePath}"><input class="form-control" type="search" name="q" value="${escapeHtml(search)}" placeholder="扫码或搜索订单号、客户、设备" autocomplete="off" inputmode="search" enterkeyhint="search" ${search ? '' : 'autofocus'}>${stage && !forcedStage ? `<input type="hidden" name="stage" value="${stage}">` : ''}<button class="button button-primary" type="submit">搜索</button>${search ? `<a class="button button-secondary" href="${clearHref}">清除</a>` : ''}</form>
${forcedStage ? `<p><a class="button button-primary" href="/staff/mobile/scan?stage=${stage}">${stage === 'pickup' ? '扫码取货' : '扫码归还'}</a></p>` : ''}
    ${forcedStage ? '' : `<div class="mobile-task-summary"><span>今日任务 <strong>${tasks.length}</strong></span><span class="is-pickup">取货 <strong>${pickupCount}</strong></span><span class="is-return">归还 <strong>${returnCount}</strong></span></div>`}
    ${forcedStage ? '' : `<div class="mobile-filter-chips" role="tablist" aria-label="任务筛选">${[['', '全部'], ['pickup', '取货'], ['return', '归还']].map(([value, label]) => `<a class="mobile-chip${stage === value ? ' is-active' : ''}" role="tab" aria-selected="${stage === value ? 'true' : 'false'}" href="${value ? `/staff/mobile/today?stage=${value}` : '/staff/mobile/today'}">${label}<b>${value === 'pickup' ? pickupCount : value === 'return' ? returnCount : tasks.length}</b></a>`).join('')}</div>`}
    <section class="mobile-task-list">${taskRows || `<div class="empty-state"><h3>${search ? '没有匹配的订单' : forcedStage ? (stage === 'pickup' ? '今天没有待取货订单' : '没有待归还订单') : '今天没有待处理任务'}</h3><p>${search ? '请更换订单号、客户或设备关键词。' : forcedStage ? '可扫码查询订单。' : '取货和归还任务会按预约日期自动显示在这里。'}</p></div>`}</section>
  </div>`
  return buildLayout(`${pageTitle} - 电脑租赁管理系统`, body, user, { compactStaffNav: true, currentPath: pagePath })
}
