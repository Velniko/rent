/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

import { clientPathEnabled, normalizeClientAccess } from '../../clientAccess'
import { buildLayout, formatCurrency, formatDate, sanitizePlainText } from '../../site';
import { escapeHtml } from '../../lib/html';
import { renderAnnouncementTitle, renderAnnouncementMessage } from '../../domain/announcement';

export function renderCustomerDashboard(user: any, allOrders: any[], devices: any[], announcementData: { items: any[], page: number, pageCount: number } = { items: [], page: 1, pageCount: 1 }) {
  const announcements = announcementData.items || []
  const orders = allOrders.filter(o => o.userId === user.id)
  const negativeBalance = Number(user.balance || 0) < 0
  const currentRentals = orders.filter((order) => order.status === 'active' || order.status === 'paid')
  const pendingPayment = orders.filter((order) => order.status === 'pending_payment').length
  const completedOrders = orders.filter((order) => order.status === 'completed').length
  const statusLabels: Record<string, string> = {
    active: '租赁中', paid: '租赁已确认，等待开始', approved: '租赁已确认，等待开始', pending_payment: '待付款',
    pending_approval: '待审核', completed: '已完成', cancelled: '已取消'
  }
  const getDaysUntil = (dateValue: unknown) => {
    const date = new Date(String(dateValue || ''))
    if (Number.isNaN(date.getTime())) return null
    return Math.ceil((date.getTime() - Date.now()) / 86400000)
  }
  const getDueText = (dateValue: unknown) => {
    const days = getDaysUntil(dateValue)
    if (days === null) return '请确认归还日期'
    if (days < 0) return `已逾期 ${Math.abs(days)} 天`
    if (days === 0) return '今天到期'
    if (days === 1) return '明天到期'
    return `${days} 天后到期`
  }

  // 客户首页：摘要（余额与在租）→ 待办 → 快捷操作与通知。
  const todo: Array<{ title: string; meta: string; href: string; tone?: 'alert' | 'warn' }> = []
  if (pendingPayment) todo.push({ title: '有待付款订单', meta: `${pendingPayment} 笔`, href: '/customer/orders?status=pending_payment', tone: 'warn' })
  if (negativeBalance && clientPathEnabled(user.clientAccess || normalizeClientAccess(null),'/customer/balance/top-up','console')) todo.push({ title: '余额为负，请充值', meta: formatCurrency(user.balance), href: '/customer/balance/top-up', tone: 'alert' })
  for (const rental of currentRentals) {
    const days = getDaysUntil(rental.endDate)
    if (days === null || days > 3) continue
    todo.push({
      title: `租赁 ${sanitizePlainText(rental.orderNo, 24)} ${days < 0 ? '已逾期' : days === 0 ? '今天到期' : days === 1 ? '明天到期' : `${days} 天后到期`}`,
      meta: formatDate(rental.endDate),
      href: '/customer/rentals',
      tone: days < 0 ? 'alert' : 'warn',
    })
  }

  const body = `
    <div class="hero">
      <h2>欢迎回来，${sanitizePlainText(user.name, 80)}</h2>
    </div>
    ${negativeBalance ? `<div class="page-notification page-notification--error"><strong>账户余额为负：${formatCurrency(user.balance)}</strong><p>请充值至非负余额，否则无法提交新订单。</p>${clientPathEnabled(user.clientAccess || normalizeClientAccess(null),'/customer/balance/top-up','console') ? `<a class="button button-sm button-primary" href="/customer/balance/top-up">立即充值</a>` : ''}</div>` : ''}
    <section class="summary" aria-label="账户摘要">
      <div class="summary__lead">
        <span class="summary__eyebrow">账户余额 / BALANCE</span>
        <div class="summary__figure">${formatCurrency(user.balance)}</div>
        <p class="summary__note">${negativeBalance ? '余额为负' : '可用余额'}</p>
      </div>
      <div class="summary__aside">
        <a class="summary__cell" href="/customer/rentals">
          <h3>当前租赁</h3>
          <div class="value">${currentRentals.length}<span class="unit">台</span></div>
          <div class="trend">使用中</div>
        </a>
        <a class="summary__cell ${pendingPayment ? 'is-attention' : ''}" href="/customer/orders?status=pending_payment">
          <h3>待付款</h3>
          <div class="value">${pendingPayment}<span class="unit">笔</span></div>
          <div class="trend">${pendingPayment ? '需要处理' : '暂无'}</div>
        </a>
        <a class="summary__cell" href="/customer/orders?status=completed">
          <h3>已完成</h3>
          <div class="value">${completedOrders}<span class="unit">笔</span></div>
          <div class="trend">历史订单</div>
        </a>
      </div>
    </section>
    ${todo.length ? `
    <section class="attention" aria-labelledby="customer-attention-title">
      <div class="attention__head"><h3 id="customer-attention-title">需要你处理</h3><span>共 ${todo.length} 项</span></div>
      <ol>${todo.map(item => `<li><a href="${item.href}"><span class="attention__title">${escapeHtml(item.title)}</span><span class="attention__meta ${item.tone === 'alert' ? 'is-alert' : 'is-warn'}">${escapeHtml(item.meta)} ›</span></a></li>`).join('')}</ol>
    </section>` : ''}
    <div class="grid grid-3">
      <div class="card quick-actions">
        <div class="quick-actions__heading"><div><h3>快捷操作</h3></div></div>
        <div class="quick-actions__list">
          ${clientPathEnabled(user.clientAccess || normalizeClientAccess(null),'/customer/devices','console') ? `<a class="quick-action" href="/customer/devices"><span class="quick-action__icon">⌘</span><span><strong>浏览可租设备</strong><small>查找下一台设备</small></span><b aria-hidden="true"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"></path></svg></b></a>` : ''}
          ${clientPathEnabled(user.clientAccess || normalizeClientAccess(null),'/customer/referral','console') ? `<a class="quick-action" href="/customer/referral"><span class="quick-action__icon">+</span><span><strong>邀请好友赚佣金</strong><small>分享你的推荐链接</small></span><b aria-hidden="true"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"></path></svg></b></a>` : ''}
          <a class="quick-action" href="/customer/profile"><span class="quick-action__icon">◎</span><span><strong>完善账户信息</strong><small>更新资料与联系方式</small></span><b aria-hidden="true"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"></path></svg></b></a>
          ${clientPathEnabled(user.clientAccess || normalizeClientAccess(null),'/feedback','console') ? `<a class="quick-action" href="/feedback"><span class="quick-action__icon">♥</span><span><strong>填写客户反馈</strong><small>完成问卷领取奖励</small></span><b aria-hidden="true"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"></path></svg></b></a>` : ''}
        </div>
      </div>
      <div class="card dashboard-announcements">
        <div class="section-title"><h3>历史通告</h3><a class="link-button" href="/notifications">通知中心 →</a></div>
        ${announcements.length ? `<div class="notification-list">${announcements.map(item => `<a class="dashboard-announcement" href="/notifications/${encodeURIComponent(item.id)}"><strong>${renderAnnouncementTitle(item)}</strong><span>${sanitizePlainText(item.created_at, 40)}</span><div class="announcement-preview">${renderAnnouncementMessage({ ...item, message: sanitizePlainText(item.message, 300), message_en: sanitizePlainText(item.message_en || item.message, 300) })}</div></a>`).join('')}</div>${announcementData.pageCount > 1 ? `<nav class="pagination" aria-label="历史通告分页">${Array.from({ length: announcementData.pageCount }, (_, index) => `<a class="button button-sm ${index + 1 === announcementData.page ? 'button-primary' : 'button-secondary'}" href="/customer/dashboard?announcementPage=${index + 1}">${index + 1}</a>`).join('')}</nav>` : ''}` : '<p class="empty-state">暂无通告</p>'}
      </div>
    </div>
    <div class="panel" style="margin-top: 20px;">
      <div class="section-title">
        <h2>我的订单</h2>
        <a class="link-button" href="/customer/orders">查看全部 →</a>
      </div>
      <table>
        <thead><tr><th>订单号</th><th>设备</th><th>租期</th><th>金额</th><th>状态</th><th>操作</th></tr></thead>
        <tbody>
        ${orders.slice(0, 5).map((order) => {
          const device = devices.find(d => d.id === order.deviceId)
          const statusMap: Record<string, string> = {
            'active': 'badge-success', 'paid': 'badge-info', 'approved': 'badge-info', 'pending_payment': 'badge-warning',
            'pending_approval': 'badge-warning', 'completed': 'badge-primary', 'cancelled': 'badge-danger'
          }
          const statusClass = statusMap[order.status] || 'badge-info'
          return `<tr>
            <td data-label="订单号" class="mono">${sanitizePlainText(order.orderNo, 40)}</td>
            <td data-label="设备">${sanitizePlainText(device?.name ?? '-', 120)}</td>
            <td data-label="租期">${sanitizePlainText(order.startDate, 30)} ~ ${sanitizePlainText(order.endDate, 30)}</td>
            <td data-label="金额" class="mono">${formatCurrency(order.totalAmount)}</td>
            <td data-label="状态"><span class="badge ${statusClass}">${statusLabels[order.status] || '处理中'}</span></td>
            <td data-label="操作"><a class="link-button" href="/customer/orders/${encodeURIComponent(order.id)}">查看订单详情</a></td>
          </tr>`
        }).join('')}
        </tbody>
      </table>
    </div>
  `
  return buildLayout('控制台 - PC Rental', body, user)
}
