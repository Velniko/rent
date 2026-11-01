/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

// 站内通知 + 若干由 cron 触发的通知 / 邮件投递任务。
// 依赖 settings（公司信息、发件人）与 lib/html（邮件模板）。

import type { Context } from 'hono'
import { escapeHtml, renderEmailNotificationHtml, sanitizePlainText } from '../lib/html'
import { safeJsonParse } from '../lib/json'
import { getSystemSettings } from '../settings/systemSettings'
import { resolveEmailCredentials, sendTransactionalEmail, dispatchChannelAlert } from '../notifyChannels'
import type { EmailAttachment } from '../notifyChannels'
import { buildPickupQrPayload } from '../lib/pickupQr'
import { buildReceiptPdf, bytesToBase64, DEFAULT_RECEIPT_PDF_TEMPLATE } from './receiptPdf'

const STAFF_ROLES = new Set(['ADMIN', 'MANAGER', 'STAFF'])

// 只有后台人员主动发送的私信使用这条兜底模板。订单、申请与退款等业务事件
// 必须套用各自的业务模板，不能把业务邮件伪装成普通站内通知邮件。
const SITE_NOTIFICATION_TEMPLATE_ID = 'site_notification'
const SITE_NOTIFICATION_TEMPLATE_NAME = '站内通知（自动邮件）'
const SITE_NOTIFICATION_TEMPLATE_SUBJECT = '{title}'
const SITE_NOTIFICATION_TEMPLATE_BODY = '<h2>{title}</h2><p>您好 {customer_name}：</p><p>{message}</p>'
const BUSINESS_NOTIFICATION_TEMPLATE_IDS: Record<string, string> = {
  rental_application: 'rental_application_submitted',
  rental_application_approved: 'rental_application_approved',
  rental_application_rejected: 'rental_application_rejected',
  order_created: 'order_created',
  rental_payment_pending: 'order_pending_payment',
  rental_payment_charged: 'payment_completed',
  payment_approved: 'payment_completed',
  due_soon_3d: 'return_reminder',
  due_today: 'return_reminder',
  refund_completed: 'refund_completed',
  deposit_refunded: 'refund_completed',
}
const CUSTOMER_AUTOMATIC_EMAIL_TYPES = new Set([
  'early_return_approved', 'rental_payment_charged', 'rental_payment_pending',
  'rental_application_approved', 'rental_application_rejected', 'rental_cancelled',
  'rental_suspended', 'payment_approved', 'payment_rejected', 'order_price_adjustment',
  'due_soon_3d', 'due_today', 'pickup_reminder', 'refund_completed', 'deposit_refunded',
  'rental_overdue', 'feedback_reward', 'square_deposit_payment', 'square_residual_order', 'square_residual_topup',
])
const TAX_INVOICE_TEMPLATE_ID = 'tax_invoice_issued'
const TAX_INVOICE_TEMPLATE_NAME = 'Tax invoice issued'
const TAX_INVOICE_TEMPLATE_SUBJECT = 'Tax invoice for order {order_number}'
const TAX_INVOICE_TEMPLATE_BODY = '<h2>Tax invoice issued</h2><p>Hello {customer_name},</p><p>Your tax invoice for order <strong>{order_number}</strong> is attached to this email.</p><h3>Invoice details</h3><table style="width:100%; border-collapse:collapse;"><tbody><tr><td style="padding:8px 0; color:#666;">Invoice number</td><td style="padding:8px 0;"><strong>{invoice_number}</strong></td></tr><tr><td style="padding:8px 0; color:#666;">Order number</td><td style="padding:8px 0;">{order_number}</td></tr><tr><td style="padding:8px 0; color:#666;">Amount paid</td><td style="padding:8px 0;"><strong>{total_amount}</strong></td></tr></tbody></table><p>Please keep the attached PDF for your records. If you have any questions, contact <a href="mailto:{company_email}">{company_email}</a>.</p>'

function orderTimeSlot(order: any, key: 'pickup' | 'return'): string {
  return String(key === 'pickup' ? order?.pickupTimeSlot || order?.pickup_time_slot || '' : order?.returnTimeSlot || order?.return_time_slot || '').trim() || 'N/A'
}

function orderDeliveryFee(order: any): string {
  const method = String(order?.deliveryMethod || order?.delivery_method || '').toLowerCase()
  return method === 'delivery' ? `AUD ${Number(order?.deliveryFee || order?.delivery_fee || 0).toFixed(2)}` : 'N/A'
}

let siteNotificationTemplateReady: Promise<void> | null = null

async function ensureSiteNotificationEmailTemplate(c: Context): Promise<void> {
  if (!siteNotificationTemplateReady) siteNotificationTemplateReady = (async () => {
    await c.env.RENT.prepare('CREATE TABLE IF NOT EXISTS email_templates (id TEXT PRIMARY KEY, name TEXT NOT NULL, subject TEXT NOT NULL, body TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)').run()
    try { await c.env.RENT.prepare("ALTER TABLE email_templates ADD COLUMN format TEXT NOT NULL DEFAULT 'markdown'").run() } catch (_) { /* column already exists */ }
    try { await c.env.RENT.prepare("ALTER TABLE email_templates ADD COLUMN theme_color TEXT NOT NULL DEFAULT '#f0a35b'").run() } catch (_) { /* column already exists */ }
    await c.env.RENT.prepare("INSERT OR IGNORE INTO email_templates (id, name, subject, body, format) VALUES (?, ?, ?, ?, 'html')")
      .bind(SITE_NOTIFICATION_TEMPLATE_ID, SITE_NOTIFICATION_TEMPLATE_NAME, SITE_NOTIFICATION_TEMPLATE_SUBJECT, SITE_NOTIFICATION_TEMPLATE_BODY).run()
  })()
  try { await siteNotificationTemplateReady } catch (error) { siteNotificationTemplateReady = null; throw error }
}

async function ensureTaxInvoiceEmailTemplate(c: Context): Promise<void> {
  await c.env.RENT.prepare('INSERT OR IGNORE INTO email_templates (id, name, subject, body, format) VALUES (?, ?, ?, ?, \'html\')')
    .bind(TAX_INVOICE_TEMPLATE_ID, TAX_INVOICE_TEMPLATE_NAME, TAX_INVOICE_TEMPLATE_SUBJECT, TAX_INVOICE_TEMPLATE_BODY).run()
}

async function sendPickupReminderEmail(c: Context, notification: { recipientId: string; orderId?: string }, recipient: any, email: string): Promise<void> {
  if (!notification.orderId) return
  const order = await c.env.RENT.prepare('SELECT o.*, d.name AS device_name FROM orders o LEFT JOIN devices d ON d.id = o.deviceId WHERE o.id = ?').bind(notification.orderId).first() as any
  if (!order || !['paid', 'pending_pickup'].includes(String(order.status))) return
  const template = await c.env.RENT.prepare("SELECT subject, body, enabled, theme_color FROM email_templates WHERE id = 'pickup_reminder'").first() as any
  if (!template || template.enabled === 0) return
  const companyDetails = getSystemSettings().companyDetails || ({} as any)
  const vars: Record<string, string> = {
    customer_name: normalizeCustomerName(recipient?.name), customer_email: email,
    order_number: String(order.orderNo || order.id), device_name: String(order.device_name || ''),
    pickup_date: String(order.startDate || ''), pickup_location: String(order.pickupLocation || '到店自取'),
    pickup_time: orderTimeSlot(order, 'pickup'), return_time: orderTimeSlot(order, 'return'),
    delivery_fee: orderDeliveryFee(order),
    order_detail_url: buildNotificationOrderDetailUrl(c.req.url, order.id, 'CUSTOMER'),
    company_name: String(companyDetails.name || ''), company_email: String(companyDetails.email || ''),
  }
  const fill = (value: string) => value.replace(/\{([a-z_]+)\}/g, (_: string, key: string) => vars[key] ?? '')
  const subject = fill(String(template.subject || '取件提醒 - {order_number}'))
  const payload = buildPickupQrPayload(order.id, c.req.url)
  const qrImageUrl = `https://quickchart.io/qr?text=${encodeURIComponent(payload)}&size=240&margin=2&ecLevel=M`
  const qrSection = `<hr style="margin:28px 0;border:0;border-top:1px solid #e5e7eb;"><div style="text-align:center;"><h3 style="margin:0 0 8px;color:#111827;">取货二维码</h3><p style="margin:0 0 14px;color:#6b7280;">到店后请向工作人员出示此二维码</p><img src="${escapeHtml(qrImageUrl)}" width="220" height="220" alt="订单 ${escapeHtml(vars.order_number)} 取货二维码" style="display:block;width:220px;height:220px;margin:0 auto;border:8px solid #fff;"><p style="margin:14px 0 0;color:#9ca3af;font-size:12px;">订单号：${escapeHtml(vars.order_number)}</p></div>`
  const html = renderEmailNotificationHtml(subject, fill(String(template.body || '')), vars.company_name, template.theme_color || '#f0a35b', qrSection)
  const text = `您好 ${vars.customer_name}：您的订单 ${vars.order_number} 已准备取货。请到店后出示取货二维码。`
  await sendTransactionalEmail(c, { to: email, subject, text: sanitizePlainText(text, 2000), html })
}

// 给一条已创建的站内信补发邮件：找收件人邮箱、找兜底模板、套用变量、发信。
// 尽力而为——任何一步失败都不影响站内信本身，调用方只需 catch 掉即可。
async function sendNotificationEmail(c: Context, notification: { recipientId: string; type: string; title: string; message: string; orderId?: string }): Promise<void> {
  const { apiKey, from } = await resolveEmailCredentials(c)
  if (!apiKey || !from) return
  const recipient = await c.env.RENT.prepare('SELECT name, email, role FROM users WHERE id = ?').bind(notification.recipientId).first() as any
  const email = String(recipient?.email || '').trim()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.endsWith('@invalid.local')) return

  if (notification.type === 'pickup_reminder') {
    await sendPickupReminderEmail(c, notification, recipient, email)
    return
  }

  const templateId = BUSINESS_NOTIFICATION_TEMPLATE_IDS[notification.type]
  if (templateId) {
    if (!notification.orderId) return
    const [template, order, contract] = await Promise.all([
      c.env.RENT.prepare('SELECT subject, body, enabled, theme_color FROM email_templates WHERE id = ?').bind(templateId).first(),
      c.env.RENT.prepare('SELECT * FROM orders WHERE id = ?').bind(notification.orderId).first(),
      c.env.RENT.prepare('SELECT contractNumber, signToken FROM contracts WHERE orderId = ? ORDER BY createdAt DESC LIMIT 1').bind(notification.orderId).first(),
    ]) as any[]
    if (!order) return
    if (!template) {
      await sendGenericNotificationEmail(c, notification, recipient, email)
      return
    }
    if (template.enabled === 0) return

    const [customer, device, refund] = await Promise.all([
      c.env.RENT.prepare('SELECT name, email FROM users WHERE id = ?').bind(order.userId).first(),
      order.deviceId ? c.env.RENT.prepare('SELECT name FROM devices WHERE id = ?').bind(order.deviceId).first() : Promise.resolve(null),
      templateId === 'refund_completed'
        ? c.env.RENT.prepare("SELECT refund_amount, refunded_processing_fee FROM payment_refunds WHERE order_id = ? AND status = 'succeeded' ORDER BY created_at DESC LIMIT 1").bind(order.id).first()
        : Promise.resolve(null),
    ]) as any[]
    const companyDetails = getSystemSettings().companyDetails || ({} as any)
    const refundAmount = Number(refund?.refund_amount || 0) + Number(refund?.refunded_processing_fee || 0)
    const signToken = String(contract?.signToken || '')
    const vars: Record<string, string> = {
      title: notification.title,
      message: notification.message,
      customer_name: normalizeCustomerName(customer?.name),
      customer_email: String(customer?.email || ''),
      order_number: String(order.orderNo || order.id),
      contract_number: String(contract?.contractNumber || ''),
      device_name: String(device?.name || ''),
      start_date: String(order.startDate || ''),
      end_date: String(order.endDate || ''),
      rental_period: order.rentalPeriod ? `${order.rentalPeriod} 天` : '',
      total_amount: `AUD ${Number(order.totalAmount || 0).toFixed(2)}`,
      deposit_amount: `AUD ${Number(order.depositAmount || 0).toFixed(2)}`,
      refund_amount: `AUD ${refundAmount.toFixed(2)}`,
      payment_due_date: String(order.paymentDueDate || order.payment_due_date || ''),
      delivery_method: String(order.deliveryMethod || order.delivery_method || ''),
      delivery_address: String(order.pickupLocation || order.pickup_location || ''),
      delivery_fee: orderDeliveryFee(order),
      pickup_time: orderTimeSlot(order, 'pickup'),
      return_time: orderTimeSlot(order, 'return'),
      rental_note: String(order.rentalNote || order.rental_note || ''),
      order_detail_url: buildNotificationOrderDetailUrl(c.req.url, order.id, recipient?.role),
      sign_url: signToken ? new URL(`/contract/sign?token=${encodeURIComponent(signToken)}&step=1`, c.req.url).toString() : '',
      company_name: String(companyDetails.name || ''),
      company_email: String(companyDetails.email || ''),
    }
    const fill = (value: string) => value.replace(/\{([a-z_]+)\}/g, (_: string, key: string) => vars[key] ?? '')
    const subject = fill(String(template.subject || notification.title))
    const html = renderEmailNotificationHtml(subject, fill(String(template.body || '')), vars.company_name, template.theme_color || '#f0a35b')
    await sendTransactionalEmail(c, { to: email, subject, text: sanitizePlainText(notification.message, 2000), html })
    return
  }

  if (CUSTOMER_AUTOMATIC_EMAIL_TYPES.has(notification.type)) {
    if (String(recipient?.role || '').toUpperCase() !== 'CUSTOMER') return
    await sendGenericNotificationEmail(c, notification, recipient, email)
    return
  }

  // 通用邮件只服务于后台人员手动发送的私信；通告和其它业务站内通知不发兜底邮件。
  if (notification.type !== 'manual') return

  await ensureSiteNotificationEmailTemplate(c)
  const template = await c.env.RENT.prepare('SELECT subject, body, enabled, theme_color FROM email_templates WHERE id = ?').bind(SITE_NOTIFICATION_TEMPLATE_ID).first() as any
  if (!template || template.enabled === 0) return

  const companyDetails = getSystemSettings().companyDetails || ({} as any)
  const orderDetailUrl = buildNotificationOrderDetailUrl(c.req.url, notification.orderId, recipient?.role)
  const vars: Record<string, string> = {
    title: notification.title,
    message: notification.message,
    customer_name: normalizeCustomerName(recipient?.name),
    customer_email: email,
    order_detail_url: orderDetailUrl,
    company_name: String(companyDetails.name || ''),
    company_email: String(companyDetails.email || ''),
  }
  const fill = (value: string) => value.replace(/\{([a-z_]+)\}/g, (_: string, key: string) => vars[key] ?? '')
  const subject = fill(String(template.subject || SITE_NOTIFICATION_TEMPLATE_SUBJECT))
  const html = renderEmailNotificationHtml(subject, fill(String(template.body || SITE_NOTIFICATION_TEMPLATE_BODY)), vars.company_name, template.theme_color || '#f0a35b')
  await sendTransactionalEmail(c, { to: email, subject, text: sanitizePlainText(notification.message, 2000), html })
}

async function sendGenericNotificationEmail(c: Context, notification: { recipientId: string; title: string; message: string; orderId?: string }, recipient: any, email: string): Promise<void> {
  const companyDetails = getSystemSettings().companyDetails || ({} as any)
  const subject = sanitizePlainText(notification.title, 200)
  const detailUrl = notification.orderId ? buildNotificationOrderDetailUrl(c.req.url, notification.orderId, recipient?.role) : ''
  const detailLink = detailUrl ? `<p><a href="${escapeHtml(detailUrl)}">查看订单详情</a></p>` : ''
  const html = renderEmailNotificationHtml(subject, `<p>${notification.message}</p>${detailLink}`, String(companyDetails.name || ''))
  await sendTransactionalEmail(c, { to: email, subject, text: sanitizePlainText(notification.message, 2000), html })
}

// 判断某个收件人是不是员工/管理员（结果按请求缓存）。用于决定这条通知
// 是否要同时广播到已启用的推送 Webhook——客户的站内信不会往管理员的推送渠道里灌。
async function isStaffRecipient(c: Context, recipientId: string): Promise<boolean> {
  const cache: Map<string, boolean> = (c as any).__recipientRoleCache ||= new Map()
  if (cache.has(recipientId)) return cache.get(recipientId)!
  let staff = false
  try {
    const row = await c.env.RENT.prepare('SELECT role FROM users WHERE id = ?').bind(recipientId).first() as any
    staff = STAFF_ROLES.has(String(row?.role || '').toUpperCase())
  } catch { staff = false }
  cache.set(recipientId, staff)
  return staff
}

let notificationsSchemaReady: Promise<void> | null = null

export async function ensureNotificationsTable(c: Context): Promise<void> {
  if (!notificationsSchemaReady) notificationsSchemaReady = (async () => {
    await c.env.RENT.prepare(`CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    recipient_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    title_en TEXT,
    message_en TEXT,
    order_id TEXT,
    sender_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    read_at TEXT,
    deleted_at TEXT,
    expires_at TEXT,
    dedupe_key TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`).run()
    try { await c.env.RENT.prepare('ALTER TABLE notifications ADD COLUMN sender_id TEXT REFERENCES users(id) ON DELETE SET NULL').run() } catch (_) { /* column already exists */ }
    try { await c.env.RENT.prepare('ALTER TABLE notifications ADD COLUMN deleted_at TEXT').run() } catch (_) { /* column already exists */ }
    try { await c.env.RENT.prepare('ALTER TABLE notifications ADD COLUMN expires_at TEXT').run() } catch (_) { /* column already exists */ }
    try { await c.env.RENT.prepare('ALTER TABLE notifications ADD COLUMN dedupe_key TEXT').run() } catch (_) { /* column already exists */ }
    try { await c.env.RENT.prepare('ALTER TABLE notifications ADD COLUMN title_en TEXT').run() } catch (_) { /* column already exists */ }
    try { await c.env.RENT.prepare('ALTER TABLE notifications ADD COLUMN message_en TEXT').run() } catch (_) { /* column already exists */ }
    await c.env.RENT.prepare('CREATE INDEX IF NOT EXISTS idx_notifications_recipient_created ON notifications(recipient_id, read_at, created_at DESC)').run()
    await c.env.RENT.prepare('CREATE INDEX IF NOT EXISTS idx_notifications_sender_created ON notifications(sender_id, deleted_at, created_at DESC)').run()
    await c.env.RENT.prepare('CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_dedupe ON notifications(recipient_id, dedupe_key) WHERE dedupe_key IS NOT NULL').run()
  })()
  try { await notificationsSchemaReady } catch (error) { notificationsSchemaReady = null; throw error }
}

async function ensureAgreementUpdateQueueTable(c: Context): Promise<void> {
  await c.env.RENT.prepare(`CREATE TABLE IF NOT EXISTS agreement_update_queue (
    agreement_key TEXT PRIMARY KEY NOT NULL,
    agreement_label TEXT NOT NULL,
    revision TEXT NOT NULL,
    queued_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`).run()
}

async function ensureAgreementEmailEventsTable(c: Context): Promise<void> {
  await c.env.RENT.prepare(`CREATE TABLE IF NOT EXISTS email_events (
    id TEXT PRIMARY KEY NOT NULL, event_type TEXT NOT NULL, recipient TEXT NOT NULL,
    order_id TEXT, template_id TEXT, idempotency_key TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL, provider_message_id TEXT, error_message TEXT, sent_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    subject TEXT, text_body TEXT, html_body TEXT,
    retry_count INTEGER NOT NULL DEFAULT 0, max_attempts INTEGER NOT NULL DEFAULT 3, last_attempt_at TEXT
  )`).run()
}

function normalizeCustomerName(value: unknown): string {
  const name = String(value || '').trim().replace(/\s+/g, ' ')
  return name.replace(/([\p{Script=Han}])\s+(?=[\p{Script=Han}])/gu, '$1')
}

export function buildNotificationOrderDetailUrl(baseUrl: string, orderId: unknown, recipientRole: unknown): string {
  const id = String(orderId || '').trim()
  if (!id) return ''
  const path = STAFF_ROLES.has(String(recipientRole || '').toUpperCase()) ? '/admin/orders/' : '/customer/orders/'
  return new URL(`${path}${encodeURIComponent(id)}`, baseUrl).toString()
}

function normalizeAgreementUpdateTemplate(value: string): string {
  return value
    .replace(/请登录后查看最新版本/g, '请查看通知详情中的最新版本')
    .replace(/请打开通知详情查看最新版本/g, '请查看通知详情中的最新版本')
}

// 保存协议时只排队，不创建客户通知，也不调用外部邮件服务。
// 同一协议在下一次定时任务前重复保存只保留一项；不同协议会在发送时合并成一条通知。
export async function enqueueAgreementUpdate(c: Context, changedAgreements: Array<[string, string]>, changedContent = ''): Promise<void> {
  const changes = new Map<string, string>()
  for (const [key, label] of changedAgreements) {
    if (key && label) changes.set(key, label)
  }
  if (!changes.size) return
  await ensureAgreementUpdateQueueTable(c)
  const revisions = await Promise.all([...changes].map(async ([key, label]) => {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${key}\n${label}\n${changedContent}`))
    return [key, label, Array.from(new Uint8Array(digest)).map(value => value.toString(16).padStart(2, '0')).join('')] as const
  }))
  await c.env.RENT.batch(revisions.map(([key, label, revision]) => c.env.RENT.prepare(`
    INSERT INTO agreement_update_queue (agreement_key, agreement_label, revision)
    VALUES (?, ?, ?)
    ON CONFLICT(agreement_key) DO UPDATE SET
      agreement_label = excluded.agreement_label,
      revision = excluded.revision,
      queued_at = CURRENT_TIMESTAMP
  `).bind(key, label, revision)))
}

// 定时任务统一创建协议更新通知和邮件事件。返回本次处理的客户数。
export async function deliverPendingAgreementNotifications(c: Context): Promise<number> {
  await ensureAgreementUpdateQueueTable(c)
  const rows = (((await c.env.RENT.prepare('SELECT agreement_key, agreement_label, revision, queued_at FROM agreement_update_queue ORDER BY queued_at, agreement_key').all()) as any).results || []) as any[]
  if (!rows.length) return 0

  const names = rows.map((row) => String(row.agreement_label)).join('、')
  const batchKey = rows.map((row) => `${row.agreement_key}:${row.revision}`).join('|')
  const dedupeKey = `agreement_update:${batchKey}`
  const companyRow = await c.env.RENT.prepare("SELECT value FROM systemSettings WHERE key = 'companyDetails' AND deleted_at IS NULL").first() as any
  const storedCompanyDetails = safeJsonParse<any>(companyRow?.value) || {}
  const companyDetails = { ...getSystemSettings().companyDetails, ...storedCompanyDetails }
  const companyName = String(companyDetails?.name || '')
  const companyEmail = String(companyDetails?.email || '')

  await c.env.RENT.prepare('CREATE TABLE IF NOT EXISTS email_templates (id TEXT PRIMARY KEY, name TEXT NOT NULL, subject TEXT NOT NULL, body TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)').run()
  await ensureAgreementEmailEventsTable(c)
  const template = await c.env.RENT.prepare("SELECT subject, body, enabled FROM email_templates WHERE id = 'agreement_update'").first() as any
  const disabled = template?.enabled === 0
  const fallbackMessage = '我们已更新《{changed_agreements}》，最新版本已在我们的网站相关页面公布。继续使用我们的服务，即表示您接受更新后的条款。'
  const subjectTpl = disabled ? '{changed_agreements}更新通知' : String(template?.subject || '{changed_agreements}更新通知')
  const bodyTpl = disabled ? fallbackMessage : normalizeAgreementUpdateTemplate(String(template?.body || fallbackMessage))
  const fillStatic = (value: string) => value
    .replace(/\{changed_agreements\}/g, names)
    .replace(/\{company_name\}/g, companyName)
    .replace(/\{company_email\}/g, companyEmail)
  const subjectStatic = fillStatic(subjectTpl)
  const bodyStatic = fillStatic(bodyTpl)
  const fillCustomer = (value: string, customer: any) => value
    .replace(/\{customer_name\}/g, normalizeCustomerName(customer?.name))
    .replace(/\{customer_email\}/g, String(customer?.email || ''))

  // Site notification detail carries the full notice text (the list/drawer show a
  // short computed summary instead, see notificationListMessage in src/index.ts).
  // Kept independent of the configurable email template so an old saved template
  // can't leave a signed-in customer with confusing wording in the site notification.
  const siteMessageStatic = `<p>尊敬的 {customer_name}：</p><p>您好！</p><p>我们已更新《${names}》，最新版本已在我们的网站相关页面公布。</p><p>继续使用我们的服务，即表示您接受更新后的条款。如您不同意相关更新，请停止使用相关服务，并联系我们处理后续事宜。</p><p>感谢您的理解与支持！</p><p><strong>${companyName}</strong><br>${companyEmail}</p>`

  await ensureNotificationsTable(c)
  const recipients = ((await c.env.RENT.prepare("SELECT id, name, email FROM users WHERE role = 'CUSTOMER' AND status = 'active'").all()) as any).results || []
  for (let i = 0; i < recipients.length; i += 50) {
    const chunk = recipients.slice(i, i + 50)
    await c.env.RENT.batch(chunk.map((customer: any) => c.env.RENT.prepare(
      'INSERT OR IGNORE INTO notifications (id, recipient_id, type, title, message, dedupe_key) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(
      `nt-${crypto.randomUUID()}`,
      customer.id,
      'agreement_update',
      fillCustomer(subjectStatic, customer),
      fillCustomer(siteMessageStatic, customer),
      dedupeKey,
    )))
  }

  const queued = recipients.filter((customer: any) => {
    const email = String(customer?.email || '')
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && !email.endsWith('@invalid.local')
  })
  for (let i = 0; i < queued.length; i += 50) {
    const chunk = queued.slice(i, i + 50)
    await c.env.RENT.batch(chunk.map((customer: any) => {
      const subject = fillCustomer(subjectStatic, customer)
      const message = fillCustomer(bodyStatic, customer)
      const html = renderEmailNotificationHtml(subject, message, companyName)
      return c.env.RENT.prepare("INSERT OR IGNORE INTO email_events (id, event_type, recipient, template_id, idempotency_key, status, subject, text_body, html_body) VALUES (?, 'AGREEMENT_UPDATE', ?, 'agreement_update_batch', ?, 'PENDING', ?, ?, ?)")
        .bind(`email-${crypto.randomUUID()}`, customer.email, `${dedupeKey}:${customer.email}`, subject, sanitizePlainText(message, 20000), html)
    }))
  }

  // 先完成站内信与邮件事件，再删除本批队列；保存期间新 revision 的行会被保留到下一批。
  await c.env.RENT.batch(rows.map((row) => c.env.RENT.prepare('DELETE FROM agreement_update_queue WHERE agreement_key = ? AND revision = ?').bind(row.agreement_key, row.revision)))
  return queued.length
}

export async function createNotification(c: Context, notification: { recipientId: string; type: string; title: string; message: string; titleEn?: string; messageEn?: string; orderId?: string; senderId?: string; expiresAt?: string | null; dedupeKey?: string | null; notifyByEmail?: boolean }): Promise<boolean> {
  await ensureNotificationsTable(c)
  const id = `nt-${crypto.randomUUID()}`
  const result = await c.env.RENT.prepare('INSERT OR IGNORE INTO notifications (id, recipient_id, type, title, message, order_id, sender_id, expires_at, dedupe_key, title_en, message_en) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(id, notification.recipientId, notification.type, notification.title, notification.message, notification.orderId || null, notification.senderId || null, notification.expiresAt || null, notification.dedupeKey || null, notification.titleEn || null, notification.messageEn || null).run() as any
  const inserted = Number(result.meta?.changes ?? result.changes ?? 0) > 0

  // 员工/管理员收到的通知同步广播到已启用的推送渠道；尽力而为，绝不影响站内信。
  try {
    if (await isStaffRecipient(c, notification.recipientId)) {
      const url = notification.orderId ? new URL(`/admin/orders/${notification.orderId}`, c.req.url).toString() : undefined
      await dispatchChannelAlert(c, { title: notification.title, message: notification.message, url })
    }
  } catch (error: any) {
    console.error('dispatchChannelAlert failed:', error?.message || error)
  }

  // 补发邮件：尽力而为，绝不影响站内信；重复通知（dedupe 命中）不重复发信。
  const defaultDelivery = getSystemSettings().notificationSettings?.defaultDelivery || 'in_app_email'
  const notifyByEmail = notification.notifyByEmail ?? defaultDelivery === 'in_app_email'
  if (inserted && notifyByEmail && (notification.type === 'manual' || Boolean(BUSINESS_NOTIFICATION_TEMPLATE_IDS[notification.type]) || CUSTOMER_AUTOMATIC_EMAIL_TYPES.has(notification.type))) {
    try { await sendNotificationEmail(c, notification) }
    catch (error: any) { console.error('sendNotificationEmail failed:', error?.message || error) }
  }
  return inserted
}

type PaymentEmailContext = {
  customer: any
  email: string
  device: any
  companyDetails: any
  vars: Record<string, string>
  fill: (value: string) => string
}

export type TaxInvoiceDocument = {
  invoice: any
  invoiceVars: Record<string, string>
  documentNumber: string
  pdf: Uint8Array
}

async function getPaymentEmailContext(c: Context, order: any, contract?: { contractNumber?: string } | null): Promise<PaymentEmailContext | null> {
  const customer = await c.env.RENT.prepare('SELECT name, email, phone FROM users WHERE id = ?').bind(order.userId).first() as any
  const email = String(customer?.email || '').trim()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.endsWith('@invalid.local')) return null
  const device = order.deviceId ? await c.env.RENT.prepare('SELECT name FROM devices WHERE id = ?').bind(order.deviceId).first() as any : null
  const companyDetails = getSystemSettings().companyDetails || ({} as any)
  const vars: Record<string, string> = {
    customer_name: normalizeCustomerName(customer?.name),
    customer_email: email,
    order_number: String(order.orderNo || order.id),
    contract_number: String(contract?.contractNumber || ''),
    device_name: String(device?.name || ''),
    start_date: String(order.startDate || ''),
    end_date: String(order.endDate || ''),
    rental_period: order.rentalPeriod ? `${order.rentalPeriod} 天` : '',
    pickup_time: orderTimeSlot(order, 'pickup'),
    return_time: orderTimeSlot(order, 'return'),
    delivery_fee: orderDeliveryFee(order),
    total_amount: `AUD ${Number(order.totalAmount || 0).toFixed(2)}`,
    deposit_amount: `AUD ${Number(order.depositAmount || 0).toFixed(2)}`,
    order_detail_url: buildNotificationOrderDetailUrl(c.req.url, order.id, 'CUSTOMER'),
    company_name: String(companyDetails.name || ''),
    company_email: String(companyDetails.email || ''),
  }
  const fill = (value: string) => value.replace(/\{([a-z_]+)\}/g, (_: string, key: string) => vars[key] ?? '')
  return { customer, email, device, companyDetails, vars, fill }
}

export async function buildTaxInvoiceDocument(c: Context, order: any, contract?: { contractNumber?: string } | null): Promise<TaxInvoiceDocument | null> {
  return buildFinancialDocument(c, order, contract, 'tax-invoice')
}

export async function buildPaymentReceiptDocument(c: Context, order: any, contract?: { contractNumber?: string } | null): Promise<TaxInvoiceDocument | null> {
  return buildFinancialDocument(c, order, contract, 'payment-receipt')
}

async function buildFinancialDocument(c: Context, order: any, contract: { contractNumber?: string } | null | undefined, kind: 'tax-invoice' | 'payment-receipt'): Promise<TaxInvoiceDocument | null> {
  const context = await getPaymentEmailContext(c, order, contract)
  if (!context) return null
  const invoice = await c.env.RENT.prepare("SELECT * FROM invoices WHERE order_id = ? AND type = 'invoice' ORDER BY issued_at DESC LIMIT 1").bind(order.id).first() as any
  if (!invoice) return null
  const payment = await c.env.RENT.prepare("SELECT paid_at, payment_method, payment_provider, transaction_id, stripe_payment_intent_id FROM payments WHERE rental_id = ? AND status = 'paid' ORDER BY paid_at DESC LIMIT 1").bind(order.id).first() as any
  if (kind === 'payment-receipt' && !payment) return null
  const documentNumber = kind === 'payment-receipt'
    ? String(invoice.receipt_number || invoice.invoice_number || order.orderNo || order.id)
    : String(invoice.invoice_number || invoice.receipt_number || order.orderNo || order.id)
  const template = kind === 'payment-receipt'
    ? {
      ...DEFAULT_RECEIPT_PDF_TEMPLATE,
      title: 'PAYMENT RECEIPT',
      documentNumberLabel: 'RECEIPT NO.',
      invoiceMessage: 'Payment received for your rental order.',
      thankYouText: 'Thank you for your payment.',
      recordNote: 'Please keep this payment receipt for your records.',
    }
    : getSystemSettings().taxInvoiceTemplate
  const pdf = buildReceiptPdf({
    companyName: String(context.companyDetails.name || 'PC Rental'),
    companyAbn: String(context.companyDetails.abn || ''),
    companyEmail: String(context.companyDetails.email || ''),
    companyPhone: String(context.companyDetails.phone || ''),
    companyAddress: String(context.companyDetails.address || ''),
    customerName: String(context.customer?.name || ''),
    customerEmail: context.email,
    customerPhone: String(context.customer?.phone || ''),
    customerAddress: String(safeJsonParse<any>((contract as any)?.contract_data)?.customer_address || order.deliveryAddress || ''),
    orderNumber: String(order.orderNo || order.id),
    contractNumber: String(contract?.contractNumber || ''),
    documentNumber,
    invoiceNumber: String(invoice.invoice_number || ''),
    issuedAt: String(invoice.issued_at || ''),
    paidAt: String(payment?.paid_at || ''),
    paymentStatus: payment ? undefined : order.deposit_payment_mode === 'PREAUTH' && ['HELD', 'REFUND_PENDING'].includes(String(order.deposit_status)) ? 'Authorized' : 'Unpaid',
    paymentMethod: payment?.payment_provider === 'square' ? 'Gift card' : String(payment?.payment_method || order.paymentMethod || ''),
    transactionId: String(payment?.transaction_id || payment?.stripe_payment_intent_id || ''),
    deviceName: String(context.device?.name || order.deviceName || 'Rental device'),
    startDate: String(order.startDate || ''),
    endDate: String(order.endDate || ''),
    rentalPeriod: Number(order.rentalPeriod || 0),
    subtotal: Number(invoice.subtotal || 0),
    gstAmount: Number(invoice.gst_amount || 0),
    depositAmount: Number(invoice.deposit_amount || 0),
    processingFee: Number(invoice.processing_fee || 0),
    discountAmount: Math.max(0, Number(order.discountAmount || order.discount_amount || 0)),
    totalAmount: Number(invoice.total_amount || order.totalAmount || 0),
    currency: String(invoice.currency || 'AUD'),
    documentId: String(invoice.id || ''),
    template,
  })
  return {
    invoice,
    invoiceVars: { ...context.vars, invoice_number: String(invoice.invoice_number || ''), receipt_number: String(invoice.receipt_number || '') },
    documentNumber,
    pdf,
  }
}

function taxInvoiceAttachment(document: TaxInvoiceDocument): EmailAttachment {
  return { filename: `tax-invoice-${document.documentNumber}.pdf`, content: bytesToBase64(document.pdf), contentType: 'application/pdf' }
}

function paymentReceiptAttachment(document: TaxInvoiceDocument): EmailAttachment {
  return { filename: `payment-receipt-${document.documentNumber}.pdf`, content: bytesToBase64(document.pdf), contentType: 'application/pdf' }
}

// 「付款成功」邮件：套用后台可编辑的 payment_completed 模板，并附加独立的付款收据 PDF。
export async function sendPaymentCompletedEmail(c: Context, order: any, contract?: { contractNumber?: string } | null): Promise<void> {
  const { apiKey, from } = await resolveEmailCredentials(c)
  if (!apiKey || !from) return
  const context = await getPaymentEmailContext(c, order, contract)
  if (!context) return
  const template = await c.env.RENT.prepare("SELECT subject, body, enabled, theme_color FROM email_templates WHERE id = 'payment_completed'").first() as any
  if (!template || template.enabled === 0) return
  const subject = context.fill(String(template.subject || '付款成功 - {order_number}'))
  const html = renderEmailNotificationHtml(subject, context.fill(String(template.body || '')), context.vars.company_name, template.theme_color || '#f0a35b')
  let attachments: EmailAttachment[] = []
  try {
    const document = await buildPaymentReceiptDocument(c, order, contract)
    if (document) attachments = [paymentReceiptAttachment(document)]
  } catch (error: any) {
    console.error('Payment receipt PDF generation failed:', error?.message || error)
  }
  await sendTransactionalEmail(c, { to: context.email, subject, text: sanitizePlainText(`您好 ${context.vars.customer_name}：您的订单 ${context.vars.order_number} 已完成付款。`, 2000), html, attachments })
}

// 用户或管理员主动点击「邮件发送」时，使用独立的 tax_invoice_issued 模板发送 A4 PDF。
export async function sendTaxInvoiceEmail(c: Context, order: any, contract?: { contractNumber?: string } | null): Promise<void> {
  const { apiKey, from } = await resolveEmailCredentials(c)
  if (!apiKey || !from) return
  const context = await getPaymentEmailContext(c, order, contract)
  if (!context) return
  await ensureTaxInvoiceEmailTemplate(c)
  const template = await c.env.RENT.prepare('SELECT subject, body, enabled, theme_color FROM email_templates WHERE id = ?').bind(TAX_INVOICE_TEMPLATE_ID).first() as any
  if (!template || template.enabled === 0) return

  let document: TaxInvoiceDocument | null = null
  try {
    document = await buildTaxInvoiceDocument(c, order, contract)
  } catch (error: any) {
    console.error('Tax invoice PDF generation failed:', error?.message || error)
    return
  }

  if (!document) return
  const invoiceVars = document.invoiceVars
  const fill = (value: string) => value.replace(/\{([a-z_]+)\}/g, (_: string, key: string) => invoiceVars[key] ?? '')
  const subject = fill(String(template.subject || TAX_INVOICE_TEMPLATE_SUBJECT))
  const html = renderEmailNotificationHtml(subject, fill(String(template.body || TAX_INVOICE_TEMPLATE_BODY)), invoiceVars.company_name, template.theme_color || '#f0a35b')
  const text = `Hello ${invoiceVars.customer_name}: your tax invoice ${invoiceVars.invoice_number || invoiceVars.order_number} for order ${invoiceVars.order_number} is attached.`
  await sendTransactionalEmail(c, {
    to: context.email,
    subject,
    text: sanitizePlainText(text, 2000),
    html,
    attachments: [taxInvoiceAttachment(document)],
  })
}

export async function deleteRentalApplicationNotifications(c: Context, orderId: string): Promise<void> {
  await ensureNotificationsTable(c)
  await c.env.RENT.prepare("UPDATE notifications SET deleted_at = CURRENT_TIMESTAMP WHERE order_id = ? AND type = 'rental_application' AND deleted_at IS NULL").bind(orderId).run()
}

export async function cleanupCompletedRentalApplicationNotifications(c: Context, recipientId?: string): Promise<void> {
  await ensureNotificationsTable(c)
  const recipientFilter = recipientId ? ' AND recipient_id = ?' : ''
  const bindings = recipientId ? [recipientId] : []
  await c.env.RENT.prepare(`UPDATE notifications SET deleted_at = CURRENT_TIMESTAMP WHERE type = 'rental_application' AND deleted_at IS NULL${recipientFilter} AND EXISTS (SELECT 1 FROM orders WHERE orders.id = notifications.order_id AND orders.status <> 'pending_approval')`).bind(...bindings).run()
}

export async function cleanupCompletedPaymentReviewNotifications(c: Context, recipientId?: string): Promise<void> {
  await ensureNotificationsTable(c)
  const recipientFilter = recipientId ? ' AND recipient_id = ?' : ''
  await c.env.RENT.prepare(`UPDATE notifications SET deleted_at = CURRENT_TIMESTAMP
    WHERE type IN ('payment_review_submitted', 'payment_review_overdue') AND deleted_at IS NULL${recipientFilter}
      AND order_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM payment_proofs pp JOIN payments p ON p.id = pp.payment_id
        WHERE p.rental_id = notifications.order_id AND pp.status = 'submitted'
      )`).bind(...(recipientId ? [recipientId] : [])).run()
}

export async function getNotifications(c: Context, recipientId: string): Promise<any[]> {
  await ensureNotificationsTable(c)
  await cleanupCompletedRentalApplicationNotifications(c, recipientId)
  await cleanupCompletedPaymentReviewNotifications(c, recipientId)
  const result = await c.env.RENT.prepare("SELECT * FROM notifications WHERE recipient_id = ? AND deleted_at IS NULL AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP) AND NOT (type = 'agreement_update' AND EXISTS (SELECT 1 FROM notifications newer WHERE newer.recipient_id = notifications.recipient_id AND newer.type = notifications.type AND newer.title = notifications.title AND newer.message = notifications.message AND (newer.created_at > notifications.created_at OR (newer.created_at = notifications.created_at AND newer.rowid > notifications.rowid)))) ORDER BY created_at DESC LIMIT 100").bind(recipientId).all()
  return result.results || []
}

export async function createDueDateNotifications(c: Context): Promise<number> {
  await ensureNotificationsTable(c)
  const today = new Date()
  const notices = [
    { days: 3, type: 'due_soon_3d', title: '租赁即将到期', text: '您的设备租赁将在 3 天后到期，请提前安排归还或联系工作人员续租。' },
    { days: 0, type: 'due_today', title: '租赁今日到期', text: '您的设备租赁今天到期，请尽快归还设备并等待验机。' },
  ]
  let created = 0
  for (const notice of notices) {
    const due = new Date(today)
    due.setUTCDate(due.getUTCDate() + notice.days)
    const date = due.toISOString().slice(0, 10)
    const rows = await c.env.RENT.prepare(`
      SELECT o.id, o.orderNo, o.userId, o.endDate, u.name
      FROM orders o JOIN users u ON u.id = o.userId
      WHERE o.endDate = ? AND o.status IN ('paid', 'active') AND u.role = 'CUSTOMER'
        AND NOT EXISTS (SELECT 1 FROM notifications n WHERE n.recipient_id = o.userId AND n.order_id = o.id AND n.type = ?)
    `).bind(date, notice.type).all()
    for (const order of (rows.results || []) as any[]) {
      const inserted = await createNotification(c, {
        recipientId: order.userId,
        type: notice.type,
        title: notice.title,
        message: `${notice.text} 订单：${order.orderNo || order.id}。`,
        orderId: order.id,
        notifyByEmail: true,
      })
      if (inserted) created++
    }
  }
  const melbourneToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Melbourne', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  const pickupRows = await c.env.RENT.prepare(`
    SELECT o.id, o.orderNo, o.userId, o.startDate, o.pickupLocation, d.name AS device_name
    FROM orders o JOIN users u ON u.id = o.userId LEFT JOIN devices d ON d.id = o.deviceId
    WHERE o.startDate = ? AND o.status IN ('paid', 'pending_pickup') AND u.role = 'CUSTOMER'
      AND NOT EXISTS (SELECT 1 FROM notifications n WHERE n.recipient_id = o.userId AND n.order_id = o.id AND n.type = 'pickup_reminder')
  `).bind(melbourneToday).all()
  for (const order of (pickupRows.results || []) as any[]) {
    const inserted = await createNotification(c, {
      recipientId: order.userId,
      type: 'pickup_reminder',
      title: '今日取货提醒',
      message: `您的订单 ${order.orderNo || order.id} 今天可以取货，请到店后出示邮件中的取货二维码。`,
      orderId: order.id,
      dedupeKey: `pickup-reminder:${order.id}:${melbourneToday}`,
      notifyByEmail: true,
    })
    if (inserted) created++
  }
  return created
}

// 投递 notifyAgreementUpdate 排入 email_events 队列的协议更新邮件。
// 由 cron 触发，每次只处理一小批，避免一次调用里对外发起过多子请求；
// 失败的行会在下一次 tick 自动重试，直到 max_attempts。
export async function deliverPendingAgreementEmails(c: Context): Promise<number> {
  const { apiKey, from } = await resolveEmailCredentials(c)
  if (!apiKey || !from) return 0
  const rows = (((await c.env.RENT.prepare(
    "SELECT id, recipient, subject, text_body, html_body FROM email_events WHERE event_type = 'AGREEMENT_UPDATE' AND template_id = 'agreement_update_batch' AND ((status IN ('PENDING', 'FAILED') AND retry_count < max_attempts) OR (status = 'SENDING' AND retry_count < max_attempts AND last_attempt_at <= datetime('now', '-15 minutes'))) ORDER BY created_at LIMIT 90"
  ).all()) as any).results || []) as any[]
  let sent = 0
  for (const row of rows) {
    // Claim before the external request. Cron retries/overlapping invocations
    // must never send the same event twice just because its old read status or
    // a previous invocation has not been written back yet.
    const claimed = await c.env.RENT.prepare(
      "UPDATE email_events SET status = 'SENDING', retry_count = retry_count + 1, last_attempt_at = CURRENT_TIMESTAMP WHERE id = ? AND ((status IN ('PENDING', 'FAILED') AND retry_count < max_attempts) OR (status = 'SENDING' AND retry_count < max_attempts AND last_attempt_at <= datetime('now', '-15 minutes')))"
    ).bind(row.id).run() as any
    const claimChanges = Number(claimed.meta?.changes ?? claimed.changes ?? 0)
    if (claimChanges !== 1) continue
    const result = await sendTransactionalEmail(c, { to: row.recipient, subject: row.subject, text: row.text_body, html: row.html_body || undefined })
    await c.env.RENT.prepare(
      "UPDATE email_events SET status = ?, provider_message_id = ?, error_message = ?, sent_at = CASE WHEN ? THEN CURRENT_TIMESTAMP END WHERE id = ? AND status = 'SENDING'"
    ).bind(result.ok ? 'SENT' : 'FAILED', result.id, result.error?.slice(0, 500) ?? null, result.ok ? 1 : 0, row.id).run()
    if (result.ok) sent += 1
  }
  return sent
}

// 协议更新只使用一个调度入口：先把窗口内的变更生成站内信和邮件事件，
// 再在同一个任务中投递邮件，避免两个独立定时任务重复处理同一批数据。
export async function deliverPendingAgreementUpdates(c: Context): Promise<{ queuedRecipients: number; sentEmails: number }> {
  const queuedRecipients = await deliverPendingAgreementNotifications(c)
  const sentEmails = await deliverPendingAgreementEmails(c)
  return { queuedRecipients, sentEmails }
}

export async function notifyOverduePaymentProofs(c: Context): Promise<number> {
  await c.env.RENT.prepare('ALTER TABLE payment_proofs ADD COLUMN admin_notified_at TEXT').run().catch(() => undefined)
  await ensureNotificationsTable(c)
  const proofs = await c.env.RENT.prepare(`
    SELECT pp.id, pp.payment_id, pp.uploaded_at, o.id AS order_id, o.orderNo, o.totalAmount,
           p.payment_method, u.name AS customer_name
    FROM payment_proofs pp
    JOIN payments p ON p.id = pp.payment_id
    JOIN orders o ON o.id = p.rental_id
    LEFT JOIN users u ON u.id = o.userId
    WHERE pp.status = 'submitted'
      AND pp.admin_notified_at IS NULL
      AND pp.uploaded_at <= datetime('now', '-1 hour')
      AND p.payment_method IN ('bank_transfer', 'alipay', 'wechat')
      AND o.status = 'pending_payment'
    ORDER BY pp.uploaded_at ASC
    LIMIT 100
  `).all() as any
  if (!(proofs.results || []).length) return 0
  const admins = (await c.env.RENT.prepare("SELECT id, email, name FROM users WHERE role = 'ADMIN' AND status = 'active'").all() as any).results || []
  if (!admins.length) return 0
  const { apiKey, from } = await resolveEmailCredentials(c)
  let notified = 0
  for (const proof of proofs.results as any[]) {
    const method = proof.payment_method === 'alipay' ? '支付宝' : proof.payment_method === 'wechat' ? '微信' : '银行转账'
    const orderLabel = proof.orderNo || proof.order_id
    const title = `${method}付款待审核超过 1 小时`
    const message = `订单 ${orderLabel} 的${method}付款凭证已提交超过 1 小时，客户：${proof.customer_name || '未填写'}，金额：AUD ${Number(proof.totalAmount || 0).toFixed(2)}。请尽快审核。`
    await Promise.all(admins.map((admin: any) => createNotification(c, { recipientId: admin.id, type: 'payment_review_overdue', title, message, orderId: proof.order_id, notifyByEmail: false })))
    if (apiKey && from) {
      const html = renderEmailNotificationHtml(title, `<p>${message}</p><p><a href="${new URL(`/admin/orders/${proof.order_id}`, c.req.url).toString()}">打开订单审核</a></p>`, getSystemSettings().companyDetails.name)
      const recipients = admins.map((admin: any) => admin.email).filter((email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      if (recipients.length) await sendTransactionalEmail(c, { to: recipients, subject: title, text: message, html })
    }
    await c.env.RENT.prepare('UPDATE payment_proofs SET admin_notified_at = CURRENT_TIMESTAMP WHERE id = ? AND admin_notified_at IS NULL').bind(proof.id).run()
    notified += 1
  }
  return notified
}

export async function notifyOverdueBankTransferRefunds(c: Context): Promise<number> {
  await c.env.RENT.prepare('ALTER TABLE payment_refunds ADD COLUMN admin_notified_at TEXT').run().catch(() => undefined)
  await ensureNotificationsTable(c)
  const refunds = await c.env.RENT.prepare(`
    SELECT pr.id, pr.type, pr.refund_amount, pr.refunded_processing_fee, pr.created_at, o.id AS order_id, o.orderNo
    FROM payment_refunds pr
    JOIN orders o ON o.id = pr.order_id
    WHERE pr.status = 'pending'
      AND pr.refund_method = 'bank_transfer'
      AND pr.admin_notified_at IS NULL
      AND pr.created_at <= datetime('now', '-1 day')
    ORDER BY pr.created_at ASC
    LIMIT 100
  `).all() as any
  if (!(refunds.results || []).length) return 0
  const admins = (await c.env.RENT.prepare("SELECT id, email, name FROM users WHERE role = 'ADMIN' AND status = 'active'").all() as any).results || []
  if (!admins.length) return 0
  const { apiKey, from } = await resolveEmailCredentials(c)
  const typeLabel: Record<string, string> = { deposit: '押金', cancellation: '取消订单', early_return: '提前归还' }
  let notified = 0
  for (const refund of refunds.results as any[]) {
    const amount = Number(refund.refund_amount || 0) + Number(refund.refunded_processing_fee || 0)
    const orderLabel = refund.orderNo || refund.order_id
    const title = '银行转账退款超过 1 天未完成'
    const message = `订单 ${orderLabel} 的${typeLabel[refund.type] || refund.type}退款 AUD ${amount.toFixed(2)} 已提交银行转账退款超过 1 天仍未完成，请尽快转账并在后台点击"确认已转账"。`
    await Promise.all(admins.map((admin: any) => createNotification(c, { recipientId: admin.id, type: 'refund_bank_transfer_overdue', title, message, orderId: refund.order_id })))
    if (apiKey && from) {
      const html = renderEmailNotificationHtml(title, `<p>${message}</p><p><a href="${new URL(`/admin/orders/${refund.order_id}`, c.req.url).toString()}">打开订单处理</a></p>`, getSystemSettings().companyDetails.name)
      const recipients = admins.map((admin: any) => admin.email).filter((email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      if (recipients.length) await sendTransactionalEmail(c, { to: recipients, subject: title, text: message, html })
    }
    await c.env.RENT.prepare('UPDATE payment_refunds SET admin_notified_at = CURRENT_TIMESTAMP WHERE id = ? AND admin_notified_at IS NULL').bind(refund.id).run()
    notified += 1
  }
  return notified
}
