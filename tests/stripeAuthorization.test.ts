/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync, readdirSync } from 'node:fs'
import { URL } from 'node:url'
import { createHmac } from 'node:crypto'
import { Hono } from 'hono'
import { createOrderPaymentIntent, handleStripeWebhook, refundDeposit, settleCompletedOrderAuthorization } from '../src/actions/stripePayments'
import { saveStripeConfig } from '../src/stripe'
import { createAuthSession, formatMelbourneDateTime, getOrderById, reconcileOrderPayments, runDataConsistencyChecks } from '../src/site'
import worker from '../src/index'
import { renderAdminOrderDetail } from '../src/pages/admin/orderDetail'
import { renderCustomerOrderDetail } from '../src/pages/customer/orderDetail'
import { renderStaffInspection } from '../src/pages/staff/inspection'
import { renderStaffOrderDetail } from '../src/pages/staff/orderDetail'
import { getAdminDashboardData } from '../src/services/adminDashboard'
import { getStaffDashboardData } from '../src/services/staffDashboard'
import { getAdminOrderStats } from '../src/pages/admin/orders'
import { getRevenueData, renderAdminRevenueStats } from '../src/pages/admin/revenueStats'
import { renderAdminFinance } from '../src/pages/admin/finance'
import { listBusinessDocuments, searchBusinessDocuments } from '../src/services/documents'
import { renderInvoice } from '../src/pages/invoice'
import { buildPaymentReceiptDocument, buildTaxInvoiceDocument } from '../src/services/notifications'
import { extractInlineScripts } from './helpers'

async function setup(t: any, options: { rental?: number; status?: string; mode?: string } = {}) {
  const sqlite = new DatabaseSync(':memory:')
  t.after(() => sqlite.close())
  for (const name of readdirSync(new URL('../migrations/', import.meta.url)).filter(n => n.endsWith('.sql')).sort()) sqlite.exec(readFileSync(new URL(`../migrations/${name}`, import.meta.url), 'utf8'))
  sqlite.exec("UPDATE systemSettings SET value = '{\"stripe\":true,\"processingFeeRate\":0.025}' WHERE key = 'paymentMethods'")
  sqlite.exec("INSERT INTO users (id, name, email, role, balance) VALUES ('customer', '客户', 'customer@example.test', 'CUSTOMER', 12), ('admin', '管理员', 'admin@example.test', 'ADMIN', 0); INSERT INTO devices (id, name, model, pricePerDay, depositAmount, serialNumber, status) VALUES ('device', '电脑', 'Test', 20, 200, 'SN1', 'rented');")
  const rental = options.rental ?? 100
  sqlite.prepare("INSERT INTO orders (id, userId, deviceId, startDate, endDate, rentalPeriod, totalAmount, depositAmount, status, paymentMethod, deposit_method, deposit_payment_mode, deposit_status, stripe_deposit_payment_intent_id, refundMethod) VALUES ('order', 'customer', 'device', '2026-10-24', '2026-10-29', 5, ?, 200, ?, 'card', 'card_hold', ?, 'HELD', 'pi_auth', 'balance')").run(rental + 200, options.status || 'completed', options.mode || 'PREAUTH')
  sqlite.prepare("INSERT INTO payments (id, rental_id, customer_id, payment_method, amount, rental_amount, deposit_amount, processing_fee, status, stripe_payment_intent_id) VALUES ('payment', 'order', 'customer', 'card', ?, ?, 200, ?, 'pending', 'pi_auth')").run(rental + 200 + rental * 0.025, rental, rental * 0.025)
  const db = {
    prepare(sql: string) {
      let values: any[] = []
      const query = {
        bind(...input: any[]) { values = input; return query },
        async first() { return sqlite.prepare(sql).get(...values) || null },
        async all() { return { results: sqlite.prepare(sql).all(...values) } },
        async run() { const result = sqlite.prepare(sql).run(...values); return { success: true, meta: { changes: Number(result.changes) } } },
      }
      return query
    },
    async batch(statements: any[]) {
      sqlite.exec('BEGIN')
      try { const results = await Promise.all(statements.map(s => s.run())); sqlite.exec('COMMIT'); return results }
      catch (error) { sqlite.exec('ROLLBACK'); throw error }
    },
  }
  const env = { RENT: db, SETTINGS_ENCRYPTION_KEY: 'test-only-encryption-key', CLOUDINARY_CLOUD_NAME: 'demo', CLOUDINARY_API_KEY: 'test-key', CLOUDINARY_API_SECRET: 'test-secret' }
  const context = { env } as any
  await saveStripeConfig(context, { publishableKey: 'pk_test_example', secretKey: 'sk_test_example', webhookSecret: 'whsec_example' })
  const calls: Array<{ path: string; params: URLSearchParams; method: string }> = []
  let intent: any = { id: 'pi_auth', status: 'requires_capture', currency: 'aud', amount: Math.round((rental * 1.025 + 200) * 100), amount_capturable: Math.round((rental * 1.025 + 200) * 100), amount_received: 0, capture_method: 'manual', metadata: { order_id: 'order', customer_id: 'customer', type: 'rental_authorization' }, client_secret: 'pi_auth_secret_test' }
  const fetchBefore = globalThis.fetch
  globalThis.fetch = (async (url: any, init: any) => {
    if (String(url) === 'https://api.cloudinary.com/v1_1/demo/image/upload') return Response.json({ secure_url: 'https://res.cloudinary.com/demo/image/upload/damage.jpg' })
    const path = String(url).replace('https://api.stripe.com/v1/', '')
    const params = new URLSearchParams(init?.body)
    calls.push({ path, params, method: init?.method || 'GET' })
    assert.ok(String(url).startsWith('https://api.stripe.com/'), `Unexpected request: ${url}`)
    if (path.startsWith('customers?')) return Response.json({ data: [] })
    if (path.startsWith('customers')) return Response.json({ id: 'cus_test' })
    if (path.startsWith('payment_methods/')) return Response.json({ id: 'pm_card', customer: 'cus_test', card: { brand: 'visa' } })
    if (path === 'payment_intents/pi_auth/capture') {
      if (params.has('final_capture')) return Response.json({ error: { message: "The PaymentIntent doesn't support multi-capture. When capturing this PaymentIntent, you can't pass the `final_capture` parameter." } }, { status: 400 })
      intent = { ...intent, status: 'succeeded', amount_received: Number(params.get('amount_to_capture')), amount_capturable: 0 }
    }
    else if (path === 'payment_intents/pi_auth/cancel') intent = { ...intent, status: 'canceled', amount_capturable: 0 }
    else assert.ok(path.startsWith('payment_intents'), `Unexpected Stripe request: ${path}`)
    return Response.json(intent)
  }) as typeof fetch
  t.after(() => { globalThis.fetch = fetchBefore })
  const settle = (form: Record<string, string>) => {
    const settlementApp = new Hono()
    settlementApp.post('/', c => refundDeposit(c, { id: 'admin' }, 'order', form))
    return settlementApp.request('https://example.test/', { method: 'POST' }, env)
  }
  return { sqlite, db, context, calls, settle, intent, setIntent: (value: any) => { intent = { ...intent, ...value } } }
}

async function requestAsAdmin(context: any, path: string, form: Record<string, string | File>) {
  const body = new FormData()
  for (const [key, value] of Object.entries(form)) body.set(key, value)
  const session = await createAuthSession(context, 'admin')
  return worker.fetch(new Request(`https://rent.example.test${path}`, {
    method: 'POST', body,
    headers: { Cookie: `session=${session.token}`, Origin: 'https://rent.example.test', 'Sec-Fetch-Site': 'same-origin' },
  }), context.env, { waitUntil() {} } as any)
}

const inspectionForm = (damage = 0) => ({
  screenCondition: '正常', keyboardCondition: '正常', trackpadCondition: '正常', bodyCondition: '正常',
  cameraCondition: '正常', wifiCondition: '正常', powerTest: '正常', replacementCost: String(damage),
  ...(damage ? { damageDescription: '设备损坏', damagePhotoFiles: new File(['image'], 'damage.png', { type: 'image/png' }) } : {}),
})

test('a failed capture awaiting settlement remains authorized rather than awaiting payment', async t => {
  const { sqlite, context, setIntent } = await setup(t)
  setIntent({ status: 'requires_capture', amount_capturable: 0 })
  const app = new Hono()
  app.post('/', async c => (await settleCompletedOrderAuthorization(c, { id: 'admin' }, 'order')) || c.text('done'))
  assert.equal((await app.request('https://example.test/', { method: 'POST' }, context.env)).status, 409)
  assert.equal(sqlite.prepare('SELECT deposit_status FROM orders').get()?.deposit_status, 'REFUND_PENDING')
  const reconciliation = await reconcileOrderPayments(context, 'order')
  assert.equal(reconciliation.authorizedTotal, 302.5)
  assert.equal(reconciliation.pendingTotal, 0)
  const html = await renderAdminOrderDetail(context, { id: 'admin', role: 'ADMIN' }, 'order')
  assert.match(html, /已预授权 AUD\$302\.50/)
  assert.doesNotMatch(html, /笔付款待确认|状态为待确认/)
  sqlite.exec("UPDATE orders SET deposit_status = 'PENDING'")
  assert.equal((await reconcileOrderPayments(context, 'order')).pendingTotal, 302.5)
})

test('authorization invoice is available before capture and retains its number after capture', async t => {
  const { sqlite, context, calls, settle } = await setup(t)
  sqlite.exec("INSERT INTO contracts (id, orderId, contractNumber, content, signed_content, status, signedAt) VALUES ('contract', 'order', 'CONTRACT1', '<p>合同</p>', '<p>已签署</p>', 'signed', CURRENT_TIMESTAMP)")
  const html = await renderInvoice(context, { id: 'admin', role: 'ADMIN' }, 'order')
  const invoice = sqlite.prepare('SELECT * FROM invoices').get() as any
  assert.equal(invoice.total_amount, 302.5)
  assert.match(html, /已预授权/)
  assert.doesNotMatch(html, /已付款|打印.*付款收据/)
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM receipts').get()?.count, 0)
  const order = await getOrderById(context, 'order')
  const documentContext = { ...context, req: { url: 'https://example.test/' } }
  assert.equal(await buildPaymentReceiptDocument(documentContext, order), null)
  const taxInvoice = await buildTaxInvoiceDocument(documentContext, order)
  assert.ok(taxInvoice)
  assert.match(new TextDecoder().decode(taxInvoice.pdf), /Authorized/)
  assert.doesNotMatch(new TextDecoder().decode(taxInvoice.pdf), /\(Paid:/)
  assert.ok(!calls.some(call => call.path.endsWith('/capture')))
  assert.equal((await settle({ refundAmount: '200', refundMethod: 'original' })).status, 303)
  const capturedInvoice = sqlite.prepare('SELECT * FROM invoices').get() as any
  assert.equal(capturedInvoice.invoice_number, invoice.invoice_number)
  assert.equal(capturedInvoice.receipt_number, invoice.receipt_number)
  assert.equal(capturedInvoice.total_amount, 102.5)
  assert.equal(sqlite.prepare('SELECT total_paid FROM receipts').get()?.total_paid, 102.5)
})

test('quick search and document center retrieve settlement, invoice, receipt and payment records', async t => {
  const { sqlite, context } = await setup(t)
  const app = new Hono()
  app.post('/', async c => (await settleCompletedOrderAuthorization(c, { id: 'admin' }, 'order')) || c.text('done'))
  assert.equal((await app.request('https://example.test/', { method: 'POST' }, context.env)).status, 303)
  sqlite.exec("UPDATE deposit_settlements SET settlement_number = 'DST-20261101-HOQV9M'")
  const settlement = sqlite.prepare('SELECT id FROM deposit_settlements').get() as any
  const session = await createAuthSession(context, 'admin')
  const get = (path: string) => worker.fetch(new Request(`https://example.test${path}`, { headers: { Cookie: `session=${session.token}` } }), context.env, { waitUntil() {} } as any)
  const response = await get('/api/search?q=DST-20261101-HOQV9M')
  assert.equal(response.status, 200)
  const payload = await response.json() as any
  assert.equal(payload.documents.length, 1)
  assert.equal(payload.documents[0].number, 'DST-20261101-HOQV9M')
  assert.equal(payload.documents[0].target, `/admin/documents/settlement/${settlement.id}`)
  const detail = await get(payload.documents[0].target)
  assert.equal(detail.status, 200)
  assert.match(await detail.text(), /DST-20261101-HOQV9M/)
  const listing = await get('/admin/documents?q=HOQV9M&type=settlement')
  assert.equal(listing.status, 200)
  assert.match(await listing.text(), /DST-20261101-HOQV9M/)
  const all = await listBusinessDocuments(context, '', '', '1')
  for (const kind of ['settlement', 'invoice', 'receipt', 'payment', 'transaction']) assert.ok(all.documents.some(doc => doc.kind === kind), kind)
  for (const doc of all.documents) {
    assert.ok((await searchBusinessDocuments(context, doc.number)).some(result => result.id === doc.id && result.kind === doc.kind))
  }
  assert.equal((await get('/admin/documents/settlement/missing')).status, 404)
  assert.equal((await get('/admin/documents/constructor/missing')).status, 404)
  sqlite.prepare('UPDATE deposit_settlements SET deduction_reason = ?').run('<img src=x onerror=alert(1)>')
  const safeDetail = await (await get(payload.documents[0].target)).text()
  assert.match(safeDetail, /&lt;img src=x onerror=alert\(1\)&gt;/)
  assert.doesNotMatch(safeDetail, /<img src=x/)
})

test('document search escapes wildcards, paginates and does not expose admin documents to customers', async t => {
  const { sqlite, context } = await setup(t)
  for (let i = 0; i < 55; i++) sqlite.prepare("INSERT INTO payments (id, rental_id, customer_id, payment_method, amount, rental_amount, deposit_amount, status) VALUES (?, 'order', 'customer', 'card', 1, 1, 0, 'pending')").run(`payment-${i}`)
  const first = await listBusinessDocuments(context, 'payment-', 'payment', 1)
  const second = await listBusinessDocuments(context, 'payment-', 'payment', 2)
  assert.equal(first.meta.total, 55)
  assert.equal(first.documents.length, 50)
  assert.equal(second.documents.length, 5)
  assert.ok(second.documents.every(doc => !first.documents.some(previous => previous.id === doc.id)))
  assert.equal((await searchBusinessDocuments(context, '%')).length, 0)
  assert.equal((await searchBusinessDocuments(context, "' OR 1=1 --")).length, 0)
  const session = await createAuthSession(context, 'customer')
  const get = (path: string) => worker.fetch(new Request(`https://example.test${path}`, { headers: { Cookie: `session=${session.token}` } }), context.env, { waitUntil() {} } as any)
  assert.equal((await get('/admin/documents')).status, 403)
  assert.equal((await get('/admin/documents/payment/payment')).status, 403)
  const payload = await (await get('/api/search?q=payment')).json() as any
  assert.deepEqual(payload.documents, [])
})

for (const damage of [0, 25, 200]) {
  test(`completing return inspection captures rent, fee and ${damage} damage automatically`, async t => {
    const { sqlite, calls, context } = await setup(t, { status: 'active' })
    sqlite.exec("UPDATE orders SET refundMethod = 'original'; INSERT INTO contracts (id, orderId, contractNumber, content) VALUES ('contract', 'order', 'CONTRACT1', '<p>合同</p>')")
    const html = await renderStaffInspection(context, { id: 'admin', role: 'ADMIN' }, 'order')
    assert.match(html, /保存验机并结算/)
    assert.match(html, /损坏扣款金额（AUD）/)
    const response = await requestAsAdmin(context, '/staff/orders/order/inspection', inspectionForm(damage))
    assert.equal(response.status, 302, await response.text())
    assert.equal(response.headers.get('location'), '/admin/orders/order')
    assert.equal(calls.find(c => c.path.endsWith('/capture'))?.params.get('amount_to_capture'), String(10250 + damage * 100))
    assert.equal(sqlite.prepare('SELECT status FROM orders').get()?.status, 'completed')
    assert.equal(sqlite.prepare('SELECT settlement_status FROM orders').get()?.settlement_status, 'SETTLED')
    assert.equal(sqlite.prepare('SELECT status FROM deposit_settlements').get()?.status, 'EXECUTED')
    assert.equal(sqlite.prepare('SELECT deposit_deduction_amount FROM orders').get()?.deposit_deduction_amount, damage)
    if (damage) assert.equal(sqlite.prepare("SELECT status FROM devices WHERE id = 'device'").get()?.status, 'maintenance')
    assert.equal((await requestAsAdmin(context, '/staff/orders/order/inspection', inspectionForm(damage))).status, 409)
    assert.equal(calls.filter(c => c.path.endsWith('/capture')).length, 1)
  })
}

test('force completion settles the stored rent and fee without inventing a fee for an old authorization', async t => {
  const { sqlite, calls, context, setIntent } = await setup(t, { status: 'active' })
  sqlite.exec("UPDATE orders SET refundMethod = 'original'; UPDATE payments SET processing_fee = 0, amount = 300")
  setIntent({ amount: 30000, amount_capturable: 30000 })
  const response = await requestAsAdmin(context, '/admin/orders/order/update', { status: 'completed', force: '1' })
  assert.equal(response.status, 302, await response.text())
  assert.equal(calls.find(c => c.path.endsWith('/capture'))?.params.get('amount_to_capture'), '10000')
  assert.equal(sqlite.prepare('SELECT settlement_status FROM orders').get()?.settlement_status, 'SETTLED')
})

test('a healthy returned device is available immediately even when authorization settlement needs retry', async t => {
  const { sqlite, context, setIntent } = await setup(t, { status: 'active' })
  sqlite.exec("UPDATE orders SET refundMethod = 'original'; INSERT INTO contracts (id, orderId, contractNumber, content) VALUES ('contract', 'order', 'CONTRACT1', '<p>合同</p>')")
  setIntent({ amount_capturable: 1 })
  assert.equal((await requestAsAdmin(context, '/staff/orders/order/inspection', inspectionForm())).status, 409)
  assert.equal(sqlite.prepare('SELECT status FROM orders').get()?.status, 'completed')
  assert.equal(sqlite.prepare('SELECT settlement_status FROM orders').get()?.settlement_status, 'PENDING')
  assert.equal(sqlite.prepare('SELECT lifecycle_status FROM devices').get()?.lifecycle_status, 'READY')
  assert.equal(sqlite.prepare('SELECT status FROM devices').get()?.status, 'available')
})

test('a failed automatic capture preserves the return and approved amounts for admin retry', async t => {
  const { sqlite, calls, context, setIntent } = await setup(t, { status: 'active' })
  sqlite.exec("UPDATE orders SET refundMethod = 'original'; INSERT INTO contracts (id, orderId, contractNumber, content) VALUES ('contract', 'order', 'CONTRACT1', '<p>合同</p>')")
  setIntent({ amount_capturable: 100 })
  const response = await requestAsAdmin(context, '/staff/orders/order/inspection', inspectionForm(25))
  assert.equal(response.status, 409, await response.text())
  assert.equal(sqlite.prepare('SELECT status FROM orders').get()?.status, 'completed')
  assert.equal(sqlite.prepare('SELECT settlement_status FROM orders').get()?.settlement_status, 'PENDING')
  assert.equal(sqlite.prepare('SELECT status FROM deposit_settlements').get()?.status, 'APPROVED')
  const html = await renderAdminOrderDetail(context, { id: 'admin', role: 'ADMIN' }, 'order')
  assert.match(html, /action="\/admin\/orders\/order\/deposit-refund"/)
  const form = { refundAmount: '175', refundMethod: 'original', deductionCategory: 'DAMAGE', deductionReason: '设备损坏' }
  assert.equal((await requestAsAdmin(context, '/admin/orders/order/deposit-refund', { ...form, refundAmount: '200' })).status, 409)
  setIntent({ amount_capturable: 30250 })
  assert.equal((await requestAsAdmin(context, '/admin/orders/order/deposit-refund', form)).status, 303)
  assert.equal((await requestAsAdmin(context, '/admin/orders/order/deposit-refund', form)).status, 409)
  assert.equal(calls.filter(c => c.path.endsWith('/capture')).length, 1)
})

test('automatic settlement includes overdue deductions already recorded against an uncaptured deposit', async t => {
  const { sqlite, calls, context } = await setup(t)
  sqlite.exec("UPDATE orders SET refundMethod = 'original', deposit_status = 'PARTIALLY_DEDUCTED', overdue_deposit_applied = 25, deposit_deduction_amount = 25")
  const app = new Hono()
  app.post('/', async c => (await settleCompletedOrderAuthorization(c, { id: 'admin' }, 'order')) || c.text('done'))
  const response = await app.request('https://example.test/', { method: 'POST' }, context.env)
  assert.equal(response.status, 303, await response.text())
  assert.equal(calls.find(c => c.path.endsWith('/capture'))?.params.get('amount_to_capture'), '12750')
  assert.equal(sqlite.prepare('SELECT settlement_status FROM orders').get()?.settlement_status, 'SETTLED')
  assert.equal((await app.request('https://example.test/', { method: 'POST' }, context.env)).status, 200)
  assert.equal(calls.filter(c => c.path.endsWith('/capture')).length, 1)
})

test('automatic settlement retries a captured authorization after a database failure without charging twice', async t => {
  const { sqlite, calls, context } = await setup(t)
  sqlite.exec("UPDATE orders SET refundMethod = 'original'")
  const originalBatch = context.env.RENT.batch
  let failOnce = true
  context.env.RENT.batch = async (statements: any[]) => {
    if (failOnce && calls.some(c => c.path.endsWith('/capture'))) {
      failOnce = false
      throw new Error('Database unavailable after capture')
    }
    return originalBatch(statements)
  }
  const app = new Hono()
  app.post('/', async c => (await settleCompletedOrderAuthorization(c, { id: 'admin' }, 'order')) || c.text('done'))
  assert.equal((await app.request('https://example.test/', { method: 'POST' }, context.env)).status, 502)
  assert.equal(sqlite.prepare('SELECT status FROM deposit_settlements').get()?.status, 'APPROVED')
  assert.equal((await app.request('https://example.test/', { method: 'POST' }, context.env)).status, 303)
  assert.equal(calls.filter(c => c.path.endsWith('/capture')).length, 1)
  assert.equal(sqlite.prepare('SELECT settlement_status FROM orders').get()?.settlement_status, 'SETTLED')
})

test('concurrent automatic settlements capture and credit the balance only once', async t => {
  const { sqlite, calls, context } = await setup(t)
  const app = new Hono()
  app.post('/', async c => (await settleCompletedOrderAuthorization(c, { id: 'admin' }, 'order')) || c.text('done'))
  const responses = await Promise.all([0, 1].map(() => app.request('https://example.test/', { method: 'POST' }, context.env)))
  assert.deepEqual(responses.map(r => r.status).sort(), [303, 409])
  assert.equal(calls.filter(c => c.path.endsWith('/capture')).length, 1)
  assert.equal(sqlite.prepare('SELECT balance FROM users WHERE id = ?').get('customer')?.balance, 212)
  assert.equal(sqlite.prepare('SELECT settlement_status FROM orders').get()?.settlement_status, 'SETTLED')
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM payment_refunds').get()?.count, 1)
})

for (const deduction of [0, 25, 200]) {
  test(`authorization settlement captures rent plus ${deduction} deduction and releases the rest`, async t => {
    const { sqlite, calls, settle, context } = await setup(t)
    const form = { refundAmount: String(200 - deduction), refundMethod: 'original', ...(deduction ? { deductionCategory: 'DAMAGE', deductionReason: '设备损坏' } : {}) }
    const response = await settle(form)
    assert.equal(response.status, 303, await response.text())
    const capture = calls.find(c => c.path.endsWith('/capture'))!
    assert.equal(capture.params.get('amount_to_capture'), String(10250 + deduction * 100))
    assert.equal(capture.params.has('final_capture'), false)
    assert.equal(sqlite.prepare("SELECT balance FROM users WHERE id='customer'").get()?.balance, 12)
    const order = sqlite.prepare("SELECT * FROM orders WHERE id='order'").get() as any
    assert.equal(order.deposit_deduction_amount, deduction)
    assert.equal(order.deposit_held_amount, 0)
    assert.equal(order.refundMethod, 'original')
    assert.equal(order.settlement_status, 'SETTLED')
    assert.equal(order.deposit_status, deduction === 200 ? 'FORFEITED' : deduction ? 'PARTIALLY_DEDUCTED' : 'REFUNDED')
    assert.equal(sqlite.prepare('SELECT amount FROM payments').get()?.amount, 102.5 + deduction)
    assert.equal(sqlite.prepare('SELECT refund_amount FROM payment_refunds').get()?.refund_amount, 0)
    assert.equal(sqlite.prepare('SELECT total_amount FROM invoices').get()?.total_amount, 102.5 + deduction)
    assert.equal(sqlite.prepare('SELECT total_paid FROM receipts').get()?.total_paid, 102.5 + deduction)
    assert.equal(sqlite.prepare('SELECT amount FROM transactions').get()?.amount, 102.5 + deduction)
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM error_logs WHERE error_level = 'CRITICAL'").get()?.count, 0)
    assert.equal((await reconcileOrderPayments(context, 'order')).issues.length, 0)
    assert.equal((await settle(form)).status, 409)
    assert.equal(calls.filter(c => c.path.endsWith('/capture')).length, 1)
    const adminHtml = await renderAdminOrderDetail(context, { id: 'admin', role: 'ADMIN' }, 'order')
    const customerHtml = await renderCustomerOrderDetail(context, { id: 'customer', role: 'CUSTOMER' }, 'order')
    assert.match(adminHtml, /已释放剩余押金/)
    assert.doesNotMatch(adminHtml, /REFUNDED: 已退款|name="refundAmount"|action="\/admin\/orders\/order\/deposit-settlements"/)
    assert.doesNotMatch(adminHtml, /action="[^"]*deposit-(?:refund|settlements)"/)
    assert.match(customerHtml, /预授权已结算，剩余押金已释放/)
    for (const script of extractInlineScripts(adminHtml + customerHtml)) assert.doesNotThrow(() => new Function(script))
  })
}

test('a released authorization with stale status cannot be submitted for settlement again', async t => {
  const { sqlite, calls, settle, context } = await setup(t)
  assert.equal((await settle({ refundAmount: '200', refundMethod: 'original' })).status, 303)
  sqlite.exec("UPDATE orders SET deposit_status = 'REFUND_PENDING', refundMethod = 'balance', deposit_refund_at = NULL")
  const html = await renderAdminOrderDetail(context, { id: 'admin', role: 'ADMIN' }, 'order')
  assert.match(html, /预授权已结算，剩余押金已释放/)
  assert.doesNotMatch(html, /name="refundAmount"|已通过账户余额处理押金退款/)
  const response = await requestAsAdmin(context, '/admin/orders/order/deposit-settlements', { refundAmount: '200', refundMethod: 'balance' })
  assert.equal(response.status, 409, await response.text())
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM deposit_settlements').get()?.count, 0)
  assert.equal((await settle({ refundAmount: '200', refundMethod: 'balance' })).status, 409)
  assert.equal(calls.filter(call => call.path.endsWith('/capture')).length, 1)
  assert.equal(calls.filter(call => call.path.startsWith('refunds')).length, 0)
  assert.equal(sqlite.prepare("SELECT balance FROM users WHERE id = 'customer'").get()?.balance, 12)
})

for (const deduction of [0, 25]) test(`SetupIntent settlement with ${deduction} deduction cannot be repeated`, async t => {
  const { sqlite, calls, settle, context, setIntent } = await setup(t, { mode: 'SETUP_INTENT' })
  sqlite.exec("UPDATE orders SET stripe_payment_method_id = 'pm_card'")
  setIntent({ id: 'pi_deduction', status: 'succeeded', amount_received: deduction * 100, amount_capturable: 0 })
  const form = { deductionAmount: String(deduction), ...(deduction ? { deductionCategory: 'DAMAGE', deductionReason: '设备损坏' } : {}) }
  const response = await settle(form)
  assert.equal(response.status, 303, await response.text())
  const html = await renderAdminOrderDetail(context, { id: 'admin', role: 'ADMIN' }, 'order')
  const customerHtml = await renderCustomerOrderDetail(context, { id: 'customer', role: 'CUSTOMER' }, 'order')
  assert.match(html, /押金已结算/)
  assert.match(customerHtml, /押金已结算/)
  assert.doesNotMatch(html, /name="deductionAmount"|已通过账户余额处理押金退款|REFUNDED: 已退款/)
  assert.equal((await settle(form)).status, 409)
  assert.equal((await requestAsAdmin(context, '/admin/orders/order/deposit-settlements', form)).status, 409)
  assert.equal(calls.filter(call => call.path === 'payment_intents' && call.method === 'POST').length, deduction ? 1 : 0)
  assert.equal(calls.filter(call => call.path.startsWith('refunds')).length, 0)
  for (const script of extractInlineScripts(html + customerHtml)) assert.doesNotThrow(() => new Function(script))
})

test('legacy deposit-only authorization with no deductions is canceled without a capture', async t => {
  const { sqlite, calls, settle } = await setup(t, { rental: 0 })
  const response = await settle({ refundAmount: '200', refundMethod: 'original' })
  assert.equal(response.status, 303, await response.text())
  assert.ok(calls.some(c => c.path.endsWith('/cancel')))
  assert.ok(!calls.some(c => c.path.endsWith('/capture')))
  assert.equal(sqlite.prepare('SELECT amount FROM payments').get()?.amount, 0)
})

for (const invalidIntent of [{ status: 'canceled' }, { status: 'succeeded', amount_received: 30250 }, { currency: 'usd' }, { amount_capturable: 100 }]) {
  test(`invalid authorization cannot be marked settled: ${JSON.stringify(invalidIntent)}`, async t => {
    const { sqlite, calls, settle, setIntent } = await setup(t)
    setIntent(invalidIntent)
    assert.equal((await settle({ refundAmount: '200', refundMethod: 'original' })).status, 409)
    assert.equal(sqlite.prepare('SELECT deposit_status FROM orders').get()?.deposit_status, 'HELD')
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM payment_refunds').get()?.count, 0)
    assert.ok(!calls.some(c => c.path.endsWith('/capture')))
  })
}

test('retry after Stripe capture succeeds repairs local settlement without capturing again', async t => {
  const { sqlite, calls, settle, setIntent } = await setup(t)
  setIntent({ status: 'succeeded', amount_received: 10250, amount_capturable: 0 })
  assert.equal((await settle({ refundAmount: '200', refundMethod: 'original' })).status, 303)
  assert.ok(!calls.some(c => c.path.endsWith('/capture')))
  assert.equal(sqlite.prepare('SELECT status, amount FROM payments').get()?.amount, 102.5)
})

test('existing uncaptured intent is reused while the authorization webhook is pending', async t => {
  const { calls, context } = await setup(t, { status: 'pending_payment' })
  const result = await createOrderPaymentIntent(context, { id: 'customer', role: 'CUSTOMER', email: 'customer@example.test' }, 'order')
  assert.equal(result.clientSecret, 'pi_auth_secret_test')
  assert.equal(result.amountCents, 30250)
  assert.ok(!calls.some(c => c.path === 'payment_intents' && c.method === 'POST'))
})

test('approval confirms an existing full authorization without a second hold or capture', async t => {
  const { sqlite, calls, context } = await setup(t, { status: 'pending_payment' })
  const result = await createOrderPaymentIntent(context, { id: 'customer', role: 'CUSTOMER', email: 'customer@example.test' }, 'order', true)
  assert.equal(result.authorized, true)
  assert.equal(result.alreadyPaid, true)
  assert.equal(sqlite.prepare('SELECT status FROM orders').get()?.status, 'paid')
  assert.equal(sqlite.prepare('SELECT status FROM payments').get()?.status, 'pending')
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM invoices').get()?.count, 1)
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM receipts').get()?.count, 0)
  assert.ok(!calls.some(call => call.path === 'payment_intents' && call.method === 'POST' || call.path.endsWith('/capture')))
})

for (const state of ['authorized', 'paid', 'failed']) {
  test(`website approval snapshots the Stripe ${state} result after payment processing`, async t => {
    const { sqlite, context, setIntent } = await setup(t, { status: 'pending_approval' })
    sqlite.exec("UPDATE orders SET stripe_payment_method_id = 'pm_card', startDate = '2090-01-01', endDate = '2090-01-06'; UPDATE contract_templates SET content = '<p>{payment_date}|{payment_reference}</p>' WHERE id = 'default';")
    if (state === 'paid') {
      sqlite.exec("UPDATE orders SET rentalPeriod = 40, endDate = '2090-02-10'")
      setIntent({ status: 'succeeded', amount: 10250, amount_received: 10250, amount_capturable: 0, metadata: { order_id: 'order', customer_id: 'customer', type: 'rental_payment' } })
    } else if (state === 'failed') {
      sqlite.exec("UPDATE orders SET deposit_status = 'PENDING', stripe_deposit_payment_intent_id = NULL")
      const fetchBefore = globalThis.fetch
      globalThis.fetch = (async (url: any, init: any) => {
        if (String(url).includes('/payment_intents')) throw new Error('Stripe unavailable in test')
        return fetchBefore(url, init)
      }) as typeof fetch
    }
    const session = await createAuthSession(context, 'admin')
    const response = await worker.fetch(new Request('https://rent.example.test/staff/orders/order/approve', {
      method: 'POST', body: new URLSearchParams({ deliveryMethod: 'Pickup' }),
      headers: { Cookie: `session=${session.token}`, Origin: 'https://rent.example.test', 'Sec-Fetch-Site': 'same-origin' },
    }), context.env, { waitUntil() {} } as any)
    assert.equal(response.status, 302, await response.text())
    const snapshot = sqlite.prepare('SELECT status, signed_content, content_hash FROM contracts WHERE orderId = ?').get('order') as any
    assert.equal(snapshot.status, 'signed')
    if (state === 'paid') {
      const payment = sqlite.prepare("SELECT paid_at FROM payments WHERE status = 'paid'").get() as any
      assert.ok(payment?.paid_at)
      assert.equal(snapshot.signed_content, `<p>${formatMelbourneDateTime(payment.paid_at)}|pi_auth</p>`)
    } else {
      assert.equal(snapshot.signed_content, state === 'authorized' ? '<p>NA|pi_auth</p>' : '<p>NA|NA</p>')
      assert.equal(sqlite.prepare('SELECT paid_at FROM payments').get()?.paid_at, null)
    }
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(snapshot.signed_content))), byte => byte.toString(16).padStart(2, '0')).join('')
    assert.equal(snapshot.content_hash, hash)
  })
}

for (const invalid of [{ amount_capturable: 1 }, { capture_method: 'automatic' }, { metadata: { order_id: 'order', customer_id: 'other', type: 'rental_authorization' } }]) {
  test(`approval rejects invalid full authorization: ${JSON.stringify(invalid)}`, async t => {
    const { sqlite, context, setIntent } = await setup(t, { status: 'pending_payment' })
    setIntent(invalid)
    await assert.rejects(() => createOrderPaymentIntent(context, { id: 'customer', role: 'CUSTOMER', email: 'customer@example.test' }, 'order', true), /Stripe 订单预授权数据不匹配/)
    assert.equal(sqlite.prepare('SELECT status FROM orders').get()?.status, 'pending_payment')
  })
}

test('website authorization received before approval does not confirm or provision the rental', async t => {
  const { sqlite, context, intent, calls } = await setup(t, { status: 'pending_approval' })
  const app = new Hono()
  app.post('/', c => handleStripeWebhook(c))
  const body = JSON.stringify({ id: 'evt_before_approval', type: 'payment_intent.amount_capturable_updated', data: { object: intent } })
  const timestamp = Math.floor(Date.now() / 1000)
  const signature = createHmac('sha256', 'whsec_example').update(`${timestamp}.${body}`).digest('hex')
  const response = await app.request('https://example.test/', { method: 'POST', body, headers: { 'stripe-signature': `t=${timestamp},v1=${signature}` } }, context.env)
  assert.equal(response.status, 200, await response.text())
  assert.equal(sqlite.prepare('SELECT status FROM orders').get()?.status, 'pending_approval')
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM rental_status_history').get()?.count, 0)
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM device_commands').get()?.count, 0)
  assert.ok(!calls.some(call => call.path.endsWith('/capture')))
})

test('old deposit-only authorization is released before creating the full rental authorization', async t => {
  const { sqlite, context, calls, setIntent } = await setup(t, { status: 'pending_payment' })
  sqlite.exec("UPDATE orders SET totalAmount = 1050, depositAmount = 1000; UPDATE payments SET amount = 1000, deposit_amount = 1000, rental_amount = 0, processing_fee = 0;")
  setIntent({ amount: 100000, amount_capturable: 100000, metadata: { type: 'deposit_authorization', order_id: 'order', customer_id: 'customer' } })
  const previousFetch = globalThis.fetch
  globalThis.fetch = (async (url: any, init: any) => {
    if (String(url) === 'https://api.stripe.com/v1/payment_intents' && init?.method === 'POST') {
      setIntent({ id: 'pi_combined', status: 'requires_payment_method', amount: 105125, amount_capturable: 0, metadata: { type: 'rental_authorization', order_id: 'order', customer_id: 'customer' } })
    }
    return previousFetch(url, init)
  }) as typeof fetch
  const result = await createOrderPaymentIntent(context, { id: 'customer', role: 'CUSTOMER', email: 'customer@example.test' }, 'order')
  assert.equal(result.amountCents, 105125)
  const cancel = calls.findIndex(call => call.path === 'payment_intents/pi_auth/cancel')
  const create = calls.findIndex(call => call.path === 'payment_intents' && call.method === 'POST')
  assert.ok(cancel >= 0 && create > cancel)
  assert.equal(calls[create].params.get('amount'), '105125')
  assert.equal(sqlite.prepare("SELECT status FROM payments WHERE id = 'payment'").get()?.status, 'failed')
  assert.equal(sqlite.prepare("SELECT amount FROM payments WHERE stripe_payment_intent_id = 'pi_combined'").get()?.amount, 1051.25)
})

test('staff and customer order details display the stored creation time in Melbourne', async t => {
  const { sqlite, context } = await setup(t, { status: 'pending_payment' })
  sqlite.exec("UPDATE orders SET createdAt = '2026-10-30T14:05:03.089Z'")
  for (const html of [await renderStaffOrderDetail(context, { id: 'admin', role: 'ADMIN' }, 'order'), await renderCustomerOrderDetail(context, { id: 'customer', role: 'CUSTOMER' }, 'order')]) {
    assert.match(html, /<strong>下单时间:<\/strong> 2026-10-31 01:05/)
    assert.doesNotMatch(html, /<strong>下单时间:<\/strong> undefined/)
  }
  const staffHtml = await renderStaffOrderDetail(context, { id: 'admin', role: 'ADMIN' }, 'order')
  assert.match(staffHtml, /<strong>总金额:<\/strong> AUD\$300\.00/)
  assert.match(staffHtml, /<strong>Stripe 支付手续费:<\/strong> AUD\$2\.50/)
  assert.match(staffHtml, /<strong>信用卡预授权总额:<\/strong> AUD\$302\.50/)
})

test('held authorization is separate from cash until return settlement across finance views', async t => {
  const { sqlite, context, settle } = await setup(t)
  const before = await reconcileOrderPayments(context, 'order')
  assert.equal(before.paidTotal, 0)
  assert.equal(before.authorizedTotal, 302.5)
  assert.equal(before.pendingTotal, 0)
  assert.equal((await getAdminDashboardData(context)).stats.totalRevenue, 0)
  assert.equal((await getStaffDashboardData(context)).stats.totalRevenue, 0)
  assert.equal((await getAdminOrderStats(context)).revenue, 0)
  assert.equal((await getRevenueData(context)).orders[0].collectedRevenue, 0)
  assert.equal((await settle({ refundAmount: '200', refundMethod: 'original' })).status, 303)
  const after = await reconcileOrderPayments(context, 'order')
  assert.equal(after.paidTotal, 102.5)
  assert.equal(after.authorizedTotal, 0)
  assert.equal((await getAdminDashboardData(context)).stats.totalRevenue, 100)
  assert.equal((await getStaffDashboardData(context)).stats.totalRevenue, 100)
  assert.equal((await getAdminOrderStats(context)).revenue, 100)
  assert.equal((await getRevenueData(context)).orders[0].collectedRevenue, 100)
  assert.equal(sqlite.prepare('SELECT status FROM payments').get()?.status, 'paid')
  sqlite.exec("UPDATE payments SET paid_at = '2027-02-15T00:00:00Z'; INSERT INTO payments (id, rental_id, customer_id, payment_method, amount, rental_amount, deposit_amount, status, paid_at) VALUES ('extra', 'order', 'customer', 'balance', 20, 20, 0, 'paid', '2027-03-15T00:00:00Z')")
  const data = await getRevenueData(context)
  const html = renderAdminRevenueStats({ id: 'admin', role: 'ADMIN' }, data)
  assert.match(html, /2027-02<\/td><td class="mono"[^>]*>AUD\$100\.00/)
  assert.match(html, /2027-03<\/td><td class="mono"[^>]*>AUD\$20\.00/)
  assert.match(renderAdminFinance({ id: 'admin', role: 'ADMIN' }, data.orders), /AUD\$120\.00/)
})

test('an authorized booking is not suspended for having no captured payment yet', async t => {
  const { sqlite, context } = await setup(t, { status: 'paid' })
  sqlite.exec("UPDATE orders SET payment_status = 'PAID'")
  await runDataConsistencyChecks(context)
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM data_consistency_issues WHERE issue_type = 'PAID_ORDER_WITHOUT_PAYMENT'").get()?.count, 0)
  assert.equal(sqlite.prepare('SELECT status FROM orders').get()?.status, 'paid')
})

test('new combined authorization requests manual card capture and extended validity', async t => {
  const { sqlite, calls, context, setIntent } = await setup(t, { status: 'pending_payment' })
  sqlite.exec('DELETE FROM payment_allocations; DELETE FROM payments;')
  setIntent({ status: 'requires_payment_method' })
  await createOrderPaymentIntent(context, { id: 'customer', role: 'CUSTOMER', email: 'customer@example.test' }, 'order')
  const created = calls.find(c => c.path === 'payment_intents' && c.method === 'POST')!
  assert.equal(created.params.get('amount'), '30250')
  assert.equal(created.params.get('capture_method'), 'manual')
  assert.equal(created.params.get('payment_method_types[0]'), 'card')
  assert.equal(created.params.get('payment_method_options[card][request_extended_authorization]'), 'if_available')
  assert.equal(created.params.get('metadata[type]'), 'rental_authorization')
})

test('long rental still charges rent without holding the deposit', async t => {
  const { sqlite, calls, context, setIntent } = await setup(t, { status: 'pending_payment', mode: 'SETUP_INTENT' })
  sqlite.exec("DELETE FROM payment_allocations; DELETE FROM payments; UPDATE orders SET rentalPeriod = 30, stripe_payment_method_id = 'pm_saved' WHERE id='order'; UPDATE users SET stripe_customer_id = 'cus_test' WHERE id='customer';")
  // The existing customer/card relationship avoids creating another customer.
  const fetchBefore = globalThis.fetch
  globalThis.fetch = (async (url: any, init: any) => String(url).includes('/payment_methods/') ? Response.json({ id: 'pm_saved', customer: 'cus_test', card: { brand: 'visa' } }) : fetchBefore(url, init)) as typeof fetch
  setIntent({ status: 'requires_payment_method' })
  await createOrderPaymentIntent(context, { id: 'customer', role: 'CUSTOMER', email: 'customer@example.test', stripe_customer_id: 'cus_test' }, 'order')
  const created = calls.find(c => c.path === 'payment_intents' && c.method === 'POST')!
  assert.equal(created.params.get('amount'), '10250')
  assert.equal(created.params.get('capture_method'), null)
  assert.equal(created.params.get('metadata[deposit_amount]'), '0')
})

for (const invalid of [{ currency: 'usd' }, { status: 'succeeded' }, { amount: 1 }, { metadata: { type: 'rental_authorization', order_id: 'other', customer_id: 'customer' } }, { metadata: { type: 'rental_authorization', order_id: 'order', customer_id: 'other' } }]) {
  test(`signed authorization webhook rejects mismatched data: ${JSON.stringify(invalid)}`, async t => {
    const { sqlite, context, intent } = await setup(t, { status: 'pending_payment' })
    const app = new Hono()
    app.post('/', c => handleStripeWebhook(c))
    const body = JSON.stringify({ id: 'evt_authorization', type: 'payment_intent.amount_capturable_updated', data: { object: { ...intent, ...invalid } } })
    const timestamp = Math.floor(Date.now() / 1000)
    const signature = createHmac('sha256', 'whsec_example').update(`${timestamp}.${body}`).digest('hex')
    const response = await app.request('https://example.test/', { method: 'POST', body, headers: { 'stripe-signature': `t=${timestamp},v1=${signature}` } }, context.env)
    assert.equal(response.status, 400)
    assert.equal(sqlite.prepare('SELECT status FROM orders').get()?.status, 'pending_payment')
    assert.equal(sqlite.prepare('SELECT status FROM payments').get()?.status, 'pending')
  })
}

test('signed authorization webhook confirms the booking without capturing funds', async t => {
  const { sqlite, context, intent, calls } = await setup(t, { status: 'pending_payment' })
  const app = new Hono()
  app.post('/', c => handleStripeWebhook(c))
  const body = JSON.stringify({ id: 'evt_authorization', type: 'payment_intent.amount_capturable_updated', data: { object: intent } })
  const timestamp = Math.floor(Date.now() / 1000)
  const signature = createHmac('sha256', 'whsec_example').update(`${timestamp}.${body}`).digest('hex')
  const response = await app.request('https://example.test/', { method: 'POST', body, headers: { 'stripe-signature': `t=${timestamp},v1=${signature}` } }, context.env)
  assert.equal(response.status, 200, await response.text())
  assert.equal(sqlite.prepare('SELECT status FROM orders').get()?.status, 'paid')
  assert.equal(sqlite.prepare('SELECT status FROM payments').get()?.status, 'pending')
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM invoices').get()?.count, 1)
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM receipts').get()?.count, 0)
  assert.ok(!calls.some(c => c.path.endsWith('/capture')))
})

for (const deduction of [0, 25, 200]) {
  test(`refund to balance captures the entire authorization and credits deposit less ${deduction}`, async t => {
    const { sqlite, calls, settle, context } = await setup(t)
    const form = { refundAmount: String(200 - deduction), refundMethod: 'balance', ...(deduction ? { deductionCategory: 'DAMAGE', deductionReason: '设备损坏' } : {}) }
    const beforeHtml = await renderAdminOrderDetail(context, { id: 'admin', role: 'ADMIN' }, 'order')
    assert.match(beforeHtml, /name="refundMethod" required/)
    assert.match(beforeHtml, /value="balance" selected/)
    const response = await settle(form)
    assert.equal(response.status, 303, await response.text())
    assert.equal(calls.find(c => c.path.endsWith('/capture'))?.params.get('amount_to_capture'), '30250')
    assert.equal(sqlite.prepare("SELECT balance FROM users WHERE id='customer'").get()?.balance, 212 - deduction)
    assert.equal(sqlite.prepare('SELECT deposit_refund_amount FROM orders').get()?.deposit_refund_amount, 200 - deduction)
    assert.equal(sqlite.prepare('SELECT refund_amount FROM payment_refunds').get()?.refund_amount, 200 - deduction)
    assert.equal(sqlite.prepare('SELECT refund_method FROM payment_refunds').get()?.refund_method, 'balance')
    assert.equal(sqlite.prepare('SELECT amount FROM payments').get()?.amount, 302.5)
    assert.equal(sqlite.prepare('SELECT total_amount FROM invoices').get()?.total_amount, 302.5)
    assert.equal(sqlite.prepare('SELECT total_paid FROM receipts').get()?.total_paid, 302.5)
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM payment_allocations WHERE id LIKE 'pa-release-%'").get()?.count, 0)
    const reconciliation = await reconcileOrderPayments(context, 'order')
    assert.equal(reconciliation.issues.length, 0)
    assert.equal(reconciliation.paidTotal - reconciliation.refundedTotal, 102.5 + deduction)
    assert.equal((await settle(form)).status, 409)
    assert.equal(sqlite.prepare("SELECT balance FROM users WHERE id='customer'").get()?.balance, 212 - deduction)
    const adminHtml = await renderAdminOrderDetail(context, { id: 'admin', role: 'ADMIN' }, 'order')
    const customerHtml = await renderCustomerOrderDetail(context, { id: 'customer', role: 'CUSTOMER' }, 'order')
    assert.doesNotMatch(adminHtml, /已释放剩余押金/)
    assert.doesNotMatch(customerHtml, /预授权已结算，剩余押金已释放/)
    for (const script of extractInlineScripts(beforeHtml + adminHtml + customerHtml)) assert.doesNotThrow(() => new Function(script))
  })
}

test('retry of full capture credits the deposit to balance once', async t => {
  const { sqlite, calls, settle, setIntent } = await setup(t)
  setIntent({ status: 'succeeded', amount_received: 30250, amount_capturable: 0 })
  // Omitting the form method uses the order's saved balance preference.
  assert.equal((await settle({ refundAmount: '200' })).status, 303)
  assert.ok(!calls.some(c => c.path.endsWith('/capture')))
  assert.equal(sqlite.prepare("SELECT balance FROM users WHERE id='customer'").get()?.balance, 212)
  assert.equal((await settle({ refundAmount: '200' })).status, 409)
  assert.equal(sqlite.prepare("SELECT balance FROM users WHERE id='customer'").get()?.balance, 212)
})
