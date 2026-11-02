/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies or modified versions. */

// 手机端工作台：员工与管理员共用的「今日概览 + 快捷操作 + 更多入口」。
// 设计前提：
// - 手机上不适合把完整后台塞进底部 tab，所以底部只留 5 个核心租赁动作（见 site.ts），
//   其余能力统一收进本页的「更多」分组与侧边抽屉。
// - 管理员看全局数据（全部员工），员工只看自己名下的客户与订单。
// - 页面自身不做写操作，全部是跳转入口，因此不需要 CSRF/表单处理。

import type { Context } from 'hono'
import { buildLayout } from '../../site'

const escapeHtml = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character] || character))

export interface MobileOverview {
  pickups: number
  returns: number
  overdue: number
  pendingReview: number
  pendingDeposits: number
  activeRentals: number
  customers: number
}

interface QuickAction { href: string; label: string; hint: string; tone?: 'primary' | 'warning' | 'info' }
interface MoreGroup { title: string; links: Array<[string, string]> }

const emptyOverview: MobileOverview = { pickups: 0, returns: 0, overdue: 0, pendingReview: 0, pendingDeposits: 0, activeRentals: 0, customers: 0 }

/** 从单条 SQL 聚合取今日概览（一次查询拿到全部计数，避免手机上多轮往返）。 */
export async function loadMobileOverview(c: Context, user: any): Promise<MobileOverview> {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Melbourne', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  const staffFilter = user.role === 'STAFF' ? ' AND u.staff_id = ?' : ''
  const bindings: unknown[] = [today, today]
  if (user.role === 'STAFF') bindings.push(user.id, user.id)
  const sql = `
    SELECT
      (SELECT COUNT(*) FROM orders o JOIN users u ON u.id = o.userId
        WHERE o.deleted_at IS NULL AND date(o.startDate) = ? AND o.status IN ('approved', 'paid', 'pending_pickup')${staffFilter}) AS pickups,
      (SELECT COUNT(*) FROM orders o JOIN users u ON u.id = o.userId
        WHERE o.deleted_at IS NULL AND date(o.endDate) = ? AND o.status IN ('active', 'extended', 'overdue', 'suspended', 'pending_return')${staffFilter}) AS returns,
      (SELECT COUNT(*) FROM orders o JOIN users u ON u.id = o.userId
        WHERE o.deleted_at IS NULL AND o.status = 'overdue'${staffFilter}) AS overdue,
      (SELECT COUNT(*) FROM orders o JOIN users u ON u.id = o.userId
        WHERE o.deleted_at IS NULL AND o.status = 'pending_review'${staffFilter}) AS pending_review,
      (SELECT COUNT(*) FROM orders o JOIN users u ON u.id = o.userId
        WHERE o.deleted_at IS NULL AND o.status IN ('completed', 'returned') AND o.depositStatus IN ('held', 'pending')${staffFilter}) AS pending_deposits,
      (SELECT COUNT(*) FROM orders o JOIN users u ON u.id = o.userId
        WHERE o.deleted_at IS NULL AND o.status IN ('active', 'extended', 'overdue')${staffFilter}) AS active_rentals,
      (SELECT COUNT(*) FROM users u WHERE u.role = 'CUSTOMER'${staffFilter}) AS customers
  `
  try {
    const row = await c.env.RENT.prepare(sql).bind(...bindings).first() as any
    return {
      pickups: Number(row?.pickups || 0),
      returns: Number(row?.returns || 0),
      overdue: Number(row?.overdue || 0),
      pendingReview: Number(row?.pending_review || 0),
      pendingDeposits: Number(row?.pending_deposits || 0),
      activeRentals: Number(row?.active_rentals || 0),
      customers: Number(row?.customers || 0),
    }
  } catch {
    // 概览是增强信息：查询失败时退化为 0，页面其余入口照常可用。
    return { ...emptyOverview }
  }
}

function statCard(href: string, label: string, value: number, tone: string, unit = '单'): string {
  return `<a class="mq-stat ${tone}" href="${escapeHtml(href)}"><span class="mq-stat__label">${escapeHtml(label)}</span><strong class="mq-stat__value">${value}</strong><span class="mq-stat__unit">${unit}</span></a>`
}

function actionTile({ href, label, hint, tone }: QuickAction): string {
  // hint 只放真实数字（如「3 单待取」）；没有数字时整行不渲染，不留空白小字。
  const hintHtml = hint ? `<small>${escapeHtml(hint)}</small>` : ''
  return `<a class="mq-action${tone ? ` is-${tone}` : ''}" href="${escapeHtml(href)}"><strong>${escapeHtml(label)}</strong>${hintHtml}</a>`
}

/** 管理员：完整后台能力的「更多」分组（底部 tab 只放 5 个核心动作）。 */
const adminMoreGroups: MoreGroup[] = [
  {
    title: '订单与合同',
    links: [['/admin/orders', '租赁订单'], ['/admin/order-review', '网站订单审核'], ['/admin/contracts', '合同列表'], ['/staff/contracts/new', '新建合同'], ['/admin/rental-links', '自助租赁链接'], ['/admin/calendar', '租赁日历']],
  },
  {
    title: '设备与验机',
    links: [['/admin/devices', '设备管理'], ['/admin/inspections', '验机记录'], ['/admin/device-agent-bindings', '绑定设备'], ['/admin/devices/reports', '设备运营报表'], ['/staff/rentals/tracking', '租赁追踪']],
  },
  {
    title: '财务',
    links: [['/admin/finance', '财务总览'], ['/admin/refunds', '退款管理'], ['/admin/withdrawals', '佣金提现'], ['/admin/reports', '运营分析报表'], ['/admin/orders/balance-topups', '充值订单']],
  },
  {
    title: '用户与通知',
    links: [['/admin/users', '用户管理'], ['/admin/notifications', '业务通知'], ['/notifications', '发布通知'], ['/admin/notifications/settings', '通知设置'], ['/admin/exceptions', '异常任务中心']],
  },
  {
    title: '系统',
    links: [['/admin/settings', '系统设置'], ['/admin/api-settings', 'API 设置'], ['/admin/monitoring', '系统健康监控'], ['/admin/connectivity', '通讯检测'], ['/admin/data-retention', '数据保留策略']],
  },
]

const staffMoreGroups: MoreGroup[] = [
  {
    title: '我的业务',
    links: [['/staff/orders', '租赁订单'], ['/staff/orders/ongoing', '进行中的租赁'], ['/staff/contracts', '合同列表'], ['/staff/contracts/new', '新建合同']],
  },
  {
    title: '客户与设备',
    links: [['/staff/customers', '我的客户'], ['/staff/devices', '设备管理'], ['/staff/rentals/tracking', '租赁追踪'], ['/staff/inspections', '验机记录']],
  },
  {
    title: '其他',
    links: [['/notifications', '通知中心'], ['/staff/dashboard', '完整工作台'], ['/staff/profile', '个人资料']],
  },
]

export async function renderStaffMobileHome(c: Context, user: any) {
  const overview = await loadMobileOverview(c, user)
  const isAdmin = user.role === 'ADMIN'
  const today = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Australia/Melbourne', month: 'long', day: 'numeric', weekday: 'long' }).format(new Date())
  const hour = Number(new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Melbourne', hour: '2-digit', hour12: false }).format(new Date()))
  const greeting = hour < 11 ? '早上好' : hour < 14 ? '中午好' : hour < 18 ? '下午好' : '晚上好'

  const quickActions: QuickAction[] = isAdmin
    ? [
        { href: '/staff/mobile/scan', label: '扫码作业', hint: '客户取货码', tone: 'primary' },
        { href: '/staff/mobile/pickup', label: '今日取货', hint: `${overview.pickups} 单待取`, tone: 'info' },
        { href: '/staff/mobile/return', label: '今日归还', hint: `${overview.returns} 单待验`, tone: 'warning' },
        { href: '/admin/order-review', label: '订单审核', hint: `${overview.pendingReview} 单待审` },
        { href: '/admin/orders', label: '租赁订单', hint: '' },
        { href: '/admin/devices', label: '设备管理', hint: '' },
        { href: '/admin/users', label: '用户管理', hint: `${overview.customers} 位客户` },
        { href: '/admin/finance', label: '财务总览', hint: '' },
      ]
    : [
        { href: '/staff/mobile/scan', label: '扫码作业', hint: '客户取货码', tone: 'primary' },
        { href: '/staff/mobile/pickup', label: '今日取货', hint: `${overview.pickups} 单待取`, tone: 'info' },
        { href: '/staff/mobile/return', label: '今日归还', hint: `${overview.returns} 单待验`, tone: 'warning' },
        { href: '/staff/customers', label: '我的客户', hint: `${overview.customers} 位` },
        { href: '/staff/orders', label: '租赁订单', hint: '' },
        { href: '/staff/contracts', label: '我的合同', hint: '' },
        { href: '/staff/inspections', label: '验机记录', hint: '' },
        { href: '/notifications', label: '通知中心', hint: '' },
      ]

  const moreGroups = isAdmin ? adminMoreGroups : staffMoreGroups
  const moreHtml = moreGroups.map(group => `
    <details class="mq-more__group">
      <summary>${escapeHtml(group.title)}<span class="mq-more__count">${group.links.length}</span></summary>
      <div class="mq-more__links">${group.links.map(([href, label]) => `<a href="${escapeHtml(href)}">${escapeHtml(label)}</a>`).join('')}</div>
    </details>`).join('')

  const attention = overview.overdue + overview.pendingReview + overview.pendingDeposits
  const attentionHtml = attention
    ? `<a class="mq-attention" href="${isAdmin ? '/admin/exceptions' : '/staff/orders/ongoing'}"><span class="mq-attention__dot" aria-hidden="true"></span><span><strong>${attention} 项需要关注</strong><small>逾期 ${overview.overdue} · 待审核 ${overview.pendingReview} · 待结算押金 ${overview.pendingDeposits}</small></span><span aria-hidden="true">›</span></a>`
    : `<p class="mq-attention mq-attention--clear"><span class="mq-attention__dot" aria-hidden="true"></span>今日没有逾期或待审核事项。</p>`

  const body = `<div class="mobile-home">
    <header class="mq-greeting">
      <p class="section-code">${isAdmin ? 'ADMIN CONSOLE' : 'STAFF CONSOLE'}</p>
      <h2>${greeting}，${escapeHtml(String(user.name || '').split(/\s+/)[0] || '同事')}</h2>
      <p class="mq-greeting__date">${escapeHtml(today)} · ${isAdmin ? '管理端' : '员工端'}手机工作台</p>
    </header>

    <form class="mobile-task-search" method="get" action="/staff/mobile/today">
      <input class="form-control" type="search" name="q" placeholder="扫码或搜索订单号、客户、设备" autocomplete="off" inputmode="search" enterkeyhint="search">
      <button class="button button-primary" type="submit">搜索</button>
    </form>

    <section class="mq-overview" aria-label="今日概览">
      ${statCard('/staff/mobile/pickup', '今日取货', overview.pickups, 'is-pickup')}
      ${statCard('/staff/mobile/return', '今日归还', overview.returns, 'is-return')}
      ${statCard(isAdmin ? '/admin/exceptions' : '/staff/orders/ongoing', '逾期', overview.overdue, 'is-overdue')}
      ${statCard(isAdmin ? '/admin/order-review' : '/staff/orders', '待审核', overview.pendingReview, 'is-review')}
      ${statCard(isAdmin ? '/admin/finance' : '/staff/orders', '待结算押金', overview.pendingDeposits, 'is-deposit')}
      ${statCard('/staff/orders/ongoing', '租赁中', overview.activeRentals, 'is-active')}
    </section>

    ${attentionHtml}

    <a class="mq-today-cta" href="/staff/mobile/today"><span class="mq-today-cta__icon" aria-hidden="true">☰</span><span><strong>今日任务</strong><small>取货 ${overview.pickups} · 归还 ${overview.returns}</small></span><span class="mq-today-cta__arrow" aria-hidden="true">›</span></a>
    <a class="mq-scan-cta" href="/staff/mobile/scan"><span class="mq-scan-cta__icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5"></path><path d="M3 12h18"></path></svg></span><span><strong>扫码作业</strong><small>扫描客户取货二维码，直接进入取货或验机</small></span></a>

    <section class="mq-section" aria-labelledby="mq-quick-title">
      <div class="mq-section__head"><h3 id="mq-quick-title">快捷操作</h3></div>
      <div class="mq-quick">${quickActions.map(actionTile).join('')}</div>
    </section>

    <section class="mq-section" aria-labelledby="mq-more-title">
      <div class="mq-section__head"><h3 id="mq-more-title">更多功能</h3></div>
      <div class="mq-more">${moreHtml}</div>
    </section>

  </div>`
  return buildLayout('手机工作台 - 电脑租赁管理系统', body, user, { compactStaffNav: true, currentPath: '/staff/mobile' })
}
