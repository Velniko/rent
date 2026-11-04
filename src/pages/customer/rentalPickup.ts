/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

import type { Context } from 'hono'
import { buildLayout } from '../../site'
import { escapeHtml as esc } from '../../lib/html'
import { HALF_HOUR_TIME_OPTIONS } from '../../domain/pickupTimeSlots'
import { rentalCity,rentalPickupBlocks } from '../../services/rentalPickup'
import type { C2CListing } from '../../services/c2c'

export async function renderRentalPickupEditor(c:Context,user:any,listing:C2CListing){
  const blocks=await rentalPickupBlocks(c,listing.device_id)
  const times=[...HALF_HOUR_TIME_OPTIONS,'24:00']
  const message=c.req.query('error')||c.req.query('success')
  const body=`<div class="entity-header"><div class="entity-heading"><div><p class="section-code">PICKUP / AVAILABILITY</p><h2>取货时间设置</h2><p><span>${esc(listing.name)}</span> · <span>${esc(rentalCity(listing))}</span></p></div><a class="button button-secondary" href="/customer/rental-program">我的出租</a></div></div>${message?`<div data-flash-notice class="page-notification page-notification--${c.req.query('error')?'error':'success'}">${esc(message)}</div>`:''}
  <section class="panel"><h3>添加不可取货时间</h3><form method="post" action="/customer/rental-program/${encodeURIComponent(listing.id)}/pickup-blocks"><div class="grid grid-3"><label class="form-group"><span class="form-label">不可取货日期</span><input class="form-control" name="blockedDate" type="date" required></label><label class="form-group"><span class="form-label">开始时间</span><select class="form-control" name="startTime">${HALF_HOUR_TIME_OPTIONS.map(time=>`<option value="${time}" ${time==='09:00'?'selected':''}>${time}</option>`).join('')}</select></label><label class="form-group"><span class="form-label">结束时间</span><select class="form-control" name="endTime">${times.map(time=>`<option value="${time}" ${time==='18:00'?'selected':''}>${time}</option>`).join('')}</select></label></div><label class="form-check"><input type="checkbox" name="allDay" value="1" checked> 全天不可取货</label><button class="button button-primary" type="submit">添加不可取货时间</button></form></section>
  <section class="panel"><h3>已设置的不可取货时间</h3>${blocks.length?`<div class="table-wrapper"><table><thead><tr><th>日期</th><th>时段</th><th>操作</th></tr></thead><tbody>${blocks.map(block=>`<tr><td>${esc(block.blocked_date)}</td><td>${block.start_time?esc(block.start_time+'–'+block.end_time):'全天'}</td><td><form method="post" action="/customer/rental-program/${encodeURIComponent(listing.id)}/pickup-blocks/${encodeURIComponent(block.id)}/remove"><button class="button button-secondary" type="submit">移除</button></form></td></tr>`).join('')}</tbody></table></div>`:'<div class="empty-state">尚未设置不可取货时间。</div>'}</section>`
  return buildLayout('取货时间设置',body,user)
}
