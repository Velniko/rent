import type { Context } from 'hono'
import { getDeliveryRuntimeConfig } from '../deliveryConfig'
import { deliveryStatusInfo } from '../deliveryStatus'
import { escapeHtml, renderEmailNotificationHtml, sanitizePlainText } from '../lib/html'
import { sendTransactionalEmail } from '../notifyChannels'
import { getSystemSettings } from '../site'

type DeliveryBindings = { RENT: D1Database }

export async function sameSecret(left: string, right: string): Promise<boolean> {
  if (!left || !right) return false
  const [leftHash, rightHash] = await Promise.all([
    crypto.subtle.digest('SHA-256', new TextEncoder().encode(left)),
    crypto.subtle.digest('SHA-256', new TextEncoder().encode(right)),
  ])
  const a = new Uint8Array(leftHash)
  const b = new Uint8Array(rightHash)
  let difference = a.length ^ b.length
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) difference |= (a[index] || 0) ^ (b[index] || 0)
  return difference === 0
}

function safeTrackingUrl(value: unknown): string {
  const raw = String(value || '').trim()
  try {
    const url = new URL(raw)
    return ['http:', 'https:'].includes(url.protocol) ? url.toString().slice(0, 1000) : ''
  } catch {
    return ''
  }
}

export const DELIVERY_STATUS_TEMPLATE_ID = 'delivery_status_update'
export const DELIVERY_STATUS_TEMPLATE_NAME = '配送状态更新'
export const DELIVERY_STATUS_TEMPLATE_SUBJECT = '配送状态更新：{order_number} · {delivery_status}'
export const DELIVERY_STATUS_TEMPLATE_BODY = `<h2>配送状态更新</h2><p>您好 {customer_name}：</p><p>您的订单 <strong>{order_number}</strong> 的{delivery_direction}状态已更新为：<strong>{delivery_status}</strong>。</p><p>{delivery_status_description}</p><p>设备：{device_name}<br>配送编号：{delivery_reference}</p><p>追踪链接：<a href="{tracking_url}">{tracking_url}</a></p>`

export async function ensureDeliveryStatusTemplate(c: Context): Promise<void> {
  await c.env.RENT.prepare('CREATE TABLE IF NOT EXISTS email_templates (id TEXT PRIMARY KEY, name TEXT NOT NULL, subject TEXT NOT NULL, body TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)').run()
  try { await c.env.RENT.prepare("ALTER TABLE email_templates ADD COLUMN format TEXT NOT NULL DEFAULT 'markdown'").run() } catch (_) { /* column already exists */ }
  try { await c.env.RENT.prepare("ALTER TABLE email_templates ADD COLUMN theme_color TEXT NOT NULL DEFAULT '#f0a35b'").run() } catch (_) { /* column already exists */ }
  await c.env.RENT.prepare("INSERT OR IGNORE INTO email_templates (id, name, subject, body, format, theme_color) VALUES (?, ?, ?, ?, 'html', '#f0a35b')")
    .bind(DELIVERY_STATUS_TEMPLATE_ID, DELIVERY_STATUS_TEMPLATE_NAME, DELIVERY_STATUS_TEMPLATE_SUBJECT, DELIVERY_STATUS_TEMPLATE_BODY).run()
}

export async function handleDeliveryStatusEmail(c: Context<{ Bindings: DeliveryBindings }>): Promise<Response> {
  const config = await getDeliveryRuntimeConfig(c as any)
  const authorization = String(c.req.header('Authorization') || '')
  if (!(await sameSecret(authorization, `Bearer ${config.adminToken}`))) return c.json({ ok: false }, 401)

  let body: Record<string, unknown> = {}
  try { body = await c.req.json() as Record<string, unknown> } catch { return c.json({ ok: false, message: '请求格式无效。' }, 400) }
  const bookingId = String(body.bookingId || '').trim().slice(0, 120)
  if (!bookingId) return c.json({ ok: false, message: '缺少配送订单编号。' }, 400)

  const db = c.env.RENT
  const booking = await db.prepare(`
    SELECT b.id, b.status, b.direction, b.tracking_url, b.provider_reference,
      o.id AS order_id, o.orderNo AS order_no, u.email, u.name AS customer_name,
      d.name AS device_name
    FROM delivery_bookings b
    JOIN orders o ON o.id = b.order_id
    JOIN users u ON u.id = o.userId
    LEFT JOIN devices d ON d.id = o.deviceId
    WHERE b.id = ? LIMIT 1
  `).bind(bookingId).first<Record<string, unknown>>()
  if (!booking) return c.json({ ok: true, skipped: true }, 200)

  const email = String(booking.email || '').trim().toLowerCase()
  if (!email || !email.includes('@')) return c.json({ ok: true, skipped: true }, 200)
  await ensureDeliveryStatusTemplate(c as any)
  const template = await db.prepare(`SELECT subject, body, enabled, theme_color FROM email_templates WHERE id = ? LIMIT 1`)
    .bind(DELIVERY_STATUS_TEMPLATE_ID).first<Record<string, unknown>>()
  if (!template || Number(template.enabled) === 0) return c.json({ ok: true, skipped: true, reason: 'template_disabled' }, 200)

  const status = deliveryStatusInfo(booking.status)
  const direction = String(booking.direction) === 'return' ? '回收' : '派送'
  const orderNo = String(booking.order_no || booking.order_id)
  const trackingUrl = safeTrackingUrl(booking.tracking_url)
  const company = getSystemSettings().companyDetails.name
  const vars: Record<string, string> = {
    customer_name: escapeHtml(booking.customer_name || '客户'),
    customer_email: escapeHtml(email),
    order_number: escapeHtml(orderNo),
    device_name: escapeHtml(booking.device_name || '租赁设备'),
    delivery_direction: escapeHtml(direction),
    delivery_status: escapeHtml(status.label),
    delivery_status_description: escapeHtml(status.description),
    delivery_reference: escapeHtml(booking.provider_reference || ''),
    tracking_url: escapeHtml(trackingUrl),
    company_name: escapeHtml(company),
    company_email: escapeHtml(getSystemSettings().companyDetails.email || ''),
  }
  const fill = (value: unknown) => String(value || '').replace(/\{([a-z_]+)\}/g, (_match, key: string) => vars[key] ?? '')
  const subject = sanitizePlainText(fill(template.subject || DELIVERY_STATUS_TEMPLATE_SUBJECT), 200)
  const content = fill(template.body || DELIVERY_STATUS_TEMPLATE_BODY)
  const text = sanitizePlainText(content, 3000)
  const html = renderEmailNotificationHtml(subject, content, company, String(template.theme_color || '#f0a35b'))
  const key = `delivery-status:${booking.id}:${status.key}`
  const existing = await db.prepare('SELECT id, status FROM email_events WHERE idempotency_key = ? LIMIT 1').bind(key).first<Record<string, unknown>>()
  if (String(existing?.status || '') === 'SENT') return c.json({ ok: true, duplicate: true }, 200)
  if (existing && !['FAILED', 'SKIPPED'].includes(String(existing.status || ''))) return c.json({ ok: true, duplicate: true }, 200)
  const eventId = String(existing?.id || `email-delivery-${crypto.randomUUID().replaceAll('-', '')}`)
  if (!existing) {
    await db.prepare(`INSERT OR IGNORE INTO email_events
      (id, event_type, recipient, order_id, idempotency_key, status)
      VALUES (?, 'DELIVERY_STATUS', ?, ?, ?, 'PENDING')`).bind(eventId, email, booking.order_id, key).run()
  }

  const result = await sendTransactionalEmail(c as any, {
    to: email,
    subject,
    text,
    html,
  })
  await db.prepare(`UPDATE email_events SET status = ?, provider_message_id = ?, error_message = ?,
    subject = ?, text_body = ?, html_body = ?, sent_at = CASE WHEN ? THEN CURRENT_TIMESTAMP END
    WHERE id = ?`).bind(
    result.ok ? 'SENT' : 'FAILED', result.id || null, result.error || null,
    subject, text, html, result.ok ? 1 : 0, eventId,
  ).run()
  return c.json({ ok: result.ok, message: result.ok ? '已发送配送状态提醒。' : '配送状态邮件发送失败。' }, result.ok ? 200 : 502)
}
