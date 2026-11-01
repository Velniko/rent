/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

import test from 'node:test'
import assert from 'node:assert/strict'
import { Miniflare } from 'miniflare'
import { getBusinessDocument, listBusinessDocuments, searchBusinessDocuments } from '../src/services/documents'

test('document queries work within the D1 compound SELECT limit', async t => {
  // node:sqlite accepts the original seven-way UNION; use the same D1 runtime as Wrangler.
  const mf = new Miniflare({ modules: true, script: '', d1Databases: { RENT: 'documents-regression' } })
  t.after(() => mf.dispose())
  const db = await mf.getD1Database('RENT')
  const context = { env: { RENT: db } } as any
  await assert.rejects(() => db.prepare('SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7').all(), /too many terms in compound SELECT/)
  const schema = [
    'orders (id TEXT PRIMARY KEY, userId, orderNo, deleted_at, deposit_payment_mode, stripe_deposit_payment_intent_id, deposit_status)',
    'users (id TEXT PRIMARY KEY, name, email)',
    'deposit_settlements (id TEXT PRIMARY KEY, settlement_number, order_id, deposit_amount, status, requested_at)',
    'invoices (id TEXT PRIMARY KEY, type, invoice_number, order_id, total_amount, currency, status, issued_at)',
    'receipts (id TEXT PRIMARY KEY, receipt_number, order_id, total_paid, currency, status, issued_at)',
    'payment_refunds (id TEXT PRIMARY KEY, refund_number, order_id, refund_amount, status, created_at, stripe_refund_id)',
    'payments (id TEXT PRIMARY KEY, transaction_id, rental_id, amount, currency, status, created_at, stripe_payment_intent_id)',
    'transactions (id TEXT PRIMARY KEY, transaction_number, order_id, amount, currency, status, created_at, provider_transaction_id)',
    'contracts (id TEXT PRIMARY KEY, contractNumber, orderId, status, createdAt, deleted_at)',
  ]
  await db.batch(schema.map(definition => db.prepare(`CREATE TABLE ${definition}`)))
  await db.batch([
    db.prepare("INSERT INTO users VALUES ('customer', '测试客户', 'customer@example.test')"),
    db.prepare("INSERT INTO orders VALUES ('order', 'customer', 'OD-TEST', NULL, 'PREAUTH', 'pi_held', 'HELD')"),
    db.prepare("INSERT INTO orders VALUES ('deleted-order', 'customer', 'OD-DELETED', '2026-11-01', NULL, NULL, NULL)"),
    db.prepare("INSERT INTO deposit_settlements VALUES ('settlement', 'DST-20261101-HOQV9M', 'order', 200, 'APPROVED', '2026-11-01')"),
    db.prepare("INSERT INTO deposit_settlements VALUES ('hidden', 'DST-HIDDEN', 'deleted-order', 200, 'APPROVED', '2026-11-01')"),
    db.prepare("INSERT INTO invoices VALUES ('invoice', 'invoice', 'INV-1', 'order', 100, 'AUD', 'issued', '2026-11-01')"),
    db.prepare("INSERT INTO invoices VALUES ('credit', 'credit_note', 'CN-1', 'order', 10, 'AUD', 'issued', '2026-11-01')"),
    db.prepare("INSERT INTO receipts VALUES ('receipt', 'RCT-1', 'order', 100, 'AUD', 'issued', '2026-11-01')"),
    db.prepare("INSERT INTO payment_refunds VALUES ('refund', 'RF-1', 'order', 10, 'succeeded', '2026-11-01', 're_refund')"),
    db.prepare("INSERT INTO payments VALUES ('payment', 'TXN-PAYMENT', 'order', 300, 'AUD', 'pending', '2026-11-01', 'pi_held')"),
    db.prepare("INSERT INTO transactions VALUES ('transaction', 'TXN-1', 'order', 100, 'AUD', 'SUCCESS', '2026-11-01', 'provider-1')"),
    db.prepare("INSERT INTO contracts VALUES ('contract', 'CON-1', 'order', 'signed', '2026-11-01', NULL)"),
    db.prepare("INSERT INTO contracts VALUES ('deleted-contract', 'CON-HIDDEN', 'order', 'signed', '2026-11-01', '2026-11-01')"),
  ])

  await t.test('all document kinds and their detail records remain accessible', async () => {
    const listing = await listBusinessDocuments(context, '', '', 1)
    assert.equal(listing.meta.total, 8)
    assert.deepEqual(listing.documents.map(doc => doc.kind).sort(), ['contract', 'credit_note', 'invoice', 'payment', 'receipt', 'refund', 'settlement', 'transaction'])
    assert.equal(listing.documents.find(doc => doc.kind === 'payment')?.displayStatus, 'authorized')
    for (const doc of listing.documents) {
      const detail = await getBusinessDocument(context, doc.kind, doc.id)
      assert.equal(detail?.document.id, doc.id)
      assert.equal(detail?.record.id, doc.id)
    }
    assert.equal(await getBusinessDocument(context, 'settlement', 'hidden'), null)
    assert.equal(await getBusinessDocument(context, 'contract', 'deleted-contract'), null)
  })

  await t.test('quick search and document filters find the settlement number', async () => {
    const results = await searchBusinessDocuments(context, 'DST-20261101-HOQV9M')
    assert.equal(results.length, 1)
    assert.equal(results[0].id, 'settlement')
    assert.equal((await listBusinessDocuments(context, 'HOQV9M', 'settlement', 1)).meta.total, 1)
    assert.equal((await listBusinessDocuments(context, 'HOQV9M', 'invoice', 1)).meta.total, 0)
    assert.equal((await searchBusinessDocuments(context, '%')).length, 0)
  })

  await t.test('pagination sorts the combined sources globally without missing or repeating rows', async () => {
    await db.batch(Array.from({ length: 55 }, (_, index) => db.prepare("INSERT INTO payments VALUES (?, NULL, 'order', 1, 'AUD', 'paid', '2026-11-02', NULL)").bind(`extra-${String(index).padStart(2, '0')}`)))
    const first = await listBusinessDocuments(context, '', '', 1)
    const second = await listBusinessDocuments(context, '', '', 2)
    assert.equal(first.meta.total, 63)
    assert.equal(first.documents.length, 50)
    assert.equal(second.documents.length, 13)
    const combined = [...first.documents, ...second.documents]
    assert.equal(new Set(combined.map(doc => `${doc.kind}:${doc.id}`)).size, 63)
    assert.ok(first.documents.every(doc => doc.created_at === '2026-11-02'))
    assert.deepEqual(second.documents.slice(0, 5).map(doc => doc.id), ['extra-50', 'extra-51', 'extra-52', 'extra-53', 'extra-54'])
    const quick = await searchBusinessDocuments(context, 'customer@example.test')
    assert.equal(quick.length, 12)
    assert.deepEqual(quick.map(doc => doc.id), first.documents.slice(0, 12).map(doc => doc.id))
  })
})
