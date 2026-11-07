/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

import { buildLayout, formatCurrency } from '../../site';
import type { AdminDashboardData } from '../../services/adminDashboard';
import { escapeHtml } from '../../lib/html';

export function renderAdminDashboard(
  user: any,
  data: AdminDashboardData,
  opsCounts?: { failedPayments: number; failedCommands: number; pendingDamage: number }
) {
  const { stats, recentOrders, recentDevices } = data

  const statusMap: Record<string, { text: string; class: string }> = {
    'pending_approval': { text: '待审核', class: 'badge-warning' },
    'pending_payment': { text: '待支付', class: 'badge-warning' },
    'approved': { text: '已审核', class: 'badge-info' },
    'paid': { text: '已支付', class: 'badge-primary' },
    'pending_pickup': { text: '待取货', class: 'badge-info' },
    'active': { text: '租赁中', class: 'badge-primary' },
    'extended': { text: '已延期（租赁中）', class: 'badge-primary' },
    'overdue': { text: '已逾期', class: 'badge-danger' },
    'suspended': { text: '已暂停', class: 'badge-warning' },
    'pending_return': { text: '待归还', class: 'badge-info' },
    'returned': { text: '已归还', class: 'badge-info' },
    'completed': { text: '已完成', class: 'badge-success' },
    'cancelled': { text: '已取消', class: 'badge-danger' }
  }

  const deviceStatusMap: Record<string, { text: string; class: string }> = {
    'available': { text: '可用', class: 'badge-success' },
    'rented': { text: '已出租', class: 'badge-primary' },
    'maintenance': { text: '维护中', class: 'badge-warning' },
    'retired': { text: '已退役', class: 'badge-info' }
  }

  // 遗留 status 字段把「已归还待验收」也归并成 'rented'，导致设备显示已出租但无当前租用者。
  // 这里用更细的 lifecycle_status 覆盖显示，不影响 status 本身（预约新单仍以 status === 'available' 为准）。
  const lifecycleStatusMap: Record<string, { text: string; class: string }> = {
    'RETURNED': { text: '已归还待验收', class: 'badge-warning' },
    'INSPECTION': { text: '归还验机中', class: 'badge-warning' },
    'RESERVED': { text: '已预约', class: 'badge-info' },
  }

  // 控制台信息顺序：摘要（现在怎么样）→ 待办（我该做什么）→ 明细。
  const attention: Array<{ title: string; meta: string; href: string; tone?: 'alert' | 'warn' }> = []
  const addAttention = (count: number, title: string, href: string, tone?: 'alert' | 'warn') => {
    if (!count) return
    attention.push({ title, meta: `${count} 项`, href, tone })
  }
  addAttention(stats.overdueRentals, '逾期未归还', '/admin/orders?status=active', 'alert')
  addAttention(stats.pendingOrders, '待审核订单', '/admin/order-review', 'warn')
  addAttention(opsCounts?.pendingDamage || 0, '待验收损坏记录', '/admin/inspections', 'warn')
  addAttention(stats.pendingDeposits, '待结算押金', '/admin/refunds', 'warn')
  addAttention(opsCounts?.failedPayments || 0, '近 7 日失败付款', '/admin/orders?status=pending_payment', 'warn')
  addAttention(opsCounts?.failedCommands || 0, '失败的远程命令', '/admin/exceptions', 'warn')
  addAttention(stats.maintenanceDevices + stats.damagedDevices, '维修与损坏设备', '/admin/devices', 'warn')

  const today = new Date().toLocaleDateString('zh-CN', { timeZone: 'Australia/Melbourne', month: 'long', day: 'numeric', weekday: 'long' })
  const body = `
    <div class="hero">
      <h2>${escapeHtml(user.name)}，这是今天的经营概况</h2>
      <p>${today} · 取货 ${stats.todayPickups} · 归还 ${stats.todayReturns}${attention.length ? ` · 待处理 ${attention.length} 类` : ''}</p>
    </div>
    <section class="summary" aria-label="经营摘要">
      <div class="summary__lead">
        <span class="summary__eyebrow">已确认收入 / REVENUE</span>
        <div class="summary__figure">${formatCurrency(stats.totalRevenue)}</div>
        <p class="summary__note">在途 <strong>${formatCurrency(stats.onTheWayRevenue)}</strong></p>
      </div>
      <div class="summary__aside">
        <a class="summary__cell" href="/admin/orders?status=active">
          <h3>进行中租赁</h3>
          <div class="value">${stats.activeRentals}<span class="unit">笔</span></div>
          <div class="trend">今日到期 ${stats.todayReturns} 笔</div>
        </a>
        <a class="summary__cell ${stats.pendingOrders ? 'is-attention' : ''}" href="/admin/order-review">
          <h3>待处理订单</h3>
          <div class="value">${stats.pendingOrders}<span class="unit">笔</span></div>
          <div class="trend">待审核 + 待支付</div>
        </a>
        <a class="summary__cell ${stats.utilizationRate >= 70 ? 'is-good' : ''}" href="/admin/devices">
          <h3>设备利用率</h3>
          <div class="value">${stats.utilizationRate}<span class="unit">%</span></div>
          <div class="trend">可租 ${stats.availableDevices}/${stats.totalDevices} · 闲置 ${stats.idleDevices}</div>
        </a>
        <a class="summary__cell ${stats.overdueRentals ? 'is-danger' : ''}" href="/admin/orders?status=active">
          <h3>逾期未还</h3>
          <div class="value">${stats.overdueRentals}<span class="unit">笔</span></div>
          <div class="trend">${stats.overdueRentals ? '今日跟进' : '暂无'}</div>
        </a>
        <a class="summary__cell" href="/admin/calendar">
          <h3>待取货</h3>
          <div class="value">${stats.awaitingPickup}<span class="unit">笔</span></div>
          <div class="trend">已确认，未开始</div>
        </a>
        <a class="summary__cell" href="/admin/users">
          <h3>客户</h3>
          <div class="value">${stats.totalUsers}<span class="unit">人</span></div>
          <div class="trend">有效账户</div>
        </a>
      </div>
    </section>
    ${attention.length ? `
    <section class="attention" aria-labelledby="attention-title">
      <div class="attention__head"><h3 id="attention-title">需要你处理</h3><span>共 ${attention.length} 类</span></div>
      <ol>${attention.map(item => `<li><a href="${item.href}"><span class="attention__title">${escapeHtml(item.title)}</span><span class="attention__meta ${item.tone === 'alert' ? 'is-alert' : 'is-warn'}">${escapeHtml(item.meta)} ›</span></a></li>`).join('')}</ol>
    </section>` : `
    <section class="attention">
      <div class="attention__head"><h3>需要你处理</h3><span>暂无</span></div>
    </section>`}
    <div class="section-title"><h3>今日运营</h3></div>
    <div class="stats-grid">
      <div class="stat-card primary">
        <h3>总收入</h3>
        <div class="value">${formatCurrency(stats.totalRevenue)}</div>
        
      </div>
      <div class="stat-card success">
        <h3>活跃租赁</h3>
        <div class="value">${stats.activeRentals} 笔</div>
        
      </div>
      <div class="stat-card warning">
        <h3>待处理订单</h3>
        <div class="value">${stats.pendingOrders} 笔</div>
        
      </div>
      <div class="stat-card info">
        <h3>可用设备</h3>
        <div class="value">${stats.availableDevices}/${stats.totalDevices}</div>
        
      </div>
      <div class="stat-card">
        <h3>注册用户</h3>
        <div class="value">${stats.totalUsers} 人</div>
        
      </div>
    </div>
    <div class="section-title" style="margin-top:24px"><h3>今日运营</h3></div>
    <div class="stats-grid">
      <div class="stat-card"><h3>今日取货</h3><div class="value">${stats.todayPickups}</div></div>
      <div class="stat-card"><h3>今日归还</h3><div class="value">${stats.todayReturns}</div></div>
      <div class="stat-card ${stats.overdueRentals ? 'warning' : ''}"><h3>逾期租赁</h3><div class="value">${stats.overdueRentals}</div></div>
      <div class="stat-card ${stats.pendingDeposits ? 'warning' : ''}"><h3>待结算押金</h3><div class="value">${stats.pendingDeposits}</div></div>
      <div class="stat-card"><h3>预留设备</h3><div class="value">${stats.reservedDevices}</div></div>
      <div class="stat-card ${stats.maintenanceDevices ? 'warning' : ''}"><h3>维护中设备</h3><div class="value">${stats.maintenanceDevices}</div></div>
      <div class="stat-card ${stats.damagedDevices ? 'warning' : ''}"><h3>损坏设备</h3><div class="value">${stats.damagedDevices}</div></div>
      <div class="stat-card ${opsCounts?.failedPayments ? 'warning' : ''}"><h3>近7日失败付款</h3><div class="value">${opsCounts?.failedPayments ?? '-'}</div></div>
      <div class="stat-card ${opsCounts?.failedCommands ? 'warning' : ''}"><h3>近7日失败远程命令</h3><div class="value">${opsCounts?.failedCommands ?? '-'}</div></div>
      <div class="stat-card ${opsCounts?.pendingDamage ? 'warning' : ''}"><h3>待处理损坏记录</h3><div class="value">${opsCounts?.pendingDamage ?? '-'}</div></div>
    </div>
    <div class="panel">
      <div class="section-title">
        <h3>最新订单</h3>
        
      </div>
      ${recentOrders.length === 0 ? `
        <p class="empty-state">还没有订单。审核网站订单或手动添加。</p>
      ` : `
      <table><thead><tr><th>订单号</th><th>客户</th><th>设备</th><th>金额</th><th>状态</th><th>操作</th></tr></thead><tbody>
        ${recentOrders.map((order) => {
    const status = statusMap[order.status] || { text: order.status, class: 'badge-info' }
    return `<tr><td style="font-family: monospace;">${order.id}</td><td>${order.customerName ?? '未知用户'}</td><td>${order.deviceName ?? '未知设备'}</td><td>${formatCurrency(order.totalAmount)}</td><td><span class="badge ${status.class}">${status.text}</span></td><td><a class="link-button" href="/admin/orders/${order.id}">查看详情</a></td></tr>`
  }).join('')}
      </tbody></table>
      `}
    </div>
    <div class="panel">
      <div class="section-title">
        <h3>设备概览</h3>
        
      </div>
      ${recentDevices.length === 0 ? `
        <p class="empty-state">还没有设备。先添加入库设备。</p>
      ` : `
      <table><thead><tr><th>设备名称</th><th>型号</th><th>状态</th><th>当前租用者</th><th>操作</th></tr></thead><tbody>
        ${recentDevices.map((device) => {
    const deviceStatus = lifecycleStatusMap[device.lifecycleStatus || ''] || deviceStatusMap[device.status] || { text: device.status, class: 'badge-info' }
    // 归还后待验收/验机中的设备，「去验收」直接指向独立的一键验收页（单表单，
    // 提交一次即可），而不是之前那个跟具体设备无关的绑定列表页或多步骤的详细流程。
    const needsAcceptance = device.lifecycleStatus === 'RETURNED' || device.lifecycleStatus === 'INSPECTION'
    const controlHref = needsAcceptance ? `/admin/devices/${encodeURIComponent(device.id)}/accept` : `/admin/devices/${encodeURIComponent(device.id)}/control`
    const controlLabel = needsAcceptance ? '去验收' : '远程操作'
    return `<tr><td><strong>${escapeHtml(device.name)}</strong></td><td>${escapeHtml(device.model) || '-'}</td><td><span class="badge ${deviceStatus.class}">${deviceStatus.text}</span></td><td>${escapeHtml(device.customerName) || '无'}</td><td><a class="link-button" data-full-navigation="true" href="/admin/devices/${encodeURIComponent(device.id)}/edit">编辑</a> <a class="link-button" data-full-navigation="true" href="${controlHref}">${controlLabel}</a></td></tr>`
  }).join('')}
      </tbody></table>
      `}
    </div>
  `;
  return buildLayout('管理员仪表盘 - 电脑租赁管理系统', body, user);
}
