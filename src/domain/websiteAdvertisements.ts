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
  expires_at: string | null
  created_at: string
  updated_at: string
}

export function readWebsiteAdvertisementForm(form: Record<string, unknown>) {
  let fields
  try { fields = readAnnouncementForm(form) }
  catch (error) { throw new Error((error instanceof Error ? error.message : '广告内容无效').replaceAll('通告', '广告')) }
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
