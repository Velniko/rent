/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

import { buildLayout, formatCurrency, sanitizePlainText, deviceUtilisationRate, paymentMethodBreakdown } from '../../site';

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash: '现金', card: '信用卡 / Stripe', square: 'Square 礼品卡', balance: '账户余额', bank_transfer: '银行转账', deposit: '押金抵扣', adjustment: '人工调整', unknown: '其他',
}

export interface OperationsReportData {
  windowDays: number
  rentalRevenue: number
  refundTotal: number
  depositHeld: number
  depositRefunded: number
  depositForfeited: number
  outstandingBalance: number
  overdueRentals: number
  fleetSize: number
  rentedDeviceDays: number
  damageCost: number
  maintenanceCost: number
  couponDiscountCost: number
  referralRewardCost: number
  paymentMethods: Array<{ method: string; amount: number; count: number }>
}

export function renderAdminOperationsReport(user: any, d: OperationsReportData) {
  const utilisation = deviceUtilisationRate(d.rentedDeviceDays, d.fleetSize, d.windowDays)
  const methods = paymentMethodBreakdown(d.paymentMethods)
  const netRevenue = Math.round((d.rentalRevenue - d.refundTotal) * 100) / 100

  const stat = (title: string, value: string, note = '', tone = '') => `<div class="stat-card ${tone}"><h3>${title}</h3><div class="value">${value}</div>${note ? `<div class="trend">${note}</div>` : ''}</div>`

  const methodRows = methods.length
    ? `<div class="table-wrapper"><table><thead><tr><th>支付方式</th><th>金额</th><th>笔数</th><th>占比</th></tr></thead><tbody>${methods.map(m => `<tr><td>${PAYMENT_METHOD_LABELS[m.method] || sanitizePlainText(m.method, 40)}</td><td>${formatCurrency(m.amount)}</td><td>${m.count}</td><td>${m.share.toFixed(2)}%</td></tr>`).join('')}</tbody></table></div>`
    : '<div class="empty-state">窗口期内没有已入账付款</div>'

  const days = d.windowDays
  const body = `<div class="page-header"><div><p class="section-code">OPERATIONS / ANALYTICS</p><h2>运营分析报表</h2><p>统计窗口：最近 ${days} 天。</p></div><div style="display:flex;gap:8px">${[7, 30, 90, 365].map(n => `<a class="button button-sm ${n === days ? 'button-primary' : 'button-secondary'}" href="/admin/reports?days=${n}">${n} 天</a>`).join('')}</div></div>
  <div class="stats-grid">
    ${stat('租金收入', formatCurrency(d.rentalRevenue), `Payment RENTAL 明细，最近 ${days} 天`, 'primary')}
    ${stat('退款总额', formatCurrency(d.refundTotal), 'Payment Refund 租金部分（不含押金）', d.refundTotal ? 'warning' : '')}
    ${stat('净收入', formatCurrency(netRevenue), '租金收入 − 退款总额')}
    ${stat('应收未收', formatCurrency(d.outstandingBalance), '已确认 / 租赁中但付款未结清的订单', d.outstandingBalance ? 'warning' : '')}
  </div>
  <div class="stats-grid">
    ${stat('押金在持', formatCurrency(d.depositHeld), 'deposit_status = HELD / PAID / PARTIALLY_DEDUCTED')}
    ${stat('押金已退', formatCurrency(d.depositRefunded), '含部分退款')}
    ${stat('押金没收', formatCurrency(d.depositForfeited), 'deposit_status = FORFEITED', d.depositForfeited ? 'warning' : '')}
    ${stat('逾期租赁', String(d.overdueRentals), 'rental_status = OVERDUE 或已过归还日未归还', d.overdueRentals ? 'warning' : '')}
  </div>
  <div class="stats-grid">
    ${stat('车队利用率', `${(utilisation * 100).toFixed(1)}%`, `窗口内租出设备·天 ${Math.round(d.rentedDeviceDays)} / (可租设备 ${d.fleetSize} × ${days})`, 'primary')}
    ${stat('损坏成本', formatCurrency(d.damageCost), 'damage_cases 最终 / 估算成本', d.damageCost ? 'warning' : '')}
    ${stat('维护成本', formatCurrency(d.maintenanceCost), 'maintenance_records 成本合计')}
    ${stat('优惠码成本', formatCurrency(d.couponDiscountCost), '已核销 coupon_redemptions 折扣额')}
  </div>
  <div class="stats-grid">
    ${stat('推荐奖励成本', formatCurrency(d.referralRewardCost), '已发放 / 已入账推荐奖励')}
  </div>
  <div class="panel">
    <div class="section-title"><h3>支付方式占比</h3></div>
    ${methodRows}
  </div>
  <div class="panel">
    <div class="section-title"><h3>相关明细报表</h3></div>
    <p class="section-note" style="display:flex;gap:8px;flex-wrap:wrap"><a class="button button-sm button-secondary" href="/admin/devices/reports">设备运营报表</a><a class="button button-sm button-secondary" href="/admin/revenue-stats">收入统计</a><a class="button button-sm button-secondary" href="/admin/refunds">退款记录</a><a class="button button-sm button-secondary" href="/admin/finance">财务总览</a></p>
  </div>`
  return buildLayout('运营分析报表 - 电脑租赁管理系统', body, user)
}
