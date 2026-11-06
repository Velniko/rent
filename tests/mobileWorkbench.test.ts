/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies or modified versions. */

// 手机端布局与工作台的关键契约：
// - 底部 tab 只在 ≤760px 出现，且服务端就带 aria-current/active 高亮；
// - 员工/管理员手机工作台把「今日概览 + 扫码 + 快捷操作 + 更多」都放进来；
// - 新增的移动端样式全部在移动端媒体查询里（用样式表文本做结构断言）；
// - 可点区域 ≥44px、输入框 ≥16px（防 iOS 自动缩放）。

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildLayout } from '../src/site'
import { renderStaffMobileHome } from '../src/pages/staff/mobileHome'
import { renderStaffMobileOperations } from '../src/pages/staff/mobileOperations'
import styles from '../src/styles.css'

const admin = { id: 'admin-1', name: 'Admin User', email: 'admin@example.com', role: 'ADMIN' } as any
const staff = { id: 'staff-1', name: 'Staff User', email: 'staff@example.com', role: 'STAFF' } as any

/** 造一个只会返回固定聚合行的假 D1。 */
function overviewDb(values: Record<string, number>) {
  return {
    prepare() {
      return { bind() { return this }, async first() { return values } }
    },
  }
}

test('mobile workbench: admin sees overview, scan entry and the full admin map', async () => {
  const html = await renderStaffMobileHome(
    { req: { query: () => '' }, env: { RENT: overviewDb({ pickups: 3, returns: 2, overdue: 1, pending_review: 4, pending_deposits: 5, active_rentals: 9, customers: 12 }) } } as any,
    admin,
  )
  // 今日概览五项 + 租赁中
  assert.match(html, /class="mq-overview"/)
  for (const label of ['今日取货', '今日归还', '逾期', '待审核', '待结算押金']) assert.ok(html.includes(label), `缺少概览项：${label}`)
  assert.match(html, /mq-stat__value">3</)
  assert.match(html, /mq-stat__value">4</)
  assert.match(html, /mq-stat__value">5</)
  // 大号扫码入口
  assert.match(html, /class="mq-scan-cta" href="\/staff\/mobile\/scan"/)
  // 今日任务入口
  assert.match(html, /class="mq-today-cta" href="\/staff\/mobile\/today"/)
  // 完整后台能力（分组「更多」）
  for (const label of ['租赁订单', '设备管理', '用户管理', '通知中心', '发布通知', '订单审核']) assert.ok(html.includes(label), `缺少入口：${label}`)
  assert.match(html, /href="\/notifications\/compose"/)
  assert.match(html, /href="\/admin\/devices"/)
  assert.match(html, /href="\/admin\/users"/)
  assert.match(html, /href="\/admin\/order-review"/)
})

test('mobile workbench: staff sees their own customer and contract entries', async () => {
  const html = await renderStaffMobileHome(
    { req: { query: () => '' }, env: { RENT: overviewDb({ pickups: 1, returns: 0, overdue: 0, pending_review: 0, pending_deposits: 0, active_rentals: 2, customers: 6 }) } } as any,
    staff,
  )
  assert.match(html, /href="\/staff\/customers"/)
  assert.match(html, /href="\/staff\/contracts"/)
  assert.doesNotMatch(html, /href="\/admin\/users"/)
  // 没有待办时给出明确的「无事项」提示，而不是空白
  assert.match(html, /mq-attention--clear/)
})

test('mobile workbench: overview query failure degrades to zero without breaking the page', async () => {
  const html = await renderStaffMobileHome({ req: { query: () => '' }, env: { RENT: { prepare() { return { bind() { return this }, async first() { throw new Error('boom') } } } } } } as any, staff)
  assert.match(html, /mq-overview/)
  assert.match(html, /mq-stat__value">0</)
  assert.match(html, /\/staff\/mobile\/scan/)
})

/** 今日任务列表用的假 D1：任务查询返回 all()，概览查询返回 first()。 */
function taskDb() {
  return {
    prepare(sql:string) {
      return { bind() { return this }, async all() { return { results: [] } }, async first() { return sql.includes('staff_roster')?{revision:0,state_json:JSON.stringify({settings:{dailyHours:8,maxDays:5,maxConsecutive:5,minStaff:1},employees:[],published:[],drafts:{},requests:[],overrides:{},assignments:{}})}:{} } }
    },
  }
}

test('mobile tabs: only core rental actions, with aria-current on the active tab', async () => {
  const html = await renderStaffMobileOperations({ req: { query: () => '' }, env: { RENT: taskDb() } } as any, staff)
  const nav = html.slice(html.indexOf('<nav class="mobile-bottom-nav"'), html.indexOf('</nav>', html.indexOf('<nav class="mobile-bottom-nav"')))
  // 扫码已整合进今日订单，底部保留四个核心入口
  assert.equal((nav.match(/<a /g) || []).length, 4)
  assert.doesNotMatch(nav, /href="\/staff\/mobile\/scan"/)
  assert.match(html, /id="open-mobile-scanner"/)
  assert.match(html, /id="mobile-order-scanner"/)
  assert.doesNotMatch(nav, /通知|设置|客户|合同/)
  // /staff/mobile/today 属于「今日订单」tab：服务端直接输出 aria-current
  assert.match(nav, /<a href="\/staff\/mobile" class="active" aria-current="page">/)
  const scan = await renderStaffMobileOperations({ req: { query: () => 'stage=pickup' }, env: { RENT: taskDb() } } as any, staff)
  const scanNav = scan.slice(scan.indexOf('<nav class="mobile-bottom-nav"'), scan.indexOf('</nav>', scan.indexOf('<nav class="mobile-bottom-nav"')))
  assert.match(scanNav, /<a href="\/staff\/mobile" class="active" aria-current="page">/)
})

test('mobile tabs: desktop layout is untouched by the mobile-only aria-current', () => {
  const html = buildLayout('测试页面', '<p>x</p>', admin)
  assert.match(html, /class="sidebar sidebar--desktop"/)
  assert.match(html, /class="sidebar sidebar--mobile"/)
  // 没有传 currentPath 时底部 tab 不带 active，桌面侧栏逻辑保持原样（由 appClient 处理）
  const nav = html.slice(html.indexOf('<nav class="mobile-bottom-nav"'), html.indexOf('</nav>', html.indexOf('<nav class="mobile-bottom-nav"')))
  assert.doesNotMatch(nav, /aria-current/)
  assert.match(nav, /href="\/staff\/mobile"[^>]*>.*今日订单/s)
})

test('mobile styles live inside the mobile media query and keep touch targets large', () => {
  const mobileBlockStart = styles.indexOf('@media (max-width: 760px)')
  assert.ok(mobileBlockStart > -1, '缺少移动端媒体查询')
  const workbench = styles.slice(styles.indexOf('.mq-overview'), styles.indexOf('.mq-overview') + 4000)
  assert.ok(styles.indexOf('.mq-overview') > mobileBlockStart, '工作台样式必须在移动端媒体查询内')
  assert.match(workbench, /min-height:\s*([4-9]\d|1\d\d)px/)
  // 输入框 16px（防 iOS 聚焦缩放）
  assert.match(styles, /font-size:\s*16px\s*!important/)
  // 底部安全区
  assert.match(styles, /env\(safe-area-inset-bottom\)/)
  // 危险操作与粘性操作条
  assert.match(styles, /\.form-actions--sticky/)
  assert.match(styles, /\.mq-more__links a\s*\{[^}]*min-height:\s*44px/)
})
