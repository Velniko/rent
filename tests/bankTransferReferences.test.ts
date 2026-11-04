/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync, readdirSync } from 'node:fs'
import { URL } from 'node:url'
import worker from '../src/index'
import { createAuthSession, invalidateSystemSettingsCache } from '../src/site'
import { ensureBankTransferReference, getBankTransferReference, listBankTransferPayments } from '../src/services/bankTransferReferences'
import { extractInlineScripts } from './helpers'
import { createOrderPriceAdjustmentTransferPayment } from '../src/actions/stripePayments'

function database(sqlite: DatabaseSync) {
  return {
    prepare(sql: string) {
      let values: any[] = []
      const statement = {
        bind(...args: any[]) { values = args; return statement },
        async first() { return sqlite.prepare(sql).get(...values) || null },
        async all() { return { results: sqlite.prepare(sql).all(...values) } },
        async run() { return { success: true, meta: { changes: Number(sqlite.prepare(sql).run(...values).changes) } } },
      }
      return statement
    },
    async batch(statements: any[]) { return Promise.all(statements.map(statement => statement.run())) },
  }
}

async function setup(t: any) {
  const sqlite = new DatabaseSync(':memory:')
  t.after(() => sqlite.close())
  for (const name of readdirSync(new URL('../migrations/', import.meta.url)).filter(name => name.endsWith('.sql')).sort()) sqlite.exec(readFileSync(new URL(`../migrations/${name}`, import.meta.url), 'utf8'))
  sqlite.exec(`INSERT INTO users (id, name, email, role) VALUES ('ref-customer', '查账客户', 'transfer@example.test', 'CUSTOMER'), ('ref-admin', '管理员', 'transfer-admin@example.test', 'ADMIN');
    INSERT INTO devices (id, name, model, pricePerDay, depositAmount, serialNumber, status) VALUES ('ref-device', '测试电脑', 'Test', 20, 50, 'REF-SN', 'available');
    INSERT INTO orders (id, orderNo, userId, deviceId, startDate, endDate, rentalPeriod, totalAmount, depositAmount, status, paymentMethod)
      VALUES ('ref-order', 'OD-REFERENCE', 'ref-customer', 'ref-device', '2030-01-01', '2030-01-06', 5, 150, 50, 'pending_payment', 'bank_transfer');
    INSERT INTO payments (id, rental_id, customer_id, payment_method, amount, rental_amount, deposit_amount, currency, status)
      VALUES ('ref-payment', 'ref-order', 'ref-customer', 'bank_transfer', 150, 100, 50, 'AUD', 'pending');
    UPDATE systemSettings SET value = '{"bankTransfer":true,"stripe":false}' WHERE key = 'paymentMethods';`)
  invalidateSystemSettingsCache()
  const env = { RENT: database(sqlite) }
  const c = { env } as any
  const customer = await createAuthSession(c, 'ref-customer')
  const admin = await createAuthSession(c, 'ref-admin')
  const request = (path: string, actor = 'customer', form?: Record<string, string>) => worker.fetch(new Request(`https://rent.example${path}`, {
    method: form ? 'POST' : 'GET', body: form ? new URLSearchParams(form) : undefined,
    headers: { Cookie: `session=${actor === 'admin' ? admin.token : customer.token}`, Origin: 'https://rent.example', 'Sec-Fetch-Site': 'same-origin' },
  }), env, { waitUntil() {} } as any)
  return { sqlite, c, request }
}

function codeFromPage(html: string): string {
  const code = /data-bank-transfer-reference>([A-HJ-NP-Z2-9]{5})</.exec(html)?.[1]
  assert.ok(code, 'customer must see a five-character bank transfer reference')
  return code
}

test('references are stable under concurrent requests and globally unique across orders and top-ups', async t => {
  const { sqlite, c } = await setup(t)
  const codes = await Promise.all(Array.from({ length: 10 }, () => ensureBankTransferReference(c, 'order', 'ref-order')))
  assert.equal(new Set(codes).size, 1)
  assert.match(codes[0], /^[A-HJ-NP-Z2-9]{5}$/)
  assert.notEqual(await ensureBankTransferReference(c, 'topup', 'ref-order'), codes[0])
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM bank_transfer_references').get()?.n, 2)
  assert.throws(() => sqlite.prepare("INSERT INTO bank_transfer_references VALUES ('order', 'other', ?, CURRENT_TIMESTAMP)").run(codes[0]), /UNIQUE/)
  assert.throws(() => sqlite.prepare("INSERT INTO bank_transfer_references VALUES ('order', 'invalid', 'abc', CURRENT_TIMESTAMP)").run(), /CHECK/)
})

test('a random-code collision retries without changing the code already assigned to another order', async t => {
  const { c } = await setup(t)
  const existing = await ensureBankTransferReference(c, 'order', 'ref-order')
  const prepare = c.env.RENT.prepare.bind(c.env.RENT)
  let inserts = 0
  c.env.RENT.prepare = (sql: string) => {
    const statement = prepare(sql)
    if (sql.startsWith('INSERT OR IGNORE INTO bank_transfer_references')) {
      const bind = statement.bind.bind(statement)
      statement.bind = (scope: string, sourceId: string, code: string) => bind(scope, sourceId, ++inserts === 1 ? existing : code)
    }
    return statement
  }
  assert.notEqual(await ensureBankTransferReference(c, 'topup', 'new-topup'), existing)
  assert.equal(inserts, 2)
  assert.equal(await getBankTransferReference(c, 'order', 'ref-order'), existing)
})

test('the same order code appears on customer payment, finance search and both transfer review pages', async t => {
  const { sqlite, c, request } = await setup(t)
  const paymentPage = await request('/customer/orders/ref-order')
  assert.equal(paymentPage.status, 200)
  const html = await paymentPage.text()
  const code = codeFromPage(html)
  assert.match(html, /请在银行转账备注中填写此码/)
  assert.doesNotMatch(html, /并在备注中填写合同编号/)
  assert.equal(codeFromPage(await (await request('/customer/orders/ref-order')).text()), code)
  sqlite.prepare("INSERT INTO payment_proofs (id, payment_id, reference_number, image_url, status) VALUES ('ref-proof', 'ref-payment', 'BANK-TXN-987', 'https://images.example.test/proof.jpg', 'submitted')").run()
  for (const path of [`/admin/finance?transferCode=${code.toLowerCase()}`, '/admin/orders/ref-order', '/admin/exceptions']) {
    const response = await request(path, 'admin')
    assert.equal(response.status, 200, path)
    const adminHtml = await response.text()
    assert.ok(adminHtml.includes(code), path)
    for (const script of extractInlineScripts(adminHtml)) assert.doesNotThrow(() => new Function(script))
  }
  const matches = await listBankTransferPayments(c, code.toLowerCase())
  assert.equal(matches.length, 1)
  assert.equal(matches[0].id, 'ref-payment')
  assert.equal((await listBankTransferPayments(c, code + 'X')).length, 0)
  sqlite.exec("UPDATE payment_proofs SET status = 'rejected' WHERE id = 'ref-proof'")
  assert.equal(codeFromPage(await (await request('/customer/orders/ref-order')).text()), code)
  assert.equal(sqlite.prepare("SELECT reference_number FROM payment_proofs WHERE id = 'ref-proof'").get()?.reference_number, 'BANK-TXN-987')
})

test('bank top-ups get their own code before transfer and expose it in finance and top-up reviews', async t => {
  const { sqlite, c, request } = await setup(t)
  const created = await request('/customer/balance/top-up', 'customer', { amount: '60', method: 'bank_transfer' })
  assert.equal(created.status, 302)
  const topup = sqlite.prepare("SELECT id FROM balance_topups WHERE user_id = 'ref-customer'").get() as any
  const stored = await getBankTransferReference(c, 'topup', topup.id)
  assert.equal(codeFromPage(await (await request('/customer/balance/top-up')).text()), stored)
  sqlite.prepare("UPDATE balance_topups SET status = 'submitted', reference = 'BANK-TOPUP-TXN' WHERE id = ?").run(topup.id)
  for (const path of [`/admin/finance?transferCode=${stored}`, `/admin/orders/balance-topups?search=${stored.toLowerCase()}`, '/admin/exceptions']) {
    const response = await request(path, 'admin')
    assert.equal(response.status, 200, path)
    assert.ok((await response.text()).includes(stored), path)
  }
  const transfers = await listBankTransferPayments(c, stored)
  assert.equal(transfers.length, 1)
  assert.equal(transfers[0].scope, 'topup')
})

test('bank transfer adjustments reuse the order code and appear as a separate financial payment', async t => {
  const { sqlite, c, request } = await setup(t)
  const code = codeFromPage(await (await request('/customer/orders/ref-order')).text())
  sqlite.exec(`UPDATE orders SET status = 'active', totalAmount = 250 WHERE id = 'ref-order';
    UPDATE payments SET status = 'paid', amount = 100, rental_amount = 100, deposit_amount = 0 WHERE id = 'ref-payment';
    INSERT INTO contracts (id, orderId, contractNumber, content, status) VALUES ('ref-contract', 'ref-order', 'CTR-REFERENCE', '合同', 'signed');`)
  const page = await request('/customer/orders/ref-order')
  assert.equal(page.status, 200)
  assert.equal(codeFromPage(await page.text()), code)
  const payment = await createOrderPriceAdjustmentTransferPayment(c, { id: 'ref-customer', role: 'CUSTOMER' }, 'ref-order', 'bank_transfer')
  sqlite.prepare("INSERT INTO payment_proofs (id, payment_id, reference_number, image_url, status) VALUES ('adjustment-proof', ?, 'BANK-ADJUSTMENT-TXN', 'https://images.example.test/proof.jpg', 'submitted')").run(payment.paymentId)
  const transfers = await listBankTransferPayments(c, code)
  assert.equal(transfers.length, 2)
  assert.ok(transfers.every(transfer => transfer.code === code))
  const review = await (await request('/admin/orders/ref-order', 'admin')).text()
  assert.ok(review.includes(code))
  assert.match(review, /银行转账审核（差价）/)
})

test('card payments do not allocate transfer codes and customers cannot read admin reconciliation', async t => {
  const { sqlite, request } = await setup(t)
  sqlite.exec("UPDATE orders SET paymentMethod = 'card' WHERE id = 'ref-order'")
  assert.equal((await request('/customer/orders/ref-order')).status, 200)
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM bank_transfer_references').get()?.n, 0)
  assert.equal((await request('/admin/finance?transferCode=ABCDE')).status, 302)
})
