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
import { createBalanceTopUpIntent, createOrderPaymentIntent, handleStripeWebhook, refundDeposit, refundUnusedRentalDays, createOrderInstallmentPaymentIntent, settleCompletedOrderAuthorization, getStripeProcessingFeeRate } from '../src/actions/stripePayments'
import { handleSaveAdminSettings } from '../src/actions/admin/saveSettings'
import { saveStripeConfig } from '../src/stripe'
import { createAuthSession, formatMelbourneDateTime, getOrderById, releaseStripePendingPaymentIntents, reconcileOrderPayments, runDataConsistencyChecks } from '../src/site'
import worker from '../src/index'
import { testInspectionFiles } from './helpers'
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
import { setRentalPaymentPlan } from '../src/services/rentalPaymentPlan'
import { renderRentalPaymentPlan } from '../src/pages/partials/rentalPaymentPlan'
import { getOrCreateSignSession, updateSignSession } from '../src/site'
import { chargeDueRentalInstallments, settleRentalInstallment } from '../src/services/monthlyRentalPayments'
import { buildMonthlyRentalInstallments, rentalPricingSnapshot } from '../src/domain/monthlyRental'
import { renderRentalDiscounts } from '../src/pages/partials/rentalDiscounts'
import { CHECKOUT_INTEGRATION, linkStripeCheckoutIntent, upsertStripeCheckout } from '../src/services/stripeCheckout'
import { stripePaymentHelperScript } from '../src/pages/partials/stripePaymentSection'

async function setup(t: any, options: { rental?: number; status?: string; mode?: string; feeRate?: number } = {}) {
  const sqlite = new DatabaseSync(':memory:')
  t.after(() => sqlite.close())
  for (const name of readdirSync(new URL('../migrations/', import.meta.url)).filter(n => n.endsWith('.sql')).sort()) sqlite.exec(readFileSync(new URL(`../migrations/${name}`, import.meta.url), 'utf8'))
  sqlite.exec("UPDATE systemSettings SET value = '{\"stripe\":true,\"processingFeeRate\":0.025}' WHERE key = 'paymentMethods'")
  sqlite.exec("INSERT INTO users (id, name, email, role, balance) VALUES ('customer', '客户', 'customer@example.test', 'CUSTOMER', 12), ('admin', '管理员', 'admin@example.test', 'ADMIN', 0); INSERT INTO devices (id, name, model, pricePerDay, depositAmount, serialNumber, status) VALUES ('device', '电脑', 'Test', 20, 200, 'SN1', 'rented');")
  const rental = options.rental ?? 100
  const historicalFeeRate = options.feeRate ?? 0.025
  sqlite.prepare("INSERT INTO orders (id, userId, deviceId, startDate, endDate, rentalPeriod, totalAmount, depositAmount, status, paymentMethod, deposit_method, deposit_payment_mode, deposit_status, stripe_deposit_payment_intent_id, refundMethod) VALUES ('order', 'customer', 'device', '2026-10-24', '2026-10-29', 5, ?, 200, ?, 'card', 'card_hold', ?, 'HELD', 'pi_auth', 'balance')").run(rental + 200, options.status || 'completed', options.mode || 'PREAUTH')
  sqlite.prepare("INSERT INTO payments (id, rental_id, customer_id, payment_method, amount, rental_amount, deposit_amount, processing_fee, status, stripe_payment_intent_id) VALUES ('payment', 'order', 'customer', 'card', ?, ?, 200, ?, 'pending', 'pi_auth')").run(rental + 200 + rental * historicalFeeRate, rental, rental * historicalFeeRate)
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
  const context = { env, get: () => undefined, req: { url: 'https://rent.example.test/', method: 'GET' } } as any
  await saveStripeConfig(context, { publishableKey: 'pk_test_example', secretKey: 'sk_test_example', webhookSecret: 'whsec_example' })
  const calls: Array<{ path: string; params: URLSearchParams; method: string }> = []
  let intent: any = { id: 'pi_auth', status: 'requires_capture', currency: 'aud', amount: Math.round((rental * (1 + historicalFeeRate) + 200) * 100), amount_capturable: Math.round((rental * (1 + historicalFeeRate) + 200) * 100), amount_received: 0, capture_method: 'manual', metadata: { order_id: 'order', customer_id: 'customer', type: 'rental_authorization' }, client_secret: 'pi_auth_secret_test' }
  const sessions = new Map<string, any>()
  const fetchBefore = globalThis.fetch
  globalThis.fetch = (async (url: any, init: any) => {
    if (String(url) === 'https://api.cloudinary.com/v1_1/demo/image/upload') return Response.json({ secure_url: 'https://res.cloudinary.com/demo/image/upload/damage.jpg' })
    const path = String(url).replace('https://api.stripe.com/v1/', '')
    const params = new URLSearchParams(init?.body)
    calls.push({ path, params, method: init?.method || 'GET' })
    assert.ok(String(url).startsWith('https://api.stripe.com/'), `Unexpected request: ${url}`)
    if (path === 'checkout/sessions' && init?.method === 'POST') {
      const id = `cs_test_${sessions.size + 1}`
      const metadata = Object.fromEntries([...params].filter(([key]) => /^metadata\[.+\]$/.test(key)).map(([key, value]) => [key.slice(9, -1), value]))
      const amount = [...params].filter(([key]) => key.endsWith('[unit_amount]')).reduce((sum, [, value]) => sum + Number(value), 0)
      const session = { id, status: 'open', currency: 'aud', client_secret: `${id}_secret_test`, amount_total: amount, customer: params.get('customer'), metadata, payment_intent: null }
      sessions.set(id, session)
      return Response.json(session)
    }
    if (path.startsWith('checkout/sessions/')) {
      const id = path.split('/')[2].split('?')[0]
      const session = sessions.get(id)
      assert.ok(session, `Unknown Checkout Session: ${id}`)
      if (path.endsWith('/expire')) session.status = 'expired'
      const expanded = path.includes('expand') && session.payment_intent === intent.id
      return Response.json(expanded ? { ...session, payment_intent: intent } : session)
    }
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
  return { sqlite, db, context, calls, settle, intent, sessions, setIntent: (value: any) => { intent = { ...intent, ...value } } }
}

async function requestAsAdmin(context: any, path: string, form: Record<string, string | File>) {
  if(path.endsWith('/inspection'))context.env.RENT.prepare("UPDATE orders SET return_received_at=COALESCE(return_received_at,CURRENT_TIMESTAMP)").run()
  const body = new FormData()
  for (const [key, value] of Object.entries(form)) body.set(key, value)
  const session = await createAuthSession(context, 'admin')
  return worker.fetch(new Request(`https://rent.example.test${path}`, {
    method: 'POST', body,
    headers: { Cookie: `session=${session.token}`, Origin: 'https://rent.example.test', 'Sec-Fetch-Site': 'same-origin' },
  }), context.env, { waitUntil() {} } as any)
}

const inspectionForm = (damage = 0) => ({
  ...testInspectionFiles(),screenCondition: '正常', keyboardCondition: '正常', trackpadCondition: '正常', bodyCondition: '正常',
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
    sqlite.exec("UPDATE orders SET return_received_at=CURRENT_TIMESTAMP")
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
  const response = await requestAsAdmin(context, '/admin/orders/order/update', { status: 'completed', force: '1',deviceConfirmed:'1',reason:'设备已收回' })
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

test('capture avoids a legacy idempotency key cached with final_capture', async t => {
  const { sqlite, settle } = await setup(t)
  const stripeFetch = globalThis.fetch
  const keys: string[] = []
  globalThis.fetch = (async (url: any, init: any) => {
    if (String(url).endsWith('/capture')) {
      const key = new Headers(init?.headers).get('Idempotency-Key') || ''
      keys.push(key)
      if (key === 'deposit-capture-order') return Response.json({ error: { message: 'Keys for idempotent requests can only be used with the same parameters they were first used with.' } }, { status: 400 })
    }
    return stripeFetch(url, init)
  }) as typeof fetch
  const response = await settle({ refundAmount: '200', refundMethod: 'original' })
  assert.equal(response.status, 303, await response.text())
  assert.equal(keys.length, 1)
  assert.notEqual(keys[0], 'deposit-capture-order')
  assert.ok(keys[0].includes('pi_auth'))
  assert.equal(sqlite.prepare('SELECT status, amount FROM payments').get()?.amount, 102.5)
})

test('capture retries retain the same key after a connection failure and settle only once', async t => {
  const { sqlite, context, calls } = await setup(t)
  sqlite.exec("UPDATE orders SET refundMethod = 'original'")
  const stripeFetch = globalThis.fetch
  const attempts: Array<{ key: string; body: string }> = []
  globalThis.fetch = (async (url: any, init: any) => {
    if (String(url).endsWith('/capture')) {
      attempts.push({ key: new Headers(init?.headers).get('Idempotency-Key') || '', body: String(init?.body || '') })
      if (attempts.length === 1) throw new Error('Connection failed before capture')
    }
    return stripeFetch(url, init)
  }) as typeof fetch
  const app = new Hono()
  app.post('/', async c => (await settleCompletedOrderAuthorization(c, { id: 'admin' }, 'order')) || c.text('done'))
  assert.equal((await app.request('https://example.test/', { method: 'POST' }, context.env)).status, 502)
  assert.equal(sqlite.prepare('SELECT status FROM deposit_settlements').get()?.status, 'APPROVED')
  assert.equal((await app.request('https://example.test/', { method: 'POST' }, context.env)).status, 303)
  assert.equal(attempts.length, 2)
  assert.ok(attempts[0].key)
  assert.deepEqual(attempts[0], attempts[1])
  assert.equal((await app.request('https://example.test/', { method: 'POST' }, context.env)).status, 200)
  assert.equal(calls.filter(call => call.path.endsWith('/capture')).length, 1)
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM payment_refunds').get()?.count, 1)
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
  const { calls, context } = await setup(t, { status: 'pending_payment', feeRate: 0 })
  const result = await createOrderPaymentIntent(context, { id: 'customer', role: 'CUSTOMER', email: 'customer@example.test' }, 'order')
  assert.equal(result.clientSecret, 'pi_auth_secret_test')
  assert.equal(result.amountCents, 30000)
  assert.ok(!calls.some(c => c.path === 'payment_intents' && c.method === 'POST'))
})

test('approval confirms an existing full authorization without a second hold or capture', async t => {
  const { sqlite, calls, context } = await setup(t, { status: 'pending_payment', feeRate: 0 })
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
    const { sqlite, context, setIntent } = await setup(t, { status: 'pending_approval', feeRate: 0 })
    sqlite.exec("UPDATE orders SET stripe_payment_method_id = 'pm_card', startDate = '2090-01-01', endDate = '2090-01-06'; UPDATE contract_templates SET content = '<p>{payment_date}|{payment_reference}</p>' WHERE id = 'default';")
    if (state === 'paid') {
      sqlite.exec("UPDATE orders SET rentalPeriod = 40, endDate = '2090-02-10'")
      setIntent({ status: 'succeeded', amount: 10000, amount_received: 10000, amount_capturable: 0, metadata: { order_id: 'order', customer_id: 'customer', type: 'rental_payment' } })
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
    const { sqlite, context, setIntent } = await setup(t, { status: 'pending_payment', feeRate: 0 })
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
      setIntent({ id: 'pi_combined', status: 'requires_payment_method', amount: 105000, amount_capturable: 0, metadata: { type: 'rental_authorization', order_id: 'order', customer_id: 'customer' } })
    }
    return previousFetch(url, init)
  }) as typeof fetch
  const result = await createOrderPaymentIntent(context, { id: 'customer', role: 'CUSTOMER', email: 'customer@example.test' }, 'order')
  assert.equal(result.amountCents, 105000)
  const cancel = calls.findIndex(call => call.path === 'payment_intents/pi_auth/cancel')
  const create = calls.findIndex(call => call.path === 'checkout/sessions' && call.method === 'POST')
  assert.ok(cancel >= 0 && create > cancel)
  assert.equal(calls[create].params.get('line_items[0][price_data][unit_amount]'), '5000')
  assert.equal(calls[create].params.get('line_items[1][price_data][unit_amount]'), '100000')
  assert.equal(calls[create].params.has('line_items[2][price_data][unit_amount]'), false)
  assert.equal(sqlite.prepare("SELECT status FROM payments WHERE id = 'payment'").get()?.status, 'failed')
  assert.equal(sqlite.prepare("SELECT amount FROM payments WHERE stripe_checkout_session_id = 'cs_test_1'").get()?.amount, 1050)
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
  const created = calls.find(c => c.path === 'checkout/sessions' && c.method === 'POST')!
  assert.equal(created.params.get('line_items[0][price_data][unit_amount]'), '10000')
  assert.equal(created.params.get('line_items[1][price_data][unit_amount]'), '20000')
  assert.equal(created.params.has('line_items[2][price_data][unit_amount]'), false)
  assert.equal(created.params.get('payment_intent_data[capture_method]'), 'manual')
  assert.equal(created.params.get('payment_method_types[0]'), 'card')
  assert.equal(created.params.get('payment_method_options[card][request_extended_authorization]'), 'if_available')
  assert.equal(created.params.get('payment_intent_data[metadata][type]'), 'rental_authorization')
})

test('existing 30-day monthly plans retain their first rent and deposit payment', async t => {
  const { sqlite, calls, context, setIntent } = await setup(t, { status: 'pending_payment', mode: 'SETUP_INTENT' })
  sqlite.exec("DELETE FROM payment_allocations; DELETE FROM payments; UPDATE orders SET rentalPeriod = 30, billing_mode = 'MONTHLY', stripe_payment_method_id = 'pm_saved' WHERE id='order'; UPDATE users SET stripe_customer_id = 'cus_test' WHERE id='customer';")
  // The existing customer/card relationship avoids creating another customer.
  const fetchBefore = globalThis.fetch
  globalThis.fetch = (async (url: any, init: any) => String(url).includes('/payment_methods/') ? Response.json({ id: 'pm_saved', customer: 'cus_test', card: { brand: 'visa' } }) : fetchBefore(url, init)) as typeof fetch
  setIntent({ status: 'requires_payment_method' })
  await createOrderPaymentIntent(context, { id: 'customer', role: 'CUSTOMER', email: 'customer@example.test', stripe_customer_id: 'cus_test' }, 'order')
  const created = calls.find(c => c.path === 'checkout/sessions' && c.method === 'POST')!
  assert.equal(created.params.get('line_items[0][price_data][unit_amount]'), '10000')
  assert.equal(created.params.get('line_items[1][price_data][unit_amount]'), '20000')
  assert.equal(created.params.has('line_items[2][price_data][unit_amount]'), false)
  assert.equal(created.params.get('payment_intent_data[capture_method]'), null)
  assert.equal(created.params.get('payment_intent_data[setup_future_usage]'), 'off_session')
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

test('new balance top-up uses Checkout line items and customer identity without a surcharge', async t => {
  const { sqlite, context, calls } = await setup(t)
  sqlite.exec("INSERT INTO balance_topups (id, user_id, amount, payment_method, status) VALUES ('topup', 'customer', 10, 'card', 'pending'); INSERT INTO addresses (id, user_id, address_line1, city, state, postcode, country, is_default) VALUES ('address', 'customer', '18 Test Street', 'Carlton', 'VIC', '3053', 'AU', 1)")
  const result = await createBalanceTopUpIntent(context, { id: 'customer', name: 'Test Customer', email: 'customer@example.test' }, 'topup')
  assert.match(result.clientSecret, /^cs_test_/)
  assert.equal(result.amountCents, 1000)
  const create = calls.find(call => call.path === 'checkout/sessions')!
  assert.equal(create.params.get('ui_mode'), 'elements')
  assert.equal(create.params.get('customer'), 'cus_test')
  assert.equal(create.params.get('line_items[0][price_data][product_data][name]'), '账户余额充值')
  assert.equal(create.params.get('line_items[0][price_data][unit_amount]'), '1000')
  assert.equal(create.params.has('line_items[1][price_data][unit_amount]'), false)
  assert.equal(create.params.get('line_items[0][quantity]'), '1')
  assert.equal(create.params.get('payment_intent_data[metadata][topup_id]'), 'topup')
  const profile = calls.find(call => call.path === 'customers/cus_test' && call.params.has('address[line1]'))!
  assert.equal(profile.params.get('name'), 'Test Customer')
  assert.equal(profile.params.get('address[country]'), 'AU')
  assert.equal(sqlite.prepare('SELECT stripe_checkout_session_id FROM balance_topups').get()?.stripe_checkout_session_id, 'cs_test_1')
  assert.equal(sqlite.prepare('SELECT stripe_payment_intent_id FROM balance_topups').get()?.stripe_payment_intent_id, null)
  assert.ok(!calls.some(call => call.path === 'payment_intents'))
})

test('Checkout retries reuse the session; a changed total expires the original session', async t => {
  const { sqlite, context, calls, sessions } = await setup(t)
  sqlite.exec("INSERT INTO balance_topups (id, user_id, amount, payment_method, status) VALUES ('topup', 'customer', 10, 'card', 'pending')")
  const user = { id: 'customer', name: 'Test', email: 'customer@example.test', stripe_customer_id: 'cus_test' }
  const first = await createBalanceTopUpIntent(context, user, 'topup')
  const retry = await createBalanceTopUpIntent(context, user, 'topup')
  assert.equal(retry.clientSecret, first.clientSecret)
  assert.equal(calls.filter(call => call.path === 'checkout/sessions').length, 1)
  sqlite.exec("UPDATE balance_topups SET amount = 20 WHERE id = 'topup'")
  const changed = await createBalanceTopUpIntent(context, user, 'topup')
  assert.equal(changed.amountCents, 2000)
  assert.notEqual(changed.clientSecret, first.clientSecret)
  assert.equal(sessions.get('cs_test_1').status, 'expired')
  assert.equal(sqlite.prepare('SELECT stripe_checkout_session_id FROM balance_topups').get()?.stripe_checkout_session_id, 'cs_test_2')
})

test('Checkout rejects inconsistent item totals before sending a Stripe request', async t => {
  const { context, calls } = await setup(t)
  await assert.rejects(() => upsertStripeCheckout(context, { amountCents: 1025, customerId: 'cus_test', items: [{ name: 'Topup', amountCents: 1000 }], metadata: {}, returnUrl: 'https://rent.example.test/', idempotencyKey: 'test' }), /付款明细与合计不匹配/)
  assert.equal(calls.length, 0)
})

async function checkoutWebhook(context: any, eventId: string, type: string, object: any) {
  const app = new Hono()
  app.post('/', c => handleStripeWebhook(c))
  const body = JSON.stringify({ id: eventId, type, data: { object } })
  const timestamp = Math.floor(Date.now() / 1000)
  const signature = createHmac('sha256', 'whsec_example').update(`${timestamp}.${body}`).digest('hex')
  return app.request('https://rent.example.test/', { method: 'POST', body, headers: { 'stripe-signature': `t=${timestamp},v1=${signature}` } }, context.env)
}

test('Checkout top-up links the actual PI, credits once, and ignores session completion accounting', async t => {
  const { sqlite, context, sessions } = await setup(t)
  sqlite.exec("INSERT INTO balance_topups (id, user_id, amount, payment_method, status) VALUES ('topup', 'customer', 10, 'card', 'pending')")
  await createBalanceTopUpIntent(context, { id: 'customer', email: 'customer@example.test' }, 'topup')
  const session = sessions.get('cs_test_1')
  session.payment_intent = 'pi_topup'
  session.status = 'complete'
  session.payment_status = 'paid'
  const intent = { id: 'pi_topup', amount: 1000, amount_received: 1000, currency: 'aud', status: 'succeeded', metadata: { integration: CHECKOUT_INTEGRATION, topup_id: 'topup', customer_id: 'customer' } }
  const paid = await checkoutWebhook(context, 'evt_checkout_pi', 'payment_intent.succeeded', intent)
  assert.equal(paid.status, 200, await paid.text())
  assert.equal(sqlite.prepare("SELECT balance FROM users WHERE id = 'customer'").get()?.balance, 22)
  assert.equal(sqlite.prepare('SELECT status FROM balance_topups').get()?.status, 'paid')
  const sessionEvent = await checkoutWebhook(context, 'evt_checkout_complete', 'checkout.session.completed', session)
  assert.equal(sessionEvent.status, 200, await sessionEvent.text())
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM balance_transactions').get()?.count, 1)
  const duplicate = await checkoutWebhook(context, 'evt_checkout_pi', 'payment_intent.succeeded', intent)
  assert.equal(duplicate.status, 200)
  assert.equal(sqlite.prepare("SELECT balance FROM users WHERE id = 'customer'").get()?.balance, 22)
})

test('Checkout refuses to link a PI belonging to another session', async t => {
  const { sqlite, context, sessions } = await setup(t)
  sqlite.exec("INSERT INTO balance_topups (id, user_id, amount, payment_method, status) VALUES ('topup', 'customer', 10, 'card', 'pending')")
  await createBalanceTopUpIntent(context, { id: 'customer', email: 'customer@example.test' }, 'topup')
  sessions.get('cs_test_1').payment_intent = 'pi_real'
  await assert.rejects(() => linkStripeCheckoutIntent(context, { id: 'pi_wrong', amount: 1025, currency: 'aud', metadata: { integration: CHECKOUT_INTEGRATION, topup_id: 'topup', customer_id: 'customer' } }), /付款摘要数据不匹配/)
  assert.equal(sqlite.prepare('SELECT stripe_payment_intent_id FROM balance_topups').get()?.stripe_payment_intent_id, null)
})

test('Checkout authorization webhook links PI before the session completion event and still issues an invoice', async t => {
  const { sqlite, context, sessions } = await setup(t, { status: 'pending_payment' })
  sqlite.exec("DELETE FROM payment_allocations; DELETE FROM payments; UPDATE orders SET deposit_status = 'PENDING', stripe_deposit_payment_intent_id = NULL;")
  await createOrderPaymentIntent(context, { id: 'customer', role: 'CUSTOMER', email: 'customer@example.test' }, 'order')
  const session = sessions.get('cs_test_1')
  session.payment_intent = 'pi_checkout_hold'
  const payment = sqlite.prepare('SELECT id FROM payments').get()!
  const intent = { id: 'pi_checkout_hold', status: 'requires_capture', currency: 'aud', amount: 30000, amount_capturable: 30000, capture_method: 'manual', payment_method: 'pm_saved', metadata: { integration: CHECKOUT_INTEGRATION, payment_record_id: payment.id, order_id: 'order', customer_id: 'customer', type: 'rental_authorization' } }
  const response = await checkoutWebhook(context, 'evt_checkout_hold', 'payment_intent.amount_capturable_updated', intent)
  assert.equal(response.status, 200, await response.text())
  assert.equal(sqlite.prepare('SELECT stripe_payment_intent_id FROM payments').get()?.stripe_payment_intent_id, 'pi_checkout_hold')
  assert.equal(sqlite.prepare('SELECT deposit_status FROM orders').get()?.deposit_status, 'HELD')
  assert.equal(sqlite.prepare('SELECT status FROM orders').get()?.status, 'paid')
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM invoices').get()?.count, 1)
})

test('the payment helper supports Checkout confirmation and legacy PaymentIntent confirmation', async () => {
  const script = extractInlineScripts(stripePaymentHelperScript())[0]
  const paymentElement = { on(event: string, cb: Function) { if (event === 'ready') queueMicrotask(() => cb()) }, mount() {}, destroy() {} }
  let checkoutConfirmed: any
  let intentConfirmed = false
  const windowMock: any = {
    location: { href: 'https://rent.example.test/pay' },
    Stripe: () => ({
      initCheckoutElementsSdk: () => ({ createBillingAddressElement: () => paymentElement, createPaymentElement: () => paymentElement, loadActions: async () => ({ type: 'success', actions: { confirm: async (opts: any) => { checkoutConfirmed = opts; return { type: 'success' } } } }) }),
      elements: () => ({ create: () => paymentElement }),
      confirmPayment: async () => { intentConfirmed = true; return { paymentIntent: { status: 'succeeded' } } },
    }),
  }
  const documentMock = { createElement: () => ({ style: {} }) }
  new Function('window', 'document', script)(windowMock, documentMock)
  const node = { appendChild() {} }
  const checkout = windowMock.__mountStripePayment(node, { clientSecret: 'cs_test_secret', publishableKey: 'pk_test', returnUrl: '/done' })
  await checkout.ready
  assert.equal((await checkout.confirm()).ok, true)
  assert.equal(checkoutConfirmed.returnUrl, 'https://rent.example.test/done')
  assert.equal(checkoutConfirmed.redirect, 'if_required')
  assert.equal(intentConfirmed, false)
  const legacy = windowMock.__mountStripePayment(node, { clientSecret: 'pi_test_secret', publishableKey: 'pk_test', returnUrl: '/done' })
  await legacy.ready
  assert.equal((await legacy.confirm()).ok, true)
  assert.equal(intentConfirmed, true)
})


test('cancelling a pending Checkout payment expires the form before a PI exists', async t => {
  const { sqlite, context, sessions } = await setup(t, { status: 'pending_payment' })
  sqlite.exec('DELETE FROM payment_allocations; DELETE FROM payments;')
  await createOrderPaymentIntent(context, { id: 'customer', role: 'CUSTOMER', email: 'customer@example.test' }, 'order')
  assert.equal(sqlite.prepare('SELECT stripe_payment_intent_id FROM payments').get()?.stripe_payment_intent_id, null)
  await releaseStripePendingPaymentIntents(context, 'order')
  assert.equal(sessions.get('cs_test_1').status, 'expired')
})

test('a bound Checkout PI remains valid after a partial capture changes the local collected amount', async t => {
  const { sqlite, context, sessions } = await setup(t, { status: 'pending_payment' })
  sqlite.exec('DELETE FROM payment_allocations; DELETE FROM payments;')
  await createOrderPaymentIntent(context, { id: 'customer', role: 'CUSTOMER', email: 'customer@example.test' }, 'order')
  const payment = sqlite.prepare('SELECT id FROM payments').get()!
  sessions.get('cs_test_1').payment_intent = 'pi_checkout_hold'
  const intent = { id: 'pi_checkout_hold', amount: 30000, currency: 'aud', metadata: { integration: CHECKOUT_INTEGRATION, payment_record_id: payment.id, customer_id: 'customer' } }
  await linkStripeCheckoutIntent(context, intent)
  sqlite.exec("UPDATE payments SET amount = 100.00, status = 'paid'")
  await linkStripeCheckoutIntent(context, { ...intent, status: 'succeeded', amount_received: 10000 })
  assert.equal(sqlite.prepare('SELECT amount FROM payments').get()?.amount, 100)
})

test('a completed Checkout authorization is recovered without starting another session', async t => {
  const { sqlite, context, sessions, setIntent, calls } = await setup(t, { status: 'pending_payment' })
  sqlite.exec("DELETE FROM payment_allocations; DELETE FROM payments; UPDATE orders SET deposit_status = 'PENDING', stripe_deposit_payment_intent_id = NULL;")
  const user = { id: 'customer', role: 'CUSTOMER', email: 'customer@example.test' }
  await createOrderPaymentIntent(context, user, 'order')
  const session = sessions.get('cs_test_1')
  session.status = 'complete'
  session.payment_intent = 'pi_auth'
  setIntent({ payment_method: 'pm_card', status: 'requires_capture', amount: 30000, amount_capturable: 30000 })
  const result = await createOrderPaymentIntent(context, user, 'order')
  assert.equal(result.alreadyPaid, true)
  assert.equal(result.authorized, true)
  assert.equal(sqlite.prepare('SELECT status FROM orders').get()?.status, 'paid')
  assert.equal(calls.filter(call => call.path === 'checkout/sessions').length, 1)
})


test('115-day monthly checkout charges one month plus deposit, preserves pricing and settles each month once', async t => {
  const { sqlite, context, calls, sessions } = await setup(t, { status: 'pending_payment' })
  const pricing = { pricePerDay: 20, weeklyDiscountPercent: 10, monthlyDiscountPercent: 20 }
  sqlite.exec("DELETE FROM payment_allocations; DELETE FROM payments; UPDATE users SET stripe_customer_id='cus_test' WHERE id='customer'; UPDATE orders SET startDate='2026-01-01', endDate='2026-04-26', rentalPeriod=115, totalAmount=2040, deposit_status='PENDING', stripe_deposit_payment_intent_id=NULL WHERE id='order'")
  sqlite.prepare('UPDATE orders SET rental_pricing_json=? WHERE id=?').run(rentalPricingSnapshot(pricing), 'order')
  const customer = { id: 'customer', role: 'CUSTOMER', email: 'customer@example.test', stripe_customer_id: 'cus_test' }
  const checkout = await createOrderPaymentIntent(context, customer, 'order')
  assert.equal(checkout.amountCents, 68000)
  assert.deepEqual(sqlite.prepare('SELECT rental_amount FROM rental_installments ORDER BY installment_number').all().map(row => row.rental_amount), [480,480,480,400])
  assert.equal(sqlite.prepare("SELECT billing_mode FROM orders WHERE id='order'").get()?.billing_mode, 'MONTHLY')
  sqlite.exec("UPDATE devices SET pricePerDay=999 WHERE id='device'")
  await createOrderPaymentIntent(context, customer, 'order')
  assert.equal(calls.filter(call => call.path === 'checkout/sessions' && call.method === 'POST').length, 1)
  const first = sqlite.prepare('SELECT * FROM rental_installments ORDER BY installment_number LIMIT 1').get() as any
  const session = [...sessions.values()][0]
  session.payment_intent = 'pi_auth'
  session.status = 'complete'
  const intent = { id:'pi_auth', status:'succeeded', amount:68000, amount_received:68000, currency:'aud', customer:'cus_test', payment_method:'pm_saved', metadata:{ ...session.metadata, type:'rental_installment', installment_id:first.id, payment_record_id:first.payment_id, order_id:'order', customer_id:'customer' } }
  const webhook = new Hono()
  webhook.post('/', c => handleStripeWebhook(c))
  const send = async (object: any, id: string) => {
    const body=JSON.stringify({id,type:'payment_intent.succeeded',data:{object}}), timestamp=Math.floor(Date.now()/1000)
    const signature=createHmac('sha256','whsec_example').update(`${timestamp}.${body}`).digest('hex')
    return webhook.request('https://rent.example.test/',{method:'POST',body,headers:{'stripe-signature':`t=${timestamp},v1=${signature}`}},context.env)
  }
  assert.equal((await send(intent,'evt_monthly_first')).status,200)
  assert.equal(sqlite.prepare("SELECT deposit_status FROM orders WHERE id='order'").get()?.deposit_status,'PAID')
  assert.equal(sqlite.prepare('SELECT total_amount FROM invoices WHERE order_id=?').get('order')?.total_amount,680)
  assert.equal(sqlite.prepare("SELECT stripe_payment_method_id FROM orders WHERE id='order'").get()?.stripe_payment_method_id,'pm_saved')
  sqlite.exec("UPDATE orders SET status='active'")
  const fetchBefore=globalThis.fetch, monthlyIntents=new Map<string,any>()
  let creations=0, confirmations=0
  globalThis.fetch=(async (url:any,init:any)=>{
    const path=String(url).replace('https://api.stripe.com/v1/',''), params=new URLSearchParams(init?.body)
    if(path==='payment_intents' && init?.method==='POST') {
      const id=`pi_month_${++creations}`, metadata=Object.fromEntries([...params].filter(([key])=>key.startsWith('metadata[')).map(([key,value])=>[key.slice(9,-1),value]))
      const value={id,status:'requires_confirmation',amount:Number(params.get('amount')),amount_received:0,currency:'aud',customer:params.get('customer'),payment_method:params.get('payment_method'),metadata,client_secret:id+'_secret'}
      assert.equal(value.amount,creations === 3 ? 40000 : 48000)
      monthlyIntents.set(id,value)
      return Response.json(value)
    }
    const match=path.match(/^payment_intents\/(pi_month_\d+)(\/confirm)?$/)
    if(match) {
      const value=monthlyIntents.get(match[1])
      if(match[2]) { confirmations++; assert.equal(params.get('off_session'),'true'); value.status='succeeded';value.amount_received=value.amount }
      return Response.json(value)
    }
    return fetchBefore(url,init)
  }) as typeof fetch
  for(let i=0;i<3;i++) assert.equal(await chargeDueRentalInstallments(context),1)
  assert.equal(await chargeDueRentalInstallments(context),0)
  assert.equal(creations,3);assert.equal(confirmations,3)
  assert.equal((await send(intent,'evt_monthly_replay')).status,200)
  assert.equal(sqlite.prepare("SELECT status FROM orders WHERE id='order'").get()?.status,'active')
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM payments WHERE status='paid'").get()?.n,4)
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM financial_ledger_entries WHERE source_type='RENTAL_INSTALLMENT'").get()?.n,4)
  assert.equal(sqlite.prepare('SELECT SUM(amount) AS amount FROM payments').get()?.amount,2040)
  assert.equal(sqlite.prepare('SELECT total_paid FROM receipts').get()?.total_paid,2040)
  const order=await getOrderById(context,'order')
  const discount=renderRentalDiscounts(order,pricing)
  assert.match(discount,/月租优惠/);assert.match(discount,/−AUD\$460\.00/)
  const customerHtml=await renderCustomerOrderDetail(context,customer,'order')
  assert.match(customerHtml,/月租付款计划/);assert.doesNotMatch(customerHtml,/订单价格已增加/)
  for(const script of extractInlineScripts(customerHtml)) assert.doesNotThrow(()=>new Function(script))
})

test('110-day installments charge three months then two weeks plus six prorated days', () => {
  const pricing={pricePerDay:100,weeklyDiscountPercent:10,monthlyDiscountPercent:20}
  const order={id:'o-monthly',startDate:'2026-01-01',endDate:'2026-04-21',rentalPeriod:110,totalAmount:9200,depositAmount:200,deposit_method:'card_hold'}
  const plan=buildMonthlyRentalInstallments(order,pricing,0.025)
  assert.deepEqual(plan.map(row=>row.rental_amount),[2400,2400,2400,1800])
  assert.deepEqual(plan.map(row=>row.deposit_amount),[200,0,0,0])
  assert.deepEqual(plan.map(row=>row.due_date),['2026-01-01','2026-01-31','2026-03-02','2026-04-01'])
  const coupon=buildMonthlyRentalInstallments({...order,totalAmount:9100},pricing,0.025)
  assert.equal(Math.round(coupon.reduce((sum,row)=>sum+row.rental_amount,0)*100),890000)
})


async function monthlyFixture(t: any) {
  const fixture=await setup(t,{status:'pending_payment'})
  const {sqlite,context}=fixture
  sqlite.exec("DELETE FROM payment_allocations; DELETE FROM payments; UPDATE orders SET startDate='2026-01-01',endDate='2026-04-26',rentalPeriod=115,totalAmount=2040,deposit_status='PENDING',stripe_deposit_payment_intent_id=NULL WHERE id='order'; UPDATE devices SET monthly_discount_override=20, monthly_discount_percent=20 WHERE id='device'")
  const customer={id:'customer',role:'CUSTOMER',email:'customer@example.test'}
  await createOrderPaymentIntent(context,customer,'order')
  sqlite.exec("UPDATE orders SET status='active',stripe_payment_method_id='pm_saved'; UPDATE rental_installments SET status='paid' WHERE installment_number=1; UPDATE payments SET status='paid',stripe_payment_intent_id='pi_first',paid_at=CURRENT_TIMESTAMP")
  return {...fixture,customer}
}

test('settings saves cannot re-enable card surcharges', async t => {
  const { sqlite, context } = await setup(t)
  const app = new Hono()
  app.post('/', c => handleSaveAdminSettings(c))
  const response = await app.request('https://rent.example.test/', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ paymentMethods: { stripe: true, processingFeeRate: 0.5 } }),
  }, context.env)
  assert.equal(response.status, 200, await response.text())
  const stored = JSON.parse(String(sqlite.prepare("SELECT value FROM systemSettings WHERE key = 'paymentMethods'").get()?.value))
  assert.equal(stored.processingFeeRate, 0)
  assert.equal(stored.stripe, true)
  assert.equal(getStripeProcessingFeeRate(), 0)
})

for (const processing of [false, true]) test(`legacy monthly surcharge ${processing ? 'remains recorded while Stripe processes' : 'is removed before retrying payment'}`, async t => {
  const { sqlite, context, customer } = await monthlyFixture(t)
  const part = sqlite.prepare('SELECT * FROM rental_installments WHERE installment_number = 2').get()!
  sqlite.exec("INSERT INTO payments (id, rental_id, customer_id, payment_method, amount, rental_amount, deposit_amount, processing_fee, status, stripe_payment_intent_id) VALUES ('old-monthly-payment', 'order', 'customer', 'card', 492, 480, 0, 12, 'pending', 'pi_old_monthly')")
  sqlite.prepare("UPDATE rental_installments SET processing_fee = 12, amount = 492, payment_id = 'old-monthly-payment', stripe_payment_intent_id = 'pi_old_monthly' WHERE id = ?").run(part.id)
  const previous = globalThis.fetch, events: string[] = []
  t.mock.method(globalThis, 'fetch', async (url: any, init: any) => {
    const path = String(url).replace('https://api.stripe.com/v1/', '')
    events.push(path)
    if (path === 'payment_intents/pi_old_monthly') return Response.json({ id: 'pi_old_monthly', status: processing ? 'processing' : 'requires_payment_method', amount: 49200, currency: 'aud' })
    if (path === 'payment_intents/pi_old_monthly/cancel') return Response.json({ id: 'pi_old_monthly', status: 'canceled' })
    return previous(url, init)
  })
  const pay = () => createOrderInstallmentPaymentIntent(context, customer, 'order', String(part.id))
  if (processing) {
    await assert.rejects(pay, /Stripe 正在确认付款/)
    assert.equal(sqlite.prepare("SELECT amount FROM payments WHERE id = 'old-monthly-payment'").get()?.amount, 492)
    assert.equal(events.includes('payment_intents/pi_old_monthly/cancel'), false)
    assert.equal(events.includes('checkout/sessions'), false)
  } else {
    const result = await pay()
    assert.equal(result.amountCents, 48000)
    assert.ok(events.indexOf('payment_intents/pi_old_monthly/cancel') < events.indexOf('checkout/sessions'))
    assert.equal(sqlite.prepare("SELECT processing_fee FROM payments WHERE id = 'old-monthly-payment'").get()?.processing_fee, 0)
    assert.equal(sqlite.prepare('SELECT amount FROM rental_installments WHERE id = ?').get(part.id)?.amount, 480)
    assert.equal(sqlite.prepare('SELECT processing_fee FROM rental_installments WHERE installment_number = 1').get()?.processing_fee, 0)
    const retry = await pay()
    assert.equal(retry.clientSecret, result.clientSecret)
    assert.equal(events.filter(path => path === 'checkout/sessions').length, 1)
  }
})

test('a failed monthly charge is visible, is not charged again by cron and can be paid by its owner',async t=>{
  const {sqlite,context,customer}=await monthlyFixture(t)
  let intent:any,confirmations=0
  const fetchBefore=globalThis.fetch
  globalThis.fetch=(async(url:any,init:any)=>{
    const path=String(url).replace('https://api.stripe.com/v1/',''),params=new URLSearchParams(init?.body)
    if(path==='payment_intents' && init?.method==='POST') {
      intent={id:'pi_month_failed',status:'requires_confirmation',amount:Number(params.get('amount')),currency:'aud',customer:'cus_test',payment_method:'pm_saved',client_secret:'pi_month_failed_secret',metadata:Object.fromEntries([...params].filter(([key])=>key.startsWith('metadata[')).map(([key,value])=>[key.slice(9,-1),value]))}
      return Response.json(intent)
    }
    if(path==='payment_intents/pi_month_failed/confirm') {confirmations++;intent.status='requires_action';return Response.json({error:{message:'Authentication required'}},{status:402})}
    if(path==='payment_intents/pi_month_failed') return Response.json(intent)
    return fetchBefore(url,init)
  }) as typeof fetch
  assert.equal(await chargeDueRentalInstallments(context),0)
  const part=sqlite.prepare('SELECT * FROM rental_installments WHERE installment_number=2').get() as any
  assert.equal(part.status,'failed')
  assert.equal(sqlite.prepare('SELECT status FROM payments WHERE id=?').get(part.payment_id)?.status,'failed')
  const notices=sqlite.prepare("SELECT recipient_id,COUNT(*) AS n FROM notifications WHERE title='月租扣款未完成' GROUP BY recipient_id").all()
  assert.ok(notices.some(row=>row.recipient_id==='customer'));assert.ok(notices.length>=2);assert.ok(notices.every(row=>row.n===1))
  assert.equal(await chargeDueRentalInstallments(context),0);assert.equal(confirmations,1)
  await assert.rejects(()=>createOrderInstallmentPaymentIntent(context,{...customer,id:'other'},'order',part.id),/无权访问/)
  const retry=await createOrderInstallmentPaymentIntent(context,customer,'order',part.id)
  assert.equal(retry.clientSecret,'pi_month_failed_secret');assert.equal(retry.amountCents,48000)
  for(const change of [{amount_received:1},{currency:'usd'},{customer:'cus_other'},{metadata:{...intent.metadata,customer_id:'other'}}]) {
    await assert.rejects(()=>settleRentalInstallment(context,{...intent,status:'succeeded',amount_received:48000,...change}),/月付数据不匹配/)
  }
  await settleRentalInstallment(context,{...intent,status:'succeeded',amount_received:48000})
  assert.equal(sqlite.prepare('SELECT status FROM rental_installments WHERE installment_number=2').get()?.status,'paid')
})

test('returning a monthly rental stops future installments and refunds only unused paid rent',async t=>{
  const {sqlite,context}=await monthlyFixture(t)
  sqlite.exec("UPDATE orders SET status='completed',refundMethod='balance'")
  assert.deepEqual(sqlite.prepare('SELECT status FROM rental_installments ORDER BY installment_number').all().map(row=>row.status),['paid','cancelled','cancelled','cancelled'])
  assert.equal(await chargeDueRentalInstallments(context),0)
  const order=await getOrderById(context,'order')
  await refundUnusedRentalDays(context,{id:'admin'},order,'2026-01-16')
  assert.equal(sqlite.prepare("SELECT refund_amount FROM payment_refunds WHERE type='early_return'").get()?.refund_amount,240)
  await refundUnusedRentalDays(context,{id:'admin'},order,'2026-01-16')
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM payment_refunds WHERE type='early_return'").get()?.n,1)
})


async function cancellationFixture(t: any, status='paid', localPaymentStatus='paid') {
  const fixture=await setup(t,{status,mode:'SETUP_INTENT'})
  fixture.sqlite.exec("UPDATE orders SET totalAmount=2655,deposit_status='NOT_REQUIRED',stripe_deposit_payment_intent_id=NULL; UPDATE payments SET amount=2455,rental_amount=2455,deposit_amount=0,processing_fee=0")
  fixture.sqlite.prepare('UPDATE payments SET status=?').run(localPaymentStatus)
  fixture.setIntent({status:'succeeded',amount:245500,amount_received:245500,currency:'aud',metadata:{order_id:'order',customer_id:'customer',type:'rental_payment'}})
  const refunds:any[]=[]
  let refundPosts=0,replyStatus='succeeded',loseResponse=false
  const fetchBefore=globalThis.fetch
  globalThis.fetch=(async(url:any,init:any)=>{
    const path=String(url).replace('https://api.stripe.com/v1/','')
    if(path.startsWith('refunds?')) return Response.json({data:refunds})
    if(path==='refunds' && init?.method==='POST') {
      refundPosts++
      const params=new URLSearchParams(init.body)
      assert.equal(params.get('payment_intent'),'pi_auth')
      assert.equal(params.get('amount'),'245500')
      assert.equal(init.headers['Idempotency-Key'],'cancellation-refund-order')
      const refund={id:'re_cancellation',status:replyStatus,amount:245500,currency:'aud',payment_intent:'pi_auth',metadata:{order_id:'order',type:'cancellation'}}
      refunds.push(refund)
      if(loseResponse) {loseResponse=false;throw new Error('Refund response lost')}
      return Response.json(refund)
    }
    return fetchBefore(url,init)
  }) as typeof fetch
  return {...fixture,refunds,refundPosts:()=>refundPosts,setReply:(status:string)=>{replyStatus=status},loseNextResponse:()=>{loseResponse=true}}
}

for(const path of ['/staff/orders/order/cancel','/admin/orders/order/update','/admin/orders/bulk-update','/admin/orders/order/cancel-and-refund']) {
  test(`cancelling through ${path} refunds the captured AUD 2455 to Stripe`,async t=>{
    const {sqlite,context,refundPosts}=await cancellationFixture(t)
    const form: Record<string,string> =path.endsWith('bulk-update')?{status:'cancelled',reason:'客户取消',orderIds:'order'}:{status:'cancelled',reason:'客户取消'}
    const response=await requestAsAdmin(context,path,form)
    assert.ok(response.status===302||response.status===303,await response.text())
    assert.equal(refundPosts(),1)
    assert.equal(sqlite.prepare('SELECT status FROM orders').get()?.status,'cancelled')
    assert.equal(sqlite.prepare('SELECT status FROM payments').get()?.status,'refunded')
    const refund=sqlite.prepare("SELECT refund_amount,refund_method,stripe_refund_id FROM payment_refunds WHERE type='cancellation'").get()!
    assert.equal(refund.refund_amount,2455);assert.equal(refund.refund_method,'stripe');assert.equal(refund.stripe_refund_id,'re_cancellation')
    assert.equal(sqlite.prepare("SELECT balance FROM users WHERE id='customer'").get()?.balance,12)
  })
}

test('a pending Stripe refund does not cancel the order or report a completed refund',async t=>{
  const {sqlite,context,refundPosts,setReply}=await cancellationFixture(t)
  setReply('pending')
  assert.equal((await requestAsAdmin(context,'/staff/orders/order/cancel',{reason:'客户取消'})).status,502)
  assert.equal(sqlite.prepare('SELECT status FROM orders').get()?.status,'paid')
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM payment_refunds').get()?.n,0)
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM notifications WHERE type='refund_completed'").get()?.n,0)
  assert.equal(refundPosts(),1)
})

test('cancellation refunds a successful Stripe charge even before its payment webhook arrives',async t=>{
  const {sqlite,context,refundPosts,intent}=await cancellationFixture(t,'pending_payment','pending')
  assert.equal((await requestAsAdmin(context,'/staff/orders/order/cancel',{reason:'客户取消'})).status,303)
  assert.equal(refundPosts(),1)
  const app=new Hono();app.post('/',c=>handleStripeWebhook(c))
  const object={...intent,status:'succeeded',amount:245500,amount_received:245500,metadata:{order_id:'order',customer_id:'customer',type:'rental_payment'}}
  const body=JSON.stringify({id:'evt_late_after_cancellation',type:'payment_intent.succeeded',data:{object}}),timestamp=Math.floor(Date.now()/1000)
  const signature=createHmac('sha256','whsec_example').update(`${timestamp}.${body}`).digest('hex')
  assert.equal((await app.request('https://rent.example.test/',{method:'POST',body,headers:{'stripe-signature':`t=${timestamp},v1=${signature}`}},context.env)).status,200)
  assert.equal(sqlite.prepare('SELECT status FROM payments').get()?.status,'refunded')
  assert.equal(sqlite.prepare('SELECT status FROM orders').get()?.status,'cancelled')
})

test('an old cancelled order exposes a refund retry and refunds its existing Stripe payment',async t=>{
  const {sqlite,context,refundPosts}=await cancellationFixture(t,'cancelled')
  const html=await renderAdminOrderDetail(context,{id:'admin',role:'ADMIN'},'order')
  assert.match(html,/action="\/admin\/orders\/order\/retry-cancellation-refund"/)
  assert.equal((await requestAsAdmin(context,'/admin/orders/order/retry-cancellation-refund',{})).status,303)
  assert.equal(refundPosts(),1)
  assert.equal(sqlite.prepare('SELECT refund_amount FROM payment_refunds').get()?.refund_amount,2455)
  assert.equal((await requestAsAdmin(context,'/admin/orders/order/retry-cancellation-refund',{})).status,409)
  assert.equal(refundPosts(),1)
})

test('retrying after a lost Stripe refund response recovers that refund without charging Stripe again',async t=>{
  const {sqlite,context,refundPosts,loseNextResponse}=await cancellationFixture(t)
  loseNextResponse()
  assert.equal((await requestAsAdmin(context,'/staff/orders/order/cancel',{reason:'客户取消'})).status,502)
  assert.equal(sqlite.prepare('SELECT status FROM orders').get()?.status,'paid')
  assert.equal((await requestAsAdmin(context,'/staff/orders/order/cancel',{reason:'客户取消'})).status,303)
  assert.equal(refundPosts(),1)
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM payment_refunds').get()?.n,1)
})

test('cancellation releases a manual authorization without creating a cash refund',async t=>{
  const {sqlite,context,calls}=await setup(t,{status:'paid'})
  const response=await requestAsAdmin(context,'/staff/orders/order/cancel',{reason:'客户取消'})
  assert.equal(response.status,303,await response.text())
  assert.equal(sqlite.prepare('SELECT status FROM orders').get()?.status,'cancelled')
  assert.equal(sqlite.prepare('SELECT status FROM payments').get()?.status,'failed')
  assert.equal(calls.filter(call=>call.path.endsWith('/cancel')).length,1)
  assert.equal(calls.filter(call=>call.path==='refunds').length,0)
})


test('a long rental can switch between full payment without deposit and monthly payments before charging', async t => {
  const {sqlite,context,sessions}=await setup(t,{status:'pending_payment',mode:'SETUP_INTENT'})
  sqlite.exec("DELETE FROM payment_allocations; DELETE FROM payments; UPDATE orders SET startDate='2026-01-01',endDate='2026-04-26',rentalPeriod=115,totalAmount=2040,depositAmount=200,deposit_status='PENDING',stripe_deposit_payment_intent_id=NULL")
  sqlite.prepare('UPDATE orders SET rental_pricing_json=?').run(rentalPricingSnapshot({pricePerDay:20,weeklyDiscountPercent:10,monthlyDiscountPercent:20}))
  const customer={id:'customer',role:'CUSTOMER',email:'customer@example.test'}
  await createOrderPaymentIntent(context,customer,'order')
  assert.equal(sessions.get('cs_test_1').status,'open')
  sessions.get('cs_test_1').status='complete'
  await assert.rejects(()=>setRentalPaymentPlan(context,{...(sqlite.prepare('SELECT * FROM orders').get() as any)},'FULL'),/正在确认付款/)
  assert.equal(sqlite.prepare('SELECT depositAmount FROM orders').get()?.depositAmount,200)
  sessions.get('cs_test_1').status='open'
  let order=await setRentalPaymentPlan(context,await getOrderById(context,'order'),'FULL')
  assert.equal(sessions.get('cs_test_1').status,'expired')
  assert.equal(order.depositAmount,0);assert.equal(order.totalAmount,1840);assert.equal(order.deposit_status,'NOT_REQUIRED')
  assert.equal(order.billing_mode,'FULL');assert.equal(JSON.parse(order.rental_pricing_json!).billingMode,'FULL')
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM rental_installments').get()?.n,0)
  const full=await createOrderPaymentIntent(context,customer,'order')
  assert.equal(full.amountCents,184000)
  assert.equal(sqlite.prepare("SELECT deposit_amount FROM payments WHERE status='pending'").get()?.deposit_amount,0)
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM rental_installments').get()?.n,0)
  sqlite.exec('UPDATE devices SET depositAmount=999')
  order=await setRentalPaymentPlan(context,await getOrderById(context,'order'),'MONTHLY')
  assert.equal(order.depositAmount,200);assert.equal(order.totalAmount,2040)
  const monthly=await createOrderPaymentIntent(context,customer,'order')
  assert.equal(monthly.amountCents,68000)
  assert.deepEqual(sqlite.prepare('SELECT rental_amount FROM rental_installments ORDER BY installment_number').all().map(row=>row.rental_amount),[480,480,480,400])
  const html=renderRentalPaymentPlan(order,{pricePerDay:20,depositAmount:999},'/customer/orders/order/payment-plan')
  assert.match(html,/一次性付清（免押金）/);assert.match(html,/AUD\$1840\.00/)
})

test('full payment is available below 60 days while monthly eligibility starts at 60 days',async t=>{
  const {sqlite,context}=await setup(t,{status:'pending_payment'})
  sqlite.exec('DELETE FROM payment_allocations; DELETE FROM payments')
  const originalDeposit=Number((await getOrderById(context,'order'))!.depositAmount)
  for (const days of [1,7,30,59]) {
    sqlite.prepare('UPDATE orders SET rentalPeriod=?').run(days)
    const shortOrder=await getOrderById(context,'order')
    await assert.rejects(()=>setRentalPaymentPlan(context,shortOrder,'MONTHLY'),/60天/)
    const shortHtml=renderRentalPaymentPlan(shortOrder,{pricePerDay:20,depositAmount:100},'/customer/orders/order/payment-plan')
    assert.equal(shortHtml,'')
    assert.doesNotMatch(shortHtml,/免押金/)
    const full=await setRentalPaymentPlan(context,shortOrder,'FULL')
    assert.equal(full.depositAmount,originalDeposit)
    assert.equal(full.totalAmount,300)
    assert.equal(full.deposit_payment_mode,'PREAUTH')
  }
  sqlite.exec('UPDATE orders SET rentalPeriod=60')
  const monthly=await setRentalPaymentPlan(context,await getOrderById(context,'order'),'MONTHLY')
  assert.equal(monthly.depositAmount,originalDeposit)
  assert.match(renderRentalPaymentPlan(monthly,{pricePerDay:20},'/customer/orders/order/payment-plan'),/value="MONTHLY" checked/)
  const order=await setRentalPaymentPlan(context,await getOrderById(context,'order'),'FULL')
  assert.equal(order.depositAmount,0)
  sqlite.exec("INSERT INTO payments(id,rental_id,customer_id,payment_method,amount,rental_amount,deposit_amount,status) VALUES('charged','order','customer','card',100,100,0,'paid')")
  await assert.rejects(()=>setRentalPaymentPlan(context,order,'MONTHLY'),/已有付款/)
  assert.equal(sqlite.prepare('SELECT depositAmount FROM orders').get()?.depositAmount,0)
})

test('short full payment restores its quoted deposit after a prior waiver',async t=>{
  const {sqlite,context}=await setup(t,{status:'pending_payment'})
  sqlite.exec('DELETE FROM payment_allocations; DELETE FROM payments; UPDATE orders SET rentalPeriod=60')
  let order=await setRentalPaymentPlan(context,await getOrderById(context,'order'),'FULL')
  assert.equal(order.depositAmount,0)
  sqlite.exec('UPDATE orders SET rentalPeriod=59; UPDATE devices SET depositAmount=999')
  order=await setRentalPaymentPlan(context,await getOrderById(context,'order'),'FULL')
  assert.equal(order.depositAmount,200)
  assert.equal(order.totalAmount,300)
  assert.equal(order.deposit_status,'PENDING')
  const html=await renderCustomerOrderDetail(context,{id:'customer',role:'CUSTOMER'},'order')
  assert.match(html,/付款计划:<\/strong> 一次性付清<\/p>/)
  assert.doesNotMatch(html,/一次性付清（免押金）/)
})

test('only the customer who owns an unpaid long rental can update the plan',async t=>{
  const {sqlite,context}=await setup(t,{status:'pending_payment'})
  sqlite.exec('DELETE FROM payment_allocations; DELETE FROM payments; UPDATE orders SET rentalPeriod=60')
  assert.equal((await requestAsAdmin(context,'/customer/orders/order/payment-plan',{billingMode:'FULL',depositAmount:'0',totalAmount:'1'})).status,403)
  const session=await createAuthSession(context,'customer')
  const response=await worker.fetch(new Request('https://rent.example.test/customer/orders/order/payment-plan',{method:'POST',body:new URLSearchParams({billingMode:'FULL',depositAmount:'999',totalAmount:'1'}),headers:{Cookie:`session=${session.token}`,Origin:'https://rent.example.test','Sec-Fetch-Site':'same-origin'}}),context.env,{waitUntil(){}} as any)
  assert.equal(response.status,303)
  assert.equal(sqlite.prepare('SELECT totalAmount FROM orders').get()?.totalAmount,100)
  assert.equal(sqlite.prepare('SELECT depositAmount FROM orders').get()?.depositAmount,0)
})

test('a signing token can select full payment only before signing with a completed sign session',async t=>{
  const {sqlite,context}=await setup(t,{status:'draft'})
  sqlite.exec('DELETE FROM payment_allocations; DELETE FROM payments; UPDATE orders SET rentalPeriod=60')
  const token='q'.repeat(32)
  sqlite.prepare("INSERT INTO contracts(id,orderId,contractNumber,content,status,signToken,signExpiresAt) VALUES('plan-contract','order','CTR-PLAN','<p>合同</p>','pending_sign',?,'2099-01-01')").run(token)
  await getOrCreateSignSession(context,token,token)
  await updateSignSession(context,token,{agreedToTerms:true,userInfo:{name:'客户'}})
  const page=await worker.fetch(new Request(`https://rent.example.test/contract/sign?token=${token}&step=4`),context.env,{waitUntil(){}} as any)
  assert.equal(page.status,200)
  const html=await page.text()
  assert.match(html,/一次性付清（免押金）/)
  for(const script of extractInlineScripts(html)) assert.doesNotThrow(()=>new Function(script))

  const send=()=>worker.fetch(new Request(`https://rent.example.test/contract/sign/payment-plan?token=${token}`,{method:'POST',body:new URLSearchParams({billingMode:'FULL'}),headers:{Origin:'https://rent.example.test','Sec-Fetch-Site':'same-origin'}}),context.env,{waitUntil(){}} as any)
  assert.equal((await send()).status,303)
  assert.equal(sqlite.prepare('SELECT depositAmount FROM orders').get()?.depositAmount,0)
  sqlite.exec("UPDATE contracts SET status='signed'")
  assert.equal((await send()).status,403)
})


test('switching payment plans preserves the risk-adjusted deposit and its base price', async t => {
  const { sqlite, context } = await setup(t, { status: 'pending_payment' })
  sqlite.exec('DELETE FROM payment_allocations; DELETE FROM payments; UPDATE orders SET rentalPeriod=60')
  for (const [level, multiplier, deposit] of [['VERY_LOW', 0, 0], ['LOW', 0.5, 150], ['NORMAL', 1, 300], ['MEDIUM', 1.25, 375], ['HIGH', 1.5, 450], ['CRITICAL', 2, 600]] as const) {
    const snapshot = JSON.stringify({ billingMode: 'MONTHLY', pricePerDay: 20, baseDepositAmount: 300, depositRiskLevel: level, depositMultiplier: multiplier, depositAmountBeforeWaiver: deposit })
    sqlite.prepare("UPDATE orders SET billing_mode='MONTHLY', rental_pricing_json=?, depositAmount=?, totalAmount=?, deposit_payment_mode='PAID' WHERE id='order'").run(snapshot, deposit, 1200 + deposit)
    sqlite.exec('UPDATE devices SET depositAmount=999')
    let order = await setRentalPaymentPlan(context, await getOrderById(context, 'order'), 'FULL')
    assert.equal(order.depositAmount, multiplier > 1 ? deposit : 0)
    assert.equal(order.totalAmount, 1200 + (multiplier > 1 ? deposit : 0))
    const html = renderRentalPaymentPlan(order, { pricePerDay: 20, depositAmount: 999 }, '/payment-plan')
    if (multiplier > 1) {
      assert.doesNotMatch(html, /免押金/)
      assert.match(html, new RegExp('AUD\\$' + (1200 + deposit).toFixed(2).replace('.', '\\.')))
    }
    order = await setRentalPaymentPlan(context, order, 'MONTHLY')
    assert.equal(order.depositAmount, deposit)
    assert.equal(JSON.parse(order.rental_pricing_json).baseDepositAmount, 300)
  }
})
