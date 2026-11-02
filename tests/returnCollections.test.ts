/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync, readdirSync } from 'node:fs'
import { createHmac } from 'node:crypto'
import { URL } from 'node:url'
import { Hono } from 'hono'
import worker from '../src/index'
import { createAuthSession, getOrderById, getUserById, invalidateSystemSettingsCache } from '../src/site'
import { chargeOverdueReturns, handleStripeWebhook } from '../src/actions/stripePayments'
import { saveStripeConfig } from '../src/stripe'
import { returnChargeQuote, returnQuoteToken } from '../src/domain/returnCharges'
import { startReturnCollection, getReturnChargeQuote } from '../src/services/returnCollections'
import { extractInlineScripts } from './helpers'

const migrationNames = readdirSync(new URL('../migrations/', import.meta.url)).filter(n => n.endsWith('.sql')).sort()
const migrate = (db: DatabaseSync, names = migrationNames) => { for (const name of names) db.exec(readFileSync(new URL(`../migrations/${name}`, import.meta.url), 'utf8')) }

async function setup(t: any) {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2030-01-03T01:00:00Z') })
  const sqlite = new DatabaseSync(':memory:')
  t.after(() => sqlite.close())
  migrate(sqlite)
  invalidateSystemSettingsCache()
  sqlite.exec(`INSERT INTO users (id,name,email,role,staff_id,balance,stripe_customer_id) VALUES
    ('staff','员工','staff@example.test','STAFF',NULL,0,NULL),('other','其他员工','other@example.test','STAFF',NULL,0,NULL),
    ('admin','管理员','admin@example.test','ADMIN',NULL,0,NULL),('customer','客户<img src=x>','customer@example.test','CUSTOMER','staff',100,'cus_return');
    INSERT INTO devices (id,name,model,pricePerDay,depositAmount,serialNumber,status,lifecycle_status) VALUES ('device','电脑','Test',20,20,'RETURN-SN','rented','RENTED');
    INSERT INTO orders (id,orderNo,userId,deviceId,startDate,endDate,rentalPeriod,totalAmount,depositAmount,status,paymentMethod,deposit_status,deposit_held_amount,returnTimeSlot)
      VALUES ('order','OD-RETURN','customer','device','2029-12-27','2030-01-01',5,120,20,'active','bank_transfer','HELD',20,'09:00');
    INSERT INTO contracts (id,orderId,contractNumber,content,status) VALUES ('contract','order','CONTRACT-RETURN','合同','signed');
    UPDATE systemSettings SET value='{"stripe":true,"bankTransfer":true,"balancePayment":true,"alipay":true,"wechat":true,"processingFeeRate":0.025}' WHERE key='paymentMethods';`)
  const db = {
    prepare(sql: string) {
      let values: any[] = []
      const query = {
        bind(...input: any[]) { values = input; return query },
        async first() { return sqlite.prepare(sql).get(...values) || null },
        async all() { return { results: sqlite.prepare(sql).all(...values) } },
        async run() { return { success: true, meta: { changes: Number(sqlite.prepare(sql).run(...values).changes) } } },
      }
      return query
    },
    async batch(statements: any[]) {
      sqlite.exec('BEGIN')
      try { const results = []; for (const statement of statements) results.push(await statement.run()); sqlite.exec('COMMIT'); return results }
      catch (error) { sqlite.exec('ROLLBACK'); throw error }
    },
  }
  const env = { RENT: db, SETTINGS_ENCRYPTION_KEY: 'return-test-encryption-key' }
  const c = { env, req: { url: 'https://rent.example.test/', header: () => undefined } } as any
  await saveStripeConfig(c, { publishableKey: 'pk_test_return', secretKey: 'sk_test_return', webhookSecret: 'whsec_return' })
  const sessions = new Map<string, string>()
  for (const actor of ['staff','other','admin','customer']) sessions.set(actor, (await createAuthSession(c, actor)).token)
  const request = (path: string, actor = 'staff', form?: Record<string, string>) => worker.fetch(new Request(`https://rent.example.test${path}`, {
    method: form ? 'POST' : 'GET', body: form ? new URLSearchParams(form) : undefined,
    headers: { Cookie: `session=${sessions.get(actor) || ''}`, Origin: 'https://rent.example.test', 'Sec-Fetch-Site': 'same-origin' },
  }), env, { waitUntil() {} } as any)
  t.mock.method(globalThis, 'fetch', async (url: any) => {
    assert.match(String(url), /^https:\/\/api.stripe.com\/v1\/customers/)
    return Response.json({ id: 'cus_return' })
  })
  const order = () => getOrderById(c, 'order')
  const row = () => sqlite.prepare("SELECT * FROM orders WHERE id='order'").get() as any
  const quoteForm = async (method = 'cash') => { const o = (await order())!; return { quoteToken: returnQuoteToken(o, await getReturnChargeQuote(c, o)), paymentMethod: method, confirmReceived: '1' } }
  const collect = async (method = 'cash') => startReturnCollection(c, (await getUserById(c, 'staff'))!, 'order', await quoteForm(method))
  const collection = (id: string) => sqlite.prepare('SELECT * FROM return_collections WHERE id=?').get(id) as any
  const webhook = async (id: string, overrides = {}, valid = true, eventId = 'evt_return') => {
    const rc = collection(id)
    const intent = { id: 'pi_return', latest_charge: 'ch_return', customer: 'cus_return', status: 'succeeded', currency: 'aud', amount: 4613, amount_received: 4613, description: rc.reference, created: Math.floor(Date.now()/1000), ...overrides }
    const body = JSON.stringify({ id: eventId, type: 'payment_intent.succeeded', data: { object: intent } })
    const timestamp = Math.floor(Date.now()/1000)
    const signature = createHmac('sha256', valid ? 'whsec_return' : 'wrong').update(`${timestamp}.${body}`).digest('hex')
    const app = new Hono(); app.post('/', c => handleStripeWebhook(c))
    return app.request('https://rent.example.test/', { method: 'POST', body, headers: { 'stripe-signature': `t=${timestamp},v1=${signature}` } }, env)
  }
  return { sqlite, c, request, row, order, quoteForm, collect, collection, webhook }
}

test('return quote observes grace period, Melbourne calendar days, deposit deductions and receipt time', () => {
  const order = { endDate: '2030-01-01', returnTimeSlot: '09:00', deposit_held_amount: 20 }
  assert.equal(returnChargeQuote(order, 20, new Date('2029-12-31T23:59:00Z')).total, 0)
  assert.deepEqual(returnChargeQuote(order, 20, new Date('2030-01-01T00:00:00Z')), { overdueDays: 0, total: 25, depositApplied: 20, collected: 0, amountDue: 5 })
  assert.equal(returnChargeQuote({ ...order, return_received_at: '2030-01-03 01:00:00', overdue_charge_total: 65, overdue_deposit_applied: 20, overdue_collected_amount: 10 }, 20, new Date('2030-02-01')).amountDue, 35)
  assert.equal(returnChargeQuote({ ...order, is_manual: 1 }, 20, new Date('2030-02-01')).total, 0)
})

test('cash collection uses server quote, records the channel once, and cron does not reopen paid fees', async t => {
  const f = await setup(t)
  const form = await f.quoteForm()
  const result = await f.request('/staff/orders/order/return-collection','staff', { ...form, amount: '0.01' })
  assert.equal(result.status,303,await result.text())
  const id = result.headers.get('location')!.split('/').at(-1)!
  assert.equal(f.collection(id).amount,45)
  assert.equal(f.collection(id).status,'paid')
  assert.equal(f.row().overdue_collected_amount,45)
  assert.equal(f.row().overdue_outstanding_amount,0)
  assert.equal(f.row().totalAmount,165)
  assert.equal(f.sqlite.prepare('SELECT payment_method,status,amount FROM payments').get()!.payment_method,'cash')
  assert.equal((await f.request('/staff/orders/order/return-collection','staff',form)).status,409)
  await chargeOverdueReturns(f.c)
  assert.equal(f.row().overdue_outstanding_amount,0)
  assert.equal(f.row().totalAmount,165)
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM financial_ledger_entries WHERE source_type='RETURN_COLLECTION'").get()!.n,1)
  await chargeOverdueReturns(f.c,new Date('2030-01-04T01:00:00Z'))
  assert.equal(f.row().overdue_outstanding_amount,20)
  assert.equal(f.row().totalAmount,185)
})

for (const method of ['bank_transfer','balance','alipay','wechat']) test(`return supports ${method} and only balance deducts account funds`,async t => {
  const f = await setup(t)
  const id = await f.collect(method)
  assert.equal(f.collection(id).status,'paid')
  assert.equal(f.sqlite.prepare("SELECT balance FROM users WHERE id='customer'").get()!.balance, method === 'balance' ? 55 : 100)
  assert.equal(f.sqlite.prepare('SELECT payment_method FROM payments').get()!.payment_method,method)
})

test('insufficient balance is atomic and an unpaid collection can be cancelled before switching to cash',async t=>{
  const f=await setup(t)
  f.sqlite.exec("UPDATE users SET balance=1 WHERE id='customer'")
  await assert.rejects(f.collect('balance'),/余额不足/)
  const rc=f.sqlite.prepare('SELECT * FROM return_collections').get() as any
  assert.equal(rc.status,'pending')
  assert.equal(f.row().overdue_collected_amount,0)
  assert.equal(f.sqlite.prepare('SELECT status FROM payments').get()!.status,'pending')
  assert.equal((await f.request(`/staff/return-collections/${rc.id}/cancel`,'staff',{confirmUnpaid:'1'})).status,303)
  assert.equal(f.collection(await f.collect()).status,'paid')
})

test('return collection rejects stale quotes, unconfirmed cash, disabled methods and unrelated actors',async t=>{
  const f=await setup(t)
  const form=await f.quoteForm()
  for(const actor of ['other','customer','anonymous']) assert.equal((await f.request('/staff/orders/order/return-collection',actor,form)).status,403)
  assert.equal((await f.request('/staff/orders/order/return-collection','staff',{...form,confirmReceived:''})).status,409)
  assert.equal((await f.request('/staff/orders/order/return-collection','staff',{...form,quoteToken:'tampered'})).status,409)
  f.sqlite.exec("UPDATE systemSettings SET value='{\"stripe\":false,\"bankTransfer\":false,\"balancePayment\":false,\"alipay\":false,\"wechat\":false}' WHERE key='paymentMethods'")
  invalidateSystemSettingsCache()
  await assert.rejects(f.collect('card'),/可用的收款方式/)
  f.sqlite.exec("UPDATE orders SET deposit_held_amount=10 WHERE id='order'")
  assert.equal((await f.request('/staff/orders/order/return-collection','staff',form)).status,409)
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM payments').get()!.n,0)
})

test('Stripe App remains pending until a signed matching receipt, and webhook retries do not charge twice',async t=>{
  const f=await setup(t)
  const id=await f.collect('card')
  assert.equal(f.collection(id).status,'pending')
  assert.equal(f.collection(id).processing_fee,1.13)
  const page=await (await f.request(`/staff/return-collections/${id}`)).text()
  for(const script of extractInlineScripts(page)) new Function(script)
  assert.match(page,/https:\/\/dashboard.stripe.com\/test\/customers\/cus_return/)
  assert.match(page,/value="46.13"/)
  assert.match(page,/客户&lt;img src=x&gt;/)
  assert.equal((await f.request(`/staff/return-collections/${id}/verify-stripe`,'staff',{receiptId:'pi_return'})).status,409)
  assert.equal((await f.webhook(id,{},false)).status,400)
  assert.equal(f.collection(id).status,'pending')
  assert.equal((await f.webhook(id)).status,200)
  assert.equal((await f.webhook(id,{},true,'evt_return_retry')).status,200)
  assert.equal(f.collection(id).status,'paid')
  assert.equal(f.row().overdue_collected_amount,45)
  assert.equal(f.sqlite.prepare('SELECT stripe_payment_intent_id FROM payments').get()!.stripe_payment_intent_id,'pi_return')
  assert.equal((await f.request(`/staff/return-collections/${id}/cancel`,'staff',{confirmUnpaid:'1'})).status,409)
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM financial_ledger_entries WHERE source_type='RETURN_COLLECTION'").get()!.n,1)
})

for(const invalid of [{customer:'cus_other'},{amount:4600,amount_received:4600},{currency:'usd'},{status:'processing'}]) test(`Stripe return receipt rejects mismatch ${JSON.stringify(invalid)}`,async t=>{
  const f=await setup(t),id=await f.collect('card')
  assert.equal((await f.webhook(id,invalid)).status,400)
  assert.equal(f.collection(id).status,'pending')
  assert.equal(f.row().overdue_collected_amount,0)
})

test('a different Stripe reference cannot be attached by entering its transaction ID',async t=>{
  const f=await setup(t),id=await f.collect('card')
  assert.equal((await f.webhook(id,{description:'RETURN-other'})).status,200)
  assert.equal((await f.request(`/staff/return-collections/${id}/verify-stripe`,'staff',{receiptId:'pi_return'})).status,409)
  assert.equal(f.collection(id).status,'pending')
})

test('a completed return freezes fees and allows outstanding cash collection to settle the order',async t=>{
  const f=await setup(t)
  await chargeOverdueReturns(f.c)
  f.sqlite.exec("UPDATE orders SET status='completed',return_received_at='2030-01-03 01:00:00',deposit_status='FORFEITED',settlement_status='PENDING' WHERE id='order'")
  t.mock.timers.setTime(new Date('2030-02-01T01:00:00Z').getTime())
  assert.equal(f.collection(await f.collect()).amount,45)
  assert.equal(f.row().settlement_status,'SETTLED')
  await chargeOverdueReturns(f.c)
  assert.equal(f.row().overdue_charge_total,65)
  f.sqlite.exec("UPDATE orders SET deposit_held_amount=0 WHERE id='order'")
  assert.equal((await getReturnChargeQuote(f.c,(await f.order())!)).amountDue,0)
})

test('return inspection persists the current fee and keeps an unpaid completed return visible',async t=>{
  const f=await setup(t)
  const response=await f.request('/staff/orders/order/inspection','staff',{
    screenCondition:'正常',keyboardCondition:'正常',trackpadCondition:'正常',bodyCondition:'正常',cameraCondition:'正常',wifiCondition:'正常',powerTest:'正常',replacementCost:'0',
  })
  assert.equal(response.status,302,await response.text())
  assert.equal(f.row().status,'completed')
  assert.equal(f.row().overdue_outstanding_amount,45)
  assert.equal(f.row().settlement_status,'PENDING')
  assert.match(await (await f.request('/staff/mobile/return')).text(),/OD-RETURN/)
  const rc=await f.collect()
  assert.equal(f.collection(rc).status,'paid')
  assert.equal(f.row().settlement_status,'SETTLED')
  assert.doesNotMatch(await (await f.request('/staff/mobile/return')).text(),/OD-RETURN/)
})

test('a price change preserves accrued late charges when quoting and collecting the next day',async t=>{
  const f=await setup(t)
  await chargeOverdueReturns(f.c)
  f.sqlite.exec("UPDATE devices SET pricePerDay=30 WHERE id='device'")
  t.mock.timers.setTime(new Date('2030-01-04T01:00:00Z').getTime())
  assert.equal((await getReturnChargeQuote(f.c,(await f.order())!)).amountDue,75)
  const id=await f.collect()
  assert.equal(f.collection(id).amount,75)
  assert.equal(f.row().overdue_charge_total,95)
})

test('staff and admin have separate pickup and return lists, overdue returns, and stage-specific scanning',async t=>{
  const f=await setup(t)
  f.sqlite.exec("INSERT INTO orders (id,orderNo,userId,deviceId,startDate,endDate,rentalPeriod,totalAmount,depositAmount,status,paymentMethod) VALUES ('pickup','OD-PICKUP','customer','device','2030-01-03','2030-01-05',2,60,20,'paid','bank_transfer')")
  for(const actor of ['staff','admin']) {
    const pickup=await (await f.request('/staff/mobile/pickup',actor)).text()
    const returns=await (await f.request('/staff/mobile/return',actor)).text()
    assert.match(pickup,/OD-PICKUP/);assert.doesNotMatch(pickup,/OD-RETURN/)
    assert.match(returns,/OD-RETURN/);assert.doesNotMatch(returns,/OD-PICKUP/)
    const nav=returns.slice(returns.indexOf('<nav class="mobile-bottom-nav"'),returns.indexOf('</nav>',returns.indexOf('<nav class="mobile-bottom-nav"')))
    assert.equal((nav.match(/aria-current="page"/g)||[]).length,1)
    assert.match(nav,/href="\/staff\/mobile\/return" class="active"/)
    assert.equal((await f.request('/staff/mobile/scan?stage=return&code=OD-PICKUP',actor)).status,409)
    assert.match((await f.request('/staff/mobile/scan?stage=return&code=OD-RETURN',actor)).headers.get('location')!,/\/inspection$/)
    const scanner=await (await f.request('/staff/mobile/scan?stage=return',actor)).text()
    assert.match(scanner,/name="stage" value="return"/)
    for(const script of extractInlineScripts(scanner)) new Function(script)
  }
  const other=await (await f.request('/staff/mobile/return','other')).text()
  assert.doesNotMatch(other,/OD-RETURN/)
  const html=await (await f.request('/staff/orders/order/inspection')).text()
  assert.match(html,/归还费用/);assert.match(html,/45\.00/)
  for(const script of extractInlineScripts(html)) new Function(script)
  assert.equal((await f.request('/staff/orders/order/inspection','other')).status,403)
})

test('cash migration preserves referenced payments, allocations, refund guards and indexes with foreign keys enabled',t=>{
  const db=new DatabaseSync(':memory:');t.after(()=>db.close())
  migrate(db,migrationNames.filter(n=>n<'0177'))
  db.exec(`PRAGMA foreign_keys=ON;
    INSERT INTO users (id,name,email,role) VALUES ('customer','客户','customer@example.test','CUSTOMER'),('admin','管理员','admin@example.test','ADMIN');
    INSERT INTO devices (id,name,model,pricePerDay,depositAmount,serialNumber,status) VALUES ('device','电脑','Test',20,20,'MIGRATE-SN','rented');
    INSERT INTO orders (id,userId,deviceId,startDate,endDate,rentalPeriod,totalAmount,depositAmount,status,paymentMethod) VALUES ('order','customer','device','2030-01-01','2030-01-03',2,60,20,'active','card');
    INSERT INTO payments (id,rental_id,customer_id,payment_method,amount,rental_amount,deposit_amount,status,stripe_payment_intent_id) VALUES ('payment','order','customer','card',60,40,20,'paid','pi_existing');
    INSERT INTO payment_refunds (id,order_id,payment_id,type,refundable_amount,refund_amount,status,processed_by) VALUES ('refund','order','payment','deposit',20,5,'succeeded','admin');
    INSERT INTO rental_installments (id,order_id,installment_number,due_date,period_end,rental_amount,processing_fee,amount,payment_id) VALUES ('installment','order',1,'2030-01-01','2030-01-03',40,0,40,'payment');
    BEGIN;`)
  migrate(db,migrationNames.filter(n=>n.startsWith('0177')))
  db.exec('COMMIT')
  assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM payment_allocations').get()!.n,2)
  assert.equal(db.prepare('SELECT refund_amount FROM payment_refunds').get()!.refund_amount,5)
  assert.equal(db.prepare('SELECT payment_id FROM rental_installments').get()!.payment_id,'payment')
  assert.throws(()=>db.exec("INSERT INTO payments (id,rental_id,customer_id,payment_method,amount,rental_amount,deposit_amount,stripe_payment_intent_id) VALUES ('duplicate','order','customer','card',60,40,20,'pi_existing')"),/UNIQUE/)
  assert.throws(()=>db.exec("INSERT INTO payment_refunds (id,order_id,payment_id,type,refundable_amount,refund_amount,status,processed_by) VALUES ('excess','order','payment','deposit',20,16,'succeeded','admin')"),/exceeds/)
  db.exec("INSERT INTO payments (id,rental_id,customer_id,payment_method,amount,rental_amount,deposit_amount) VALUES ('cash','order','customer','cash',10,10,0)")
  assert.equal(db.prepare("SELECT amount FROM payment_allocations WHERE payment_id='cash'").get()!.amount,10)
})
