/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

import type { Context } from 'hono'
import { getStripeRuntimeConfig } from '../stripe'
import { getSquareRuntimeConfig } from '../square'
import { resolveEmailCredentials, getNotifyChannelsSummary } from '../notifyChannels'
import { getTurnstileRuntimeConfig } from '../turnstile'
import { getEmailRuntimeConfig } from '../emailConfig'
import { verifySmtpConnection } from './smtp'

export type ConnectivityStatus = 'ok' | 'warning' | 'error' | 'unconfigured'

export interface ConnectivityProbeDefinition {
  id: string
  label: string
  category: 'CORE' | 'PAYMENT' | 'MESSAGING' | 'LOCATION' | 'DEVICE'
  endpoint: string
  description: string
}

export interface ConnectivityProbeResult extends ConnectivityProbeDefinition {
  status: ConnectivityStatus
  latencyMs: number
  detail: string
  checkedAt: string
}

export const CONNECTIVITY_PROBES: ConnectivityProbeDefinition[] = [
  { id: 'database', label: 'Cloudflare D1', category: 'CORE', endpoint: 'RENT binding', description: '验证 Worker 到主数据库的查询通道。' },
  { id: 'stripe', label: 'Stripe API', category: 'PAYMENT', endpoint: 'api.stripe.com/v1/account', description: '使用已保存的密钥读取 Stripe 账户，不创建付款。' },
  { id: 'square', label: 'Square API', category: 'PAYMENT', endpoint: 'connect.squareup.com/v2/locations', description: '使用已保存的密钥读取 Square 门店，不创建付款。' },
  { id: 'email', label: '邮件发送 API', category: 'MESSAGING', endpoint: 'SMTP / Resend / Brevo / MailerSend', description: '验证当前生效的邮件服务商密钥及连通性，不发送邮件。' },
  { id: 'notifyWebhook', label: '通用推送 Webhook', category: 'MESSAGING', endpoint: '已配置的 Webhook 地址', description: '检查通用推送 Webhook 是否已配置并启用，不发送请求。' },
  { id: 'exchange', label: 'AUD/CNY 汇率', category: 'PAYMENT', endpoint: 'api.frankfurter.app/latest', description: '读取澳元兑人民币实时汇率。' },
  { id: 'github', label: 'GitHub 客户端发布', category: 'DEVICE', endpoint: 'api.github.com/releases/latest', description: '验证 Windows 客户端更新检查通道。' },
  { id: 'photon', label: 'Photon 地址服务', category: 'LOCATION', endpoint: 'photon.komoot.io/api', description: '验证首选地址联想服务。' },
  { id: 'nominatim', label: 'Nominatim 地址服务', category: 'LOCATION', endpoint: 'nominatim.openstreetmap.org/search', description: '验证备用地址联想服务。' },
  { id: 'googlePlaces', label: 'Google Places', category: 'LOCATION', endpoint: 'places.googleapis.com/v1/places', description: '使用已配置密钥读取地点详情。' },
  { id: 'turnstile', label: 'Cloudflare Turnstile', category: 'CORE', endpoint: 'challenges.cloudflare.com/turnstile/v0/siteverify', description: '验证人机校验密钥和验证接口，不产生有效挑战。' },
  { id: 'deviceChannel', label: '设备客户端通道', category: 'DEVICE', endpoint: '/api/device-agent/*', description: '检查设备绑定、心跳和远程命令所需的数据通道。' },
]

const probeById = new Map(CONNECTIVITY_PROBES.map(probe => [probe.id, probe]))

async function timedFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 8000)
  try {
    return await fetch(input, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

async function runProbe(c: Context, definition: ConnectivityProbeDefinition): Promise<ConnectivityProbeResult> {
  const startedAt = Date.now()
  let status: ConnectivityStatus = 'ok'
  let detail = '连接正常'

  try {
    if (definition.id === 'database') {
      await c.env.RENT.prepare('SELECT 1 AS ok').first()
      detail = 'D1 查询成功'
    } else if (definition.id === 'stripe') {
      const { secretKey } = await getStripeRuntimeConfig(c)
      const response = await timedFetch('https://api.stripe.com/v1/account', { headers: { Authorization: `Bearer ${secretKey}` } })
      if (!response.ok) throw new Error(`Stripe 返回 HTTP ${response.status}`)
      detail = '密钥有效，账户接口可访问'
    } else if (definition.id === 'square') {
      const config = await getSquareRuntimeConfig(c)
      const host = config.environment === 'production' ? 'connect.squareup.com' : 'connect.squareupsandbox.com'
      const response = await timedFetch(`https://${host}/v2/locations/${encodeURIComponent(config.locationId)}`, { headers: { Authorization: `Bearer ${config.accessToken}`, Accept: 'application/json', 'Square-Version': '2026-08-19' } })
      if (!response.ok) throw new Error(`Square 返回 HTTP ${response.status}`)
      detail = 'Access Token 有效，门店接口可访问'
    } else if (definition.id === 'email') {
      const { provider, apiKey } = await resolveEmailCredentials(c)
      if (provider === 'smtp') {
        await verifySmtpConnection(await getEmailRuntimeConfig(c))
        detail = 'SMTP 连接及认证成功'
      } else if (!apiKey) { status = 'unconfigured'; detail = '尚未配置邮件服务商 API Key（后台「通知渠道」或对应环境变量）' }
      else if (provider === 'brevo') {
        const response = await timedFetch('https://api.brevo.com/v3/account', { headers: { 'api-key': apiKey, Accept: 'application/json' } })
        if (!response.ok) throw new Error(`Brevo 返回 HTTP ${response.status}`)
        detail = 'Brevo 密钥有效，账户接口可访问'
      } else if (provider === 'mailersend') {
        const response = await timedFetch('https://api.mailersend.com/v1/domains', { headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' } })
        if (!response.ok) throw new Error(`MailerSend 返回 HTTP ${response.status}`)
        detail = 'MailerSend 密钥有效，域名接口可访问'
      } else {
        const response = await timedFetch('https://api.resend.com/domains', { headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' } })
        if (!response.ok) throw new Error(`Resend 返回 HTTP ${response.status}`)
        detail = 'Resend 密钥有效，域名接口可访问，未投递测试邮件'
      }
    } else if (definition.id === 'notifyWebhook') {
      const summary = await getNotifyChannelsSummary(c)
      if (!summary.webhook.configured) { status = 'unconfigured'; detail = '尚未配置通用推送 Webhook' }
      else { status = summary.webhook.enabled ? 'ok' : 'warning'; detail = summary.webhook.enabled ? 'Webhook 地址已配置并启用' : '已配置但未启用推送' }
    } else if (definition.id === 'exchange') {
      const response = await timedFetch('https://api.frankfurter.app/latest?from=AUD&to=CNY', { headers: { Accept: 'application/json' } })
      if (!response.ok) throw new Error(`汇率服务返回 HTTP ${response.status}`)
      const data = await response.json() as any
      const rate = Number(data?.rates?.CNY)
      if (!Number.isFinite(rate) || rate <= 0) throw new Error('汇率服务未返回有效汇率')
      detail = `1 AUD = ${rate.toFixed(4)} CNY`
    } else if (definition.id === 'github') {
      const response = await timedFetch('https://api.github.com/repos/Velniko/rent-app/releases/latest', { headers: { 'User-Agent': 'rent-connectivity-check', Accept: 'application/vnd.github+json' } })
      if (!response.ok) throw new Error(`GitHub 返回 HTTP ${response.status}`)
      const data = await response.json() as any
      detail = `最新版本 ${String(data?.tag_name || '已读取')}`
    } else if (definition.id === 'photon') {
      const response = await timedFetch('https://photon.komoot.io/api/?q=Melbourne%2C%20Australia&limit=1&lang=en', { headers: { Accept: 'application/json', 'User-Agent': 'PC-Rental/1.0 connectivity check' } })
      if (!response.ok) throw new Error(`Photon 返回 HTTP ${response.status}`)
      const data = await response.json() as any
      if (!Array.isArray(data?.features)) throw new Error('Photon 返回格式异常')
      detail = '地址联想接口可访问'
    } else if (definition.id === 'nominatim') {
      const response = await timedFetch('https://nominatim.openstreetmap.org/search?q=Melbourne%2C%20Australia&format=jsonv2&limit=1&countrycodes=au', { headers: { Accept: 'application/json', 'User-Agent': 'PC-Rental/1.0 connectivity check' } })
      if (!response.ok) throw new Error(`Nominatim 返回 HTTP ${response.status}`)
      const data = await response.json() as any
      if (!Array.isArray(data)) throw new Error('Nominatim 返回格式异常')
      detail = '备用地址接口可访问'
    } else if (definition.id === 'googlePlaces') {
      const apiKey = String((c.env as any).GOOGLE_MAPS_API_KEY || '').trim()
      if (!apiKey) { status = 'unconfigured'; detail = '尚未配置 GOOGLE_MAPS_API_KEY' }
      else {
        const response = await timedFetch('https://places.googleapis.com/v1/places/ChIJ3S-JXmauEmsRUcIaWtf4MzE?languageCode=en&regionCode=AU', { headers: { 'X-Goog-Api-Key': apiKey, 'X-Goog-FieldMask': 'id,formattedAddress' } })
        if (!response.ok) throw new Error(`Google Places 返回 HTTP ${response.status}`)
        detail = '密钥有效，地点详情接口可访问'
      }
    } else if (definition.id === 'turnstile') {
      const { secretKey: secret } = await getTurnstileRuntimeConfig(c)
      if (!secret) { status = 'unconfigured'; detail = '尚未配置 Turnstile Secret Key（后台「系统设置」或 TURNSTILE_SECRET_KEY）' }
      else {
        const response = await timedFetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ secret, response: 'connectivity-probe' }) })
        if (!response.ok) throw new Error(`Turnstile 返回 HTTP ${response.status}`)
        const data = await response.json() as any
        const codes = Array.isArray(data?.['error-codes']) ? data['error-codes'].map(String) : []
        if (codes.includes('invalid-input-secret') || codes.includes('missing-input-secret')) throw new Error('Turnstile 密钥无效')
        detail = '验证接口可访问，密钥已被接受'
      }
    } else if (definition.id === 'deviceChannel') {
      const row = await c.env.RENT.prepare(`SELECT COUNT(*) AS bound,
        SUM(CASE WHEN agent_status = 'online' THEN 1 ELSE 0 END) AS online
        FROM devices WHERE agent_token_hash IS NOT NULL`).first() as any
      detail = `数据通道正常，已绑定 ${Number(row?.bound || 0)} 台，在线 ${Number(row?.online || 0)} 台`
    }
  } catch (error: any) {
    console.error(`Connectivity probe ${definition.id} failed:`, error?.message || error)
    const message = String(error?.name === 'AbortError' ? '请求超时（8 秒）' : error?.message || '请求失败')
    if ((definition.id === 'stripe' && message.includes('尚未配置 Stripe')) || (definition.id === 'square' && message.includes('尚未配置 Square')) || (definition.id === 'email' && message.includes('尚未配置 SMTP'))) status = 'unconfigured'
    else status = 'error'
    detail = message.slice(0, 160)
  }

  return { ...definition, status, latencyMs: Date.now() - startedAt, detail, checkedAt: new Date().toISOString() }
}

export async function runConnectivityProbes(c: Context, target: string): Promise<ConnectivityProbeResult[]> {
  const definitions = target === 'all' ? CONNECTIVITY_PROBES : [probeById.get(target)].filter(Boolean) as ConnectivityProbeDefinition[]
  if (!definitions.length) throw new Error('未知的检测项目')
  return Promise.all(definitions.map(definition => runProbe(c, definition)))
}
