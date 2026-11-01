/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

import { escapeHtml, sanitizeRichHtml } from '../lib/html'

export const ANNOUNCEMENT_MAX_LENGTH = 50000

export function readAnnouncementForm(form: Record<string, unknown>) {
  const title = String(form.title || '').trim(), message = String(form.message || '').trim()
  const titleEn = String(form.titleEn || '').trim(), messageEn = String(form.messageEn || '').trim()
  if (!title || !message || !titleEn || !messageEn) throw new Error('请填写中文和英文标题及内容')
  if (title.length > 120 || titleEn.length > 120) throw new Error('通告标题不能超过 120 字')
  if (message.length > ANNOUNCEMENT_MAX_LENGTH || messageEn.length > ANNOUNCEMENT_MAX_LENGTH) throw new Error('每种语言的通告内容不能超过 50000 字')
  return { title, message, titleEn, messageEn }
}

export function renderAnnouncementContent(value: unknown): string {
  const text = String(value ?? '')
  return /<\/?[a-z][^>]*>/i.test(text) ? sanitizeRichHtml(text) : escapeHtml(text).replace(/\r?\n/g, '<br>')
}

export function renderAnnouncementTitle(item: any): string {
  return `<span class="legal-lang" data-lang="zh" data-i18n-ignore>${escapeHtml(item.title)}</span><span class="legal-lang" data-lang="en" data-i18n-ignore hidden>${escapeHtml(item.title_en || item.title)}</span>`
}

export function renderAnnouncementMessage(item: any): string {
  return `<div class="legal-lang announcement-html" data-lang="zh" data-i18n-ignore>${renderAnnouncementContent(item.message)}</div><div class="legal-lang announcement-html" data-lang="en" data-i18n-ignore hidden>${renderAnnouncementContent(item.message_en || item.message)}</div>`
}
