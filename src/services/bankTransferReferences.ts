/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

import type { Context } from 'hono'
import { customAlphabet } from 'nanoid'

// O/0 and I/1 are omitted to make bank statement searches less error-prone.
const randomCode = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 5)
type ReferenceScope = 'order' | 'topup'

export async function getBankTransferReference(c: Context, scope: ReferenceScope, sourceId: string): Promise<string> {
  const row = await c.env.RENT.prepare('SELECT code FROM bank_transfer_references WHERE scope = ? AND source_id = ?').bind(scope, sourceId).first() as { code: string } | null
  return row?.code || ''
}

export async function ensureBankTransferReference(c: Context, scope: ReferenceScope, sourceId: string): Promise<string> {
  const existing = await getBankTransferReference(c, scope, sourceId)
  if (existing) return existing
  for (let attempt = 0; attempt < 10; attempt++) {
    await c.env.RENT.prepare('INSERT OR IGNORE INTO bank_transfer_references (scope, source_id, code) VALUES (?, ?, ?)').bind(scope, sourceId, randomCode()).run()
    // A concurrent request may have inserted the same source or claimed this code.
    const stored = await getBankTransferReference(c, scope, sourceId)
    if (stored) return stored
  }
  throw new Error('暂时无法生成转账备注码，请稍后重试')
}

export interface BankTransferPayment {
  id: string
  source_id: string
  scope: ReferenceScope
  code: string | null
  order_no: string | null
  customer_name: string | null
  amount: number
  status: string
  created_at: string
}

export async function listBankTransferPayments(c: Context, search = ''): Promise<BankTransferPayment[]> {
  const code = search.trim().slice(0, 100).toUpperCase()
  const result = await c.env.RENT.prepare(`
    SELECT p.id AS id, p.rental_id AS source_id, 'order' AS scope, r.code, o.orderNo AS order_no,
           u.name AS customer_name, p.amount, p.status, p.created_at AS created_at
    FROM payments p
    JOIN orders o ON o.id = p.rental_id AND o.deleted_at IS NULL
    LEFT JOIN users u ON u.id = p.customer_id
    LEFT JOIN bank_transfer_references r ON r.scope = 'order' AND r.source_id = p.rental_id
    WHERE p.payment_method = 'bank_transfer'${code ? ' AND r.code = ?' : ''}
    UNION ALL
    SELECT bt.id AS id, bt.id AS source_id, 'topup' AS scope, r.code, NULL AS order_no,
           u.name AS customer_name, bt.amount, bt.status, bt.created_at AS created_at
    FROM balance_topups bt
    LEFT JOIN users u ON u.id = bt.user_id
    LEFT JOIN bank_transfer_references r ON r.scope = 'topup' AND r.source_id = bt.id
    WHERE bt.payment_method = 'bank_transfer'${code ? ' AND r.code = ?' : ''}
    ORDER BY created_at DESC, id DESC LIMIT 50
  `).bind(...(code ? [code, code] : [])).all() as { results: BankTransferPayment[] }
  return result.results || []
}
