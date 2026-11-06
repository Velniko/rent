/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

import type { Context } from 'hono'
import { createAuditLog } from '../../site'
import { readWebsiteAdvertisementForm } from '../../domain/websiteAdvertisements'

export async function saveWebsiteAdvertisement(c: Context) {
  const user = c.get('user')
  if (!user || user.role !== 'ADMIN') return c.text('仅管理员可管理官网广告', 403)
  const form = await c.req.parseBody()
  let fields
  try { fields = readWebsiteAdvertisementForm(form) }
  catch (error) { return c.text(error instanceof Error ? error.message : '广告内容无效', 400) }
  const { title, message, titleEn, messageEn, expiresAt, linkUrl, linkText, linkTextEn } = fields
  const existingId = c.req.param('id')
  const id = existingId || `ad-${crypto.randomUUID()}`
  if (existingId) {
    const result = await c.env.RENT.prepare('UPDATE website_advertisements SET title = ?, message = ?, title_en = ?, message_en = ?, expires_at = ?, link_url = ?, link_text = ?, link_text_en = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .bind(title, message, titleEn, messageEn, expiresAt, linkUrl, linkText, linkTextEn, id).run()
    if (!result.meta?.changes) return c.text('广告不存在', 404)
  } else {
    await c.env.RENT.prepare('INSERT INTO website_advertisements (id, title, message, title_en, message_en, expires_at, link_url, link_text, link_text_en, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(id, title, message, titleEn, messageEn, expiresAt, linkUrl, linkText, linkTextEn, user.id).run()
  }
  await createAuditLog(c, { actor: user, action: existingId ? 'WEBSITE_AD_UPDATED' : 'WEBSITE_AD_PUBLISHED', targetType: 'WEBSITE_AD', targetId: id, after: { title, expiresAt } })
  return c.redirect('/admin/website-advertisements', 303)
}

export async function toggleWebsiteAdvertisement(c: Context) {
  const user = c.get('user')
  if (!user || user.role !== 'ADMIN') return c.text('仅管理员可管理官网广告', 403)
  const form = await c.req.parseBody()
  if (!['0', '1'].includes(String(form.active))) return c.text('广告状态无效', 400)
  const active = Number(form.active), id = String(c.req.param('id') || '')
  const result = await c.env.RENT.prepare('UPDATE website_advertisements SET active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(active, id).run()
  if (!result.meta?.changes) return c.text('广告不存在', 404)
  await createAuditLog(c, { actor: user, action: active ? 'WEBSITE_AD_PUBLISHED' : 'WEBSITE_AD_HIDDEN', targetType: 'WEBSITE_AD', targetId: id, after: { active } })
  return c.redirect('/admin/website-advertisements', 303)
}
