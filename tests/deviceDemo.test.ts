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
import { createDemoAvailableFrom } from '../src/domain/deviceDemo'
import { extractInlineScripts } from './helpers'

test('demo dates fall between one and six calendar months after Melbourne today', () => {
  for (const [now, first, last] of [
    ['2026-10-31T00:00:00Z', '2026-11-30', '2027-04-30'],
    ['2027-08-31T00:00:00Z', '2027-09-30', '2028-02-29'],
    ['2026-10-30T14:00:00Z', '2026-11-30', '2027-04-30'],
    ['2027-01-31T00:00:00Z', '2027-02-28', '2027-07-31'],
    ['2028-01-31T00:00:00Z', '2028-02-29', '2028-07-31'],
  ]) {
    assert.equal(createDemoAvailableFrom(new Date(now), 0), first)
    assert.equal(createDemoAvailableFrom(new Date(now), 0.999999), last)
    for (const random of [0.1, 0.3, 0.5, 0.7, 0.9]) {
      const value = createDemoAvailableFrom(new Date(now), random)
      assert.ok(value >= first && value <= last)
    }
  }
})

async function setup(t: any) {
  const sqlite = new DatabaseSync(':memory:')
  t.after(() => sqlite.close())
  for (const name of readdirSync(new URL('../migrations/', import.meta.url)).filter(name => name.endsWith('.sql')).sort()) {
    sqlite.exec(readFileSync(new URL(`../migrations/${name}`, import.meta.url), 'utf8'))
  }
  sqlite.exec("INSERT INTO users (id, name, email, role, status, account_status) VALUES ('demo-admin', '管理员', 'demo-admin@example.test', 'ADMIN', 'active', 'active'), ('demo-staff', '员工', 'demo-staff@example.test', 'STAFF', 'active', 'active');")
  const db = {
    prepare(sql: string) {
      let values: any[] = []
      const query = {
        bind(...args: any[]) { values = args; return query },
        async first() { return sqlite.prepare(sql).get(...values) || null },
        async all() { return { results: sqlite.prepare(sql).all(...values) } },
        async run() { return { success: true, meta: { changes: Number(sqlite.prepare(sql).run(...values).changes) } } },
      }
      return query
    },
    async batch(statements: any[]) { const results = []; for (const statement of statements) results.push(await statement.run()); return results },
  }
  const env = { RENT: db }
  const admin = await createAuthSession({ env } as any, 'demo-admin')
  const staff = await createAuthSession({ env } as any, 'demo-staff')
  const request = (path: string, data?: Record<string, string>, actor: 'admin' | 'staff' = 'admin') => worker.fetch(new Request(`https://rent.example.test${path}`, {
    ...(data ? { method: 'POST', body: new URLSearchParams(data) } : {}),
    headers: { Origin: 'https://rent.example.test', 'Sec-Fetch-Site': 'same-origin', Cookie: `session=${actor === 'admin' ? admin.token : staff.token}` },
  }), env as any, { waitUntil() {} } as any)
  return { sqlite, request }
}

for (const area of ['admin', 'staff']) {
  test(`${area} device forms persist demo mode, preserve the date on edits and clear it when disabled`, async t => {
    const { sqlite, request } = await setup(t)
    const form = { name: '演示电脑', brand: 'Test', model: 'Model', serialNumber: `DEMO-${area}`, pricePerDay: '30', dailyRate: '30', depositAmount: '200', status: 'available', demoMode: '1' }
    const newHtml = await (await request(`/${area}/devices/new`)).text()
    assert.match(newHtml, /name="demoMode" value="1"/)
    const create = await request(`/${area}/devices/new`, form)
    assert.equal(create.status, area === 'admin' ? 200 : 302)
    const row = sqlite.prepare('SELECT * FROM devices WHERE serialNumber = ?').get(form.serialNumber) as any
    assert.match(row.demo_available_from, /^\d{4}-\d{2}-\d{2}$/)
    assert.equal(row.status, 'available')
    const editPath = `/${area}/devices/${row.id}/edit`
    const editHtml = await (await request(editPath)).text()
    assert.match(editHtml, /name="demoMode" value="1" checked/)
    for (const script of extractInlineScripts(editHtml)) assert.doesNotThrow(() => new Function(script))
    assert.equal((await request(editPath, { ...form, name: '更新名称' })).status, 302)
    assert.equal(sqlite.prepare('SELECT demo_available_from FROM devices WHERE id = ?').get(row.id)?.demo_available_from, row.demo_available_from)
    const { demoMode, ...normalForm } = form
    assert.equal((await request(editPath, normalForm)).status, 302)
    assert.equal(sqlite.prepare('SELECT demo_available_from FROM devices WHERE id = ?').get(row.id)?.demo_available_from, null)
    assert.doesNotMatch(await (await request(editPath)).text(), /name="demoMode" value="1" checked/)
    assert.equal((await request(editPath, form, 'staff')).status, 403)
    assert.equal(sqlite.prepare('SELECT demo_available_from FROM devices WHERE id = ?').get(row.id)?.demo_available_from, null)
    assert.equal((await request(editPath, form)).status, 302)
    assert.ok(sqlite.prepare('SELECT demo_available_from FROM devices WHERE id = ?').get(row.id)?.demo_available_from)
    const normalSerial = `NORMAL-${area}`
    assert.equal((await request(`/${area}/devices/new`, { ...normalForm, serialNumber: normalSerial })).status, area === 'admin' ? 200 : 302)
    assert.equal(sqlite.prepare('SELECT demo_available_from FROM devices WHERE serialNumber = ?').get(normalSerial)?.demo_available_from, null)
  })
}
