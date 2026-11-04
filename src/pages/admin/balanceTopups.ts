/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

import { buildLayout, getDB, formatCurrency, formatMelbourneDate } from '../../site';
import { Context } from 'hono';
import { escapeHtml } from '../../lib/html'

const TOPUP_STATUS_MAP: Record<string, { text: string; class: string }> = {
  all: { text: '全部', class: 'badge-info' },
  pending: { text: '待支付', class: 'badge-warning' },
  awaiting_transfer: { text: '待转账凭证', class: 'badge-warning' },
  submitted: { text: '待审核', class: 'badge-warning' },
  paid: { text: '已入账', class: 'badge-success' },
  failed: { text: '已驳回/失败', class: 'badge-danger' },
  rejected: { text: '已驳回', class: 'badge-danger' },
};

const TOPUP_METHOD_MAP: Record<string, string> = {
  card: '信用卡',
  bank_transfer: '银行转账',
  alipay: '支付宝',
  wechat: '微信',
};

type TopupFilters = {
  userId?: string;
  status?: string;
  search?: string;
  dateFrom?: string;
  dateTo?: string;
};

function buildTopupWhere(filters?: TopupFilters) {
  const userIdFilter = (filters?.userId || '').trim();
  const statusFilter = (filters?.status || 'all').trim().toLowerCase();
  const searchTerm = (filters?.search || '').trim();
  const dateFrom = (filters?.dateFrom || '').trim();
  const dateTo = (filters?.dateTo || '').trim();

  const clauses: string[] = ['1=1'];
  const params: any[] = [];

  if (userIdFilter) {
    clauses.push('bt.user_id = ?');
    params.push(userIdFilter);
  }

  if (statusFilter !== 'all') {
    clauses.push('bt.status = ?');
    params.push(statusFilter);
  }

  if (searchTerm) {
    const escaped = searchTerm.toLowerCase().replace(/[\\%_]/g, (m) => `\\${m}`);
    const like = `%${escaped}%`;
    clauses.push(`(
      LOWER(bt.id) LIKE ? ESCAPE '\\'
      OR LOWER(bt.reference) LIKE ? ESCAPE '\\'
      OR LOWER(r.code) LIKE ? ESCAPE '\\'
      OR LOWER(u.name) LIKE ? ESCAPE '\\'
      OR LOWER(u.email) LIKE ? ESCAPE '\\'
    )`);
    params.push(like, like, like, like, like);
  }

  if (dateFrom) {
    clauses.push("datetime(bt.created_at) >= datetime(?)");
    params.push(`${dateFrom}T00:00:00`);
  }

  if (dateTo) {
    clauses.push("datetime(bt.created_at) <= datetime(?)");
    params.push(`${dateTo}T23:59:59`);
  }

  return { whereSql: clauses.join(' AND '), userIdFilter, statusFilter, searchTerm, dateFrom, dateTo, params };
}

const TOPUP_JOIN_SQL = `
  FROM balance_topups bt
  LEFT JOIN users u ON u.id = bt.user_id
  LEFT JOIN bank_transfer_references r ON r.scope = 'topup' AND r.source_id = bt.id
`;

export async function renderAdminBalanceTopups(c: Context, user: any) {
  const url = new URL(c.req.url);
  const userIdFilter = url.searchParams.get('userId') || '';
  const statusFilter = url.searchParams.get('status') || 'all';
  const searchTerm = (url.searchParams.get('search') || '').trim();
  const dateFrom = (url.searchParams.get('dateFrom') || '').trim();
  const dateTo = (url.searchParams.get('dateTo') || '').trim();
  const errorMessage = url.searchParams.get('error')?.trim() || '';
  const successMessage = url.searchParams.get('success')?.trim() || '';

  const db = getDB(c);
  const { whereSql, params } = buildTopupWhere({ userId: userIdFilter, status: statusFilter, search: searchTerm, dateFrom, dateTo });

  const [customerOptionsResult, rowsResult, statsRow] = await Promise.all([
    db.prepare("SELECT id, name FROM users WHERE role = 'CUSTOMER' ORDER BY name").all(),
    db.prepare(`
      SELECT bt.*, r.code AS transfer_code, u.name AS customer_name, u.email AS customer_email
      ${TOPUP_JOIN_SQL}
      WHERE ${whereSql}
      ORDER BY bt.created_at DESC
      LIMIT 200
    `).bind(...params).all(),
    db.prepare(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN bt.status = 'paid' THEN bt.amount ELSE 0 END) AS paidAmount,
        SUM(CASE WHEN bt.status = 'submitted' THEN 1 ELSE 0 END) AS pendingReviewCount,
        SUM(CASE WHEN bt.status = 'awaiting_transfer' THEN 1 ELSE 0 END) AS awaitingTransferCount
      ${TOPUP_JOIN_SQL}
      WHERE ${whereSql}
    `).bind(...params).first(),
  ]);

  const customerOptions = (customerOptionsResult.results || []) as any[];
  const rows = (rowsResult.results || []) as any[];
  const stats = statsRow as any;
  const totalCount = Number(stats?.total || 0);
  const paidAmount = Number(stats?.paidAmount || 0);
  const pendingReviewCount = Number(stats?.pendingReviewCount || 0);
  const awaitingTransferCount = Number(stats?.awaitingTransferCount || 0);

  const redirectTarget = `${url.pathname}${url.search}`.replace(/&/g, '&amp;').replace(/"/g, '&quot;');

  const body = `
    <div class="panel">
      <div class="section-title">
        <div>
          <h2>余额充值订单</h2>
        </div>
        <div style="display: flex; gap: 8px; flex-wrap: wrap;">
          <a href="/admin/orders" class="button button-secondary">返回租赁订单</a>
        </div>
      </div>

      ${successMessage ? `<div data-flash-notice class="page-notification page-notification--success">${successMessage}</div>` : ''}
      ${errorMessage ? `<div data-flash-notice class="page-notification page-notification--error">${errorMessage}</div>` : ''}

      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 16px; margin: 20px 0;">
        <div class="panel" style="padding: 18px; background: linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%); border: 1px solid #bfdbfe;">
          <div style="color: var(--text-secondary); font-size: 0.8rem; margin-bottom: 8px;">总充值订单</div>
          <div style="font-size: 1.8rem; font-weight: 700;">${totalCount}</div>
        </div>
        <div class="panel" style="padding: 18px; background: linear-gradient(135deg, #fff7ed 0%, #ffedd5 100%); border: 1px solid #fed7aa;">
          <div style="color: var(--text-secondary); font-size: 0.8rem; margin-bottom: 8px;">待审核（已提交凭证）</div>
          <div style="font-size: 1.8rem; font-weight: 700;">${pendingReviewCount}</div>
        </div>
        <div class="panel" style="padding: 18px; background: linear-gradient(135deg, #fefce8 0%, #fef9c3 100%); border: 1px solid #fde68a;">
          <div style="color: var(--text-secondary); font-size: 0.8rem; margin-bottom: 8px;">待客户提交凭证</div>
          <div style="font-size: 1.8rem; font-weight: 700;">${awaitingTransferCount}</div>
        </div>
        <div class="panel" style="padding: 18px; background: linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%); border: 1px solid #a7f3d0;">
          <div style="color: var(--text-secondary); font-size: 0.8rem; margin-bottom: 8px;">已入账金额</div>
          <div style="font-size: 1.6rem; font-weight: 700;">${formatCurrency(paidAmount)}</div>
        </div>
      </div>

      <div class="panel" style="margin: 20px 0; background: #f8fafc; border: 1px solid var(--border);">
        <form method="GET" action="/admin/orders/balance-topups" style="display: flex; flex-wrap: wrap; gap: 12px; align-items: end;">
          <div style="flex: 1 1 180px; min-width: 180px;">
            <label for="status" style="display: block; margin-bottom: 6px; font-weight: 600; color: var(--text-secondary);">状态筛选</label>
            <select id="status" name="status" class="form-control" style="width: 100%;">
              ${Object.entries(TOPUP_STATUS_MAP).filter(([value]) => value !== 'rejected').map(([value, meta]) => `
                <option value="${value}" ${statusFilter === value ? 'selected' : ''}>${meta.text}</option>
              `).join('')}
            </select>
          </div>

          <div style="flex: 1 1 200px; min-width: 200px;">
            <label for="userId" style="display: block; margin-bottom: 6px; font-weight: 600; color: var(--text-secondary);">客户筛选</label>
            <select id="userId" name="userId" class="form-control" style="width: 100%;">
              <option value="">全部客户</option>
              ${customerOptions.map((u: any) => `
                <option value="${u.id}" ${userIdFilter === u.id ? 'selected' : ''}>${u.name}</option>
              `).join('')}
            </select>
          </div>

          <div style="flex: 1 1 160px; min-width: 160px;">
            <label for="dateFrom" style="display: block; margin-bottom: 6px; font-weight: 600; color: var(--text-secondary);">开始日期</label>
            <input id="dateFrom" type="date" name="dateFrom" class="form-control" value="${dateFrom}" style="width: 100%;" />
          </div>

          <div style="flex: 1 1 160px; min-width: 160px;">
            <label for="dateTo" style="display: block; margin-bottom: 6px; font-weight: 600; color: var(--text-secondary);">结束日期</label>
            <input id="dateTo" type="date" name="dateTo" class="form-control" value="${dateTo}" style="width: 100%;" />
          </div>

          <div style="flex: 1 1 220px; min-width: 220px;">
            <label for="search" style="display: block; margin-bottom: 6px; font-weight: 600; color: var(--text-secondary);">搜索</label>
            <input id="search" type="text" name="search" class="form-control" placeholder="客户、Reference..." value="${searchTerm}" style="width: 100%;" />
          </div>

          <div style="display: flex; gap: 8px; align-items: center; margin-top: auto;">
            <button type="submit" class="button button-primary">筛选</button>
            <a href="/admin/orders/balance-topups" class="button button-secondary">重置</a>
          </div>
        </form>
      </div>

      ${totalCount === 0 ? `
        <div style="text-align: center; padding: 48px 24px; color: var(--text-secondary);">
          <h3>暂无充值记录</h3>
          <p>没有符合筛选条件的余额充值订单</p>
        </div>
      ` : `
      <div style="margin-bottom: 12px; color: var(--text-secondary); font-size: 0.9rem;">
        共 ${totalCount} 条充值订单
        ${totalCount > 200 ? ' · 仅显示最近 200 条，请使用筛选条件缩小范围查看其余记录' : ''}
      </div>
      <table>
        <thead>
          <tr>
            <th>充值单号</th>
            <th>客户</th>
            <th>金额</th>
            <th>支付方式</th>
            <th>状态</th>
            <th>转账备注码</th>
            <th>Reference</th>
            <th>提交时间</th>
            <th>管理</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((topup: any) => {
    const status = TOPUP_STATUS_MAP[topup.status] || { text: topup.status, class: 'badge-info' };
    const method = TOPUP_METHOD_MAP[topup.payment_method] || topup.payment_method;
    return `
            <tr>
              <td style="font-family: monospace;">${topup.id}</td>
              <td>
                <div><strong>${topup.customer_name || '未知用户'}</strong></div>
                <small style="color: var(--text-secondary);">${topup.customer_email || ''}</small>
              </td>
              <td><strong>${formatCurrency(topup.amount)}</strong>${topup.cny_amount ? `<div style="color: var(--text-secondary); font-size: 0.8rem;">CNY ${Number(topup.cny_amount).toFixed(2)}</div>` : ''}</td>
              <td>${method}</td>
              <td><span class="badge ${status.class}">${status.text}</span></td>
              <td class="mono">${escapeHtml(topup.transfer_code || '—')}</td>
              <td>${topup.reference ? `<span class="mono">${topup.reference}</span>${topup.proof_image_url ? `<div><a href="${topup.proof_image_url}" target="_blank" rel="noopener noreferrer">查看凭证</a></div>` : ''}` : '-'}</td>
              <td>${topup.created_at ? formatMelbourneDate(topup.created_at) : '-'}</td>
              <td>
                ${topup.status === 'submitted' ? `
                <div style="display: flex; flex-direction: column; gap: 8px; min-width: 140px;">
                  <form method="post" action="/admin/balance-topups/${encodeURIComponent(topup.id)}/approve" data-site-confirm="通过后这笔充值会立即记入客户余额。请先核对付款 Reference 与到账金额。" data-confirm-variant="danger" data-confirm-title="确认充值入账？" data-confirm-label="通过并入账">
                    <input type="hidden" name="redirect" value="${redirectTarget}" />
                    <button type="submit" class="button button-sm button-primary" style="width: 100%;">通过并入账</button>
                  </form>
                  <form method="post" action="/admin/balance-topups/${encodeURIComponent(topup.id)}/reject" data-site-confirm="确认驳回这笔充值吗？驳回后客户需要重新提交付款凭证。" data-confirm-variant="danger" data-confirm-title="驳回充值？" data-confirm-label="驳回充值">
                    <input type="hidden" name="redirect" value="${redirectTarget}" />
                    <button type="submit" class="button button-sm button-danger" style="width: 100%;">驳回</button>
                  </form>
                </div>
                ` : '-'}
              </td>
            </tr>
            `;
  }).join('')}
        </tbody>
      </table>
      `}
    </div>
  `;

  return buildLayout('余额充值订单 - 电脑租赁管理系统', body, user);
}
