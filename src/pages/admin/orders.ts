/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

import { buildLayout, getDB, formatCurrency, formatMelbourneDate } from '../../site';
import { Context } from 'hono';
import { renderOrderStatusFeedback } from './orderStatusFeedback';
import { escapeHtml } from '../../lib/html';

// The order list has server-side pagination; cap how many rows we ever
// render in one page load so the table stays usable as order volume grows.
// Stats above the table (counts, revenue) are computed from the full filtered
// set (via a separate aggregate query) before this cap is applied, so they
// stay accurate.
const ORDER_LIST_PAGE_SIZE = 200

export const adminOrderStatusMap: Record<string, { text: string; class: string }> = {
  all: { text: '全部', class: 'badge-info' },
  draft: { text: '待签约', class: 'badge-warning' },
  pending_approval: { text: '待审核', class: 'badge-warning' },
  pending_payment: { text: '待支付', class: 'badge-warning' },
  approved: { text: '已审核', class: 'badge-info' },
  paid: { text: '已确认', class: 'badge-primary' },
  pending_pickup: { text: '待取货', class: 'badge-warning' },
  active: { text: '租赁中', class: 'badge-primary' },
  completed: { text: '已完成', class: 'badge-success' },
  cancelled: { text: '已取消', class: 'badge-danger' }
};

// 批量更新只开放服务端 /admin/orders/bulk-update 实际接受的两种状态。
// 两边必须保持一致：以前界面还列了「待支付 / 已支付 / 租赁中」，但服务端只接受
// suspended/cancelled，选中那些状态会被静默丢弃（无提示地什么都不发生）。
// 完成订单必须逐笔走归还验机，因此不出现在批量选项里。
export const BULK_STATUS_OPTIONS: ReadonlyArray<readonly [string, string]> = [
  ['cancelled', '已取消'],
  ['suspended', '已暂停'],
]

const STATUS_ALIASES: Record<string, string> = { pending: 'pending_payment', in_progress: 'active', complete: 'completed', canceled: 'cancelled' }

type AdminOrderFilters = {
  userId?: string;
  status?: string;
  search?: string;
  dateFrom?: string;
  dateTo?: string;
}

function normalizeAdminOrderFilters(filters?: AdminOrderFilters) {
  const userIdFilter = (filters?.userId || '').trim();
  const rawStatusFilter = String(filters?.status || 'all').trim().toLowerCase().replace(/[-\s]+/g, '_');
  const statusFilter = STATUS_ALIASES[rawStatusFilter] || rawStatusFilter;
  const searchTerm = (filters?.search || '').trim();
  const dateFrom = (filters?.dateFrom || '').trim();
  const dateTo = (filters?.dateTo || '').trim();
  return { userIdFilter, statusFilter, searchTerm, dateFrom, dateTo };
}

// Builds the shared WHERE clause (+ bound params) used by both the paginated
// row query and the aggregate stats query, so the two stay consistent.
function buildAdminOrderWhere(filters?: AdminOrderFilters) {
  const { userIdFilter, statusFilter, searchTerm, dateFrom, dateTo } = normalizeAdminOrderFilters(filters);
  const clauses: string[] = ['o.deleted_at IS NULL'];
  const params: any[] = [];

  if (userIdFilter) {
    clauses.push('o.userId = ?');
    params.push(userIdFilter);
  }

  if (statusFilter !== 'all') {
    clauses.push("REPLACE(REPLACE(LOWER(o.status), '-', '_'), ' ', '_') = ?");
    params.push(statusFilter);
  }

  if (searchTerm) {
    const escaped = searchTerm.toLowerCase().replace(/[\\%_]/g, (m) => `\\${m}`);
    const like = `%${escaped}%`;
    clauses.push(`(
      LOWER(o.id) LIKE ? ESCAPE '\\'
      OR LOWER(o.orderNo) LIKE ? ESCAPE '\\'
      OR LOWER(u.name) LIKE ? ESCAPE '\\'
      OR LOWER(u.email) LIKE ? ESCAPE '\\'
      OR LOWER(d.name) LIKE ? ESCAPE '\\'
      OR LOWER(d.brand) LIKE ? ESCAPE '\\'
      OR LOWER(d.model) LIKE ? ESCAPE '\\'
    )`);
    params.push(like, like, like, like, like, like, like);
  }

  if (dateFrom) {
    clauses.push("datetime(COALESCE(o.createdAt, '2020-01-01T00:00:00.000Z')) >= datetime(?)");
    params.push(`${dateFrom}T00:00:00`);
  }

  if (dateTo) {
    clauses.push("datetime(COALESCE(o.createdAt, '2020-01-01T00:00:00.000Z')) <= datetime(?)");
    params.push(`${dateTo}T23:59:59`);
  }

  return { whereSql: clauses.join(' AND '), params };
}

function mapAdminOrderRow(row: any) {
  const { customerName, customerEmail, customerAccountType, deviceName, deviceBrand, deviceModel, ...order } = row;
  return {
    ...order,
    customer: order.userId ? { name: customerName, email: customerEmail, accountType: customerAccountType } : null,
    device: order.deviceId ? { name: deviceName, brand: deviceBrand, model: deviceModel } : null,
  };
}

const ADMIN_ORDER_JOIN_SQL = `
  FROM orders o
  LEFT JOIN users u ON u.id = o.userId
  LEFT JOIN devices d ON d.id = o.deviceId
`

export async function getFilteredAdminOrders(
  c: Context,
  filters?: AdminOrderFilters,
  pagination?: { limit: number; offset: number }
) {
  const db = getDB(c);
  const { whereSql, params } = buildAdminOrderWhere(filters);

  let sql = `
    SELECT o.*, u.name AS customerName, u.email AS customerEmail, u.account_type AS customerAccountType,
           d.name AS deviceName, d.brand AS deviceBrand, d.model AS deviceModel
    ${ADMIN_ORDER_JOIN_SQL}
    WHERE ${whereSql}
    ORDER BY o.createdAt DESC
  `;
  const bindParams = [...params];
  if (pagination) {
    sql += ' LIMIT ? OFFSET ?';
    bindParams.push(pagination.limit, pagination.offset);
  }

  const result = await db.prepare(sql).bind(...bindParams).all();
  return ((result.results || []) as any[]).map(mapAdminOrderRow);
}

export async function getAdminOrderStats(c: Context, filters?: AdminOrderFilters) {
  const db = getDB(c);
  const { whereSql, params } = buildAdminOrderWhere(filters);
  const sql = `
    SELECT
      COUNT(*) AS total,
      COALESCE(SUM((SELECT COALESCE(SUM(p.rental_amount), 0) FROM payments p WHERE p.rental_id = o.id AND p.status IN ('paid', 'refunded'))), 0) AS revenue,
      SUM(CASE WHEN o.status IN ('pending_approval', 'pending_payment', 'approved') THEN 1 ELSE 0 END) AS pendingCount,
      SUM(CASE WHEN o.status IN ('paid', 'active') THEN 1 ELSE 0 END) AS activeCount,
      SUM(CASE WHEN o.status = 'completed' THEN 1 ELSE 0 END) AS completedCount
    ${ADMIN_ORDER_JOIN_SQL}
    WHERE ${whereSql}
  `;
  const row = await db.prepare(sql).bind(...params).first() as any;
  return {
    total: Number(row?.total || 0),
    revenue: Number(row?.revenue || 0),
    pendingCount: Number(row?.pendingCount || 0),
    activeCount: Number(row?.activeCount || 0),
    completedCount: Number(row?.completedCount || 0),
  };
}

export async function renderAdminOrders(c: Context, user: any) {
  const url = new URL(c.req.url);
  const userIdFilter = url.searchParams.get('userId') || '';
  const statusFilter = url.searchParams.get('status') || 'all';
  const searchTerm = (url.searchParams.get('search') || '').trim();
  const dateFrom = (url.searchParams.get('dateFrom') || '').trim();
  const dateTo = (url.searchParams.get('dateTo') || '').trim();

  const errorMessage = url.searchParams.get('error')?.trim() || '';
  const successMessage = url.searchParams.get('success')?.trim() || '';
  const orderFilters = {
    userId: userIdFilter,
    status: statusFilter,
    search: searchTerm,
    dateFrom,
    dateTo,
  };
  const db = getDB(c);
  const [customerOptionsResult, pageOrders, stats] = await Promise.all([
    db.prepare("SELECT id, name FROM users WHERE role = 'CUSTOMER' ORDER BY name").all(),
    getFilteredAdminOrders(c, orderFilters, { limit: ORDER_LIST_PAGE_SIZE, offset: 0 }),
    getAdminOrderStats(c, orderFilters),
  ]);
  const customerOptions = (customerOptionsResult.results || []) as any[];

  const exportQuery = new URLSearchParams({
    ...(userIdFilter ? { userId: userIdFilter } : {}),
    ...(statusFilter && statusFilter !== 'all' ? { status: statusFilter } : {}),
    ...(searchTerm ? { search: searchTerm } : {}),
    ...(dateFrom ? { dateFrom } : {}),
    ...(dateTo ? { dateTo } : {}),
  }).toString();

  const totalOrderCount = stats.total;
  const totalRevenue = stats.revenue;
  const pendingCount = stats.pendingCount;
  const activeCount = stats.activeCount;
  const completedCount = stats.completedCount;

  const orderTabs=`<nav class="filter-tabs" aria-label="订单筛选">${[['','全部订单'],['pending_approval','待审核'],['approved','已审核'],['pending_payment','待付款'],['pending_pickup','待取货'],['active','租赁中'],['completed','已完成'],['cancelled','已取消']].map(([value,label])=>`<a class="button ${(statusFilter==='all'?'':statusFilter)===value?'button-primary':'button-secondary'}" href="/admin/orders${value?'?status='+value:''}">${label}</a>`).join('')}</nav>`
  const body = `${orderTabs}
    <div class="panel">
      <div class="section-title">
        <div>
          <h2>订单管理</h2>
          <span class="section-note">查看和管理系统中的所有订单。</span>
        </div>
        <div style="display: flex; gap: 8px; flex-wrap: wrap;">
          <a href="/admin/orders/new" class="button button-primary">手动添加订单</a>
          <a href="/admin/rental-links" class="button button-secondary">自助租赁链接</a>
          <a href="/admin/orders/balance-topups" class="button button-secondary">余额充值订单</a>
          <a href="/admin/orders/export${exportQuery ? `?${exportQuery}` : ''}" class="button button-secondary" download>导出 CSV</a>
        </div>
      </div>

      ${successMessage ? `<div data-flash-notice class="page-notification page-notification--success">${successMessage}</div>` : ''}
      ${errorMessage ? `<div data-flash-notice class="page-notification page-notification--error">${errorMessage}</div>` : ''}

      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 16px; margin: 20px 0;">
        <div class="panel" style="padding: 18px; background: linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%); border: 1px solid #bfdbfe;">
          <div style="color: var(--text-secondary); font-size: 0.8rem; margin-bottom: 8px;">总订单</div>
          <div style="font-size: 1.8rem; font-weight: 700;">${totalOrderCount}</div>
        </div>
        <div class="panel" style="padding: 18px; background: linear-gradient(135deg, #fff7ed 0%, #ffedd5 100%); border: 1px solid #fed7aa;">
          <div style="color: var(--text-secondary); font-size: 0.8rem; margin-bottom: 8px;">待处理</div>
          <div style="font-size: 1.8rem; font-weight: 700;">${pendingCount}</div>
        </div>
        <div class="panel" style="padding: 18px; background: linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%); border: 1px solid #a7f3d0;">
          <div style="color: var(--text-secondary); font-size: 0.8rem; margin-bottom: 8px;">已完成</div>
          <div style="font-size: 1.8rem; font-weight: 700;">${completedCount}</div>
        </div>
        <div class="panel" style="padding: 18px; background: linear-gradient(135deg, #f5f3ff 0%, #ede9fe 100%); border: 1px solid #ddd6fe;">
          <div style="color: var(--text-secondary); font-size: 0.8rem; margin-bottom: 8px;">已收租金</div>
          <div style="font-size: 1.6rem; font-weight: 700;">${formatCurrency(totalRevenue)}</div>
        </div>
      </div>
      <div class="panel" style="margin: 20px 0; background: #f8fafc; border: 1px solid var(--border);">
        <form method="GET" action="/admin/orders" style="display: flex; flex-wrap: wrap; gap: 12px; align-items: end;">
          <div style="flex: 1 1 180px; min-width: 180px;">
            <label for="status" style="display: block; margin-bottom: 6px; font-weight: 600; color: var(--text-secondary);">状态筛选</label>
            <select id="status" name="status" class="form-control" style="width: 100%;">
              ${Object.entries(adminOrderStatusMap).map(([value, meta]) => `
                <option value="${value}" ${statusFilter === value ? 'selected' : ''}>${meta.text}</option>
              `).join('')}
            </select>
          </div>

          <div style="flex: 1 1 200px; min-width: 200px;">
            <label for="userId" style="display: block; margin-bottom: 6px; font-weight: 600; color: var(--text-secondary);">客户筛选</label>
            <select id="userId" name="userId" class="form-control" style="width: 100%;">
              <option value="">全部客户</option>
              ${customerOptions.map((u: any) => `
                <option value="${u.id}" ${userIdFilter === u.id ? 'selected' : ''}>${escapeHtml(u.name)}</option>
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
            <input id="search" type="text" name="search" class="form-control" placeholder="订单号、客户、设备..." value="${searchTerm}" style="width: 100%;" />
          </div>

          <div style="display: flex; gap: 8px; align-items: center; margin-top: auto;">
            <button type="submit" class="button button-primary">筛选</button>
            <a href="/admin/orders" class="button button-secondary">重置</a>
          </div>
        </form>
      </div>

      ${totalOrderCount === 0 ? `
        <div style="text-align: center; padding: 48px 24px; color: var(--text-secondary);">
          <h3>暂无订单</h3>
          <p>${userIdFilter ? '当前用户暂无相关订单记录' : '没有符合筛选条件的订单记录'}</p>
        </div>
      ` : `
      <div style="margin-bottom: 12px; color: var(--text-secondary); font-size: 0.9rem;">
        共 ${totalOrderCount} 条订单
        ${userIdFilter ? ' · 当前查看用户关联订单' : ''}
        ${totalOrderCount > ORDER_LIST_PAGE_SIZE ? ` · 仅显示最近 ${ORDER_LIST_PAGE_SIZE} 条，请使用筛选条件缩小范围查看其余订单` : ''}
      </div>
      <form id="bulk-order-form" method="POST" action="/admin/orders/bulk-update" data-site-confirm="确认批量更新所选订单的状态？状态变更会通知客户，取消类操作不可恢复。" data-confirm-title="批量更新订单状态？" data-confirm-label="确认更新">
        <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 12px; flex-wrap: wrap;">
          <label style="display: inline-flex; align-items: center; gap: 8px; margin: 0;">
            <input type="checkbox" id="select-all-orders" />
            <span>全选</span>
          </label>
          <select name="status" id="bulk-status-select" class="form-control" style="min-width: 150px; padding: 8px 12px;">
            <option value="">批量更新状态</option>
            ${BULK_STATUS_OPTIONS.map(([value, label]) => `<option value="${value}">${label}</option>`).join('')}
          </select>
          <input type="text" name="reason" id="bulk-status-reason" class="form-control" maxlength="300" placeholder="原因（必填，随通知发送给客户）" style="min-width: 280px; padding: 8px 12px;" hidden />
          <button type="submit" class="button button-primary" style="padding: 8px 16px;">批量更新</button>
        </div>
      </form>
      <script>(function(){
        var select = document.getElementById('bulk-status-select');
        var reason = document.getElementById('bulk-status-reason');
        if (!select || !reason) return;
        function sync() {
          var needsReason = select.value !== '';
          reason.hidden = !needsReason;
          reason.required = needsReason;
        }
        select.addEventListener('change', sync);
        sync();
      })();</script>
        <table>
          <thead>
            <tr>
              <th style="width: 40px;"></th>
              <th>订单号</th>
              <th>客户</th>
              <th>设备</th>
              <th>总金额</th>
              <th>状态</th>
              <th>租期</th>
              <th>下单日期</th>
              <th>管理</th>
            </tr>
          </thead>
          <tbody>
            ${pageOrders.map((order: any) => {
    const status = adminOrderStatusMap[order.status] || { text: order.status, class: 'badge-info' };
    // “已完成”只代表设备已归还，押金没结清时不能看起来像什么都办完了——
    // 单独加一个徽章而不是把它塞进 status 本身，避免影响其它按 status 过滤/统计的逻辑。
    const settlementPending = order.status === 'completed' && order.settlement_status === 'PENDING';
    const totalAmount = order.total_amount || order.totalAmount || 0;
    const startDate = order.start_date || order.startDate || '-';
    const endDate = order.end_date || order.endDate || '-';
    const createdAt = order.created_at || order.createdAt;
    return `
                <tr>
                  <td><input type="checkbox" name="orderIds" value="${order.id}" class="order-checkbox" form="bulk-order-form" /></td>
                  <td style="font-family: monospace;">${order.orderNo || order.id}${order.is_manual === 1 ? '<br><span class="badge badge-info">手动订单</span>' : order.rental_link_id ? '<br><span class="badge badge-info">自助租赁</span>' : ''}</td>
                  <td>
                    <div><strong>${escapeHtml(order.customer?.name) || (order.is_manual === 1 ? '未关联客户' : '未知用户')}</strong>${order.customer?.accountType === 'guest' ? ' <span class="badge badge-warning">访客/临时账户</span>' : ''}</div>
                    <small style="color: var(--text-secondary);">${escapeHtml(order.customer?.email)}</small>
                  </td>
                  <td>${escapeHtml(order.device?.name) || '未知设备'}</td>
                  <td><strong>${formatCurrency(totalAmount)}</strong></td>
                  <td><span class="badge ${status.class}">${status.text}</span>${settlementPending ? ' <span class="badge badge-warning" title="押金尚未结清，不能视为完全办结">押金待结算</span>' : ''}</td>
                  <td>${startDate} ~ ${endDate}</td>
                  <td>${createdAt ? formatMelbourneDate(createdAt) : '-'}</td>
                  <td>
                    <div style="display: flex; flex-direction: column; gap: 8px; min-width: 160px;">
                      ${!['completed', 'cancelled'].includes(String(order.status)) ? `<form method="POST" action="/admin/orders/${order.id}/update" class="js-order-status-form" style="display: flex; gap: 8px; align-items: center;">
                        <select name="status" class="form-control" style="min-width: 110px; padding: 6px 10px; font-size: 0.85rem;">
                          ${order.status === 'suspended' ? '<option value="active">恢复租赁</option>' : '<option value="suspended">暂停租赁（仅管理员）</option>'}
                          <option value="cancelled">已取消</option>
                        </select>
                        <button type="submit" class="button button-secondary" style="padding: 6px 10px; font-size: 0.8rem;">更新</button>
                      </form>` : ''}
                      <a class="link-button" href="/admin/orders/${order.id}">查看详情</a>
                    </div>
                  </td>
                </tr>
              `;
  }).join('')}
          </tbody>
        </table>
      `}
    </div>
  `;

  const selectAllScript = `
    <script>
      document.addEventListener('DOMContentLoaded', function () {
        const selectAll = document.getElementById('select-all-orders');
        const checkboxes = Array.from(document.querySelectorAll('.order-checkbox'));
        if (selectAll) {
          selectAll.addEventListener('change', function () {
            checkboxes.forEach((checkbox) => {
              checkbox.checked = selectAll.checked;
            });
          });
        }
      });
    </script>
  `;

  return buildLayout('订单管理 - 电脑租赁管理系统', body + renderOrderStatusFeedback() + selectAllScript, user);
}
