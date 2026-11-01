/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

import type { Context } from 'hono'
import { buildPaginationMeta, clampPageRequest, parsePageRequest } from '../lib/pagination'

export const DOCUMENT_TYPES: Record<string, string> = {
  settlement: '押金结算单', invoice: '发票', receipt: '付款收据', credit_note: '退款凭证',
  refund: '退款单', payment: '付款记录', transaction: '交易流水', contract: '合同',
}

const documentRows = `
  SELECT 'settlement' AS kind, id, settlement_number AS number, order_id, deposit_amount AS amount, 'AUD' AS currency, status, requested_at AS created_at, '' AS reference FROM deposit_settlements
  UNION ALL SELECT type, id, invoice_number, order_id, total_amount, currency, status, issued_at, '' FROM invoices
  UNION ALL SELECT 'receipt', id, receipt_number, order_id, total_paid, currency, status, issued_at, '' FROM receipts
  UNION ALL SELECT 'refund', id, COALESCE(refund_number, id), order_id, refund_amount, 'AUD', status, created_at, COALESCE(stripe_refund_id, '') FROM payment_refunds
  UNION ALL SELECT 'payment', id, COALESCE(transaction_id, id), rental_id, amount, currency, status, created_at, COALESCE(stripe_payment_intent_id, '') FROM payments
  UNION ALL SELECT 'transaction', id, transaction_number, order_id, amount, currency, status, created_at, COALESCE(provider_transaction_id, '') FROM transactions
  UNION ALL SELECT 'contract', id, contractNumber, orderId, NULL, 'AUD', status, createdAt, '' FROM contracts WHERE deleted_at IS NULL
`
const documentFrom = `FROM (${documentRows}) doc
  JOIN orders o ON o.id = doc.order_id
  LEFT JOIN users u ON u.id = o.userId
  WHERE o.deleted_at IS NULL`
const documentSelect = `SELECT doc.*, o.orderNo, u.name AS customerName, u.email AS customerEmail,
  CASE WHEN doc.kind = 'payment' AND doc.status = 'pending' AND o.deposit_payment_mode = 'PREAUTH'
    AND doc.reference = o.stripe_deposit_payment_intent_id AND o.deposit_status IN ('HELD', 'REFUND_PENDING')
    THEN 'authorized' ELSE doc.status END AS displayStatus`

export interface BusinessDocument {
  kind: string; id: string; number: string; order_id: string; amount: number | null; currency: string
  status: string; displayStatus: string; created_at: string; reference: string
  orderNo: string | null; customerName: string | null; customerEmail: string | null
}

export function documentPath(document: Pick<BusinessDocument, 'kind' | 'id'>): string {
  return `/admin/documents/${encodeURIComponent(document.kind)}/${encodeURIComponent(document.id)}`
}

function documentFilter(query: string, type = '') {
  let sql = ''
  const params: string[] = []
  if (Object.hasOwn(DOCUMENT_TYPES, type)) { sql += ' AND doc.kind = ?'; params.push(type) }
  if (query) {
    const like = `%${query.toLowerCase().replace(/[\\%_]/g, character => `\\${character}`)}%`
    sql += ` AND (${['doc.number', 'doc.id', 'doc.reference', 'o.id', 'o.orderNo', 'u.name', 'u.email'].map(field => `LOWER(COALESCE(${field}, '')) LIKE ? ESCAPE '\\'`).join(' OR ')})`
    params.push(...Array(7).fill(like))
  }
  return { sql, params }
}

export async function searchBusinessDocuments(c: Context, query: string): Promise<BusinessDocument[]> {
  const filter = documentFilter(query.trim().slice(0, 80))
  const result = await c.env.RENT.prepare(`${documentSelect} ${documentFrom} ${filter.sql} ORDER BY doc.created_at DESC, doc.kind, doc.id LIMIT 12`).bind(...filter.params).all()
  return (result.results || []) as BusinessDocument[]
}

export async function listBusinessDocuments(c: Context, query: string, type: string, page: unknown) {
  const filter = documentFilter(query, type)
  const total = Number((await c.env.RENT.prepare(`SELECT COUNT(*) AS total ${documentFrom} ${filter.sql}`).bind(...filter.params).first() as any)?.total || 0)
  const request = clampPageRequest(parsePageRequest(page), total)
  const result = await c.env.RENT.prepare(`${documentSelect} ${documentFrom} ${filter.sql} ORDER BY doc.created_at DESC, doc.kind, doc.id LIMIT ? OFFSET ?`).bind(...filter.params, request.pageSize, request.offset).all()
  const documents = (result.results || []) as BusinessDocument[]
  return { documents, meta: buildPaginationMeta(total, request, documents.length) }
}

export async function getBusinessDocument(c: Context, kind: string, id: string) {
  if (!Object.hasOwn(DOCUMENT_TYPES, kind)) return null
  const document = await c.env.RENT.prepare(`${documentSelect} ${documentFrom} AND doc.kind = ? AND doc.id = ?`).bind(kind, id).first() as BusinessDocument | null
  if (!document) return null
  const tables: Record<string, string> = { settlement: 'deposit_settlements', invoice: 'invoices', credit_note: 'invoices', receipt: 'receipts', refund: 'payment_refunds', payment: 'payments', transaction: 'transactions', contract: 'contracts' }
  const record = await c.env.RENT.prepare(`SELECT * FROM ${tables[kind]} WHERE id = ?`).bind(id).first() as Record<string, unknown> | null
  return { document, record: record || {} }
}

export function documentStatus(status: string): string {
  return ({ authorized: '已预授权', pending: '待确认', paid: '已扣款', refunded: '已退款', failed: '失败',
    issued: '已开具', succeeded: '已完成', PENDING: '待处理', SUCCESS: '已完成', FAILED: '失败',
    PENDING_MANAGER_APPROVAL: '待审批', APPROVED: '已批准', REJECTED: '已驳回', EXECUTED: '已执行', CANCELLED: '已取消',
    draft: '草稿', pending_sign: '待签署', signed: '已签署', cancelled: '已取消',
  } as Record<string, string>)[status] || status
}
