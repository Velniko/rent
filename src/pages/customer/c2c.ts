/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

import type { Context } from 'hono'
import type { User } from '../../site'
import { buildLayout, formatCurrency } from '../../site'
import { escapeHtml } from '../../lib/html'
import { getC2CCommission, listC2CListings, listC2CQuotes, c2cSettlementQuote } from '../../services/c2c'
import { renderPager } from '../../lib/pagination'
import type { C2CListing, C2CQuote } from '../../services/c2c'

export const c2cStatus = {pending:'待审核',approved:'已上架',rejected:'已驳回',paused:'已下架'}
const money = (cents: number) => formatCurrency(cents / 100)
export function renderC2CNotice(c: Context): string {
  const error=c.req.query('error'), success=c.req.query('success')
  return error || success ? `<div data-flash-notice class="page-notification page-notification--${error?'error':'success'}">${escapeHtml(error || success)}</div>` : ''
}
export function renderC2CListingForm(listing?: C2CListing): string {
  const field=(label: string,name: string,value: unknown,type='text',extra='') => `<label class="form-label" for="c2c-${name}">${label}</label><input class="form-control" id="c2c-${name}" name="${name}" type="${type}" value="${escapeHtml(value)}" required ${extra}>`
  return `<section class="panel"><h2>${listing?'重新提交设备':'发布我的设备'}</h2><form method="post" action="/customer/c2c${listing?`/${encodeURIComponent(listing.id)}/edit`:''}">
    <div class="grid grid-2"><div>${field('设备名称','name',listing?.name || '', 'text','maxlength="120"')}${field('型号','model',listing?.model || '', 'text','maxlength="120"')}${field('序列号','serialNumber',listing?.serial_number || '', 'text','maxlength="120"')}</div>
    <div>${field('日租金 (AUD)','dailyRate',listing?.daily_rate || '', 'number','min="0.01" max="100000" step="0.01"')}${field('押金 (AUD)','deposit',listing?.deposit ?? '', 'number','min="0" max="1000000" step="0.01"')}
    <label class="form-label" for="c2c-description">设备描述</label><textarea class="form-control" id="c2c-description" name="description" maxlength="2000" rows="4">${escapeHtml(listing?.description || '')}</textarea></div></div>
    <div class="record-actions"><button class="button button-primary" type="submit">提交审核</button>${listing?'<a class="button button-secondary" href="/customer/c2c">取消</a>':''}</div></form></section>`
}
export function renderC2CQuoteTable(quotes: C2CQuote[], admin=false): string {
  if (!quotes.length) return '<p>还没有出租订单。</p>'
  return `<div class="table-wrapper"><table><thead><tr><th>订单编号</th>${admin?'<th>设备主人</th>':''}<th>结算租金</th><th>平台佣金</th><th>主人收入</th><th>结算状态</th>${admin?'<th>收款账户</th><th>操作</th>':''}</tr></thead><tbody>${quotes.map(q=>`<tr>
    <td>${admin?`<a href="/admin/orders/${encodeURIComponent(q.order_id)}">${escapeHtml(q.orderNo)}</a>`:escapeHtml(q.orderNo)}</td>${admin?`<td>${escapeHtml(q.owner_name)}</td>`:''}
    <td>${money(q.rental_cents)}</td><td>${money(q.commission_cents)} (${q.commission_bps/100}%)</td><td>${money(q.owner_cents)}</td>
    <td>${q.settled_at?'已结算':q.order_status==='cancelled'?'已取消':q.eligible && q.rental_cents>0?'待结算':'待完成'}${q.transfer_reference?`<br>${escapeHtml(q.transfer_reference)}`:''}</td>
    ${admin?`<td>${escapeHtml(q.owner_name)}<br>${escapeHtml(q.bsb || '')}<br>${escapeHtml(q.account_number || '')}</td><td>${!q.settled_at && q.eligible && q.rental_cents>0?`<form method="post" action="/admin/c2c/orders/${encodeURIComponent(q.order_id)}/settle" data-site-confirm="请确认已完成转账。保存后不可再修改。" data-confirm-title="确认结算" data-confirm-label="登记结算"><input type="hidden" name="quote" value="${escapeHtml(c2cSettlementQuote(q))}"><label class="form-label">转账流水号<input class="form-control" name="reference" maxlength="120" required></label><button class="button button-primary" type="submit">登记结算</button></form>`:'—'}</td>`:''}</tr>`).join('')}</tbody></table></div>`
}
export async function renderCustomerC2C(c: Context,user: User): Promise<string> {
  const [listingPage,quotePage,bps]=await Promise.all([listC2CListings(c,user.id),listC2CQuotes(c,user.id),getC2CCommission(c)])
  const {listings}=listingPage, {quotes}=quotePage
  const editing=listings.find(l=>l.id===c.req.query('edit') && ['rejected','paused'].includes(l.status))
  const total=Number((await c.env.RENT.prepare('SELECT COALESCE(SUM(owner_cents),0) AS total FROM c2c_settlements WHERE owner_id=?').bind(user.id).first() as {total:number}).total)
  const body=`${renderC2CNotice(c)}<section class="panel"><div class="section-title"><div><p class="section-code">C2C</p><h2>我的出租</h2></div><a class="button button-secondary" href="/customer/devices?mode=c2c">逛个人设备</a></div>
    <div class="grid grid-3"><div class="card"><h3>平台佣金比例</h3><strong>${bps/100}%</strong></div><div class="card"><h3>我的设备</h3><strong>${listingPage.meta.total}</strong></div><div class="card"><h3>已结算收入</h3><strong>${money(total)}</strong></div></div>
    <p><a href="/customer/profile">设置收款账户</a></p></section>
    ${renderC2CListingForm(editing)}<section class="panel"><h2>我的发布</h2>${listings.length?`<div class="device-list grid grid-3">${listings.map(l=>`<article class="device-card card"><span class="badge">${c2cStatus[l.status]}</span><h3>${escapeHtml(l.name)}</h3><p>${escapeHtml(l.model)}</p><p>日租金: ${formatCurrency(l.daily_rate)}</p><p>押金: ${formatCurrency(l.deposit)}</p>${l.review_note?`<p>${escapeHtml(l.review_note)}</p>`:''}<div class="record-actions">${['rejected','paused'].includes(l.status)?`<a class="button button-secondary" href="/customer/c2c?page=${listingPage.meta.page}&edit=${encodeURIComponent(l.id)}">编辑并重审</a>`:`<form method="post" action="/customer/c2c/${encodeURIComponent(l.id)}/pause"><button class="button button-secondary" type="submit">下架设备</button></form>`}</div></article>`).join('')}</div>`:'<p>还没有发布设备。填写设备信息并提交审核。</p>'}${renderPager(listingPage.meta,{basePath:'/customer/c2c'})}</section>
    <section class="panel"><h2>出租收入</h2>${renderC2CQuoteTable(quotes)}${renderPager(quotePage.meta,{basePath:'/customer/c2c'})}</section>`
  return buildLayout('我的出租',body,user)
}
