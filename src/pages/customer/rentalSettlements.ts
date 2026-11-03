/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

import type { Context } from 'hono'
import { buildLayout,formatCurrency } from '../../site'
import { escapeHtml as esc } from '../../lib/html'
import { formatMelbourneDateTime } from '../../lib/format'
import { c2cSettlementQuote } from '../../services/c2c'
import { getPayoutPreference,rentalPayouts,type RentalPayout } from '../../services/rentalPayouts'
import { renderPager } from '../../lib/pagination'

const weekdays=[[1,'周一'],[2,'周二'],[3,'周三'],[4,'周四'],[5,'周五'],[6,'周六'],[0,'周日']] as const
const money=(cents:number)=>formatCurrency(cents/100)
function notice(c:Context){const message=c.req.query('error')||c.req.query('success');return message?`<div data-flash-notice class="page-notification page-notification--${c.req.query('error')?'error':'success'}">${esc(message)}</div>`:''}
function table(rows:RentalPayout[],admin=false){
  return `<div class="table-wrapper"><table><thead><tr><th>申请时间</th>${admin?'<th>收款人及账户</th>':''}<th>出租订单</th><th>结算租金</th><th>平台手续费</th><th>转账金额</th><th>状态</th>${admin?'<th>操作</th>':''}</tr></thead><tbody>${rows.map(row=>`<tr>
  <td>${esc(formatMelbourneDateTime(row.requested_at))}<br><small>${row.origin==='manual'?'手动申请':row.origin==='weekly'?'每周自动申请':'隔天自动申请'}</small></td>
  ${admin?`<td><strong>${esc(row.account_name)}</strong><br><span class="mono">BSB ${esc(row.bsb)}</span><br><span class="mono">${esc(row.account_number)}</span></td>`:''}
  <td>${admin?`<a href="/admin/orders/${encodeURIComponent(row.order_id)}">${esc(row.orderNo)}</a>`:esc(row.orderNo)}</td>
  <td>${money(row.rental_cents)}</td><td>${money(row.commission_cents)}<br><small>${row.commission_bps/100}%</small></td><td><strong>${money(row.owner_cents)}</strong></td>
  <td>${row.status==='paid'?'已转账':row.payable?'待人工转账':'需重新核对'}${row.transfer_reference?`<br>${esc(row.transfer_reference)}`:''}${row.paid_at?`<br><small>${esc(formatMelbourneDateTime(row.paid_at))}</small>`:''}</td>
  ${admin?`<td>${row.status==='paid'?'—':row.payable?`<form method="post" action="/admin/rental-settlements/${encodeURIComponent(row.id)}/paid" data-site-confirm="请确认已完成转账。登记后不可修改。" data-confirm-title="确认已转账" data-confirm-label="登记已转账"><input type="hidden" name="quote" value="${esc(c2cSettlementQuote(row))}"><label class="form-label">转账流水号<input class="form-control" name="reference" maxlength="120" required></label><button class="button button-primary" type="submit">登记已转账</button></form>`:`<p class="form-text">订单金额或收款资料已变更。</p><form method="post" action="/admin/rental-settlements/${encodeURIComponent(row.id)}/refresh"><button class="button button-secondary" type="submit">重新核对</button></form>`}</td>`:''}</tr>`).join('') || `<tr><td colspan="${admin?8:6}" class="empty-state">暂无结算申请。</td></tr>`}</tbody></table></div>`
}
export async function renderCustomerRentalSettlements(c:Context,user:any){
  const [preference,page,summary]=await Promise.all([getPayoutPreference(c,user.id),rentalPayouts(c,user.id),c.env.RENT.prepare(`SELECT COALESCE(SUM(q.owner_cents),0) AS amount FROM c2c_settlement_quotes q WHERE q.owner_id=? AND q.eligible=1 AND q.owner_cents>0 AND NOT EXISTS(SELECT 1 FROM c2c_settlements s WHERE s.order_id=q.order_id) AND NOT EXISTS(SELECT 1 FROM c2c_payout_requests r WHERE r.order_id=q.order_id)`).bind(user.id).first() as Promise<{amount:number}>])
  const body=`${notice(c)}<div class="entity-header"><div class="identity-strip mono"><span>RENTAL / PAYOUTS</span><span>AUD</span></div><div class="entity-heading"><div><p class="section-code">OWNER INCOME</p><h2>出租结算</h2></div><a class="button button-secondary" href="/customer/rental-program">我的出租</a></div></div>
  <section class="panel"><div class="section-title"><h3>可申请收入</h3><strong>${money(summary.amount)}</strong></div><p class="form-text">租金由平台收取，结算后人工转账。</p><div class="record-actions"><form method="post" action="/customer/rental-program/settlements/request"><button class="button button-primary" type="submit" ${summary.amount>0?'':'disabled'}>申请结算</button></form><a class="button button-secondary" href="/customer/profile">设置收款账户</a></div></section>
  <section class="panel"><h3>结算方式</h3><form method="post" action="/customer/rental-program/settlements/preferences" class="grid grid-2"><label class="form-group"><span class="form-label">申请方式</span><select class="form-control" name="cadence"><option value="manual" ${preference.cadence==='manual'?'selected':''}>手动申请</option><option value="every_other_day" ${preference.cadence==='every_other_day'?'selected':''}>隔天（每两天）自动申请</option><option value="weekly" ${preference.cadence==='weekly'?'selected':''}>每周指定日自动申请</option></select></label><label class="form-group"><span class="form-label">每周结算日</span><select class="form-control" name="weekday">${weekdays.map(([day,label])=>`<option value="${day}" ${preference.weekday===day?'selected':''}>${label}</option>`).join('')}</select></label><div><p class="form-text">自动申请时间：墨尔本时间 09:00</p>${preference.next_run_date?`<p><span>下次申请</span>：${esc(preference.next_run_date)}</p>`:''}<button class="button button-primary" type="submit">保存结算方式</button></div></form></section>
  <section class="panel"><h3>结算记录</h3>${table(page.requests)}${renderPager(page.meta,{basePath:'/customer/rental-program/settlements'})}</section>`
  return buildLayout('出租结算',body,user)
}
export async function renderAdminRentalSettlements(c:Context,user:any){
  const page=await rentalPayouts(c)
  const body=`${notice(c)}<div class="entity-header"><div class="identity-strip mono"><span>FINANCE / OWNER PAYOUTS</span><span>MANUAL BANK TRANSFER</span></div><div class="entity-heading"><div><p class="section-code">TRANSFER DESK</p><h2>出租结算转账</h2></div><a class="button button-secondary" href="/admin/rental-program">设备出租管理</a></div></div><section class="panel"><div class="section-title"><h3>转账待办与记录</h3><strong><span>本页待转账</span> ${money(page.requests.filter(row=>row.payable).reduce((sum,row)=>sum+row.owner_cents,0))}</strong></div><p class="form-text">转账前请刷新核对金额及收款账户。</p>${table(page.requests,true)}${renderPager(page.meta,{basePath:'/admin/rental-settlements'})}</section>`
  return buildLayout('出租结算转账',body,user)
}
