/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { URL } from 'node:url'
import { notifyAgreementUpdate } from '../src/actions/admin/saveSettings'
import { deliverPendingAgreementNotifications } from '../src/services/notifications'
import { AGREEMENT_UPDATE_SUBJECT, AGREEMENT_UPDATE_EMAIL_BODY } from '../src/services/agreementUpdateTemplate'

function makeDb(options: { queueRows?: any[]; customers?: any[]; template?: any } = {}) {
  const statements: Array<{ sql: string; args: unknown[] }> = []
  const batches: Array<Array<{ sql: string; args: unknown[] }>> = []
  const queueRows = options.queueRows || []
  const customers = options.customers || []
  const db = {
    prepare(sql: string) {
      const state = { args: [] as unknown[] }
      const statement = {
        sql,
        state,
        bind(...args: unknown[]) { state.args = args; return this },
        async run() { statements.push({ sql, args: state.args }); return { meta: { changes: 1 } } },
        async all() {
          if (/FROM agreement_update_queue/i.test(sql)) return { results: queueRows }
          if (/SELECT (?:id, )?name, email FROM users/i.test(sql)) return { results: customers }
          return { results: [] }
        },
        async first() {
          if (/FROM systemSettings/i.test(sql)) return { value: JSON.stringify({ name: '测试租赁', email: 'support@example.com' }) }
          if (/FROM email_templates/i.test(sql)) return options.template === undefined ? { subject: AGREEMENT_UPDATE_SUBJECT, body: AGREEMENT_UPDATE_EMAIL_BODY, enabled: 1 } : options.template
          return null
        },
      }
      return statement
    },
    async batch(batch: any[]) {
      const captured = batch.map((statement: any) => ({ sql: statement.sql, args: statement.state?.args || [] }))
      batches.push(captured)
      return []
    },
  }
  return { db, statements, batches }
}

test('saving an agreement only queues changed agreement keys and deduplicates keys', async () => {
  const { db, statements, batches } = makeDb()
  await notifyAgreementUpdate({ env: { RENT: db } } as any, [['userTerms', '用户协议'], ['userTerms', '用户协议'], ['rentalTerms', '租赁协议']])

  assert.equal(statements.filter(({ sql }) => /notifications/i.test(sql)).length, 0)
  assert.equal(batches.length, 1)
  assert.equal(batches[0].length, 2)
  assert.match(batches[0][0].sql, /ON CONFLICT\(agreement_key\)/i)
})

test('scheduled delivery combines queued agreements into one customer notification', async () => {
  const { db, statements, batches } = makeDb({
    queueRows: [
      { agreement_key: 'userTerms', agreement_label: '用户协议', revision: 'rev-1', queued_at: '2026-09-12 00:01:00' },
      { agreement_key: 'rentalTerms', agreement_label: '租赁协议', revision: 'rev-2', queued_at: '2026-09-12 00:02:00' },
    ],
    customers: [
      { id: 'customer-1', name: '客 户甲', email: 'a@example.com' },
      { id: 'customer-2', name: '客户乙', email: 'b@example.com' },
    ],
  })

  assert.equal(await deliverPendingAgreementNotifications({ env: { RENT: db } } as any), 2)
  const notificationBatches = batches.filter((batch) => batch.some(({ sql }) => /notifications/i.test(sql)))
  const notificationWrites = notificationBatches.flat()
  assert.equal(notificationBatches.length, 1)
  assert.equal(notificationWrites.length, 2)
  assert.ok(notificationWrites.every(({ args }) => String(args[4]).includes('<ul><li>用户协议</li><li>租赁协议</li></ul>')))
  assert.ok(notificationWrites.some(({ args }) => args.some((value) => String(value).includes('尊敬的 客户甲：'))))
  assert.ok(notificationWrites.every(({ args }) => String(args[4]).includes('<strong>2026年09月12日</strong>')))
  assert.ok(notificationWrites.every(({ args }) => String(args[4]).includes('Australian Consumer Law')))
  assert.ok(notificationWrites.every(({ args }) => String(args[4]).includes('<strong>GeekSlope 团队</strong>')))
  assert.ok(notificationWrites.every(({ args }) => args.every((value) => !String(value).includes('请登录后查看'))))
  const emails = batches.filter((batch) => batch.some(({ sql }) => /email_events/i.test(sql)))
  assert.equal(emails.length, 1)
  for (const { args } of emails[0]) {
    assert.equal(args[3], AGREEMENT_UPDATE_SUBJECT)
    assert.match(String(args[5]), /我们已于<strong>2026年09月12日<\/strong>对以下协议或服务条款进行了更新/)
    assert.match(String(args[5]), /<strong>《用户协议、租赁协议》<\/strong>/)
    assert.match(String(args[5]), /background-color:#f5f7fa;border-left:4px solid #64748b/)
    assert.match(String(args[5]), /本次通知本身不代表现有合同条款自动发生变更/)
    assert.match(String(args[5]), /href="mailto:support@example.com"/)
    assert.doesNotMatch(String(args[5]), /\{(?:update_date|customer_name|company_name|changed_agreements)\}/)
  }
  assert.equal(batches.filter((batch) => batch.some(({ sql }) => /DELETE FROM agreement_update_queue/i.test(sql))).length, 1)
})

test('agreement notices use the Melbourne update date and safely fill fallback templates', async () => {
  const { db, batches } = makeDb({
    template: null,
    queueRows: [{ agreement_key: 'rentalTerms', agreement_label: '租赁 <b>协议</b> {customer_name}', revision: 'rev-3', queued_at: '2026-11-04 14:30:00' }],
    customers: [{ id: 'customer-3', name: '<img src=x onerror=alert(1)> $& {company_name}', email: 'c@example.com' }],
  })
  await deliverPendingAgreementNotifications({ env: { RENT: db } } as any)
  const notice = batches.flat().find(({ sql }) => /INSERT OR IGNORE INTO notifications/.test(sql))!
  const email = batches.flat().find(({ sql }) => /INSERT OR IGNORE INTO email_events/.test(sql))!
  for (const html of [notice.args[4], email.args[5]]) {
    assert.match(String(html), /<strong>2026年11月05日<\/strong>/)
    assert.match(String(html), /&lt;img src=x onerror=alert\(1\)&gt; \$&amp; \{company_name\}/)
    assert.match(String(html), /租赁 &lt;b&gt;协议&lt;\/b&gt; \{customer_name\}/)
    assert.doesNotMatch(String(html), /<img src=x|<b>协议<\/b>/)
  }
})

test('agreement template migration updates both saved templates without changing delivery state', t => {
  const db = new DatabaseSync(':memory:')
  t.after(() => db.close())
  db.exec(`CREATE TABLE email_templates (id TEXT PRIMARY KEY, subject TEXT, body TEXT, format TEXT, enabled INTEGER, updated_at TEXT);
    CREATE TABLE in_app_notification_templates (id TEXT PRIMARY KEY, title TEXT, message TEXT, enabled INTEGER, updated_at TEXT);
    INSERT INTO email_templates VALUES ('agreement_update', '旧主题', '旧正文', 'markdown', 0, '2026-01-01'), ('custom_1', '自定义', '保留', 'html', 1, '2026-01-01');
    INSERT INTO in_app_notification_templates VALUES ('agreement_update', '旧主题', '旧正文', 0, '2026-01-01');`)
  const migration = readFileSync(new URL('../migrations/0186_update_agreement_notice_templates.sql', import.meta.url), 'utf8')
  db.exec(migration)
  const email = db.prepare("SELECT * FROM email_templates WHERE id = 'agreement_update'").get()!
  assert.equal(email.subject, AGREEMENT_UPDATE_SUBJECT)
  assert.equal(email.body, AGREEMENT_UPDATE_EMAIL_BODY)
  assert.equal(email.format, 'html')
  assert.equal(email.enabled, 0)
  const site = db.prepare("SELECT * FROM in_app_notification_templates WHERE id = 'agreement_update'").get()!
  assert.equal(site.enabled, 0)
  assert.equal(site.title, AGREEMENT_UPDATE_SUBJECT)
  assert.equal((String(site.message).match(/<li>/g) || []).length, 7)
  assert.match(String(site.message), /<strong>\{update_date\}<\/strong>/)
  assert.equal(db.prepare("SELECT body FROM email_templates WHERE id = 'custom_1'").get()!.body, '保留')
})
