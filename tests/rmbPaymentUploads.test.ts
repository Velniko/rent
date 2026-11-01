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
import { createAuthSession } from '../src/site'
import { extractInlineScripts } from './helpers'

async function setup(t: any) {
  const sqlite = new DatabaseSync(':memory:')
  for (const name of readdirSync(new URL('../migrations/', import.meta.url)).filter(name => name.endsWith('.sql')).sort()) sqlite.exec(readFileSync(new URL(`../migrations/${name}`, import.meta.url), 'utf8'))
  sqlite.exec("INSERT INTO users (id, name, email, role, status, account_status) VALUES ('link-admin', '链接管理员', 'link-admin@example.test', 'ADMIN', 'active', 'active'), ('link-staff', '链接员工', 'link-staff@example.test', 'STAFF', 'active', 'active'); INSERT INTO devices (id, name, model, serialNumber, pricePerDay, depositAmount, weekly_discount_percent, monthly_discount_percent, weekly_discount_override, monthly_discount_override, status, lifecycle_status) VALUES ('link-device', '游戏笔记本', 'RTX 4060', 'LINK-SN', 30, 200, 10, 20, 10, 20, 'available', 'READY'), ('other-device', '其他设备', 'Other', 'OTHER-SN', 60, 500, 0, 0, NULL, NULL, 'available', 'READY');")
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
    async batch(statements: any[]) { const results = []; for (const statement of statements) results.push(await statement.run()); return results },
  }
  const env = { RENT: db }
  const context = { env } as any
  const admin = await createAuthSession(context, 'link-admin'), staff = await createAuthSession(context, 'link-staff')
  const request = (path: string, data?: Record<string, string> | FormData, actor: 'admin' | 'staff' | null = null) => worker.fetch(new Request(new URL(path, 'https://rent.example.test').toString(), {
    ...(data ? { method: 'POST', body: data instanceof FormData ? data : new URLSearchParams(data) } : {}),
    headers: { Origin: 'https://rent.example.test', 'Sec-Fetch-Site': 'same-origin', ...(actor ? { Cookie: `session=${actor === 'admin' ? admin.token : staff.token}` } : {}) },
  }), env as any, { waitUntil() { } } as any)
  const create = async () => {
    const response = await request('/admin/rental-links', { deviceId: 'link-device', title: '笔记本自助租赁', pickupLocation: '墨尔本门店', returnLocation: '墨尔本门店' }, 'admin')
    assert.equal(response.status, 303)
    const link = sqlite.prepare('SELECT * FROM rental_links ORDER BY rowid DESC LIMIT 1').get() as any
    assert.ok(link)
    return { ...link, path: `/rent/${link.token}` }
  }
  t.after(() => sqlite.close())
  return { sqlite, request, create, context }
}


for (const method of ['alipay', 'wechat']) test(`${method} accepts a file upload on the contract payment page`, async t => {
  const { sqlite, request, create, context } = await setup(t)
  Object.assign(context.env, { SETTINGS_ENCRYPTION_KEY: 'upload-smoke', CLOUDINARY_CLOUD_NAME: 'demo', CLOUDINARY_API_KEY: 'key', CLOUDINARY_API_SECRET: 'secret' })
  sqlite.exec(`INSERT OR REPLACE INTO systemSettings (key, value) VALUES ('paymentMethods', '{"stripe":true,"bankTransfer":true,"alipay":true,"wechat":true}'), ('rmbPayment', '{"alipayQrUrl":"https://example.com/alipay.png","wechatQrUrl":"https://example.com/wechat.png"}')`)
  const { invalidateSystemSettingsCache } = await import('../src/site')
  invalidateSystemSettingsCache()
  let uploads = 0
  t.mock.method(globalThis, 'fetch', async (input: any, init: any) => {
    if (String(input).startsWith('https://api.cloudinary.com/')) {
      const data = init.body as FormData
      assert.ok(data.get('file') instanceof File)
      assert.match(String(data.get('transformation')), /UPLOAD_.*_ID_/)
      uploads++
      return Response.json({ secure_url: 'https://res.cloudinary.com/demo/image/upload/proof.png' })
    }
    assert.equal(String(input), 'https://api.frankfurter.app/latest?from=AUD&to=CNY')
    return Response.json({ rates: { CNY: 4.7 } })
  })
  const link = await create()
  await request(link.path, { startDate: '2090-01-02', endDate: '2090-01-09', startPeriod: 'AM', endPeriod: 'AM' })
  const contract = sqlite.prepare('SELECT * FROM contracts LIMIT 1').get() as any
  const path = `/contract/sign?token=${contract.signToken}`
  await request(`${path}&step=1`, { agreeTerms: 'on' })
  await request(`${path}&step=2`, { firstName: 'Alice', lastName: 'Chen', email: 'alice@example.test', phoneCode: '+61', phone: '0412345678' })
  const html = await (await request(`${path}&step=4`)).text()
  assert.doesNotMatch(html, /data-payment-choice|payment-method-choices|金额按两位小数上舍入|自动添加防伪水印|付款凭证图片链接|type="url"/)
  assert.match(html, /id="rmbTransferProofFile" name="transferProofFile" type="file"/)
  assert.match(html, /enctype="multipart\/form-data"/)
  for (const script of extractInlineScripts(html)) assert.doesNotThrow(() => new Function(script))
  sqlite.prepare("UPDATE orders SET deliveryMethod = 'Delivery' WHERE id = ?").run(contract.orderId)
  const data = new FormData()
  for (const [key, value] of Object.entries({ pickupTimeSlot: 'delivery_morning', returnTimeSlot: 'delivery_afternoon', paymentMethod: method, refundMethod: 'original', transferReference: 'UPLOAD-REF' })) data.set(key, value)
  data.set('transferProofFile', new File(['image'], 'proof.png', { type: 'image/png' }))
  const response = await request(`${path}&step=4`, data)
  assert.equal(response.status, 200, response.headers.get('location') || '')
  assert.equal(uploads, 1)
  assert.equal(sqlite.prepare('SELECT status FROM contracts WHERE id = ?').get(contract.id)?.status, 'signed')
  assert.equal(sqlite.prepare('SELECT image_url FROM payment_proofs LIMIT 1').get()?.image_url, 'https://res.cloudinary.com/demo/image/upload/proof.png')
})

test('RMB migration preserves existing records, indexes and payment safeguards', () => {
  const sqlite = new DatabaseSync(':memory:')
  try {
    const files = readdirSync(new URL('../migrations/', import.meta.url)).filter(name => name.endsWith('.sql')).sort()
    // 本测试验证的是「单独重放 0161 不丢数据与既有索引」，因此只回放 0161 之前的迁移。
    // 0162 及之后的迁移晚于 0161，它们新建的索引在「只重放 0161」的模拟里本来就不存在。
    for (const name of files.filter(name => name < '0161_allow_rmb_order_payments.sql')) sqlite.exec(readFileSync(new URL(`../migrations/${name}`, import.meta.url), 'utf8'))
    sqlite.exec(`
      INSERT INTO users (id, name, email, role) VALUES ('customer', '客户', 'migration@example.test', 'CUSTOMER');
      INSERT INTO devices (id, name, model, serialNumber, pricePerDay, depositAmount, status) VALUES ('device', '电脑', 'test', 'RMB-SN', 20, 200, 'available');
      INSERT INTO orders (id, userId, deviceId, startDate, endDate, rentalPeriod, totalAmount, depositAmount, status, paymentMethod) VALUES ('order', 'customer', 'device', '2090-01-02', '2090-01-09', 7, 340, 200, 'paid', 'bank_transfer');
      INSERT INTO payments (id, rental_id, customer_id, payment_method, amount, deposit_amount, rental_amount, status) VALUES ('payment', 'order', 'customer', 'bank_transfer', 340, 200, 140, 'paid');
      INSERT INTO payment_proofs (id, payment_id, reference_number, image_url, status) VALUES ('proof', 'payment', 'EXISTING', 'https://example.test/proof.png', 'submitted');
    `)
    const tables = ['orders', 'payments', 'payment_proofs', 'payment_allocations']
    const rowsBefore = tables.map(table => sqlite.prepare(`SELECT * FROM ${table} ORDER BY id`).all())
    const objectsBefore = sqlite.prepare("SELECT type, name, sql FROM sqlite_master WHERE type IN ('index', 'trigger') ORDER BY name").all()
    sqlite.exec('PRAGMA foreign_keys = ON; BEGIN;')
    sqlite.exec(readFileSync(new URL('../migrations/0161_allow_rmb_order_payments.sql', import.meta.url), 'utf8'))
    sqlite.exec('COMMIT;')
    assert.deepEqual(tables.map(table => sqlite.prepare(`SELECT * FROM ${table} ORDER BY id`).all()), rowsBefore)
    assert.deepEqual(sqlite.prepare("SELECT type, name, sql FROM sqlite_master WHERE type IN ('index', 'trigger') ORDER BY name").all(), objectsBefore)
    for (const method of ['alipay', 'wechat']) {
      sqlite.prepare('UPDATE orders SET paymentMethod = ? WHERE id = ?').run(method, 'order')
      sqlite.prepare('UPDATE payments SET payment_method = ? WHERE id = ?').run(method, 'payment')
    }
    assert.throws(() => sqlite.prepare("UPDATE orders SET paymentMethod = 'invalid'").run(), /CHECK constraint failed/)
    assert.throws(() => sqlite.prepare("UPDATE payments SET payment_method = 'invalid'").run(), /CHECK constraint failed/)
    assert.equal(sqlite.prepare('PRAGMA foreign_key_check').all().length, 0)
  } finally { sqlite.close() }
})
