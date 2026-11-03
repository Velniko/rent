/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync, readdirSync } from 'node:fs'
import { URL } from 'node:url'
import { DEFAULT_CONTRACT_TEMPLATE_HTML, renderContractVariables, sanitizeRichHtml } from '../src/site'

const migrationName = '0179_update_legal_documents_rental_features.sql'
const migrations = new URL('../migrations/', import.meta.url)
const migration = readFileSync(new URL(migrationName, migrations), 'utf8')
const agreements = [
  ['userTerms', 'user'], ['rentalTerms', 'rental'], ['serviceTerms', 'service'],
  ['privacyPolicy', 'privacy'], ['softwareTerms', 'software'], ['copyrightNotice', 'copyright'],
  ['cookiePolicy', 'cookie'], ['complaintsPolicy', 'complaints'], ['acceptableUsePolicy', 'aup'], ['consumerRights', 'consumer'],
] as const

function setup(t: any) {
  const db = new DatabaseSync(':memory:')
  t.after(() => db.close())
  for (const name of readdirSync(migrations).filter(name => name.endsWith('.sql') && name < migrationName).sort()) {
    db.exec(readFileSync(new URL(name, migrations), 'utf8'))
  }
  const content = (key: string) => String(db.prepare('SELECT value FROM systemSettings WHERE key = ?').get(key)?.value || '')
  return { db, content }
}

test('legal migration publishes both languages, preserves unrelated settings and signed evidence', t => {
  const { db, content } = setup(t)
  db.prepare("UPDATE systemSettings SET value = ?, deleted_at = '2026-01-01' WHERE key = 'legalMetadata'").run(JSON.stringify({ user: { version: '1.9', customField: 'keep' }, unrelated: { version: 'keep' } }))
  db.exec("UPDATE systemSettings SET value = '旧版本', deleted_at = '2026-01-01' WHERE key = 'privacyPolicyEn'")
  db.exec("INSERT INTO users (id, name, email, role) VALUES ('legal-user', '客户', 'legal@example.test', 'CUSTOMER')")
  db.exec("INSERT INTO devices (id, name, model, pricePerDay, depositAmount, serialNumber, status) VALUES ('legal-device', '电脑', 'Test', 20, 100, 'LEGAL-SN', 'available')")
  db.exec("INSERT INTO orders (id, userId, deviceId, startDate, endDate, rentalPeriod, totalAmount, depositAmount, status) VALUES ('legal-order', 'legal-user', 'legal-device', '2026-01-01', '2026-01-07', 6, 220, 100, 'paid')")
  db.exec("INSERT INTO contracts (id, orderId, contractNumber, content, status, signedAt, signed_content, content_hash, contract_data) VALUES ('signed-legal', 'legal-order', 'CT-LEGAL', '<p>原合同</p>', 'signed', '2026-01-01', '<p>原签署快照</p>', 'original-hash', '{\"agreement_version\":\"1.0\"}')")
  const before = db.prepare("SELECT * FROM contracts WHERE id = 'signed-legal'").get()
  const paymentMethods = content('paymentMethods')
  const queue = db.prepare('SELECT * FROM agreement_update_queue').all()
  db.exec(migration)

  for (const [key, metaKey] of agreements) {
    for (const language of ['', 'En']) {
      const html = content(key + language)
      assert.match(html, /<h1>/, key + language)
      assert.match(html, /\{company_email\}/, key + language)
      assert.match(html, /_version\}/, key + language)
      assert.match(html, /_last_updated_date\}/, key + language)
      assert.doesNotMatch(html, /<script|javascript:|\bon\w+=/i)
      assert.match(sanitizeRichHtml(html), /<h1>/)
    }
    const meta = JSON.parse(content('legalMetadata'))[metaKey]
    assert.equal(meta.version, '2.0')
    assert.equal(meta.lastUpdatedDate, '2026-11-04')
  }
  const meta = JSON.parse(content('legalMetadata'))
  assert.equal(meta.user.customField, 'keep')
  assert.equal(meta.unrelated.version, 'keep')
  assert.equal(meta.contract.version, '2.0')
  assert.equal(content('paymentMethods'), paymentMethods)
  assert.equal(db.prepare("SELECT deleted_at FROM systemSettings WHERE key = 'privacyPolicyEn'").get()?.deleted_at, null)
  assert.equal(db.prepare("SELECT deleted_at FROM systemSettings WHERE key = 'legalMetadata'").get()?.deleted_at, null)
  assert.deepEqual(db.prepare('SELECT * FROM agreement_update_queue').all(), queue)
  assert.deepEqual(db.prepare("SELECT * FROM contracts WHERE id = 'signed-legal'").get(), before)
  assert.equal(db.prepare("SELECT content FROM contract_templates WHERE id = 'default'").get()?.content, DEFAULT_CONTRACT_TEMPLATE_HTML)

  const published = content('rentalTerms')
  db.exec(migration)
  assert.equal(content('rentalTerms'), published)
  assert.deepEqual(db.prepare("SELECT * FROM contracts WHERE id = 'signed-legal'").get(), before)
})

test('published agreements cover current payment rules without the superseded cancellation or duration rules', t => {
  const { db, content } = setup(t)
  db.exec(migration)
  assert.match(content('copyrightNotice'), /确认前取消不收取消手续费/)
  assert.match(content('copyrightNoticeEn'), /No cancellation fee applies before order confirmation/)
  assert.doesNotMatch(content('copyrightNotice'), /下单后 24 小时内/)
  for (const text of [content('rentalTerms'), DEFAULT_CONTRACT_TEMPLATE_HTML]) {
    assert.match(text, /满 60 天/)
    assert.match(text, /每 30 天一期/)
    assert.match(text, /0、0\.5、1、1\.25、1\.5 或 2 倍/)
    assert.match(text, /订单确认前取消不收取消手续费/)
    assert.match(text, /确认后、实际取货或交付前/)
    assert.doesNotMatch(text, /租期不超过 4 个月|不构成.*消费者租赁/)
  }
  for (const key of ['privacyPolicy', 'privacyPolicyEn']) {
    assert.match(content(key), /DeepL/)
    assert.match(content(key), /Google/)
    assert.match(content(key), /Cloudinary/)
    assert.match(content(key), /SMTP/)
    assert.match(content(key), /tawk\.to/)
  }
  const rendered = renderContractVariables(DEFAULT_CONTRACT_TEMPLATE_HTML, { id: 'test', contractNumber: 'CT-TEST' } as any, { totalAmount: 220, depositAmount: 100 })
  assert.doesNotMatch(rendered, /\{[a-z_]+\}/)
})
