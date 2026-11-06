/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

import type { WorkspaceApp } from './types'
import { renderForbidden } from '../pages/public/notFound'
import { renderAdminStorage } from '../pages/admin/storage'
import { createAuditLog } from '../services/audit'
import { getStoredObject, readStoredObject, canReadSiteImage, repairStorageReplicas } from '../services/objectStorage'
import { archiveHistoricalData, migrateLegacyImages } from '../services/storageMaintenance'

export function registerStorageRoutes(app: WorkspaceApp) {
app.get('/admin/storage', async (c) => {
  const admin = c.get('user')
  if (!admin || admin.role !== 'ADMIN') return c.html(renderForbidden(), 403)
  c.header('Cache-Control', 'private, no-store')
  return c.html(await renderAdminStorage(c, admin))
})
for (const [operation, handler] of [['migrate', migrateLegacyImages], ['archive', archiveHistoricalData], ['repair', repairStorageReplicas]] as const) {
  app.post(`/admin/storage/${operation}`, async (c) => {
    const admin = c.get('user')
    if (!admin || admin.role !== 'ADMIN') return c.html(renderForbidden(), 403)
    await createAuditLog(c, { actor: admin, action: 'STORAGE_' + operation.toUpperCase(), targetType: 'STORAGE', targetId: operation })
    await handler(c)
    return c.redirect('/admin/storage', 303)
  })
}
app.post('/admin/storage/:id/download', async (c) => {
  const admin = c.get('user')
  if (!admin || admin.role !== 'ADMIN') return c.html(renderForbidden(), 403)
  const form = await c.req.parseBody(), purpose = String(form.purpose || '').trim()
  if (!purpose || purpose.length > 200) return c.text('请填写查看用途（最多200字）', 400)
  const object = await getStoredObject(c, c.req.param('id'))
  if (!object || object.storage_tier !== 'ARCHIVE') return c.text('文件不存在', 404)
  await createAuditLog(c, { actor: admin, action: 'ARCHIVE_DOWNLOAD', targetType: 'STORED_OBJECT', targetId: object.id, reason: purpose })
  return new Response(await readStoredObject(c, object), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store', 'Content-Disposition': `attachment; filename="archive-${object.id}.json"`, 'X-Content-Type-Options': 'nosniff' } })
})


app.get('/media/:id', async (c) => {
  const object = await getStoredObject(c, c.req.param('id'))
  if (!object || object.visibility === 'ADMIN') return c.text('文件不存在', 404)
  const user = c.get('user')
  if (!await canReadSiteImage(c, object, user)) return c.html(renderForbidden(), 403)
  return new Response(await readStoredObject(c, object), { headers: { 'Content-Type': object.content_type, 'Cache-Control': object.visibility === 'PUBLIC' ? 'public, max-age=86400' : 'private, no-store', 'X-Content-Type-Options': 'nosniff' } })
})

}
