/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { URL } from 'node:url'
import { readFileSync, readdirSync } from 'node:fs'
import { createHmac } from 'node:crypto'
import worker from '../src/index'
import { createAuthSession } from '../src/site'
import { saveStripeConfig } from '../src/stripe'

async function setup(t: any, method = 'card', authorization = false) {
  const sqlite = new DatabaseSync(':memory:')
  t.after(() => sqlite.close())
  for (const name of readdirSync(new URL('../migrations/', import.meta.url)).filter(n => n.endsWith('.sql')).sort()) sqlite.exec(readFileSync(new URL(`../migrations/${name}`, import.meta.url), 'utf8'))
  sqlite.exec("INSERT INTO users (id, name, email, role, balance) VALUES ('customer', '客户', 'refund-customer@example.test', 'CUSTOMER', 12), ('other', '其他客户', 'other@example.test', 'CUSTOMER', 0), ('admin', '管理员', 'refund-admin@example.test', 'ADMIN', 0), ('staff', '员工', 'refund-staff@example.test', 'STAFF', 0)")
  sqlite.exec("INSERT INTO devices (id, name, model, pricePerDay, depositAmount, serialNumber, status) VALUES ('device', '电脑', 'Test', 20, 100, 'REFUND-SN', 'available')")
  sqlite.prepare("INSERT INTO orders (id, userId, deviceId, startDate, endDate, rentalPeriod, totalAmount, depositAmount, serviceFee, status, paymentMethod, is_manual, deposit_payment_mode, deposit_status, stripe_deposit_payment_intent_id) VALUES ('order', 'customer', 'device', '2026-01-01', '2026-01-07', 6, 220, 100, 20, 'paid', ?, 1, ?, 'HELD', ?)").run(method, authorization ? 'PREAUTH' : 'PAID', authorization ? 'pi_refund' : null)
  sqlite.prepare("INSERT INTO payments (id, rental_id, customer_id, payment_method, amount, deposit_amount, rental_amount, processing_fee, status, stripe_payment_intent_id) VALUES ('payment', 'order', 'customer', ?, ?, 100, 120, ?, ?, ?)").run(method, method === 'card' ? 225.5 : 220, method === 'card' ? 5.5 : 0, authorization ? 'pending' : 'paid', method === 'card' ? 'pi_refund' : null)
  const db = {
    prepare(sql: string) {
      let values: any[] = []
      const statement = {
        bind(...input: any[]) { values = input; return statement },
        async first() { return sqlite.prepare(sql).get(...values) || null },
        async all() { return { results: sqlite.prepare(sql).all(...values) } },
        execute() { return { success: true, meta: { changes: Number(sqlite.prepare(sql).run(...values).changes) } } },
        async run() { return statement.execute() },
      }
      return statement
    },
    async batch(statements: any[]) {
      sqlite.exec('BEGIN')
      try { const result = statements.map(s => s.execute()); sqlite.exec('COMMIT'); return result }
      catch (error) { sqlite.exec('ROLLBACK'); throw error }
    },
  }
  const env = { RENT: db, SETTINGS_ENCRYPTION_KEY: 'customer-refund-test-key' }
  await saveStripeConfig({ env } as any, { publishableKey: 'pk_test_refund', secretKey: 'sk_test_refund', webhookSecret: 'whsec_refund' })
  const sessions = new Map<string, string>()
  for (const id of ['customer', 'other', 'admin', 'staff']) sessions.set(id, (await createAuthSession({ env } as any, id)).token)
  const request = (path: string, actor = 'customer', form?: Record<string, string>) => worker.fetch(new Request(`https://rent.example.test${path}`, {
    method: form ? 'POST' : 'GET', body: form ? new URLSearchParams(form) : undefined,
    headers: { Cookie: `session=${sessions.get(actor)}`, Origin: 'https://rent.example.test', 'Sec-Fetch-Site': 'same-origin' },
  }), env, { waitUntil() {} } as any)
  const refunds: any[] = []
  let posts = 0, loseResponse = false, remoteStatus = 'succeeded', captures = 0, releases = 0
  let intent: any = { id: 'pi_refund', currency: 'aud', amount: 22550, amount_received: authorization ? 0 : 22550, status: authorization ? 'requires_capture' : 'succeeded', metadata: { order_id: 'order', customer_id: 'customer' } }
  t.mock.method(globalThis, 'fetch', async (url: any, init: any) => {
    const path = String(url).replace('https://api.stripe.com/v1/', '')
    if (path.startsWith('refunds?')) return Response.json({ data: refunds })
    if (path.startsWith('refunds/')) return Response.json(refunds.find(r => r.id === path.split('/')[1]))
    if (path === 'refunds' && init.method === 'POST') {
      posts++
      const params = new URLSearchParams(init.body)
      assert.match(init.headers['Idempotency-Key'], /^customer-refund-/)
      const remote = { id: `re_${posts}`, status: remoteStatus, amount: Number(params.get('amount')), currency: 'aud', payment_intent: params.get('payment_intent'), metadata: { customer_refund_id: params.get('metadata[customer_refund_id]') } }
      refunds.push(remote)
      if (loseResponse) { loseResponse = false; throw new Error('Lost Stripe response') }
      return Response.json(remote)
    }
    if (path === 'payment_intents/pi_refund/capture') {
      captures++
      intent = { ...intent, status: 'succeeded', amount_received: Number(new URLSearchParams(init.body).get('amount_to_capture')) }
    } else if (path === 'payment_intents/pi_refund/cancel') {
      releases++
      intent = { ...intent, status: 'canceled' }
    } else assert.equal(path, 'payment_intents/pi_refund', `Unexpected external request: ${path}`)
    return Response.json(intent)
  })
  const preview = async () => {
    const response = await request('/customer/orders/order/refund-request')
    assert.equal(response.status, 200)
    const html = await response.text()
    const quoteToken = /name="quoteToken" value="([^"]+)"/.exec(html)?.[1]
    assert.ok(quoteToken, html.slice(-1500))
    return { html, quoteToken }
  }
  const submit = async (extra: Record<string, string> = {}) => {
    const { quoteToken } = await preview()
    return request('/customer/orders/order/refund-request', 'customer', { quoteToken, confirmRefund: '1', reason: '行程取消', refundBsb: '123-456', refundAccountNumber: '12345678', refundAccountName: 'Customer', ...extra })
  }
  const application = () => sqlite.prepare('SELECT * FROM customer_refund_requests ORDER BY rowid DESC LIMIT 1').get()!
  const approve = () => request(`/admin/refund-requests/${application().id}/approve`, 'admin', {})
  const webhook = (id: string, refund: any) => {
    const body = JSON.stringify({ id, type: 'refund.updated', data: { object: refund } }), time = Math.floor(Date.now() / 1000)
    const signature = createHmac('sha256', 'whsec_refund').update(`${time}.${body}`).digest('hex')
    return worker.fetch(new Request('https://rent.example.test/webhooks/stripe', { method: 'POST', body, headers: { 'stripe-signature': `t=${time},v1=${signature}` } }), env, { waitUntil() {} } as any)
  }
  return { sqlite, request, preview, submit, application, approve, webhook, refunds, posts: () => posts, captures: () => captures, releases: () => releases, loseResponse: () => { loseResponse = true }, pending: () => { remoteStatus = 'pending' } }
}

test('every pre-confirmation state quotes a full refund without a cancellation fee', async t => {
  const f = await setup(t)
  for (const status of ['draft', 'pending_approval', 'approved', 'awaiting_signature', 'pending_payment']) {
    f.sqlite.prepare('UPDATE orders SET status = ?').run(status)
    const { html } = await f.preview()
    assert.match(html, /我确认申请全额退款/)
    assert.doesNotMatch(html, /我确认扣除订单总额 5%|<dt>退款手续费（订单总额的 5%）<\/dt>/)
    assert.match(html, /225\.50/)
  }
  assert.equal((await f.submit()).status, 303)
  assert.equal(f.application().fee_amount, 0)
  assert.equal((await f.approve()).status, 303)
  assert.equal(f.refunds[0].amount, 22550)
  const refund = f.sqlite.prepare('SELECT * FROM payment_refunds').get()!
  assert.equal(refund.deduction_amount, 0)
  assert.equal(refund.deduction_reason, '取消订单全额退款')
})

test('pre-confirmation authorisation is fully released without capturing a fee', async t => {
  const f = await setup(t, 'card', true)
  f.sqlite.exec("UPDATE orders SET status = 'pending_payment'")
  assert.equal((await f.submit()).status, 303)
  const response = await f.approve()
  assert.equal(response.status, 303, await response.text())
  assert.equal(f.captures(), 0)
  assert.equal(f.releases(), 1)
  assert.equal(f.posts(), 0)
  assert.equal(f.application().fee_amount, 0)
  const refund = f.sqlite.prepare('SELECT * FROM payment_refunds').get()!
  assert.equal(refund.refund_amount, 0)
  assert.equal(refund.deduction_amount, 0)
})

test('pre-confirmation balance refunds credit the full payment and describe no deducted fee', async t => {
  const f = await setup(t, 'balance')
  f.sqlite.exec("UPDATE orders SET status = 'approved'")
  assert.equal((await f.submit()).status, 303)
  assert.equal((await f.approve()).status, 303)
  assert.equal(f.sqlite.prepare("SELECT balance FROM users WHERE id = 'customer'").get()?.balance, 232)
  assert.equal(f.sqlite.prepare('SELECT reason FROM balance_transactions').get()?.reason, '取消订单全额退款')
  assert.equal(f.sqlite.prepare("SELECT description FROM financial_ledger_entries WHERE entry_type = 'REFUND'").get()?.description, '取消订单全额退款')
})

test('confirmed orders awaiting pickup retain the 5% fee', async t => {
  const f = await setup(t, 'balance')
  f.sqlite.exec("UPDATE orders SET status = 'pending_pickup'")
  assert.equal((await f.submit()).status, 303)
  assert.equal(f.application().fee_amount, 11)
  assert.equal((await f.approve()).status, 303)
  assert.equal(f.sqlite.prepare('SELECT refund_amount FROM payment_refunds').get()?.refund_amount, 209)
})

test('confirmation changes invalidate a fee-free quote at submission and approval', async t => {
  const f = await setup(t, 'balance')
  f.sqlite.exec("UPDATE orders SET status = 'approved'")
  const { quoteToken } = await f.preview()
  f.sqlite.exec("UPDATE orders SET status = 'paid'")
  assert.equal((await f.request('/customer/orders/order/refund-request', 'customer', { quoteToken, confirmRefund: '1', reason: '取消' })).status, 409)
  f.sqlite.exec("UPDATE orders SET status = 'approved'")
  assert.equal((await f.submit()).status, 303)
  f.sqlite.exec("UPDATE orders SET status = 'paid'")
  assert.equal((await f.approve()).status, 409)
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM payment_refunds').get()?.n, 0)
})

test('customer confirms the fee, admin approves and Stripe refunds the net amount exactly once', async t => {
  const f = await setup(t)
  const { html, quoteToken } = await f.preview()
  assert.match(html, /服务费/); assert.match(html, /退款手续费（订单总额的 5%）/); assert.match(html, /214\.50/)
  assert.equal((await f.submit({ confirmRefund: '0' })).status, 409)
  assert.equal((await f.request('/customer/orders/order/refund-request', 'other', { quoteToken, confirmRefund: '1', reason: 'other' })).status, 409)
  assert.equal((await f.submit()).status, 303)
  assert.equal(f.posts(), 0)
  assert.equal((await f.request('/customer/orders/order/refund-request', 'customer', { quoteToken, confirmRefund: '1', reason: 'duplicate' })).status, 409)
  assert.equal((await f.request(`/admin/refund-requests/${f.application().id}/approve`, 'staff', {})).status, 403)
  const response = await f.approve()
  assert.equal(response.status, 303, await response.text())
  assert.equal(f.posts(), 1)
  assert.equal(f.refunds[0].amount, 21450)
  const refund = f.sqlite.prepare('SELECT * FROM payment_refunds').get()!
  assert.equal(refund.deduction_amount, 11); assert.equal(refund.status, 'succeeded'); assert.equal(refund.refund_method, 'stripe')
  assert.equal(f.sqlite.prepare('SELECT status FROM orders').get()?.status, 'cancelled')
  assert.equal(f.sqlite.prepare('SELECT balance FROM users WHERE id = ?').get('customer')?.balance, 12)
  assert.equal((await f.approve()).status, 409)
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM refund_allocations').get()?.n, 1)
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM financial_ledger_entries WHERE source_type = 'PAYMENT_REFUND'").get()?.n, 1)
})

for (const method of ['bank_transfer', 'alipay']) test(`${method} waits for manual completion after approval`, async t => {
  const f = await setup(t, method)
  assert.equal((await f.submit()).status, 303)
  const pending = await (await f.request('/admin/refunds', 'admin')).text()
  assert.match(pending, /客户退款审核/)
  assert.doesNotMatch(pending, /complete-customer-refund/)
  const response = await f.approve()
  assert.equal(response.status, 303, await response.text())
  const refund = f.sqlite.prepare('SELECT * FROM payment_refunds').get()!
  assert.equal(refund.refund_amount, 209); assert.equal(refund.deduction_amount, 11); assert.equal(refund.status, 'pending'); assert.equal(refund.refund_method, method)
  assert.equal(f.posts(), 0)
  assert.equal(f.sqlite.prepare('SELECT status FROM payments').get()?.status, 'paid')
  assert.match(await (await f.request('/admin/refunds', 'admin')).text(), /complete-customer-refund/)
  assert.equal((await f.request(`/admin/refunds/${refund.id}/complete-customer-refund`, 'admin', {})).status, 303)
  assert.equal((await f.request(`/admin/refunds/${refund.id}/complete-customer-refund`, 'admin', {})).status, 409)
  assert.equal(f.sqlite.prepare('SELECT status FROM payment_refunds').get()?.status, 'succeeded')
  assert.doesNotMatch(await (await f.request('/admin/refunds', 'admin')).text(), /complete-customer-refund/)
})

test('refund request is available until actual pickup, including on and after the start date', async t => {
  const f = await setup(t, 'balance')
  for (const status of ['approved', 'pending_payment', 'paid', 'pending_pickup']) {
    f.sqlite.prepare('UPDATE orders SET status = ?').run(status)
    assert.match(await (await f.request('/customer/orders/order')).text(), /href="\/customer\/orders\/order\/refund-request"/)
  }
  f.sqlite.exec("UPDATE orders SET handover_completed_at = CURRENT_TIMESTAMP")
  assert.doesNotMatch(await (await f.request('/customer/orders/order')).text(), /href="\/customer\/orders\/order\/refund-request"/)
  assert.doesNotMatch(await (await f.request('/customer/orders/order/refund-request')).text(), /name="quoteToken"/)
})

test('rejecting leaves funds intact and allows a fresh application; pending refunds block pickup', async t => {
  const f = await setup(t, 'balance')
  assert.equal((await f.submit()).status, 303)
  assert.throws(() => f.sqlite.exec("UPDATE orders SET handover_completed_at = CURRENT_TIMESTAMP"), /不能交付设备/)
  assert.equal((await f.request('/staff/orders/order/pickup', 'admin', {})).status, 409)
  assert.equal((await f.request(`/admin/refund-requests/${f.application().id}/reject`, 'admin', { note: '请联系客服' })).status, 303)
  assert.equal(f.sqlite.prepare('SELECT status FROM orders').get()?.status, 'paid')
  assert.equal(f.sqlite.prepare('SELECT balance FROM users WHERE id = ?').get('customer')?.balance, 12)
  assert.match(await (await f.request('/customer/orders/order')).text(), /请联系客服/)
  assert.equal((await f.submit()).status, 303)
  assert.equal((await f.approve()).status, 303)
  assert.equal(f.sqlite.prepare('SELECT balance FROM users WHERE id = ?').get('customer')?.balance, 221)
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM balance_transactions').get()?.n, 1)
})

test('stale amounts cannot be submitted or approved', async t => {
  const f = await setup(t)
  const { quoteToken } = await f.preview()
  f.sqlite.exec('UPDATE orders SET totalAmount = 240')
  assert.equal((await f.request('/customer/orders/order/refund-request', 'customer', { quoteToken, confirmRefund: '1', reason: 'test' })).status, 409)
  assert.equal((await f.submit()).status, 303)
  f.sqlite.exec('UPDATE payments SET amount = 230')
  assert.equal((await f.approve()).status, 409)
  assert.equal(f.posts(), 0)
})

test('lost Stripe responses and pending refunds can be retried without creating duplicate refunds', async t => {
  const f = await setup(t)
  assert.equal((await f.submit()).status, 303)
  f.loseResponse()
  assert.equal((await f.approve()).status, 409)
  assert.equal((await f.approve()).status, 303)
  assert.equal(f.posts(), 1)
})

test('Stripe pending refunds remain processing and can later complete', async t => {
  const f = await setup(t)
  assert.equal((await f.submit()).status, 303)
  f.pending()
  assert.equal((await f.approve()).status, 409)
  assert.equal(f.sqlite.prepare('SELECT status FROM payment_refunds').get()?.status, 'pending')
  f.refunds[0].status = 'succeeded'
  assert.equal((await f.approve()).status, 303)
  assert.equal(f.posts(), 1)
})

test('a signed Stripe webhook completes pending refunds automatically and rejects mismatched amounts', async t => {
  const f = await setup(t)
  assert.equal((await f.submit()).status, 303)
  f.pending()
  assert.equal((await f.approve()).status, 409)
  const remote = { ...f.refunds[0], status: 'succeeded' }
  assert.equal((await f.webhook('evt_bad_refund', { ...remote, amount: 1 })).status, 500)
  assert.equal(f.sqlite.prepare('SELECT status FROM payment_refunds').get()?.status, 'pending')
  const response = await f.webhook('evt_good_refund', remote)
  assert.equal(response.status, 200, await response.text())
  assert.equal(f.sqlite.prepare('SELECT status FROM payment_refunds').get()?.status, 'succeeded')
  assert.equal(f.application().status, 'approved')
  assert.equal((await f.webhook('evt_good_refund', remote)).status, 200)
  assert.equal(f.posts(), 1)
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM refund_allocations').get()?.n, 1)
})

test('authorization cancellation captures only the 5% fee and releases the rest', async t => {
  const f = await setup(t, 'card', true)
  assert.match((await f.preview()).html, /预计释放预授权/)
  assert.equal((await f.submit()).status, 303)
  const response = await f.approve()
  assert.equal(response.status, 303, await response.text())
  assert.equal(f.captures(), 1); assert.equal(f.posts(), 0)
  assert.equal(f.sqlite.prepare('SELECT amount FROM payments').get()?.amount, 11)
  assert.equal(f.sqlite.prepare('SELECT refund_amount FROM payment_refunds').get()?.refund_amount, 0)
  assert.equal(f.sqlite.prepare('SELECT deduction_amount FROM payment_refunds').get()?.deduction_amount, 11)
})

test('mixed bank and Stripe payments allocate one order fee and retain the manual payout', async t => {
  const f = await setup(t)
  f.sqlite.exec("UPDATE payments SET amount = 125.5, rental_amount = 20; INSERT INTO payments (id, rental_id, customer_id, payment_method, amount, deposit_amount, rental_amount, status) VALUES ('deposit-payment', 'order', 'customer', 'bank_transfer', 100, 100, 0, 'paid')")
  assert.equal((await f.submit()).status, 303)
  const response = await f.approve()
  assert.equal(response.status, 303, await response.text())
  const amounts = f.sqlite.prepare('SELECT SUM(deduction_amount) AS fee, SUM(refund_amount) AS refund FROM payment_refunds').get()!
  assert.equal(Number(Number(amounts.fee).toFixed(2)), 11)
  assert.equal(amounts.refund, 214.5)
  const manual = f.sqlite.prepare("SELECT * FROM payment_refunds WHERE refund_method = 'bank_transfer'").get()!
  assert.match(await (await f.request('/admin/refunds', 'admin')).text(), /complete-customer-refund/)
  assert.equal((await f.request(`/admin/refunds/${manual.id}/complete-customer-refund`, 'admin', {})).status, 303)
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM refund_allocations').get()?.n, 2)
})


test('website refund links require login and preserve the matching refund page', async t => {
  const f = await setup(t)
  const response = await f.request('/customer/orders/order/refund-request', 'anonymous')
  assert.equal(response.status, 302)
  assert.equal(response.headers.get('Location'), '/login?redirect=%2Fcustomer%2Forders%2Forder%2Frefund-request')
  const login = await f.request(response.headers.get('Location')!, 'anonymous')
  assert.equal(login.status, 200)
  assert.match(await login.text(), /name="redirect" value="\/customer\/orders\/order\/refund-request"/)
  assert.equal(f.posts(), 0)
})

test('temporary customers can open only their own refund operation after login', async t => {
  const f = await setup(t)
  f.sqlite.exec("UPDATE users SET account_type = 'guest', guest_order_id = 'order', guest_expires_at = '2090-01-01' WHERE id = 'customer'")
  const own = await f.request('/customer/orders/order/refund-request')
  assert.equal(own.status, 200)
  assert.match(await own.text(), /确认申请退款/)
  const other = await f.request('/customer/orders/another/refund-request')
  assert.equal(other.status, 403)
  assert.equal(f.posts(), 0)
})
