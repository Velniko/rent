import type { Context } from 'hono'
import { escapeHtml, renderEmailNotificationHtml, sanitizePlainText } from '../lib/html'
import { sendTransactionalEmail } from '../notifyChannels'
import { getSystemSettings } from '../site'
import { sameSecret } from './deliveryNotifications'
import { getDeliveryRuntimeConfig } from '../deliveryConfig'

type WelcomeBindings = { RENT: D1Database }

export const WELCOME_EMAIL_TEMPLATE_ID = 'welcome_site'
export const WELCOME_EMAIL_TEMPLATE_NAME = '欢迎邮件'
export const WELCOME_EMAIL_TEMPLATE_SUBJECT = '欢迎加入 {company_name}'
export const WELCOME_EMAIL_TEMPLATE_BODY = `<h2>欢迎加入 {company_name}</h2><p>您好 {customer_name}：</p><p>欢迎使用 <strong>{company_name}</strong> 设备租赁服务。您的账户已创建成功。</p><h3>账户信息</h3><table style="width:100%; border-collapse:collapse;"><tbody><tr><td style="padding:8px 0; color:#666;">账户姓名</td><td style="padding:8px 0;"><strong>{customer_name}</strong></td></tr><tr><td style="padding:8px 0; color:#666;">登录邮箱</td><td style="padding:8px 0;">{customer_email}</td></tr></tbody></table><p>您现在可以浏览设备、在线下单并电子签署租赁合同。如需帮助，请联系 <a href="mailto:{company_email}">{company_email}</a>。</p>`

export async function ensureWelcomeEmailTemplate(c: Context): Promise<void> {
  await c.env.RENT.prepare('CREATE TABLE IF NOT EXISTS email_templates (id TEXT PRIMARY KEY, name TEXT NOT NULL, subject TEXT NOT NULL, body TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)').run()
  try { await c.env.RENT.prepare("ALTER TABLE email_templates ADD COLUMN format TEXT NOT NULL DEFAULT 'markdown'").run() } catch (_) { /* column already exists */ }
  try { await c.env.RENT.prepare("ALTER TABLE email_templates ADD COLUMN theme_color TEXT NOT NULL DEFAULT '#f0a35b'").run() } catch (_) { /* column already exists */ }
  await c.env.RENT.prepare("INSERT OR IGNORE INTO email_templates (id, name, subject, body, format, theme_color) VALUES (?, ?, ?, ?, 'html', '#f0a35b')")
    .bind(WELCOME_EMAIL_TEMPLATE_ID, WELCOME_EMAIL_TEMPLATE_NAME, WELCOME_EMAIL_TEMPLATE_SUBJECT, WELCOME_EMAIL_TEMPLATE_BODY).run()
}

/**
 * 内部接口：供 geekslope-web（官网，独立 Worker）通过 RENT_SERVICE service binding
 * 调用，官网注册写完共享 D1 users 表后触发欢迎邮件。鉴权复用配送管理 Token
 * （DELIVERY_ADMIN_TOKEN / systemSettings.deliveryConfig.adminToken）：这是目前两个
 * Worker 之间唯一已共享的内部密钥，/internal/delivery-status-email 已是同样用法。
 */
export async function handleWelcomeEmail(c: Context<{ Bindings: WelcomeBindings }>): Promise<Response> {
  const config = await getDeliveryRuntimeConfig(c as any)
  const authorization = String(c.req.header('Authorization') || '')
  if (!config.adminToken || !(await sameSecret(authorization, `Bearer ${config.adminToken}`))) return c.json({ ok: false }, 401)

  let body: Record<string, unknown> = {}
  try { body = await c.req.json() as Record<string, unknown> } catch { return c.json({ ok: false, message: '请求格式无效。' }, 400) }
  const email = String(body.email || '').trim().toLowerCase().slice(0, 254)
  const name = sanitizePlainText(body.name, 100) || '客户'
  if (!email || !email.includes('@')) return c.json({ ok: false, message: '缺少收件邮箱。' }, 400)

  const db = c.env.RENT
  await ensureWelcomeEmailTemplate(c as any)
  const template = await db.prepare(`SELECT subject, body, enabled, theme_color FROM email_templates WHERE id = ? LIMIT 1`)
    .bind(WELCOME_EMAIL_TEMPLATE_ID).first<Record<string, unknown>>()
  if (!template || Number(template.enabled) === 0) return c.json({ ok: true, skipped: true, reason: 'template_disabled' }, 200)

  const company = getSystemSettings().companyDetails.name
  const vars: Record<string, string> = {
    customer_name: escapeHtml(name),
    customer_email: escapeHtml(email),
    company_name: escapeHtml(company),
    company_email: escapeHtml(getSystemSettings().companyDetails.email || ''),
  }
  const fill = (value: unknown) => String(value || '').replace(/\{([a-z_]+)\}/g, (_match, key: string) => vars[key] ?? '')
  const subject = sanitizePlainText(fill(template.subject || WELCOME_EMAIL_TEMPLATE_SUBJECT), 200)
  const content = fill(template.body || WELCOME_EMAIL_TEMPLATE_BODY)
  const text = sanitizePlainText(content, 3000)
  const html = renderEmailNotificationHtml(subject, content, company, String(template.theme_color || '#f0a35b'))

  const key = `welcome:${email}`
  const existing = await db.prepare('SELECT id, status FROM email_events WHERE idempotency_key = ? LIMIT 1').bind(key).first<Record<string, unknown>>()
  if (String(existing?.status || '') === 'SENT') return c.json({ ok: true, duplicate: true }, 200)
  if (existing && !['FAILED', 'SKIPPED'].includes(String(existing.status || ''))) return c.json({ ok: true, duplicate: true }, 200)
  const eventId = String(existing?.id || `email-welcome-${crypto.randomUUID().replaceAll('-', '')}`)
  if (!existing) {
    await db.prepare(`INSERT OR IGNORE INTO email_events
      (id, event_type, recipient, idempotency_key, status)
      VALUES (?, 'WELCOME', ?, ?, 'PENDING')`).bind(eventId, email, key).run()
  }

  const result = await sendTransactionalEmail(c as any, { to: email, subject, text, html })
  await db.prepare(`UPDATE email_events SET status = ?, provider_message_id = ?, error_message = ?,
    subject = ?, text_body = ?, html_body = ?, sent_at = CASE WHEN ? THEN CURRENT_TIMESTAMP END
    WHERE id = ?`).bind(
    result.ok ? 'SENT' : 'FAILED', result.id || null, result.error || null,
    subject, text, html, result.ok ? 1 : 0, eventId,
  ).run()
  return c.json({ ok: result.ok, message: result.ok ? '已发送欢迎邮件。' : '欢迎邮件发送失败。' }, result.ok ? 200 : 502)
}
