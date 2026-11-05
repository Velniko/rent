/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

import { buildLayout } from '../../site'
import { escapeHtml } from '../../lib/html'
import { formatMelbourneDateTime } from '../../lib/format'
import { renderAnnouncementEditor } from '../partials/announcementEditor'
import type { WebsiteAdvertisement } from '../../domain/websiteAdvertisements'

export function renderAdminWebsiteAdvertisements(user: any, items: WebsiteAdvertisement[]): string {
  const expiryInput = (value = '', id = 'website-ad-expiry') => `<div class="form-group"><label class="form-label" for="${id}">下架日期和时间（选填）</label><input class="form-control" id="${id}" name="expiresAt" type="datetime-local" value="${escapeHtml(value)}"><small class="form-text">墨尔本时间</small></div>`
  const body = `<div class="page-header"><div><p class="section-code">WEBSITE / ADVERTISEMENTS</p><h2>官网广告</h2></div><a class="button button-secondary" href="/notifications">返回通知中心</a></div>
  <section class="panel"><h3>发布官网广告</h3><form method="post" action="/admin/website-advertisements">${renderAnnouncementEditor({}, 'website-ad', true)}${expiryInput()}<button class="button button-primary" type="submit">发布广告</button></form></section>
  <section class="panel"><h3>广告历史</h3>${items.length ? items.map(item => {
    const id = encodeURIComponent(item.id)
    const expired = item.expires_at && Date.parse(item.expires_at.replace(' ', 'T') + 'Z') <= Date.now()
    const status = !item.active ? '已下架' : expired ? '已过期' : '展示中'
    const expiry = item.expires_at ? formatMelbourneDateTime(item.expires_at).replace(' ', 'T') : ''
    return `<details class="record-archive__item"><summary class="record-archive__summary"><span class="record-archive__title">${escapeHtml(item.title)}</span><span class="record-archive__meta">${status} · ${escapeHtml(formatMelbourneDateTime(item.created_at))}</span></summary><div class="record-archive__body"><form method="post" action="/admin/website-advertisements/${id}">${renderAnnouncementEditor(item, 'website-ad-' + id, true)}${expiryInput(expiry, 'website-ad-expiry-' + id)}<button class="button button-primary" type="submit">保存广告</button></form><form method="post" action="/admin/website-advertisements/${id}/toggle"><input type="hidden" name="active" value="${item.active ? '0' : '1'}"><button class="button button-secondary" type="submit">${item.active ? '下架广告' : '重新上架广告'}</button></form></div></details>`
  }).join('') : '<p class="empty-state">暂无官网广告</p>'}</section>`
  return buildLayout('官网广告 - 电脑租赁管理系统', body, user)
}
