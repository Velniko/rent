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
import { seedTestRoster, testInspectionFiles } from './helpers'
import { createAuthSession, verifyUserCredentials } from '../src/site'
import { renderAdminUserNew } from '../src/pages/admin/userNew'
import { renderStaffCustomerNew } from '../src/pages/staff/customerNew'
import { renderPasswordSetupNotice } from '../src/pages/partials/passwordSetupNotice'

async function setup(t: any, emailStatus = 200) {
  t.mock.timers.enable({apis:['Date'],now:new Date('2026-11-06T00:00Z')})
  const sqlite = new DatabaseSync(':memory:')
  for (const name of readdirSync(new URL('../migrations/', import.meta.url)).filter(name => name.endsWith('.sql')).sort()) sqlite.exec(readFileSync(new URL(`../migrations/${name}`, import.meta.url), 'utf8'))
  sqlite.exec("DELETE FROM systemSettings WHERE key = 'notificationChannels'; INSERT INTO users (id, name, email, role, status, account_status) VALUES ('test-admin', '管理员', 'admin@example.test', 'ADMIN', 'active', 'active'), ('test-staff', '员工', 'staff@example.test', 'STAFF', 'active', 'active');")
  seedTestRoster(sqlite,'test-staff')
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
      try {
        const results = []
        for (const statement of statements) results.push(await statement.run())
        sqlite.exec('COMMIT')
        return results
      } catch (error) { sqlite.exec('ROLLBACK'); throw error }
    },
  }
  const env = { RENT: db, RESEND_API_KEY: 'test-key', EMAIL_FROM: 'PC Rental <sender@example.test>' }
  const context = { env } as any
  const admin = await createAuthSession(context, 'test-admin')
  const staff = await createAuthSession(context, 'test-staff')
  const emails: any[] = []
  t.mock.method(globalThis, 'fetch', async (url: unknown, init: any) => {
    assert.equal(String(url), 'https://api.resend.com/emails')
    emails.push(JSON.parse(init.body))
    return new Response(JSON.stringify(emailStatus === 200 ? { id: 'test-mail' } : { message: 'Mail service unavailable' }), { status: emailStatus })
  })
  const request = (path: string, data?: Record<string, string>, actor: 'admin' | 'staff' | null = 'admin') => worker.fetch(new Request(`https://rent.example.test${path}`, {
    ...(data ? { method: 'POST', body: new URLSearchParams(data) } : {}),
    headers: { Origin: 'https://rent.example.test', 'Sec-Fetch-Site': 'same-origin', ...(actor ? { Cookie: `session=${actor === 'admin' ? admin.token : staff.token}` } : {}) },
  }), env as any, { waitUntil() { } } as any)
  t.after(() => sqlite.close())
  return { sqlite, emails, request, context }
}

const newUser = { firstName: 'Alice', lastName: 'Chen', email: 'alice@example.test' }

test('new user and customer forms make passwords optional and explain setup emails', () => {
  for (const html of [renderAdminUserNew({ role: 'ADMIN' }), renderStaffCustomerNew({ role: 'STAFF' })]) {
    const password = html.match(/<input[^>]*name="password"[^>]*>/)?.[0]
    assert.ok(password)
    assert.doesNotMatch(password, /\brequired\b/)
    assert.match(password, /minlength="8"/)
    assert.match(html, /24 小时/)
  }
  assert.match(renderPasswordSetupNotice('failed'), /账户已创建.*邮件发送失败/)
  assert.equal(renderPasswordSetupNotice('<script>bad</script>'), '')
})

test('admin can omit a new user password; emailed link sets it once and revokes existing sessions', async t => {
  const { sqlite, emails, request, context } = await setup(t)
  const created = await request('/admin/users/new', { ...newUser, role: 'MANAGER' })
  assert.equal(created.status, 303)
  assert.equal(created.headers.get('location'), '/admin/users?passwordSetup=sent')
  const user = sqlite.prepare('SELECT * FROM users WHERE email = ?').get(newUser.email) as any
  assert.equal(user.role, 'STAFF')
  assert.equal(user.access_level, 'MANAGER')
  assert.equal(user.password_hash, null)
  assert.equal(await verifyUserCredentials(context, newUser.email, 'anything'), null)
  assert.equal(emails.length, 1)
  assert.deepEqual(emails[0].to, [newUser.email])
  assert.match(emails[0].subject, /设置您的登录密码/)
  assert.match(emails[0].text, /24 小时/)
  const url = new URL(emails[0].text.match(/https:\/\/[^\s]+/)[0])
  const token = url.searchParams.get('token')!
  assert.ok(emails[0].html.includes(`href="${url.toString()}"`), 'HTML email must contain a clickable setup link')
  assert.equal(url.origin, 'https://rent.example.test')
  const reset = sqlite.prepare('SELECT *, unixepoch(expires_at) - unixepoch() AS remaining FROM password_resets WHERE user_id = ?').get(user.id) as any
  assert.match(reset.token_hash, /^[a-f0-9]{64}$/)
  assert.notEqual(reset.token_hash, token)
  assert.ok(reset.remaining > 23 * 3600 && reset.remaining <= 24 * 3600)
  const session = await createAuthSession(context, user.id)
  assert.ok(session.token)
  assert.equal((await request(url.pathname + url.search, undefined, null)).status, 200)
  const password = 'Fresh-password-123!'
  const saved = await request('/reset-password', { token, password, passwordConfirm: password }, null)
  assert.equal(saved.status, 302)
  assert.equal((await verifyUserCredentials(context, newUser.email, password))?.id, user.id)
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM auth_sessions WHERE user_id = ?').get(user.id)?.count, 0)
  assert.equal((await request('/reset-password', { token, password: 'Another-pass-123!', passwordConfirm: 'Another-pass-123!' }, null)).status, 400)
  assert.equal((await verifyUserCredentials(context, newUser.email, password))?.id, user.id)
})

test('provided strong passwords work directly without a setup email; weak passwords and invalid emails are rejected', async t => {
  const { sqlite, emails, request, context } = await setup(t)
  const invalidForms: Array<Record<string, string>> = [{ password: 'weak' }, { password: '   ' }, { email: 'invalid' }]
  for (const form of invalidForms) assert.equal((await request('/admin/users/new', { ...newUser, ...form })).status, 400)
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM users WHERE email = ?').get(newUser.email)?.count, 0)
  const password = 'Strong-pass-123!'
  assert.equal((await request('/admin/users/new', { ...newUser, password })).headers.get('location'), '/admin/users')
  assert.equal(emails.length, 0)
  assert.ok(await verifyUserCredentials(context, newUser.email, password))
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM password_resets').get()?.count, 0)
})

test('staff can invite a new customer and setup failures are visible without creating duplicate accounts', async t => {
  const { sqlite, emails, request } = await setup(t, 503)
  assert.equal((await request('/admin/users/new', newUser, 'staff')).status, 302)
  const response = await request('/staff/customers/new', newUser, 'staff')
  assert.equal(response.status, 303)
  assert.match(response.headers.get('location')!, /passwordSetup=failed$/)
  const customer = sqlite.prepare('SELECT * FROM users WHERE email = ?').get(newUser.email) as any
  assert.equal(customer.staff_id, 'test-staff')
  assert.equal(customer.password_hash, null)
  assert.equal(emails.length, 1)
  assert.match(await (await request(response.headers.get('location')!, undefined, 'staff')).text(), /账户已创建.*邮件发送失败/)
  assert.equal((await request('/staff/customers/new', newUser, 'staff')).status, 409)
  assert.equal(emails.length, 1)
})

test('forgot password can resend setup links, expires old tokens and rejects expired links', async t => {
  const { sqlite, emails, request } = await setup(t)
  await request('/admin/users/new', newUser)
  const oldToken = new URL(emails[0].text.match(/https:\/\/[^\s]+/)[0]).searchParams.get('token')!
  await request('/forgot-password', { email: newUser.email }, null)
  assert.equal(emails.length, 2)
  assert.match(emails[1].text, /30 分钟/)
  const password = 'Fresh-password-123!'
  assert.equal((await request('/reset-password', { token: oldToken, password, passwordConfirm: password }, null)).status, 400)
  const token = new URL(emails[1].text.match(/https:\/\/[^\s]+/)[0]).searchParams.get('token')!
  sqlite.exec("UPDATE password_resets SET expires_at = datetime('now', '-1 minute') WHERE used_at IS NULL")
  assert.equal((await request('/reset-password', { token, password, passwordConfirm: password }, null)).status, 400)
  await request('/forgot-password', { email: 'unknown@example.test' }, null)
  assert.equal(emails.length, 2)
})

test('missing email configuration reports setup failure while preserving the new account', async t => {
  const { sqlite, emails, request } = await setup(t)
  sqlite.exec(`INSERT INTO systemSettings (key, value) VALUES ('notificationChannels', '{"emailProvider":"brevo"}')`)
  const response = await request('/admin/users/new', newUser)
  assert.equal(response.status, 303)
  assert.equal(response.headers.get('location'), '/admin/users?passwordSetup=failed')
  assert.equal(emails.length, 0)
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM users WHERE email = ?').get(newUser.email)?.count, 1)
})
