/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { createHash } from 'node:crypto'
import { findUserBySession } from '../src/auth/session'

const token = 'a'.repeat(43)
const hash = createHash('sha256').update(token).digest('hex')

function setup() {
  const sqlite = new DatabaseSync(':memory:')
  sqlite.exec(`CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT, email TEXT, role TEXT, status TEXT, account_type TEXT);
    INSERT INTO users VALUES ('customer-1', 'Customer', 'customer@example.test', 'CUSTOMER', 'active', 'formal');
    CREATE TABLE auth_sessions (token_hash TEXT PRIMARY KEY, user_id TEXT, expires_at TEXT, last_seen_at TEXT);
    INSERT INTO auth_sessions VALUES ('${hash}', 'customer-1', datetime('now', '+1 day'), datetime('now', '-1 hour'));`)
  let reads = 0
  const background: Promise<unknown>[] = []
  const db = {
    prepare(sql: string) {
      let values: any[] = []
      return {
        bind(...args: any[]) { values = args; return this },
        async run() { return sqlite.prepare(sql).run(...values) },
        async first() { reads++; return sqlite.prepare(sql).get(...values) || null },
      }
    },
  }
  const request = () => ({ env: { RENT: db }, executionCtx: { waitUntil(promise: Promise<unknown>) { background.push(promise) } }, req: { raw: new Request('https://rent.example/customer/orders') } } as any)
  return { sqlite, request, reads: () => reads, flush: () => Promise.all(background) }
}

test('session authentication uses one blocking D1 read and coalesces lookups within a request', async () => {
  const { sqlite, request, reads, flush } = setup()
  try {
    const context = request()
    const [first, second] = await Promise.all([findUserBySession(context, `session=${token}`), findUserBySession(context, `session=${token}`)])
    assert.equal(first?.id, 'customer-1')
    assert.equal(first, second)
    assert.equal(reads(), 1)
    await flush()
    const seen = sqlite.prepare('SELECT last_seen_at FROM auth_sessions').get()?.last_seen_at
    assert.equal(seen, sqlite.prepare('SELECT CURRENT_TIMESTAMP AS now').get()?.now)
    sqlite.exec("UPDATE auth_sessions SET last_seen_at = datetime('now', '-1 minute')")
    const recent = sqlite.prepare('SELECT last_seen_at FROM auth_sessions').get()?.last_seen_at
    await findUserBySession(request(), `session=${token}`)
    assert.equal(sqlite.prepare('SELECT last_seen_at FROM auth_sessions').get()?.last_seen_at, recent)
  } finally { await flush(); sqlite.close() }
})

test('separate requests reject revoked, expired and disabled sessions immediately', async () => {
  for (const mutation of [
    'DELETE FROM auth_sessions',
    "UPDATE auth_sessions SET expires_at = datetime('now', '-1 day')",
    "UPDATE users SET status = 'inactive'",
  ]) {
    const { sqlite, request, flush } = setup()
    try {
      assert.ok(await findUserBySession(request(), `session=${token}`))
      sqlite.exec(mutation)
      assert.equal(await findUserBySession(request(), `session=${token}`), null)
    } finally { await flush(); sqlite.close() }
  }
})
