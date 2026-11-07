/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0. */

import type { Context } from 'hono'
import { buildLayout, getDevices, sanitizePlainText } from '../../site'
import { formatMelbourneDate } from '../../lib/format'

export async function renderAdminDeviceCalendar(c: Context, user: any) {
  const devices = await getDevices(c)
  const bookings = ((await c.env.RENT.prepare(`
    SELECT o.id, o.orderNo, o.deviceId, o.startDate, o.endDate, o.status, o.return_received_at, o.updatedAt,
           d.name AS deviceName, u.name AS customerName
    FROM orders o
    JOIN devices d ON d.id = o.deviceId
    LEFT JOIN users u ON u.id = o.userId
    WHERE o.deleted_at IS NULL AND d.deleted_at IS NULL AND o.status != 'cancelled'
    ORDER BY o.startDate, d.name
  `).all()).results || []) as any[]
  // 完成订单只保留实际归还前的档期；缺少归还时间的旧记录用更新时间兜底。
  const calendarBookings = bookings.map(item => {
    if (item.status !== 'completed') return item
    const returnedDate = formatMelbourneDate(item.return_received_at || item.updatedAt)
    return { ...item, endDate: /^\d{4}-\d{2}-\d{2}$/.test(returnedDate) ? (item.endDate < returnedDate ? item.endDate : returnedDate) : '' }
  })
  const escape = (value: unknown) => sanitizePlainText(value, 300).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const deviceOptions = devices.map(device => `<option value="${escape(device.id)}">${escape(device.name)} · ${escape(device.serialNumber)}</option>`).join('')
  const data = JSON.stringify(calendarBookings).replace(/</g, '\\u003c')
  const body = `<div class="entity-header"><div class="identity-strip mono"><span>FLEET / CALENDAR</span><span>${devices.length} DEVICES</span></div><div class="entity-heading"><div><p class="section-code">RENTAL SCHEDULE</p><h2>设备租赁日历</h2><p>按月份查看全部设备，或筛选单台设备的出租日期。</p></div><a class="button" href="/staff/contracts/new">新建合同</a></div></div>
  <div class="panel fleet-calendar-panel"><div class="fleet-calendar-toolbar"><div class="form-group"><label class="form-label" for="calendar-device">设备范围</label><select class="form-control" id="calendar-device"><option value="">全部出租设备</option>${deviceOptions}</select></div><div class="calendar-month-nav" aria-label="切换日历月份"><button class="button button-sm button-secondary" id="calendar-prev" type="button" aria-label="上个月">←</button><strong id="calendar-month-label" aria-live="polite"></strong><button class="button button-sm button-secondary" id="calendar-today" type="button">本月</button><button class="button button-sm button-secondary" id="calendar-next" type="button" aria-label="下个月">→</button></div><div class="calendar-legend"><span><i class="calendar-dot is-active"></i>占用档期</span><span><i class="calendar-dot is-pending"></i>待签/待付款</span></div></div><div class="booking-weekdays" aria-hidden="true"><span>一</span><span>二</span><span>三</span><span>四</span><span>五</span><span>六</span><span>日</span></div><div id="fleet-calendar" class="fleet-calendar" aria-live="polite"></div><div id="calendar-empty" class="empty-state" hidden><span class="empty-state-code mono">CLEAR / MONTH</span><h3>本月没有租赁记录</h3><p>切换月份或选择其他设备查看档期。</p></div></div>
  <script>(() => { const bookings = ${data}; const device = document.getElementById('calendar-device'); const calendar = document.getElementById('fleet-calendar'); const empty = document.getElementById('calendar-empty'); const monthLabel = document.getElementById('calendar-month-label'); let currentMonth = new Date(); currentMonth = new Date(Date.UTC(currentMonth.getFullYear(), currentMonth.getMonth(), 1)); const iso = value => value.toISOString().slice(0, 10); function render() { calendar.replaceChildren(); const first = new Date(currentMonth); monthLabel.textContent = first.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', timeZone: 'UTC' }); const offset = (first.getUTCDay() + 6) % 7; const start = new Date(first); start.setUTCDate(1 - offset); const visible = bookings.filter(item => !device.value || item.deviceId === device.value); let visibleCount = 0; for (let index = 0; index < 42; index += 1) { const date = new Date(start); date.setUTCDate(start.getUTCDate() + index); const dateText = iso(date); const dayBookings = visible.filter(item => item.startDate <= dateText && item.endDate >= dateText); visibleCount += dayBookings.length; const cell = document.createElement('section'); cell.className = 'fleet-calendar-day' + (date.getUTCMonth() !== first.getUTCMonth() ? ' is-outside' : ''); const number = document.createElement('span'); number.className = 'fleet-calendar-date mono'; number.textContent = String(date.getUTCDate()); cell.appendChild(number); dayBookings.slice(0, 4).forEach(item => { const entry = document.createElement('a'); entry.className = 'calendar-booking ' + (['draft','pending_approval','pending_payment'].includes(item.status) ? 'is-pending' : 'is-active'); entry.href = '/admin/orders/' + encodeURIComponent(item.id); entry.title = item.deviceName + ' · ' + (item.customerName || '待关联客户') + ' · ' + item.startDate + ' 至 ' + item.endDate; const deviceName = document.createElement('strong'); deviceName.textContent = item.deviceName; const customer = document.createElement('small'); customer.textContent = item.customerName || item.status; entry.append(deviceName, customer); cell.appendChild(entry); }); if (dayBookings.length > 4) { const more = document.createElement('small'); more.className = 'calendar-more'; more.textContent = '+' + (dayBookings.length - 4) + ' 条'; cell.appendChild(more); } calendar.appendChild(cell); } empty.hidden = visibleCount > 0; } function moveMonth(offset) { currentMonth.setUTCMonth(currentMonth.getUTCMonth() + offset); render(); } device.addEventListener('change', render); document.getElementById('calendar-prev').addEventListener('click', () => moveMonth(-1)); document.getElementById('calendar-next').addEventListener('click', () => moveMonth(1)); document.getElementById('calendar-today').addEventListener('click', () => { const today = new Date(); currentMonth = new Date(Date.UTC(today.getFullYear(), today.getMonth(), 1)); render(); }); render(); })();</script>`
  return buildLayout('设备租赁日历 - 电脑租赁管理系统', body, user)
}
