/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

import type { Context } from 'hono'
import { buildLayout, getDeviceById, getDeviceRentalRules, formatCurrency } from '../../site'
import { escapeHtml as esc } from '../../lib/html'
import { getRentalLink, expireRentalLinkDrafts } from '../../services/rentalLinks'
import { renderRentalLinkDatePicker } from '../partials/rentalLinkDatePicker'
import { pickupClosureConfig } from '../../domain/pickupTimeSlots'

export async function renderPublicRentalLink(c: Context) {
  c.header('Cache-Control', 'private, no-store')
  const link = await getRentalLink(c, c.req.param('token') || '')
  const device = link ? await getDeviceById(c, link.device_id) : null
  if (!link || !device || ['maintenance', 'retired'].includes(String(device.status))) return c.html(buildLayout('租赁链接不可用', '<div class="panel"><h2>该租赁链接暂不可用</h2><p>设备正在维护、已退役，或链接已停用。请联系工作人员。</p></div>'), 404)
  await expireRentalLinkDrafts(c)
  const rules = await getDeviceRentalRules(c, device.id)
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Melbourne', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  const bookingCutoff = new Date(`${today}T00:00:00Z`)
  bookingCutoff.setUTCDate(bookingCutoff.getUTCDate() - rules.bufferDays)
  const bookings = ((await c.env.RENT.prepare("SELECT startDate, endDate, startPeriod, endPeriod FROM orders WHERE deviceId = ? AND status NOT IN ('completed', 'cancelled') AND (endDate >= ? OR startDate IS NULL OR endDate IS NULL) ORDER BY startDate").bind(device.id, bookingCutoff.toISOString().slice(0, 10)).all()).results || []) as any[]
  const unknownDates = bookings.some(booking => !booking.startDate || !booking.endDate)
  const datePicker = renderRentalLinkDatePicker({ today, minutes: 0, minimumRentalDays: rules.minimumRentalDays, bufferDays: rules.bufferDays, unavailableDates: rules.unavailableDates, unavailableTimeSlots: rules.unavailableTimeSlots || {}, pickupClosure: pickupClosureConfig(rules), bookings })
  const body = `<div class="rental-link-shell"><div class="entity-header"><div class="identity-strip mono"><span>自助租赁</span><span>选择租期 → 填写资料并签约 → 付款</span></div><div class="entity-heading"><div><h2>${esc(link.title)}</h2><p>${esc(device.name)}${device.model ? ` · ${esc(device.model)}` : ''}</p></div><span class="badge badge-info">最短 ${rules.minimumRentalDays} 天</span></div></div>
    ${c.req.query('error') ? `<div data-flash-notice class="page-notification page-notification--error" role="alert">${esc(c.req.query('error'))}</div>` : ''}
    <div class="grid grid-2"><section class="panel"><h3>选择您的租期</h3><p class="section-note">选好租期后 30 分钟内完成签约。</p>
      ${unknownDates ? '<p class="alert">设备当前有一笔尚未确定归还日期的租赁，暂时无法在线预订，请联系工作人员。</p>' : ''}
      <form method="POST" action="/rent/${esc(link.token)}"><fieldset ${unknownDates ? 'disabled' : ''} style="border:0;padding:0;margin:0">${datePicker}<button class="button button-primary" type="submit" disabled>继续填写资料并签署合同</button></fieldset></form></section>
      <aside class="panel"><h3>租赁信息</h3><dl class="data-list"><div><dt>日租金</dt><dd>${formatCurrency(device.pricePerDay)}</dd></div><div><dt>押金</dt><dd>${formatCurrency(device.depositAmount)}</dd></div><div><dt>取货地点</dt><dd>${esc(link.pickup_location)}</dd></div><div><dt>归还地点</dt><dd>${esc(link.return_location)}</dd></div></dl>
        ${Number(device.weeklyDiscountPercent) ? `<p class="section-note">周租优惠 ${Number(device.weeklyDiscountPercent)}%。</p>` : ''}${Number(device.monthlyDiscountPercent) ? `<p class="section-note">月租优惠 ${Number(device.monthlyDiscountPercent)}%。</p>` : ''}
      </aside></div></div>`
  return c.html(buildLayout(`${link.title} - 自助租赁`, body))
}
