/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

import { buildLayout, formatCurrency } from '../../site';
import { escapeHtml } from '../../lib/html'
import type { BankTransferPayment } from '../../services/bankTransferReferences'

export function renderAdminFinance(user: any, orders: any[] = [], refunds: any[] = [], withdrawals: any[] = [], bankTransfers: { transfers: BankTransferPayment[]; search: string } = { transfers: [], search: '' }) {
  const totalRevenue = orders
    .reduce((sum, order) => sum + Number(order.collectedRevenue || 0), 0)

  const totalExpense = refunds.reduce((sum, item) => sum + Number(item.refund_amount || 0), 0) + withdrawals.reduce((sum, item) => sum + Number(item.amount || 0), 0)
  const netProfit = Math.round((totalRevenue - totalExpense) * 100) / 100
  const statusLabels: Record<string, string> = { pending: '待支付', awaiting_transfer: '待转账凭证', submitted: '待审核', paid: '已入账', refunded: '已退款', partially_refunded: '部分退款', rejected: '已驳回', failed: '失败', cancelled: '已取消' }
  const transferRows = bankTransfers.transfers.map(item => `<tr><td class="mono">${escapeHtml(item.code || '—')}</td><td><a href="${item.scope === 'order' ? `/admin/orders/${encodeURIComponent(item.source_id)}` : `/admin/orders/balance-topups?search=${encodeURIComponent(item.code || item.source_id)}`}">${escapeHtml(item.order_no || item.source_id)}</a></td><td>${escapeHtml(item.customer_name || '—')}</td><td>${formatCurrency(item.amount)}</td><td>${escapeHtml(statusLabels[item.status] || item.status)}</td></tr>`).join('')

  const body = `
    <style>
      .finance-overview {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
        gap: 20px;
        margin-bottom: 32px;
      }
      .finance-card {
        background: var(--surface-secondary);
        padding: 24px;
        border-radius: var(--radius);
        border-left: 4px solid var(--primary);
      }
      .finance-card:nth-child(2) { border-left-color: var(--danger); }
      .finance-card:nth-child(3) { border-left-color: var(--success); }
      .finance-card h3 {
        font-size: 0.875rem;
        color: var(--text-secondary);
        margin-bottom: 8px;
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }
      .finance-card .amount {
        font-size: 2rem;
        font-weight: 700;
        color: var(--text);
      }
      .finance-sections {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
        gap: 20px;
      }
      .finance-section {
        padding: 24px;
        background: var(--surface-secondary);
        border-radius: var(--radius);
      }
      .finance-section h4 {
        margin-bottom: 12px;
        color: var(--text);
      }
      .finance-section p {
        color: var(--text-secondary);
        margin-bottom: 16px;
        font-size: 0.9rem;
      }
    </style>
    <div class="panel">
      <div class="section-title">
        <h2>财务总览</h2>
      </div>

      <div class="finance-overview">
        <div class="finance-card">
          <h3>总收入</h3>
          <p class="amount">${formatCurrency(totalRevenue)}</p>
        </div>
        <div class="finance-card">
          <h3>总支出</h3>
          <p class="amount">${formatCurrency(totalExpense)}</p>
        </div>
        <div class="finance-card">
          <h3>净收入</h3>
          <p class="amount">${formatCurrency(netProfit)}</p>
        </div>
      </div>

      <section class="panel">
        <h3>银行转账查账</h3>
        <form method="get" action="/admin/finance" class="record-form">
          <label class="form-label" for="transferCode">转账备注码</label>
          <input class="form-control mono" id="transferCode" name="transferCode" value="${escapeHtml(bankTransfers.search)}" maxlength="5" placeholder="输入 5 位转账备注码">
          <button class="button button-secondary" type="submit">查询</button>
        </form>
        ${transferRows ? `<div class="table-wrapper"><table><thead><tr><th>转账备注码</th><th>订单 / 充值单</th><th>客户</th><th>金额</th><th>状态</th></tr></thead><tbody>${transferRows}</tbody></table></div>` : '<p class="empty-state">暂无匹配的银行转账记录</p>'}
      </section>

      <div class="finance-sections">
        <div class="finance-section">
          <h4>单据中心</h4>
          <a href="/admin/documents" class="button button-sm">查询单据</a>
        </div>
        <div class="finance-section">
          <h4>收入统计</h4>
          <p>查看订单收入和租赁交易明细。</p>
          <a href="/admin/revenue-stats" class="button button-sm">查看收入统计</a>
        </div>
        <div class="finance-section">
          <h4>退款处理</h4>
          <p>查看和处理已支付订单的退款记录。</p>
          <a href="/admin/refunds" class="button button-sm">查看退款</a>
        </div>
        <div class="finance-section">
          <h4>支付争议</h4>
          <p>处理 Stripe 拒付、举证进度和最终财务影响。</p>
          <a href="/admin/finance/payment-disputes" class="button button-sm">管理支付争议</a>
        </div>
        <div class="finance-section">
          <h4>异常订单</h4>
          <p>系统检测到异常后自动暂停，等待管理员审核恢复或确认暂停。</p>
          <a href="/admin/finance/anomalous-orders" class="button button-sm">审核异常订单</a>
        </div>
        <div class="finance-section">
          <h4>佣金提现</h4>
          <p>查看佣金发放与提现审核记录。</p>
          <a href="/admin/withdrawals" class="button button-sm">查看提现</a>
        </div>
        <div class="finance-section">
          <h4>用户管理</h4>
          <p>查看用户余额和平台客户账户状态。</p>
          <a href="/admin/users" class="button button-sm">查看用户</a>
        </div>
      </div>
    </div>
  `;

  return buildLayout('财务总览 - 电脑租赁管理系统', body, user);
}
