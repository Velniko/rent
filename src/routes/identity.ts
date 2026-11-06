/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

import type { WorkspaceApp } from './types'
import { renderForbidden } from '../pages/public/notFound'
import { renderCustomerIdentity } from '../pages/customer/identity'
import { renderAdminIdentity } from '../pages/admin/identity'
import { identityDocumentOption } from '../domain/identityDocument'
import { submitIdentityDocument, readIdentityDocument, reviewIdentityDocument } from '../services/identityVerification'
import { getUserById, logSensitiveDataAccess } from '../site'
import { createAuditLog } from '../services/audit'

export function registerIdentityRoutes(app: WorkspaceApp) {
app.get('/customer/identity', async (c) => {
  const user = c.get('user')
  if (!user || user.role !== 'CUSTOMER') return c.html(renderForbidden(), 403)
  c.header('Cache-Control', 'private, no-store')
  return c.html(await renderCustomerIdentity(c, user))
})
app.post('/customer/identity', async (c) => {
  const user = c.get('user')
  if (!user || user.role !== 'CUSTOMER') return c.html(renderForbidden(), 403)
  return c.text('请选择证件类型', 400)
})
app.get('/customer/identity/:kind', async (c) => {
  const user = c.get('user')
  if (!user || user.role !== 'CUSTOMER') return c.html(renderForbidden(), 403)
  const option = identityDocumentOption(c.req.param('kind'))
  if (!option) return c.text('页面不存在', 404)
  c.header('Cache-Control', 'private, no-store')
  return c.html(await renderCustomerIdentity(c, user, option))
})
app.post('/customer/identity/:kind', async (c) => {
  const user = c.get('user')
  if (!user || user.role !== 'CUSTOMER') return c.html(renderForbidden(), 403)
  const option = identityDocumentOption(c.req.param('kind'))
  if (!option) return c.text('页面不存在', 404)
  c.header('Cache-Control', 'private, no-store')
  const json = (c.req.header('Accept') || '').includes('application/json')
  try { await submitIdentityDocument(c, user, option.kind) }
  catch (error) {
    const message=error instanceof Error?error.message:'操作失败，请重试'
    return json ? c.json({ error:message },400) : c.html(await renderCustomerIdentity(c,user,option,message),400)
  }
  return json ? c.json({ redirect:'/customer/identity' }) : c.redirect('/customer/identity',303)
})
app.get('/admin/users/:id/identity', async (c) => {
  const admin = c.get('user')
  if (!admin || admin.role !== 'ADMIN') return c.html(renderForbidden(), 403)
  const target = await getUserById(c, c.req.param('id'))
  if (!target || target.role !== 'CUSTOMER') return c.text('客户不存在', 404)
  await logSensitiveDataAccess(c, { actorId: admin.id, targetUserId: target.id, field: 'identity_history', purpose: '身份审核' })
  await createAuditLog(c, { actor: admin, action: 'IDENTITY_HISTORY_VIEW', targetType: 'USER', targetId: target.id })
  c.header('Cache-Control', 'private, no-store')
  return c.html(await renderAdminIdentity(c, admin, target))
})
app.post('/admin/identity-documents/:id/view', async (c) => {
  const admin = c.get('user')
  if (!admin || admin.role !== 'ADMIN') return c.html(renderForbidden(), 403)
  const form = await c.req.parseBody()
  return readIdentityDocument(c, admin, c.req.param('id'), String(form.purpose || '').trim())
})
app.post('/admin/users/:id/identity-status', async (c) => {
  const admin = c.get('user')
  if (!admin || admin.role !== 'ADMIN') return c.html(renderForbidden(), 403)
  try { await reviewIdentityDocument(c, admin, c.req.param('id')) }
  catch (error) { return c.text(error instanceof Error?error.message:'操作失败，请重试', 400) }
  return c.redirect(`/admin/users/${encodeURIComponent(c.req.param('id'))}/identity`, 303)
})
}
