/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

import type { Context } from 'hono'
import { buildLayout } from '../../site'
import { loadRoster, rosterTaskVisibleTo } from '../../services/roster'
import { rosterCanOperate } from '../../domain/roster.mjs'
import { escapeHtml } from '../../lib/html'
import { MOBILE_SCAN_ICON, renderMobileOrderScanner } from './mobileScan'

export async function renderStaffMobileOperations(c: Context, user: any, forcedStage?: 'pickup' | 'return', scanError = '') {
  const data = await loadRoster(c, user)
  const stage = forcedStage || (['pickup', 'return'].includes(String(c.req.query('stage'))) ? c.req.query('stage') : undefined)
  const search = String(c.req.query('q') || '').trim()
  const todayTasks = data.tasks.filter(task => task.day === data.today && rosterTaskVisibleTo(data, user, task))
  const tasks = todayTasks.filter(task => (!stage || task.kind === stage) && (!search || [task.orderNo, task.deviceName, task.customer].some(value => value.toLowerCase().includes(search.toLowerCase()))))
  const pickups = todayTasks.filter(task => task.kind === 'pickup').length, returns = todayTasks.length - pickups
  const rows = tasks.map(task => {
    const permission = rosterCanOperate({ employeeId: user.id, role: user.role, task, shifts: data.published, grants: data.requests, business: data.business, now: data.now })
    const label = task.kind === 'pickup' ? '自提' : task.collection ? '待收款' : task.received ? '待验机' : '归还'
    const action = task.kind === 'pickup' ? '交付' : task.collection ? '收款' : task.received ? '验机' : '登记归还'
    const path = '/staff/orders/' + encodeURIComponent(task.orderId)
    const target = path + '/' + (task.kind === 'pickup' ? 'handover' : task.collection ? 'inspection' : task.received ? 'inspection?fragment=1' : 'receive-return')
    return `<article class="mobile-order-card${task.kind === 'return' ? ' is-return' : ''}"><div class="mobile-order-card__top"><span class="mobile-order-card__kind">${label}</span><time>${escapeHtml(task.start)}<span>–${escapeHtml(task.end)}</span></time>${task.service ? '<span class="badge badge-warning">加价时段</span>' : ''}</div><a class="mobile-order-card__device" href="${path}">${escapeHtml(task.deviceName)}</a><p>${escapeHtml(task.customer)}</p><div class="mobile-order-card__bottom"><a class="mono" href="${path}">${escapeHtml(task.orderNo)}</a>${permission.allowed ? `<a class="button button-primary" ${task.kind === 'return' && !task.collection ? 'data-workspace-modal' : ''} href="${target}">${action}</a>` : `<a class="button button-secondary" href="/staff/roster" title="${escapeHtml(permission.reason || '申请临时操作')}">查看排班</a>`}</div></article>`
  })
  const title = stage === 'pickup' ? '今日自提' : stage === 'return' ? '今日归还' : '今日订单'
  const link = (kind: string, label: string, count: number) => `<a href="/staff/mobile${kind ? '/' + kind : ''}${search ? '?q=' + encodeURIComponent(search) : ''}"${(stage || '') === kind ? ' aria-current="page"' : ''}>${label}<b>${count}</b></a>`
  const shifts = data.published.filter(shift => shift.employeeId === user.id && shift.day === data.today)
  const schedule = shifts.length ? shifts.map(shift => shift.start + '–' + shift.end).join(' / ') : '今日未排班'
  const body = `<div class="mobile-orders-page"><div class="mobile-orders-heading"><div><p class="section-code">TODAY / ORDERS</p><h1>${title}</h1><p>${escapeHtml(data.today)} · ${escapeHtml(user.name)}</p></div><a class="mobile-orders-schedule" href="${user.role === 'ADMIN' ? '/admin/roster' : '/staff/roster'}"><span>我的排班</span><strong>${escapeHtml(schedule)}</strong></a></div>
    <section class="mobile-orders-tools"><form method="get" class="mobile-orders-search" action="/staff/mobile${stage ? '/' + stage : ''}"><label class="visually-hidden" for="mobile-order-search">搜索订单号、客户、设备</label><input id="mobile-order-search" class="form-control" type="search" name="q" value="${escapeHtml(search)}" placeholder="搜索订单号、客户、设备" autocomplete="off" enterkeyhint="search"><button class="button button-secondary" type="submit">搜索</button></form><button class="button button-primary mobile-orders-scan" type="button" id="open-mobile-scanner" aria-haspopup="dialog" aria-controls="mobile-order-scanner">${MOBILE_SCAN_ICON}<span>扫码查单</span></button></section>
    <nav class="mobile-order-filters inner-tabs" aria-label="今日订单筛选">${link('', '全部', todayTasks.length)}${link('pickup', '自提', pickups)}${link('return', '归还', returns)}</nav>
    <section class="mobile-orders-list">${rows.join('') || `<div class="panel mobile-orders-empty"><strong>${search ? '没有匹配的订单' : '今天没有待处理任务'}</strong>${search ? '<a href="/staff/mobile">查看今日订单</a>' : `<a href="${user.role === 'ADMIN' ? '/admin/roster' : '/staff/roster'}">查看排班</a>`}</div>`}</section>${renderMobileOrderScanner(String(stage || ''), scanError)}</div>`
  return buildLayout(title, body, user, { compactStaffNav: true, currentPath: stage ? '/staff/mobile/' + stage : '/staff/mobile' })
}
