/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

import type { Context } from 'hono'
import { buildLayout, formatCurrency } from '../../site'
import type { User } from '../../site'
import { renderC2CPhotoGallery } from '../partials/c2cPhotos'
import { renderPager } from '../../lib/pagination'
import { escapeHtml } from '../../lib/html'
import { listC2CListings, listC2CQuotes, getC2CSettings, c2cModeLabels } from '../../services/c2c'
import { c2cStatus, renderC2CNotice, renderC2CQuoteTable, renderC2CPause } from '../customer/c2c'

export async function renderAdminC2C(c: Context,user: User): Promise<string> {
  const [listingPage,quotePage,settings]=await Promise.all([listC2CListings(c),listC2CQuotes(c),getC2CSettings(c)])
  const {listings}=listingPage, {quotes}=quotePage
  const body=`${renderC2CNotice(c)}<section class="panel"><div class="section-title"><div><p class="section-code">C2C</p><h2>个人设备管理</h2></div></div>
    <form method="post" action="/admin/c2c/commission"><div class="grid grid-2"><div><label class="form-label" for="c2c-commission">自行交付手续费 (%)</label><input class="form-control" id="c2c-commission" type="number" name="commission" value="${settings.commission_bps/100}" min="0" max="100" step="0.01" required></div><div><label class="form-label" for="c2c-managed-commission">托管手续费 (%)</label><input class="form-control" id="c2c-managed-commission" type="number" name="managedCommission" value="${settings.managed_commission_bps==null?'':settings.managed_commission_bps/100}" min="0" max="100" step="0.01"></div></div><label class="form-label" for="c2c-shipping-address">托管寄件地址</label><textarea class="form-control" id="c2c-shipping-address" name="shippingAddress" maxlength="500" rows="3">${escapeHtml(settings.shipping_address)}</textarea><button class="button button-primary" type="submit">保存出租设置</button></form></section>
    <section class="panel"><h2>设备发布审核</h2>${listings.length?`<div class="device-list grid grid-2">${listings.map(l=>`<article class="card"><div class="section-title"><h3>${escapeHtml(l.name)}</h3><span class="badge">${c2cStatus[l.status]}</span></div><p>设备主人: ${escapeHtml(l.owner_name)}</p><p>${c2cModeLabels[l.listing_mode]}</p><p>取件地址：${escapeHtml(l.pickup_address)}</p><p>型号: ${escapeHtml(l.model)}</p><p>序列号: ${escapeHtml(l.serial_number)}</p><p>${escapeHtml(l.description)}</p>${renderC2CPhotoGallery(l.photos_json)}<p>日租金: ${formatCurrency(l.daily_rate)} · 押金: ${formatCurrency(l.deposit)}</p>${l.review_note?`<p>${escapeHtml(l.review_note)}</p>`:''}
    ${l.status==='pending'?`<form method="post" action="/admin/c2c/${encodeURIComponent(l.id)}/review"><input type="hidden" name="action" value="approve">${l.listing_mode==='managed'?'<label class="form-check"><input type="checkbox" name="received" value="1" required> 已收到托管设备</label>':''}<button class="button button-primary" type="submit">审核通过</button></form><form method="post" action="/admin/c2c/${encodeURIComponent(l.id)}/review"><input type="hidden" name="action" value="reject"><label class="form-label">驳回原因<input class="form-control" name="note" maxlength="500" required></label><button class="button button-secondary" type="submit">驳回申请</button></form>`:l.status==='approved'?renderC2CPause(l,true):''}</article>`).join('')}</div>`:'<p>暂无设备发布申请。</p>'}${renderPager(listingPage.meta,{basePath:'/admin/c2c'})}</section>
    <section class="panel"><h2>主人结算</h2>${renderC2CQuoteTable(quotes,true)}${renderPager(quotePage.meta,{basePath:'/admin/c2c'})}</section>`
  return buildLayout('个人设备管理',body,user)
}
