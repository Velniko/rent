/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

// Cookie 会话：token 只存 SHA-256 摘要（token_hash 主键），过期由 expires_at 控制。
// 访客账户在会话解析时顺带做到期清理。附带一个基于 D1 的分桶限流。
// 依赖 db/client、db/repositories（normalizeUserRow）、lib/cookie。

import type { Context } from 'hono'
import { getDB } from '../db/client'
import { readAuthTokenFromCookie } from '../lib/security'
import { normalizeUserRow } from '../db/repositories'
import type { User } from '../db/types'

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

let authSessionsSchemaReady: Promise<void> | null = null

async function ensureAuthSessionsSchema(c: Context): Promise<void> {
  if (!authSessionsSchemaReady) {
    authSessionsSchemaReady = c.env.RENT.prepare(`CREATE TABLE IF NOT EXISTS auth_sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`).run().then(() => undefined)
  }
  try {
    await authSessionsSchemaReady
  } catch (error) {
    authSessionsSchemaReady = null
    throw error
  }
}

// 请求级缓存：同一个请求里 middleware + 各路由处理器会反复调用 findUserBySession，
// 用 Request 对象做 key，把一次请求内的结果收敛成一次联表查询。
const perRequestSessionUser = new WeakMap<object, Promise<User | null>>()

export async function findUserBySession(c: Context, cookieHeader: string | null): Promise<User | null> {
  const requestKey = (c.req as any)?.raw
  if (requestKey) {
    const cached = perRequestSessionUser.get(requestKey)
    if (cached) return cached
    const pending = resolveUserBySession(c, cookieHeader)
    perRequestSessionUser.set(requestKey, pending)
    return pending
  }
  return resolveUserBySession(c, cookieHeader)
}

async function resolveUserBySession(c: Context, cookieHeader: string | null): Promise<User | null> {
  const db = getDB(c)
  // 同时接受 __Host-session（HTTPS 新 Cookie）与 session（旧 Cookie / 本地 http）。
  const token = readAuthTokenFromCookie(cookieHeader)
  if (!token) return null

  if (!/^[A-Za-z0-9_-]{32,}$/.test(token)) return null
  await ensureAuthSessionsSchema(c)
  const tokenHash = await sha256Hex(token)
  // 联表读取；不跨请求缓存认证结果，撤销或停用仍在下次请求立即生效。
  const user: User | null = await db.prepare("SELECT u.* FROM auth_sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > CURRENT_TIMESTAMP AND u.status = 'active'").bind(tokenHash).first()

  if (!user) return null
  const id = String(user.id)
  const guestExpiry = user.account_type === 'guest' ? String(user.guest_expires_at || '').slice(0, 10) : ''
  const todayMelbourne = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Melbourne', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  if (guestExpiry && guestExpiry < todayMelbourne) {
    await db.prepare("UPDATE users SET account_type = 'deleted_guest', status = 'inactive', email = 'deleted-guest-' || id || '@invalid.local', phone = NULL, bsb = NULL, account_number = NULL, password_hash = 'disabled', password_salt = 'disabled', guest_order_id = NULL, guest_expires_at = NULL, deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND account_type = 'guest'").bind(id).run()
    await db.prepare('DELETE FROM auth_sessions WHERE user_id = ?').bind(id).run()
    return null
  }
  // 活跃时间不参与鉴权或续期，通过 waitUntil 更新，避免阻塞页面返回。
  const touch = db.prepare("UPDATE auth_sessions SET last_seen_at = CURRENT_TIMESTAMP WHERE token_hash = ? AND expires_at > CURRENT_TIMESTAMP AND last_seen_at < datetime('now', '-5 minutes')").bind(tokenHash).run()
    .catch((error: unknown) => { console.error('Failed to update session activity:', error) })
  try { c.executionCtx.waitUntil(touch) } catch (_) { await touch }
  const normalized = normalizeUserRow(user as any)
  return normalized
}

export async function createAuthSession(c: Context, userId: string, remember = false): Promise<{ token: string; maxAge: number }> {
  await ensureAuthSessionsSchema(c)
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  const token = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  const maxAge = remember ? 60 * 60 * 24 * 30 : 60 * 60 * 12
  const expiresAt = new Date(Date.now() + maxAge * 1000).toISOString()
  await c.env.RENT.prepare('INSERT INTO auth_sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').bind(await sha256Hex(token), userId, expiresAt).run()
  return { token, maxAge }
}

// Logs out every device currently signed in as this user. Call whenever a
// credential could have been compromised: password reset/change (self or
// admin-initiated), or an account being locked/disabled.
export async function revokeAllSessions(c: Context, userId: string): Promise<void> {
  await c.env.RENT.prepare('DELETE FROM auth_sessions WHERE user_id = ?').bind(userId).run()
}

export async function deleteAuthSession(c: Context, cookieHeader: string | null): Promise<void> {
  const token = readAuthTokenFromCookie(cookieHeader)
  if (/^[A-Za-z0-9_-]{32,}$/.test(token)) await c.env.RENT.prepare('DELETE FROM auth_sessions WHERE token_hash = ?').bind(await sha256Hex(token)).run()
}

export async function enforceRateLimit(c: Context, scope: string, clientKey: string, limit: number, windowSeconds: number): Promise<boolean> {
  const bucket = Math.floor(Date.now() / (windowSeconds * 1000))
  await c.env.RENT.prepare(`INSERT INTO security_rate_limits (scope, client_key, bucket, request_count) VALUES (?, ?, ?, 1) ON CONFLICT(scope, client_key, bucket) DO UPDATE SET request_count = request_count + 1`).bind(scope, clientKey.slice(0, 200), bucket).run()
  const row = await c.env.RENT.prepare('SELECT request_count FROM security_rate_limits WHERE scope = ? AND client_key = ? AND bucket = ?').bind(scope, clientKey.slice(0, 200), bucket).first() as any
  return Number(row?.request_count || 0) <= limit
}
