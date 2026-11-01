/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

import type { Context } from 'hono'
import { constantTimeEqual as constantTimeEqualShared } from './lib/security'

type StripeStoredConfig = {
  publishableKey: string
  secretKey: string
  webhookSecret: string
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value)
  return new Uint8Array(Array.from(binary, char => char.charCodeAt(0)))
}

async function encryptionKey(c: Context): Promise<CryptoKey> {
  const masterKey = String((c.env as any).SETTINGS_ENCRYPTION_KEY || '')
  if (!masterKey) throw new Error('尚未配置 SETTINGS_ENCRYPTION_KEY')
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(masterKey))
  return crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

async function encrypt(c: Context, value: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await encryptionKey(c), new TextEncoder().encode(value))
  return `${bytesToBase64(iv)}.${bytesToBase64(new Uint8Array(encrypted))}`
}

async function decrypt(c: Context, value: string): Promise<string> {
  const [iv, ciphertext] = value.split('.')
  if (!iv || !ciphertext) throw new Error('Stripe 配置已损坏')
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: base64ToBytes(iv) }, await encryptionKey(c), base64ToBytes(ciphertext))
  return new TextDecoder().decode(decrypted)
}

async function readStoredConfig(c: Context): Promise<StripeStoredConfig | null> {
  const row = await c.env.RENT.prepare("SELECT value FROM systemSettings WHERE key = 'stripeConfig' AND deleted_at IS NULL").first() as any
  if (!row?.value) return null
  try {
    return JSON.parse(row.value) as StripeStoredConfig
  } catch {
    return null
  }
}

export async function getStripeConfigSummary(c: Context) {
  const stored = await readStoredConfig(c)
  if (!stored) return { configured: false, publishableKey: '', secretKeyMasked: '', webhookSecretMasked: '', mode: null }
  let secretKey = ''
  let webhookSecret = ''
  try {
    secretKey = await decrypt(c, stored.secretKey)
    webhookSecret = await decrypt(c, stored.webhookSecret)
  } catch {
    return { configured: false, publishableKey: stored.publishableKey || '', secretKeyMasked: '', webhookSecretMasked: '', mode: null }
  }
  return {
    configured: Boolean(stored.publishableKey && secretKey && webhookSecret),
    publishableKey: stored.publishableKey,
    secretKeyMasked: `${secretKey.slice(0, 8)}••••${secretKey.slice(-4)}`,
    webhookSecretMasked: `${webhookSecret.slice(0, 6)}••••${webhookSecret.slice(-4)}`,
    mode: secretKey.startsWith('sk_live_') ? 'live' : 'test',
  }
}

export async function saveStripeConfig(c: Context, input: Record<string, any>): Promise<void> {
  if (input.clear === true) {
    await c.env.RENT.prepare("UPDATE systemSettings SET deleted_at = CURRENT_TIMESTAMP WHERE key = 'stripeConfig'").run()
    return
  }
  const current = await readStoredConfig(c)
  const publishableKey = String(input.publishableKey ?? current?.publishableKey ?? '').trim()
  const secretKeyPlain = String(input.secretKey || '').trim()
  const webhookSecretPlain = String(input.webhookSecret || '').trim()
  const secretKey = secretKeyPlain ? await encrypt(c, secretKeyPlain) : current?.secretKey
  const webhookSecret = webhookSecretPlain ? await encrypt(c, webhookSecretPlain) : current?.webhookSecret

  if (!/^pk_(test|live)_/.test(publishableKey)) throw new Error('Stripe Publishable Key 格式不正确')
  if (secretKeyPlain && !/^sk_(test|live)_/.test(secretKeyPlain)) throw new Error('Stripe Secret Key 格式不正确')
  if (webhookSecretPlain && !webhookSecretPlain.startsWith('whsec_')) throw new Error('Stripe Webhook Secret 格式不正确')
  if (!secretKey || !webhookSecret) throw new Error('请完整填写 Stripe Secret Key 和 Webhook Secret')

  const effectiveSecret = secretKeyPlain || await decrypt(c, secretKey)
  const publicMode = publishableKey.startsWith('pk_live_') ? 'live' : 'test'
  const secretMode = effectiveSecret.startsWith('sk_live_') ? 'live' : 'test'
  if (publicMode !== secretMode) throw new Error('Stripe 公开密钥与私密密钥的测试/正式模式不一致')

  await c.env.RENT.prepare(`
    INSERT INTO systemSettings (key, value, updatedAt) VALUES ('stripeConfig', ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value = EXCLUDED.value, updatedAt = CURRENT_TIMESTAMP, deleted_at = NULL
  `).bind(JSON.stringify({ publishableKey, secretKey, webhookSecret })).run()
}

export async function getStripeRuntimeConfig(c: Context) {
  const stored = await readStoredConfig(c)
  if (!stored) throw new Error('管理员尚未配置 Stripe')
  return {
    publishableKey: stored.publishableKey,
    secretKey: await decrypt(c, stored.secretKey),
    webhookSecret: await decrypt(c, stored.webhookSecret),
  }
}

// 站内 Payment Element 需要在页面上用可公开的 publishable key 初始化 Stripe.js。
// 只读取明文 publishable key，不解密任何私密字段。
export async function getStripePublishableKey(c: Context): Promise<string> {
  const stored = await readStoredConfig(c)
  if (!stored?.publishableKey) throw new Error('管理员尚未配置 Stripe')
  return stored.publishableKey
}

export async function stripeRequest(c: Context, path: string, params?: URLSearchParams, idempotencyKey?: string, apiVersion?: string) {
  const { secretKey } = await getStripeRuntimeConfig(c)
  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: params ? 'POST' : 'GET',
    headers: {
      Authorization: `Bearer ${secretKey}`,
      ...(params ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
      ...(apiVersion ? { 'Stripe-Version': apiVersion } : {}),
    },
    body: params?.toString(),
  })
  const result = await response.json() as any
  if (!response.ok) throw new Error(result?.error?.message || 'Stripe 请求失败')
  return result
}

// 统一的常数时间比较实现（见 lib/security.ts）：不再提前按长度返回，
// 避免通过响应时间差异推断签名长度 / 前缀。
const constantTimeEqual = (a: string, b: string): boolean => constantTimeEqualShared(a, b)

export async function verifyStripeWebhook(c: Context, body: string, signatureHeader: string | undefined): Promise<any> {
  if (!signatureHeader) {
    signatureHeader = c.req.header('Stripe-Signature') || c.req.header('stripe-signature')
  }
  if (!signatureHeader) throw new Error('缺少 Stripe-Signature')
  const parts = signatureHeader.split(',').map(part => part.split('='))
  const timestamp = parts.find(([key]) => key === 't')?.[1]
  const signatures = parts.filter(([key]) => key === 'v1').map(([, value]) => value)
  if (!timestamp || !/^\d+$/.test(timestamp) || !signatures.length || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) throw new Error('Stripe webhook 签名已过期')
  const { webhookSecret } = await getStripeRuntimeConfig(c)
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(webhookSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${body}`))
  const expected = Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, '0')).join('')
  if (!signatures.some(signature => constantTimeEqual(signature, expected))) throw new Error('Stripe webhook 签名无效')
  return JSON.parse(body)
}
