/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

import type { Context } from 'hono'
import { CLIENT_ACCESS_KEY, CLIENT_FEATURES, normalizeClientAccess, readClientAccess } from '../../clientAccess'
import { createAuditLog } from '../../site'

export async function saveClientFeatures(c: Context) {
  const user = c.get('user') as any
  if (!user || user.role !== 'ADMIN') return c.text('无权限',403)
  const form = await c.req.parseBody()
  if (['console','web'].some(key=>String(form[`${key}_message`] || '').length > 500)) return c.text('提示文案最多 500 字',400)
  let before
  try { before = await readClientAccess(c.env.RENT) }
  catch(error) { if (!(error instanceof SyntaxError)) throw error; before=null }
  const settings = normalizeClientAccess({
    console: {enabled: form.console_enabled === 'on', message: String(form.console_message || '')},
    web: {enabled: form.web_enabled === 'on', message: String(form.web_message || '')},
    features: Object.fromEntries(CLIENT_FEATURES.map(([key])=>[key,form[`feature_${key}`] === 'on'])),
  })
  await c.env.RENT.prepare(`INSERT INTO systemSettings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updatedAt=CURRENT_TIMESTAMP,deleted_at=NULL`).bind(CLIENT_ACCESS_KEY,JSON.stringify(settings)).run()
  await createAuditLog(c,{actor:user,action:'UPDATE',targetType:'systemSettings',targetId:CLIENT_ACCESS_KEY,before,after:settings})
  return c.redirect('/admin/settings/client-features?saved=1',303)
}
