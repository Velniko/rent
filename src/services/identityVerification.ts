/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

import type { Context } from 'hono'
import { storeObject, imageFiles, validateImageFile, getStoredObject, readStoredObject } from './objectStorage'
import { createAuditLog } from './audit'
import { hasOciStorage, ociRequest, storageBucket } from '../lib/ociStorage'
import { logSensitiveDataAccess } from '../site'
import { IDENTITY_DOCUMENT_KINDS, type IdentityDocumentKind } from '../domain/identityDocument'
import { recognizeIdentityDocument } from './identityRecognition'

export async function approvedIdentityDocument(c: Context, customerId: string): Promise<boolean> {
  const row = await c.env.RENT.prepare(`SELECT d.id FROM identity_documents d JOIN users u ON u.id = d.customer_id
    WHERE d.customer_id = ? AND d.status = 'VERIFIED' AND u.identity_status = 'VERIFIED'
    AND NOT EXISTS (SELECT 1 FROM identity_documents newer WHERE newer.customer_id = d.customer_id AND newer.rowid > d.rowid)
    LIMIT 1`).bind(customerId).first()
  return Boolean(row)
}
async function validateIdentityFile(file: File): Promise<{bytes:ArrayBuffer;contentType:string}> {
  if (file.size > 5 * 1024 * 1024) throw new Error('证件文件不能超过 5MB')
  if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
    const bytes = await file.arrayBuffer()
    const header = new TextDecoder().decode(bytes.slice(0,8)), tail = new TextDecoder().decode(bytes.slice(-4096))
    if (!/^%PDF-(?:1\.[0-9]|2\.0)/.test(header) || !tail.includes('%%EOF')) throw new Error('PDF 文件格式无效，请重新上传')
    return {bytes,contentType:'application/pdf'}
  }
  if (!['image/jpeg','image/png','image/webp'].includes(file.type)) throw new Error('仅支持 JPG、PNG、WebP 或 PDF 文件')
  return {bytes:await validateImageFile(file),contentType:file.type}
}
export async function submitIdentityDocument(c: Context, customer: any, kind: IdentityDocumentKind): Promise<void> {
  const locked = await c.env.RENT.prepare('SELECT id FROM identity_documents WHERE customer_id = ? AND certified_at IS NOT NULL LIMIT 1').bind(customer.id).first()
  if (locked) throw new Error('认证成功后不可更改')
  if (!IDENTITY_DOCUMENT_KINDS.includes(kind)) throw new Error('请选择证件类型')
  const form = await c.req.parseBody({ all: true })
  if (String(form.documentType || '') !== kind) throw new Error('证件类型与当前页面不符')
  const type = kind === 'VISA' ? 'VISA' : 'ID_CARD'
  const files = imageFiles(form.documentFile)
  if (files.length !== 1) throw new Error('请上传一份证件文件')
  const {bytes,contentType} = await validateIdentityFile(files[0])
  const recognition = await recognizeIdentityDocument(c, customer, kind, bytes, contentType)
  const object = await storeObject(c, { bytes, category: 'identity-documents', contentType, ownerId: customer.id, visibility: 'ADMIN' })
  const id = crypto.randomUUID()
  // One atomic batch invalidates earlier approval when replacement evidence is submitted.
  await c.env.RENT.batch([
    c.env.RENT.prepare("UPDATE identity_documents SET status = 'EXPIRED' WHERE customer_id = ? AND status IN ('PENDING','VERIFIED')").bind(customer.id),
    c.env.RENT.prepare("INSERT INTO identity_documents (id,customer_id,object_id,document_type,document_kind,recognition_status,recognition_confidence,recognition_model) VALUES (?,?,?,?,?,'MATCH',?,?)").bind(id, customer.id, object.id, type, kind, recognition.confidence, recognition.model),
    c.env.RENT.prepare("UPDATE users SET identity_status = 'PENDING', identity_verified_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND role = 'CUSTOMER'").bind(customer.id),
    c.env.RENT.prepare("INSERT INTO identity_verification_records (id,customer_id,status,verification_method) VALUES (?,?,'PENDING',?)").bind(crypto.randomUUID(), customer.id, kind),
  ])
  await createAuditLog(c, { actor: customer, action: 'IDENTITY_DOCUMENT_SUBMITTED', targetType: 'IDENTITY_DOCUMENT', targetId: id })
}
export async function readIdentityDocument(c: Context, admin: any, documentId: string, purpose: string): Promise<Response> {
  if (admin?.role !== 'ADMIN') return c.text('无权访问', 403)
  if (!purpose.trim() || purpose.length > 200) return c.text('请填写查看用途（最多200字）', 400)
  const doc = await c.env.RENT.prepare('SELECT * FROM identity_documents WHERE id = ?').bind(documentId).first() as any
  if (!doc) return c.text('证件不存在', 404)
  // Fail closed: no bytes are fetched, decrypted or returned unless both logs succeed.
  await logSensitiveDataAccess(c, { actorId: admin.id, targetUserId: doc.customer_id, field: 'identity_document:' + doc.id, purpose })
  await createAuditLog(c, { actor: admin, action: 'IDENTITY_DOCUMENT_VIEW', targetType: 'IDENTITY_DOCUMENT', targetId: doc.id, reason: purpose })
  const object = await getStoredObject(c, doc.object_id)
  if (!object || object.visibility !== 'ADMIN' || object.category !== 'identity-documents') return c.text('证件不存在', 404)
  const bytes = await readStoredObject(c, object)
  await createAuditLog(c, { actor: admin, action: 'IDENTITY_DOCUMENT_DELIVERED', targetType: 'IDENTITY_DOCUMENT', targetId: doc.id, reason: purpose })
  return new Response(bytes, { headers: { 'Content-Type': object.content_type, 'Cache-Control': 'private, no-store, max-age=0', Pragma: 'no-cache', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', 'Content-Disposition': `inline; filename="identity-${doc.id}.${object.content_type === 'application/pdf' ? 'pdf' : 'image'}"`, 'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'" } })
}
export async function reviewIdentityDocument(c: Context, admin: any, customerId: string): Promise<void> {
  if (admin?.role !== 'ADMIN') throw new Error('无权访问')
  const form = await c.req.parseBody(), id = String(form.documentId || ''), status = String(form.status || '')
  const reason = String(form.rejectionReason || '').trim().slice(0,500)
  if (!['VERIFIED','REJECTED','EXPIRED'].includes(status)) throw new Error('身份验证状态无效')
  if (status === 'REJECTED' && !reason) throw new Error('拒绝身份验证必须填写原因')
  // Only the current submission can change customer eligibility. Optimistic state
  // checks prevent a stale administrator form from approving replacement evidence.
  const doc = await c.env.RENT.prepare(`SELECT * FROM identity_documents WHERE id = ? AND customer_id = ? AND rowid = (SELECT MAX(rowid) FROM identity_documents WHERE customer_id = ?)`)
    .bind(id,customerId,customerId).first() as any
  if (!doc || !['PENDING','VERIFIED'].includes(doc.status)) throw new Error('请刷新后审核最新证件')
  if (status === 'VERIFIED') {
    if (!doc.certified_at && doc.recognition_status !== 'MATCH') throw new Error('请客户重新上传证件进行检查')
    const viewed = await c.env.RENT.prepare("SELECT id FROM audit_logs WHERE actor_id = ? AND action = 'IDENTITY_DOCUMENT_DELIVERED' AND target_id = ? LIMIT 1").bind(admin.id,id).first()
    if (!viewed) throw new Error('请先查看证件')
  }
  await c.env.RENT.batch([
    c.env.RENT.prepare(`UPDATE identity_documents SET status = ?, rejection_reason = ?, reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP, certified_at = CASE WHEN ? = 'VERIFIED' THEN COALESCE(certified_at,CURRENT_TIMESTAMP) ELSE certified_at END
      WHERE id = ? AND status = ? AND rowid = (SELECT MAX(rowid) FROM identity_documents WHERE customer_id = ?)`)
      .bind(status,reason || null,admin.id,status,id,doc.status,customerId),
    c.env.RENT.prepare(`UPDATE users SET identity_status = ?, identity_verified_at = CASE WHEN ? = 'VERIFIED' THEN CURRENT_TIMESTAMP ELSE NULL END, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND EXISTS (SELECT 1 FROM identity_documents WHERE id = ? AND status = ? AND reviewed_by = ? AND rowid = (SELECT MAX(rowid) FROM identity_documents WHERE customer_id = ?))`)
      .bind(status === 'REJECTED' ? 'FAILED' : status,status,customerId,id,status,admin.id,customerId),
    c.env.RENT.prepare(`INSERT INTO identity_verification_records (id,customer_id,status,verification_method,rejection_reason,verified_by,verified_at)
      SELECT ?,customer_id,status,document_kind,rejection_reason,reviewed_by,reviewed_at FROM identity_documents WHERE id = ? AND status = ? AND reviewed_by = ?`)
      .bind(crypto.randomUUID(),id,status,admin.id),
  ])
  await createAuditLog(c, { actor: admin, action: 'IDENTITY_DOCUMENT_REVIEWED', targetType: 'IDENTITY_DOCUMENT', targetId: id, after: { status }, reason: reason || undefined })
}

// Honor the existing identity-material retention policy on both physical copies.
// Approval facts and append-only access history survive material removal.
export async function purgeExpiredIdentityMaterials(c: Context): Promise<number> {
  if (!c.env.STORAGE_BACKUP) return 0
  const policy = await c.env.RENT.prepare("SELECT * FROM data_retention_policies WHERE category = 'IDENTITY_DOCUMENTS' AND enabled = 1").first() as any
  if (!policy || !['DELETE','ANONYMISE'].includes(policy.action)) return 0
  const days = Number(policy.retention_days)
  if (!Number.isInteger(days) || days < 0) throw new Error('保留天数无效')
  const rows = (await c.env.RENT.prepare(`SELECT o.*,d.id AS document_id,d.customer_id FROM identity_documents d JOIN stored_objects o ON o.id = d.object_id
    WHERE o.deleted_at IS NULL AND COALESCE(d.reviewed_at,d.created_at) <= datetime('now', ?) ORDER BY d.created_at LIMIT 5`).bind(`-${days} days`).all()).results as any[]
  for (const row of rows) {
    await createAuditLog(c, { action:'IDENTITY_MATERIAL_PURGE_REQUEST', targetType:'IDENTITY_DOCUMENT',targetId:row.document_id })
    if (row.oci_ready) {
      const response = await ociRequest(c.env,storageBucket(c.env,'STANDARD',true),row.object_key,'DELETE')
      const ok = response.ok || response.status === 404
      await response.body?.cancel()
      if (!ok) throw new Error('证件清理失败')
    }
    await c.env.STORAGE_BACKUP.delete(row.object_key)
    await c.env.RENT.batch([
      c.env.RENT.prepare('UPDATE stored_objects SET deleted_at = CURRENT_TIMESTAMP, oci_ready = 0, r2_ready = 0 WHERE id = ?').bind(row.id),
      c.env.RENT.prepare("UPDATE identity_documents SET status = 'EXPIRED' WHERE id = ? AND certified_at IS NULL").bind(row.document_id),
    ])
    await createAuditLog(c, { action:'IDENTITY_MATERIAL_PURGED',targetType:'IDENTITY_DOCUMENT',targetId:row.document_id })
  }
  return rows.length
}
