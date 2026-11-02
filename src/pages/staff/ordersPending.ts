/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

import { buildLayout, formatCurrency, getDB, sanitizePlainText, staffOrderPath } from '../../site'
import { renderPickupPreparation } from '../partials/pickupPreparation'
import type { Context } from 'hono'

const ongoingStatuses = new Set(['approved', 'pending_payment', 'paid', 'pending_pickup', 'active', 'extended', 'overdue', 'suspended', 'pending_return'])
const statusLabels: Record<string, string> = {
  approved: '等待合同签署', pending_payment: '等待付款', paid: '待交付', pending_pickup: '待客户取货', active: '租赁中', extended: '已延期 / 租赁中', overdue: '已逾期', suspended: '已暂停', pending_return: '待归还验机',
}

// 状态 + 归属员工过滤全部下推成 SQL（status 有 idx_orders_status、users.staff_id 有
// idx_users_staff_id）。以前这里还会额外两次整表读 users / devices，现在只按本页订单
// 的 id 回查关联行，查询次数固定为 3 条，与表规模无关。
async function getOngoingStatusOrders(c: Context, statuses: Iterable<string>, user: any) {
  const db = getDB(c)
  const list = Array.from(statuses)
  const placeholders = list.map(() => '?').join(', ')
  const privileged = user?.role === 'ADMIN'
  const ownership = privileged ? '' : 'AND u.staff_id = ?'
  const result = await db.prepare(`SELECT o.* FROM orders o LEFT JOIN users u ON u.id = o.userId WHERE o.status IN (${placeholders}) AND o.deleted_at IS NULL ${ownership} ORDER BY o.createdAt DESC, o.id DESC`)
    .bind(...list, ...(privileged ? [] : [user.id]))
    .all()
  return (result.results || []) as any[]
}

async function loadRelatedRows(c: Context, table: 'users' | 'devices', ids: string[]): Promise<any[]> {
  const unique = Array.from(new Set(ids.filter(Boolean)))
  if (!unique.length) return []
  const db = getDB(c)
  const placeholders = unique.map(() => '?').join(', ')
  const result = await db.prepare(`SELECT * FROM ${table} WHERE id IN (${placeholders})`).bind(...unique).all()
  return (result.results || []) as any[]
}

export async function renderStaffOrdersOngoing(c: Context, user: any) {
  const stage = String(c.req?.query?.('stage') || '')
  const stageStatuses = stage === 'pickup'
    ? new Set(['paid', 'pending_pickup'])
    : stage === 'return'
      ? new Set(['active', 'extended', 'overdue', 'suspended', 'pending_return'])
      : ongoingStatuses
  const orders = await getOngoingStatusOrders(c, stageStatuses, user)
  const [users, devices] = await Promise.all([
    loadRelatedRows(c, 'users', orders.map(order => String(order.userId ?? order.user_id ?? ''))),
    loadRelatedRows(c, 'devices', orders.map(order => String(order.deviceId ?? order.device_id ?? ''))),
  ])
  const usersById = new Map(users.map(account => [String(account.id), account]))
  const devicesById = new Map(devices.map(device => [String(device.id), device]))
  const esc = (value: unknown) => sanitizePlainText(value, 300).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const pageTitle = stage === 'pickup' ? '待取货订单' : stage === 'return' ? '待归还订单' : '进行中的订单'

  const body = `
    <div class="page-header"><div><p class="section-code">RENTAL OPERATIONS</p><h2>${pageTitle}</h2></div><a class="button button-secondary" href="/staff/orders">查看全部订单</a></div>
    <div class="panel">
      ${orders.length ? `<div class="table-wrapper"><table class="table"><thead><tr><th>订单编号</th><th>客户</th><th>设备</th><th>租期</th><th>金额</th><th>当前阶段</th><th>操作</th></tr></thead><tbody>
        ${orders.map(order => {
          const customer = usersById.get(order.userId)
          const device = devicesById.get(order.deviceId)
          const inspectionAvailable = ['active', 'extended', 'overdue', 'suspended', 'pending_return'].includes(order.status)
          const action = stage === 'pickup'
            ? `<a class="button button-sm button-primary" href="/staff/orders/${order.id}/handover">取货</a>`
            : stage === 'return'
              ? `<a class="button button-sm button-info" href="/staff/orders/${order.id}/inspection">归还验机</a>`
              : inspectionAvailable ? `<a class="button button-sm button-info" href="/staff/orders/${order.id}/inspection">归还验机</a>` : ''
          return `<tr><td class="mono">${esc(order.orderNo || '付款后生成')}</td><td>${esc(customer?.name || '未知客户')}</td><td>${esc(device?.name || '未知设备')}</td><td>${esc(order.startDate)} 至 ${esc(order.endDate)}</td><td>${formatCurrency(order.totalAmount)}</td><td><span class="badge ${inspectionAvailable ? 'badge-primary' : 'badge-warning'}">${statusLabels[order.status] || esc(order.status)}</span></td><td><div class="table-actions"><a class="button button-sm button-secondary" href="${staffOrderPath(order)}">查看订单</a>${action}${renderPickupPreparation(order)}</div></td></tr>`
        }).join('')}
      </tbody></table></div>` : '<div class="empty-state"><span class="empty-state-code mono">NO ACTIVE ORDERS</span><h3>目前没有进行中的订单</h3></div>'}
    </div>`
  return buildLayout('进行中的订单 - 电脑租赁管理系统', body, user)
}

export const renderStaffOrdersPending = renderStaffOrdersOngoing
