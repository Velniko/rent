/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync, readdirSync } from 'node:fs'
import { URL } from 'node:url'
import { handleSaveAdminSettings } from '../src/actions/admin/saveSettings'
import { invalidateSystemSettingsCache } from '../src/site'

test('保存 Stripe 和 Square API 配置不会关闭已有支付方式', async () => {
  const sqlite = new DatabaseSync(':memory:')
  try {
    for (const name of readdirSync(new URL('../migrations/', import.meta.url)).filter(name => name.endsWith('.sql')).sort()) {
      sqlite.exec(readFileSync(new URL(`../migrations/${name}`, import.meta.url), 'utf8'))
    }
    const paymentMethods = { stripe: true, square: true, bankTransfer: true, balancePayment: true, alipay: false, wechat: false }
    sqlite.prepare('INSERT OR REPLACE INTO systemSettings (key, value) VALUES (?, ?)').run('paymentMethods', JSON.stringify(paymentMethods))
    const db = {
      prepare(sql: string) {
        let values: any[] = []
        const statement = {
          bind(...input: any[]) { values = input; return statement },
          async first() { return sqlite.prepare(sql).get(...values) || null },
          async all() { return { results: sqlite.prepare(sql).all(...values) } },
          async run() { return { success: true, meta: { changes: Number(sqlite.prepare(sql).run(...values).changes) } } },
        }
        return statement
      },
      async batch(statements: any[]) { return Promise.all(statements.map(statement => statement.run())) },
    }
    const payload = {
      translationConfig: { enabled: true, provider: 'deepl', deeplApiKey: 'test-translation-secret', googleApiKey: 'test-google-secret' },
      stripeConfig: { publishableKey: 'pk_test_example', secretKey: 'sk_test_example', webhookSecret: 'whsec_example' },
      squareConfig: { applicationId: 'sq0idp-example', locationId: 'location-example', accessToken: 'square-token-example', environment: 'sandbox' },
    }
    invalidateSystemSettingsCache()
    const context = {
      env: { RENT: db, SETTINGS_ENCRYPTION_KEY: 'api-settings-test-key' },
      req: { url: 'https://rent.example.test/admin/api-settings/save', text: async () => JSON.stringify(payload) },
      json: (data: unknown) => Response.json(data),
    } as any
    const response = await handleSaveAdminSettings(context)
    assert.equal(response.status, 200)
    assert.deepEqual(JSON.parse(String((sqlite.prepare("SELECT value FROM systemSettings WHERE key = 'paymentMethods'").get() as any).value)), paymentMethods)
    for (const key of ['stripeConfig', 'squareConfig', 'translationConfig']) {
      const row = sqlite.prepare('SELECT value, deleted_at FROM systemSettings WHERE key = ?').get(key) as any
      assert.ok(row?.value, `${key} 应保存成功`)
      assert.equal(row.deleted_at, null)
    }
  } finally {
    invalidateSystemSettingsCache()
    sqlite.close()
  }
})
