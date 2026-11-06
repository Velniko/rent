/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

import { readAnnouncementForm } from './announcement'
import { formatMelbourneDateTime } from '../lib/format'

export interface WebsiteAdvertisement {
  id: string
  title: string
  message: string
  title_en: string
  message_en: string
  active: number
  link_url: string | null
  link_text: string | null
  link_text_en: string | null
  expires_at: string | null
  created_at: string
  updated_at: string
}

/** 「查看详情」按钮的链接：只允许 http(s) 外链或站内绝对路径，拒绝 javascript: 等危险协议。 */
function readAdvertisementLinkUrl(raw: string): string | null {
  const value = raw.trim()
  if (!value) return null
  if (value.length > 2048) throw new Error('广告链接过长')
  if (value.startsWith('/')) {
    if (value.startsWith('//') || value.startsWith('/\\')) throw new Error('广告链接无效')
    return value
  }
  let parsed: URL
  try { parsed = new URL(value) }
  catch { throw new Error('广告链接无效，请填写完整网址（https://...）或以 / 开头的站内路径') }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('广告链接只能是 http(s) 网址或站内路径')
  return parsed.toString()
}

export function readWebsiteAdvertisementForm(form: Record<string, unknown>) {
  let fields
  try { fields = readAnnouncementForm(form) }
  catch (error) { throw new Error((error instanceof Error ? error.message : '广告内容无效').replaceAll('通告', '广告')) }
  const linkUrl = readAdvertisementLinkUrl(String(form.linkUrl || ''))
  const linkText = String(form.linkText || '').trim().slice(0, 40) || null
  const linkTextEn = String(form.linkTextEn || '').trim().slice(0, 40) || null
  fields = { ...fields, linkUrl, linkText: linkUrl ? linkText : null, linkTextEn: linkUrl ? linkTextEn : null }
  const local = String(form.expiresAt || '').trim()
  let expiresAt: string | null = null
  if (local) {
    const invalid = () => new Error('下架日期和时间格式无效')
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) throw invalid()
    const localMs = Date.parse(local + ':00Z')
    if (!Number.isFinite(localMs) || new Date(localMs).toISOString().slice(0, 16) !== local) throw invalid()
    let utcMs = localMs
    // Convert the Melbourne wall clock, including daylight saving, to D1 UTC.
    for (let i = 0; i < 3; i++) {
      const rendered = formatMelbourneDateTime(new Date(utcMs)).replace(' ', 'T')
      utcMs += localMs - Date.parse(rendered + ':00Z')
    }
    if (formatMelbourneDateTime(new Date(utcMs)).replace(' ', 'T') !== local) throw invalid()
    expiresAt = new Date(utcMs).toISOString().replace('T', ' ').slice(0, 19)
  }
  return { ...fields, expiresAt }
}
