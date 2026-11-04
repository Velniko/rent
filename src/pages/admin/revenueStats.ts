/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

import { buildLayout, formatCurrency, formatMelbourneDateTime, getOrdersAsync } from '../../site'
import type { Context } from 'hono'

const esc = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] as string))

export async function getRevenueData(c: Context) {
  const [orders, refundsResult, withdrawalsResult, collectedResult, ownerSettlementsResult] = await Promise.all([
    getOrdersAsync(c),
    c.env.RENT.prepare("SELECT r.id, r.order_id, CASE WHEN r.type = 'cancellation' THEN MAX(0, MIN(r.refund_amount, COALESCE(p.rental_amount, 0))) ELSE r.refund_amount END AS refund_amount, r.type, r.created_at FROM payment_refunds r LEFT JOIN payments p ON p.id = r.payment_id WHERE r.status = 'succeeded' AND r.type <> 'deposit' ORDER BY r.created_at DESC").all(),
    c.env.RENT.prepare("SELECT id, user_id, amount, status, requested_at, processed_at FROM commission_withdrawals WHERE status = 'completed' ORDER BY processed_at DESC, requested_at DESC").all(),
    c.env.RENT.prepare("SELECT rental_id, rental_amount AS collectedRevenue, paid_at AS collectedAt FROM payments WHERE status IN ('paid', 'refunded') ORDER BY paid_at DESC").all(),
    c.env.RENT.prepare('SELECT order_id,owner_cents / 100.0 AS amount,created_at FROM c2c_settlements').all(),
  ])
  const collections = (collectedResult.results || []) as any[]
  const collected = new Map<string, { collectedRevenue: number; collectedAt: string }>()
  for (const row of collections) {
    const previous = collected.get(row.rental_id)
    collected.set(row.rental_id, { collectedRevenue: (previous?.collectedRevenue || 0) + Number(row.collectedRevenue || 0), collectedAt: previous?.collectedAt || row.collectedAt })
  }
  return { orders: (orders as any[]).map(order => ({ ...order, collectedRevenue: Number(collected.get(order.id)?.collectedRevenue || 0), collectedAt: collected.get(order.id)?.collectedAt })), collections, refunds: (refundsResult.results || []) as any[], withdrawals: (withdrawalsResult.results || []) as any[], ownerSettlements: (ownerSettlementsResult.results || []) as any[] }
}

export function renderAdminRevenueStats(user: any, data: { orders: any[], refunds: any[], withdrawals: any[], collections?: any[], ownerSettlements?: any[] }) {
  const revenueOrders = data.orders.filter((order: any) => Number(order.collectedRevenue || 0) > 0)
  const revenue = revenueOrders.reduce((sum, order) => sum + Number(order.collectedRevenue), 0)
  const refunds = data.refunds.reduce((sum, item) => sum + Number(item.refund_amount || 0), 0)
  const withdrawals = data.withdrawals.reduce((sum, item) => sum + Number(item.amount || 0), 0)
  const ownerSettlements=(data.ownerSettlements || []).reduce((sum,item)=>sum+Number(item.amount || 0),0)
  const expenses = refunds + withdrawals + ownerSettlements
  const months = new Map<string, { revenue: number, refunds: number, withdrawals: number, ownerSettlements: number }>()
  const monthOf = (value: unknown) => formatMelbourneDateTime(String(value || '')).slice(0, 7) || '未知月份'
  const revenueCollections = data.collections || revenueOrders
  revenueCollections.forEach((item: any) => { if (!Number(item.collectedRevenue || 0)) return; const key = monthOf(item.collectedAt); const row = months.get(key) || { revenue: 0, refunds: 0, withdrawals: 0, ownerSettlements: 0 }; row.revenue += Number(item.collectedRevenue); months.set(key, row) })
  data.refunds.forEach((item: any) => { const key = monthOf(item.created_at); const row = months.get(key) || { revenue: 0, refunds: 0, withdrawals: 0, ownerSettlements: 0 }; row.refunds += Number(item.refund_amount || 0); months.set(key, row) })
  data.withdrawals.forEach((item: any) => { const key = monthOf(item.processed_at || item.requested_at); const row = months.get(key) || { revenue: 0, refunds: 0, withdrawals: 0, ownerSettlements: 0 }; row.withdrawals += Number(item.amount || 0); months.set(key, row) })
  ;(data.ownerSettlements || []).forEach((item: any)=>{ const key=monthOf(item.created_at);const row=months.get(key) || {revenue:0,refunds:0,withdrawals:0,ownerSettlements:0};row.ownerSettlements+=Number(item.amount || 0);months.set(key,row) })
  const monthlyRows = [...months.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([month, row]) => `<tr><td class="mono">${esc(month)}</td><td class="mono">${formatCurrency(row.revenue)}</td><td class="mono balance-negative">-${formatCurrency(row.refunds)}</td><td class="mono balance-negative">-${formatCurrency(row.withdrawals)}</td><td class="mono">${formatCurrency(row.ownerSettlements)}</td><td class="mono"><strong>${formatCurrency(row.revenue - row.refunds - row.withdrawals - row.ownerSettlements)}</strong></td></tr>`).join('')
  const orderRows = revenueOrders.slice(0, 30).map((order: any) => `<tr><td class="mono">${esc(order.orderNo || order.id)}</td><td>${esc(order.status)}</td><td class="mono">${formatCurrency(order.collectedRevenue)}</td><td class="mono">${esc(formatMelbourneDateTime(order.collectedAt) || '-')}</td></tr>`).join('')
  const body = `<div class="page-header"><div><p class="section-code">FINANCE / REVENUE LEDGER</p><h2>收入统计</h2></div><a class="button button-secondary" href="/admin/finance">返回财务总览</a></div><div class="stats-grid"><div class="stat-card accent"><h3>订单收入</h3><div class="value">${formatCurrency(revenue)}</div><div class="trend">${revenueOrders.length} 笔有效订单</div></div><div class="stat-card warning"><h3>实际支出</h3><div class="value">${formatCurrency(expenses)}</div><div class="trend">退款 ${formatCurrency(refunds)} · 提现 ${formatCurrency(withdrawals)} · 主人结算 ${formatCurrency(ownerSettlements)}</div></div><div class="stat-card success"><h3>净收入</h3><div class="value">${formatCurrency(revenue - expenses)}</div><div class="trend">收入减实际支出</div></div></div><section class="panel"><div class="section-title"><div><span class="section-code">MONTHLY SUMMARY</span><h3>月度收入汇总</h3></div><span class="section-note">按记录时间归属月份</span></div>${monthlyRows ? `<div class="table-wrapper"><table><thead><tr><th>月份</th><th>订单收入</th><th>退款</th><th>佣金提现</th><th>主人结算</th><th>净收入</th></tr></thead><tbody>${monthlyRows}</tbody></table></div>` : '<div class="empty-state">暂无收入记录</div>'}</section><section class="panel"><div class="section-title"><div><span class="section-code">REVENUE ORDERS</span><h3>有效订单收入</h3></div><span class="section-note">显示最近 ${Math.min(30, revenueOrders.length)} 笔</span></div>${orderRows ? `<div class="table-wrapper"><table><thead><tr><th>订单</th><th>状态</th><th>金额</th><th>收款时间</th></tr></thead><tbody>${orderRows}</tbody></table></div>` : '<div class="empty-state">暂无有效订单</div>'}</section>`
  return buildLayout('收入统计 - 电脑租赁管理系统', body, user)
}
