/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

import type { Context } from 'hono'
import { buildLayout, sanitizePlainText } from '../../site'
import { identityStatusLabels } from '../customer/identity'
import { identityDocumentLabel } from '../../domain/identityDocument'
import { renderReasonPresets, IDENTITY_REJECTION_REASON_PRESETS } from '../../lib/reasonPresets'
export async function renderAdminIdentity(c: Context, admin: any, target: any): Promise<string> {
  const docs = (await c.env.RENT.prepare('SELECT d.id,d.document_type,d.document_kind,d.recognition_status,d.status,d.rejection_reason,d.reviewed_by,d.reviewed_at,d.created_at,o.deleted_at FROM identity_documents d JOIN stored_objects o ON o.id = d.object_id WHERE d.customer_id = ? ORDER BY d.rowid DESC LIMIT 50').bind(target.id).all()).results as any[]
  const logs = (await c.env.RENT.prepare(`SELECT l.actor_id,l.field_name,l.purpose,l.created_at FROM sensitive_data_access_logs l WHERE l.target_user_id = ? AND (l.field_name LIKE 'identity_document:%' OR l.field_name = 'identity_history') ORDER BY l.rowid DESC LIMIT 100`).bind(target.id).all()).results as any[]
  const esc = (value: unknown) => sanitizePlainText(value,500)
  const cards = docs.map((doc,i) => `<section class="panel"><h3>${esc(identityDocumentLabel(doc))} · ${esc(identityStatusLabels[doc.status])}</h3><p>${esc(doc.created_at)}</p><p><span class="badge ${doc.recognition_status === 'MATCH' ? 'badge-success' : 'badge-neutral'}">${doc.recognition_status === 'MATCH' ? '自动检查通过' : '待检查'}</span></p>
    ${doc.deleted_at ? '<p>材料已到期清理</p>' : `<form method="post" action="/admin/identity-documents/${encodeURIComponent(doc.id)}/view" target="_blank"><label class="form-label">查看用途</label><input class="form-control" name="purpose" maxlength="200" required><button class="button button-secondary" type="submit">查看证件</button></form>`}
    ${i === 0 && ['PENDING','VERIFIED'].includes(doc.status) ? `<form method="post" action="/admin/users/${encodeURIComponent(target.id)}/identity-status"><input type="hidden" name="documentId" value="${esc(doc.id)}"><label class="form-label">审核结果</label><select class="form-control" name="status"><option value="VERIFIED">已认证</option><option value="REJECTED">已拒绝</option><option value="EXPIRED">已过期</option></select><label class="form-label">拒绝原因（拒绝时必填）</label>${renderReasonPresets('identityRejectionReason', IDENTITY_REJECTION_REASON_PRESETS)}<textarea class="form-control" id="identityRejectionReason" name="rejectionReason" maxlength="500"></textarea><button class="button button-primary" type="submit">保存身份认证</button></form>` : ''}
    ${doc.rejection_reason ? `<p>${esc(doc.rejection_reason)}</p>` : ''}</section>`).join('') || '<p class="empty-state">暂无身份认证记录</p>'
  const rows = logs.map(row => `<tr><td>${esc(row.actor_id)}</td><td>${esc(row.purpose)}</td><td>${esc(row.field_name)}</td><td>${esc(row.created_at)}</td></tr>`).join('')
  return buildLayout('身份认证', `<div class="page-header"><h2>身份认证 · ${esc(target.name)}</h2><a class="button button-secondary" href="/admin/users/${encodeURIComponent(target.id)}">返回客户</a></div>${cards}<section class="panel"><h3>证件访问记录</h3><div class="table-wrapper"><table><thead><tr><th>管理员</th><th>查看用途</th><th>访问内容</th><th>时间</th></tr></thead><tbody>${rows || '<tr><td colspan="4">暂无访问记录</td></tr>'}</tbody></table></div></section>`, admin)
}
