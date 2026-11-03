/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

import { clientPathEnabled,normalizeClientAccess } from '../../clientAccess'
import { buildLayout, formatCurrency, getOrdersWithDetailsForUser } from '../../site';
import { deliveryStatusInfo } from '../../deliveryStatus';
import { renderOrderStatusBadge } from '../partials/orderStatusBadge';
import { Context } from 'hono';

function escape(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character] || character))
}

function deliveryCell(order: any): string {
  const bookings = Array.isArray(order.deliveryBookings) ? order.deliveryBookings : []
  if (!bookings.length) return '—'
  return bookings.map((booking: any) => {
    const info = deliveryStatusInfo(booking.status)
    const rawTracking = String(booking.tracking_url || '')
    const tracking = /^https?:\/\//i.test(rawTracking) ? `<a class="link-button" href="${escape(rawTracking)}" target="_blank" rel="noopener noreferrer">追踪</a>` : ''
    return `<div><strong>${booking.direction === 'return' ? '回收' : '派送'}：${escape(info.label)}</strong><small style="display:block">${escape(info.description)}</small>${info.special ? '<small style="display:block;color:#b42318">不能更新或取消</small>' : ''}${tracking}</div>`
  }).join('')
}

function renderRows(orders: any[], actionLabel: string): string {
  return orders.map((order: any) => `<tr><td>${escape(order.orderNo || '付款后生成')}</td><td>${escape(order.deviceName ?? '')}</td><td>${escape(order.startDate)} ~ ${escape(order.endDate)}</td><td>${formatCurrency(order.totalAmount)}</td><td>${renderOrderStatusBadge(order.status)}</td><td>${deliveryCell(order)}</td><td><a class="link-button" href="/customer/orders/${encodeURIComponent(order.id)}">${actionLabel}</a></td></tr>`).join('')
}

function renderTable(orders: any[], empty: string, actionLabel: string, emptyLinks = ''): string {
  return orders.length > 0 ? `<div class="table-wrapper"><table class="table"><thead><tr><th>订单号</th><th>设备</th><th>租期</th><th>金额</th><th>订单状态</th><th>配送状态</th><th>操作</th></tr></thead><tbody>${renderRows(orders, actionLabel)}</tbody></table></div>` : `<div class="empty-state"><p>${empty}</p>${emptyLinks}</div>`
}

export async function renderCustomerOrders(c: Context, user: any) {
  const orders = await getOrdersWithDetailsForUser(c, user.id);
  const pendingOrders = orders.filter(order => order.status === 'pending_payment');
  const activeOrders = orders.filter(order => order.status === 'active' || order.status === 'paid' || order.status === 'approved');
  const completedOrders = orders.filter(order => order.status === 'completed');
  const cancelledOrders = orders.filter(order => order.status === 'cancelled');

  const body = `
    <div class="panel">
      <div class="section-title"><h2>我的订单</h2></div>
      <h3>待付款订单</h3>${renderTable(pendingOrders, '您目前没有待付款订单。', '去支付', `${clientPathEnabled(user.clientAccess || normalizeClientAccess(null),'/customer/devices','console') ? `<a class="button button-primary" href="/customer/devices">去挑选设备</a>` : ''}`)}
      <h3 style="margin-top: 40px;">当前租赁中</h3>${renderTable(activeOrders, '您目前没有正在租赁的设备。', '查看', `${clientPathEnabled(user.clientAccess || normalizeClientAccess(null),'/customer/devices','console') ? `<a class="button button-primary" href="/customer/devices">浏览可租设备</a>` : ''}`)}
      <h3 style="margin-top: 40px;">已完成订单</h3>${renderTable(completedOrders, '您目前没有已完成的订单。', '查看')}
      <h3 style="margin-top: 40px;">已取消订单</h3>${renderTable(cancelledOrders, '您目前没有已取消的订单。', '查看')}
    </div>
  `;
  return buildLayout('我的订单 - 电脑租赁管理系统', body, user);
}
