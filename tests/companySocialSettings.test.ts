/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

import test from 'node:test'
import assert from 'node:assert/strict'
import { extractInlineScripts } from './helpers'
import { DatabaseSync } from 'node:sqlite'
import { handleSaveAdminSettings } from '../src/actions/admin/saveSettings'
import { getSystemSettings, invalidateSystemSettingsCache } from '../src/site'
import { renderAdminSettings } from '../src/pages/admin/settings'

test('company social profiles save, survive partial updates, clear and reject unsafe URLs', async () => {
  const sqlite = new DatabaseSync(':memory:')
  sqlite.exec('CREATE TABLE systemSettings (key TEXT PRIMARY KEY, value TEXT, updatedAt TEXT, deleted_at TEXT)')
  const previous = { ...getSystemSettings().companyDetails }
  const db = { prepare(sql: string) {
    let values: any[] = []
    const query = {
      bind(...args: any[]) { values = args; return query },
      async first() { return sqlite.prepare(sql).get(...values) || null },
      async all() { return { results: sqlite.prepare(sql).all(...values) } },
      async run() { return { success: true, meta: { changes: Number(sqlite.prepare(sql).run(...values).changes) } } },
    }
    return query
  } }
  let companyDetails: Record<string, string> = {
    wechatUrl: 'https://weixin.qq.com/example', wechatQrUrl: 'https://images.example.test/wechat.png',
    xiaohongshuUrl: 'https://www.xiaohongshu.com/user/profile/example', xiaohongshuQrUrl: '',
    douyinUrl: 'https://www.douyin.com/user/example', douyinQrUrl: 'https://images.example.test/douyin.png',
  }
  const context = { env: { RENT: db }, req: { url: 'https://rent.example.test/admin/settings/save', text: async () => JSON.stringify({ companyDetails }) }, json: (body: unknown) => Response.json(body) } as any
  const saved = () => JSON.parse(String((sqlite.prepare("SELECT value FROM systemSettings WHERE key = 'companyDetails'").get() as any).value))
  try {
    invalidateSystemSettingsCache()
    assert.equal((await handleSaveAdminSettings(context)).status, 200)
    for (const [key,value] of Object.entries(companyDetails)) assert.equal(saved()[key], value)
    const html = renderAdminSettings({ id: 'admin', role: 'ADMIN' })
    for (const key of Object.keys(companyDetails)) assert.ok(html.includes(`name="company${key[0].toUpperCase()}${key.slice(1)}"`))
    const scripts = extractInlineScripts(html)
    assert.ok(scripts.length > 0)
    for (const script of scripts) assert.doesNotThrow(() => new Function(script))
    companyDetails = { name: 'Updated company' }
    assert.equal((await handleSaveAdminSettings(context)).status, 200)
    assert.equal(saved().wechatUrl, 'https://weixin.qq.com/example')
    companyDetails = { wechatUrl: '' }
    assert.equal((await handleSaveAdminSettings(context)).status, 200)
    assert.equal(saved().wechatUrl, '')
    for (const value of ['javascript:alert(1)', 'http://example.test/qr.png', 'https://localhost/qr.png', 'https://user:pass@example.test/qr.png']) {
      companyDetails = { douyinQrUrl: value }
      await assert.rejects(handleSaveAdminSettings(context), /HTTPS/)
      assert.equal(saved().douyinQrUrl, 'https://images.example.test/douyin.png')
    }
  } finally {
    getSystemSettings().companyDetails = previous
    invalidateSystemSettingsCache()
    sqlite.close()
  }
})
