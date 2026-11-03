/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

import test from 'node:test'
import assert from 'node:assert/strict'
import worker from '../src/index'

const WEBSITE = 'https://www.geekslope.de5.net'
const DASHBOARD = 'https://dashboard.geekslope.de5.net'
const token = 'a'.repeat(43)
function environment({ active = false, expired = false, accountType = 'formal' } = {}) {
  return {
    PUBLIC_WEB_ORIGIN: WEBSITE,
    RENT: {
      prepare(sql: string) {
        const query = {
          bind(..._values: unknown[]) { return query },
          async first() {
            if (sql.includes('security_rate_limits')) return { request_count: 1 }
            if (sql.includes('JOIN users')) return active && !expired ? { id: 'test-customer', name: 'Private Name', email: 'private@example.test', role: 'CUSTOMER', status: 'active', account_type: accountType } : null
            throw new Error('Unexpected query: ' + sql)
          },
          async run() { return { success: true } },
        }
        return query
      },
    },
  } as any
}
const ctx = { waitUntil() {} } as any

test('marketing origin reads only an uncached login boolean from the real middleware chain', async () => {
  const response = await worker.fetch(new Request(`${DASHBOARD}/public/session`, { headers: { Origin: WEBSITE, Cookie: `session=${token}` } }), environment({ active: true }), ctx)
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { authenticated: true })
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), WEBSITE)
  assert.equal(response.headers.get('Access-Control-Allow-Credentials'), 'true')
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store')
  assert.match(response.headers.get('Vary') || '', /Origin/)
  assert.match(response.headers.get('Vary') || '', /Cookie/)
  assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff')
})

test('missing, invalid, expired, disabled and guest sessions remain logged out', async () => {
  const cases = [
    { cookie: '', options: { active: true } },
    { cookie: 'session=bad', options: { active: true } },
    { cookie: `session=${token}`, options: { active: true, expired: true } },
    { cookie: `session=${token}`, options: { active: false } },
    { cookie: `session=${token}`, options: { active: true, accountType: 'guest' } },
  ]
  for (const { cookie, options } of cases) {
    const response = await worker.fetch(new Request(`${DASHBOARD}/public/session`, { headers: { Origin: WEBSITE, Cookie: cookie } }), environment(options), ctx)
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { authenticated: false })
    assert.equal(response.headers.get('Cache-Control'), 'private, no-store')
  }
})

test('unknown, deceptive and missing origins cannot read dashboard session state', async () => {
  for (const origin of ['', 'null', 'https://attacker.example', WEBSITE + '.attacker.example', WEBSITE + ':444']) {
    const response = await worker.fetch(new Request(`${DASHBOARD}/public/session`, { headers: { ...(origin ? { Origin: origin } : {}), Cookie: `session=${token}` } }), environment({ active: true }), ctx)
    assert.equal(response.status, 403)
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), null)
    assert.equal(await response.text(), '')
    assert.equal(response.headers.get('Cache-Control'), 'private, no-store')
  }
})
