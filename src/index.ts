/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

// @ts-nocheck
import { riskDepositSnapshot, riskAdjustedDeposit, calculateCustomerRiskAssessment } from './domain/riskFlags'
import { getTranslationConfigSummary } from './translationConfig'
import { handleTranslation } from './services/translation'
import { ensureBankTransferReference, listBankTransferPayments } from './services/bankTransferReferences'
import { TRANSLATION_CLIENT_SCRIPT } from './lib/translationClient'
import { Hono } from 'hono'
import { createNotificationWithDelivery } from './services/notifications'
import { runRentalPayouts } from './services/rentalPayouts'
import { rentalPickupBlocks,rentalPickupBlocked } from './services/rentalPickup'
import { normalizeClientAccess, readClientAccess, clientFeatureForPath, consoleEssentialPath, clientMaintenanceHtml } from './clientAccess'
import { websiteSessionStatus } from './auth/websiteSession'
import * as pages from './pages/index'
import * as actions from './actions/index'
import { sendPasswordResetEmail } from './auth/passwordReset'
import { expireRentalLinkDrafts } from './services/rentalLinks'
import { resolveRentalApplicationConflicts, RENTAL_APPLICATION_CONFLICT_MESSAGE } from './services/rentalApplications'
import { HALF_HOUR_TIME_OPTIONS,pickupTimeMode,serviceFeeRate, isUnavailablePickupTime } from './domain/pickupTimeSlots'
import { searchBusinessDocuments, documentPath, documentStatus, DOCUMENT_TYPES } from './services/documents'
import { isCardDepositSettled } from './domain/paymentPlan'
import { scheduledBatches } from './domain/scheduledBatches'
import { readAnnouncementForm, renderAnnouncementContent, renderAnnouncementTitle, renderAnnouncementMessage } from './domain/announcement'
import { renderAnnouncementEditor } from './pages/partials/announcementEditor'
import { escapeHtml } from './lib/html'
import {
  renderNotFound,
  renderForbidden,
  renderServerError,
  renderUnauthorized,
  renderBadGateway,
  renderServiceUnavailable
} from './pages/public/notFound'
import {
  verifyUserCredentials,
  findUserBySession,
  getDeviceById,
  getDeviceRentalRules,
  updateUser,
  verifyPassword,
  insertUser,
  insertDevice,
  updateDevice,
  deleteDevice,
  getOrdersAsync,
  getOrdersForUser,
  getDevicesAsync,
  getStaffDashboardData,
  hashPassword,
  findUserByEmail,
  findUserByReferralCode,
  getUserById,
  createWithdrawalRequest,
  generateReferralCode,
  getOrderById,
  getOrderByOrderNo,
  staffOrderPath,
  insertOrder,
  updateOrderStatus,
  hasDeviceBookingConflict,
  orderChangeSnapshot,
  buildOrderChangePlan,
  canTransitionOrder,
  canTransitionDeviceCommand,
  DEVICE_COMMAND_TERMINAL_STATES,
  isHighRiskDeviceCommand,
  canTransitionPaymentDispute,
  PAYMENT_DISPUTE_STATES,
  RISK_FLAG_TYPES,
  getCustomerRiskAssessment,
  timingSafeEqualStr,
  collectMonitoringMetrics,
  getMonitoringHistory,
  recentErrorLogCount,
  canTransitionDeviceLifecycle,
  MAINTENANCE_CHECK_TYPES,
  validateHostedImageUrls,
  enforceRateLimit,
  sanitizeRichHtml,
  renderSiteVariables,
  neutralizeTemplateTokens,
  renderContractVariables,
  updateDeviceStatus,
  recordDeviceLifecycle,
  releaseDeviceIfUnbooked,
  getContractById,
  getContractByOrderId,
  isContractFinalized,
  getContractByContractNumber,
  ensureContractForOrder,
  updateContractTemplate,
  CONTRACT_OPERATIONAL_FIELDS,
  CONTRACT_SIGNED_FIELDS,
  issueInvoice,
  updateContractStatusInDB,
  getContractVariableData,
  generateContractNumber,
  ensureOrderNumber,
  generateReferenceNumber,
  createAuthSession,
  revokeAllSessions,
  releaseReferralRewardNow,
  revokeReferralRewardForOrder,
  deleteAuthSession,
  buildLayout,
  getSystemSettings,
  loadSystemSettingsFromDB,
  invalidateSystemSettingsCache,
  updateSystemSettings,
  combinePersonName,
  isStrongPassword,
  generateUniqueUserId,
  generateTemporaryPassword,
  isContractExpired,
  getUsers,
  getAccessLevel
  , createNotification
  , getNotifications
  , deleteRentalApplicationNotifications
  , cleanupCompletedRentalApplicationNotifications
  , cleanupCompletedPaymentReviewNotifications
  , createDueDateNotifications
  , sanitizePlainText
  , renderNotificationMarkdown
  , renderFlexibleContent
  , renderEmailNotificationHtml
  , renderMarketingEmailHtml
  , ensureNotificationsTable
  , getContractBySignToken
  , enqueueRentalUserDeletion
  , recordExternalRentalFlow
  , lockReferralRelationship
  , createAuditLog
  , formatMelbourneDateTime
  , logError
} from './site'
import type { SystemSettingsKey } from './site'
import { nanoid } from 'nanoid'
import { getStripeConfigSummary } from './stripe'
import { getSquareConfigSummary } from './square'
import { getTurnstileConfigSummary, getTurnstileRuntimeConfig, getTurnstileSiteKey } from './turnstile'
import { getDeliveryConfigSummary } from './deliveryConfig'
import { getNotifyChannelsSummary, saveNotifyChannels, resolveEmailCredentials, sendTransactionalEmail, dispatchChannelAlert } from './notifyChannels'
import { getEmailConfigSummary } from './emailConfig'
import { ensureInAppNotificationTemplates } from './services/inAppNotificationTemplates'
import { notifyAgreementUpdate } from './actions/admin/saveSettings'
import { rentalPricingSnapshot } from './domain/monthlyRental'
import { chargeDueRentalInstallments } from './services/monthlyRentalPayments'
import { setRentalPaymentPlan } from './services/rentalPaymentPlan'
import { getOrCreateSignSession } from './site'
import { createOrderPaymentIntent, createOrderInstallmentPaymentIntent, createBalanceTopUpIntent, handleStripeWebhook, refundDeposit, executeApprovedDepositSettlement, settleCompletedOrderAuthorization, cancelAndRefund, retryCancellationRefund, ignorePendingRefund, refundUnusedRentalDays, completeBankTransferRefund, createOrderPriceAdjustmentIntent, createOrderPriceAdjustmentTransferPayment, applyOrderPriceAdjustment, applyBalanceOrderPriceIncrease, settleBalancePriceAdjustment, cancelPendingPaymentOrderByCustomer, expireMissedPickupOrders, chargeOverdueReturns } from './actions/stripePayments'
import { getSquareGiftCardConfigForOrder, createSquareGiftCardPayment, completeSquareGiftCardPayment, getSquareGiftCardConfigForBalanceTopUp, createSquareGiftCardBalanceTopUp, getSquareGiftCardConfigForPriceAdjustment, createSquareGiftCardPriceAdjustmentPayment, handleSquareWebhook } from './actions/squarePayments'
import { findEligibleCoupon, calculateCouponDiscount, checkCustomerCouponEligibility, reserveCouponForOrder, releaseCouponForOrder, couponDiscountableBase } from './actions/coupons'
import { calculateRentalFee, parseDeviceDiscountPercent } from './domain/rentalPricing'
import { parseUnavailableDates } from './domain/unavailableDates'
import { computeOrderSettlementStatus } from './domain/orderSettlement'
import { getAudCnyRate, roundCnyUp } from './rmbExchange'
import { monitorOverallStatus, monitorHttpStatus, parseBearerToken, worstHealthLevel } from './domain/monitoring'
import { runConnectivityProbes } from './services/connectivity'
import { createAdminDeliveryBooking } from './services/deliveryAdmin'
import { handleDeliveryStatusEmail } from './services/deliveryNotifications'
import { buildTaxInvoiceDocument, sendTaxInvoiceEmail } from './services/notifications'
import {
  styleSheetText as siteStyles,
  styleSheetByteLength,
  styleSheetVersion,
  appScriptText,
  appScriptVersion,
  languageScriptText,
  languageScriptVersion,
} from './lib/assetVersion'
import { getTableColumns as getCachedTableColumns } from './db/client'
import {
  buildContentSecurityPolicy,
  checkFormFieldLimits,
  maxRequestBodyBytes,
  resolveContentLength,
  sanitizeRedirectPath,
  serializeAuthCookie,
  serializeAuthCookieClear,
} from './lib/security'
import { escapeHtml } from './lib/html'
import { createTallyFeedbackToken } from './lib/tally'
import { renderPickupPreparation } from './pages/partials/pickupPreparation'
import { parsePickupQrPayload } from './lib/pickupQr'
import { pickupTimeSlotEndMinutes } from './domain/pickupTimeSlots'
import { readManualInspectionFields, renderManualInspectionFields, inspectionText } from './lib/inspection'
import { decryptSecret } from './lib/secretBox'
import { migrateLegacyContractSecrets } from './services/secretMigration'
import { getCloudinaryConfigSummary, getCloudinaryRuntimeConfig, uploadCloudinaryImage, uploadCloudinaryImages } from './lib/cloudinary'

function parseFormBody(body: string | null | undefined): Record<string, string> {
  const form: Record<string, string> = {}
  if (!body) return form

  const params = new URLSearchParams(body)
  for (const [key, value] of params.entries()) {
    form[key] = value
  }

  return form
}

function rentalPeriodIndex(date: string, period: string): number {
  return Math.round(Date.parse(`${date}T00:00:00Z`) / 86400000) * 2 + (period === 'PM' ? 1 : 0)
}

function rentalPeriodsOverlap(startDate: string, startPeriod: string, endDate: string, endPeriod: string, otherStartDate: string, otherStartPeriod: string, otherEndDate: string, otherEndPeriod: string): boolean {
  const start = rentalPeriodIndex(startDate, startPeriod)
  const end = rentalPeriodIndex(endDate, endPeriod)
  const otherStart = rentalPeriodIndex(otherStartDate, otherStartPeriod)
  const otherEnd = rentalPeriodIndex(otherEndDate, otherEndPeriod)
  return start < otherEnd && otherStart < end
}

function melbourneMinutesNow(): number {
  const parts = new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Melbourne', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date())
  const hour = Number(parts.find((part) => part.type === 'hour')?.value || 0)
  return (hour === 24 ? 0 : hour) * 60 + Number(parts.find((part) => part.type === 'minute')?.value || 0)
}

function rentalPeriodPassed(date: string, period: string, today: string): boolean {
  return date === today && melbourneMinutesNow() >= (period === 'AM' ? 12 * 60 : 23 * 60)
}

const PICKUP_TIME_SLOTS = new Set(['morning_service', 'morning', 'afternoon', 'evening_service',...HALF_HOUR_TIME_OPTIONS])
const SERVICE_FEE_TIME_SLOTS = new Set(['morning_service', 'evening_service'])

function pickupTimeSlotPeriod(slot: string): 'AM' | 'PM' {
  return slot === 'afternoon' || slot === 'evening_service' || (HALF_HOUR_TIME_OPTIONS.includes(slot) && slot>='12:00') ? 'PM' : 'AM'
}

function pickupTimeSlotPassed(date: string, slot: string, today: string, rentalRules: any): boolean {
  return date === today && melbourneMinutesNow() >= pickupTimeSlotEndMinutes(slot, rentalRules)
}

function isMobileDeviceRequest(c: any): boolean {
  return /android|iphone|ipad|ipod|mobile|webos|iemobile|opera mini/i.test(c.req.header('User-Agent') || '')
}

async function sendLoggedEmail(c: any, input: { eventType: string, recipient: string, key: string, subject: string, text: string, html?: string, orderId?: string, templateId?: string }): Promise<{ ok: boolean }> {
  const claimed = await c.env.RENT.prepare("INSERT OR IGNORE INTO email_events (id, event_type, recipient, order_id, template_id, idempotency_key, status, subject, text_body, html_body, last_attempt_at) VALUES (?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, ?, CURRENT_TIMESTAMP)").bind(`email-${nanoid(12)}`, input.eventType, input.recipient, input.orderId || null, input.templateId || null, input.key, input.subject, input.text, input.html || null).run() as any
  if (!claimed.meta?.changes) return { ok: true }
  const result = await sendTransactionalEmail(c, { to: input.recipient, subject: input.subject, text: input.text, html: input.html })
  await c.env.RENT.prepare("UPDATE email_events SET status = ?, provider_message_id = ?, error_message = ?, retry_count = CASE WHEN ? THEN retry_count ELSE retry_count + 1 END, sent_at = CASE WHEN ? THEN CURRENT_TIMESTAMP END WHERE idempotency_key = ?").bind(result.ok ? 'SENT' : 'FAILED', result.id, result.error, result.ok ? 1 : 0, result.ok ? 1 : 0, input.key).run()
  return { ok: result.ok }
}

async function sendPaymentReviewEmail(c: any, customer: any, subject: string, message: string, orderId: string): Promise<void> {
  const email = String(customer?.email || '').trim()
  const { provider, apiKey, from } = await resolveEmailCredentials(c)
  if ((provider !== 'smtp' && !apiKey) || !from || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return
  try {
    const key = `payment-review:${orderId}:${email}:${subject}`
    const claimed = await c.env.RENT.prepare("INSERT OR IGNORE INTO email_events (id, event_type, recipient, order_id, idempotency_key, status) VALUES (?, 'PAYMENT_REVIEW', ?, ?, ?, 'PENDING')").bind(`email-${nanoid(12)}`, email, orderId, key).run() as any
    if (!claimed.meta?.changes) return
    const html = renderEmailNotificationHtml(subject, `<p>${sanitizePlainText(message, 1000)}</p><p><a href="${new URL(`/customer/orders/${encodeURIComponent(orderId)}`, c.req.url).toString()}">查看订单详情</a></p>`, getSystemSettings().companyDetails.name)
    const result = await sendTransactionalEmail(c, { to: email, subject, text: message, html })
    await c.env.RENT.prepare("UPDATE email_events SET status = ?, provider_message_id = ?, error_message = ?, sent_at = CASE WHEN ? THEN CURRENT_TIMESTAMP END WHERE idempotency_key = ?").bind(result.ok ? 'SENT' : 'FAILED', result.id, result.error, result.ok ? 1 : 0, key).run()
  } catch (error: any) { console.error('Payment review email failed:', error) }
}

async function ensureDeviceCommandTables(db: any): Promise<void> {
  // Schema is deployed exclusively through migrations/0073 and later. Do not
  // grant request handlers DDL privileges or hide a failed deployment by
  // silently creating a weaker legacy schema at request time.
  void db
}

function requestHost(c: any): string {
  return String(c.req.header('Host') || '').split(':')[0].trim().toLowerCase()
}

function isCustomerLoginHost(c: any): boolean {
  return requestHost(c) === 'test-rent.ydnw6zt6vj.workers.dev'
}

function shouldShowTestAccounts(c: any): boolean {
  return String(c.env.SHOW_TEST_ACCOUNTS || '').toLowerCase() === 'true' && isCustomerLoginHost(c)
}

async function getTableColumns(c: any, tableName: string): Promise<string[]> {
  const allowedTables = new Set(['users', 'commission_withdrawals'])
  if (!allowedTables.has(tableName)) throw new Error('Unsupported table name')
  // 表结构运行期不变，走 isolate 级缓存，避免每次都发 PRAGMA。
  return Array.from(await getCachedTableColumns(c.env.RENT, tableName))
}

import { c2cBookingError,isC2CMember } from './services/c2c'
import { deliverC2CEmails } from './services/c2cEmails'

const app = new Hono()

async function resolveImageUrls(fileValue: unknown, legacyUrl: unknown, c: any, folder: string, maxFiles = 1): Promise<string[]> {
  if (fileValue) {
    const uploaded = await uploadCloudinaryImages(fileValue, await getCloudinaryRuntimeConfig(c), folder, maxFiles, { watermark: true })
    if (uploaded.length) return uploaded
  }
  if (String(legacyUrl || '').trim()) throw new Error('请直接上传图片，系统会自动添加上传日期和唯一编号水印')
  return []
}

async function parseFormBodyForRequest(c: any): Promise<Record<string, any>> {
  const form = String(c.req.header('content-type') || '').toLowerCase().includes('multipart/form-data')
    ? await c.req.parseBody()
    : parseFormBody(await c.req.text())
  // 字段长度 / 数量上限：超长文本一律拒绝（由调用方回 413），而不是悄悄截断后写库。
  const limits = checkFormFieldLimits(form as Record<string, unknown>)
  if (!limits.ok) throw new Error(`FORM_LIMIT:${limits.reason}`)
  return form as Record<string, any>
}

async function addWatermarkedContractDamagePhotos(c: any, form: Record<string, any>, submittedData: Record<string, string>): Promise<void> {
  if (submittedData.damage_photos === undefined && !form.damagePhotoFiles) return
  const existing = submittedData.damage_photos
    ? validateHostedImageUrls(submittedData.damage_photos).join('\n')
    : ''
  const uploaded = await uploadCloudinaryImages(form.damagePhotoFiles, await getCloudinaryRuntimeConfig(c), 'rent/damage-photos', 5, { watermark: true })
  submittedData.damage_photos = [existing, ...uploaded].filter(Boolean).join('\n')
}

// 安全响应头中间件必须注册在**所有路由之前**：Hono 按注册顺序匹配，静态资源
// （/styles.css、/app.js、/i18n.js、/favicon.*）的路由定义在文件靠前的位置，
// 如果 header 中间件注册在它们之后，这些响应根本不经过任何 app.use —— 既没有
// CSP/nosniff，404 / 500 / 413 也会一样丢头。这里放在静态资源路由之前。
// 静态资源短路（不查会话）仍然保留在下面鉴权中间件里，因此不会给 CSS 增加 D1 查询。
app.use('*', async (c, next) => {
  applySecurityHeaders(c)
  await next()
})

app.get('/styles.css', (c) => {
  c.header('Content-Type', 'text/css; charset=utf-8')
  // 带版本号请求（layout 里注入的 /styles.css?v=<hash>）可安全长期缓存；
  // 无版本号的历史链接退回到较短的缓存，避免部署后长期拿到旧样式。
  const versioned = c.req.query('v') === styleSheetVersion
  c.header('Cache-Control', versioned
    ? 'public, max-age=31536000, immutable'
    : 'public, max-age=3600, stale-while-revalidate=86400')
  c.header('ETag', `"${styleSheetVersion}"`)
  c.header('X-Content-Type-Options', 'nosniff')
  if (c.req.header('If-None-Match') === `"${styleSheetVersion}"`) return c.body(null, 304)
  // siteStyles 已在模块加载时压缩过一次（src/lib/assetVersion.ts），这里复用同一个
  // 字符串；Content-Length 用预先算好的字节数，避免每次请求重新统计。
  c.header('Content-Length', String(styleSheetByteLength))
  return c.body(siteStyles)
})

app.get('/app.js', (c) => {
  c.header('Content-Type', 'text/javascript; charset=utf-8')
  const versioned = c.req.query('v') === appScriptVersion
  c.header('Cache-Control', versioned
    ? 'public, max-age=31536000, immutable'
    : 'public, max-age=3600, stale-while-revalidate=86400')
  c.header('ETag', `"${appScriptVersion}"`)
  c.header('X-Content-Type-Options', 'nosniff')
  if (c.req.header('If-None-Match') === `"${appScriptVersion}"`) return c.body(null, 304)
  return c.body(appScriptText)
})

app.get('/favicon.svg', (c) => {
  c.header('Content-Type', 'image/svg+xml')
  c.header('Cache-Control', 'public, max-age=604800')
  return c.body('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="32" fill="#0A0A0F"/><g transform="translate(10 10)"><path d="M24 10 42 39 33 39 24 25 15 39 6 39Z" fill="#2563EB"/><path d="M5 39 14 39 33 4 24 4Z" fill="#fff"/></g></svg>')
})
app.get('/favicon.ico', (c) => c.redirect('/favicon.svg', 301))

app.get('/i18n.js', (c) => {
  c.header('Content-Type', 'text/javascript; charset=utf-8')
  const versioned = c.req.query('v') === languageScriptVersion
  c.header('Cache-Control', versioned
    ? 'public, max-age=31536000, immutable'
    : 'public, max-age=3600, stale-while-revalidate=86400')
  c.header('ETag', `"${languageScriptVersion}"`)
  c.header('X-Content-Type-Options', 'nosniff')
  if (c.req.header('If-None-Match') === `"${languageScriptVersion}"`) return c.body(null, 304)
  return c.body(languageScriptText)
})

const SYSTEM_STATUS_CACHE_KEY = 'https://rent.internal/api/system-status'
const SYSTEM_STATUS_TTL_MS = 15_000

const SEARCH_ORDER_STATUS_LABELS: Record<string, string> = {
  pending_approval: '待审核', pending_payment: '待支付', approved: '已审核', awaiting_signature: '待签署',
  paid: '已支付', pending_pickup: '待取货', active: '租赁中', extended: '已延期', overdue: '已逾期',
  suspended: '已暂停', pending_return: '待归还', returned: '已归还', completed: '已完成', cancelled: '已取消'
}

const handleGlobalSearch = async (c) => {
  const user = c.get('user') as any
  if (!user) return c.json({ orders: [] }, 401)

  const query = String(c.req.query('q') || '').trim().slice(0, 80)
  if (query.length < 2) return c.json({ orders: [] }, 200, { 'Cache-Control': 'no-store' })

  const escaped = query.toLowerCase().replace(/[\\%_]/g, (character) => `\\${character}`)
  const like = `%${escaped}%`
  const searchClauses = [
    "LOWER(COALESCE(o.id, '')) LIKE ? ESCAPE '\\'",
    "LOWER(COALESCE(o.orderNo, '')) LIKE ? ESCAPE '\\'",
    "LOWER(COALESCE(u.name, '')) LIKE ? ESCAPE '\\'",
    "LOWER(COALESCE(u.email, '')) LIKE ? ESCAPE '\\'",
    "LOWER(COALESCE(d.name, '')) LIKE ? ESCAPE '\\'",
    "LOWER(COALESCE(d.model, '')) LIKE ? ESCAPE '\\'",
    "LOWER(COALESCE(o.status, '')) LIKE ? ESCAPE '\\'",
    "LOWER(CASE o.status WHEN 'pending_approval' THEN '待审核' WHEN 'pending_payment' THEN '待支付' WHEN 'approved' THEN '已审核' WHEN 'awaiting_signature' THEN '待签署' WHEN 'paid' THEN '已支付' WHEN 'pending_pickup' THEN '待取货' WHEN 'active' THEN '租赁中' WHEN 'extended' THEN '已延期' WHEN 'overdue' THEN '已逾期' WHEN 'suspended' THEN '已暂停' WHEN 'pending_return' THEN '待归还' WHEN 'returned' THEN '已归还' WHEN 'completed' THEN '已完成' WHEN 'cancelled' THEN '已取消' ELSE o.status END) LIKE ? ESCAPE '\\'"
  ]
  const params: any[] = Array.from({ length: searchClauses.length }, () => like)
  let accessClause = '1 = 1'
  if (user.role === 'CUSTOMER') {
    accessClause = 'o.userId = ?'
    params.push(user.id)
  } else if (user.role === 'STAFF') {
    accessClause = 'u.staff_id = ?'
    params.push(user.id)
  } else if (user.role !== 'ADMIN') {
    return c.json({ orders: [] }, 403)
  }

  const result = await c.env.RENT.prepare(`
    SELECT o.id, o.orderNo, o.status, o.startDate, o.endDate,
           u.name AS customerName, d.name AS deviceName, d.model AS deviceModel
    FROM orders o
    LEFT JOIN users u ON u.id = o.userId
    LEFT JOIN devices d ON d.id = o.deviceId
    WHERE o.deleted_at IS NULL AND (${searchClauses.join(' OR ')}) AND ${accessClause}
    ORDER BY o.createdAt DESC
    LIMIT 12
  `).bind(...params).all() as any

  const orders = ((result.results || []) as any[]).map((order) => ({
    id: order.id,
    orderNo: order.orderNo || order.id,
    status: order.status,
    statusLabel: SEARCH_ORDER_STATUS_LABELS[order.status] || order.status,
    startDate: order.startDate,
    endDate: order.endDate,
    customerName: order.customerName || '未知客户',
    deviceName: order.deviceName || order.deviceModel || '未知设备',
    target: user.role === 'ADMIN'
      ? `/admin/orders/${encodeURIComponent(order.id)}`
      : user.role === 'STAFF'
        ? staffOrderPath({ id: order.id, orderNo: order.orderNo })
        : `/customer/orders/${encodeURIComponent(order.id)}`
  }))
  const documents = user.role === 'ADMIN' ? (await searchBusinessDocuments(c, query)).map(document => ({
    id: document.id, number: document.number, typeLabel: DOCUMENT_TYPES[document.kind],
    customerName: document.customerName, orderNo: document.orderNo,
    statusLabel: documentStatus(document.displayStatus), target: documentPath(document),
  })) : []
  return c.json({ orders, documents }, 200, { 'Cache-Control': 'no-store' })
}

app.get('/api/system-status', async (c) => {
  // 边缘缓存：MonitorFlare 每 15 分钟探测一次，每个页面又每 60 秒轮询一次，
  // 命中缓存即可跳过 D1 往返（原本两次串行查询 ~470ms）。
  const cache = caches.default
  const cacheKey = new Request(SYSTEM_STATUS_CACHE_KEY)
  const cached = await cache.match(cacheKey)
  if (cached) {
    const body = await cached.json()
    return c.json(body as any, 200, { 'Cache-Control': 'no-store' })
  }

  const startedAt = Date.now()
  try {
    // 单条可命中 idx_error_logs_created_at 的查询：既验证 D1 连通性，
    // 又判断近 10 分钟内是否有错误。直接比较文本时间戳，避免 datetime() 包裹导致索引失效；
    // 只取存在性（LIMIT 1）而非 COUNT(*)，命中即停。
    const since = new Date(Date.now() - 10 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ')
    const recent = await c.env.RENT.prepare("SELECT 1 AS hit FROM error_logs WHERE error_level IN ('ERROR', 'CRITICAL') AND created_at >= ? LIMIT 1").bind(since).first() as any
    const errors = recent ? 1 : 0
    const delayed = Date.now() - startedAt >= 1000
    const body = { status: errors ? 'degraded' : delayed ? 'delayed' : 'healthy', label: errors ? '异常' : delayed ? '延迟' : '正常', checkedAt: new Date().toISOString() }
    const toCache = new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${SYSTEM_STATUS_TTL_MS / 1000}` },
    })
    try { c.executionCtx.waitUntil(cache.put(cacheKey, toCache)) } catch (_) { }
    return c.json(body, 200, { 'Cache-Control': 'no-store' })
  } catch (error: any) {
    console.error('System status check failed:', error?.message || error)
    return c.json({ status: 'down', label: '错误' }, 503, { 'Cache-Control': 'no-store' })
  }
})

// Token-protected, read-only website probe for Monitorflare. Device online
// state is intentionally excluded: this endpoint measures the website and its
// core services, not whether an individual Windows client is running.
app.get('/api/monitor', async (c) => {
  if (isBrowserNavigation(c)) return c.redirect('/', 302)
  const startedAt = Date.now()
  const checks: Record<string, any> = {}

  try {
    const databaseStartedAt = Date.now()
    const tokenValid = await hasValidMonitorApiToken(c)
    const latencyMs = Date.now() - databaseStartedAt
    checks.database = { ok: true, status: latencyMs >= 1000 ? 'degraded' : 'ok', latencyMs }
    if (!tokenValid) {
      return c.json({ status: 'unauthorized', error: 'Valid monitor token required' }, 401, { 'Cache-Control': 'no-store', 'WWW-Authenticate': 'Bearer realm="monitor"' })
    }
  } catch (error: any) {
    console.error('Monitor database check failed:', error?.message || error)
    checks.database = { ok: false, status: 'down', error: 'database unavailable' }
  }

  // 四个探针过去各自一条 D1 往返（Promise.all 并发，但每条仍付一次完整网络延迟）。
  // 改成一次 batch() —— 一个网络往返里按序跑完四条只读聚合。batch 整体失败时回退到
  // 逐条查询，保留单表异常不拖垮整个探针的韧性。
  const probes: { name: string; sql: string; shape: (row: any) => Record<string, any> }[] = [
    {
      name: 'applicationErrors',
      sql: "SELECT COUNT(*) AS total, SUM(CASE WHEN error_level = 'CRITICAL' THEN 1 ELSE 0 END) AS critical FROM error_logs WHERE error_level IN ('ERROR', 'CRITICAL') AND datetime(created_at) >= datetime('now', '-10 minutes')",
      shape: (row) => {
        const recent = Number(row?.total || 0)
        const critical = Number(row?.critical || 0)
        return { ok: recent === 0, status: recent ? 'degraded' : 'ok', windowMinutes: 10, recent, critical }
      },
    },
    {
      name: 'scheduledJobs',
      // "stuck" only counts a RUNNING row that plausibly belongs to a live job:
      // started 1h–24h ago. scheduled_job_runs is never purged, and a worker
      // killed mid-tick (CPU/wall-clock limit) leaves an orphan RUNNING row
      // forever — without the lower bound one past crash pins this check to
      // "degraded" permanently regardless of how healthy the cron now is.
      sql: `SELECT
        SUM(CASE WHEN status = 'FAILED' AND datetime(started_at) >= datetime('now', '-24 hours') THEN 1 ELSE 0 END) AS failures,
        SUM(CASE WHEN status = 'RUNNING' AND datetime(started_at) < datetime('now', '-1 hour') AND datetime(started_at) >= datetime('now', '-24 hours') THEN 1 ELSE 0 END) AS stuck,
        MAX(started_at) AS last_run
        FROM scheduled_job_runs`,
      shape: (row) => {
        const failures = Number(row?.failures || 0)
        const stuck = Number(row?.stuck || 0)
        const lastRunMs = row?.last_run ? Date.parse(`${String(row.last_run).replace(' ', 'T')}Z`) : NaN
        const lastRunAgeSeconds = Number.isFinite(lastRunMs) ? Math.max(0, Math.round((Date.now() - lastRunMs) / 1000)) : null
        const overdue = lastRunAgeSeconds === null || lastRunAgeSeconds > 36 * 60 * 60
        return { ok: !failures && !stuck && !overdue, status: failures || stuck || overdue ? 'degraded' : 'ok', failures24h: failures, stuck, lastRunAgeSeconds }
      },
    },
    {
      name: 'emailDelivery',
      // email_events.status is one of PENDING/SENT/FAILED/SKIPPED — there is no
      // 'SENDING'. Grade failures as a share of 24h volume (a single transient
      // bounce must not pin the probe to "degraded" for a whole day); a PENDING
      // row older than 30min is a genuinely stuck send and always counts.
      sql: `SELECT
        SUM(CASE WHEN datetime(created_at) >= datetime('now', '-24 hours') THEN 1 ELSE 0 END) AS total,
        SUM(CASE WHEN status = 'FAILED' AND datetime(created_at) >= datetime('now', '-24 hours') THEN 1 ELSE 0 END) AS failures,
        SUM(CASE WHEN status = 'PENDING' AND datetime(created_at) < datetime('now', '-30 minutes') THEN 1 ELSE 0 END) AS stuck
        FROM email_events`,
      shape: (row) => {
        const total = Number(row?.total || 0)
        const failures = Number(row?.failures || 0)
        const stuck = Number(row?.stuck || 0)
        const bad = stuck > 0 || (total > 0 && failures / total >= 0.1)
        return { ok: !bad, status: bad ? 'degraded' : 'ok', total24h: total, failures24h: failures, stuck }
      },
    },
    {
      name: 'remoteCommands',
      // EXPIRED is a normal lapse (offline device, or a long-dated cleanup
      // command that was never meant to run soon) — only FAILED is a real
      // failure, graded as a share of completed commands. "overdue" is bounded
      // to the last 24h so an offline device's stale QUEUED command (only swept
      // to EXPIRED when that device next polls) doesn't pin the probe forever.
      sql: `SELECT
        SUM(CASE WHEN status = 'FAILED' AND datetime(created_at) >= datetime('now', '-24 hours') THEN 1 ELSE 0 END) AS failures,
        SUM(CASE WHEN status IN ('SUCCESS', 'FAILED', 'EXPIRED') AND datetime(created_at) >= datetime('now', '-24 hours') THEN 1 ELSE 0 END) AS completed,
        SUM(CASE WHEN status IN ('QUEUED', 'SENT', 'ACKNOWLEDGED', 'RUNNING') AND datetime(expires_at) <= CURRENT_TIMESTAMP AND datetime(expires_at) >= datetime('now', '-24 hours') THEN 1 ELSE 0 END) AS overdue
        FROM device_commands`,
      shape: (row) => {
        const failures = Number(row?.failures || 0)
        const completed = Number(row?.completed || 0)
        const overdue = Number(row?.overdue || 0)
        const bad = overdue > 0 || (completed > 0 && failures / completed >= 0.15)
        return { ok: !bad, status: bad ? 'degraded' : 'ok', failures24h: failures, completed24h: completed, overdue }
      },
    },
  ]

  const applyShape = (probe: typeof probes[number], row: any) => {
    try {
      checks[probe.name] = probe.shape(row || {})
    } catch (error: any) {
      console.error(`Monitor ${probe.name} check failed:`, error?.message || error)
      checks[probe.name] = { ok: false, status: 'degraded', error: 'check unavailable' }
    }
  }



  const status = monitorOverallStatus(Object.values(checks))
  return c.json(
    { status, checks, latencyMs: Date.now() - startedAt, checkedAt: new Date().toISOString() },
    monitorHttpStatus(status),
    { 'Cache-Control': 'no-store' },
  )
})

app.get('/downloads/RentDeviceAgent-Setup.exe', async (c) => {
  return c.redirect('https://github.com/aaoqqqdd/rent-app/releases/latest/download/RentDeviceAgent-Setup.exe', 302)
})

app.get('/downloads/RentDeviceAgent.exe', async (c) => {
  return c.redirect('https://github.com/aaoqqqdd/rent-app/releases/latest/download/RentDeviceAgent-x64.exe', 302)
})

const AGENT_REPO = 'aaoqqqdd/rent-app'
// Pinned fallback used only when the GitHub Releases API is unreachable. Keep it
// roughly current so an offline check still returns a plausible version.
const AGENT_UPDATE_FALLBACK_VERSION = '1.7.4'

app.get('/api/device-agent/update', async (c) => {
  let version = AGENT_UPDATE_FALLBACK_VERSION
  try {
    // cf.cacheEverything edge-caches this subrequest so we stay well under
    // GitHub's 60 req/hour unauthenticated limit no matter how many agents poll.
    const res = await fetch(`https://api.github.com/repos/${AGENT_REPO}/releases/latest`, {
      headers: { 'User-Agent': 'rent-device-agent-update-check', Accept: 'application/vnd.github+json' },
      cf: { cacheTtl: 900, cacheEverything: true },
    })
    if (res.ok) {
      const data = await res.json() as any
      const tag = String(data?.tag_name || '').trim().replace(/^v/i, '')
      if (/^\d+\.\d+\.\d+([-.].+)?$/.test(tag)) version = tag
    }
  } catch {
    // Network failure: fall through to the pinned fallback version.
  }
  return c.json({
    version,
    downloadUrl: `https://github.com/${AGENT_REPO}/releases/latest/download/RentDeviceAgent-x64.exe`,
    setupUrl: `https://github.com/${AGENT_REPO}/releases/latest/download/RentDeviceAgent-Setup.exe`,
    releaseNotesUrl: `https://github.com/${AGENT_REPO}/releases/latest`,
  }, 200, { 'Cache-Control': 'public, max-age=300' })
})

app.get('/api/device-agent/software-terms', async (c) => {
  // 设备端会定期拉取该协议，内容极少变化；边缘缓存 5 分钟，
  // 命中时直接跳过 loadSystemSettingsFromDB（D1 + sanitize-html）。
  const cache = caches.default
  const cacheKey = new Request('https://rent.internal/api/device-agent/software-terms')
  const cached = await cache.match(cacheKey)
  if (cached) return c.json(await cached.json() as any)

  const settings = await loadSystemSettingsFromDB(c)
  const metadata = settings.legalMetadata.software
  const body = { content: settings.softwareTerms, version: metadata.version, lastUpdatedDate: metadata.lastUpdatedDate }
  const toCache = new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' },
  })
  try { c.executionCtx.waitUntil(cache.put(cacheKey, toCache)) } catch (_) { }
  return c.json(body)
})

let loginAttemptsSchemaReady: Promise<void> | null = null

async function ensureLoginAttemptsSchema(c: any): Promise<void> {
  if (!loginAttemptsSchemaReady) {
    loginAttemptsSchemaReady = (async () => {
      await c.env.RENT.prepare(`CREATE TABLE IF NOT EXISTS login_attempts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ip_address TEXT NOT NULL,
        account TEXT NOT NULL,
        attempted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`).run()
      await c.env.RENT.prepare('CREATE INDEX IF NOT EXISTS idx_login_attempts_lookup ON login_attempts(ip_address, account, attempted_at)').run()
    })()
  }
  try {
    await loginAttemptsSchemaReady
  } catch (error) {
    loginAttemptsSchemaReady = null
    throw error
  }
}

async function ensureLoginHistorySchema(c: any): Promise<void> {
  await c.env.RENT.prepare(`CREATE TABLE IF NOT EXISTS login_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT,
    account TEXT NOT NULL,
    ip_address TEXT NOT NULL,
    user_agent TEXT,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`).run()
  await c.env.RENT.prepare('CREATE INDEX IF NOT EXISTS idx_login_history_user ON login_history(user_id, created_at DESC)').run()
}

function errorDetails(error: unknown) {
  if (!(error instanceof Error)) return error
  return {
    name: error.name,
    message: error.message,
    stack: error.stack,
    cause: error.cause instanceof Error
      ? { name: error.cause.name, message: error.cause.message, stack: error.cause.stack }
      : error.cause
  }
}

// 只影响会话 Cookie 的 Secure 属性与 HSTS，与旧实现同一判据（请求 URL 协议），
// 不引入 x-forwarded-proto 之类可被伪造的推断，避免改变现有登录行为。
function isSecureRequest(c: any): boolean {
  return new URL(c.req.url).protocol === 'https:'
}

// 表名 / 列名这类不能绑定参数、只能拼进 SQL 的标识符，先过这道白名单再拼接。
// 所有此类拼接点（DDL 列名、时间戳列名、保留策略预览的 FROM/日期列）都必须经过它。
const SQL_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/
function sqlIdentifier(value: unknown): string {
  const name = String(value ?? '')
  if (!SQL_IDENTIFIER.test(name)) throw new Error('Invalid SQL identifier')
  return name
}

// 这些路径的响应包体可能包含认证态数据（会话、合同、订单、重置链接），
// 一律禁止浏览器与中间缓存留存。
const NO_STORE_EXACT_PATHS = new Set(['/login', '/forgot-password', '/reset-password', '/verify-email', '/verify-email/pending', '/contract/sign', '/sso/consume', '/public/session', '/api/search', '/api/payment/status', '/api/monitor'])
const NO_STORE_PATH_PREFIXES = ['/admin/', '/staff/', '/customer/', '/rent/', '/notifications', '/contract/', '/orders/']

function isNoStorePath(pathname: string): boolean {
  if (NO_STORE_EXACT_PATHS.has(pathname)) return true
  return NO_STORE_PATH_PREFIXES.some((prefix) => pathname === prefix.replace(/\/$/, '') || pathname.startsWith(prefix))
}

function applySecurityHeaders(c: any): void {
  c.header('X-Content-Type-Options', 'nosniff')
  c.header('X-Frame-Options', 'DENY')
  c.header('Referrer-Policy', 'no-referrer')
  c.header('Permissions-Policy', `${c.req.path === '/staff/mobile/scan' ? 'camera=(self)' : 'camera=()'}, microphone=(), geolocation=()`)
  c.header('Cross-Origin-Opener-Policy', 'same-origin')
  c.header('Cross-Origin-Resource-Policy', 'same-origin')
  c.header('X-Permitted-Cross-Domain-Policies', 'none')
  if (new URL(c.req.url).protocol === 'https:') c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
  if (c.get('user') || isNoStorePath(c.req.path)) c.header('Cache-Control', 'private, no-store')
  // CSP 指令集中在 src/lib/security.ts（有单测断言不含 unsafe-eval、object-src/base-uri/
  // frame-ancestors 保持最严）。script-src 仍保留 'unsafe-inline'：页面里还有大量内联
  // <script>，全面改 nonce 属于跨模块改造，作为遗留项记录在交付说明里。
  c.header('Content-Security-Policy', buildContentSecurityPolicy())
}

app.use('*', async (c, next) => {
  // 静态资源不需要鉴权，避免每次加载 CSS 都额外查询 D1 会话表。
  if (c.req.path === '/styles.css' || c.req.path === '/app.js' || c.req.path === '/i18n.js' || c.req.path === '/translation.js' || c.req.path === '/favicon.svg' || c.req.path === '/favicon.ico') return next()
  const user = await findUserBySession(c, c.req.header('cookie') ?? null)
  if (user) {
    c.set('user', user)
  }
  await next()
})

app.use('*', async (c, next) => {
  const path = c.req.path
  const user = c.get('user')
  const feature = clientFeatureForPath(path,'console')
  const clientRoute = path === '/' || /^\/(?:customer|staff|feedback|notifications)(?:\/|$)/.test(path) || path === '/api/search'
  if (user?.role === 'ADMIN' || (!feature && !clientRoute)) return next()
  let policy
  try { policy = await readClientAccess(c.env.RENT) }
  catch (error) {
    console.error('Client access settings unavailable',error)
    if (!feature && consoleEssentialPath(path)) return next()
    c.header('Cache-Control','private, no-store'); c.header('Retry-After','300')
    return c.html(clientMaintenanceHtml('',false,'console'),503)
  }
  if (user) user.clientAccess = policy
  const closedFeature = feature && !policy.features[feature]
  if (closedFeature || (!policy.console.enabled && (clientRoute || feature) && (!consoleEssentialPath(path) || feature))) {
    c.header('Cache-Control','private, no-store'); c.header('Retry-After','300')
    return c.html(clientMaintenanceHtml(closedFeature ? '' : policy.console.message,Boolean(closedFeature),'console'),503)
  }
  await next()
})

app.use('*', async (c, next) => {
  if (c.req.path.startsWith('/notifications')) {
    try {
      await ensureNotificationsTable(c)
    } catch (error: any) {
      console.error('Failed to ensure notifications table exists:', error?.message || error)
    }
  }
  await next()
})

app.use('*', async (c, next) => {
  const user = c.get('user') as any
  if (user?.accountType === 'guest' && user.role === 'CUSTOMER') {
    const expiresAt = user.guestExpiresAt || user.guest_expires_at
    const melbourneToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Melbourne', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
    const expiresDate = expiresAt ? String(expiresAt).slice(0, 10) : ''
    if (expiresDate && expiresDate < melbourneToday) {
      await c.env.RENT.prepare("UPDATE users SET account_type = 'deleted_guest', status = 'inactive', email = 'deleted-guest-' || id || '@invalid.local', phone = NULL, bsb = NULL, account_number = NULL, password_hash = 'disabled', password_salt = 'disabled', guest_order_id = NULL, guest_expires_at = NULL, deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND account_type = 'guest'").bind(user.id).run()
      await deleteAuthSession(c, c.req.header('cookie') ?? null)
      return c.redirect('/login?error=guest_expired')
    }
    const path = c.req.path
    const allowedExact = new Set(['/customer/guest', '/customer/guest/upgrade', '/logout', '/payment/result', '/notifications', '/notifications/unread', '/api/search'])
    const orderMatch = path.match(/^\/customer\/orders\/([^/]+)(?:\/(?:refund-request|payment-plan|installments\/[^/]+\/stripe\/intent|stripe\/(?:checkout|intent)|square\/(?:config|payment)|bank-transfer-proof))?$/)
    const invoiceMatch = path.match(/^\/orders\/([^/]+)\/invoice$/)
    const invoicePdfMatch = path.match(/^\/orders\/([^/]+)\/invoice\/pdf$/)
    if (orderMatch && orderMatch[1] !== user.guestOrderId) return c.html(renderForbidden(), 403)
    if (invoiceMatch && invoiceMatch[1] !== user.guestOrderId) return c.html(renderForbidden(), 403)
    if (invoicePdfMatch && invoicePdfMatch[1] !== user.guestOrderId) return c.html(renderForbidden(), 403)
    const permitted = allowedExact.has(path) || path.startsWith('/notifications/') || Boolean(orderMatch) || Boolean(invoiceMatch) || Boolean(invoicePdfMatch) || path.startsWith('/contract/view/') || path.startsWith('/contract/print/') || path.endsWith('/invoice/print') || path === '/styles.css' || path === '/app.js' || path === '/i18n.js'
    if (!permitted && path.startsWith('/customer/')) return c.redirect('/customer/guest')
  }
  await next()
})

app.use('*', async (c, next) => {
  const maxBody = maxRequestBodyBytes(c.req.path, c.req.method)
  // 旧实现用 Number(header || 0)：缺失或非数字的 Content-Length 会退化成 0，
  // 等于完全绕过请求体上限。这里改为：有声明长度就比声明值；没有就实测缓冲后的体积。
  const declaredLength = resolveContentLength(c.req.header('Content-Length'))
  if (declaredLength !== null && declaredLength > maxBody) return c.text('Request body too large', 413)
  if (declaredLength === null && c.req.method !== 'GET' && c.req.method !== 'HEAD') {
    const raw = await c.req.arrayBuffer()
    if (raw.byteLength > maxBody) return c.text('Request body too large', 413)
  }
  const publicWebOrigin = String((c.env as any).PUBLIC_WEB_ORIGIN || '').replace(/\/$/, '')
  const isPublicOrderLookup = c.req.path === '/public/order-lookup'
  if (c.req.method === 'POST' && !['/webhooks/stripe', '/webhooks/square', '/webhooks/tally'].includes(c.req.path) && !isPublicOrderLookup) {
    const origin = c.req.header('Origin')
    const fetchSite = c.req.header('Sec-Fetch-Site')
    const sameOriginAjax = c.req.header('X-Requested-With') === 'XMLHttpRequest' && /^application\/json(?:;|$)/i.test(c.req.header('Content-Type') || '')
    const hasSessionCookie = /(?:^|;\s*)session=[^;]+/.test(c.req.header('cookie') || '')
    let originValid = true
    if (origin && origin !== 'null') {
      // TLS and host rewriting may terminate at a proxy before the request
      // reaches the Worker. Prefer the client-facing Host header, with the
      // request URL as a fallback, so same-origin browser form posts are not
      // rejected when the Worker sees an internal upstream hostname.
      try {
        const originHost = new URL(origin).host
        const requestHost = c.req.header('Host')
        const publicHost = requestHost ? new URL(`http://${requestHost}`).host : new URL(c.req.url).host
        // Some edge/proxy paths preserve the browser's same-origin fetch
        // metadata while rewriting the Host header to an upstream hostname.
        // In that case Sec-Fetch-Site is the client-facing origin signal.
        originValid = originHost === publicHost || fetchSite === 'same-origin'
      } catch { originValid = false }
    } else if (origin === 'null' && hasSessionCookie && fetchSite === 'same-origin') {
      // Some privacy configurations submit a same-origin top-level form with
      // Origin: null. Fetch Metadata is browser-controlled; require both its
      // same-origin signal and an existing session before accepting it.
      originValid = true
    } else if (hasSessionCookie && fetchSite !== 'same-origin') {
      // A browser session without an Origin header is not verifiably same
      // origin. Reject it rather than accepting a forged cross-site form.
      originValid = false
    }
    if (!originValid || fetchSite === 'cross-site') return c.text('Invalid request origin', 403)
  }
  if (isPublicOrderLookup && (c.req.method === 'POST' || c.req.method === 'OPTIONS')) {
    const origin = (c.req.header('Origin') || '').replace(/\/$/, '')
    if (!publicWebOrigin || origin !== publicWebOrigin) return c.text('Invalid request origin', 403)
    c.header('Access-Control-Allow-Origin', publicWebOrigin)
    c.header('Vary', 'Origin')
    c.header('Access-Control-Allow-Methods', 'POST, OPTIONS')
    c.header('Access-Control-Allow-Headers', 'Accept, Content-Type')
    c.header('Access-Control-Max-Age', '86400')
    if (c.req.method === 'OPTIONS') return c.body(null, 204)
  }
  const ip = (c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For')?.split(',')[0] || 'unknown').trim()
  const rateRule = c.req.path === '/login' && c.req.method === 'POST' ? ['login', 20, 900] as const
    : /^\/api\/translate(?:\/[^/]+)?$/.test(c.req.path) && c.req.method === 'POST' ? ['translation', 20, 60] as const
    : c.req.path === '/register' && c.req.method === 'POST' ? ['register', 5, 3600] as const
    : c.req.path === '/register/resend-verification' && c.req.method === 'POST' ? ['verification-resend', 5, 3600] as const
    : c.req.path === '/forgot-password' && c.req.method === 'POST' ? ['forgot', 5, 3600] as const
    : c.req.path === '/reset-password' && c.req.method === 'POST' ? ['reset-password', 10, 900] as const
    : c.req.path === '/contract/sign' ? ['contract-sign', 60, 900] as const
    : c.req.path === '/contract/sign/payment-plan' || /^\/customer\/orders\/[^/]+\/payment-plan$/.test(c.req.path) ? ['rental-payment-plan', 15, 600] as const
    : /^\/customer\/orders\/[^/]+\/(?:installments\/[^/]+\/)?stripe\/(?:checkout|intent)$/.test(c.req.path) ? ['stripe-checkout', 10, 600] as const
    : /^\/customer\/orders\/[^/]+\/bank-transfer-proof$/.test(c.req.path) ? ['bank-proof', 10, 3600] as const
    : c.req.method === 'POST' && /^\/staff\/orders\/[^/]+\/prepare-pickup$/.test(c.req.path) ? ['pickup-preparation', 15, 600] as const
    : /^\/staff\/orders\/[^/]+\/inspection$/.test(c.req.path) ? ['inspection-upload', 10, 3600] as const
    : c.req.method === 'POST' && (/^\/staff\/orders\/[^/]+\/return-collection$/.test(c.req.path) || /^\/staff\/return-collections\//.test(c.req.path)) ? ['return-collection', 20, 600] as const
    : c.req.method === 'POST' && (/^\/staff\/orders\/[^/]+\/cancel$/.test(c.req.path) || /^\/admin\/orders\/[^/]+\/(?:cancel-and-refund|retry-cancellation-refund)$/.test(c.req.path)) ? ['cancellation-refund', 10, 600] as const
    : c.req.method === 'POST' && (/^\/customer\/orders\/[^/]+\/refund-request$/.test(c.req.path) || /^\/admin\/refund-requests\//.test(c.req.path) || /^\/admin\/refunds\/[^/]+\/complete-customer-refund$/.test(c.req.path)) ? ['customer-refund', 10, 600] as const
    : c.req.path === '/admin/settings/upload-image' ? ['admin-settings-image', 10, 3600] as const
    : c.req.method === 'POST' && ['/admin/users/new', '/staff/customers/new'].includes(c.req.path) ? ['managed-user-create', 30, 600] as const
    : c.req.method === 'POST' && c.req.path.startsWith('/rent/') ? ['rental-link-booking', 10, 900] as const
    : c.req.method === 'POST' && c.req.path.startsWith('/admin/rental-links') ? ['rental-link-admin', 30, 600] as const
    : c.req.method === 'POST' && (c.req.path === '/admin/orders/new' || /^\/admin\/orders\/[^/]+\/edit$/.test(c.req.path)) ? ['admin-manual-order', 60, 600] as const
    : c.req.method === 'POST' && ['/customer/rental-program/photos','/customer/c2c/photos'].includes(c.req.path) ? ['c2c-photo-upload', 20, 3600] as const
    : c.req.method === 'POST' && ['/customer/rental-program','/admin/rental-program','/customer/c2c','/admin/c2c'].some(prefix=>c.req.path.startsWith(prefix)) ? ['c2c-write', 30, 600] as const
    : c.req.path === '/verify' ? ['contract-verify', 30, 600] as const
    : c.req.path === '/admin/connectivity/check' ? ['connectivity-check', 10, 60] as const
    : c.req.path.startsWith('/api/address/') ? ['address-search', 120, 60] as const
    : c.req.path === '/public/order-lookup' && c.req.method === 'POST' ? ['public-order-lookup', 6, 900] as const
    // 以下是安全加固补齐的高风险写 / 查询接口（会话握手、改密、付款初始化、上传、导出）。
    // 追加在链尾，不改变上面既有规则的匹配优先级。
    : c.req.path === '/public/session' ? ['website-session', 120, 60] as const
    : c.req.path === '/sso/consume' ? ['sso-consume', 30, 600] as const
    : c.req.path === '/logout' && c.req.method === 'POST' ? ['logout', 60, 600] as const
    : c.req.path === '/customer/profile/password' || c.req.path === '/profile/password' ? ['password-change', 10, 900] as const
    : c.req.path === '/customer/profile/delete-account' ? ['account-deletion', 5, 3600] as const
    : c.req.method === 'POST' && c.req.path === '/customer/profile' ? ['profile-update', 30, 600] as const
    : c.req.method === 'POST' && /^\/customer\/balance\/top-up(?:\/transfer)?$/.test(c.req.path) ? ['balance-topup', 10, 600] as const
    : /^\/customer\/orders\/[^/]+\/square\/(?:config|payment)$/.test(c.req.path) ? ['square-payment', 10, 600] as const
    : c.req.method === 'POST' && /^\/customer\/orders\/[^/]+\/(?:receipt|invoice\/send)/.test(c.req.path) ? ['receipt-send', 10, 3600] as const
    : c.req.method === 'POST' && c.req.path.startsWith('/admin/contracts/template') ? ['contract-template-write', 30, 600] as const
    : c.req.method === 'POST' && (c.req.path.startsWith('/admin/settings') || c.req.path.startsWith('/admin/rental-settlements')) ? ['admin-settings-write', 60, 600] as const
    : c.req.path === '/admin/orders/export' ? ['orders-export', 10, 3600] as const
    : c.req.method === 'POST' && (c.req.path === '/notifications/send' || c.req.path === '/admin/email-templates/send' || /^\/manager\/email-events\/[^/]+\/retry$/.test(c.req.path)) ? ['notification-email-send', 30, 600] as const
    : c.req.path === '/api/search' ? ['global-search', 120, 60] as const
    : c.req.path === '/api/contract-sign/coupon-preview' ? ['coupon-preview', 30, 60] as const
    : c.req.path === '/api/payment/status' ? ['payment-status-poll', 300, 60] as const
    : c.req.method === 'POST' && c.req.path.startsWith('/api/device-agent/') && c.req.path !== '/api/device-agent/register' ? ['device-agent-api', 240, 60] as const
    : null
  const agentRegistrationRule = c.req.path === '/api/device-agent/register' && c.req.method === 'POST'
    ? ['device-agent-register', 10, 900] as const
    : null
  // 支付 Webhook 一律不参与限流：Stripe / Square 会按自己的退避策略重放同一条事件，
  // 一旦被 429 就变成「已收款未入账」。它们的保护手段是签名校验 + 事件幂等。
  const isWebhook = ['/webhooks/stripe', '/webhooks/square', '/webhooks/tally'].includes(c.req.path)
  const activeRateRule = isWebhook ? null : (rateRule || agentRegistrationRule)
  if (activeRateRule && !await enforceRateLimit(c, activeRateRule[0], ip, activeRateRule[1], activeRateRule[2])) return c.text('请求过于频繁，请稍后再试', 429)
  await next()
});

app.use('*', async (c, next) => {
  try {
    await next()
  } catch (error) {
    console.error('Server Error:', errorDetails(error))
    return c.html(renderServerError(), 500)
  }
})

// 搜索需要先经过会话、访客限制与限流中间件。
app.get('/api/search', handleGlobalSearch)

app.notFound((c) => {
  return c.html(renderNotFound(), 404)
})

app.onError((error, c) => {
  console.error('Unhandled Application Error:', errorDetails(error))
  const statusCode = error.status || 500
  switch (statusCode) {
    case 401:
      return c.html(renderUnauthorized(), 401)
    case 403:
      return c.html(renderForbidden(), 403)
    case 404:
      return c.html(renderNotFound(), 404)
    case 502:
      return c.html(renderBadGateway(), 502)
    case 503:
      return c.html(renderServiceUnavailable(), 503)
    default:
      return c.html(renderServerError(), 500)
  }
})



app.get('/', async (c) => {
  const user = c.get('user')
  if (!user) {
    return c.redirect('/login')
  }
  if (user.role === 'CUSTOMER') return c.redirect(user.accountType === 'guest' ? '/customer/guest' : '/customer/dashboard')
  if (user.role === 'STAFF') return c.redirect(isMobileDeviceRequest(c) ? '/staff/mobile' : '/staff/dashboard')
  return c.redirect(isMobileDeviceRequest(c) ? '/staff/mobile' : '/admin/dashboard')
})

app.get('/login', async (c) => {
  const user = c.get('user')
  if (user) {
    return c.redirect('/')
  }
  const deletedMessage = c.req.query('deletion_requested') === '1' ? '账户删除申请已提交，进入 7 天冷静期；您已退出登录。7 天内重新登录可取消删除。' : undefined
  const message = c.req.query('reset') === '1' ? '密码已重置，请使用新密码登录。' : deletedMessage
  // 登录页左侧配图与公司名来自系统设置（管理员在 /admin/settings 上传）。
  await loadSystemSettingsFromDB(c)
  const companyDetails = getSystemSettings().companyDetails
  return c.html(pages.renderLogin(message, shouldShowTestAccounts(c), sanitizeRedirectPath(c.req.query('redirect'), ''), companyDetails.loginImage || '', companyDetails.name || 'PC Rental'))
})

app.get('/contact', async (c) => {
  return c.html(pages.renderTallyInquiryForm())
})

app.get('/feedback', async (c) => {
  await loadSystemSettingsFromDB(c)
  const user = c.get('user')
  const feedbackToken = user?.role === 'CUSTOMER' && user.accountType !== 'guest' && c.env.SETTINGS_ENCRYPTION_KEY
    ? await createTallyFeedbackToken(String(c.env.SETTINGS_ENCRYPTION_KEY || ''), user.id)
    : ''
  return c.html(pages.renderTallyForm(getSystemSettings().tallyFormUrl, feedbackToken))
})

app.get('/feedback/thanks', (c) => {
  return c.html(pages.renderTallyFeedbackThanks())
})

app.get('/feedback/thanks', (c) => {
  return c.html(pages.renderTallyFeedbackThanks())
})

app.post('/login', async (c) => {
  const form = await c.req.parseBody()
  const account = form.account?.trim()
  const password = form.password?.trim()
  const requestedRedirect = String(form.redirect || '')
  const redirectPath = sanitizeRedirectPath(requestedRedirect, '')
  if (!account || !password) {
    return c.html(pages.renderLogin('请输入账号和密码', shouldShowTestAccounts(c), redirectPath))
  }
  const loginIp = (c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For')?.split(',')[0] || 'unknown').trim().slice(0, 64)
  const normalizedAccount = String(account).toLowerCase().slice(0, 254)
  await ensureLoginAttemptsSchema(c)
  await ensureLoginHistorySchema(c)
  const recentFailures = await c.env.RENT.prepare("SELECT COUNT(*) count, MAX(attempted_at) latest FROM login_attempts WHERE ip_address = ? AND account = ? AND attempted_at > datetime('now', '-30 minutes')").bind(loginIp, normalizedAccount).first() as any
  const failureCount = Number(recentFailures?.count || 0)
  if (failureCount >= 3 && recentFailures?.latest) {
    const lockMinutes = Math.min(60, failureCount === 3 ? 1 : failureCount + 2)
    const elapsedSeconds = Math.floor((Date.now() - new Date(`${recentFailures.latest}Z`).getTime()) / 1000)
    const remainingSeconds = lockMinutes * 60 - elapsedSeconds
    if (remainingSeconds > 0) {
      const remainingMinutes = Math.ceil(remainingSeconds / 60)
      return c.html(pages.renderLogin(`登录失败次数过多，请 ${remainingMinutes} 分钟后再试`, shouldShowTestAccounts(c), redirectPath), 429)
    }
  }
  const user = await verifyUserCredentials(c, account, password)
  if (!user) {
    await c.env.RENT.prepare('INSERT INTO login_history (user_id, account, ip_address, user_agent, status) VALUES (NULL, ?, ?, ?, \'failure\')').bind(normalizedAccount, loginIp, c.req.header('User-Agent') || '').run()
    await c.env.RENT.prepare('INSERT INTO login_attempts (ip_address, account) VALUES (?, ?)').bind(loginIp, normalizedAccount).run()
    return c.html(pages.renderLogin('账号或密码错误', shouldShowTestAccounts(c), redirectPath))
  }
  // 冷静期内登录视为撤销删除申请。
  if ((user as any).deletion_scheduled_at || (user as any).deletionScheduledAt) {
    try {
      await c.env.RENT.prepare('UPDATE users SET deletion_requested_at = NULL, deletion_scheduled_at = NULL WHERE id = ?').bind(user.id).run()
    } catch (_) { }
  }
  await c.env.RENT.prepare("INSERT INTO login_history (user_id, account, ip_address, user_agent, status) VALUES (?, ?, ?, ?, 'success')").bind(user.id, normalizedAccount, loginIp, c.req.header('User-Agent') || '').run()
  await c.env.RENT.prepare('DELETE FROM login_attempts WHERE ip_address = ? AND account = ?').bind(loginIp, normalizedAccount).run()
  const defaultRedirect = user.role === 'CUSTOMER'
    ? (user.accountType === 'guest' ? '/customer/guest' : '/customer/dashboard')
    : isMobileDeviceRequest(c) ? '/staff/mobile' : user.role === 'STAFF' ? '/staff/dashboard' : '/admin/dashboard'
  const response = c.redirect(redirectPath || defaultRedirect)
  const session = await createAuthSession(c, user.id, form.remember === 'on')
  response.headers.set('Set-Cookie', serializeAuthCookie(session.token, { maxAge: session.maxAge, secure: isSecureRequest(c) }))
  return response
})

app.get('/public/session', websiteSessionStatus)

// 官网（rent-web）单点登录握手。官网已在共享 auth_sessions 建好会话，并签发了一个
// 一次性 token（sso_handoff_tokens，60s 过期、用一次即废）。这里校验后在 rent 域
// 也建立会话 cookie，用户随即进入自己的用户中心，无需再次登录。
// GET + 顶层跳转，不涉及跨站表单 POST，因此不受 POST 同源中间件限制。
app.get('/sso/consume', async (c) => {
  const token = String(c.req.query('t') || '')
  if (!/^[A-Za-z0-9_-]{32,}$/.test(token)) return c.redirect('/login')
  await c.env.RENT.prepare(`CREATE TABLE IF NOT EXISTS sso_handoff_tokens (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`).run()
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  const tokenHash = Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, '0')).join('')
  const row = await c.env.RENT
    .prepare('SELECT user_id FROM sso_handoff_tokens WHERE token_hash = ? AND expires_at > CURRENT_TIMESTAMP LIMIT 1')
    .bind(tokenHash)
    .first() as { user_id?: string } | null
  // 单次使用：命中与否都立即销毁；顺带清掉过期行。
  c.executionCtx.waitUntil(
    c.env.RENT.batch([
      c.env.RENT.prepare('DELETE FROM sso_handoff_tokens WHERE token_hash = ?').bind(tokenHash),
      c.env.RENT.prepare("DELETE FROM sso_handoff_tokens WHERE expires_at <= CURRENT_TIMESTAMP"),
    ]).then(() => undefined).catch(() => undefined),
  )
  if (!row?.user_id) return c.redirect('/login')
  const activeUser = await c.env.RENT
    .prepare("SELECT id FROM users WHERE id = ? AND status = 'active' AND account_type = 'formal' LIMIT 1")
    .bind(String(row.user_id))
    .first() as { id?: string } | null
  if (!activeUser?.id) return c.redirect('/login')
  const session = await createAuthSession(c, String(activeUser.id))
  const response = c.redirect('/')
  response.headers.set('Set-Cookie', serializeAuthCookie(session.token, { maxAge: session.maxAge, secure: isSecureRequest(c) }))
  return response
})

app.get('/register', async (c) => {
  const user = c.get('user')
  if (user) {
    return c.redirect('/')
  }
  const referralCode = String(c.req.query('ref') || '').trim().toUpperCase().slice(0, 10)
  return c.html(pages.renderRegister(undefined, await getTurnstileSiteKey(c), referralCode))
})

app.get('/ref/:code', async (c) => {
  const code = String(c.req.param('code') || '').trim().toUpperCase()
  if (!code || !await findUserByReferralCode(c, code)) return c.redirect('/register?error=invalid_referral')
  const response = c.redirect(`/register?ref=${encodeURIComponent(code)}`)
  response.headers.append('Set-Cookie', `referral_code=${encodeURIComponent(code)}; Path=/; SameSite=Lax; Max-Age=${30 * 24 * 60 * 60}${new URL(c.req.url).protocol === 'https:' ? '; Secure' : ''}`)
  return response
})

async function ensureEmailVerificationSchema(c: any) {
  await c.env.RENT.prepare(`CREATE TABLE IF NOT EXISTS email_verifications (id TEXT PRIMARY KEY NOT NULL, user_id TEXT NOT NULL, email TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, sent_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, expires_at TEXT NOT NULL, verified_at TEXT)`).run()
}

async function sendEmailVerification(c: any, user: any) {
  await ensureEmailVerificationSchema(c)
  const token = nanoid(48)
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  const tokenHash = Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('')
  const now = new Date()
  const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString()
  const eventKey = `email-verification:${user.id}:${tokenHash}`
  await c.env.RENT.prepare('INSERT INTO email_verifications (id, user_id, email, token_hash, sent_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)').bind(nanoid(), user.id, user.email, tokenHash, now.toISOString(), expiresAt).run()
  const claimed = await c.env.RENT.prepare("INSERT OR IGNORE INTO email_events (id, event_type, recipient, idempotency_key, status) VALUES (?, 'EMAIL_VERIFICATION', ?, ?, 'PENDING')").bind(`email-${nanoid(12)}`, user.email, eventKey).run() as any
  if (!claimed.meta?.changes) return
  const { provider, apiKey, from } = await resolveEmailCredentials(c)
  if ((provider !== 'smtp' && !apiKey) || !from) { await c.env.RENT.prepare("UPDATE email_events SET status = 'SKIPPED', error_message = 'Email transport is not configured' WHERE idempotency_key = ?").bind(eventKey).run(); return }
  const verifyUrl = `${new URL(c.req.url).origin}/verify-email?token=${encodeURIComponent(token)}`
  const result = await sendTransactionalEmail(c, { to: user.email, subject: '验证您的邮箱 - PC Rental', text: `您好 ${user.name}，请在 24 小时内打开以下链接验证邮箱：\n${verifyUrl}` })
  await c.env.RENT.prepare("UPDATE email_events SET status = ?, provider_message_id = ?, error_message = ?, sent_at = CASE WHEN ? THEN CURRENT_TIMESTAMP END WHERE idempotency_key = ?").bind(result.ok ? 'SENT' : 'FAILED', result.id, result.error, result.ok ? 1 : 0, eventKey).run()
}

// 公开法务页面。metaKey 与 legalMetadata 的键一致；varPrefix 生成 `${prefix}_version`
// 与 `${prefix}_last_updated_date` 两个模板变量，供文档正文引用。
const PUBLIC_LEGAL_PAGES: Array<{ paths: string[]; title: string; key: SystemSettingsKey; keyEn: SystemSettingsKey; code: string; metaKey: string; varPrefix: string }> = [
  { paths: ['/terms', '/user-terms'], title: '用户协议', key: 'userTerms', keyEn: 'userTermsEn', code: 'LEGAL / USER TERMS', metaKey: 'user', varPrefix: 'user_terms' },
  { paths: ['/service-terms'], title: '服务条款', key: 'serviceTerms', keyEn: 'serviceTermsEn', code: 'LEGAL / SERVICE TERMS', metaKey: 'service', varPrefix: 'service_terms' },
  { paths: ['/privacy'], title: '隐私政策', key: 'privacyPolicy', keyEn: 'privacyPolicyEn', code: 'LEGAL / PRIVACY', metaKey: 'privacy', varPrefix: 'privacy_policy' },
  { paths: ['/software-terms'], title: '软件使用协议', key: 'softwareTerms', keyEn: 'softwareTermsEn', code: 'LEGAL / SOFTWARE', metaKey: 'software', varPrefix: 'software_terms' },
  { paths: ['/refund-policy', '/copyright'], title: '退款政策', key: 'copyrightNotice', keyEn: 'copyrightNoticeEn', code: 'LEGAL / REFUND POLICY', metaKey: 'copyright', varPrefix: 'refund_policy' },
  { paths: ['/cookies', '/cookie-policy'], title: 'Cookie 政策', key: 'cookiePolicy', keyEn: 'cookiePolicyEn', code: 'LEGAL / COOKIE POLICY', metaKey: 'cookie', varPrefix: 'cookie_policy' },
  { paths: ['/complaints', '/dispute-resolution'], title: '投诉与争议解决政策', key: 'complaintsPolicy', keyEn: 'complaintsPolicyEn', code: 'LEGAL / COMPLAINTS', metaKey: 'complaints', varPrefix: 'complaints_policy' },
  { paths: ['/acceptable-use', '/aup'], title: '可接受使用政策', key: 'acceptableUsePolicy', keyEn: 'acceptableUsePolicyEn', code: 'LEGAL / ACCEPTABLE USE', metaKey: 'aup', varPrefix: 'acceptable_use_policy' },
  { paths: ['/consumer-rights'], title: '澳大利亚消费者法下的权利', key: 'consumerRights', keyEn: 'consumerRightsEn', code: 'LEGAL / CONSUMER RIGHTS', metaKey: 'consumer', varPrefix: 'consumer_rights' },
]
// English blocks are unofficial machine-translation placeholders (see the
// admin editor at /admin/templates/:kind): both language blocks are rendered
// server-side and src/lib/i18n.ts toggles which one is visible client-side,
// since there is no per-request language signal (language is a client-only
// localStorage preference).
for (const { paths, title, key, keyEn, code, metaKey, varPrefix } of PUBLIC_LEGAL_PAGES) {
  app.on('GET', paths, async (c) => {
    const settings = await loadSystemSettingsFromDB(c)
    const currentUser = c.get('user')
    const metadata = (settings.legalMetadata as Record<string, { version: string; lastUpdatedDate: string }>)[metaKey] || { version: '1.0', lastUpdatedDate: '' }
    const templateVars = {
      [`${varPrefix}_version`]: metadata.version,
      [`${varPrefix}_last_updated_date`]: metadata.lastUpdatedDate,
      ...(metaKey === 'copyright' ? { last_updated_date: metadata.lastUpdatedDate } : {}),
    }
    const content = renderSiteVariables(String((settings as any)[key] ?? ''), currentUser, templateVars)
    const contentEn = renderSiteVariables(String((settings as any)[keyEn] ?? ''), currentUser, templateVars)
    const body = `<div class="legal-document__content legal-lang" data-lang="zh" data-i18n-ignore>${content}</div>
<div class="legal-document__content legal-lang" data-lang="en" data-i18n-ignore hidden>
<p class="legal-disclaimer">⚠️ Unofficial machine-translated version for reference only — the Chinese original is the legally governing text.</p>
${contentEn || '<p>An English version of this document has not been provided yet. Please refer to the Chinese original above.</p>'}
</div>`
    return c.html(buildLayout(title, `<article class="panel legal-document"><div class="section-title"><div><p class="section-code">${code}</p><h2>${title}</h2></div></div>${body}</article>`, currentUser))
  })
}

// 租赁协议范本（签署前查阅）。rentalTerms 含大量合同变量：能从系统设置解析的
// （协议版本、管辖地、GST、公司与收款账户信息）在此填充，与签署流程里的
// renderContractVariables 取值保持一致；仅属于具体订单的字段（承租方、设备、
// 租期、金额、签署时间等）留作 —— 空位，页面顶部注明以签署合同为准。
app.on('GET', ['/rental-terms', '/rental-agreement'], async (c) => {
  const settings = await loadSystemSettingsFromDB(c)
  const currentUser = c.get('user')
  const metadata = (settings.legalMetadata as Record<string, { version: string; lastUpdatedDate: string }>).rental || { version: '1.0', lastUpdatedDate: '' }
  const templateVars = {
    rental_agreement_version: metadata.version,
    rental_agreement_last_updated_date: metadata.lastUpdatedDate,
    jurisdiction: 'VIC',
    gst_included: settings.companyDetails.gstIncluded ? '是' : '否',
    bank_name: settings.bankDetails.bankName,
    bank_bsb: settings.bankDetails.bsb,
    bank_account: settings.bankDetails.account,
    account_name: settings.bankDetails.accountName,
  }
  const content = neutralizeTemplateTokens(renderSiteVariables(String(settings.rentalTerms ?? ''), currentUser, templateVars))
  const contentEn = neutralizeTemplateTokens(renderSiteVariables(String(settings.rentalTermsEn ?? ''), currentUser, templateVars))
  const notice = '<p class="section-note">以下为标准《设备租赁协议》范本，供签署前查阅。带 —— 的位置将在您下单后按实际合同数据填写；最终以您签署的租赁合同为准。</p>'
  const body = `<div class="legal-document__content legal-lang" data-lang="zh" data-i18n-ignore>${content}</div>
<div class="legal-document__content legal-lang" data-lang="en" data-i18n-ignore hidden>
<p class="legal-disclaimer">⚠️ Unofficial machine-translated version for reference only — the Chinese original is the legally governing text.</p>
${contentEn || '<p>An English version of this document has not been provided yet. Please refer to the Chinese original above.</p>'}
</div>`
  return c.html(buildLayout('设备租赁协议', `<article class="panel legal-document"><div class="section-title"><div><p class="section-code">LEGAL / RENTAL AGREEMENT</p><h2>设备租赁协议</h2></div></div>${notice}${body}</article>`, currentUser))
})

app.post('/register', async (c) => {
  const form = await c.req.parseBody()
  const { firstName, lastName, email, password, passwordConfirm, referrer, countryCode, phone } = form
  const cookieReferral = (c.req.header('cookie') || '').match(/(?:^|;\s*)referral_code=([^;]+)/)?.[1] || ''
  const suppliedReferral = decodeURIComponent(String(referrer || cookieReferral || '')).trim().toUpperCase().slice(0, 10)
  const { siteKey: turnstileSiteKey, secretKey: turnstileSecret } = await getTurnstileRuntimeConfig(c)
  const renderRegistrationError = (message: string) => pages.renderRegister(message, turnstileSiteKey, suppliedReferral)
  const turnstileToken = String(form['cf-turnstile-response'] || '')
  if (!turnstileSecret || !turnstileToken) return c.html(renderRegistrationError('请先完成人机验证。'), 400)
  const turnstileResult = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ secret: turnstileSecret, response: turnstileToken, remoteip: c.req.header('CF-Connecting-IP') }) }).then(r => r.json()).catch(() => ({ success: false })) as any
  if (!turnstileResult.success) return c.html(renderRegistrationError('人机验证失败，请重试。'), 400)
  const name = combinePersonName(firstName, lastName)

  if (!String(firstName || '').trim() || !String(lastName || '').trim() || !email?.trim() || !password?.trim() || !passwordConfirm?.trim() || !phone?.trim()) {
    return c.html(renderRegistrationError('请输入完整注册信息'))
  }
  if (password !== passwordConfirm) {
    return c.html(renderRegistrationError('两次输入密码不一致'))
  }
  if (!isStrongPassword(password)) return c.html(renderRegistrationError('密码至少需要 8 位，并同时包含字母、数字和符号'))

  // 检查邮箱是否已存在
  const existingUser = await findUserByEmail(c, email)
  if (existingUser) {
    return c.html(renderRegistrationError('该电子邮箱已被注册'))
  }

  // 处理推荐人
  let referrerId = null;
  if (suppliedReferral) {
    const referrerUser = await findUserByReferralCode(c, suppliedReferral)
    if (referrerUser) {
      referrerId = referrerUser.id;
    } else {
      return c.html(renderRegistrationError('无效的推荐码'))
    }
  }

  const newUserId = await generateUniqueUserId(c, 'CUSTOMER')
  const fullPhone = `${countryCode}${phone}`
  const newUser = {
    id: newUserId,
    name,
    email: email.trim(),
    phone: fullPhone,
    passwordHash: await hashPassword(password),
    role: 'CUSTOMER' as const,
    balance: 0,
    commissionBalance: 0,
    referrerId: referrerId,
    createdAt: new Date().toISOString(),
    status: 'active' as const
  }

  await insertUser(c, newUser)
  await lockReferralRelationship(c, referrerId, newUserId, suppliedReferral)
  // 协议确认记录独立保存，不写入协议正文或合同内容。
  for (const [column, definition] of [
    ['user_agreement_accepted', 'INTEGER NOT NULL DEFAULT 0'],
    ['user_agreement_version', 'TEXT'],
    ['user_agreement_accepted_at', 'TEXT'],
    ['user_agreement_accepted_ip', 'TEXT'],
    ['privacy_policy_version', 'TEXT'],
    ['privacy_policy_accepted_at', 'TEXT'],
    ['privacy_policy_accepted', 'INTEGER NOT NULL DEFAULT 0'],
    ['service_terms_accepted', 'INTEGER NOT NULL DEFAULT 0'],
    ['service_terms_version', 'TEXT'],
    ['service_terms_accepted_at', 'TEXT'],
    ['service_terms_accepted_ip', 'TEXT'],
    ['refund_policy_accepted', 'INTEGER NOT NULL DEFAULT 0'],
    ['refund_policy_version', 'TEXT'],
    ['refund_policy_accepted_at', 'TEXT'],
    ['refund_policy_accepted_ip', 'TEXT'],
  ] as const) {
    try { await c.env.RENT.prepare(`ALTER TABLE users ADD COLUMN ${sqlIdentifier(column)} ${definition}`).run() } catch (_) { }
  }
  const acceptedAt = new Date().toISOString()
  const acceptedIp = c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For')?.split(',')[0].trim() || null
  await c.env.RENT.prepare(`UPDATE users SET user_agreement_accepted = 1, user_agreement_version = ?, user_agreement_accepted_at = ?, user_agreement_accepted_ip = ?, service_terms_accepted = 1, service_terms_version = ?, service_terms_accepted_at = ?, service_terms_accepted_ip = ?, privacy_policy_accepted = 1, privacy_policy_version = ?, privacy_policy_accepted_at = ?, privacy_policy_accepted_ip = ?, refund_policy_accepted = 1, refund_policy_version = ?, refund_policy_accepted_at = ?, refund_policy_accepted_ip = ? WHERE id = ?`)
    .bind('1.0', acceptedAt, acceptedIp, '1.0', acceptedAt, acceptedIp, '1.0', acceptedAt, acceptedIp, '1.0', acceptedAt, acceptedIp, newUserId).run()

  // 注册验证邮件的发送由独立接口处理，服务端统一限制 60 秒内只能发送一次。
  await sendEmailVerification(c, newUser)

  // 自动登录
  await loadSystemSettingsFromDB(c)
  const response = c.redirect(getSystemSettings().registrationSettings?.requireEmailVerification
    ? `/verify-email/pending?email=${encodeURIComponent(newUser.email)}`
    : '/customer/dashboard')
  if (!getSystemSettings().registrationSettings?.requireEmailVerification) {
    const session = await createAuthSession(c, newUserId)
    response.headers.set('Set-Cookie', serializeAuthCookie(session.token, { maxAge: session.maxAge, secure: isSecureRequest(c) }))
  }

  return response
})

app.get('/verify-email/pending', async (c) => {
  const email = String(c.req.query('email') || '')
  const body = `<div class="panel" style="max-width:560px;margin:40px auto"><h2>请验证您的邮箱</h2><p>验证邮件已发送至 <strong>${email.replace(/[<>]/g, '')}</strong>，请打开邮件中的链接完成验证。</p><form method="post" action="/register/resend-verification"><input type="hidden" name="email" value="${email.replace(/"/g, '&quot;')}"><button class="button" id="resendVerification" type="submit" disabled>60 秒后可重新发送</button></form><p class="form-text">如果没有收到邮件，请检查垃圾邮件文件夹。</p><script>let s=60,b=document.getElementById('resendVerification');const t=setInterval(()=>{s--;b.textContent=s>0?s+' 秒后可重新发送':'重新发送验证邮件';if(s<=0){b.disabled=false;clearInterval(t)}},1000)</script></div>`
  return c.html(buildLayout('验证邮箱', body))
})

app.post('/register/resend-verification', async (c) => {
  const form = await c.req.parseBody()
  const email = String(form.email || '').trim().toLowerCase()
  if (!email) return c.text('请输入邮箱地址', 400)
  await ensureEmailVerificationSchema(c)
  const user = await findUserByEmail(c, email)
  if (!user) return c.text('如果该邮箱已注册，验证邮件将发送到您的邮箱。', 200)
  const latest = await c.env.RENT.prepare("SELECT sent_at FROM email_verifications WHERE user_id = ? ORDER BY sent_at DESC LIMIT 1").bind(user.id).first() as any
  if (latest?.sent_at && Date.now() - new Date(String(latest.sent_at).replace(' ', 'T') + 'Z').getTime() < 60000) return c.text('验证邮件已发送，请 60 秒后再试。', 429)
  await sendEmailVerification(c, user)
  return c.text('验证邮件已重新发送，请查收。', 200)
})

app.get('/verify-email', async (c) => {
  const token = String(c.req.query('token') || '')
  if (!token) return c.html(buildLayout('邮箱验证', '<div class="panel"><h2>验证链接无效</h2><p>请使用邮件中的完整链接。</p></div>'), 400)
  await ensureEmailVerificationSchema(c)
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  const tokenHash = Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('')
  const row = await c.env.RENT.prepare("SELECT * FROM email_verifications WHERE token_hash = ? AND verified_at IS NULL AND expires_at > CURRENT_TIMESTAMP ORDER BY sent_at DESC LIMIT 1").bind(tokenHash).first() as any
  if (!row) return c.html(buildLayout('邮箱验证', '<div class="panel"><h2>验证链接已失效</h2><p>请重新发送验证邮件。</p></div>'), 400)
  await c.env.RENT.prepare('UPDATE email_verifications SET verified_at = CURRENT_TIMESTAMP WHERE id = ?').bind(row.id).run()
  return c.html(buildLayout('邮箱验证', '<div class="panel"><h2>邮箱验证成功</h2><p>您的邮箱已验证，可以登录账户。</p><p><a class="button" href="/login">前往登录</a></p></div>'))
})

app.get('/forgot-password', async (c) => {
  return c.html(pages.renderForgotPassword())
})

app.post('/forgot-password', async (c) => {
  const form = await c.req.parseBody()
  const email = String(form.email || '').trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return c.html(pages.renderForgotPassword('请输入有效的邮箱地址'), 400)
  const user = await findUserByEmail(c, email)
  if (user) {
    await sendPasswordResetEmail(c, user)
  }
  return c.html(pages.renderForgotPassword('如果该邮箱已注册，重置链接将发送到您的邮箱。'))
})

app.get('/reset-password', async (c) => {
  const token = String(c.req.query('token') || '').trim()
  if (!/^[A-Za-z0-9_-]{20,80}$/.test(token)) return c.html(buildLayout('重置密码', '<div class="panel"><h2>重置链接无效</h2><p>请重新申请密码重置链接。</p></div>'), 400)
  return c.html(pages.renderResetPassword(token))
})

app.post('/reset-password', async (c) => {
  const form = await c.req.parseBody()
  const token = String(form.token || '').trim()
  const password = String(form.password || '').trim()
  const passwordConfirm = String(form.passwordConfirm || '').trim()
  if (!/^[A-Za-z0-9_-]{20,80}$/.test(token)) return c.html(buildLayout('重置密码', '<div class="panel"><h2>重置链接无效</h2><p>请重新申请密码重置链接。</p></div>'), 400)
  if (password !== passwordConfirm) return c.html(pages.renderResetPassword(token, '两次输入的密码不一致'), 400)
  if (!isStrongPassword(password)) return c.html(pages.renderResetPassword(token, '密码至少需要 8 位，并同时包含字母、数字和符号'), 400)
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  const tokenHash = Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, '0')).join('')
  const reset = await c.env.RENT.prepare("SELECT * FROM password_resets WHERE token_hash = ? AND used_at IS NULL AND expires_at > CURRENT_TIMESTAMP LIMIT 1").bind(tokenHash).first() as any
  if (!reset) return c.html(buildLayout('重置密码', '<div class="panel"><h2>重置链接已失效</h2><p>请重新申请密码重置链接。</p></div>'), 400)
  await updateUser(c, reset.user_id, { password })
  await c.env.RENT.batch([
    c.env.RENT.prepare('UPDATE password_resets SET used_at = CURRENT_TIMESTAMP WHERE id = ? AND used_at IS NULL').bind(reset.id),
    c.env.RENT.prepare('DELETE FROM auth_sessions WHERE user_id = ?').bind(reset.user_id),
  ])
  return c.redirect('/login?reset=1')
})

const logout = async (c: any) => {
  await deleteAuthSession(c, c.req.header('cookie') ?? null)
  const response = c.redirect('/')
  // 登出要把 Cookie 彻底过期（属性必须与签发时一致，否则部分浏览器会保留旧值）。
  for (const cookie of serializeAuthCookieClear(isSecureRequest(c))) response.headers.append('Set-Cookie', cookie)
  return response
}
app.post('/logout', logout)
// Logout is intentionally POST-only. A GET logout endpoint is CSRFable from
// any page that can embed or link to this site.
app.get('/logout', (c) => c.redirect('/'))

app.get('/customer/dashboard', async (c) => {
  const user = c.get('user')
  if (!user) {
    return c.redirect('/login')
  }
  if (user.role !== 'CUSTOMER') {
    return c.html(renderForbidden(), 403)
  }
  // 客户端控制台只需要当前用户自己的订单；过去 getOrdersAsync 会把整张 orders 表拉回来再在内存里 filter。
  const [orders, devices, account] = await Promise.all([getOrdersForUser(c, user.id), getDevicesAsync(c), c.env.RENT.prepare('SELECT balance FROM users WHERE id = ?').bind(user.id).first()])
  const dashboardUser = { ...user, balance: Number((account as any)?.balance ?? user.balance ?? 0) }
  await ensureNotificationsTable(c)
  const announcementPageSize = 10
  const announcementPageCount = Math.max(1, Math.ceil(Number(((await c.env.RENT.prepare("SELECT COUNT(*) AS count FROM notifications WHERE recipient_id = ? AND type = 'announcement' AND deleted_at IS NULL AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)").bind(user.id).first()) as any)?.count || 0) / announcementPageSize))
  const requestedAnnouncementPage = Math.max(1, Number(c.req.query('announcementPage') || 1) || 1)
  const announcementPage = Math.min(requestedAnnouncementPage, announcementPageCount)
  const announcements = (await c.env.RENT.prepare("SELECT id, title, message, title_en, message_en, created_at FROM notifications WHERE recipient_id = ? AND type = 'announcement' AND deleted_at IS NULL AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP) ORDER BY created_at DESC LIMIT ? OFFSET ?").bind(user.id, announcementPageSize, (announcementPage - 1) * announcementPageSize).all()).results || []
  return c.html(pages.renderCustomerDashboard(dashboardUser, orders, devices, { items: announcements, page: announcementPage, pageCount: announcementPageCount }))
})

app.get('/customer/balance', async (c) => {
  const user = c.get('user')
  if (!user || user.role !== 'CUSTOMER' || user.accountType === 'guest') return c.redirect('/login')
  return c.html(await pages.renderCustomerBalance(c, user))
})

app.get('/customer/balance/top-up', async (c) => {
  const user = c.get('user')
  if (!user || user.role !== 'CUSTOMER' || user.accountType === 'guest') return c.redirect('/login')
  await loadSystemSettingsFromDB(c)
  const pending = await c.env.RENT.prepare("SELECT * FROM balance_topups WHERE user_id = ? AND status = 'awaiting_transfer' ORDER BY created_at DESC LIMIT 1").bind(user.id).first()
  if (pending?.payment_method === 'bank_transfer') pending.transfer_code = await ensureBankTransferReference(c, 'topup', pending.id)
  const payId = String(c.req.query('pay') || '').trim()
  const payTopup = payId ? await c.env.RENT.prepare("SELECT * FROM balance_topups WHERE id = ? AND user_id = ? AND payment_method IN ('card', 'square') AND status = 'pending'").bind(payId, user.id).first() : null
  return c.html(pages.renderCustomerBalanceTopUp(c, user, '', pending, payTopup, c.req.query('success') === '1'))
})

app.get('/api/payment/aud-cny', async (c) => {
  const amount = Number(c.req.query('amount') || 0)
  if (!Number.isFinite(amount) || amount < 1 || amount > 10000) return c.json({ error: '金额无效' }, 400)
  try { const rate = await getAudCnyRate(); return c.json({ rate, cnyAmount: roundCnyUp(amount, rate) }) } catch (error: any) { return c.json({ error: error.message || '汇率暂不可用' }, 503) }
})

app.post('/customer/balance/top-up', async (c) => {
  const user = c.get('user')
  if (!user || user.role !== 'CUSTOMER' || user.accountType === 'guest') return c.html(renderForbidden(), 403)
  await loadSystemSettingsFromDB(c)
  const form = await c.req.parseBody()
  const amountText = String(form.amount || '').trim().replace(/,/g, '')
  const amount = Number(amountText)
  const method = String(form.method || 'card')
  if (!/^\d+(?:\.\d{1,2})?$/.test(amountText) || !Number.isFinite(amount) || amount < 1 || amount > 10000) return c.html(pages.renderCustomerBalanceTopUp(c, user, '请输入 1 至 10,000 AUD 的有效充值金额。'), 400)
  if (!['card', 'square', 'bank_transfer', 'alipay', 'wechat'].includes(method)) return c.html(pages.renderCustomerBalanceTopUp(c, user, '请选择有效的充值方式。'), 400)
  if (method === 'card' && !getSystemSettings().paymentMethods.stripe) return c.html(pages.renderCustomerBalanceTopUp(c, user, '信用卡充值当前未启用。'), 400)
  if (method === 'square' && !getSystemSettings().paymentMethods.square) return c.html(pages.renderCustomerBalanceTopUp(c, user, 'Square 礼品卡支付当前未启用。'), 400)
  if (['alipay', 'wechat'].includes(method) && (!(getSystemSettings().paymentMethods as any)[method] || !getSystemSettings().rmbPayment[`${method}QrUrl`])) return c.text('该人民币支付方式当前未启用', 400)
  const rmbRate = ['alipay', 'wechat'].includes(method) ? await getAudCnyRate().catch(() => null) : null
  if (['alipay', 'wechat'].includes(method) && !rmbRate) return c.text('暂时无法获取实时汇率，请稍后重试', 503)
  const id = `topup-${nanoid(12)}`
  await c.env.RENT.prepare("INSERT INTO balance_topups (id, user_id, amount, payment_method, cny_amount, status) VALUES (?, ?, ?, ?, ?, 'pending')").bind(id, user.id, Number(amount.toFixed(2)), method, rmbRate ? roundCnyUp(amount, rmbRate) : null).run()
  if (['bank_transfer', 'alipay', 'wechat'].includes(method)) {
    if (method === 'bank_transfer') await ensureBankTransferReference(c, 'topup', id)
    await c.env.RENT.prepare("UPDATE balance_topups SET status = 'awaiting_transfer' WHERE id = ?").bind(id).run()
    return c.redirect('/customer/balance/top-up')
  }
  // 信用卡 / Square 礼品卡充值：先落一条 pending 记录，再跳到带 pay 参数的
  // 充值页，由页面拉取 client_secret 就地收款。
  return c.redirect(`/customer/balance/top-up?pay=${encodeURIComponent(id)}`)
})

app.post('/customer/balance/top-up/:id/intent', async (c) => {
  const user = c.get('user')
  if (!user || user.role !== 'CUSTOMER' || user.accountType === 'guest') return c.json({ error: '无权访问' }, 403)
  try {
    const result = await createBalanceTopUpIntent(c, user, c.req.param('id'))
    return c.json({ clientSecret: result.clientSecret, publishableKey: result.publishableKey, amountCents: result.amountCents })
  } catch (error: any) {
    return c.json({ error: error?.message || '无法创建信用卡支付' }, 400)
  }
})

app.get('/customer/balance/top-up/:id/square/config', async (c) => {
  const user = c.get('user')
  if (!user || user.role !== 'CUSTOMER') return c.json({ error: '无权访问' }, 403)
  try {
    return c.json(await getSquareGiftCardConfigForBalanceTopUp(c, user, c.req.param('id')), 200, { 'Cache-Control': 'no-store' })
  } catch (error: any) {
    return c.json({ error: error?.message || '无法读取 Square 配置' }, 400)
  }
})

app.post('/customer/balance/top-up/:id/square/payment', async (c) => {
  const user = c.get('user')
  if (!user || user.role !== 'CUSTOMER') return c.json({ error: '无权访问' }, 403)
  try {
    const body = await c.req.json() as any
    return c.json(await createSquareGiftCardBalanceTopUp(c, user, c.req.param('id'), body?.sourceId))
  } catch (error: any) {
    return c.json({ error: error?.message || '无法创建 礼品卡充值' }, 400)
  }
})

app.post('/customer/balance/top-up/transfer', async (c) => {
  const user = c.get('user')
  if (!user || user.role !== 'CUSTOMER') return c.html(renderForbidden(), 403)
  const form = await c.req.parseBody(); const id = String(form.id || ''); const reference = String(form.reference || '').trim()
  const topup = await c.env.RENT.prepare("SELECT * FROM balance_topups WHERE id = ? AND user_id = ? AND status = 'awaiting_transfer'").bind(id, user.id).first() as any
  if (!topup || !reference) return c.text('充值记录或 Reference 无效', 400)
  let imageUrl = ''
  try { imageUrl = (await resolveImageUrls(form.imageFile, form.imageUrl, c, 'rent/balance-proofs', 1))[0] || '' } catch (error: any) { return c.text(error.message, 400) }
  if (!imageUrl) return c.text('请上传付款凭证图片', 400)
  await c.env.RENT.prepare("UPDATE balance_topups SET reference = ?, note = ?, proof_image_url = ?, status = 'submitted', updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(reference, String(form.note || '').trim(), imageUrl || null, id).run()
  return c.redirect('/customer/balance')
})

app.post('/customer/balance/top-up/cancel', async (c) => {
  const user = c.get('user')
  if (!user || user.role !== 'CUSTOMER' || user.accountType === 'guest') return c.html(renderForbidden(), 403)
  const form = await c.req.parseBody()
  const id = String(form.id || '').trim()
  const next = String(form.next || '') === 'balance' ? '/customer/balance' : '/customer/balance/top-up'
  const result = await c.env.RENT.prepare("UPDATE balance_topups SET status = 'failed', note = CASE WHEN note IS NULL OR note = '' THEN '客户已取消待付款充值' ELSE note || '；客户已取消待付款充值' END, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ? AND status = 'awaiting_transfer'").bind(id, user.id).run()
  if (!result.meta?.changes) return c.redirect('/customer/balance/top-up')
  return c.redirect(next)
})

app.post('/admin/users/:id/balance-adjust', async (c) => {
  const admin = c.get('user')
  if (!admin || admin.role !== 'ADMIN') return c.redirect('/login')
  const target = await getUserById(c, c.req.param('id'))
  if (!target) return c.text('用户不存在', 404)
  const form = await c.req.parseBody()
  const amount = Number(String(form.amount || '').trim())
  const reason = String(form.reason || '').trim()
  if (!Number.isFinite(amount) || amount === 0) return c.text('余额变动金额必须不为 0', 400)
  if (!reason) return c.text('管理员调整余额必须填写原因', 400)
  const result = await c.env.RENT.prepare('UPDATE users SET balance = ROUND(balance + ?, 2), updated_at = CURRENT_TIMESTAMP WHERE id = ? AND ROUND(balance + ?, 2) >= 0 RETURNING balance').bind(amount, target.id, amount).first() as any
  if (!result) return c.text('扣减后余额不能小于 0，或余额已被其他操作更新，请重试', 409)
  const next = Number(result.balance)
  await c.env.RENT.prepare('INSERT INTO balance_transactions (id, user_id, amount, balance_after, type, reason, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(`bt-${crypto.randomUUID()}`, target.id, amount, next, amount > 0 ? 'admin_credit' : 'admin_debit', reason, admin.id).run()
  return c.redirect(`/admin/users/${target.id}`)
})

app.get('/admin/users/:id/identity', async (c) => {
  const admin = c.get('user')
  if (!admin || admin.role !== 'ADMIN') return c.html(renderForbidden(), 403)
  const target = await getUserById(c, c.req.param('id'))
  if (!target || target.role !== 'CUSTOMER') return c.text('客户不存在', 404)
  const { results = [] } = await c.env.RENT.prepare('SELECT status, verification_method, document_last4, rejection_reason, verified_at, created_at FROM identity_verification_records WHERE customer_id = ? ORDER BY created_at DESC LIMIT 20').bind(target.id).all() as any
  const history = results.map((row: any) => `<tr><td>${sanitizePlainText(row.status, 30)}</td><td>${sanitizePlainText(row.verification_method || '—', 80)}</td><td>${row.document_last4 ? `****${sanitizePlainText(row.document_last4, 4)}` : '—'}</td><td>${sanitizePlainText(row.rejection_reason || '—', 500)}</td><td>${sanitizePlainText(row.verified_at || row.created_at, 40)}</td></tr>`).join('') || '<tr><td colspan="5">暂无身份验证记录</td></tr>'
  const body = `<div class="panel"><div class="section-title"><div><h2>身份验证 · ${sanitizePlainText(target.name, 100)}</h2><p>仅保存证件末四位；完整证件资料不在系统页面或日志中显示。</p></div><a class="button button-secondary" href="/admin/users/${encodeURIComponent(target.id)}">返回客户</a></div><form method="post" action="/admin/users/${encodeURIComponent(target.id)}/identity-status" class="form-grid"><label>状态<select class="form-control" name="status" required><option value="PENDING">待审核</option><option value="VERIFIED">已验证</option><option value="REJECTED">已拒绝</option><option value="EXPIRED">已过期</option><option value="NOT_REQUIRED">无需验证</option></select></label><label>验证方式<input class="form-control" name="method" maxlength="80" placeholder="例如：人工核验"></label><label>证件末四位<input class="form-control" name="documentLast4" inputmode="numeric" maxlength="4"></label><label style="grid-column:1/-1">拒绝原因（拒绝时必填）<textarea class="form-control" name="rejectionReason" maxlength="500"></textarea></label><button class="button button-primary">保存身份验证</button></form><div class="table-wrapper"><table><thead><tr><th>状态</th><th>方式</th><th>证件</th><th>原因</th><th>时间</th></tr></thead><tbody>${history}</tbody></table></div></div>`
  return c.html(buildLayout('身份验证', body, admin))
})

app.post('/admin/users/:id/identity-status', async (c) => {
  const admin = c.get('user')
  if (!admin || admin.role !== 'ADMIN') return c.html(renderForbidden(), 403)
  const target = await getUserById(c, c.req.param('id'))
  if (!target || target.role !== 'CUSTOMER') return c.text('客户不存在', 404)
  const form = await c.req.parseBody()
  const status = String(form.status || '')
  const last4 = String(form.documentLast4 || '').replace(/\D/g, '').slice(-4)
  const method = String(form.method || '').trim().slice(0, 80)
  const rejectionReason = String(form.rejectionReason || '').trim().slice(0, 500)
  if (!['NOT_REQUIRED', 'PENDING', 'VERIFIED', 'REJECTED', 'EXPIRED'].includes(status)) return c.text('身份验证状态无效', 400)
  if (status === 'REJECTED' && !rejectionReason) return c.text('拒绝身份验证必须填写原因', 400)
  const legacyStatus = status === 'REJECTED' ? 'FAILED' : status
  await c.env.RENT.batch([
    c.env.RENT.prepare("UPDATE users SET identity_status = ?, identity_document_last4 = ?, identity_verified_at = CASE WHEN ? = 'VERIFIED' THEN CURRENT_TIMESTAMP ELSE identity_verified_at END, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(legacyStatus, last4 || null, status, target.id),
    c.env.RENT.prepare('INSERT INTO identity_verification_records (id, customer_id, status, verification_method, document_last4, rejection_reason, verified_by, verified_at) VALUES (?, ?, ?, ?, ?, ?, ?, CASE WHEN ? = \'VERIFIED\' THEN CURRENT_TIMESTAMP END)').bind(`ivr-${nanoid(12)}`, target.id, status, method || null, last4 || null, rejectionReason || null, admin.id, status),
  ])
  await createAuditLog(c, { actor: admin, action: 'IDENTITY_STATUS_UPDATED', targetType: 'USER', targetId: target.id, before: { status: (target as any).identityStatus }, after: { status, documentLast4: last4 ? `****${last4}` : null, method }, reason: rejectionReason || undefined })
  return c.redirect(`/admin/users/${target.id}`, 303)
})

app.get('/admin/users/:id/risk', async (c) => {
  const admin = c.get('user')
  if (!admin || !['MANAGER', 'ADMIN'].includes(getAccessLevel(admin))) return c.html(renderForbidden(), 403)
  const target = await getUserById(c, c.req.param('id'))
  if (!target || target.role !== 'CUSTOMER') return c.text('客户不存在', 404)
  const [activeFlags, history] = await Promise.all([
    c.env.RENT.prepare("SELECT * FROM risk_flags WHERE customer_id = ? AND status = 'ACTIVE' ORDER BY created_at DESC").bind(target.id).all().then(r => r.results || []),
    c.env.RENT.prepare("SELECT * FROM risk_flags WHERE customer_id = ? AND status = 'RESOLVED' ORDER BY created_at DESC LIMIT 50").bind(target.id).all().then(r => r.results || []),
  ])
  const riskAssessment = await getCustomerRiskAssessment(c, target.id)
  return c.html(pages.renderAdminRiskFlags(admin, target, activeFlags as any[], history as any[], riskAssessment))
})

app.post('/admin/users/:id/risk', async (c) => {
  const admin = c.get('user')
  if (!admin || !['MANAGER', 'ADMIN'].includes(getAccessLevel(admin))) return c.html(renderForbidden(), 403)
  const target = await getUserById(c, c.req.param('id'))
  if (!target || target.role !== 'CUSTOMER') return c.text('客户不存在', 404)
  const form = await c.req.parseBody()
  const flagType = String(form.flagType || '')
  const severity = ['LOW', 'MEDIUM', 'HIGH'].includes(String(form.severity)) ? String(form.severity) : 'MEDIUM'
  const reason = String(form.reason || '').trim().slice(0, 500)
  const evidence = String(form.evidence || '').trim().slice(0, 1000) || null
  if (!(RISK_FLAG_TYPES as readonly string[]).includes(flagType) || !reason) return c.text('请选择有效的风险类型并填写原因', 400)
  const flagId = `rf-${nanoid(12)}`
  await c.env.RENT.prepare('INSERT INTO risk_flags (id, customer_id, flag_type, severity, reason, evidence, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(flagId, target.id, flagType, severity, reason, evidence, admin.id).run()
  await createAuditLog(c, { actor: admin, action: 'RISK_FLAG_CREATED', targetType: 'USER', targetId: target.id, after: { flagType, severity, reason }, reason })
  return c.redirect(`/admin/users/${encodeURIComponent(target.id)}/risk`, 303)
})

app.post('/admin/users/:id/risk/:flagId/resolve', async (c) => {
  const admin = c.get('user')
  if (!admin || !['MANAGER', 'ADMIN'].includes(getAccessLevel(admin))) return c.html(renderForbidden(), 403)
  const form = await c.req.parseBody()
  const resolutionReason = String(form.resolutionReason || '').trim().slice(0, 500)
  if (!resolutionReason) return c.text('解除风险标记必须填写原因', 400)
  const result = await c.env.RENT.prepare("UPDATE risk_flags SET status = 'RESOLVED', resolved_by = ?, resolved_at = CURRENT_TIMESTAMP, resolution_reason = ? WHERE id = ? AND customer_id = ? AND status = 'ACTIVE'")
    .bind(admin.id, resolutionReason, c.req.param('flagId'), c.req.param('id')).run()
  if (!result.meta?.changes) return c.text('风险标记不存在或已解除', 409)
  await createAuditLog(c, { actor: admin, action: 'RISK_FLAG_RESOLVED', targetType: 'USER', targetId: c.req.param('id'), after: { flagId: c.req.param('flagId') }, reason: resolutionReason })
  return c.redirect(`/admin/users/${encodeURIComponent(c.req.param('id'))}/risk`, 303)
})

app.post('/admin/balance-topups/:id/approve', async (c) => {
  const admin = c.get('user'); if (!admin || admin.role !== 'ADMIN') return c.redirect('/login')
  const topup = await c.env.RENT.prepare("SELECT * FROM balance_topups WHERE id = ? AND status = 'submitted'").bind(c.req.param('id')).first() as any
  if (!topup) return c.text('充值记录不存在或已处理', 409)
  const claimed = await c.env.RENT.prepare("UPDATE balance_topups SET status = 'paid', paid_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'submitted'").bind(topup.id).run()
  if (!claimed.meta?.changes) return c.text('充值记录已被其他管理员处理', 409)
  await c.env.RENT.batch([
    c.env.RENT.prepare('UPDATE users SET balance = ROUND(balance + ?, 2), updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(Number(topup.amount), topup.user_id),
    c.env.RENT.prepare("INSERT INTO balance_transactions (id, user_id, amount, balance_after, type, reason, created_by) SELECT ?, ?, ?, ROUND(balance, 2), 'top_up_transfer', ?, ? FROM users WHERE id = ?").bind(`bt-${nanoid(12)}`, topup.user_id, topup.amount, `银行转账充值（${topup.reference || '无 Reference'}）`, admin.id, topup.user_id),
  ])
  await createAuditLog(c, { actor: admin, action: 'BALANCE_TOPUP_APPROVED', targetType: 'BALANCE_TOPUP', targetId: topup.id, after: { amount: topup.amount, userId: topup.user_id } })
  return c.redirect('/admin/exceptions')
})

app.post('/admin/balance-topups/:id/reject', async (c) => {
  const admin = c.get('user'); if (!admin || admin.role !== 'ADMIN') return c.redirect('/login')
  const result = await c.env.RENT.prepare("UPDATE balance_topups SET status = 'failed', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'submitted'").bind(c.req.param('id')).run()
  if (!result.meta?.changes) return c.text('充值记录不存在或已处理', 409)
  return c.redirect('/admin/exceptions')
})

app.get('/customer/guest', async (c) => {
  const user = c.get('user')
  if (!user || user.role !== 'CUSTOMER' || user.accountType !== 'guest') return c.redirect('/login')
  return c.html(await pages.renderGuestAccount(c, user))
})
app.get('/customer/guest/upgrade', async (c) => {
  const user = c.get('user')
  if (!user || user.accountType !== 'guest') return c.redirect('/login')
  return c.html(await pages.renderGuestAccount(c, user, '', 'error', true))
})

app.post('/customer/guest/upgrade', async (c) => {
  const user = c.get('user')
  if (!user || user.role !== 'CUSTOMER' || user.accountType !== 'guest') return c.html(renderForbidden(), 403)
  const form = await c.req.parseBody()
  const password = String(form.newPassword || '')
  const confirmation = String(form.confirmPassword || '')
  if (!isStrongPassword(password)) return c.html(await pages.renderGuestAccount(c, user, '新密码至少需要 8 位，并同时包含字母、数字和符号。'))
  if (password !== confirmation) return c.html(await pages.renderGuestAccount(c, user, '两次输入的新密码不一致。'))
  await updateUser(c, user.id, { password, accountType: 'formal', guestOrderId: null, guestExpiresAt: null })
  return c.redirect('/customer/dashboard?upgraded=1')
})

app.get('/pickup/:orderId', async (c) => {
  const order = await getOrderById(c, c.req.param('orderId'))
  if (!order) return c.html(renderNotFound(), 404)
  const user = c.get('user')
  if (!user) return c.redirect(`/login?redirect=${encodeURIComponent(c.req.path)}`)
  if (['STAFF', 'ADMIN'].includes(user.role)) return c.redirect(`/staff/mobile/scan?code=${encodeURIComponent(c.req.url)}`)
  if (user.role === 'CUSTOMER' && order.userId === user.id) return c.redirect(`/customer/orders/${encodeURIComponent(order.id)}`)
  return c.html(renderForbidden(), 403)
})

app.get('/customer/orders', async (c) => {
  const user = c.get('user')
  if (!user) {
    return c.redirect('/login')
  }
  if (user.role !== 'CUSTOMER') {
    return c.html(renderForbidden(), 403)
  }
  return c.html(await pages.renderCustomerOrders(c, user))
})

app.use('/customer/orders/:id/*', async (c, next) => {
  if (c.req.method === 'POST' && !c.req.path.endsWith('/refund-request')) {
    const user = c.get('user')
    if (user?.role === 'CUSTOMER' && await c.env.RENT.prepare("SELECT id FROM customer_refund_requests WHERE order_id = ? AND customer_id = ? AND status <> 'rejected'").bind(c.req.param('id'), user.id).first()) return c.text('退款申请已提交，请等待审核', 409)
  }
  await next()
})

app.get('/customer/orders/:id', async (c) => {
  const user = c.get('user')
  if (!user) {
    return c.redirect('/login')
  }
  if (user.role !== 'CUSTOMER') {
    return c.html(renderForbidden(), 403)
  }
  await loadSystemSettingsFromDB(c)
  const message = c.req.query('success') || c.req.query('error')
  return c.html(await pages.renderCustomerOrderDetail(c, user, c.req.param('id'), message, c.req.query('success') ? 'success' : 'error'))
})

app.post('/customer/orders/:id/time-slots', async (c) => {
  const user = c.get('user')
  if (!user || user.role !== 'CUSTOMER') return c.redirect('/login')
  const order = await getOrderById(c, c.req.param('id')) as any
  if (!order || order.userId !== user.id || !['paid', 'pending_pickup'].includes(String(order.status))) return c.redirect(`/customer/orders/${c.req.param('id')}`)
  const form = await c.req.parseBody()
  const delivery = String(order.deliveryMethod || order.delivery_method || 'Pickup') === 'Delivery'
  const allowed = delivery ? ['delivery_morning', 'delivery_afternoon'] : ['morning_service', 'morning', 'afternoon', 'evening_service']
  const pickup = String(form.pickupTimeSlot || ''), returned = String(form.returnTimeSlot || '')
  if (!allowed.includes(pickup) || !allowed.includes(returned)) return c.redirect(`/customer/orders/${order.id}?error=${encodeURIComponent('预约时段无效')}`)
  const oldFee = Number(order.serviceFee || order.service_fee || 0)
  const rent = Math.max(0, Number(order.totalAmount) - Number(order.depositAmount || 0) - oldFee)
  const chargeable = delivery ? 0 : [pickup, returned].filter(slot => ['morning_service', 'evening_service'].includes(slot)).length
  await loadSystemSettingsFromDB(c)
  const requestedFee = Number((rent * serviceFeeRate(getSystemSettings().rentalRules) * chargeable).toFixed(2))
  const additionalFee = Math.max(0, requestedFee - oldFee)
  const newFee = oldFee + additionalFee
  await c.env.RENT.prepare('UPDATE orders SET pickupTimeSlot = ?, returnTimeSlot = ?, serviceFee = ?, totalAmount = totalAmount + ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?').bind(pickup, returned, newFee, additionalFee, order.id).run()
  await c.env.RENT.prepare('INSERT INTO order_time_change_history (id, order_id, changed_by, previous_pickup_slot, previous_return_slot, pickup_slot, return_slot, additional_service_fee) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(`otc-${nanoid(12)}`, order.id, user.id, order.pickupTimeSlot || null, order.returnTimeSlot || null, pickup, returned, additionalFee).run()
  await c.env.RENT.prepare("INSERT INTO order_change_history (id, order_id, change_type, before_json, after_json, reason, changed_by) VALUES (?, ?, 'PRICE_ADJUSTMENT', ?, ?, ?, ?)").bind(`och-${nanoid(12)}`, order.id, JSON.stringify({ pickupTimeSlot: order.pickupTimeSlot, returnTimeSlot: order.returnTimeSlot, serviceFee: oldFee, totalAmount: order.totalAmount }), JSON.stringify({ pickupTimeSlot: pickup, returnTimeSlot: returned, serviceFee: newFee, totalAmount: Number(order.totalAmount) + additionalFee }), '客户修改取还时段', user.id).run()
  const message = additionalFee > 0 ? `预约时间已更新，新增服务费 ${additionalFee.toFixed(2)} AUD；已收取的服务费不退款。` : '预约时间已更新；已收取的服务费不退款。'
  return c.redirect(`/customer/orders/${order.id}?success=${encodeURIComponent(message)}`)
})

app.get('/customer/orders/:id/refund-request', async (c) => {
  const user = c.get('user')
  if (!user || user.role !== 'CUSTOMER') return c.redirect(`/login?redirect=${encodeURIComponent(c.req.path)}`)
  return c.html(await pages.renderCustomerRefundConfirm(c, user, c.req.param('id')))
})

app.post('/customer/orders/:id/refund-request', async (c) => {
  const user = c.get('user')
  if (!user || user.role !== 'CUSTOMER') return c.redirect('/login')
  try {
    await actions.submitCustomerRefund(c, user, c.req.param('id'), await c.req.parseBody())
    return c.redirect(`/customer/orders/${encodeURIComponent(c.req.param('id'))}?success=${encodeURIComponent('退款申请已提交')}`, 303)
  } catch (error: any) { return c.text(error.message || '退款申请提交失败', 409) }
})

app.post('/customer/orders/:id/cancel', async (c) => {
  const user = c.get('user')
  if (!user || user.role !== 'CUSTOMER') return c.redirect('/login')
  const orderId = c.req.param('id')
  try {
    await cancelPendingPaymentOrderByCustomer(c, user, orderId)
    return c.redirect(`/customer/orders/${orderId}?success=${encodeURIComponent('订单已取消')}`)
  } catch (error: any) {
    return c.redirect(`/customer/orders/${orderId}?error=${encodeURIComponent(error?.message || '取消失败，请稍后重试')}`)
  }
})

app.post('/customer/orders/:id/early-return', async (c) => {
  const user = c.get('user')
  if (!user || user.role !== 'CUSTOMER') return c.redirect('/login')
  const order = await getOrderById(c, c.req.param('id'))
  if (!order || order.userId !== user.id) return c.html(renderForbidden(), 403)
  if (order.status !== 'active') return c.redirect(`/customer/orders/${order.id}?error=${encodeURIComponent('当前订单不能申请提前归还')}`)
  const customer = await getUserById(c, user.id)
  if (order.early_return_requested_at) return c.redirect(`/customer/orders/${order.id}?error=${encodeURIComponent('提前归还申请已提交，请等待工作人员或管理员审批')}`)
  await c.env.RENT.prepare('UPDATE orders SET early_return_requested_at = CURRENT_TIMESTAMP, early_return_requested_by = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ? AND status = ?').bind(user.id, order.id, 'active').run()
  const admins = (await getUsers(c)).filter((account: any) => account.role === 'ADMIN' && account.status !== 'inactive')
  const recipients = [...(customer?.staffId ? [customer.staffId] : []), ...admins.map((admin: any) => admin.id)].filter((id, index, all) => all.indexOf(id) === index)
  await Promise.all(recipients.map(recipientId => createNotification(c, { recipientId, type: 'early_return_request', title: '客户申请提前归还', message: `${customer?.name || '客户'} 已申请订单 ${order.orderNo || order.id} 提前归还，请审批。`, orderId: order.id })))
  return c.redirect(`/customer/orders/${order.id}?success=${encodeURIComponent('已提交提前归还申请，等待绑定员工或管理员审批')}`)
})

app.post('/staff/orders/:orderId/early-return/approve', async (c) => {
  const user = c.get('user')
  if (!user || !['STAFF', 'ADMIN'].includes(user.role)) return c.html(renderForbidden(), 403)
  const order = await getOrderById(c, c.req.param('orderId')) as any
  if (!order || order.status !== 'active' || !order.early_return_requested_at) return c.text('没有待审批的提前归还申请', 409)
  const customer = await getUserById(c, order.userId)
  if (user.role === 'STAFF' && customer?.staffId !== user.id) return c.html(renderForbidden(), 403)
  await c.env.RENT.batch([
    c.env.RENT.prepare("UPDATE orders SET early_return_approved_at = CURRENT_TIMESTAMP, early_return_approved_by = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ? AND status = 'active' AND early_return_requested_at IS NOT NULL").bind(user.id, order.id),
    c.env.RENT.prepare('INSERT INTO rental_status_history (id, rental_id, old_status, new_status, trigger_type, triggered_by, reason) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(`rsh-${nanoid(16)}`, order.id, order.rental_status || 'ACTIVE', 'RETURN_PENDING', 'MANUAL', user.id, '提前归还申请已批准')
  ])
  await updateOrderStatus(c, order.id, 'pending_return')
  await createNotification(c, { recipientId: order.userId, senderId: user.id, type: 'early_return_approved', title: '提前归还申请已批准', message: `订单 ${order.orderNo || order.id} 的提前归还申请已批准，请按通知安排归还设备。`, orderId: order.id })
  return c.redirect(staffOrderPath(order))
})

app.post('/customer/orders/:id/returned', async (c) => {
  const user = c.get('user')
  if (!user || user.role !== 'CUSTOMER') return c.redirect('/login')
  const order = await getOrderById(c, c.req.param('id'))
  if (!order || order.userId !== user.id) return c.html(renderForbidden(), 403)
  if (order.status !== 'active') return c.redirect(`/customer/orders/${order.id}?error=${encodeURIComponent('当前订单不能提交已归还通知')}`)
  await updateOrderStatus(c, order.id, 'pending_return')
  const customer = await getUserById(c, user.id)
  const admins = (await getUsers(c)).filter((account: any) => account.role === 'ADMIN' && account.status !== 'inactive')
  await Promise.all(admins.map((admin: any) => createNotification(c, { recipientId: admin.id, type: 'returned_review', title: '客户已归还设备，等待审核', message: `${customer?.name || '客户'} 已提交订单 ${order.orderNo || order.id} 的已归还通知，请审核并安排验机。`, orderId: order.id })))
  return c.redirect(`/customer/orders/${order.id}?success=${encodeURIComponent('已通知管理员，等待审核验机')}`)
})

function notificationPreview(message: unknown, limit = 120): string {
  const plain = String(message || '').replace(/[#*_`>\[\]()!-]/g, ' ').replace(/\s+/g, ' ').trim()
  return sanitizePlainText(plain.length > limit ? `${plain.slice(0, limit)}…` : plain, limit + 1)
}

function notificationPlainText(value: unknown): string {
  return sanitizePlainText(String(value || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/(^|\s)[#>*`_~-]+/g, '$1')
    .replace(/\s+/g, ' ')
    .trim(), 10000)
}

function normalizeDisplayedNotification(item: any): string {
  const message = String(item?.message || '')
  if (item?.type !== 'agreement_update') return message
  return message
    .replace(/请登录后查看最新版本/g, '请查看通知详情中的最新版本')
    .replace(/请打开通知详情查看最新版本/g, '请查看通知详情中的最新版本')
    .replace(/([\p{Script=Han}])\s+(?=[\p{Script=Han}])/gu, '$1')
}

// 列表/抽屉里展示一句话摘要；完整条款更新说明只在通知详情页展开。
function notificationListMessage(item: any): string {
  if (item?.type === 'agreement_update') {
    const names = String(item?.title || '').replace(/更新通知\s*$/, '').trim()
    return `我们的${names || '相关条款'}已更新，请查看最新内容。`
  }
  return normalizeDisplayedNotification(item)
}

app.get('/notifications', async (c) => {
  await loadSystemSettingsFromDB(c)
  const user = c.get('user')
  if (!user) return c.redirect('/login')
  await ensureNotificationsTable(c)
  const allNotifications = (await getNotifications(c, user.id)).filter((item: any) => item.type !== 'announcement')
  const pageSize = 10
  const requestedPage = Math.max(1, Number(c.req.query('page') || 1) || 1)
  const pageCount = Math.max(1, Math.ceil(allNotifications.length / pageSize))
  const page = Math.min(requestedPage, pageCount)
  const pageNotifications = allNotifications.slice((page - 1) * pageSize, page * pageSize)
  const notifications = pageNotifications
  // 通告历史单独放在 /admin/announcements，通知中心只显示收件通知。
  const sentAnnouncements: any[] = []
  const recipients = user.role === 'ADMIN' || user.role === 'STAFF' ? (await getUsers(c)).filter((account: any) => (user.role === 'ADMIN' ? ['CUSTOMER', 'STAFF'].includes(account.role) : account.role === 'CUSTOMER' && account.staffId === user.id) && account.status !== 'inactive') : []
  if (user.role === 'ADMIN' || user.role === 'STAFF') await ensureInAppNotificationTemplates(c)
  const inAppNotificationTemplates = user.role === 'ADMIN' || user.role === 'STAFF' ? ((await c.env.RENT.prepare("SELECT id, name FROM in_app_notification_templates WHERE enabled = 1 AND deleted_at IS NULL ORDER BY name").all()).results || []) as any[] : []
  const inAppNotificationTemplateOptions = `<option value="custom">自定义通知</option>${inAppNotificationTemplates.map((item: any) => `<option value="${sanitizePlainText(item.id, 120)}">使用模板：${sanitizePlainText(item.name, 120)}</option>`).join('')}`
  const defaultDelivery = getSystemSettings().notificationSettings?.defaultDelivery || 'in_app_email'
  const deliveryChoice = `<div class="form-group"><label class="form-label" for="notificationDelivery">发送方式</label><select class="form-control" id="notificationDelivery" name="delivery"><option value="in_app_email" ${defaultDelivery === 'in_app_email' ? 'selected' : ''}>站内通知 + 邮件</option><option value="in_app_only" ${defaultDelivery === 'in_app_only' ? 'selected' : ''}>仅站内通知</option></select></div>`
  const resultCount = (key: string) => Math.min(10000, Math.max(0, Number.parseInt(c.req.query(key) || '0', 10) || 0))
  const sentCount = resultCount('sent'), emailSent = resultCount('emailSent'), emailFailed = resultCount('emailFailed')
  const sendResult = c.req.query('sent') ? `<div role="status" data-flash-notice class="page-notification page-notification--${emailFailed ? 'error' : 'success'}"><span>站内通知已发送：</span> ${sentCount}${c.req.query('delivery') === 'in_app_email' ? ` · <span>邮件已提交：</span> ${emailSent} · <span>邮件失败：</span> ${emailFailed}` : ''}${user.role === 'ADMIN' ? ' · <a href="/manager/email-events">查看邮件发送记录</a>' : ''}</div>` : ''
  const recipientOptions = recipients.map((account: any) => `<option value="${sanitizePlainText(account.id, 120)}">${sanitizePlainText(account.name || account.email, 120)} · ${sanitizePlainText(account.email, 160)}</option>`).join('')
  const body = `<div class="panel"><div class="section-title"><h2>通知中心</h2><span class="section-note">订单和归还提醒</span></div>${user.role === 'ADMIN' ? `<form method="post" action="/notifications/announcement" class="panel notification-compose"><h3>发布通告</h3>${renderAnnouncementEditor()}<div class="form-group"><label class="form-label" for="announcementExpiresAt">下架日期和时间（选填）</label><input class="form-control" id="announcementExpiresAt" name="expiresAt" type="datetime-local"></div><button class="button button-primary" type="submit">发布通告</button></form>` : ''}${user.role === 'ADMIN' || user.role === 'STAFF' ? `<form method="post" action="/notifications/send" class="panel notification-compose"><h3>发送通知</h3>${sendResult}${deliveryChoice}<div class="form-group"><label class="form-label" for="notificationRecipient">收件人（可多选）</label><input class="form-control recipient-search" id="notificationRecipientSearch" type="search" placeholder="搜索姓名或邮箱…" autocomplete="off"><div class="recipient-picker-actions"><button type="button" class="button button-sm button-secondary" id="selectVisibleRecipients">全选当前结果</button><button type="button" class="button button-sm button-secondary" id="clearRecipients">清空选择</button><span id="recipientCount" class="section-note">已选 0 人</span></div><select class="form-control recipient-select" id="notificationRecipient" name="recipientId" multiple size="7" required>${recipientOptions}</select><small class="form-text">可搜索后全选当前结果，也可以按住 Command（Mac）或 Ctrl（Windows）逐个选择。</small></div><div class="form-group"><label class="form-label" for="notificationTitle">标题（自定义通知时必填）</label><input class="form-control" id="notificationTitle" name="title" maxlength="120" required></div><div class="form-group"><label class="form-label" for="notificationMessage">内容（支持 HTML，自定义通知时必填）</label><textarea class="form-control html-editor" id="notificationMessage" name="message" maxlength="1000" required></textarea></div><button class="button button-primary" type="submit">发送通知</button></form><script>(()=>{const search=document.getElementById('notificationRecipientSearch'),select=document.getElementById('notificationRecipient'),count=document.getElementById('recipientCount'),template=document.getElementById('notificationTemplate'),title=document.getElementById('notificationTitle'),message=document.getElementById('notificationMessage');if(!search||!select)return;const update=()=>{const query=search.value.trim().toLowerCase();Array.from(select.options).forEach(option=>{option.hidden=Boolean(query&&!option.textContent.toLowerCase().includes(query));});count.textContent='已选 '+Array.from(select.selectedOptions).length+' 人';};const syncTemplateFields=()=>{const custom=!template||template.value==='custom';[title,message].forEach(field=>{if(!field)return;field.required=custom;field.setAttribute('aria-required',String(custom));});};search.addEventListener('input',update);select.addEventListener('change',update);template?.addEventListener('change',syncTemplateFields);document.getElementById('selectVisibleRecipients')?.addEventListener('click',()=>{Array.from(select.options).forEach(option=>{if(!option.hidden)option.selected=true;});update();});document.getElementById('clearRecipients')?.addEventListener('click',()=>{Array.from(select.options).forEach(option=>option.selected=false);update();});update();syncTemplateFields();})();</script>` : ''}${user.role === 'ADMIN' && sentAnnouncements.length ? `<section class="panel"><h3>已发布通告历史</h3><div class="notification-list">${sentAnnouncements.map((item: any) => `<article class="notification-item"><div><strong>${sanitizePlainText(item.title, 120)}</strong><div class="notification-message">${renderNotificationMarkdown(normalizeDisplayedNotification(item))}</div><small>${formatMelbourneDateTime(item.created_at)}</small></div><form method="post" action="/notifications/announcements/${item.id}/delete" data-site-confirm="删除后这条通告及其历史记录将从所有收件人处撤回，无法恢复。" data-confirm-variant="danger" data-confirm-title="删除这条通告？" data-confirm-label="删除通告"><button class="button button-sm button-danger" type="submit">删除</button></form></article>`).join('')}</div></section>` : ''}${notifications.length ? `<div class="notification-list">${notifications.map((item: any) => `<a class="notification-item ${item.read_at ? '' : 'is-unread'}" href="/notifications/${encodeURIComponent(item.id)}"><div><strong>${sanitizePlainText(item.title, 200)}</strong><div class="notification-message">${renderNotificationMarkdown(notificationListMessage(item))}</div><small>${sanitizePlainText(formatMelbourneDateTime(item.created_at), 80)}</small></div>${item.order_id ? `<span class="button button-sm button-secondary">查看订单</span>` : ''}</a>`).join('')}</div>` : '<p class="empty-state">暂无通知</p>'}</div>`
  const pagination = pageCount > 1 ? `<nav class="pagination" aria-label="通知分页">${Array.from({ length: pageCount }, (_, index) => `<a class="button button-sm ${index + 1 === page ? 'button-primary' : 'button-secondary'}" href="/notifications?page=${index + 1}">${index + 1}</a>`).join('')}</nav>` : ''
  const bodyWithAnnouncementExpiry = body
  const bodyWithSendAnchor = bodyWithAnnouncementExpiry.replace('<form method="post" action="/notifications/send" class="panel notification-compose">', '<form id="send-notification" method="post" action="/notifications/send" class="panel notification-compose">')
  const bodyWithTemplateChoice = bodyWithSendAnchor.replace('<div class="form-group"><label class="form-label" for="notificationTitle">标题（自定义通知时必填）</label>', `<div class="form-group"><label class="form-label" for="notificationTemplate">发送内容</label><select class="form-control" id="notificationTemplate" name="templateId">${inAppNotificationTemplateOptions}</select><small class="form-text">管理模板：<a href="/admin/in-app-notification-templates">站内通知模板</a></small></div><div class="form-group"><label class="form-label" for="notificationTitle">标题（自定义通知时必填）</label>`)
  const bodyWithArchiveLink = user.role === 'ADMIN' ? bodyWithTemplateChoice.replace('<h3>发布通告</h3>', '<div class="section-title"><h3>发布通告</h3><a class="link-button" href="/admin/announcements">历史通告 →</a></div>') : bodyWithTemplateChoice
  return c.html(buildLayout('通知中心', bodyWithArchiveLink + pagination, user))
})

app.get('/admin/notifications', async (c) => {
  const user = c.get('user')
  if (!user || user.role !== 'ADMIN') return c.redirect('/login')
  await ensureNotificationsTable(c)
  const notifications = (await getNotifications(c, user.id)).filter((item: any) => item.type !== 'announcement')
  const body = `<div class="page-header"><div><p class="section-code">ADMIN INBOX</p><h2>管理员通知中心</h2><p>这里显示充值、退款、付款审核、推荐风险审核和其他系统业务通知。</p></div><a class="button button-secondary" href="/notifications">发布通知</a></div><section class="panel"><div class="section-title"><h3>业务通知</h3><span class="section-note">共 ${notifications.length} 条</span></div>${notifications.length ? `<div class="admin-notification-cards">${notifications.map((item: any) => { const typeLabel = item.type === 'c2c_payout_pending' ? '出租结算待转账' : item.type === 'rental_application' ? '租赁申请' : item.type === 'referral_risk_review' ? '推荐风险审核' : item.type === 'payment_review_submitted' ? '付款凭证待审核' : item.type === 'payment_review_overdue' ? '付款审核逾期' : item.type || '系统通知'; return `<a class="admin-notification-card ${item.read_at ? '' : 'is-unread'}" href="/notifications/${encodeURIComponent(item.id)}"><span class="admin-notification-card__type">${sanitizePlainText(typeLabel, 40)}</span><div class="admin-notification-card__content"><strong>${sanitizePlainText(item.title, 200)}</strong><p>${sanitizePlainText(notificationPlainText(item.message), 180)}</p><small>${sanitizePlainText(formatMelbourneDateTime(item.created_at), 80)}</small></div><b aria-hidden="true"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"></path></svg></b></a>` }).join('')}</div>` : '<p class="empty-state">暂无业务通知</p>'}</section>`
  return c.html(buildLayout('管理员通知中心', body, user))
})

app.get('/admin/notifications/settings', async (c) => {
  const user = c.get('user')
  if (!user || user.role !== 'ADMIN') return c.redirect('/login')
  await loadSystemSettingsFromDB(c)
  return c.html(pages.renderAdminNotificationSettings(user, getSystemSettings().notificationSettings, c.req.query('success') || '', 'success'))
})

app.post('/admin/notifications/settings', async (c) => {
  const user = c.get('user')
  if (!user || user.role !== 'ADMIN') return c.redirect('/login')
  const form = await c.req.parseBody()
  const defaultDelivery = String(form.defaultDelivery || '') === 'in_app_only' ? 'in_app_only' : 'in_app_email'
  await updateSystemSettings(c, { notificationSettings: { defaultDelivery } } as any)
  return c.redirect('/admin/notifications/settings?success=' + encodeURIComponent('通知设置已保存'))
})

app.get('/admin/announcements', async (c) => {
  const user = c.get('user')
  if (!user || user.role !== 'ADMIN') return c.redirect('/login')
  await ensureNotificationsTable(c)
  const order = c.req.query('order') === 'asc' ? 'asc' : 'desc'
  // ORDER BY 方向不能参数化：先映射成枚举常量（只有 ASC / DESC 两个合法值）再拼接。
  const orderDirection = order === 'asc' ? 'ASC' : 'DESC'
  const result = await c.env.RENT.prepare(`SELECT MIN(id) AS id, title, message, title_en, message_en, created_at, MAX(expires_at) AS expires_at, COUNT(*) AS recipient_count FROM notifications WHERE sender_id = ? AND type = 'announcement' GROUP BY title, message, title_en, message_en, created_at ORDER BY created_at ${orderDirection}`).bind(user.id).all() as any
  const rows = (result.results || []) as any[]
  const total = rows.length
  const pageSize = 10
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const page = Math.min(Math.max(1, Number(c.req.query('page') || 1) || 1), pageCount)
  const offset = (page - 1) * pageSize
  const pageRows = rows.slice(offset, offset + pageSize)
  const esc = escapeHtml
  const sortLink = (value: string, label: string) => `<a class="button button-sm ${order === value ? 'button-primary' : 'button-secondary'}" href="/admin/announcements?order=${value}">${label}</a>`
  const pagination = pageCount > 1 ? `<nav class="record-archive__pagination" aria-label="历史公告分页">${Array.from({ length: pageCount }, (_, i) => `<a class="button button-sm ${i + 1 === page ? 'button-primary' : 'button-secondary'}" href="/admin/announcements?order=${order}&page=${i + 1}">${i + 1}</a>`).join('')}</nav>` : ''
  const items = pageRows.map((item: any, index: number) => {
    const seq = order === 'asc' ? offset + index + 1 : total - offset - index
    const expiry = item.expires_at ? String(item.expires_at).replace(' ', 'T').slice(0, 16) : ''
    const expiryLabel = item.expires_at ? ` · 下架于 ${esc(formatMelbourneDateTime(item.expires_at))}` : ''
    return `<details class="record-archive__item" data-search="${esc(`${item.title} ${item.message} ${item.title_en || ''} ${item.message_en || ''}`).toLowerCase()}"><summary class="record-archive__summary"><span class="record-archive__seq">#${seq}</span><span class="record-archive__title">${esc(item.title)}</span><span class="record-archive__meta">${esc(formatMelbourneDateTime(item.created_at))} · 已发送 ${item.recipient_count} 人${expiryLabel}</span></summary><div class="record-archive__body"><form method="post" action="/admin/announcements/${encodeURIComponent(item.id)}">${renderAnnouncementEditor(item, 'announcement-' + encodeURIComponent(item.id))}<label class="form-label">下架日期和时间（选填）</label><input class="form-control" name="expiresAt" type="datetime-local" value="${esc(expiry)}"><div class="record-archive__actions"><button class="button button-primary" type="submit">保存公告</button></div></form><form method="post" action="/admin/announcements/${encodeURIComponent(item.id)}/delete" data-site-confirm="删除后所有收件人都将看不到这条公告，且无法恢复。" data-confirm-variant="danger" data-confirm-title="删除公告？" data-confirm-label="删除公告"><button class="button button-sm button-danger" type="submit">删除公告</button></form></div></details>`
  }).join('')
  const itemsWithHide = items.replace(/<form method="post" action="(\/admin\/announcements\/[^\"]+)\/delete"/g, '<form method="post" action="$1/hide" data-site-confirm="隐藏后所有用户都不会再看到这条通告，之后仍可在历史公告中恢复。" data-confirm-title="隐藏这条通告？" data-confirm-label="隐藏通告"><button class="button button-sm button-secondary" type="submit">隐藏通告</button></form><form method="post" action="$1/delete"')
  const countLabel = pageCount > 1 ? `第 ${page}/${pageCount} 页 · 共 ${total} 条` : `共 ${total} 条`
  const body = `<div class="page-header"><div><p class="section-code">ANNOUNCEMENT ARCHIVE</p><h2>历史公告</h2><p>编辑后所有收件人同步更新；删除后将从所有人处撤回。</p></div><div class="record-actions"><a class="button button-primary" href="/notifications#send-notification">发送通知</a><a class="button button-secondary" href="/notifications">返回通知中心</a></div></div><div class="record-archive">${total ? `<div class="record-archive__toolbar"><input type="search" id="announcementSearch" class="form-control" placeholder="在本页搜索标题或内容…" autocomplete="off"><div class="record-archive__sort">${sortLink('desc', '最新在前')}${sortLink('asc', '最早在前')}</div><span class="record-archive__count" id="announcementCount" data-base="${countLabel}">${countLabel}</span></div><div class="record-archive__list">${itemsWithHide}</div><p class="empty-state" id="announcementNoResult" style="display:none">本页没有匹配的公告</p>${pagination}` : '<p class="empty-state">暂无历史公告</p>'}</div><script>(()=>{const s=document.getElementById('announcementSearch');if(!s)return;const list=[...document.querySelectorAll('.record-archive__item')];const count=document.getElementById('announcementCount');const none=document.getElementById('announcementNoResult');const run=()=>{const q=s.value.trim().toLowerCase();let n=0;list.forEach(it=>{const hit=!q||(it.dataset.search||'').includes(q);it.style.display=hit?'':'none';if(hit)n++;});count.textContent=q?('匹配 '+n+' 条'):count.dataset.base;none.style.display=q&&!n?'':'none';};s.addEventListener('input',run);})();</script>`
  return c.html(buildLayout('历史公告 - 电脑租赁管理系统', body, user))
})

app.post('/admin/announcements/:id', async (c) => {
  const user = c.get('user')
  if (!user || user.role !== 'ADMIN') return c.redirect('/login')
  const form = await c.req.parseBody()
  let fields
  try { fields = readAnnouncementForm(form) } catch (error: any) { return c.text(error.message, 400) }
  const { title, message, titleEn, messageEn } = fields
  const expiresAt = String(form.expiresAt || '').trim().replace('T', ' ') || null
  if (!title || !message) return c.text('公告标题和内容不能为空', 400)
  if (expiresAt && !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(expiresAt)) return c.text('下架日期和时间格式无效', 400)
  await ensureNotificationsTable(c)
  const source = await c.env.RENT.prepare('SELECT title, message, title_en, message_en, created_at FROM notifications WHERE id = ? AND sender_id = ? AND type = \'announcement\'').bind(c.req.param('id'), user.id).first() as any
  if (!source) return c.text('公告不存在', 404)
  await c.env.RENT.prepare('UPDATE notifications SET title = ?, message = ?, title_en = ?, message_en = ?, expires_at = ? WHERE sender_id = ? AND type = \'announcement\' AND title = ? AND message = ? AND created_at = ? AND title_en IS ? AND message_en IS ?').bind(title, message, titleEn, messageEn, expiresAt, user.id, source.title, source.message, source.created_at, source.title_en, source.message_en).run()
  return c.redirect('/admin/announcements')
})

app.post('/admin/announcements/:id/delete', async (c) => {
  const user = c.get('user')
  if (!user || user.role !== 'ADMIN') return c.redirect('/login')
  await ensureNotificationsTable(c)
  const source = await c.env.RENT.prepare("SELECT title, message, title_en, message_en, created_at FROM notifications WHERE id = ? AND sender_id = ? AND type = 'announcement'").bind(c.req.param('id'), user.id).first() as any
  if (source) {
    await c.env.RENT.prepare("UPDATE notifications SET deleted_at = CURRENT_TIMESTAMP WHERE sender_id = ? AND type = 'announcement' AND title = ? AND message = ? AND created_at = ? AND title_en IS ? AND message_en IS ?").bind(user.id, source.title, source.message, source.created_at, source.title_en, source.message_en).run()
  }
  return c.redirect('/admin/announcements')
})

app.post('/admin/announcements/:id/hide', async (c) => {
  const user = c.get('user')
  if (!user || user.role !== 'ADMIN') return c.redirect('/login')
  await ensureNotificationsTable(c)
  const source = await c.env.RENT.prepare("SELECT title, message, title_en, message_en, created_at FROM notifications WHERE id = ? AND sender_id = ? AND type = 'announcement'").bind(c.req.param('id'), user.id).first() as any
  if (source) {
    await c.env.RENT.prepare("UPDATE notifications SET deleted_at = CURRENT_TIMESTAMP WHERE sender_id = ? AND type = 'announcement' AND title = ? AND message = ? AND created_at = ? AND title_en IS ? AND message_en IS ?").bind(user.id, source.title, source.message, source.created_at, source.title_en, source.message_en).run()
  }
  return c.redirect('/admin/announcements')
})

app.get('/admin/email-templates', async (c) => {
  const user = c.get('user')
  if (!user || user.role !== 'ADMIN') return c.redirect('/login')
  return c.html(await pages.renderAdminEmailTemplates(c, user))
})

app.post('/admin/email-templates', async (c) => {
  const user = c.get('user')
  if (!user || user.role !== 'ADMIN') return c.redirect('/login')
  const form = await c.req.parseBody()
  const name = String(form.name || '').trim().slice(0, 80)
  const subject = String(form.subject || '').trim().slice(0, 200)
  const body = String(form.body || '').trim().slice(0, 10000)
  if (!name || !subject || !body) return c.text('模板名称、主题和正文不能为空', 400)
  await c.env.RENT.prepare('CREATE TABLE IF NOT EXISTS email_templates (id TEXT PRIMARY KEY, name TEXT NOT NULL, subject TEXT NOT NULL, body TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)').run()
  try { await c.env.RENT.prepare("ALTER TABLE email_templates ADD COLUMN theme_color TEXT NOT NULL DEFAULT '#f0a35b'").run() } catch (_) { }
  try { await c.env.RENT.prepare("ALTER TABLE email_templates ADD COLUMN format TEXT NOT NULL DEFAULT 'markdown'").run() } catch (_) { }
  const format = 'html'
  const themeColor = /^#[0-9a-f]{6}$/i.test(String(form.theme_color || '')) ? String(form.theme_color) : '#71818d'
  await c.env.RENT.prepare('INSERT INTO email_templates (id, name, subject, body, format, theme_color) VALUES (?, ?, ?, ?, ?, ?)').bind(`custom_${nanoid(12)}`, name, subject, body, format, themeColor).run()
  return c.redirect('/admin/email-templates')
})

app.post('/admin/email-templates/send', async (c) => {
  const user = c.get('user')
  if (!user || user.role !== 'ADMIN') return c.redirect('/login')
  const form = await c.req.parseBody()
  const template = form.templateId && String(form.templateId) !== 'custom'
    ? await c.env.RENT.prepare('SELECT subject, body, theme_color FROM email_templates WHERE id = ? AND enabled = 1 AND deleted_at IS NULL').bind(String(form.templateId)).first() as any
    : { subject: String(form.subject || '').trim().slice(0, 200), body: String(form.body || '').trim().slice(0, 20000), theme_color: '#71818d' }
  const to = String(form.to || '').trim().toLowerCase()
  const channel = ['site', 'email', 'both'].includes(String(form.channel)) ? String(form.channel) : 'email'
  const recipientId = String(form.recipientId || '').trim()
  if (!template || !template.subject || !template.body || (['site', 'both'].includes(channel) && !recipientId)) return c.text('请输入通知标题、正文并选择收件人', 400)
  const vars: Record<string, string> = {}
  for (const [key, value] of Object.entries(form)) {
    if (/^[a-z_]+$/.test(key)) vars[key] = String(value || '')
  }
  if (recipientId) {
    const recipient = await getUserById(c, recipientId)
    if (recipient) {
      vars.customer_name = vars.customer_name || String(recipient.name || '')
      vars.customer_email = vars.customer_email || String(recipient.email || '')
      if (!to && ['email', 'both'].includes(channel)) form.to = vars.customer_email
    }
  }
  const mailTo = String(form.to || to).trim().toLowerCase()
  if (['email', 'both'].includes(channel) && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mailTo)) return c.text('邮件收件邮箱无效', 400)
  const companyDetails = getSystemSettings().companyDetails || {}
  vars.company_name = vars.company_name || String(companyDetails.name || 'PC Rental')
  vars.company_email = vars.company_email || String(companyDetails.email || '')
  const fill = (value: string) => value.replace(/\{([a-z_]+)\}/g, (_: string, key: string) => vars[key] ?? '')
  if (['site', 'both'].includes(channel)) await createNotification(c, { recipientId, senderId: user.id, type: 'manual', title: notificationPlainText(fill(template.subject)), message: fill(template.body), notifyByEmail: false })
  if (['email', 'both'].includes(channel)) {
    const { provider, apiKey, from } = await resolveEmailCredentials(c)
    if ((provider !== 'smtp' && !apiKey) || !from) return c.text('请先在通知渠道配置邮件服务', 503)
    const filledBody = fill(template.body)
    const html = renderEmailNotificationHtml(fill(template.subject), filledBody, vars.company_name, template.theme_color || '#71818d')
    const sent = await sendLoggedEmail(c, { eventType: 'TEMPLATE', recipient: mailTo, key: `template:${crypto.randomUUID()}`, subject: fill(template.subject), text: filledBody, html, templateId: String(form.templateId || '') || undefined })
    if (!sent.ok) return c.text('邮件发送失败或邮件服务尚未配置', 502)
  }
  return c.redirect('/admin/email-templates')
})

app.post('/admin/email-templates/:id', async (c) => {
  const user = c.get('user')
  if (!user || user.role !== 'ADMIN') return c.redirect('/login')
  const form = await c.req.parseBody()
  const subject = String(form.subject || '').trim().slice(0, 200)
  const body = String(form.body || '').trim().slice(0, 10000)
  if (!subject || !body) return c.text('邮件主题和正文不能为空', 400)
  await c.env.RENT.prepare('CREATE TABLE IF NOT EXISTS email_templates (id TEXT PRIMARY KEY, name TEXT NOT NULL, subject TEXT NOT NULL, body TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)').run()
  try { await c.env.RENT.prepare("ALTER TABLE email_templates ADD COLUMN format TEXT NOT NULL DEFAULT 'markdown'").run() } catch (_) { }
  try { await c.env.RENT.prepare("ALTER TABLE email_templates ADD COLUMN theme_color TEXT NOT NULL DEFAULT '#f0a35b'").run() } catch (_) { }
  const format = 'html'
  const themeColor = /^#[0-9a-f]{6}$/i.test(String(form.theme_color || '')) ? String(form.theme_color) : '#71818d'
  await c.env.RENT.prepare('UPDATE email_templates SET subject = ?, body = ?, format = ?, theme_color = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND deleted_at IS NULL').bind(subject, body, format, themeColor, c.req.param('id')).run()
  return c.redirect('/admin/email-templates')
})

app.post('/admin/email-templates/:id/delete', async (c) => {
  const user = c.get('user')
  if (!user || user.role !== 'ADMIN') return c.redirect('/login')
  const id = c.req.param('id')
  if (!id.startsWith('custom_')) return c.text('内置模板不能删除', 400)
  await c.env.RENT.prepare('UPDATE email_templates SET deleted_at = CURRENT_TIMESTAMP, enabled = 0 WHERE id = ? AND deleted_at IS NULL').bind(id).run()
  return c.redirect('/admin/email-templates')
})

app.get('/admin/in-app-notification-templates', async (c) => {
  const user = c.get('user')
  if (!user || user.role !== 'ADMIN') return c.redirect('/login')
  return c.html(await pages.renderAdminInAppNotificationTemplates(c, user))
})

app.post('/admin/in-app-notification-templates', async (c) => {
  const user = c.get('user')
  if (!user || user.role !== 'ADMIN') return c.redirect('/login')
  const form = await c.req.parseBody()
  const name = sanitizePlainText(String(form.name || '').trim(), 80)
  const title = sanitizePlainText(String(form.title || '').trim(), 120)
  const message = sanitizeRichHtml(String(form.message || '').trim()).slice(0, 10000)
  if (!name || !title || !message) return c.text('模板名称、通知标题和正文不能为空', 400)
  await ensureInAppNotificationTemplates(c)
  await c.env.RENT.prepare('INSERT INTO in_app_notification_templates (id, name, title, message) VALUES (?, ?, ?, ?)').bind(`custom_${nanoid(12)}`, name, title, message).run()
  return c.redirect('/admin/in-app-notification-templates')
})

app.post('/admin/in-app-notification-templates/:id', async (c) => {
  const user = c.get('user')
  if (!user || user.role !== 'ADMIN') return c.redirect('/login')
  const form = await c.req.parseBody()
  const title = sanitizePlainText(String(form.title || '').trim(), 120)
  const message = sanitizeRichHtml(String(form.message || '').trim()).slice(0, 10000)
  if (!title || !message) return c.text('通知标题和正文不能为空', 400)
  await ensureInAppNotificationTemplates(c)
  await c.env.RENT.prepare('UPDATE in_app_notification_templates SET title = ?, message = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND deleted_at IS NULL').bind(title, message, c.req.param('id')).run()
  return c.redirect('/admin/in-app-notification-templates')
})

app.post('/admin/in-app-notification-templates/:id/delete', async (c) => {
  const user = c.get('user')
  if (!user || user.role !== 'ADMIN') return c.redirect('/login')
  const id = c.req.param('id')
  if (!id.startsWith('custom_')) return c.text('内置模板不能删除', 400)
  await ensureInAppNotificationTemplates(c)
  await c.env.RENT.prepare('UPDATE in_app_notification_templates SET deleted_at = CURRENT_TIMESTAMP, enabled = 0 WHERE id = ? AND deleted_at IS NULL').bind(id).run()
  return c.redirect('/admin/in-app-notification-templates')
})

async function ensureMarketingEmailTables(db: any): Promise<void> {
  await db.prepare("CREATE TABLE IF NOT EXISTS marketing_email_templates (id TEXT PRIMARY KEY, name TEXT NOT NULL, subject TEXT NOT NULL, body TEXT NOT NULL, theme_color TEXT NOT NULL DEFAULT '#f0a35b', created_by TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)").run()
  await db.prepare("CREATE TABLE IF NOT EXISTS marketing_campaigns (id TEXT PRIMARY KEY, name TEXT NOT NULL, subject TEXT NOT NULL, body TEXT NOT NULL, theme_color TEXT NOT NULL DEFAULT '#f0a35b', coupon_mode TEXT NOT NULL DEFAULT 'none', coupon_id TEXT, unique_discount_type TEXT, unique_discount_value REAL, unique_max_discount_amount REAL, unique_minimum_order_amount REAL, unique_expires_at TEXT, recipient_count INTEGER NOT NULL DEFAULT 0, sent_count INTEGER NOT NULL DEFAULT 0, failed_count INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'SENDING', created_by TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, sent_at TEXT)").run()
  try { await db.prepare('ALTER TABLE marketing_campaigns ADD COLUMN unique_minimum_order_amount REAL').run() } catch (_) { }
  await db.prepare("CREATE TABLE IF NOT EXISTS marketing_campaign_recipients (id TEXT PRIMARY KEY, campaign_id TEXT NOT NULL, customer_id TEXT NOT NULL, email TEXT NOT NULL, coupon_code TEXT, status TEXT NOT NULL DEFAULT 'PENDING', error_message TEXT, sent_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)").run()
  try { await db.prepare('ALTER TABLE marketing_campaign_recipients ADD COLUMN unsubscribe_token TEXT').run() } catch (_) { }
  try { await db.prepare('ALTER TABLE users ADD COLUMN marketing_email_opt_out INTEGER NOT NULL DEFAULT 0').run() } catch (_) { }
  try { await db.prepare('ALTER TABLE users ADD COLUMN marketing_opt_out_at TEXT').run() } catch (_) { }
}

function generateUnsubscribeToken(): string {
  return nanoid(32)
}

function isMarketingOptedOut(account: any): boolean {
  return Number(account?.marketing_email_opt_out) === 1
}

function marketingDiscountText(discountType: string, discountValue: number, maxDiscountAmount?: number | null): string {
  const base = discountType === 'percent' ? `${discountValue}% 的折扣` : `AUD$${Number(discountValue).toFixed(2)} 的优惠`
  return maxDiscountAmount ? `${base}（最高优惠 AUD$${Number(maxDiscountAmount).toFixed(2)}）` : base
}

function generateMarketingCouponCode(prefix: string): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let suffix = ''
  for (let i = 0; i < 8; i++) suffix += alphabet[Math.floor(Math.random() * alphabet.length)]
  const cleanPrefix = String(prefix || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 12)
  return cleanPrefix ? `${cleanPrefix}-${suffix}` : suffix
}

// Reuses the coupons table for one-off per-recipient codes: max_uses = 1 and
// max_uses_per_customer = 1 make each generated code single-use by construction.
async function createUniqueMarketingCoupon(c: any, params: { discountType: string; discountValue: number; maxDiscountAmount: number | null; minimumOrderAmount: number | null; expiresAt: string | null; prefix: string; createdBy: string }): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateMarketingCouponCode(params.prefix)
    try {
      await c.env.RENT.prepare("INSERT INTO coupons (id, code, discount_type, discount_value, max_uses, max_uses_per_customer, max_discount_amount, minimum_order_amount, expires_at, active, status, created_by) VALUES (?, ?, ?, ?, 1, 1, ?, ?, ?, 1, 'ACTIVE', ?)")
        .bind(`cp-${nanoid(10)}`, code, params.discountType, params.discountValue, params.maxDiscountAmount, params.minimumOrderAmount, params.expiresAt, params.createdBy).run()
      return code
    } catch (error: any) {
      if (!String(error?.message || '').toLowerCase().includes('unique')) throw error
    }
  }
  throw new Error('无法生成唯一优惠码，请重试')
}

async function sendMarketingCampaignEmails(c: any, params: { campaignId: string; subject: string; body: string; themeColor: string; discountText: string; promotionTitle: string; promotionDescription: string; promoEndDate: string; recipients: { id: string; customerId: string; email: string; couponCode: string | null; unsubscribeToken: string }[] }): Promise<void> {
  const companyDetails = getSystemSettings().companyDetails || {}
  const companyName = String(companyDetails.name || 'PC Rental')
  const companyEmail = String(companyDetails.email || '')
  const origin = new URL(c.req.url).origin
  const configuredLogoUrl = String(companyDetails.logo || '').trim()
  const logoUrl = /^https?:\/\//i.test(configuredLogoUrl) ? configuredLogoUrl : `${origin}/favicon.svg`
  const browseUrl = `${origin}/customer/devices`
  const deviceRows = (((await c.env.RENT.prepare("SELECT d.id, d.name, d.brand, d.model, COUNT(o.id) AS sales_count FROM devices d LEFT JOIN orders o ON o.deviceId = d.id AND o.status IN ('paid', 'active', 'extended', 'overdue', 'pending_pickup', 'pending_return', 'returned', 'completed', 'suspended') WHERE COALESCE(d.lifecycle_status, d.status, '') NOT IN ('RETIRED', 'retired') GROUP BY d.id, d.name, d.brand, d.model ORDER BY sales_count DESC, d.name COLLATE NOCASE ASC LIMIT 2").all()) as any).results || []) as any[]
  const deviceVariables = [0, 1].map(index => {
    const device = deviceRows[index]
    const name = String(device?.name || '')
    const description = [device?.brand, device?.model].map(value => String(value || '').trim()).filter(Boolean).join(' ')
    const url = device?.id ? new URL(`/customer/rent/${encodeURIComponent(String(device.id))}`, c.req.url).toString() : ''
    return { name, description, url }
  })
  const { provider, apiKey, from } = await resolveEmailCredentials(c)
  let sent = 0, failed = 0
  for (const row of params.recipients) {
    const recipient = await getUserById(c, row.customerId)
    if (isMarketingOptedOut(recipient)) {
      await c.env.RENT.prepare("UPDATE marketing_campaign_recipients SET status = 'FAILED', error_message = '客户已取消订阅营销邮件' WHERE id = ?").bind(row.id).run()
      failed++
      continue
    }
    const unsubscribeUrl = `${origin}/unsubscribe?token=${encodeURIComponent(row.unsubscribeToken)}`
    const vars: Record<string, string> = {
      customer_name: String(recipient?.name || ''),
      customer_email: row.email,
      company_name: companyName,
      company_email: companyEmail,
      promotion_title: params.promotionTitle,
      promotion_description: params.promotionDescription,
      discount_amount: row.couponCode ? params.discountText : '',
      coupon_code: row.couponCode || '',
      promo_end_date: row.couponCode ? params.promoEndDate : '',
      browse_url: browseUrl,
      unsubscribe_url: unsubscribeUrl,
      device_1_name: deviceVariables[0].name,
      device_1_description: deviceVariables[0].description,
      device_1_url: deviceVariables[0].url,
      device_2_name: deviceVariables[1].name,
      device_2_description: deviceVariables[1].description,
      device_2_url: deviceVariables[1].url,
      discount_text: row.couponCode ? params.discountText : '',
    }
    const fill = (value: string) => value.replace(/\{([a-z_]+)\}/g, (_: string, key: string) => vars[key] ?? '')
    const filledSubject = fill(params.subject)
    const filledBody = fill(params.body)
    let ok = false
    let errorMessage = ''
    if ((provider !== 'smtp' && !apiKey) || !from) {
      errorMessage = '邮件服务尚未配置'
    } else {
      const html = renderMarketingEmailHtml(filledSubject, filledBody, companyName, params.themeColor, unsubscribeUrl, companyEmail, logoUrl)
      const text = `${filledBody.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()}\n\n取消订阅营销邮件：${unsubscribeUrl}`
      const result = await sendLoggedEmail(c, { eventType: 'MARKETING', recipient: row.email, key: `marketing:${params.campaignId}:${row.id}`, subject: filledSubject, text, html })
      ok = result.ok
      if (!ok) errorMessage = '发送失败'
    }
    if (ok) sent++; else failed++
    await c.env.RENT.prepare('UPDATE marketing_campaign_recipients SET status = ?, error_message = ?, sent_at = CASE WHEN ? THEN CURRENT_TIMESTAMP END WHERE id = ?').bind(ok ? 'SENT' : 'FAILED', errorMessage || null, ok ? 1 : 0, row.id).run()
  }
  const finalStatus = sent === 0 && failed > 0 ? 'FAILED' : 'SENT'
  await c.env.RENT.prepare('UPDATE marketing_campaigns SET sent_count = ?, failed_count = ?, status = ?, sent_at = CURRENT_TIMESTAMP WHERE id = ?').bind(sent, failed, finalStatus, params.campaignId).run()
}

app.get('/admin/marketing-emails', async (c) => {
  const user = c.get('user')
  if (!user || user.role !== 'ADMIN') return c.redirect('/login')
  await loadSystemSettingsFromDB(c)
  await ensureMarketingEmailTables(c.env.RENT)
  const templates = ((await c.env.RENT.prepare('SELECT * FROM marketing_email_templates WHERE deleted_at IS NULL ORDER BY updated_at DESC').all()).results || []) as any[]
  const campaigns = ((await c.env.RENT.prepare('SELECT * FROM marketing_campaigns ORDER BY created_at DESC LIMIT 50').all()).results || []) as any[]
  const coupons = ((await c.env.RENT.prepare("SELECT id, code, discount_type, discount_value FROM coupons WHERE deleted_at IS NULL AND active = 1 AND status = 'ACTIVE' ORDER BY created_at DESC").all()).results || []) as any[]
  const activeCustomers = (await getUsers(c)).filter((account: any) => account.role === 'CUSTOMER' && account.status === 'active' && account.email)
  const customers = activeCustomers.filter((account: any) => !isMarketingOptedOut(account))
  const optedOutCount = activeCustomers.length - customers.length
  return c.html(pages.renderAdminMarketingEmails(user, { templates, campaigns, coupons, customers, optedOutCount }))
})

app.post('/admin/marketing/feedback-settings', async (c) => {
  const user = await findUserBySession(c, c.req.header('cookie') ?? null)
  if (!user || user.role !== 'ADMIN') return c.json({ success: false, error: '无权限' }, 403)
  try {
    return await actions.handleSaveTallyFeedbackSettings(c)
  } catch (error: any) {
    return c.json({ success: false, error: error?.message || '保存失败' }, 400)
  }
})

app.get('/admin/marketing-emails/data', async (c) => {
  const user = c.get('user')
  if (!user || user.role !== 'ADMIN') return c.redirect('/login')
  await ensureMarketingEmailTables(c.env.RENT)
  const [audienceSummary, deliverySummary, campaignSummary, optedOutCustomers, campaigns] = await Promise.all([
    c.env.RENT.prepare(`
      SELECT COUNT(*) AS total_customers,
             SUM(CASE WHEN status = 'active' AND TRIM(COALESCE(email, '')) <> '' THEN 1 ELSE 0 END) AS active_with_email,
             SUM(CASE WHEN status = 'active' AND TRIM(COALESCE(email, '')) <> '' AND COALESCE(marketing_email_opt_out, 0) = 0 THEN 1 ELSE 0 END) AS sendable_customers,
             SUM(CASE WHEN COALESCE(marketing_email_opt_out, 0) = 1 THEN 1 ELSE 0 END) AS opted_out_customers
      FROM users WHERE role = 'CUSTOMER'
    `).first(),
    c.env.RENT.prepare(`
      SELECT COUNT(*) AS recipient_count,
             SUM(CASE WHEN status = 'SENT' THEN 1 ELSE 0 END) AS sent_count,
             SUM(CASE WHEN status = 'FAILED' THEN 1 ELSE 0 END) AS failed_count
      FROM marketing_campaign_recipients
    `).first(),
    c.env.RENT.prepare('SELECT COUNT(*) AS campaign_count FROM marketing_campaigns').first(),
    c.env.RENT.prepare(`
      SELECT u.id, u.name, u.email, u.status, u.marketing_opt_out_at,
             COUNT(mcr.id) AS campaign_count, MAX(mcr.sent_at) AS last_marketing_sent_at
      FROM users u
      LEFT JOIN marketing_campaign_recipients mcr ON mcr.customer_id = u.id
      WHERE u.role = 'CUSTOMER' AND COALESCE(u.marketing_email_opt_out, 0) = 1
      GROUP BY u.id, u.name, u.email, u.status, u.marketing_opt_out_at
      ORDER BY datetime(u.marketing_opt_out_at) DESC, u.name COLLATE NOCASE
      LIMIT 500
    `).all(),
    c.env.RENT.prepare('SELECT id, name, subject, status, recipient_count, sent_count, failed_count, created_at FROM marketing_campaigns ORDER BY created_at DESC LIMIT 100').all(),
  ])
  return c.html(pages.renderAdminMarketingData(user, {
    summary: {
      totalCustomers: Number((audienceSummary as any)?.total_customers || 0),
      activeWithEmail: Number((audienceSummary as any)?.active_with_email || 0),
      sendableCustomers: Number((audienceSummary as any)?.sendable_customers || 0),
      optedOutCustomers: Number((audienceSummary as any)?.opted_out_customers || 0),
      campaignCount: Number((campaignSummary as any)?.campaign_count || 0),
      recipientCount: Number((deliverySummary as any)?.recipient_count || 0),
      sentCount: Number((deliverySummary as any)?.sent_count || 0),
      failedCount: Number((deliverySummary as any)?.failed_count || 0),
    },
    optedOutCustomers: ((optedOutCustomers as any).results || []) as any[],
    campaigns: ((campaigns as any).results || []) as any[],
  }))
})

app.get('/admin/marketing-emails/:id', async (c) => {
  const user = c.get('user')
  if (!user || user.role !== 'ADMIN') return c.redirect('/login')
  const campaign = await c.env.RENT.prepare('SELECT * FROM marketing_campaigns WHERE id = ?').bind(c.req.param('id')).first() as any
  if (!campaign) return c.html(renderNotFound(), 404)
  const recipients = ((await c.env.RENT.prepare('SELECT * FROM marketing_campaign_recipients WHERE campaign_id = ? ORDER BY created_at').bind(campaign.id).all()).results || []) as any[]
  return c.html(pages.renderAdminMarketingEmailDetail(user, campaign, recipients))
})

app.post('/admin/marketing-emails/templates', async (c) => {
  const user = c.get('user')
  if (!user || user.role !== 'ADMIN') return c.redirect('/login')
  const form = await c.req.parseBody()
  const name = String(form.name || '').trim().slice(0, 80)
  const subject = String(form.subject || '').trim().slice(0, 200)
  const body = String(form.body || '').trim().slice(0, 10000)
  if (!name || !subject || !body) return c.text('模板名称、主题和正文不能为空', 400)
  await ensureMarketingEmailTables(c.env.RENT)
  const themeColor = /^#[0-9a-f]{6}$/i.test(String(form.theme_color || '')) ? String(form.theme_color) : '#f0a35b'
  await c.env.RENT.prepare('INSERT INTO marketing_email_templates (id, name, subject, body, theme_color, created_by) VALUES (?, ?, ?, ?, ?, ?)').bind(`mktpl_${nanoid(12)}`, name, subject, body, themeColor, user.id).run()
  return c.redirect('/admin/marketing-emails')
})

app.post('/admin/marketing-emails/templates/:id', async (c) => {
  const user = c.get('user')
  if (!user || user.role !== 'ADMIN') return c.redirect('/login')
  const form = await c.req.parseBody()
  const name = String(form.name || '').trim().slice(0, 80)
  const subject = String(form.subject || '').trim().slice(0, 200)
  const body = String(form.body || '').trim().slice(0, 10000)
  if (!name || !subject || !body) return c.text('模板名称、主题和正文不能为空', 400)
  const themeColor = /^#[0-9a-f]{6}$/i.test(String(form.theme_color || '')) ? String(form.theme_color) : '#f0a35b'
  await c.env.RENT.prepare('UPDATE marketing_email_templates SET name = ?, subject = ?, body = ?, theme_color = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND deleted_at IS NULL').bind(name, subject, body, themeColor, c.req.param('id')).run()
  return c.redirect('/admin/marketing-emails')
})

app.post('/admin/marketing-emails/templates/:id/delete', async (c) => {
  const user = c.get('user')
  if (!user || user.role !== 'ADMIN') return c.redirect('/login')
  await c.env.RENT.prepare('UPDATE marketing_email_templates SET deleted_at = CURRENT_TIMESTAMP WHERE id = ? AND deleted_at IS NULL').bind(c.req.param('id')).run()
  return c.redirect('/admin/marketing-emails')
})

app.post('/admin/marketing-emails/send', async (c) => {
  const user = c.get('user')
  if (!user || user.role !== 'ADMIN') return c.redirect('/login')
  await ensureMarketingEmailTables(c.env.RENT)
  const form = await c.req.parseBody()
  const name = String(form.name || '').trim().slice(0, 120)
  const templateId = String(form.templateId || 'custom')
  let subject = String(form.subject || '').trim().slice(0, 200)
  let body = String(form.body || '').trim().slice(0, 20000)
  let themeColor = /^#[0-9a-f]{6}$/i.test(String(form.theme_color || '')) ? String(form.theme_color) : '#f0a35b'
  if (templateId !== 'custom') {
    const template = await c.env.RENT.prepare('SELECT subject, body, theme_color FROM marketing_email_templates WHERE id = ? AND deleted_at IS NULL').bind(templateId).first() as any
    if (template) { subject = template.subject; body = template.body; themeColor = template.theme_color || themeColor }
  }
  if (!name || !subject || !body) return c.text('批次名称、邮件主题和正文不能为空', 400)

  const allCustomers = (await getUsers(c)).filter((account: any) => account.role === 'CUSTOMER' && account.status === 'active' && account.email && !isMarketingOptedOut(account))
  let recipients: any[]
  if (form.sendToAll) {
    recipients = allCustomers
  } else {
    const rawIds = Array.isArray(form.recipientId) ? form.recipientId : (form.recipientId ? [form.recipientId] : [])
    const idSet = new Set(rawIds.map(String))
    recipients = allCustomers.filter((account: any) => idSet.has(String(account.id)))
  }
  if (!recipients.length) return c.text('请至少选择一位收件人，或勾选发送给全部活跃客户', 400)

  const couponMode = ['none', 'shared', 'unique'].includes(String(form.couponMode)) ? String(form.couponMode) : 'none'
  let sharedCoupon: any = null
  let uniqueConfig: { discountType: string; discountValue: number; maxDiscountAmount: number | null; minimumOrderAmount: number | null; expiresAt: string | null; prefix: string } | null = null
  let discountText = ''
  if (couponMode === 'shared') {
    sharedCoupon = await c.env.RENT.prepare('SELECT * FROM coupons WHERE id = ? AND deleted_at IS NULL AND active = 1').bind(String(form.couponId || '')).first() as any
    if (!sharedCoupon) return c.text('请选择一个有效的优惠码', 400)
    discountText = marketingDiscountText(sharedCoupon.discount_type, sharedCoupon.discount_value, sharedCoupon.max_discount_amount)
  } else if (couponMode === 'unique') {
    const discountType = ['percent', 'fixed'].includes(String(form.uniqueDiscountType)) ? String(form.uniqueDiscountType) : 'percent'
    const discountValue = Number(form.uniqueDiscountValue)
    if (!Number.isFinite(discountValue) || discountValue <= 0 || (discountType === 'percent' && discountValue > 100)) return c.text('请输入有效的折扣值', 400)
    const maxDiscountAmount = form.uniqueMaxDiscountAmount ? Number(form.uniqueMaxDiscountAmount) : null
    const minimumOrderAmount = form.uniqueMinimumOrderAmount ? Number(form.uniqueMinimumOrderAmount) : null
    if (minimumOrderAmount !== null && (!Number.isFinite(minimumOrderAmount) || minimumOrderAmount < 0)) return c.text('请输入有效的最低使用金额', 400)
    const expiresAt = String(form.uniqueExpiresAt || '').replace('T', ' ') || null
    uniqueConfig = { discountType, discountValue, maxDiscountAmount, minimumOrderAmount, expiresAt, prefix: String(form.uniqueCodePrefix || '').trim() }
    discountText = marketingDiscountText(discountType, discountValue, maxDiscountAmount)
  }

  const promotionTitle = String(form.promotionTitle || subject).trim().slice(0, 200)
  const promotionDescription = String(form.promotionDescription || discountText || '浏览最新设备与租赁优惠。').trim().slice(0, 500)
  const promoEndDate = String(couponMode === 'shared' ? sharedCoupon?.expires_at || '' : uniqueConfig?.expiresAt || '').trim()

  const campaignId = `camp_${nanoid(12)}`
  await c.env.RENT.prepare('INSERT INTO marketing_campaigns (id, name, subject, body, theme_color, coupon_mode, coupon_id, unique_discount_type, unique_discount_value, unique_max_discount_amount, unique_minimum_order_amount, unique_expires_at, recipient_count, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(campaignId, name, subject, body, themeColor, couponMode, couponMode === 'shared' ? sharedCoupon.id : null, uniqueConfig?.discountType || null, uniqueConfig?.discountValue ?? null, uniqueConfig?.maxDiscountAmount ?? null, uniqueConfig?.minimumOrderAmount ?? null, uniqueConfig?.expiresAt || null, recipients.length, user.id).run()

  const recipientRows: { id: string; customerId: string; email: string; couponCode: string | null; unsubscribeToken: string }[] = []
  for (const recipient of recipients) {
    let couponCode: string | null = null
    if (couponMode === 'shared') couponCode = String(sharedCoupon.code).toUpperCase()
    else if (couponMode === 'unique' && uniqueConfig) couponCode = await createUniqueMarketingCoupon(c, { ...uniqueConfig, createdBy: user.id })
    const recipientRowId = `mcr_${nanoid(12)}`
    const unsubscribeToken = generateUnsubscribeToken()
    await c.env.RENT.prepare('INSERT INTO marketing_campaign_recipients (id, campaign_id, customer_id, email, coupon_code, unsubscribe_token) VALUES (?, ?, ?, ?, ?, ?)').bind(recipientRowId, campaignId, recipient.id, String(recipient.email).toLowerCase(), couponCode, unsubscribeToken).run()
    recipientRows.push({ id: recipientRowId, customerId: recipient.id, email: String(recipient.email).toLowerCase(), couponCode, unsubscribeToken })
  }

  await createAuditLog(c, { actor: user, action: 'MARKETING_EMAIL_CAMPAIGN_CREATED', targetType: 'MARKETING_CAMPAIGN', targetId: campaignId, after: { name, recipientCount: recipients.length, couponMode } })
  c.executionCtx.waitUntil(sendMarketingCampaignEmails(c, { campaignId, subject, body, themeColor, discountText, promotionTitle, promotionDescription, promoEndDate, recipients: recipientRows }))
  return c.redirect('/admin/marketing-emails?success=' + encodeURIComponent(`营销邮件已开始发送，共 ${recipients.length} 位收件人`))
})

// 退订链接无需登录：令牌来自某次群发的收件人行，只用于定位客户账号。
app.get('/unsubscribe', async (c) => {
  await ensureMarketingEmailTables(c.env.RENT)
  const token = String(c.req.query('token') || '').trim()
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return c.html(pages.renderUnsubscribeResult('取消订阅链接无效，请从营销邮件中重新点击链接。', false), 400)
  const recipient = await c.env.RENT.prepare('SELECT customer_id, email FROM marketing_campaign_recipients WHERE unsubscribe_token = ?').bind(token).first() as any
  if (!recipient) return c.html(pages.renderUnsubscribeResult('取消订阅链接无效或已失效。', false), 404)
  const account = await getUserById(c, recipient.customer_id)
  if (isMarketingOptedOut(account)) return c.html(pages.renderUnsubscribeResult('您已成功取消订阅营销邮件，无需重复操作。'))
  return c.html(pages.renderUnsubscribeConfirm(token, recipient.email))
})

app.post('/unsubscribe', async (c) => {
  await ensureMarketingEmailTables(c.env.RENT)
  const form = await c.req.parseBody()
  const token = String(form.token || '').trim()
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return c.html(pages.renderUnsubscribeResult('取消订阅链接无效，请从营销邮件中重新点击链接。', false), 400)
  const recipient = await c.env.RENT.prepare('SELECT customer_id FROM marketing_campaign_recipients WHERE unsubscribe_token = ?').bind(token).first() as any
  if (!recipient) return c.html(pages.renderUnsubscribeResult('取消订阅链接无效或已失效。', false), 404)
  await c.env.RENT.prepare("UPDATE users SET marketing_email_opt_out = 1, marketing_opt_out_at = CURRENT_TIMESTAMP WHERE id = ?").bind(recipient.customer_id).run()
  return c.html(pages.renderUnsubscribeResult('您已成功取消订阅营销邮件，我们不会再向您发送促销邮件。您仍会收到订单、合同等账户相关的重要通知邮件。'))
})

app.get('/notifications/announcements', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ announcements: [] }, 401)
  await ensureNotificationsTable(c)
  const result = await c.env.RENT.prepare("SELECT id, title, message, title_en, message_en, created_at FROM notifications WHERE recipient_id = ? AND type = 'announcement' AND read_at IS NULL AND deleted_at IS NULL AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP) ORDER BY created_at DESC LIMIT 5").bind(user.id).all()
  return c.json({ announcements: (result.results || []).map((item: any) => ({ ...item, message_html: renderAnnouncementContent(item.message), message_html_en: renderAnnouncementContent(item.message_en || item.message) })) })
})

app.get('/notifications/unread', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ notifications: [] }, 401)
  await ensureNotificationsTable(c)
  await cleanupCompletedRentalApplicationNotifications(c, user.id)
  await cleanupCompletedPaymentReviewNotifications(c, user.id)
  const query = "SELECT id, type, title, message, title_en, message_en, order_id, created_at FROM notifications WHERE recipient_id = ? AND read_at IS NULL AND deleted_at IS NULL AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP) AND NOT (type = 'agreement_update' AND EXISTS (SELECT 1 FROM notifications newer WHERE newer.recipient_id = notifications.recipient_id AND newer.type = notifications.type AND newer.title = notifications.title AND newer.message = notifications.message AND (newer.created_at > notifications.created_at OR (newer.created_at = notifications.created_at AND newer.rowid > notifications.rowid)))) ORDER BY created_at DESC LIMIT 10"
  let result: any
  try {
    result = await c.env.RENT.prepare(query).bind(user.id).all()
  } catch (error: any) {
    if (String(error.message).includes('no such table: notifications')) {
      await ensureNotificationsTable(c)
      result = await c.env.RENT.prepare(query).bind(user.id).all()
    } else {
      throw error
    }
  }
  return c.json({ notifications: (result.results || []).map((item: any) => { const message = normalizeDisplayedNotification(item); return { ...item, message, message_html: item.type === 'announcement' ? renderAnnouncementContent(message) : renderFlexibleContent(message), ...(item.type === 'announcement' ? { message_html_en: renderAnnouncementContent(item.message_en || message) } : {}) } }) })
})

app.get('/notifications/recent', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ notifications: [], unreadCount: 0 }, 401)
  await cleanupCompletedRentalApplicationNotifications(c, user.id)
  await cleanupCompletedPaymentReviewNotifications(c, user.id)
  const result = await c.env.RENT.prepare("SELECT id, type, title, message, order_id, created_at, read_at FROM notifications WHERE recipient_id = ? AND type != 'announcement' AND deleted_at IS NULL AND NOT (type = 'agreement_update' AND EXISTS (SELECT 1 FROM notifications newer WHERE newer.recipient_id = notifications.recipient_id AND newer.type = notifications.type AND newer.title = notifications.title AND newer.message = notifications.message AND (newer.created_at > notifications.created_at OR (newer.created_at = notifications.created_at AND newer.rowid > notifications.rowid)))) ORDER BY created_at DESC LIMIT 10").bind(user.id).all() as any
  const unread = await c.env.RENT.prepare("SELECT COUNT(*) AS count FROM notifications WHERE recipient_id = ? AND type != 'announcement' AND deleted_at IS NULL AND read_at IS NULL AND NOT (type = 'agreement_update' AND EXISTS (SELECT 1 FROM notifications newer WHERE newer.recipient_id = notifications.recipient_id AND newer.type = notifications.type AND newer.title = notifications.title AND newer.message = notifications.message AND (newer.created_at > notifications.created_at OR (newer.created_at = notifications.created_at AND newer.rowid > notifications.rowid))))").bind(user.id).first() as any
  return c.json({ notifications: (result.results || []).map((item: any) => ({ ...item, message: notificationListMessage(item) })), unreadCount: Number(unread?.count || 0) })
})

app.get('/notifications/:id', async (c) => {
  const user = c.get('user')
  if (!user) return c.redirect('/login')
  await cleanupCompletedRentalApplicationNotifications(c, user.id)
  await cleanupCompletedPaymentReviewNotifications(c, user.id)
  const item = await c.env.RENT.prepare("SELECT * FROM notifications WHERE id = ? AND recipient_id = ? AND deleted_at IS NULL AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)").bind(c.req.param('id'), user.id).first() as any
  if (!item) return c.html(renderNotFound(), 404)
  await c.env.RENT.prepare('UPDATE notifications SET read_at = COALESCE(read_at, CURRENT_TIMESTAMP) WHERE id = ? AND recipient_id = ?').bind(item.id, user.id).run()
  if (user.role === 'ADMIN' && item.type === 'c2c_payout_pending') return c.redirect('/admin/rental-settlements')
  if (user.role === 'ADMIN' && item.type === 'rental_application') return c.redirect('/admin/order-review')
  const orderPath = item.order_id ? (user.role === 'ADMIN' ? `/admin/orders/${item.order_id}` : user.role === 'STAFF' ? `/staff/orders/${item.order_id}` : `/customer/orders/${item.order_id}`) : ''
  const body = `<div class="panel notification-detail"><div class="section-title"><div><p class="section-code">NOTIFICATION DETAIL</p><h2>${item.type === 'announcement' ? renderAnnouncementTitle(item) : sanitizePlainText(item.title, 200)}</h2><small>${sanitizePlainText(formatMelbourneDateTime(item.created_at), 80)}</small></div><a class="button button-secondary" href="/notifications">返回通知中心</a></div><div class="notification-message">${item.type === 'announcement' ? renderAnnouncementMessage(item) : renderNotificationMarkdown(normalizeDisplayedNotification(item))}</div>${orderPath ? `<a class="button button-secondary" href="${orderPath}">查看订单</a>` : ''}</div>`
  return c.html(buildLayout('通知详情', body, user))
})

app.post('/notifications/announcements/:id/dismiss', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ ok: false }, 401)
  await ensureNotificationsTable(c)
  await c.env.RENT.prepare("UPDATE notifications SET read_at = CURRENT_TIMESTAMP WHERE id = ? AND recipient_id = ? AND type = 'announcement'").bind(c.req.param('id'), user.id).run()
  return c.json({ ok: true })
})

app.post('/notifications/:id/dismiss', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ ok: false }, 401)
  await ensureNotificationsTable(c)
  await c.env.RENT.prepare('UPDATE notifications SET read_at = CURRENT_TIMESTAMP WHERE id = ? AND recipient_id = ? AND deleted_at IS NULL').bind(c.req.param('id'), user.id).run()
  return c.json({ ok: true })
})

app.post('/notifications/announcements/:id/delete', async (c) => {
  const user = c.get('user')
  if (!user || user.role !== 'ADMIN') return c.html(renderForbidden(), 403)
  await ensureNotificationsTable(c)
  const source = await c.env.RENT.prepare("SELECT title, message, title_en, message_en, created_at FROM notifications WHERE id = ? AND sender_id = ? AND type = 'announcement'").bind(c.req.param('id'), user.id).first() as any
  if (source) await c.env.RENT.prepare("UPDATE notifications SET deleted_at = CURRENT_TIMESTAMP WHERE sender_id = ? AND type = 'announcement' AND title = ? AND message = ? AND created_at = ? AND title_en IS ? AND message_en IS ?").bind(user.id, source.title, source.message, source.created_at, source.title_en, source.message_en).run()
  return c.redirect('/notifications')
})

app.post('/notifications/announcement', async (c) => {
  const user = c.get('user')
  if (!user || user.role !== 'ADMIN') return c.html(renderForbidden(), 403)
  const form = await c.req.parseBody()
  let fields
  try { fields = readAnnouncementForm(form) } catch (error: any) { return c.text(error.message, 400) }
  const { title, message, titleEn, messageEn } = fields
  const expiresAt = String(form.expiresAt || '').trim().replace('T', ' ') || null
  if (!title || !message) return c.text('通告标题和内容不能为空', 400)
  if (expiresAt && !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(expiresAt)) return c.text('下架日期和时间格式无效', 400)
  const recipients = (await getUsers(c)).filter((account: any) => ['CUSTOMER', 'STAFF'].includes(account.role) && account.status !== 'inactive')
  await Promise.all(recipients.map((recipient: any) => createNotification(c, { recipientId: recipient.id, senderId: user.id, type: 'announcement', title, message, titleEn, messageEn, expiresAt })))
  return c.redirect('/notifications')
})

app.post('/notifications/send', async (c) => {
  await loadSystemSettingsFromDB(c)
  const user = c.get('user')
  if (!user || !['ADMIN', 'STAFF'].includes(user.role)) return c.html(renderForbidden(), 403)
  const form = await c.req.parseBody({ all: true })
  const rawRecipientIds = form.recipientId ?? form['recipientId[]']
  const recipientIds = (Array.isArray(rawRecipientIds) ? rawRecipientIds : [rawRecipientIds])
    .map((value: unknown) => String(value || '').trim())
    .filter(Boolean)
  const templateId = String(form.templateId || 'custom').trim()
  let title = String(form.title || '').trim().slice(0, 120)
  let message = String(form.message || '').trim().slice(0, 1000)
  if (templateId !== 'custom') {
    await ensureInAppNotificationTemplates(c)
    const template = await c.env.RENT.prepare('SELECT title, message FROM in_app_notification_templates WHERE id = ? AND enabled = 1 AND deleted_at IS NULL').bind(templateId).first() as any
    if (!template) return c.text('通知模板不存在或已停用', 400)
    title = String(template.title || '').trim().slice(0, 120)
    message = String(template.message || '').trim().slice(0, 1000)
  }
  const allowedRecipients = (await getUsers(c)).filter((recipient: any) =>
    recipientIds.includes(recipient.id) &&
    ['CUSTOMER', 'STAFF'].includes(recipient.role) &&
    recipient.status !== 'inactive' &&
    (user.role !== 'STAFF' || (recipient.role === 'CUSTOMER' && recipient.staffId === user.id))
  )
  if (!recipientIds.length || allowedRecipients.length !== new Set(recipientIds).size || !title || !message) return c.text('收件人或通知内容无效', 400)
  const defaultDelivery = getSystemSettings().notificationSettings?.defaultDelivery || 'in_app_email'
  const delivery = String(form.delivery || defaultDelivery)
  if (!['in_app_only', 'in_app_email'].includes(delivery)) return c.text('发送方式无效', 400)
  const results = []
  for (const recipient of allowedRecipients) {
    const company = getSystemSettings().companyDetails || {}
    const vars = { customer_name: String(recipient.name || ''), customer_email: String(recipient.email || ''), company_name: String(company.name || ''), company_email: String(company.email || '') }
    const fill = (value: string, html = false) => value.replace(/\{([a-z_]+)\}/g, (placeholder, key) => Object.hasOwn(vars, key) ? (html ? escapeHtml(vars[key]) : vars[key]) : placeholder)
    results.push(await createNotificationWithDelivery(c, { recipientId: recipient.id, senderId: user.id, type: 'manual', title: fill(title), message: fill(message, true), notifyByEmail: delivery === 'in_app_email' }))
  }
  const count = results.filter(result => result.inserted).length
  const emailSent = results.filter(result => result.email?.ok).length
  const emailFailed = delivery === 'in_app_email' ? results.filter(result => result.inserted && !result.email?.ok).length : 0
  await createAuditLog(c, { actor: user, action: 'MANUAL_NOTIFICATIONS_SENT', targetType: 'NOTIFICATION', targetId: user.id, after: { count, delivery, emailSent, emailFailed } })
  return c.redirect(`/notifications?sent=${count}&emailSent=${emailSent}&emailFailed=${emailFailed}&delivery=${delivery}#send-notification`, 303)
})

// Existing links keep working while new pages use the rental-program name.
for (const role of ['customer','admin']) app.get(`/${role}/c2c`,c=>c.redirect(`/${role}/rental-program${new URL(c.req.url).search}`,302))
app.post('/customer/c2c/join',c=>actions.customerC2CAction(c,'join'))
app.post('/customer/c2c/photos',c=>actions.customerC2CAction(c,'photo'))
app.post('/customer/c2c',c=>actions.customerC2CAction(c,'submit'))
app.post('/customer/c2c/:id/edit',c=>actions.customerC2CAction(c,'edit'))
app.post('/customer/c2c/:id/pause',c=>actions.customerC2CAction(c,'pause'))
app.post('/admin/c2c/commission',c=>actions.adminC2CAction(c,'commission'))
app.post('/admin/c2c/:id/review',c=>actions.adminC2CAction(c,'review'))
app.post('/admin/c2c/:id/pause',c=>actions.adminC2CAction(c,'pause'))
app.post('/admin/c2c/orders/:orderId/settle',c=>actions.adminC2CAction(c,'settle'))

app.get('/customer/rental-program/settlements',async c=>{
  const user=c.get('user')
  if(!user||user.role!=='CUSTOMER'||(user.accountType ?? user.account_type ?? 'formal')!=='formal'||!await isC2CMember(c,user.id))return c.html(renderForbidden(),403)
  return c.html(await pages.renderCustomerRentalSettlements(c,user))
})
app.post('/customer/rental-program/settlements/preferences',c=>actions.customerRentalSettlementAction(c,'preferences'))
app.post('/customer/rental-program/settlements/request',c=>actions.customerRentalSettlementAction(c,'request'))
app.get('/admin/rental-settlements',async c=>{
  const user=c.get('user')
  if(!user||user.role!=='ADMIN')return c.html(renderForbidden(),403)
  return c.html(await pages.renderAdminRentalSettlements(c,user))
})
app.post('/admin/rental-settlements/:id/paid',c=>actions.adminRentalSettlementAction(c,'paid'))
app.post('/admin/rental-settlements/:id/refresh',c=>actions.adminRentalSettlementAction(c,'refresh'))
app.get('/customer/rental-program/:id/pickup',async c=>{
  const user=c.get('user')
  if(!user||user.role!=='CUSTOMER'||(user.accountType ?? user.account_type ?? 'formal')!=='formal')return c.html(renderForbidden(),403)
  const listing=await c.env.RENT.prepare('SELECT * FROM c2c_listings WHERE id=? AND owner_id=?').bind(c.req.param('id'),user.id).first()
  if(!listing)return c.html(renderForbidden(),403)
  return c.html(await pages.renderRentalPickupEditor(c,user,listing))
})
app.post('/customer/rental-program/:id/pickup-blocks',c=>actions.customerC2CAction(c,'pickup-add'))
app.post('/customer/rental-program/:id/pickup-blocks/:blockId/remove',c=>actions.customerC2CAction(c,'pickup-remove'))

app.get('/customer/rental-program', async (c) => {
  const user=c.get('user')
  if (!user) return c.redirect('/login')
  if (user.role!=='CUSTOMER' || (user.accountType ?? user.account_type ?? 'formal')!=='formal') return c.html(renderForbidden(),403)
  return c.html(await pages.renderCustomerC2C(c,user))
})
app.post('/customer/rental-program/join', c => actions.customerC2CAction(c,'join'))
app.post('/customer/rental-program/photos', c => actions.customerC2CAction(c,'photo'))
app.post('/customer/rental-program', c => actions.customerC2CAction(c,'submit'))
app.post('/customer/rental-program/:id/edit', c => actions.customerC2CAction(c,'edit'))
app.post('/customer/rental-program/:id/pause', c => actions.customerC2CAction(c,'pause'))
app.get('/admin/rental-program', async (c) => {
  const user=c.get('user')
  if (!user) return c.redirect('/login')
  if (user.role!=='ADMIN') return c.html(renderForbidden(),403)
  return c.html(await pages.renderAdminC2C(c,user))
})
app.post('/admin/rental-program/commission', c => actions.adminC2CAction(c,'commission'))
app.post('/admin/rental-program/:id/review', c => actions.adminC2CAction(c,'review'))
app.post('/admin/rental-program/:id/pause', c => actions.adminC2CAction(c,'pause'))
app.post('/admin/rental-program/orders/:orderId/settle', c => actions.adminC2CAction(c,'settle'))

app.get('/customer/devices', async (c) => {
  const user = c.get('user')
  if (!user || user.role !== 'CUSTOMER') return c.redirect('/login')
  return c.html(await pages.renderCustomerDevices(c, user))
})

app.get('/customer/rent/:id', async (c) => {
  const user = c.get('user')
  if (!user || user.role !== 'CUSTOMER') return c.redirect('/login?redirect='+encodeURIComponent(c.req.path))
  const risk = await getCustomerRiskAssessment(c, user.id)
  return c.html(await pages.renderCustomerRent(c, c.req.param('id'), user, risk.blocked ? '您的账户当前存在风控限制，暂时无法自助下单，请联系客服协助处理' : undefined))
})

app.post('/customer/rent/:id', async (c) => {
  const user = c.get('user')
  if (!user || user.role !== 'CUSTOMER') return c.redirect('/login')
  const risk = await getCustomerRiskAssessment(c, user.id)
  if (risk.blocked) return c.html(await pages.renderCustomerRent(c, c.req.param('id'), user, '您的账户当前存在风控限制，暂时无法自助下单，请联系客服协助处理'), 403)
  const account = await c.env.RENT.prepare('SELECT balance FROM users WHERE id = ?').bind(user.id).first() as any
  if (Number(account?.balance || 0) < 0) return c.html(await pages.renderCustomerRent(c, c.req.param('id'), user, `您的账户余额为负（${Number(account.balance).toFixed(2)} AUD），请先充值至非负后再下单。`), 403)
  const bookingError = await c2cBookingError(c,c.req.param('id'),user.id)
  if (bookingError) return c.text(bookingError,403)
  const device = await getDeviceById(c, c.req.param('id'))
  const rentalRules = await getDeviceRentalRules(c, c.req.param('id'))
  const deviceUnavailable = new Set(((await c.env.RENT.prepare('SELECT unavailable_date FROM device_unavailable_dates WHERE device_id = ? AND deleted_at IS NULL').bind(c.req.param('id')).all()).results || []).map((row: any) => row.unavailable_date))
  const form = await c.req.parseBody()
  const startDate = String(form.startDate || '')
  const endDate = String(form.endDate || '')
  const todayValue = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Melbourne', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  const deliveryMethod = String(form.deliveryMethod || 'Pickup') === 'Delivery' ? 'Delivery' : 'Pickup'
  const c2cDelivery=await c.env.RENT.prepare('SELECT listing_mode FROM c2c_listings WHERE device_id=?').bind(c.req.param('id')).first()
  if (c2cDelivery?.listing_mode==='self' && deliveryMethod!=='Pickup') return c.text('自行交付设备仅支持到址自取',400)
  const pickupTimeSlot = String(form.pickupTimeSlot || '')
  const returnTimeSlot = String(form.returnTimeSlot || '')
  const deliveryAddress = String(form.deliveryAddress || '').trim().slice(0, 1000)
  const rentalNote = String(form.rentalNote || '').trim().slice(0, 500)
  const couponCode = String(form.couponCode || '').trim().toUpperCase().slice(0, 40)
  if(c2cDelivery && deliveryMethod==='Pickup'){
    const blocks=await rentalPickupBlocks(c,c.req.param('id'))
    if(rentalPickupBlocked(blocks,startDate,pickupTimeSlot)||rentalPickupBlocked(blocks,endDate,returnTimeSlot))return c.html(await pages.renderCustomerRent(c,c.req.param('id'),user,'设备主人在所选时段无法交付，请选择其他取还时间'),400)
  }
  // 校验失败重新渲染时回填用户已填内容（不包含敏感字段）。
  const rentPrefill = { startDate, endDate, startPeriod: String(form.startPeriod || ''), endPeriod: String(form.endPeriod || ''), deliveryMethod, pickupTimeSlot, returnTimeSlot, deliveryAddress, rentalNote, couponCode }
  const start = new Date(`${startDate}T00:00:00Z`)
  const end = new Date(`${endDate}T00:00:00Z`)
  const startPeriod = deliveryMethod === 'Pickup' ? pickupTimeSlotPeriod(pickupTimeSlot) : form.startPeriod === 'PM' ? 'PM' : 'AM'
  const endPeriod = deliveryMethod === 'Pickup' ? pickupTimeSlotPeriod(returnTimeSlot) : form.endPeriod === 'PM' ? 'PM' : 'AM'
  const halfDays = Math.round((end.getTime() - start.getTime()) / 86400000) * 2 + (endPeriod === 'PM' ? 1 : 0) - (startPeriod === 'PM' ? 1 : 0)
  const deviceUnavailableSlots = new Set<string>()
  try {
    const rows = (await c.env.RENT.prepare('SELECT unavailable_date, time_slot FROM device_unavailable_time_slots WHERE device_id = ? AND deleted_at IS NULL').bind(c.req.param('id')).all()).results || []
    for (const row of rows as any[]) deviceUnavailableSlots.add(`${String(row.unavailable_date || '').slice(0, 10)}:${String(row.time_slot || '')}`)
  } catch (_) { }
  const unavailable = new Set(rentalRules.unavailableDates)
  let blockedDate = ''
  for (let day = new Date(start); day <= end; day.setUTCDate(day.getUTCDate() + 1)) { if (unavailable.has(day.toISOString().slice(0, 10))) { blockedDate = day.toISOString().slice(0, 10); break } }
  if (!blockedDate) for (let day = new Date(start); day <= end; day.setUTCDate(day.getUTCDate() + 1)) { if (deviceUnavailable.has(day.toISOString().slice(0, 10))) { blockedDate = day.toISOString().slice(0, 10); break } }
  const periodBlocked = (date: string, period: string) => {
    const slots = rentalRules.unavailableTimeSlots?.[date] || []
    const periodSlots = period === 'AM' ? ['morning_service', 'morning'] : ['afternoon', 'evening_service']
    return periodSlots.every((slot) => slots.includes(slot) || deviceUnavailableSlots.has(`${date}:${slot}`))
  }
  const selectedTimeUnavailable = deliveryMethod === 'Pickup' && (
    !PICKUP_TIME_SLOTS.has(pickupTimeSlot) || !PICKUP_TIME_SLOTS.has(returnTimeSlot)
    || [pickupTimeSlot,returnTimeSlot].some(slot=>HALF_HOUR_TIME_OPTIONS.includes(slot)&&!pickupTimeMode(slot,rentalRules))
    || pickupTimeSlotPassed(startDate, pickupTimeSlot, todayValue, rentalRules) || pickupTimeSlotPassed(endDate, returnTimeSlot, todayValue, rentalRules)
    || (rentalRules.unavailableTimeSlots?.[startDate] || []).includes(pickupTimeSlot)
    || (rentalRules.unavailableTimeSlots?.[endDate] || []).includes(returnTimeSlot)
    || deviceUnavailableSlots.has(`${startDate}:${pickupTimeSlot}`)
    || deviceUnavailableSlots.has(`${endDate}:${returnTimeSlot}`)
    || isUnavailablePickupTime(pickupTimeSlot, startDate, rentalRules)
    || isUnavailablePickupTime(returnTimeSlot, endDate, rentalRules)
  )
  let invalidPeriod = !['AM', 'PM'].includes(startPeriod) || !['AM', 'PM'].includes(endPeriod) || halfDays <= 0 || rentalPeriodPassed(startDate, startPeriod, todayValue) || rentalPeriodPassed(endDate, endPeriod, todayValue)
  for (let day = new Date(start); Number.isFinite(day.getTime()) && day <= end; day.setUTCDate(day.getUTCDate() + 1)) {
    const date = day.toISOString().slice(0, 10)
    const index = rentalPeriodIndex(date, 'AM')
    if (rentalPeriodIndex(startDate, startPeriod) <= index && index < rentalPeriodIndex(endDate, endPeriod) && (periodBlocked(date, 'AM') || rentalPeriodPassed(date, 'AM', todayValue))) invalidPeriod = true
    const afternoon = index + 1
    if (rentalPeriodIndex(startDate, startPeriod) <= afternoon && afternoon < rentalPeriodIndex(endDate, endPeriod) && (periodBlocked(date, 'PM') || rentalPeriodPassed(date, 'PM', todayValue))) invalidPeriod = true
  }
  let periodConflict = false
  if (startDate && endDate && Number.isFinite(start.getTime()) && Number.isFinite(end.getTime())) {
    const conflictStart = new Date(start); conflictStart.setUTCDate(conflictStart.getUTCDate() - Math.max(0, rentalRules.bufferDays || 0))
    const conflictEnd = new Date(end); conflictEnd.setUTCDate(conflictEnd.getUTCDate() + Math.max(0, rentalRules.bufferDays || 0))
    const rows = ((await c.env.RENT.prepare("SELECT startDate, endDate, startPeriod, endPeriod FROM orders WHERE deviceId = ? AND deleted_at IS NULL AND status NOT IN ('completed', 'cancelled')").bind(device?.id || '').all()).results || []) as any[]
    periodConflict = rows.some((row) => rentalPeriodsOverlap(
      conflictStart.toISOString().slice(0, 10), rentalRules.bufferDays ? 'AM' : startPeriod, conflictEnd.toISOString().slice(0, 10), rentalRules.bufferDays ? 'PM' : endPeriod,
      String(row.startDate || '').slice(0, 10), String(row.startPeriod || 'AM'), String(row.endDate || '').slice(0, 10), String(row.endPeriod || 'AM'),
    ))
  }
  if (!device || device.status !== 'available' || !startDate || !endDate || (deliveryMethod === 'Delivery' && !deliveryAddress) || !Number.isFinite(start.getTime()) || start > end || halfDays <= 0 || Math.ceil(halfDays / 2) < rentalRules.minimumRentalDays || blockedDate || invalidPeriod || selectedTimeUnavailable || periodConflict) {
    return c.html(await pages.renderCustomerRent(c, c.req.param('id'), user, '请选择可用设备和正确的租赁日期', rentPrefill))
  }
  const rentAmount = calculateRentalFee(device, Math.ceil(halfDays / 2))
  const serviceFee = deliveryMethod === 'Pickup'
    ? Number((rentAmount * serviceFeeRate(rentalRules) * [pickupTimeSlot, returnTimeSlot].filter((slot) => SERVICE_FEE_TIME_SLOTS.has(slot)||pickupTimeMode(slot,rentalRules)==='non_business').length).toFixed(2))
    : 0
  const depositPricing = riskDepositSnapshot(Number(device.depositAmount || 0), risk)
  const depositAmount = depositPricing.depositAmountBeforeWaiver
  const couponFeeParts = { rentalFee: rentAmount, deliveryFee: 0, depositFee: depositAmount }
  let discountAmount = 0
  let appliedCouponCode: string | null = null
  let eligibleCoupon: any = null
  if (couponCode) {
    try {
      eligibleCoupon = await findEligibleCoupon(c, couponCode, device, couponFeeParts)
      await checkCustomerCouponEligibility(c, eligibleCoupon, user.id)
    } catch (error: any) {
      return c.html(await pages.renderCustomerRent(c, c.req.param('id'), user, error?.message || '优惠码无效', rentPrefill), 400)
    }
    discountAmount = calculateCouponDiscount(eligibleCoupon, couponFeeParts)
    appliedCouponCode = String(eligibleCoupon.code).toUpperCase()
  }
  const orderId = `o-${nanoid(8)}`
  await insertOrder(c, {
    id: orderId, orderNo: generateReferenceNumber('OD'), userId: user.id,
    deviceId: device.id, startDate, endDate, startPeriod, endPeriod, rentalPeriod: Math.ceil(halfDays / 2), status: 'pending_approval',
    paymentMethod: 'card', totalAmount: rentAmount + serviceFee + depositAmount - discountAmount,
    depositAmount, dailyRate: device.pricePerDay, contractId: '', signedAt: null, pickupLocation: deliveryMethod === 'Pickup' ? '到店自取' : deliveryAddress, returnLocation: '到店归还',
    pickupTimeSlot: deliveryMethod === 'Pickup' ? pickupTimeSlot : undefined, returnTimeSlot: deliveryMethod === 'Pickup' ? returnTimeSlot : undefined,
    deliveryMethod, deliveryFee: 0, serviceFee, rentalNote, couponCode: appliedCouponCode, discountAmount,
    createdAt: new Date().toISOString(), booking_buffer_days: rentalRules.bufferDays || 0, rental_pricing_json: JSON.stringify({ ...JSON.parse(rentalPricingSnapshot(device)), ...depositPricing })
  } as any)
  if (couponCode) {
    try {
      await reserveCouponForOrder(c, { coupon: eligibleCoupon, customerId: user.id, orderId, discountAmount })
    } catch (error: any) {
      await c.env.RENT.prepare('UPDATE orders SET deleted_at = CURRENT_TIMESTAMP WHERE id = ? AND deleted_at IS NULL').bind(orderId).run()
      return c.html(await pages.renderCustomerRent(c, c.req.param('id'), user, error?.message || '优惠码申请失败，请重新提交订单', rentPrefill), 409)
    }
  }
  await resolveRentalApplicationConflicts(c, device.id, orderId, rentalRules.bufferDays)
  if ((await getOrderById(c, orderId))?.status === 'cancelled') {
    await actions.releaseCouponForOrder(c, orderId)
    return c.redirect(`/customer/orders/${orderId}?error=${encodeURIComponent(RENTAL_APPLICATION_CONFLICT_MESSAGE)}`)
  }
  if (c2cDelivery) c.executionCtx.waitUntil(deliverC2CEmails(c).catch(error=>console.error('C2C email delivery failed',error?.message)))
  const customer = await getUserById(c, user.id)
  const recipients = customer?.staffId ? [customer.staffId] : (await getUsers(c)).filter((account: any) => account.role === 'ADMIN' && account.status !== 'inactive').map((account: any) => account.id)
  await Promise.all(recipients.map((recipientId: string) => createNotification(c, { recipientId, type: 'rental_application', title: deliveryMethod === 'Delivery' ? '新租赁申请及配送确认' : '新租赁申请待审核', message: `${customer?.name || '客户'} 申请租赁 ${device.name}（${startDate} 至 ${endDate}）${deliveryMethod === 'Delivery' ? `，需要配送至：${deliveryAddress}，运费请确认` : '，客户选择到店自取'}。${rentalNote ? `备注：${rentalNote}` : ''}`, orderId: orderId })))
  return c.redirect(`/customer/orders/${orderId}?success=${encodeURIComponent(deliveryMethod === 'Delivery' ? '租赁申请已提交。工作人员确认配送范围和运费后，订单将进入待付款状态。' : '租赁申请已提交。工作人员审核通过后，订单将进入待付款状态。')}`)
})

app.get('/staff/dashboard', async (c) => {
  const user = c.get('user')
  if (!user) {
    return c.redirect('/login')
  }
  if (user.role !== 'STAFF' && user.role !== 'ADMIN') {
    return c.html(renderForbidden(), 403)
  }
  if (isMobileDeviceRequest(c)) return c.redirect('/staff/mobile')
  const dashboardData = await getStaffDashboardData(c, user.role === 'ADMIN' ? undefined : user.id)
  return c.html(pages.renderStaffDashboard(user, dashboardData))
})

app.get('/staff/mobile', async (c) => {
  const user = c.get('user')
  if (!user || !['STAFF', 'ADMIN'].includes(user.role)) return c.redirect('/login')
  const stage = c.req.query('stage')
  if (['pickup', 'return'].includes(stage)) return c.redirect(`/staff/mobile/${stage}`, 302)
  return c.html(await pages.renderStaffMobileHome(c, user))
})

for (const stage of ['pickup', 'return'] as const) {
  app.get(`/staff/mobile/${stage}`, async (c) => {
    const user = c.get('user')
    if (!user || !['STAFF', 'ADMIN'].includes(user.role)) return c.redirect('/login')
    return c.html(await pages.renderStaffMobileOperations(c, user, stage))
  })
}

// 今日任务列表（原 /staff/mobile 的内容）：工作台首屏的「今日任务」入口指向这里。
app.get('/staff/mobile/today', async (c) => {
  const user = c.get('user')
  if (!user || !['STAFF', 'ADMIN'].includes(user.role)) return c.redirect('/login')
  return c.html(await pages.renderStaffMobileOperations(c, user))
})

app.get('/staff/mobile/scan', async (c) => {
  const user = c.get('user')
  if (!user || !['STAFF', 'ADMIN'].includes(user.role)) return c.redirect('/login')
  const stage = ['pickup', 'return'].includes(String(c.req.query('stage') || '')) ? c.req.query('stage') : ''
  const code = String(c.req.query('code') || '').trim().slice(0, 300)
  if (code) {
    const payloadOrderId = parsePickupQrPayload(code)
    let row = payloadOrderId
      ? await c.env.RENT.prepare('SELECT id, orderNo, status, userId FROM orders WHERE id = ?').bind(payloadOrderId).first()
      : await c.env.RENT.prepare('SELECT id, orderNo, status, userId FROM orders WHERE deleted_at IS NULL AND (id = ? OR UPPER(orderNo) = UPPER(?)) LIMIT 1').bind(code, code).first()
    if (!row && !payloadOrderId && /^[A-Za-z0-9]{6}$/.test(code)) {
      const matches = ((await c.env.RENT.prepare(`SELECT o.id, o.orderNo, o.status, o.userId
        FROM orders o JOIN users u ON u.id = o.userId
        WHERE o.deleted_at IS NULL AND UPPER(SUBSTR(o.orderNo, -6)) = ?${user.role === 'ADMIN' ? '' : ' AND u.staff_id = ?'}
        ORDER BY o.id LIMIT 2`).bind(code.toUpperCase(), ...(user.role === 'ADMIN' ? [] : [user.id])).all()).results || []) as any[]
      if (matches.length > 1) return c.html(pages.renderStaffMobileScan(c, user, '匹配到多个订单，请输入完整订单号'), 409)
      row = matches[0] || null
    }
    const order = row ? await getOrderById(c, String(row.id)) : null
    const customer = order ? await getUserById(c, order.userId) : null
    const signedPickup = order?.status === 'approved' && await getContractByOrderId(c, order.id).then(contract => contract?.status === 'signed')
    const pickupReady = stage !== 'return' && order && (['paid', 'pending_pickup'].includes(String(order.status)) || signedPickup)
    const returnReady = stage !== 'pickup' && order && (['active', 'extended', 'overdue', 'suspended', 'pending_return'].includes(String(order.status)) || (order.status === 'completed' && Number(order.overdue_outstanding_amount || 0) > 0))
    if ((pickupReady || returnReady) && (user.role === 'ADMIN' || customer?.staffId === user.id)) {
      return c.redirect(`/staff/orders/${encodeURIComponent(order.id)}/${pickupReady ? 'handover' : 'inspection'}`)
    }
    return c.html(await pages.renderStaffMobileScan(c, user, !order ? '请核实输入信息是否正确' : !pickupReady && !returnReady ? '该订单当前没有待处理的取货或归还任务。' : '你没有权限处理该客户的订单。'), 409)
  }
  return c.html(pages.renderStaffMobileScan(c, user))
})

app.get('/staff/profile', async (c) => {
  const user = c.get('user')
  if (!user || user.role !== 'STAFF') return c.redirect('/login')
  return c.html(buildLayout('编辑个人信息', `<div class="panel"><h2>编辑个人信息</h2><form method="post" action="/staff/profile"><label class="form-label" for="profile-name">姓名</label><input class="form-control" id="profile-name" name="name" value="${sanitizePlainText(user.name, 120)}" required><label class="form-label" for="profile-phone">电话</label><input class="form-control" id="profile-phone" name="phone" value="${sanitizePlainText(user.phone || '', 40)}"><button class="button button-primary" type="submit" style="margin-top:16px">保存</button></form></div>`, user))
})

app.post('/staff/profile', async (c) => {
  const user = c.get('user')
  if (!user || user.role !== 'STAFF') return c.redirect('/login')
  const form = await c.req.parseBody()
  await updateUser(c, user.id, { name: String(form.name || user.name).trim().slice(0, 120), phone: String(form.phone || '').trim().slice(0, 40) })
  return c.redirect('/staff/profile')
})

app.get('/staff/customers', async (c) => {
  const user = c.get('user')
  if (!user || !['STAFF', 'ADMIN'].includes(user.role)) return c.redirect('/login')
  return c.html(await pages.renderStaffCustomers(c, user, c.req.query('searchTerm') || ''))
})

app.get('/staff/customers/new', (c) => {
  const user = c.get('user')
  if (!user || !['STAFF', 'ADMIN'].includes(user.role)) return c.redirect('/login')
  return c.html(pages.renderStaffCustomerNew(user))
})

app.post('/staff/customers/new', async (c) => {
  const user = c.get('user')
  if (!user || !['STAFF', 'ADMIN'].includes(user.role)) return c.redirect('/login')
  const form = await c.req.parseBody()
  const name = combinePersonName(form.firstName, form.lastName)
  const email = String(form.email || '').trim().toLowerCase()
  const password = String(form.password || '')
  if (!String(form.firstName || '').trim() || !String(form.lastName || '').trim() || !email) return c.html(pages.renderStaffCustomerNew(user, '请完整填写名、姓和邮箱'), 400)
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return c.html(pages.renderStaffCustomerNew(user, '请输入有效的邮箱地址'), 400)
  if (password && !isStrongPassword(password)) return c.html(pages.renderStaffCustomerNew(user, '密码至少需要 8 位，并同时包含字母、数字和符号'), 400)
  if (await findUserByEmail(c, email)) return c.html(pages.renderStaffCustomerNew(user, '该邮箱已被使用'), 409)
  const customer = await insertUser(c, { id: await generateUniqueUserId(c, 'CUSTOMER'), name, email, phone: String(form.phone || '').trim(), password, role: 'CUSTOMER', status: 'active', staffId: user.id, balance: 0, commissionBalance: 0, createdAt: new Date().toISOString() })
  const passwordSetup = password ? '' : ((await sendPasswordResetEmail(c, customer, 'setup').catch(() => false)) ? 'sent' : 'failed')
  return c.redirect(`/staff/customers/${customer.id}${passwordSetup ? `?passwordSetup=${passwordSetup}` : ''}`, 303)
})

app.get('/staff/customers/:id/edit', async (c) => {
  const user = c.get('user')
  if (!user || !['STAFF', 'ADMIN'].includes(user.role)) return c.redirect('/login')
  const customer = await getUserById(c, c.req.param('id'))
  if (!customer || customer.role !== 'CUSTOMER' || (user.role !== 'ADMIN' && customer.staffId !== user.id)) return c.html(renderForbidden(), 403)
  return c.html(await pages.renderStaffCustomerEdit(c, user, c.req.param('id')))
})

app.post('/staff/customers/:id/edit', async (c) => {
  const user = c.get('user')
  if (!user || !['STAFF', 'ADMIN'].includes(user.role)) return c.redirect('/login')
  const customerId = c.req.param('id')
  const customer = await getUserById(c, customerId)
  if (!customer || customer.role !== 'CUSTOMER' || (user.role !== 'ADMIN' && customer.staffId !== user.id)) return c.html(renderForbidden(), 403)
  const form = await c.req.parseBody()
  const name = combinePersonName(form.firstName, form.lastName)
  if (!String(form.firstName || '').trim() || !String(form.lastName || '').trim()) return c.html(await pages.renderStaffCustomerEdit(c, user, customerId, '请分别填写名和姓'), 400)
  await updateUser(c, customerId, { name, phone: String(form.phone || ''), bsb: String(form.bsb || ''), account: String(form.account || ''), ...(user.role === 'ADMIN' ? { balance: Number(form.balance || 0) } : {}) })
  return c.redirect(`/staff/customers/${customerId}`)
})

app.get('/staff/customers/:id', async (c) => {
  const user = c.get('user')
  if (!user || !['STAFF', 'ADMIN'].includes(user.role)) return c.redirect('/login')
  const customer = await getUserById(c, c.req.param('id'))
  if (!customer || customer.role !== 'CUSTOMER' || (user.role !== 'ADMIN' && customer.staffId !== user.id)) return c.html(renderForbidden(), 403)
  return c.html(await pages.renderStaffCustomerDetail(c, user, c.req.param('id')))
})

app.get('/staff/orders', async (c) => {
  const user = c.get('user')
  if (!user || !['STAFF', 'ADMIN'].includes(user.role)) return c.redirect('/login')
  return c.html(await pages.renderStaffOrders(c, user, c.req.query('searchTerm') || ''))
})

app.use('/staff/orders/*', async (c, next) => {
  const user = c.get('user')
  const segments = c.req.path.split('/')
  const seg3 = segments[3]
  if (user?.role === 'STAFF' && seg3 && !['pending', 'ongoing'].includes(seg3)) {
    const seg4 = segments[4]
    const isOrderNoPath = /^\d{8}$/.test(seg3) && !!seg4 && /^[0-9A-Za-z]{6}$/.test(seg4)
    const order = isOrderNoPath ? await getOrderByOrderNo(c, `OD-${seg3}-${seg4}`) : await getOrderById(c, seg3)
    const customer = order ? await getUserById(c, order.userId) : null
    if (!order || customer?.staffId !== user.id) return c.html(renderForbidden(), 403)
  }
  await next()
})

app.get('/staff/orders/pending', async (c) => {
  return c.redirect('/staff/orders/ongoing', 301)
})

app.get('/staff/orders/ongoing', async (c) => {
  const user = c.get('user')
  if (!user || (user.role !== 'STAFF' && user.role !== 'ADMIN')) {
    return c.redirect('/login')
  }
  return c.html(await pages.renderStaffOrdersOngoing(c, user))
})

app.get('/staff/orders/:id', async (c) => {
  const user = c.get('user')
  if (!user || (user.role !== 'STAFF' && user.role !== 'ADMIN')) {
    return c.redirect('/login')
  }
  await loadSystemSettingsFromDB(c)
  return c.html(await pages.renderStaffOrderDetail(c, user, c.req.param('id')))
})

// 绑定员工可暂停自己负责客户的租赁；其他员工不能越权操作。
app.post('/staff/orders/:orderId/suspend', async (c) => {
  const user = c.get('user')
  if (!user || !['STAFF', 'ADMIN'].includes(user.role)) return c.html(renderForbidden(), 403)
  const order = await getOrderById(c, c.req.param('orderId'))
  const customer = order ? await getUserById(c, order.userId) : null
  if (!order || (user.role === 'STAFF' && customer?.staffId !== user.id)) return c.html(renderForbidden(), 403)
  if (!['active', 'extended', 'overdue'].includes(String(order.status)) || !canTransitionOrder(order.status, 'suspended')) return c.text('当前订单状态不能暂停', 409)
  const suspendForm = await c.req.parseBody()
  const suspendReason = String(suspendForm.reason || '').trim().slice(0, 300)
  if (!suspendReason) return c.text('请填写暂停原因', 400)
  await updateOrderStatus(c, order.id, 'suspended', { reason: suspendReason, triggeredBy: user.id })
  await createNotification(c, { recipientId: order.userId, senderId: user.id, type: 'rental_suspended', title: '租赁已暂停', message: `您的订单 ${order.orderNo || order.id} 已由${user.name || '工作人员'}暂停，原因：${suspendReason}。`, orderId: order.id })
  return c.redirect(staffOrderPath(order))
})

app.post('/staff/orders/:orderId/prepare-pickup', async (c) => {
  const user = c.get('user')
  if (!user || !['STAFF', 'ADMIN'].includes(user.role)) return c.html(renderForbidden(), 403)
  return actions.prepareOrderPickup(c, user, c.req.param('orderId'))
})

// 员工操作 - 已付款订单完成取货后进入租赁中
app.get('/staff/orders/:orderId/handover', async (c) => {
  const user = c.get('user') as any
  if (!user || !['STAFF', 'ADMIN'].includes(user.role)) return c.html(renderForbidden(), 403)
  const order = await getOrderById(c, c.req.param('orderId'))
  const customer = order ? await getUserById(c, order.userId) : null
  const handoverContract = order ? await getContractByOrderId(c, order.id) : null
  const squareDepositUnconfirmed = String(order?.paymentProvider || order?.payment_provider || '') === 'square' && Number(order?.depositAmount || order?.deposit_amount || 0) > 0 && String(order?.deposit_status || '').toUpperCase() !== 'PAID'
  if (!order || squareDepositUnconfirmed || !(['paid', 'pending_pickup'].includes(String(order.status)) || (order.status === 'approved' && handoverContract?.status === 'signed')) || (user.role === 'STAFF' && customer?.staffId !== user.id)) return c.html(renderForbidden(), 403)
  const device = await getDeviceById(c, order.deviceId)
  const beforeInspection = await c.env.RENT.prepare("SELECT snapshot_json FROM device_inspections WHERE deleted_at IS NULL AND rental_id = ? AND inspection_type = 'before_rental' ORDER BY created_at DESC LIMIT 1").bind(order.id).first() as any
  let beforeSnapshot: Record<string, any> = {}
  try { beforeSnapshot = JSON.parse(beforeInspection?.snapshot_json || '{}') } catch (_) { }
  const inspectionFields = renderManualInspectionFields(beforeSnapshot)
  const body = `<div class="page-header"><div><p class="section-code">HANDOVER RECORD</p><h2>交付设备</h2><p>扫码或打开订单后，先填写出租前验机报告，再完成取货交付。</p></div><a class="button button-secondary" href="${staffOrderPath(order)}">返回订单</a></div>${renderPickupPreparation(order, handoverContract, c.req.query('pickupReady'))}<form class="panel" method="post" action="/staff/orders/${encodeURIComponent(order.id)}/pickup" data-site-confirm="确认出租前验机和交付记录无误，并开始租赁？"><div class="grid grid-2"><div><label class="form-label">设备</label><input class="form-control" value="${sanitizePlainText(device?.name || order.deviceId, 160)}" readonly></div><div><label class="form-label" for="deviceSerialNumber">设备序列号</label><input class="form-control" id="deviceSerialNumber" name="deviceSerialNumber" value="${sanitizePlainText(device?.serialNumber || '', 160)}" required></div></div><section class="handover-inspection panel"><div class="section-title"><div><h3>出租前验机报告</h3><p class="section-note">交给客户前逐项确认设备状态。</p></div></div><div class="grid grid-2">${inspectionFields}<div class="form-group"><label class="form-label" for="batteryCycles">电池循环次数</label><input class="form-control" id="batteryCycles" type="number" min="0" name="batteryCycles" value="${inspectionText(beforeSnapshot.batteryCycles, 20)}"></div><div class="form-group"><label class="form-label" for="batteryHealth">电池健康</label><input class="form-control" id="batteryHealth" name="batteryHealth" value="${inspectionText(beforeSnapshot.batteryHealth, 100)}" placeholder="例如 92%"></div></div><div class="form-group"><label class="form-label" for="inspectionNotes">验机备注</label><textarea class="form-control" id="inspectionNotes" name="inspectionNotes" maxlength="2000" placeholder="记录外观、配件或其他异常">${inspectionText(beforeSnapshot.inspectionNotes, 2000)}</textarea></div></section><div class="form-group"><label class="form-label" for="accessories">交付配件</label><textarea class="form-control" id="accessories" name="accessories" maxlength="1000" required placeholder="例如：电源适配器、充电线、电脑包"></textarea></div><div class="form-group"><label class="form-label" for="conditionNotes">交付状态与备注</label><textarea class="form-control" id="conditionNotes" name="conditionNotes" maxlength="2000" required placeholder="例如：客户现场核对无误"></textarea></div><label class="form-check"><input type="checkbox" name="customerConfirmed" value="1" required> 客户已当场确认设备序列号、配件及状态</label><div class="form-group"><label class="form-label" for="customerConfirmationName">客户确认姓名</label><input class="form-control" id="customerConfirmationName" name="customerConfirmationName" maxlength="120" value="${sanitizePlainText(customer?.name || '', 120)}" required></div><button class="button button-primary" type="submit">保存验机报告并完成取货</button></form>`
  return c.html(buildLayout('出租前验机与交付 - 电脑租赁管理系统', body, user, { compactStaffNav: true }))
})

app.post('/staff/orders/:orderId/pickup', async (c) => {
  const user = c.get('user')
  if (!user || (user.role !== 'STAFF' && user.role !== 'ADMIN')) {
    return c.json({ success: false, message: 'Unauthorized' }, 401)
  }
  const orderId = c.req.param('orderId')
  const pickupOrder = await getOrderById(c, orderId)
  if (await c.env.RENT.prepare("SELECT id FROM customer_refund_requests WHERE order_id = ? AND status IN ('pending', 'processing', 'approved')").bind(orderId).first()) return c.text('退款申请待处理，不能交付设备', 409)
  const pickupContract = pickupOrder ? await getContractByOrderId(c, pickupOrder.id) : null
  const squareDepositUnconfirmedForPickup = String(pickupOrder?.paymentProvider || pickupOrder?.payment_provider || '') === 'square' && Number(pickupOrder?.depositAmount || pickupOrder?.deposit_amount || 0) > 0 && String(pickupOrder?.deposit_status || '').toUpperCase() !== 'PAID'
  if (!pickupOrder || squareDepositUnconfirmedForPickup || !(['paid', 'pending_pickup'].includes(String(pickupOrder.status)) || (pickupOrder.status === 'approved' && pickupContract?.status === 'signed'))) return c.json({ success: false, message: squareDepositUnconfirmedForPickup ? '礼品卡订单的押金尚未审核到账，不能交付设备' : '只有已签署合同的待交付订单可以确认交付' }, 409)
  const customer = await getUserById(c, pickupOrder.userId)
  if (user.role === 'STAFF' && customer?.staffId !== user.id) return c.html(renderForbidden(), 403)
  const device = await getDeviceById(c, pickupOrder.deviceId)
  const form = await c.req.parseBody()
  const serialNumber = sanitizePlainText(String(form.deviceSerialNumber || ''), 160).trim()
  const accessories = sanitizePlainText(String(form.accessories || ''), 1000).trim()
  const conditionNotes = sanitizePlainText(String(form.conditionNotes || ''), 2000).trim()
  const confirmationName = sanitizePlainText(String(form.customerConfirmationName || ''), 120).trim()
  const inspectionInput = readManualInspectionFields(form as any)
  const batteryCycles = form.batteryCycles === '' || form.batteryCycles == null ? null : Number(form.batteryCycles)
  const batteryHealth = sanitizePlainText(String(form.batteryHealth || ''), 100).trim()
  const inspectionNotes = sanitizePlainText(String(form.inspectionNotes || ''), 2000).trim()
  const wantsJson = c.req.header('Accept')?.includes('application/json')
  const missing = [!serialNumber && '设备序列号', !accessories && '交付配件', !conditionNotes && '设备状态与备注', form.customerConfirmed !== '1' && '客户核对确认', !confirmationName && '客户确认姓名', ...inspectionInput.missing.map(label => `出租前验机-${label}`)].filter(Boolean)
  if (missing.length) return wantsJson ? c.json({ success: false, message: `请填写：${missing.join('、')}` }, 400) : c.text(`请填写：${missing.join('、')}`, 400)
  if (serialNumber !== String(device?.serialNumber || '')) return wantsJson ? c.json({ success: false, message: '设备序列号与订单设备不一致' }, 409) : c.text('设备序列号与订单设备不一致', 409)
  if (batteryCycles !== null && (!Number.isInteger(batteryCycles) || batteryCycles < 0)) return wantsJson ? c.json({ success: false, message: '电池循环次数无效' }, 400) : c.text('电池循环次数无效', 400)
  const beforeInspection = await c.env.RENT.prepare("SELECT id, snapshot_json FROM device_inspections WHERE deleted_at IS NULL AND rental_id = ? AND inspection_type = 'before_rental' ORDER BY created_at DESC LIMIT 1").bind(orderId).first() as any
  let beforeSnapshot: Record<string, any> = {}
  try { beforeSnapshot = JSON.parse(beforeInspection?.snapshot_json || '{}') } catch (_) { }
  Object.assign(beforeSnapshot, inspectionInput.checks, { batteryCycles, batteryHealth, inspectionNotes, inspectionDate: new Date().toISOString().slice(0, 10), inspectionBy: user.name || user.id, source: 'handover_manual' })
  const inspectionWrite = beforeInspection?.id
    ? c.env.RENT.prepare('UPDATE device_inspections SET snapshot_json = ?, differences_json = ?, performed_by = ?, created_at = CURRENT_TIMESTAMP WHERE id = ?').bind(JSON.stringify(beforeSnapshot), JSON.stringify({}), user.id, beforeInspection.id)
    : c.env.RENT.prepare("INSERT INTO device_inspections (id, device_id, rental_id, inspection_type, snapshot_json, differences_json, performed_by) VALUES (?, ?, ?, 'before_rental', ?, ?, ?)").bind(`inspection-${nanoid(12)}`, pickupOrder.deviceId, orderId, JSON.stringify(beforeSnapshot), JSON.stringify({}), user.id)
  await updateOrderStatus(c, orderId, 'active')
  await c.env.RENT.batch([
    inspectionWrite,
    c.env.RENT.prepare('UPDATE devices SET inspection_requested_at = NULL WHERE id = ?').bind(pickupOrder.deviceId),
    c.env.RENT.prepare('UPDATE orders SET handover_completed_at = CURRENT_TIMESTAMP, handover_by = ?, handover_overdue = 0, possible_handover = 0 WHERE id = ?').bind(user.id, orderId),
    c.env.RENT.prepare('INSERT INTO rental_status_history (id, rental_id, old_status, new_status, trigger_type, triggered_by, reason) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(`rsh-${nanoid(16)}`, orderId, pickupOrder.rental_status || 'READY_FOR_PICKUP', 'ACTIVE', 'MANUAL', user.id, '员工确认设备已交付'),
    c.env.RENT.prepare("INSERT INTO order_fulfillment_records (id, order_id, record_type, device_serial_number, accessories_json, condition_snapshot_json, customer_confirmed, customer_confirmation_name, recorded_by) VALUES (?, ?, 'HANDOVER', ?, ?, ?, 1, ?, ?)").bind(`handover-${nanoid(12)}`, orderId, serialNumber, JSON.stringify(accessories.split(/[\n,，]/).map(item => item.trim()).filter(Boolean)), JSON.stringify({ ...inspectionInput.checks, batteryCycles, batteryHealth, inspectionNotes, notes: conditionNotes }), confirmationName, user.id),
  ])
  await recordDeviceLifecycle(c, pickupOrder.deviceId, 'RENTED', { orderId, reason: '工作人员确认设备已交付', changedBy: user.id })
  await createAuditLog(c, { actor: user, action: 'HANDOVER_COMPLETED', targetType: 'ORDER', targetId: orderId, before: { status: pickupOrder.status, rentalStatus: pickupOrder.rental_status }, after: { status: 'active', rentalStatus: 'ACTIVE', deviceSerialNumber: serialNumber, customerConfirmed: true }, reason: conditionNotes })
  const pickupOrderPath = staffOrderPath(pickupOrder)
  return wantsJson ? c.json({ success: true, redirect: pickupOrderPath }) : c.redirect(pickupOrderPath)
})

// 新增：员工操作 - 标记订单为已归还
app.post('/staff/orders/:orderId/return', async (c) => {
  const user = c.get('user')
  if (!user || (user.role !== 'STAFF' && user.role !== 'ADMIN')) {
    return c.json({ success: false, message: 'Unauthorized' }, 401)
  }
  return c.json({ success: false, message: '请先完成归还验机', inspectionUrl: `/staff/orders/${c.req.param('orderId')}/inspection` }, 409)
})

app.post('/staff/orders/:orderId/approve', async (c) => {
  const user = c.get('user')
  if (!user || !['STAFF', 'ADMIN'].includes(user.role)) return c.html(renderForbidden(), 403)
  const order = await getOrderById(c, c.req.param('orderId'))
  const customer = order ? await getUserById(c, order.userId) : null
  if (user.role === 'STAFF' && customer?.staffId !== user.id) return c.html(renderForbidden(), 403)
  const customerRisk = customer?.role === 'CUSTOMER' ? await getCustomerRiskAssessment(c, customer.id) : null
  if (customerRisk?.blocked) return c.text(`该客户存在风控限制，不能创建合同或审核订单（风险分 ${customerRisk.score}/100）`, 403)
  const form = await c.req.parseBody()
  await loadSystemSettingsFromDB(c)
  const orderRentalRules = order ? await getDeviceRentalRules(c, order.deviceId) : null
  if (!order || !canTransitionOrder(order.status, 'approved') || await hasDeviceBookingConflict(c, order.deviceId, order.startDate, order.endDate, order.id, orderRentalRules?.bufferDays ?? 0, order.startPeriod, order.endPeriod)) return c.text('订单状态无效或设备档期冲突', 409)
  const requestedDeliveryMethod = form.deliveryMethod == null ? String(order.deliveryMethod || order.delivery_method || 'Pickup') : String(form.deliveryMethod)
  if (!['Pickup', 'Delivery'].includes(requestedDeliveryMethod)) return c.text('配送方式无效', 400)
  const deliveryFeeText = String(form.deliveryFee ?? '').trim()
  const deliveryFee = requestedDeliveryMethod === 'Delivery' ? Number(deliveryFeeText) : 0
  if (requestedDeliveryMethod === 'Delivery' && (!deliveryFeeText || !Number.isFinite(deliveryFee) || deliveryFee < 0)) return c.text('选择送货上门时必须填写有效的配送费', 400)
  const previousDeliveryFee = Number(order.deliveryFee || order.delivery_fee || 0)
  const totalAmount = Number((Number(order.totalAmount || 0) - (Number.isFinite(previousDeliveryFee) ? previousDeliveryFee : 0) + deliveryFee).toFixed(2))
  await c.env.RENT.prepare('UPDATE orders SET deliveryMethod = ?, deliveryFee = ?, totalAmount = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ? AND status = ?')
    .bind(requestedDeliveryMethod, deliveryFee, totalAmount, order.id, 'pending_approval').run()
  order.deliveryMethod = requestedDeliveryMethod
  order.deliveryFee = deliveryFee
  order.totalAmount = totalAmount
  if (!await updateOrderStatus(c, order.id, 'approved', { expectedStatus: 'pending_approval' })) return c.text('订单状态无效或设备档期冲突', 409)
  await deleteRentalApplicationNotifications(c, order.id)
  const contract = await ensureContractForOrder(c, order, user.id)

  const savedPaymentMethodId = String((order as any).stripe_payment_method_id || '')
  if (order.paymentMethod === 'card' && savedPaymentMethodId && customer && contract.status !== 'signed' && contract.status !== 'completed') {
    // 官网信用卡申请：客户在提交申请时已经勾选同意服务条款/隐私政策（IP 与时间已记录）。
    // 审核通过后不再要求客户额外打开链接签一次名，系统直接生成一份已确认的合同并自动扣租金。
    const now = new Date()
    const signedAt = now.toISOString()
    const device = await getDeviceById(c, order.deviceId)
    const existingData = typeof contract.contract_data === 'string' ? (() => { try { return JSON.parse(contract.contract_data || '{}') } catch { return {} } })() : (contract.contract_data || {})
    const signedData = {
      ...existingData,
      signer_name: customer.name || '',
      esign_signature: customer.name || '',
      auto_confirmed: true,
      auto_confirmed_by: user.id,
      auto_confirmed_reason: '官网申请提交时客户已勾选同意服务条款与隐私政策；审核通过后系统自动确认合同并使用已保存的信用卡扣款，无需二次签署。',
      agreement_version: existingData.agreement_version || '1.0',
      privacy_policy_accepted: true,
      privacy_policy_version: existingData.privacy_policy_version || '1.0',
      privacy_policy_accepted_at: existingData.privacy_policy_accepted_at || signedAt,
    }
    const signedContract = { ...contract, contract_data: signedData, signedAt, privacy_policy_accepted: true, privacy_policy_version: signedData.privacy_policy_version, privacy_policy_accepted_at: signedData.privacy_policy_accepted_at }
    await c.env.RENT.prepare('UPDATE contracts SET contract_data = ? WHERE id = ?').bind(JSON.stringify(signedData), contract.id).run()
    await updateContractStatusInDB(c, contract.id, 'signed', signedAt)
    await c.env.RENT.prepare("UPDATE contracts SET contractNumber = ? WHERE id = ? AND status = 'signed'").bind(generateContractNumber(now), contract.id).run()

    await updateOrderStatus(c, order.id, 'pending_payment')
    try {
      const result = await createOrderPaymentIntent(c, customer, order.id, true)
      if (result.authorized) {
        await createNotification(c, { recipientId: order.userId, senderId: user.id, type: 'rental_payment_charged', title: '合同已生效，信用卡预授权已确认', message: '您的租赁申请已审核通过，合同已生效。', orderId: order.id })
      } else if (result.alreadyPaid) {
        await createNotification(c, { recipientId: order.userId, senderId: user.id, type: 'rental_payment_charged', title: '合同已生效，租金已自动扣款', message: `您的设备租赁申请已由${user.name || '工作人员'}审核通过，合同已自动确认生效，并已使用您预留的信用卡自动扣取租金${Number((order as any).deliveryFee || 0) > 0 ? `（含配送费用 ${Number((order as any).deliveryFee).toFixed(2)} AUD）` : ''}。押金已按之前约定的方式预授权/保存卡片处理。`, orderId: order.id })
      } else {
        await createNotification(c, { recipientId: order.userId, senderId: user.id, type: 'rental_payment_pending', title: '合同已生效，请完成租金付款', message: '合同已自动确认生效，但自动扣款未成功，请登录账户手动完成租金付款。', orderId: order.id })
      }
    } catch (error: any) {
      await logError(c, 'ERROR', 'Auto-charge rent on approval failed', error, { orderId: order.id })
      await createNotification(c, { recipientId: order.userId, senderId: user.id, type: 'rental_payment_pending', title: '合同已生效，请完成租金付款', message: '合同已自动确认生效，但自动扣款未成功，请登录账户手动完成租金付款。', orderId: order.id })
    }
    const confirmedOrder = await getOrderById(c, order.id) || order
    const signedContent = renderContractVariables(contract.content, signedContract, confirmedOrder, device, customer, await getContractVariableData(c, signedContract, confirmedOrder))
    const contentHash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(signedContent))), byte => byte.toString(16).padStart(2, '0')).join('')
    const verificationToken = `${crypto.randomUUID().replaceAll('-', '')}${crypto.randomUUID().replaceAll('-', '')}`
    await c.env.RENT.prepare('UPDATE contracts SET signed_content = ?, content_hash = ?, verification_token = ? WHERE id = ?')
      .bind(signedContent, contentHash, verificationToken, contract.id).run()
    return c.redirect(staffOrderPath(order))
  }

  const signUrl = new URL(`/contract/sign?token=${encodeURIComponent(contract.signToken || '')}&step=1`, c.req.url).toString()
  await createNotification(c, { recipientId: order.userId, senderId: user.id, type: 'rental_application_approved', title: '租赁申请已审核，合同待签署', message: `您的设备租赁申请已由${user.name || '工作人员'}审核通过${Number((order as any).deliveryFee || 0) > 0 ? `，配送费用为 ${Number((order as any).deliveryFee).toFixed(2)} AUD` : ''}。请打开以下链接签署租赁合同：${signUrl}`, orderId: order.id })
  return c.redirect(staffOrderPath(order))
})

app.post('/staff/orders/:orderId/reject', async (c) => {
  const user = c.get('user')
  if (!user || !['STAFF', 'ADMIN'].includes(user.role)) return c.html(renderForbidden(), 403)
  const order = await getOrderById(c, c.req.param('orderId'))
  const customer = order ? await getUserById(c, order.userId) : null
  if (user.role === 'STAFF' && customer?.staffId !== user.id) return c.html(renderForbidden(), 403)
  if (!order || !canTransitionOrder(order.status, 'cancelled')) return c.text('订单状态无效，无法拒绝', 409)
  const automaticCancellationPayment = await c.env.RENT.prepare("SELECT id FROM payments WHERE rental_id = ? AND ((status = 'paid' AND payment_method IN ('balance', 'card')) OR (status = 'pending' AND payment_method = 'card' AND stripe_payment_intent_id = (SELECT stripe_deposit_payment_intent_id FROM orders WHERE id = ?))) LIMIT 1").bind(order.id, order.id).first()
  if (automaticCancellationPayment) {
    const response = await cancelAndRefund(c, user, order.id)
    if (response.status >= 400) return response
  } else {
    await updateOrderStatus(c, order.id, 'cancelled')
    await updateDeviceStatus(c, order.deviceId, 'available')
  }
  await deleteRentalApplicationNotifications(c, order.id)
  await createNotification(c, { recipientId: order.userId, senderId: user.id, type: 'rental_application_rejected', title: '租赁申请未通过', message: `您的设备租赁申请已由${user.name || '工作人员'}拒绝，请联系工作人员了解详情。`, orderId: order.id })
  return c.redirect(staffOrderPath(order))
})

app.post('/staff/orders/:orderId/mark-paid', async (c) => {
  const user = c.get('user')
  if (!user || (user.role !== 'STAFF' && user.role !== 'ADMIN')) return c.html(renderForbidden(), 403)
  return c.text('银行转账必须由管理员审核客户提交的 Reference', 409)
})

app.post('/staff/orders/:orderId/complete', async (c) => {
  const user = c.get('user')
  if (!user || (user.role !== 'STAFF' && user.role !== 'ADMIN')) return c.html(renderForbidden(), 403)
  return c.text('请通过归还验机流程完成订单', 409)
})

app.post('/staff/orders/:orderId/return-collection', async (c) => {
  const user = c.get('user')
  if (!user || !['STAFF', 'ADMIN'].includes(user.role)) return c.html(renderForbidden(), 403)
  try {
    const { startReturnCollection } = await import('./services/returnCollections')
    const id = await startReturnCollection(c, user, c.req.param('orderId'), await c.req.parseBody())
    return c.redirect(`/staff/return-collections/${encodeURIComponent(id)}`, 303)
  } catch (error: any) { return c.text(error.message || '收款失败', error.message === '无权操作' ? 403 : 409) }
})

app.get('/staff/return-collections/:id', async (c) => {
  const user = c.get('user')
  if (!user || !['STAFF', 'ADMIN'].includes(user.role)) return c.html(renderForbidden(), 403)
  try { return c.html(await pages.renderReturnCollection(c, user, c.req.param('id'))) }
  catch (error: any) { return c.text(error.message || '收款记录不存在', error.message === '无权操作' ? 403 : 404) }
})

for (const action of ['verify-stripe', 'cancel']) app.post(`/staff/return-collections/:id/${action}`, async (c) => {
  const user = c.get('user')
  if (!user || !['STAFF', 'ADMIN'].includes(user.role)) return c.html(renderForbidden(), 403)
  try {
    const { verifyReturnStripeReceipt, cancelReturnCollection } = await import('./services/returnCollections')
    const form = await c.req.parseBody()
    if (action === 'verify-stripe') await verifyReturnStripeReceipt(c, user, c.req.param('id'), form.receiptId)
    else await cancelReturnCollection(c, user, c.req.param('id'), form.confirmUnpaid === '1')
    return c.redirect(`/staff/return-collections/${encodeURIComponent(c.req.param('id'))}`, 303)
  } catch (error: any) { return c.text(error.message || '收款处理失败', error.message === '无权操作' ? 403 : 409) }
})

app.get('/staff/orders/:orderId/inspection', async (c) => {
  const user = c.get('user')
  if (!user || !['STAFF', 'ADMIN'].includes(user.role)) return c.html(renderForbidden(), 403)
  const order = await getOrderById(c, c.req.param('orderId'))
  const customer = order ? await getUserById(c, order.userId) : null
  if (order && user.role === 'STAFF' && customer?.staffId !== user.id) return c.html(renderForbidden(), 403)
  const inspectionStatuses = ['active', 'extended', 'overdue', 'suspended', 'pending_return']
  if (order && inspectionStatuses.includes(String(order.status))) {
    await c.env.RENT.prepare('UPDATE devices SET inspection_requested_at = CURRENT_TIMESTAMP WHERE id = ?').bind(order.deviceId).run()
    await recordDeviceLifecycle(c, order.deviceId, 'INSPECTION', { orderId: order.id, reason: '已进入归还验机', changedBy: user.id })
  }
  return c.html(await pages.renderStaffInspection(c, user, c.req.param('orderId')))
})

app.post('/staff/orders/:orderId/inspection', async (c) => {
  const user = c.get('user')
  if (!user || !['STAFF', 'ADMIN'].includes(user.role)) return c.html(renderForbidden(), 403)
  let order = await getOrderById(c, c.req.param('orderId'))
  if (!order || !['active', 'extended', 'overdue', 'suspended', 'pending_return'].includes(String(order.status))) return c.text('当前订单不能验机', 409)
  const returnCustomer = await getUserById(c, order.userId)
  if (user.role === 'STAFF' && returnCustomer?.staffId !== user.id) return c.html(renderForbidden(), 403)
  const form = await c.req.parseBody()
  const allowedCheck = new Set(['正常', '异常', '未测试'])
  const checks: Record<string, string> = {}
  for (const [input, field] of [['screenCondition', 'screen_condition'], ['keyboardCondition', 'keyboard_condition'], ['trackpadCondition', 'trackpad_condition'], ['bodyCondition', 'body_condition'], ['cameraCondition', 'camera_condition'], ['wifiCondition', 'wifi_condition'], ['powerTest', 'power_test']]) {
    const value = String(form[input] || '')
    if (!allowedCheck.has(value)) return c.text(`${input} 检查结果无效`, 400)
    checks[field] = value
  }
  const replacementCost = Number(form.replacementCost || 0)
  const batteryCycles = form.batteryCycles ? Number(form.batteryCycles) : null
  if (!Number.isFinite(replacementCost) || replacementCost < 0 || (batteryCycles !== null && (!Number.isInteger(batteryCycles) || batteryCycles < 0))) return c.text('费用或电池循环次数无效', 400)
  const damageDescription = String(form.damageDescription || '').trim().slice(0, 2000)
  const now = new Date().toISOString()
  const contract = await c.env.RENT.prepare('SELECT id FROM contracts WHERE orderId = ? AND deleted_at IS NULL ORDER BY createdAt DESC LIMIT 1').bind(order.id).first() as any
  if (!contract) return c.text('订单缺少合同', 409)
  const beforeInspection = await c.env.RENT.prepare("SELECT snapshot_json FROM device_inspections WHERE deleted_at IS NULL AND device_id = ? AND inspection_type = 'before_rental' ORDER BY created_at DESC LIMIT 1").bind(order.deviceId).first() as any
  let inspectionSnapshot: Record<string, any> = {}
  try { inspectionSnapshot = JSON.parse(beforeInspection?.snapshot_json || '{}') } catch (_) { }
  let damagePhotos = ''
  try { damagePhotos = (await resolveImageUrls(form.damagePhotoFiles, form.damagePhotos, c, 'rent/damage-photos', 5)).join('\n') } catch (error: any) { return c.text(error.message, 400) }
  if (damageDescription && !damagePhotos) return c.text('记录损坏时必须提供至少一张损坏照片链接', 400)
  await chargeOverdueReturns(c, new Date(), order.id)
  order = (await getOrderById(c, order.id))!
  if (order.deposit_payment_mode === 'PREAUTH') {
    if (!/^\d+(\.\d{1,2})?$/.test(String(form.replacementCost || '0')) || (replacementCost > 0 && !damageDescription)) return c.text('请填写有效的损坏扣款金额和损坏说明', 400)
    if (replacementCost + Number(order.overdue_deposit_applied || 0) > Number(order.depositAmount || 0)) return c.text('扣款金额不能高于押金金额', 400)
  }
  try {
    await refundUnusedRentalDays(c, user, order, now.slice(0, 10))
  } catch (error: any) {
    return c.text(error.message || '未使用租金退款失败，订单暂未完成', 502)
  }
  Object.assign(inspectionSnapshot, checks, { batteryCycles, batteryHealth: String(form.batteryHealth || '').trim().slice(0, 100), damageDescription, damagePhotos, replacementCost: replacementCost.toFixed(2), returnDate: now.slice(0, 10), inspectionBy: user.name || user.id })
  const inspectionId = `inspection-${nanoid(12)}`
  const returnDevice = await getDeviceById(c, order.deviceId)
  // 订单进 completed 的这一刻押金往往还没结清（HELD/PENDING）——settlement_status
  // 要单独反映这个事实，不能让“已完成”看起来什么都办完了。
  const settlementStatusOnCompletion = computeOrderSettlementStatus({ status: 'completed', deposit_status: order.deposit_status, overdue_outstanding_amount: order.overdue_outstanding_amount })
  await c.env.RENT.batch([
    c.env.RENT.prepare("UPDATE orders SET status = 'completed', order_status = 'COMPLETED', payment_status = COALESCE(payment_status, 'PAID'), rental_status = 'COMPLETED', return_received_at = COALESCE(return_received_at, CURRENT_TIMESTAMP), return_received_by = COALESCE(return_received_by, ?), settlement_status = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?").bind(user.id, settlementStatusOnCompletion, order.id),
    c.env.RENT.prepare("INSERT INTO rental_status_history (id, rental_id, old_status, new_status, trigger_type, triggered_by, reason) VALUES (?, ?, ?, 'RETURNED', 'MANUAL', ?, ?), (?, ?, 'RETURNED', 'COMPLETED', 'SYSTEM', ?, ?)").bind(`rsh-${nanoid(16)}`, order.id, order.rental_status || 'RETURN_PENDING', user.id, '工作人员收到设备并开始归还验机', `rsh-${nanoid(16)}`, order.id, user.id, '归还验机完成'),
    c.env.RENT.prepare('INSERT INTO device_inspections (id, device_id, rental_id, inspection_type, snapshot_json, differences_json) VALUES (?, ?, ?, \'after_return\', ?, ?)').bind(inspectionId, order.deviceId, order.id, JSON.stringify(inspectionSnapshot), JSON.stringify({})),
    c.env.RENT.prepare("INSERT OR IGNORE INTO order_fulfillment_records (id, order_id, record_type, device_serial_number, accessories_json, condition_snapshot_json, notes, recorded_by) VALUES (?, ?, 'RETURN', ?, '[]', ?, ?, ?)").bind(`return-${nanoid(12)}`, order.id, String(returnDevice?.serialNumber || ''), JSON.stringify(inspectionSnapshot), damageDescription || null, user.id),
    ...(damageDescription ? [c.env.RENT.prepare("INSERT INTO damage_cases (id, order_id, device_id, description, photo_urls, estimated_cost_cents, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(`damage-${nanoid(12)}`, order.id, order.deviceId, damageDescription, damagePhotos, Math.round(replacementCost * 100), user.id)] : []),
  ])
  if (damageDescription) await recordDeviceLifecycle(c, order.deviceId, 'DAMAGED', { orderId: order.id, reason: damageDescription, changedBy: user.id })
  else await releaseDeviceIfUnbooked(c, order.deviceId, { orderId: order.id, reason: '归还验机完成', changedBy: user.id })
  await createAuditLog(c, { actor: user, action: damageDescription ? 'RETURN_INSPECTION_COMPLETED_WITH_DAMAGE' : 'RETURN_INSPECTION_COMPLETED', targetType: 'ORDER', targetId: order.id, before: { status: order.status, rentalStatus: order.rental_status }, after: { status: 'completed', rentalStatus: 'COMPLETED', inspectionId, damageReported: Boolean(damageDescription) }, reason: damageDescription || '归还验机完成' })
  const settlementResponse = await settleCompletedOrderAuthorization(c, user, order.id)
  if (settlementResponse && settlementResponse.status >= 400) return settlementResponse
  return c.redirect(user.role === 'ADMIN' ? `/admin/orders/${order.id}` : staffOrderPath(order))
})

// 必须注册在 /staff/orders/:orderId/handover、/staff/orders/:orderId/inspection 等二段式字面量路由之后，
// 否则 Hono 会先匹配到这个 :date/:code 通配路由，导致那些操作链接一律 404。
app.get('/staff/orders/:date/:code', async (c) => {
  const user = c.get('user')
  if (!user || (user.role !== 'STAFF' && user.role !== 'ADMIN')) {
    return c.redirect('/login')
  }
  const order = await getOrderByOrderNo(c, `OD-${c.req.param('date')}-${c.req.param('code')}`)
  if (!order) return c.html(renderNotFound(), 404)
  await loadSystemSettingsFromDB(c)
  return c.html(await pages.renderStaffOrderDetail(c, user, order.id))
})

app.post('/customer/orders/:orderId/inspection-dispute', async (c) => {
  const user = c.get('user') as any
  if (!user || user.role !== 'CUSTOMER') return c.html(renderForbidden(), 403)
  const order = await getOrderById(c, c.req.param('orderId'))
  if (!order || order.userId !== user.id) return c.html(renderForbidden(), 403)
  const deduction = await c.env.RENT.prepare("SELECT deduction_amount FROM payment_refunds WHERE order_id = ? AND type = 'deposit' AND status = 'succeeded' ORDER BY created_at DESC LIMIT 1").bind(order.id).first() as any
  if (Number(deduction?.deduction_amount || 0) <= 0) return c.text('未发生押金扣除，不能提交验机异议', 409)
  const form = await c.req.parseBody()
  const message = sanitizePlainText(String(form.message || ''), 2000).trim()
  if (!message) return c.text('请填写异议内容', 400)
  await c.env.RENT.prepare('INSERT INTO inspection_disputes (id, order_id, customer_id, message) VALUES (?, ?, ?, ?)').bind(`idp-${nanoid(12)}`, order.id, user.id, message).run()
  return c.redirect(`/customer/orders/${order.id}`)
})

app.post('/staff/orders/:orderId/cancel', async (c) => {
  const user = c.get('user')
  if (!user || user.role !== 'ADMIN') return c.html(renderForbidden(), 403)
  const cancelForm = await c.req.parseBody()
  const cancelReason = String(cancelForm.reason || '').trim().slice(0, 300)
  if (!cancelReason) return c.text('请填写取消原因', 400)
  try {
    const response = await cancelAndRefund(c, user, c.req.param('orderId'), cancelReason)
    if (response.status < 400) await createAuditLog(c, { actor: user, action: 'ORDER_CANCELLED', targetType: 'ORDER', targetId: c.req.param('orderId'), reason: cancelReason })
    return response
  } catch (error: any) { return c.text(error?.message || '全额退款失败', 502) }
})

app.get('/staff/contracts', async (c) => {
  const user = c.get('user')
  if (!user || (user.role !== 'STAFF' && user.role !== 'ADMIN')) {
    return c.redirect('/login')
  }
  const status = c.req.query('status');
  const searchTerm = c.req.query('searchTerm');
  return c.html(await pages.renderStaffContracts(c, user, status, undefined, undefined, searchTerm))
})

app.get('/staff/rentals/tracking', async (c) => {
  const user = c.get('user')
  if (!user || (user.role !== 'STAFF' && user.role !== 'ADMIN')) {
    return c.redirect('/login')
  }
  // 获取查询参数中的status和searchTerm
  const status = c.req.query('status')
  const searchTerm = c.req.query('searchTerm')
  return c.html(await pages.renderStaffRentalsTracking(c, user, status, searchTerm))
})

app.get('/staff/devices', async (c) => {
  const user = c.get('user')
  if (!user || user.role !== 'ADMIN') return c.html(renderForbidden(), 403)
  return c.html(await pages.renderStaffDevices(c, user))
})

app.get('/staff/devices/new', (c) => {
  const user = c.get('user')
  if (!user || user.role !== 'ADMIN') return c.html(renderForbidden(), 403)
  return c.html(pages.renderStaffDeviceNew(user))
})

app.post('/staff/devices/new', async (c) => {
  const user = c.get('user')
  if (!user || user.role !== 'ADMIN') return c.html(renderForbidden(), 403)
  const form = await c.req.parseBody()
  const name = String(form.name || '').trim()
  const model = String(form.model || '').trim()
  const serialNumber = String(form.serialNumber || '').trim()
  const pricePerDay = Number(form.dailyRate)
  const weeklyDiscountPercent = parseDeviceDiscountPercent(form.weeklyDiscountPercent)
  const monthlyDiscountPercent = parseDeviceDiscountPercent(form.monthlyDiscountPercent)
  const status = String(form.status || 'available') as any
  if (!name || !model || !serialNumber || !Number.isFinite(pricePerDay) || pricePerDay < 0 || weeklyDiscountPercent === null || monthlyDiscountPercent === null || !['available', 'rented', 'maintenance', 'retired'].includes(status)) return c.html(pages.renderStaffDeviceNew(user, '请填写完整有效的设备资料和 0%–100% 的折扣'), 400)
  const device = await insertDevice(c, { name, category: String(form.category || '其他'), model, serialNumber, pricePerDay, depositAmount: 0, weeklyDiscountPercent, monthlyDiscountPercent, weeklyDiscountOverride: String(form.weeklyDiscountPercent ?? '').trim() ? weeklyDiscountPercent : null, monthlyDiscountOverride: String(form.monthlyDiscountPercent ?? '').trim() ? monthlyDiscountPercent : null, demoMode: form.demoMode === '1', status, description: '' })
  return c.redirect(`/staff/devices/${device.id}`)
})

app.get('/staff/devices/:id/edit', async (c) => {
  const user = c.get('user')
  if (!user || user.role !== 'ADMIN') return c.html(renderForbidden(), 403)
  return c.html(await pages.renderStaffDeviceEdit(c, user, c.req.param('id')))
})

app.post('/staff/devices/:id/edit', async (c) => {
  const user = c.get('user')
  if (!user || user.role !== 'ADMIN') return c.html(renderForbidden(), 403)
  const form = await c.req.parseBody()
  const pricePerDay = Number(form.dailyRate)
  const weeklyDiscountPercent = parseDeviceDiscountPercent(form.weeklyDiscountPercent)
  const monthlyDiscountPercent = parseDeviceDiscountPercent(form.monthlyDiscountPercent)
  const status = String(form.status || 'available')
  if (!String(form.name || '').trim() || !String(form.model || '').trim() || !String(form.serialNumber || '').trim() || !Number.isFinite(pricePerDay) || pricePerDay < 0 || weeklyDiscountPercent === null || monthlyDiscountPercent === null || !['available', 'rented', 'maintenance', 'retired'].includes(status)) return c.html(await pages.renderStaffDeviceEdit(c, user, c.req.param('id'), '请填写完整有效的设备资料和 0%–100% 的折扣'), 400)
  await updateDevice(c, c.req.param('id'), { name: String(form.name), category: String(form.category || '其他'), model: String(form.model), serialNumber: String(form.serialNumber), pricePerDay, weeklyDiscountPercent, monthlyDiscountPercent, weeklyDiscountOverride: String(form.weeklyDiscountPercent ?? '').trim() ? weeklyDiscountPercent : null, monthlyDiscountOverride: String(form.monthlyDiscountPercent ?? '').trim() ? monthlyDiscountPercent : null, demoMode: form.demoMode === '1', status: status as any })
  return c.redirect(`/staff/devices/${c.req.param('id')}`)
})

app.get('/staff/devices/:id', async (c) => {
  const user = c.get('user')
  if (!user || user.role !== 'ADMIN') return c.html(renderForbidden(), 403)
  return c.html(await pages.renderStaffDeviceDetail(c, user, c.req.param('id')))
})

app.post('/staff/devices/:id/agent-setup', async (c) => {
  const user = c.get('user')
  if (!user || user.role !== 'ADMIN') return c.html(renderForbidden(), 403)
  const randomValue = new Uint32Array(1)
  crypto.getRandomValues(randomValue)
  const code = String(100000 + (randomValue[0] % 900000))
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(code))
  const hash = Array.from(new Uint8Array(digest)).map((value) => value.toString(16).padStart(2, '0')).join('')
  await c.env.RENT.prepare(`UPDATE devices SET agent_setup_code_hash = ?, agent_setup_code_expires_at = datetime(CURRENT_TIMESTAMP, '+15 minutes'), updatedAt = CURRENT_TIMESTAMP WHERE id = ?`).bind(hash, c.req.param('id')).run()
  return c.redirect(`/staff/devices/${c.req.param('id')}?agentSetupCode=${code}`)
})



app.get('/staff/contracts/new', async (c) => {
  const user = c.get('user')
  if (!user || (user.role !== 'STAFF' && user.role !== 'ADMIN')) {
    return c.redirect('/login')
  }
  // 合同创建失败后回跳时会带 ?error= 与已填字段，按白名单回填到表单。
  const contractPrefill: Record<string, string> = {}
  for (const key of ['deviceId', 'startDate', 'endDate', 'startPeriod', 'endPeriod', 'deliveryMethod', 'returnMethod', 'pickupLocation', 'returnLocation', 'deviceCondition', 'deviceAccessories', 'lateFeePerDay', 'repairCost', 'deliveryFee', 'deliveryStreet', 'deliverySuburb', 'deliveryState', 'deliveryPostcode', 'expiryDuration']) {
    const value = c.req.query(key)
    if (value) contractPrefill[key] = String(value)
  }
  return c.html(await pages.renderNewContractPage(c, user, contractPrefill))
})

app.get('/staff/inspections', async (c) => {
  const user = c.get('user')
  if (!user || !['STAFF', 'ADMIN'].includes(user.role)) return c.html(renderForbidden(), 403)
  return c.html(await pages.renderInspectionRecords(c, user))
})

app.get('/staff/inspections/device/:deviceId', async (c) => {
  const user = c.get('user')
  if (!user || !['STAFF', 'ADMIN'].includes(user.role)) return c.html(renderForbidden(), 403)
  return c.html(await pages.renderInspectionDevice(c, user, c.req.param('deviceId'), c.req.query('page') || '1'))
})

app.get('/admin/inspections', async (c) => {
  const user = c.get('user')
  if (!user || user.role !== 'ADMIN') return c.html(renderForbidden(), 403)
  return c.html(await pages.renderInspectionRecords(c, user))
})

app.get('/staff/inspections/:id/edit', async (c) => {
  const user = c.get('user')
  if (!user || !['STAFF', 'ADMIN'].includes(user.role)) return c.html(renderForbidden(), 403)
  return c.html(await pages.renderInspectionEdit(c, user, c.req.param('id')))
})

app.post('/staff/inspections/:id/edit', async (c) => {
  const user = c.get('user') as any
  if (!user || !['STAFF', 'ADMIN'].includes(user.role)) return c.html(renderForbidden(), 403)
  const record = await c.env.RENT.prepare('SELECT snapshot_json FROM device_inspections WHERE deleted_at IS NULL AND id = ?').bind(c.req.param('id')).first() as any
  if (!record) return c.html(renderNotFound(), 404)
  const form = await c.req.parseBody()
  let snapshot: any = {}
  try { snapshot = JSON.parse(String(record.snapshot_json || '{}')) } catch (_) { }
  const editableFields = ['screen', 'keyboard', 'touchpad', 'body', 'camera', 'wifi', 'power', 'batteryCycles', 'batteryHealth', 'damageDescription', 'inspectionNotes']
  for (const field of editableFields) if (form[field] !== undefined) snapshot[field] = String(form[field] || '').trim().slice(0, 500)
  if (!snapshot || Array.isArray(snapshot) || typeof snapshot !== 'object' || JSON.stringify(snapshot).length > 20000) return c.text('验机记录内容无效', 400)
  await c.env.RENT.prepare('UPDATE device_inspections SET snapshot_json = ?, edited_by = ?, edited_at = CURRENT_TIMESTAMP WHERE id = ?').bind(JSON.stringify(snapshot), user.id, c.req.param('id')).run()
  return c.redirect('/staff/inspections')
})

app.post('/staff/contracts/create', async (c) => {
  const user = c.get('user')
  if (!user || (user.role !== 'STAFF' && user.role !== 'ADMIN')) {
    return c.redirect('/login')
  }
  const form = await c.req.parseBody()
  return actions.handleCreateContractAction(c, user, form)
})

app.get('/staff/contracts/:id/progress', async (c) => {
  const user = c.get('user')
  if (!user || (user.role !== 'STAFF' && user.role !== 'ADMIN')) {
    return c.redirect('/login')
  }
  const contract = await getContractById(c, c.req.param('id'))
  if (!contract || (user.role !== 'ADMIN' && (contract.createdBy || contract.created_by) !== user.id)) return c.html(renderForbidden(), 403)
  if (contract.status !== 'pending_sign' || isContractExpired(contract)) return c.redirect('/staff/contracts')
  return c.html(await pages.renderStaffContractProgress(c, user, contract.id))
})

app.get('/staff/contracts/:id/data', async (c) => {
  const user = c.get('user')
  if (!user || !['STAFF', 'ADMIN'].includes(user.role)) return c.redirect('/login')
  const contract = await getContractById(c, c.req.param('id'))
  if (!contract || (user.role !== 'ADMIN' && (contract.createdBy || contract.created_by) !== user.id)) return c.html(renderForbidden(), 403)
  if (isContractExpired(contract) || ['completed', 'cancelled'].includes(contract.status)) return c.html(renderForbidden(), 403)
  return c.html(await pages.renderAdminContractData(c, user, contract.id))
})

app.post('/staff/contracts/:id/data', async (c) => {
  const user = c.get('user')
  if (!user || !['STAFF', 'ADMIN'].includes(user.role)) return c.redirect('/login')
  const contract = await getContractById(c, c.req.param('id'))
  if (!contract || (user.role !== 'ADMIN' && (contract.createdBy || contract.created_by) !== user.id)) return c.html(renderForbidden(), 403)
  if (isContractExpired(contract) || ['completed', 'cancelled'].includes(contract.status)) return c.html(renderForbidden(), 403)
  let form: Record<string, any>
  try { form = await parseFormBodyForRequest(c) } catch (error: any) {
    if (String(error?.message || '').startsWith('FORM_LIMIT:')) return c.text('表单内容过长或字段过多', 413)
    throw error
  }
  const allowed = new Set(CONTRACT_OPERATIONAL_FIELDS.map(([name]) => name))
  const existing = typeof contract.contract_data === 'string' ? JSON.parse(contract.contract_data || '{}') : (contract.contract_data || {})
  // 已签署字段直接忽略，不报错；签署记录始终保持原值。
  const submitted = Object.entries(form).filter(([name]) => allowed.has(name as any) && !(contract.status === 'signed' && CONTRACT_SIGNED_FIELDS.has(name))).map(([name, value]) => [name, String(value).trim().slice(0, 4000)])
  const submittedData = Object.fromEntries(submitted)
  if (allowed.has('damage_photos') && !(contract.status === 'signed' && CONTRACT_SIGNED_FIELDS.has('damage_photos'))) {
    try { await addWatermarkedContractDamagePhotos(c, form, submittedData) } catch (error: any) { return c.text(error.message, 400) }
  }
  await c.env.RENT.prepare('UPDATE contracts SET contract_data = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?').bind(JSON.stringify({ ...existing, ...submittedData }), contract.id).run()
  return c.redirect(`/staff/contracts/${contract.id}/data`)
})

app.post('/staff/contract/:id/cancel', async (c) => {
  const user = c.get('user')
  if (!user || (user.role !== 'STAFF' && user.role !== 'ADMIN')) {
    return c.redirect('/login')
  }
  return actions.handleCancelContractAction(c)
})

app.get('/staff/contract/view', async (c) => {
  const user = c.get('user')
  if (!user || (user.role !== 'STAFF' && user.role !== 'ADMIN')) {
    return c.redirect('/login')
  }
  return c.html(await pages.renderStaffContractView(c, user, c.req.query('orderId') || ''))
})

app.get('/rent/:token', (c) => pages.renderPublicRentalLink(c))
app.post('/rent/:token', (c) => actions.bookRentalLink(c))

app.get('/contract/sign', async (c) => {
  const token = c.req.query('token') || c.req.query('number') || '';
  const step = Number(c.req.query('step') || '1');
  const error = c.req.query('error');
  return c.html(await pages.renderContractSignPage(c, token, step, error));
});

app.get('/translation.js', c => c.body(TRANSLATION_CLIENT_SCRIPT, 200, { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'public, max-age=3600' }))
app.post('/api/translate', c => handleTranslation(c))
app.post('/api/translate/:provider', c => handleTranslation(c))

app.get('/api/coupons/rental-preview', async (c) => {
  const deviceId = String(c.req.query('deviceId') || '').trim()
  const days = Number(c.req.query('days') || 0)
  const code = String(c.req.query('code') || '').trim().toUpperCase().slice(0, 40)
  if (!deviceId || !code || !Number.isInteger(days) || days < 1 || days > 365) return c.json({ ok: false, message: '请先选择有效租期并输入优惠码' }, 400)
  const device = await getDeviceById(c, deviceId) as any
  if (!device) return c.json({ ok: false, message: '设备不存在' }, 404)
  const rent = calculateRentalFee(device, days)
  const previewUser = c.get('user')
  const previewRisk = previewUser?.role === 'CUSTOMER' ? await getCustomerRiskAssessment(c, previewUser.id) : calculateCustomerRiskAssessment({})
  const deposit = riskAdjustedDeposit(Number(device.depositAmount || 0), previewRisk.level)
  const feeParts = { rentalFee: rent, deliveryFee: 0, depositFee: deposit }
  let coupon: any
  try {
    coupon = await findEligibleCoupon(c, code, device, feeParts)
  } catch (error: any) {
    return c.json({ ok: false, message: error?.message || '优惠码无效' })
  }
  const discount = calculateCouponDiscount(coupon, feeParts)
  return c.json({ ok: true, rent, discount, deposit, total: Number((rent + deposit - discount).toFixed(2)), message: `已优惠 AUD$${discount.toFixed(2)}` })
})

app.post('/public/order-lookup', async (c) => {
  let body: Record<string, unknown> = {}
  try { body = (await c.req.json()) as Record<string, unknown> } catch { return c.json({ ok: false, message: '请求格式无效。' }, 400) }
  const orderNo = String(body.orderNo || '').trim().toUpperCase()
  const email = String(body.email || '').trim().toLowerCase()
  if (!orderNo || !email) return c.json({ ok: false, message: '请输入订单编号和申请邮箱。' }, 400)
  const order = await c.env.RENT.prepare(`SELECT o.id, o.orderNo, o.status, o.startDate, o.endDate, o.totalAmount, o.depositAmount, o.deliveryMethod, o.pickupLocation, o.userId, u.email, u.account_type, d.name AS deviceName FROM orders o JOIN users u ON u.id = o.userId LEFT JOIN devices d ON d.id = o.deviceId WHERE UPPER(o.orderNo) = ? AND lower(u.email) = ? AND o.deleted_at IS NULL`).bind(orderNo, email).first() as any
  if (!order) return c.json({ ok: false, message: '没有找到匹配的订单，请检查订单编号和邮箱。' }, 404)
  if (String(order.account_type || 'formal') !== 'guest') return c.json({ ok: true, registered: true, message: '该邮箱已注册，请进入账号中心登录查看订单。', loginUrl: '/login' })
  const temporaryPassword = generateTemporaryPassword()
  await c.env.RENT.prepare("UPDATE users SET password_hash = ?, password_salt = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND account_type = 'guest'").bind(await hashPassword(temporaryPassword), order.userId).run()
  return c.json({ ok: true, registered: false, order: { orderNo: order.orderNo, status: order.status, deviceName: order.deviceName, startDate: order.startDate, endDate: order.endDate, totalAmount: order.totalAmount, depositAmount: order.depositAmount, deliveryMethod: order.deliveryMethod, pickupLocation: order.pickupLocation }, temporaryPassword })
})

app.get('/api/contract-sign/coupon-preview', async (c) => {
  const token = c.req.query('token') || c.req.query('number') || ''
  const code = String(c.req.query('code') || '').trim().toUpperCase().slice(0, 40)
  if (!token || !code) return c.json({ ok: true, discount: 0, total: null, message: '' })
  const contract = await getContractBySignToken(c, token) as any
  if (!contract) return c.json({ ok: false, message: '合同链接无效或已过期' }, 404)
  const order = await getOrderById(c, contract.rentalId || contract.rental_id) as any
  if (!order) return c.json({ ok: false, message: '订单不存在' }, 404)
  const device = await getDeviceById(c, order.deviceId || order.device_id) as any
  const deposit = Number(order.depositAmount || order.deposit_amount || 0)
  const delivery = Number(order.deliveryFee || order.delivery_fee || 0)
  const base = Number(order.totalAmount || order.total_amount || 0)
  const rentAmount = Math.max(0, base - deposit - delivery)
  let coupon: any
  const feeParts = { rentalFee: rentAmount, deliveryFee: delivery, depositFee: deposit }
  try {
    coupon = await findEligibleCoupon(c, code, device || { id: order.deviceId || order.device_id }, feeParts)
  } catch (error: any) {
    return c.json({ ok: false, message: error?.message || '优惠码无效' })
  }
  const discount = calculateCouponDiscount(coupon, feeParts)
  return c.json({ ok: true, discount, total: Number((base - discount).toFixed(2)), message: `已优惠 AUD$${discount.toFixed(2)}` })
})

// 签约「异步 Stripe」等待面板轮询用：只读返回一笔订单的支付状态。
app.get('/api/payment/status', async (c) => {
  const user = c.get('user') as any
  if (!user) return c.json({ error: 'unauthorized' }, 401)
  const orderId = String(c.req.query('orderId') || '')
  if (!orderId) return c.json({ error: 'missing orderId' }, 400)
  const order = await getOrderById(c, orderId) as any
  if (!order) return c.json({ error: 'not found' }, 404)
  const ownsOrder = order.userId === user.id ||
    (user.accountType === 'guest' && String(user.guestOrderId || '') === orderId)
  if (!ownsOrder) return c.json({ error: 'forbidden' }, 403)
  const payments = ((await c.env.RENT.prepare('SELECT status, amount, processing_fee, payment_method, payment_provider, deposit_amount, created_at FROM payments WHERE rental_id = ? ORDER BY created_at DESC LIMIT 20').bind(order.id).all()).results || []) as any[]
  const payment = pages.selectPaymentResultPayment(order, payments)
  const paymentMethod = String(payment?.payment_method || order.paymentMethod || 'card')
  const provider = String(payment?.payment_provider || order.paymentProvider || (paymentMethod === 'card' ? 'stripe' : 'internal'))
  const state = pages.paymentResultState({ ...order, paymentMethod, payment_method: paymentMethod, paymentProvider: provider, payment_provider: provider }, payment, false)
  return c.json({ state, orderNo: order.orderNo || null, redirectTarget: `/customer/orders/${order.id}` }, 200, { 'Cache-Control': 'no-store' })
})

app.post('/contract/sign/payment-plan', async (c) => {
  const token = String(c.req.query('token') || '')
  if (!/^[A-Za-z0-9_-]{32}$/.test(token)) return c.html(renderForbidden(), 403)
  const contract = await getContractBySignToken(c, token)
  if (!contract || contract.signToken !== token || !['draft', 'pending_sign'].includes(contract.status) || isContractExpired(contract)) return c.html(renderForbidden(), 403)
  const order = await getOrderById(c, contract.rentalId || contract.rental_id)
  if (!order) return c.text('订单不存在', 404)
  const session = await getOrCreateSignSession(c, token, token)
  if (!session.agreedToTerms || !session.userInfo?.name) return c.html(renderForbidden(), 403)
  try {
    const form = await c.req.parseBody()
    await setRentalPaymentPlan(c, order, form.billingMode)
    return c.redirect(`/contract/sign?token=${encodeURIComponent(token)}&step=4`, 303)
  } catch (error: any) {
    return c.redirect(`/contract/sign?token=${encodeURIComponent(token)}&step=4&error=${encodeURIComponent(error?.message || '付款计划更新失败')}`, 303)
  }
})

app.post('/contract/sign', async (c) => {
  const token = c.req.query('token') || c.req.query('number') || '';
  const step = Number(c.req.query('step') || '1');
  const form = await c.req.parseBody();
  return actions.handleSignContractStep(c, token, step, form);
});

app.post('/admin/contracts/template', async (c) => {
  const user = c.get('user')
  if (!user || user.role !== 'ADMIN') {
    return c.json({ success: false, error: '无权限保存合同模板' }, 403)
  }

  try {
    const contentType = c.req.header('content-type') || ''
    const payload = contentType.includes('application/json')
      ? JSON.parse(await c.req.text() || '{}')
      : await c.req.parseBody()
    const currentTemplate = await getContractTemplate(c)
    const contentChanged = sanitizeRichHtml(currentTemplate?.content || '') !== sanitizeRichHtml(payload.content || '')
    const updatedTemplate = await updateContractTemplate(c, {
      id: payload.id || 'default',
      name: payload.name || '标准租赁合同模板',
      content: payload.content || '',
    })
    const metadata = getSystemSettings().legalMetadata || {}
    const suppliedDate = String(payload.lastUpdatedDate || '').trim()
    const existingDate = String(metadata?.contract?.lastUpdatedDate || '').trim()
    const melbourneToday = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Australia/Melbourne', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date())
    const lastUpdatedDate = /^\d{4}-\d{2}-\d{2}$/.test(suppliedDate)
      ? suppliedDate
      : (contentChanged || !/^\d{4}-\d{2}-\d{2}$/.test(existingDate) ? melbourneToday : existingDate)
    await updateSystemSettings(c, { legalMetadata: { ...metadata, contract: { version: String(payload.version || '1.0').trim().slice(0, 30) || '1.0', lastUpdatedDate } } } as any)
    return contentType.includes('application/json') ? c.json({ success: true, template: updatedTemplate }) : c.redirect('/admin/templates/contract')
  } catch (error: any) {
    console.error('Failed to save contract template:', error?.stack || error)
    return c.json({ success: false, error: error?.message || '合同模板保存失败' }, 500)
  }
});

app.get('/contract/view/:id', async (c) => {
  const user = c.get('user') as any
  if (user && c.req.query('from') !== 'order') {
    const contract = await getContractById(c, c.req.param('id'))
    const order = contract ? await getOrderById(c, contract.rentalId) : null
    if (order && (user.role === 'ADMIN' || user.role === 'STAFF' || order.userId === user.id)) {
      const orderPath = user.role === 'ADMIN' ? `/admin/orders/${order.id}` : user.role === 'STAFF' ? staffOrderPath(order) : `/customer/orders/${order.id}`
      return c.redirect(orderPath)
    }
  }
  return c.html(await pages.renderContractView(c, c.req.param('id'), c.get('user')))
})

app.get('/contract/print/:id', async (c) => {
  const user = c.get('user') as any
  if (!user) return c.redirect(`/login?redirect=${encodeURIComponent(`/contract/print/${c.req.param('id')}`)}`)
  return c.html(await pages.renderContractView(c, c.req.param('id'), user, true))
})

app.get('/verify', async (c) => {
  const number = String(c.req.query('number') || '').trim()
  const token = String(c.req.query('token') || '').trim()
  if (!number && !token) return c.html(pages.renderContractVerifyForm())
  if (!number || !token) return c.html(pages.renderContractVerifyForm(number), 400)
  const contract = await getContractByContractNumber(c, number)
  const expected = contract ? String((contract as any).verification_token || '') : ''
  if (!contract || !expected || !timingSafeEqualStr(expected, token)) {
    return c.html(pages.renderContractVerifyResult(null), 404)
  }
  const order = await getOrderById(c, contract.rentalId)
  const device = order ? await getDeviceById(c, order.deviceId) : null
  const statusLabel = contract.status === 'cancelled' ? '已作废' : ['signed', 'completed'].includes(String(contract.status)) ? '有效' : '待生效'
  return c.html(pages.renderContractVerifyResult({
    found: true,
    contractNumber: contract.contractNumber || undefined,
    statusLabel,
    signedDate: contract.signedAt ? new Date(contract.signedAt).toISOString().slice(0, 10) : undefined,
    rentalPeriod: order ? `${order.startDate} 至 ${order.endDate}` : undefined,
    deviceModel: device ? `${device.brand || ''} ${device.model || ''}`.trim() : undefined,
    contentHash: (contract as any).content_hash || undefined,
  }))
})

app.get('/payment/result', async (c) => {
  const orderId = c.req.query('orderId') || ''
  const cancelled = c.req.query('cancelled') === '1'
  const user = c.get('user') as any
  if (user?.accountType === 'guest' && orderId !== user.guestOrderId) return c.html(renderForbidden(), 403)
  return c.html(await pages.renderPaymentResult(c, orderId, user, cancelled))
})

app.get('/orders/:id/invoice', async (c) => {
  const user = c.get('user')
  if (!user) return c.redirect('/login')
  return c.html(await pages.renderInvoice(c, user, c.req.param('id')))
})

app.get('/orders/:id/invoice/pdf', async (c) => {
  const user = c.get('user')
  if (!user) return c.redirect(`/login?redirect=${encodeURIComponent(`/orders/${c.req.param('id')}/invoice/pdf`)}`)
  const order = await getOrderById(c, c.req.param('id'))
  if (!order || (user.role === 'CUSTOMER' && order.userId !== user.id)) return c.text('发票不存在或无权访问', 403)
  const contract = await getContractByOrderId(c, order.id)
  if (!isContractFinalized(contract)) return c.text('收据尚未生成', 409)
  try {
    const document = await buildTaxInvoiceDocument(c, order, contract)
    if (!document) return c.text('Tax Invoice 尚未开具', 404)
    const safeDocumentNumber = document.documentNumber.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'invoice'
    return new Response(document.pdf as any, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="tax-invoice-${safeDocumentNumber}.pdf"`,
        'Content-Length': String(document.pdf.byteLength),
        'Cache-Control': 'private, no-store',
      },
    })
  } catch (error: any) {
    console.error('Tax invoice PDF download failed:', error?.message || error)
    return c.text('Tax Invoice 生成失败', 500)
  }
})

app.post('/orders/:id/invoice/email', async (c) => {
  const user = c.get('user')
  const wantsJson = /application\/json/i.test(c.req.header('Accept') || '')
  if (!user) return c.redirect('/login')
  const order = await getOrderById(c, c.req.param('id'))
  if (!order || (user.role === 'CUSTOMER' && order.userId !== user.id)) return c.text('发票不存在或无权访问', 403)
  const contract = await getContractByOrderId(c, order.id)
  if (!isContractFinalized(contract)) return c.text('收据尚未生成', 409)
  try {
    await sendTaxInvoiceEmail(c, order, contract)
    if (wantsJson) return c.json({ success: true, message: user.role === 'ADMIN' ? 'Tax Invoice 已发送给客户' : 'Tax Invoice 已发送到您的邮箱' })
    return c.redirect(`/orders/${encodeURIComponent(order.id)}/invoice?success=${encodeURIComponent(user.role === 'ADMIN' ? 'Tax Invoice 已发送给客户' : 'Tax Invoice 已发送到您的邮箱')}`)
  } catch (error: any) {
    console.error('Tax invoice email failed:', error?.message || error)
    if (wantsJson) return c.json({ success: false, error: 'Tax Invoice 邮件发送失败' }, 500)
    return c.redirect(`/orders/${encodeURIComponent(order.id)}/invoice?error=${encodeURIComponent('Tax Invoice 邮件发送失败')}`)
  }
})

app.get('/orders/:id/invoice/print', async (c) => {
  const user = c.get('user')
  if (!user) return c.redirect(`/login?redirect=${encodeURIComponent(`/orders/${c.req.param('id')}/invoice/print`)}`)
  return c.html(await pages.renderInvoice(c, user, c.req.param('id'), true))
})

app.post('/customer/orders/:id/installments/:installmentId/stripe/intent', async (c) => {
  const user = c.get('user')
  if (!user || user.role !== 'CUSTOMER') return c.json({ error: '无权访问' }, 403)
  try {
    return c.json(await createOrderInstallmentPaymentIntent(c, user, c.req.param('id'), c.req.param('installmentId')))
  } catch (error: any) { return c.json({ error: error?.message || '无法创建 Stripe 支付' }, 400) }
})

app.post('/customer/orders/:id/payment-plan', async (c) => {
  const user = c.get('user')
  if (!user || user.role !== 'CUSTOMER') return c.html(renderForbidden(), 403)
  const order = await getOrderById(c, c.req.param('id'))
  if (!order || order.userId !== user.id) return c.html(renderForbidden(), 403)
  try {
    const form = await c.req.parseBody()
    await setRentalPaymentPlan(c, order, form.billingMode)
    return c.redirect(`/customer/orders/${encodeURIComponent(order.id)}`, 303)
  } catch (error: any) {
    return c.redirect(`/customer/orders/${encodeURIComponent(order.id)}?error=${encodeURIComponent(error?.message || '付款计划更新失败')}`, 303)
  }
})

app.post('/customer/orders/:id/stripe/intent', async (c) => {
  const user = c.get('user')
  if (!user || user.role !== 'CUSTOMER') return c.json({ error: '无权访问' }, 403)
  try {
    const result = await createOrderPaymentIntent(c, user, c.req.param('id'))
    if (result.alreadyPaid) return c.json({ alreadyPaid: true })
    return c.json({ clientSecret: result.clientSecret, publishableKey: result.publishableKey, amountCents: result.amountCents })
  } catch (error: any) {
    return c.json({ error: error?.message || '无法创建 Stripe 支付' }, 400)
  }
})

app.get('/customer/orders/:id/square/config', async (c) => {
  const user = c.get('user')
  if (!user || user.role !== 'CUSTOMER') return c.json({ error: '无权访问' }, 403)
  try {
    return c.json(await getSquareGiftCardConfigForOrder(c, user, c.req.param('id')), 200, { 'Cache-Control': 'no-store' })
  } catch (error: any) {
    return c.json({ error: error?.message || '无法读取 Square 配置' }, 400)
  }
})

app.post('/customer/orders/:id/square/payment', async (c) => {
  const user = c.get('user')
  if (!user || user.role !== 'CUSTOMER') return c.json({ error: '无权访问' }, 403)
  try {
    const body = await c.req.json() as any
    const result = await createSquareGiftCardPayment(c, user, c.req.param('id'), body?.sourceId)
    return c.json(result)
  } catch (error: any) {
    return c.json({ error: error?.message || '无法创建 Square 礼品卡付款' }, 400)
  }
})

app.post('/customer/orders/:id/price-adjustment/stripe/intent', async (c) => {
  const user = c.get('user')
  if (!user || user.role !== 'CUSTOMER') return c.json({ error: '无权访问' }, 403)
  try {
    const result = await createOrderPriceAdjustmentIntent(c, user, c.req.param('id'))
    if (result.alreadyPaid) return c.json({ alreadyPaid: true })
    return c.json({ clientSecret: result.clientSecret, publishableKey: result.publishableKey, amountCents: result.amountCents })
  } catch (error: any) {
    return c.json({ error: error?.message || '无法创建差价支付' }, 400)
  }
})

app.get('/customer/orders/:id/price-adjustment/square/config', async (c) => {
  const user = c.get('user')
  if (!user || user.role !== 'CUSTOMER') return c.json({ error: '无权访问' }, 403)
  try {
    return c.json(await getSquareGiftCardConfigForPriceAdjustment(c, user, c.req.param('id')), 200, { 'Cache-Control': 'no-store' })
  } catch (error: any) {
    return c.json({ error: error?.message || '无法读取 Square 配置' }, 400)
  }
})

app.post('/customer/orders/:id/price-adjustment/square/payment', async (c) => {
  const user = c.get('user')
  if (!user || user.role !== 'CUSTOMER') return c.json({ error: '无权访问' }, 403)
  try {
    const body = await c.req.json() as any
    return c.json(await createSquareGiftCardPriceAdjustmentPayment(c, user, c.req.param('id'), body?.sourceId))
  } catch (error: any) {
    return c.json({ error: error?.message || '无法创建 Square 礼品卡差价付款' }, 400)
  }
})

// 客户放弃 Stripe 付款、想改用银行转账 / 支付宝 / 微信时用这个接口切换。
// 押金已经通过信用卡预授权 / SetupIntent 处理的部分不受影响，这里只切换租金部分的收款渠道。
app.post('/customer/orders/:id/switch-payment-method', async (c) => {
  const user = c.get('user')
  if (!user || user.role !== 'CUSTOMER') return c.html(renderForbidden(), 403)
  const order = await getOrderById(c, c.req.param('id'))
  if (!order || order.userId !== user.id || order.status !== 'pending_payment') return c.text('订单当前不能切换支付方式', 409)
  const form = await c.req.parseBody()
  const targetMethod = String(form.paymentMethod || '')
  if (!['square', 'bank_transfer', 'alipay', 'wechat'].includes(targetMethod)) return c.text('目标支付方式无效', 400)
  await loadSystemSettingsFromDB(c)
  const settings = getSystemSettings()
  const enabled = targetMethod === 'square' ? settings.paymentMethods.square
    : targetMethod === 'bank_transfer' ? settings.paymentMethods.bankTransfer
      : targetMethod === 'alipay' ? (settings.paymentMethods.alipay && settings.rmbPayment.alipayQrUrl)
        : (settings.paymentMethods.wechat && settings.rmbPayment.wechatQrUrl)
  if (!enabled) return c.text('该支付方式当前未启用', 409)
  if (String(order.paymentMethod) === targetMethod) return c.redirect(`/customer/orders/${order.id}`)
  const paymentTotal = Math.max(0, Number(order.totalAmount || 0) - Number(order.depositAmount || 0))
  const storedPaymentMethod = targetMethod === 'square' ? 'card' : targetMethod
  const provider = targetMethod === 'square' ? 'square' : 'internal'
  if (targetMethod === 'square') await getSquareConfigSummary(c).then(summary => { if (!summary.configured) throw new Error('Square 尚未配置') })
  const existing = await c.env.RENT.prepare("SELECT id FROM payments WHERE rental_id = ? AND payment_method = ? AND payment_provider = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 1").bind(order.id, storedPaymentMethod, provider).first() as any
  if (!existing) {
    await c.env.RENT.prepare(`
      INSERT INTO payments (id, rental_id, customer_id, payment_method, payment_provider, amount, deposit_amount, rental_amount, currency, status)
      VALUES (?, ?, ?, ?, ?, ?, 0, ?, 'AUD', 'pending')
    `).bind(`p-${nanoid(12)}`, order.id, user.id, storedPaymentMethod, provider, paymentTotal, paymentTotal).run()
  }
  await c.env.RENT.prepare("UPDATE orders SET paymentMethod = ?, payment_provider = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ? AND status = 'pending_payment'").bind(storedPaymentMethod, provider, order.id).run()
  return c.redirect(`/customer/orders/${order.id}`)
})

app.post('/customer/orders/:id/bank-transfer-proof', async (c) => {
  const user = c.get('user')
  if (!user || user.role !== 'CUSTOMER') return c.html(renderForbidden(), 403)
  const order = await getOrderById(c, c.req.param('id'))
  if (!order || order.userId !== user.id) return c.text('订单不能提交付款凭证', 409)
  const form = await c.req.parseBody()
  const reference = String(form.referenceNumber || '').trim().slice(0, 100)
  const note = String(form.note || '').trim().slice(0, 500)
  let proofImageUrl = ''
  try { proofImageUrl = (await resolveImageUrls(form.imageFile, form.imageUrl, c, 'rent/payment-proofs', 1))[0] || '' } catch (error: any) { return c.text(error.message, 400) }
  if (!proofImageUrl) return c.text('请上传付款凭证图片', 400)
  if (!reference) return c.text('请填写付款 Reference', 400)
  const isAdjustment = String(form.priceAdjustment || '') === '1'
  const isDepositProof = String(form.depositProof || '') === '1'
  const requestedPaymentMethod = String(form.paymentMethod || order.paymentMethod || '').trim()
  if (isDepositProof && (isAdjustment || String(order.paymentProvider || order.payment_provider || '') !== 'square')) return c.text('该订单不能提交押金转账凭证', 409)
  if (!isAdjustment && !isDepositProof && !['bank_transfer', 'alipay', 'wechat'].includes(String(order.paymentMethod))) return c.text('订单不能提交付款凭证', 409)
  if (isAdjustment && !['bank_transfer', 'alipay', 'wechat'].includes(requestedPaymentMethod)) return c.text('差价付款方式无效', 400)
  if (isAdjustment && order.status === 'pending_payment') return c.text('当前订单尚未完成首次付款', 409)
  if (isDepositProof && !['pending_payment', 'paid', 'pending_pickup'].includes(String(order.status))) return c.text('订单当前不能提交押金凭证', 409)
  if (!isAdjustment && !isDepositProof && order.status !== 'pending_payment') return c.text('订单不能提交首次付款凭证', 409)
  const adjustmentPayment = isAdjustment ? await createOrderPriceAdjustmentTransferPayment(c, user, order.id, requestedPaymentMethod) : null
  let payment = adjustmentPayment
    ? { id: adjustmentPayment.paymentId }
    : isDepositProof
      ? await c.env.RENT.prepare("SELECT id, status FROM payments WHERE rental_id = ? AND payment_method = 'bank_transfer' AND payment_provider = 'internal' AND deposit_amount > 0 ORDER BY created_at DESC LIMIT 1").bind(order.id).first() as any
      : await c.env.RENT.prepare("SELECT id, status FROM payments WHERE rental_id = ? AND payment_method = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 1").bind(order.id, order.paymentMethod).first() as any
  if (isDepositProof && payment?.status === 'paid') return c.text('押金已经审核确认，无需重复提交', 409)
  if (isDepositProof && !payment) {
    const depositAmount = Number(order.depositAmount || order.deposit_amount || 0)
    if (!Number.isFinite(depositAmount) || depositAmount <= 0) return c.text('该订单没有待收取的押金', 409)
    const paymentId = `p-${nanoid(12)}`
    await c.env.RENT.prepare("INSERT INTO payments (id, rental_id, customer_id, payment_method, payment_provider, amount, deposit_amount, rental_amount, currency, status) VALUES (?, ?, ?, 'bank_transfer', 'internal', ?, ?, 0, 'AUD', 'pending')").bind(paymentId, order.id, user.id, depositAmount, depositAmount).run()
    payment = { id: paymentId, status: 'pending' }
  }
  if (!payment) return c.text('未找到待审核的转账付款记录', 409)
  if (isDepositProof || (isAdjustment ? requestedPaymentMethod : order.paymentMethod) === 'bank_transfer') await ensureBankTransferReference(c, 'order', order.id)
  await c.env.RENT.prepare("UPDATE payment_proofs SET status = 'superseded' WHERE payment_id = ? AND status = 'submitted'").bind(payment.id).run()
  await c.env.RENT.prepare("INSERT INTO payment_proofs (id, payment_id, reference_number, note, image_url, status) VALUES (?, ?, ?, ?, ?, 'submitted')").bind(`proof-${nanoid(12)}`, payment.id, reference, note || null, proofImageUrl).run()
  const admins = (await c.env.RENT.prepare("SELECT id FROM users WHERE role = 'ADMIN' AND status = 'active'").all()).results || []
  await Promise.all((admins as any[]).map(admin => createNotification(c, { recipientId: admin.id, type: 'payment_review_submitted', title: isDepositProof ? '新的押金转账凭证待审核' : '新的付款凭证待审核', message: `客户已提交订单 ${order.orderNo || order.id} 的${isDepositProof ? '押金银行转账' : order.paymentMethod === 'bank_transfer' ? '银行转账' : order.paymentMethod === 'alipay' ? '支付宝' : '微信'}凭证，请及时审核。`, orderId: order.id })))
  return c.redirect(`/customer/orders/${order.id}`)
})

app.post('/webhooks/stripe', async (c) => {
  try {
    return await handleStripeWebhook(c)
  } catch (error: any) {
    // The event is recorded as FAILED in webhook_events. Return 5xx so Stripe
    // redelivers it; the handler is idempotent, so a later retry completes it
    // instead of the failure being silently swallowed.
    console.error('Stripe webhook processing failed:', error?.message || error)
    return c.json({ received: false, error: 'processing_failed' }, 500)
  }
})

app.post('/webhooks/square', async (c) => {
  try {
    return await handleSquareWebhook(c)
  } catch (error: any) {
    console.error('Square webhook processing failed:', error?.message || error)
    return c.json({ received: false, error: 'processing_failed' }, 500)
  }
})

app.post('/webhooks/tally', async (c) => {
  try {
    return await actions.handleTallyFeedbackWebhook(c)
  } catch (error: any) {
    console.error('Tally feedback webhook processing failed:', error?.message || error)
    return c.json({ received: false, error: 'processing_failed' }, 500)
  }
})

app.get('/customer/rentals', async (c) => {
  const user = c.get('user')
  if (!user || user.role !== 'CUSTOMER') {
    return c.redirect('/login')
  }
  return c.html(await pages.renderCustomerRentals(c, user))
})

app.get('/customer/profile', async (c) => {
  const user = c.get('user')
  if (!user || user.role !== 'CUSTOMER') {
    return c.redirect('/login')
  }
  return c.html(await pages.renderCustomerProfile(c, user))
})

app.post('/customer/profile', async (c) => {
  const user = c.get('user')
  if (!user || user.role !== 'CUSTOMER') {
    return c.redirect('/login')
  }
  const form = await c.req.parseBody()
  const name = form.name?.trim() || user.name
  const countryCode = form.countryCode?.toString() ?? '+61'
  const localPhone = form.phone?.toString().trim() ?? ''
  const phone = localPhone ? `${countryCode}${localPhone}` : ''
  const bsb = form.bsb?.trim() || user.bsb || ''
  const account = form.account?.trim() || user.account || ''

  const dataToUpdate: any = {
    name,
    phone,
    bsb,
    account
  }

  const updatedUser = await updateUser(c, user.id, dataToUpdate)

  return c.html(await pages.renderCustomerProfile(c, updatedUser, '个人信息已更新', 'success'))
})

app.post('/customer/profile/marketing-subscription', async (c) => {
  const user = c.get('user')
  if (!user || user.role !== 'CUSTOMER') return c.redirect('/login')
  const form = await c.req.parseBody()
  if (String(form.action || '') !== 'subscribe') return c.redirect('/customer/profile')
  await c.env.RENT.prepare("UPDATE users SET marketing_email_opt_out = 0, marketing_opt_out_at = NULL WHERE id = ? AND role = 'CUSTOMER'").bind(user.id).run()
  const updatedUser = await getUserById(c, user.id)
  return c.html(await pages.renderCustomerProfile(c, updatedUser || user, '您已重新订阅营销邮件。', 'success'))
})

app.post('/customer/profile/delete-account', async (c) => {
  const user = c.get('user')
  if (!user || user.role !== 'CUSTOMER') return c.redirect('/login')
  const form = await c.req.parseBody()
  const c2cOutstanding = await c.env.RENT.prepare(`SELECT 1 FROM c2c_listings WHERE owner_id=? AND status IN ('pending','approved')
    UNION ALL SELECT 1 FROM c2c_settlement_quotes q WHERE q.owner_id=? AND q.order_status<>'cancelled'
      AND (q.order_status<>'completed' OR q.rental_cents>0) AND NOT EXISTS(SELECT 1 FROM c2c_settlements s WHERE s.order_id=q.order_id) LIMIT 1`).bind(user.id,user.id).first()
  if (c2cOutstanding) return c.html(await pages.renderCustomerProfile(c,user,'请先下架个人设备并结清出租订单','error'),409)
  if (form.confirmDelete !== 'on') return c.html(await pages.renderCustomerProfile(c, user, '请先确认永久删除账户及余额清零事项。', 'error'), 400)
  for (const column of ['deletion_requested_at', 'deletion_scheduled_at']) {
    try { await c.env.RENT.prepare(`ALTER TABLE users ADD COLUMN ${sqlIdentifier(column)} TEXT`).run() } catch (_) { }
  }
  const requestedAt = new Date()
  const scheduledAt = new Date(requestedAt.getTime() + 7 * 24 * 60 * 60 * 1000)
  await c.env.RENT.prepare("UPDATE users SET deletion_requested_at = ?, deletion_scheduled_at = ? WHERE id = ? AND role = 'CUSTOMER' AND status = 'active'").bind(requestedAt.toISOString(), scheduledAt.toISOString(), user.id).run()
  await deleteAuthSession(c, c.req.header('cookie') ?? null)
  const response = c.redirect('/login?deletion_requested=1')
  for (const cookie of serializeAuthCookieClear(isSecureRequest(c))) response.headers.append('Set-Cookie', cookie)
  return response
})

app.get('/customer/referral', async (c) => {
  const user = c.get('user')
  if (!user || user.role !== 'CUSTOMER') {
    return c.redirect('/login')
  }
  return c.html(await pages.renderCustomerReferral(c, user))
})

app.get('/customer/referral/withdraw', async (c) => {
  const user = c.get('user')
  if (!user || user.role !== 'CUSTOMER') {
    return c.redirect('/login')
  }
  return c.html(await pages.renderCustomerReferral(c, user))
})



app.post('/customer/referral/withdraw', async (c) => {
  const user = c.get('user')
  if (!user || user.role !== 'CUSTOMER') {
    return c.redirect('/login')
  }

  const form = await c.req.parseBody()
  const amount = Number(form.amount)
  const withdrawMethod = (form.withdrawMethod as string | undefined)?.trim() === 'bank_transfer' ? 'bank_transfer' : 'balance'

  if (!Number.isFinite(amount) || amount <= 0) {
    return c.html(await pages.renderCustomerReferral(c, user, '请输入正确的提现金额，金额必须大于 0'))
  }

  if (withdrawMethod === 'bank_transfer' && (!Number.isInteger(amount) || amount < 100)) {
    return c.html(await pages.renderCustomerReferral(c, user, '银行转账提现金额必须大于 100 且为整数'))
  }

  const result = await createWithdrawalRequest(c, user.id, amount, withdrawMethod, {
    bsb: form.bsb?.toString(),
    accountNumber: (form.account_number || form.account || form.accountNumber)?.toString(),
    accountName: (form.account_name || form.accountName)?.toString(),
  })

  return c.html(await pages.renderCustomerReferral(c, user, result.message, result.success ? 'success' : 'error'))
})

app.post('/customer/referral/join', async (c) => {
  const user = c.get('user')
  if (!user || user.role !== 'CUSTOMER') {
    return c.redirect('/login')
  }

  const currentUser = await getUserById(c, user.id)
  if (!currentUser) return c.redirect('/login')
  if (currentUser.referralCode) {
    return c.html(await pages.renderCustomerReferral(c, currentUser, '您已加入推荐计划，无需重复加入', 'info'))
  }

  const newReferralCode = await generateReferralCode()
  const result = await c.env.RENT.prepare("UPDATE users SET referral_code = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND (referral_code IS NULL OR referral_code = '')")
    .bind(newReferralCode, user.id).run()
  const updatedUser = await getUserById(c, user.id)
  const joinedNow = Number(result.meta?.changes || 0) > 0

  return c.html(await pages.renderCustomerReferral(c, updatedUser || currentUser, joinedNow ? '恭喜您成功加入推荐计划！您的推荐码已生成。' : '您已加入推荐计划，无需重复加入', joinedNow ? 'success' : 'info'))
})

app.post('/customer/referral/leave', async (c) => {
  const user = c.get('user')
  if (!user || user.role !== 'CUSTOMER') {
    return c.redirect('/login')
  }

  if (!user.referralCode) {
    return c.html(await pages.renderCustomerReferral(c, user, '您还未加入推荐计划', 'info'))
  }

  const updatedUser = await updateUser(c, user.id, { referralCode: null })

  return c.html(await pages.renderCustomerReferral(c, updatedUser || user, '您已成功退出推荐计划，推荐码已失效。', 'success'))
})

app.get('/customer/security', async (c) => {
  const user = c.get('user')
  if (!user || user.role !== 'CUSTOMER') {
    return c.redirect('/login')
  }
  await c.env.RENT.prepare(`CREATE TABLE IF NOT EXISTS login_history (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT, account TEXT NOT NULL, ip_address TEXT NOT NULL, user_agent TEXT, status TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`).run()
  const records = (await c.env.RENT.prepare('SELECT * FROM login_history WHERE user_id = ? ORDER BY created_at DESC LIMIT 30').bind(user.id).all()).results as any[]
  return c.html(await pages.renderCustomerSecurity(c, user, undefined, undefined, records))
})

app.post('/customer/security', async (c) => {
  const user = await findUserBySession(c, c.req.header('cookie') ?? null)
  if (!user || user.role !== 'CUSTOMER') {
    return c.redirect('/login')
  }
  const body = await c.req.text()
  const form = parseFormBody(body)
  const currentPassword = form.currentPassword?.trim()
  const newPassword = form.newPassword?.trim()
  const confirmPassword = (form.confirmPassword || form.confirmNewPassword)?.trim()
  if (!currentPassword || !newPassword || !confirmPassword) {
    return c.html(await pages.renderCustomerSecurity(c, user, '请输入完整密码信息'))
  }

  const verifiedUser = await verifyUserCredentials(c, user.email, currentPassword)
  if (!verifiedUser || verifiedUser.id !== user.id) {
    return c.html(await pages.renderCustomerSecurity(c, user, '当前密码不正确'))
  }
  if (newPassword !== confirmPassword) {
    return c.html(await pages.renderCustomerSecurity(c, user, '两次输入的新密码不一致'))
  }
  if (!isStrongPassword(newPassword)) return c.html(await pages.renderCustomerSecurity(c, user, '新密码至少需要 8 位，并同时包含字母、数字和符号'))
  await updateUser(c, user.id, { password: newPassword })
  await revokeAllSessions(c, user.id)
  const session = await createAuthSession(c, user.id)
  const response = c.html(await pages.renderCustomerSecurity(c, user, '密码已更新，其他设备已退出登录', 'success'))
  response.headers.set('Set-Cookie', serializeAuthCookie(session.token, { maxAge: session.maxAge, secure: isSecureRequest(c) }))
  return response
})

app.get('/admin/dashboard', async (c) => {
  const user = c.get('user')
  if (!user || user.role !== 'ADMIN') {
    return c.redirect('/login')
  }
  if (isMobileDeviceRequest(c)) return c.redirect('/staff/mobile')
  // 以前这里拉 orders / users / devices 三张整表回内存做统计；改用数据库侧聚合。
  const { getAdminDashboardData } = await import('./services/adminDashboard')
  const [data, opsCounts] = await Promise.all([
    getAdminDashboardData(c),
    Promise.all([
      c.env.RENT.prepare("SELECT COUNT(*) AS count FROM payments WHERE status = 'failed' AND created_at > datetime('now', '-7 days')").first(),
      c.env.RENT.prepare("SELECT COUNT(*) AS count FROM device_commands WHERE status = 'FAILED' AND created_at > datetime('now', '-7 days')").first(),
      c.env.RENT.prepare("SELECT COUNT(*) AS count FROM damage_cases WHERE status IN ('OPEN', 'PENDING', 'UNDER_REVIEW')").first(),
    ]).then(([failedPayments, failedCommands, pendingDamage]) => ({
      failedPayments: Number((failedPayments as any)?.count || 0),
      failedCommands: Number((failedCommands as any)?.count || 0),
      pendingDamage: Number((pendingDamage as any)?.count || 0),
    })),
  ])
  return c.html(pages.renderAdminDashboard(user, data, opsCounts))
})

app.get('/admin/devices/reports', async (c) => {
  const user = await findUserBySession(c, c.req.header('cookie') ?? null)
  if (!user || user.role !== 'ADMIN') return c.redirect('/login')
  const rows = (await c.env.RENT.prepare(`
    SELECT
      d.id, d.name, d.model, d.brand, d.lifecycle_status,
      COALESCE(o.total_revenue, 0) AS total_revenue,
      COALESCE(o.total_rental_days, 0) AS total_rental_days,
      COALESCE(o.recent_rental_days, 0) AS recent_rental_days,
      COALESCE(m.maintenance_count, 0) AS maintenance_count,
      COALESCE(m.maintenance_cost, 0) AS maintenance_cost,
      COALESCE(dc.damage_count, 0) AS damage_count,
      COALESCE(dc.damage_cost_cents, 0) AS damage_cost_cents,
      ret.retired_at
    FROM devices d
    LEFT JOIN (
      SELECT deviceId,
        -- Rent only: totalAmount also carries the refundable deposit and the
        -- delivery/time-slot service fee, neither of which is device revenue.
        -- Coupon discounts are already netted into totalAmount at creation.
        -- Refunds, cancellations after payment and deposit forfeits are not
        -- reflected here, so this stays an operational estimate, not a ledger figure.
        SUM(MAX(totalAmount - COALESCE(depositAmount, 0) - COALESCE(serviceFee, 0), 0)) AS total_revenue,
        SUM(rentalPeriod) AS total_rental_days,
        SUM(CASE WHEN createdAt > datetime('now', '-30 days') THEN rentalPeriod ELSE 0 END) AS recent_rental_days
      FROM orders
      WHERE status IN ('completed', 'active', 'extended', 'overdue', 'returned', 'pending_return', 'paid')
      GROUP BY deviceId
    ) o ON o.deviceId = d.id
    LEFT JOIN (
      SELECT device_id, COUNT(*) AS maintenance_count, SUM(cost) AS maintenance_cost
      FROM maintenance_records GROUP BY device_id
    ) m ON m.device_id = d.id
    LEFT JOIN (
      SELECT device_id, COUNT(*) AS damage_count, SUM(COALESCE(final_cost_cents, estimated_cost_cents)) AS damage_cost_cents
      FROM damage_cases GROUP BY device_id
    ) dc ON dc.device_id = d.id
    LEFT JOIN (
      SELECT device_id, MAX(created_at) AS retired_at FROM device_lifecycle_events WHERE next_status = 'RETIRED' GROUP BY device_id
    ) ret ON ret.device_id = d.id
    WHERE d.deleted_at IS NULL
    ORDER BY total_revenue DESC
  `).all()).results || []
  return c.html(pages.renderAdminDeviceReports(user, rows as any[]))
})

app.get('/admin/exceptions', async (c) => {
  const admin = await findUserBySession(c, c.req.header('cookie') ?? null)
  if (!admin || admin.role !== 'ADMIN') return c.redirect('/login')
  const [topups, proofs, overdueOrders, offlineDevices, heldDeposits, damageCases, disputes, anomalousOrders, consistencyIssues, failingJobs, referralRewards] = await Promise.all([
    c.env.RENT.prepare("SELECT bt.id, bt.user_id, bt.amount, bt.payment_method, bt.reference, bt.note, r.code AS transfer_code, u.name AS user_name FROM balance_topups bt LEFT JOIN users u ON u.id = bt.user_id LEFT JOIN bank_transfer_references r ON r.scope = 'topup' AND r.source_id = bt.id WHERE bt.status = 'submitted' ORDER BY bt.updated_at ASC LIMIT 50").all(),
    c.env.RENT.prepare("SELECT pp.id, pp.payment_id, pp.image_url, p.rental_id, p.payment_method, pp.reference_number, pp.uploaded_at, r.code AS transfer_code, o.orderNo FROM payment_proofs pp JOIN payments p ON p.id = pp.payment_id LEFT JOIN orders o ON o.id = p.rental_id LEFT JOIN bank_transfer_references r ON r.scope = 'order' AND r.source_id = p.rental_id WHERE pp.status = 'submitted' ORDER BY pp.uploaded_at ASC LIMIT 50").all(),
    c.env.RENT.prepare("SELECT id, orderNo, endDate FROM orders WHERE status IN ('active', 'extended', 'overdue', 'pending_return') AND endDate < ? ORDER BY endDate ASC LIMIT 50").bind(new Date().toISOString().slice(0, 10)).all(),
    c.env.RENT.prepare("SELECT id, name, agent_status, agent_last_seen_at FROM devices WHERE agent_token_hash IS NOT NULL AND (agent_last_seen_at IS NULL OR agent_last_seen_at <= datetime('now', '-5 minutes')) ORDER BY agent_last_seen_at ASC LIMIT 50").all(),
    c.env.RENT.prepare("SELECT id, orderNo, depositAmount FROM orders WHERE deposit_status = 'HELD' AND status IN ('returned', 'completed') ORDER BY updatedAt ASC LIMIT 50").all(),
    c.env.RENT.prepare("SELECT id, order_id, description FROM damage_cases WHERE status IN ('OPEN', 'PENDING', 'UNDER_REVIEW') ORDER BY created_at ASC LIMIT 50").all(),
    c.env.RENT.prepare("SELECT id, order_id, amount, currency, reason, status FROM payment_disputes WHERE status IN ('DISPUTE_OPENED', 'DISPUTE_UNDER_REVIEW') ORDER BY created_at ASC LIMIT 50").all(),
    c.env.RENT.prepare("SELECT r.id, r.order_id, r.anomaly_type, o.orderNo FROM anomalous_order_reviews r LEFT JOIN orders o ON o.id = r.order_id WHERE r.status = 'PENDING' ORDER BY r.detected_at ASC LIMIT 50").all(),
    c.env.RENT.prepare("SELECT id, issue_type, entity_type, entity_id, detected_at FROM data_consistency_issues WHERE resolved_at IS NULL ORDER BY detected_at ASC LIMIT 50").all(),
    c.env.RENT.prepare(`
      WITH ranked AS (
        SELECT job_name, status, started_at, error_message,
               ROW_NUMBER() OVER (PARTITION BY job_name ORDER BY started_at DESC) AS rn
        FROM scheduled_job_runs
      )
      SELECT job_name, MAX(started_at) AS last_failed_at, MAX(error_message) AS last_error
      FROM ranked WHERE rn <= 3 AND status = 'FAILED'
      GROUP BY job_name HAVING COUNT(*) = 3
    `).all(),
    c.env.RENT.prepare(`
      SELECT rw.id, rw.reward_number, rw.customer_id, rw.reward_amount, rw.reason,
             r.referee_customer_id, referrer.name AS referrer_name, referee.name AS referee_name
      FROM referral_rewards rw
      JOIN referrals r ON r.id = rw.referral_id
      LEFT JOIN users referrer ON referrer.id = rw.customer_id
      LEFT JOIN users referee ON referee.id = r.referee_customer_id
      WHERE rw.status = 'PENDING_REVIEW'
      ORDER BY rw.updated_at ASC LIMIT 50
    `).all(),
  ]) as any[]
  const sections = [
    ['待审核充值', topups.results, '/admin/exceptions', (item: any) => `<strong>${sanitizePlainText(item.user_name || item.user_id, 100)}</strong> · ${sanitizePlainText(item.payment_method, 30)} · AUD$${Number(item.amount).toFixed(2)}${item.transfer_code ? `<p>转账备注码：<strong class="mono">${escapeHtml(item.transfer_code)}</strong></p>` : ''}<div class="record-actions"><form method="post" action="/admin/balance-topups/${encodeURIComponent(item.id)}/approve" data-site-confirm="通过后这笔充值会立即记入客户余额。请先核对付款 Reference 与到账金额。" data-confirm-variant="danger" data-confirm-title="确认充值入账？" data-confirm-label="通过并入账"><button class="button button-sm button-primary">通过并入账</button></form><form method="post" action="/admin/balance-topups/${encodeURIComponent(item.id)}/reject" data-site-confirm="确认驳回这笔充值吗？驳回后客户需要重新提交付款凭证。" data-confirm-variant="danger" data-confirm-title="驳回充值？" data-confirm-label="驳回充值"><button class="button button-sm button-danger">驳回</button></form></div>`],
    ['待审核付款凭证', proofs.results, '/admin/exceptions', (item: any) => { let image = ''; try { image = item.image_url ? validateHostedImageUrls(item.image_url, 1)[0] : '' } catch { } return `<strong>订单 ${sanitizePlainText(item.orderNo || item.rental_id, 50)}</strong> · ${sanitizePlainText(item.payment_method || '转账', 30)} · ${sanitizePlainText(item.reference_number || '无 Reference', 100)}${item.transfer_code ? `<p>转账备注码：<strong class="mono">${escapeHtml(item.transfer_code)}</strong></p>` : ''}${image ? `<div style="margin-top:10px"><a href="${escapeHtml(image)}" target="_blank" rel="noopener noreferrer"><img src="${escapeHtml(image)}" alt="付款凭证预览" loading="lazy" referrerpolicy="no-referrer" style="display:block;max-width:220px;max-height:140px;object-fit:contain;border-radius:8px;border:1px solid #dbe3ee"></a></div>` : ''}<div class="record-actions"><form method="post" action="/admin/orders/${encodeURIComponent(item.rental_id)}/transfer-proof/approve" data-site-confirm="通过后系统会将订单标记为已付款。请先核对凭证图片、Reference 与到账金额。" data-confirm-variant="danger" data-confirm-title="确认付款凭证？" data-confirm-label="审核通过"><button class="button button-sm button-primary">审核通过</button></form><form method="post" action="/admin/orders/${encodeURIComponent(item.rental_id)}/transfer-proof/reject" data-site-confirm="确认驳回这笔付款凭证吗？驳回后客户需要重新提交。" data-confirm-title="驳回付款凭证？" data-confirm-label="驳回凭证"><input class="form-control" name="reason" maxlength="300" required placeholder="驳回原因"><button class="button button-sm button-danger">驳回</button></form></div>` }],
    ['逾期或待归还订单', overdueOrders.results, '/admin/orders', (item: any) => `${item.orderNo || item.id} · 应归还 ${item.endDate}`],
    ['离线设备', offlineDevices.results, '/admin/devices', (item: any) => `${item.name} · 设备端离线`],
    ['待结算押金', heldDeposits.results, '/admin/refunds', (item: any) => `${item.orderNo || item.id} · AUD$${Number(item.depositAmount).toFixed(2)}`],
    ['待审核损坏记录', damageCases.results, '/admin/inspections', (item: any) => `订单 ${item.order_id} · ${item.description || '待补充损坏说明'}`],
    ['待处理支付争议', disputes.results, '/admin/finance/payment-disputes', (item: any) => `订单 ${sanitizePlainText(item.order_id || '-', 50)} · ${sanitizePlainText(item.currency, 10)}$${Number(item.amount).toFixed(2)} · ${sanitizePlainText(item.reason || '未说明原因', 100)}`],
    ['待审核异常订单', anomalousOrders.results, '/admin/finance/anomalous-orders', (item: any) => `订单 ${sanitizePlainText(item.orderNo || item.order_id, 50)} · ${sanitizePlainText(item.anomaly_type, 100)} · 已自动暂停`],
    ['待审核推荐奖励', referralRewards.results, '/admin/referrals', (item: any) => `<strong>${sanitizePlainText(item.referrer_name || item.customer_id, 100)}</strong> 推荐 <strong>${sanitizePlainText(item.referee_name || item.referee_customer_id, 100)}</strong> · AUD$${Number(item.reward_amount || 0).toFixed(2)} · ${sanitizePlainText(item.reason || '风险分达到审核阈值', 200)}<div class="record-actions"><a class="button button-sm button-primary" href="/admin/referrals">查看并审核</a></div>`],
    ['待审核推荐奖励', referralRewards.results, '/admin/referrals', (item: any) => `<strong>${sanitizePlainText(item.referrer_name || item.customer_id, 100)}</strong> 推荐 <strong>${sanitizePlainText(item.referee_name || item.referee_customer_id, 100)}</strong> · AUD$${Number(item.reward_amount || 0).toFixed(2)} · ${sanitizePlainText(item.reason || '风险分达到审核阈值', 200)}<div class="record-actions"><a class="button button-sm button-primary" href="/admin/referrals/${encodeURIComponent(item.id)}">查看并审核</a></div>`],
    ['数据不一致', consistencyIssues.results, '/admin/exceptions', (item: any) => `${sanitizePlainText(item.issue_type, 60)} · ${sanitizePlainText(item.entity_type, 30)} ${sanitizePlainText(item.entity_id, 60)} · 发现于 ${formatMelbourneDateTime(item.detected_at)}`],
    ['连续失败的定时任务', failingJobs.results, '/admin/monitoring', (item: any) => `${sanitizePlainText(item.job_name, 80)} · 最近失败于 ${formatMelbourneDateTime(item.last_failed_at)} · ${sanitizePlainText(item.last_error || '无错误信息', 200)}`],
  ] as const
  const body = `<div class="page-header"><div><p class="section-code">EXCEPTION QUEUE</p><h2>异常任务中心</h2><p>按最早发生时间处理付款、归还、设备和推荐奖励风控异常；所有待审核事项集中显示在这里。</p></div></div><div class="stats-grid">${sections.map(([name, items]) => `<div class="stat-card ${items.length ? 'warning' : ''}"><h3>${name}</h3><div class="value">${items.length}</div></div>`).join('')}</div>${sections.map(([name, items, href, label]) => `<section class="panel" style="margin-top:20px"><div class="section-title"><h3>${name}</h3>${href !== '/admin/exceptions' ? `<a class="button button-sm button-secondary" href="${href}">前往处理</a>` : ''}</div>${items.length ? `<ul class="notification-list">${items.map(item => `<li>${label(item)}</li>`).join('')}</ul>` : '<p class="empty-state">暂无待处理事项。</p>'}</section>`).join('')}`
  return c.html(buildLayout('异常任务中心', body, admin))
})

app.get('/admin/referrals', async (c) => {
  const admin = await findUserBySession(c, c.req.header('cookie') ?? null)
  if (!admin || !['MANAGER', 'ADMIN'].includes(getAccessLevel(admin))) return c.html(renderForbidden(), 403)
  await loadSystemSettingsFromDB(c)
  const rewards = (await c.env.RENT.prepare(`
    SELECT rw.id, rw.reward_number, rw.customer_id, rw.reward_amount, rw.status, rw.reason,
           r.qualified_at, referrer.name AS referrer_name, referee.name AS referee_name
    FROM referral_rewards rw
    JOIN referrals r ON r.id = rw.referral_id
    LEFT JOIN users referrer ON referrer.id = rw.customer_id
    LEFT JOIN users referee ON referee.id = r.referee_customer_id
    ORDER BY rw.created_at DESC LIMIT 200
  `).all()).results || []
  return c.html(pages.renderAdminReferrals(admin, rewards as any[], getSystemSettings().referralSettings.settlementPeriod))
})

app.post('/admin/referrals/:id/release', async (c) => {
  const admin = await findUserBySession(c, c.req.header('cookie') ?? null)
  if (!admin || !['MANAGER', 'ADMIN'].includes(getAccessLevel(admin))) return c.html(renderForbidden(), 403)
  const released = await releaseReferralRewardNow(c, c.req.param('id'), admin.id)
  if (!released) return c.text('该推荐奖励不存在或已处理', 409)
  await createAuditLog(c, { actor: admin, action: 'REFERRAL_REWARD_RELEASED', targetType: 'REFERRAL_REWARD', targetId: c.req.param('id') })
  return c.redirect('/admin/referrals', 303)
})

app.post('/admin/referrals/:id/revoke', async (c) => {
  const admin = await findUserBySession(c, c.req.header('cookie') ?? null)
  if (!admin || !['MANAGER', 'ADMIN'].includes(getAccessLevel(admin))) return c.html(renderForbidden(), 403)
  const form = await c.req.parseBody()
  const reason = String(form.reason || '').trim().slice(0, 300)
  if (!reason) return c.text('撤销推荐奖励必须填写原因', 400)
  const reward = await c.env.RENT.prepare("SELECT order_id FROM referral_rewards WHERE id = ? AND status IN ('PENDING', 'PENDING_REVIEW', 'AVAILABLE')").bind(c.req.param('id')).first() as any
  if (!reward?.order_id) return c.text('该推荐奖励不存在或已处理', 409)
  await revokeReferralRewardForOrder(c, reward.order_id, reason)
  await createAuditLog(c, { actor: admin, action: 'REFERRAL_REWARD_REVOKED', targetType: 'REFERRAL_REWARD', targetId: c.req.param('id'), reason })
  return c.redirect('/admin/referrals', 303)
})

app.get('/manager/staff', async (c) => {
  const manager = await findUserBySession(c, c.req.header('cookie') ?? null)
  if (!manager || getAccessLevel(manager) !== 'MANAGER') return c.redirect('/login')
  const staff = (await getUsers(c)).filter(account => getAccessLevel(account) === 'STAFF')
  const rows = staff.map(account => `<tr><td>${sanitizePlainText(account.name, 100)}</td><td>${sanitizePlainText(account.email, 254)}</td><td>${sanitizePlainText(account.accountStatus || account.status, 30)}</td><td><a class="link-button" href="/manager/staff/${encodeURIComponent(account.id)}/edit">编辑</a></td></tr>`).join('') || '<tr><td colspan="4">暂无 Staff 员工</td></tr>'
  return c.html(buildLayout('Staff 管理', `<div class="panel"><div class="section-title"><div><h2>Staff 管理</h2><p>Manager 只能管理 Staff 员工资料与账户状态。</p></div></div><table><thead><tr><th>姓名</th><th>邮箱</th><th>状态</th><th>操作</th></tr></thead><tbody>${rows}</tbody></table></div>`, manager))
})

app.get('/manager/email-events', async (c) => {
  const user = await findUserBySession(c, c.req.header('cookie') ?? null)
  if (!user || !['MANAGER', 'ADMIN'].includes(getAccessLevel(user))) return c.html(renderForbidden(), 403)
  const { results = [] } = await c.env.RENT.prepare('SELECT id, event_type, recipient, subject, status, retry_count, max_attempts, error_message, sent_at, created_at FROM email_events ORDER BY created_at DESC LIMIT 100').all() as any
  const statusLabels = { PENDING: '待发送', SENT: '邮件已提交', FAILED: '发送失败', SKIPPED: '已跳过' }
  const eventLabels = { SITE_NOTIFICATION: '手动通知', TEMPLATE: '模板邮件', MARKETING: '营销邮件', C2C_NEW_RENTAL: '新出租通知' }
  const rows = results.map((event: any) => `<tr><td>${sanitizePlainText(eventLabels[event.event_type] || event.event_type, 40)}<br><small>${sanitizePlainText(event.subject || '—', 200)}</small></td><td>${sanitizePlainText(event.recipient, 254)}</td><td><span class="badge ${event.status === 'SENT' ? 'badge-success' : event.status === 'FAILED' ? 'badge-danger' : 'badge-neutral'}">${sanitizePlainText(statusLabels[event.status] || event.status, 20)}</span></td><td>${event.retry_count}/${event.max_attempts}</td><td>${sanitizePlainText(event.error_message || '—', 200)}</td><td>${sanitizePlainText(event.sent_at || event.created_at, 40)}</td><td>${['FAILED', 'SKIPPED'].includes(event.status) && Number(event.retry_count) < Number(event.max_attempts) ? `<form method="post" action="/manager/email-events/${encodeURIComponent(event.id)}/retry" data-site-confirm="确认重新发送该邮件吗？"><button class="button button-sm button-primary">重新发送</button></form>` : '—'}</td></tr>`).join('') || '<tr><td colspan="7">暂无邮件事件</td></tr>'
  return c.html(buildLayout('邮件发送记录', `<div class="panel"><div class="section-title"><h2>邮件发送记录</h2><a class="button button-secondary" href="/notifications#send-notification">发送通知</a></div><div class="table-wrapper"><table><thead><tr><th>事件与主题</th><th>收件人</th><th>状态</th><th>尝试</th><th>失败原因</th><th>时间</th><th>操作</th></tr></thead><tbody>${rows}</tbody></table></div></div>`, user))
})

app.post('/manager/email-events/:id/retry', async (c) => {
  const user = await findUserBySession(c, c.req.header('cookie') ?? null)
  if (!user || !['MANAGER', 'ADMIN'].includes(getAccessLevel(user))) return c.html(renderForbidden(), 403)
  const event = await c.env.RENT.prepare("SELECT * FROM email_events WHERE id = ? AND status <> 'SENT' AND retry_count < max_attempts").bind(c.req.param('id')).first() as any
  if (!event) return c.text('邮件事件不存在、已发送或已超过最大重试次数', 409)
  if (event.event_type==='C2C_NEW_RENTAL') {
    await deliverC2CEmails(c,event.id)
    await createAuditLog(c,{actor:user,action:'EMAIL_EVENT_RETRIED',targetType:'EMAIL_EVENT',targetId:event.id})
    return c.redirect('/manager/email-events',303)
  }
  const { provider, apiKey, from } = await resolveEmailCredentials(c)
  if ((provider !== 'smtp' && !apiKey) || !from) return c.text('邮件服务尚未配置', 503)
  if (!event.subject || !event.text_body) return c.text('邮件内容不完整，请重新发送通知', 409)
  if (event.event_type === 'SITE_NOTIFICATION') {
    const template = await c.env.RENT.prepare('SELECT enabled FROM email_templates WHERE id = ? AND deleted_at IS NULL').bind(event.template_id).first()
    if (!template?.enabled) return c.text('请先启用站内通知邮件模板', 409)
  }
  const claimed = await c.env.RENT.prepare("UPDATE email_events SET status = 'PENDING', retry_count = retry_count + 1, last_attempt_at = CURRENT_TIMESTAMP WHERE id = ? AND status IN ('FAILED', 'SKIPPED') AND retry_count = ? AND retry_count < max_attempts").bind(event.id, event.retry_count).run()
  if (Number(claimed.meta?.changes || 0) !== 1) return c.text('邮件已在发送中或已发送', 409)
  const result = await sendTransactionalEmail(c, { to: event.recipient, subject: event.subject, text: event.text_body, html: event.html_body || undefined })
  await c.env.RENT.prepare("UPDATE email_events SET status = ?, provider_message_id = ?, error_message = ?, sent_at = CASE WHEN ? THEN CURRENT_TIMESTAMP END WHERE id = ?").bind(result.ok ? 'SENT' : 'FAILED', result.id, result.error, result.ok ? 1 : 0, event.id).run()
  await createAuditLog(c, { actor: user, action: 'EMAIL_EVENT_RETRIED', targetType: 'EMAIL_EVENT', targetId: event.id, after: { status: result.ok ? 'SENT' : 'FAILED' } })
  return c.redirect('/manager/email-events', 303)
})

app.get('/manager/staff/:id/edit', async (c) => {
  const manager = await findUserBySession(c, c.req.header('cookie') ?? null)
  const target = await getUserById(c, c.req.param('id'))
  if (!manager || getAccessLevel(manager) !== 'MANAGER' || !target || getAccessLevel(target) !== 'STAFF') return c.html(renderForbidden(), 403)
  return c.html(buildLayout('编辑 Staff', `<div class="panel"><h2>编辑 Staff</h2><form method="post" action="/manager/staff/${encodeURIComponent(target.id)}/edit"><label class="form-label">姓名</label><input class="form-control" name="name" value="${sanitizePlainText(target.name, 100)}" required maxlength="100"><label class="form-label">电话</label><input class="form-control" name="phone" value="${sanitizePlainText(target.phone, 40)}" maxlength="40"><label class="form-label">账户状态</label><select class="form-control" name="accountStatus"><option value="active" ${target.status === 'active' ? 'selected' : ''}>正常</option><option value="inactive" ${target.status !== 'active' ? 'selected' : ''}>停用</option></select><div class="record-actions"><button class="button button-primary">保存</button><a class="button button-secondary" href="/manager/staff">取消</a></div></form></div>`, manager))
})

app.post('/manager/staff/:id/edit', async (c) => {
  const manager = await findUserBySession(c, c.req.header('cookie') ?? null)
  const target = await getUserById(c, c.req.param('id'))
  if (!manager || getAccessLevel(manager) !== 'MANAGER' || !target || getAccessLevel(target) !== 'STAFF') return c.html(renderForbidden(), 403)
  const form = await c.req.parseBody()
  const accountStatus = String(form.accountStatus || 'active')
  if (!['active', 'inactive'].includes(accountStatus) || !String(form.name || '').trim()) return c.redirect(`/manager/staff/${encodeURIComponent(target.id)}/edit`)
  await updateUser(c, target.id, { name: String(form.name), phone: String(form.phone || ''), accountStatus, status: accountStatus })
  return c.redirect('/manager/staff')
})

app.get('/admin/calendar', async (c) => {
  const user = c.get('user')
  if (!user || user.role !== 'ADMIN') return c.redirect('/login')
  return c.html(await pages.renderAdminDeviceCalendar(c, user))
})

app.get('/admin/users', async (c) => {
  const user = await findUserBySession(c, c.req.header('cookie') ?? null)
  if (!user || user.role !== 'ADMIN') {
    return c.redirect('/login')
  }
  const html = await pages.renderAdminUsers(user, c)
  return c.html(html)
})

app.get('/admin/users/new', async (c) => {
  const user = await findUserBySession(c, c.req.header('cookie') ?? null)
  if (!user || user.role !== 'ADMIN') {
    return c.redirect('/login')
  }
  return c.html(pages.renderAdminUserNew(user))
})

app.post('/admin/users/new', async (c) => {
  const user = await findUserBySession(c, c.req.header('cookie') ?? null)
  if (!user || user.role !== 'ADMIN') {
    return c.redirect('/login')
  }
  const form = await c.req.parseBody()
  const name = combinePersonName(form.firstName, form.lastName)
  const email = String(form.email || '').trim().toLowerCase()
  const password = String(form.password || '')
  const role = String(form.role || 'CUSTOMER')
  const status = String(form.status || 'active')
  if (!String(form.firstName || '').trim() || !String(form.lastName || '').trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !['CUSTOMER', 'STAFF', 'MANAGER', 'ADMIN'].includes(role) || !['active', 'inactive'].includes(status)) return c.html(pages.renderAdminUserNew(user, '请完整填写名、姓和有效邮箱，并选择正确的角色与状态'), 400)
  if (password && !isStrongPassword(password)) return c.html(pages.renderAdminUserNew(user, '密码至少需要 8 位，并同时包含字母、数字和符号'), 400)
  if (await findUserByEmail(c, email)) return c.html(pages.renderAdminUserNew(user, '该邮箱已被使用'), 409)
  const created = await insertUser(c, { id: await generateUniqueUserId(c, role === 'MANAGER' ? 'STAFF' : role as 'ADMIN' | 'STAFF' | 'CUSTOMER'), name, email, password, role: role === 'MANAGER' ? 'STAFF' : role, accessLevel: role, status, accountStatus: status, balance: 0, commissionBalance: 0, createdAt: new Date().toISOString() })
  await createAuditLog(c, { actor: user, action: 'USER_CREATED', targetType: 'USER', targetId: created.id, after: { role, status } })
  const passwordSetup = password ? '' : ((await sendPasswordResetEmail(c, created, 'setup').catch(() => false)) ? 'sent' : 'failed')
  return c.redirect(`/admin/users${passwordSetup ? `?passwordSetup=${passwordSetup}` : ''}`, 303)
})

app.get('/admin/users/:id', async (c) => {
  const user = await findUserBySession(c, c.req.header('cookie') ?? null)
  if (!user || user.role !== 'ADMIN') {
    return c.redirect('/login')
  }
  return c.html(await pages.renderAdminUserDetail(c, user, c.req.param('id')))
})

app.get('/admin/users/:id/edit', async (c) => {
  const user = await findUserBySession(c, c.req.header('cookie') ?? null)
  if (!user || user.role !== 'ADMIN') {
    return c.redirect('/login')
  }
  return c.html(await pages.renderAdminUserEdit(c, user, c.req.param('id')))
})

app.post('/admin/users/:id/clear-login-lock', async (c) => {
  const admin = await findUserBySession(c, c.req.header('cookie') ?? null)
  if (!admin || admin.role !== 'ADMIN') return c.redirect('/login')
  const target = await c.env.RENT.prepare('SELECT email, role FROM users WHERE id = ?').bind(c.req.param('id')).first() as any
  if (target?.email && target.role !== 'ADMIN') {
    await c.env.RENT.prepare('DELETE FROM login_attempts WHERE account = ?').bind(String(target.email).toLowerCase()).run()
  }
  return c.redirect(`/admin/users/${encodeURIComponent(c.req.param('id'))}`)
})

app.post('/admin/users/:id/edit', async (c) => {
  const user = await findUserBySession(c, c.req.header('cookie') ?? null)
  if (!user || user.role !== 'ADMIN') {
    return c.redirect('/login')
  }
  const targetUserId = c.req.param('id')
  const form = await c.req.parseBody()
  const targetUser = await getUserById(c, targetUserId)
  if (!targetUser) return c.html(renderNotFound(), 404)
  const requestedLevel = String(form.role || getAccessLevel(targetUser))
  const role = requestedLevel === 'MANAGER' ? 'STAFF' : requestedLevel
  const accountStatus = String(form.accountStatus || 'active')
  const staffId = String(form.staffId || '').trim()
  if (!['CUSTOMER', 'STAFF', 'MANAGER', 'ADMIN'].includes(requestedLevel) || !['active', 'banned', 'inactive', 'departed'].includes(accountStatus)) {
    return c.html(await pages.renderAdminUserEdit(c, user, targetUserId, '账户角色或状态无效'), 400)
  }
  if (accountStatus === 'departed' && role !== 'STAFF') {
    return c.html(await pages.renderAdminUserEdit(c, user, targetUserId, '“已离职”状态仅适用于员工账户'), 400)
  }
  if (targetUserId === user.id && (requestedLevel !== 'ADMIN' || accountStatus !== 'active')) {
    return c.html(await pages.renderAdminUserEdit(c, user, targetUserId, '不能停用、封禁或降低当前登录管理员自己的权限'), 400)
  }
  if (role === 'CUSTOMER' && staffId) {
    const assignedStaff = await getUserById(c, staffId)
    const assignedStatus = assignedStaff?.accountStatus ?? assignedStaff?.account_status ?? (assignedStaff?.status === 'active' ? 'active' : 'inactive')
    if (!assignedStaff || assignedStaff.role !== 'STAFF' || assignedStaff.status !== 'active' || assignedStatus !== 'active') {
      return c.html(await pages.renderAdminUserEdit(c, user, targetUserId, '只能绑定用户管理中状态正常的现有员工'), 400)
    }
  }

  const dataToUpdate: any = {
    name: combinePersonName(form.firstName, form.lastName),
    phone: form.phone?.toString() || '',
    bsb: form.bsb?.toString() || '',
    accountNumber: form.account_number?.toString() || '',
    balance: parseFloat(form.balance?.toString() || '0'),
    role,
    accessLevel: requestedLevel,
    accountStatus,
    status: accountStatus === 'active' ? 'active' : 'inactive',
    staffId: role === 'CUSTOMER' ? (staffId || null) : null,
  }

  if (!dataToUpdate.name || !String(form.firstName || '').trim() || !String(form.lastName || '').trim()) {
    return c.html(await pages.renderAdminUserEdit(c, user, targetUserId, '请分别填写名和姓'), 400)
  }

  // 如果提供了密码，更新密码
  if (form.password && form.password.toString().length > 0) {
    if (!isStrongPassword(form.password.toString())) return c.html(await pages.renderAdminUserEdit(c, user, targetUserId, '新密码至少需要 8 位，并同时包含字母、数字和符号'), 400)
    dataToUpdate.password = form.password.toString()
  }

  await updateUser(c, targetUserId, dataToUpdate)
  const passwordWasReset = Boolean(dataToUpdate.password)
  if (passwordWasReset) await revokeAllSessions(c, targetUserId)
  await createAuditLog(c, { actor: user, action: 'USER_UPDATED', targetType: 'USER', targetId: targetUserId, before: { role: getAccessLevel(targetUser), status: targetUser.accountStatus ?? targetUser.status }, after: { role: requestedLevel, status: accountStatus, sessionsRevoked: passwordWasReset || undefined } })
  return c.redirect(`/admin/users/${targetUserId}`)
})

app.get('/admin/refunds', async (c) => {
  const user = await findUserBySession(c, c.req.header('cookie') ?? null)
  if (!user || user.role !== 'ADMIN') {
    return c.redirect('/login')
  }
  return c.html(await pages.renderAdminRefunds(c, user))
})

app.get('/admin/withdrawals', async (c) => {
  const user = await findUserBySession(c, c.req.header('cookie') ?? null)
  if (!user || user.role !== 'ADMIN') {
    return c.redirect('/login')
  }
  return c.html(buildLayout('佣金提现审核 - 电脑租赁管理系统', await pages.renderWithdrawalsPanel(c), user))
})

app.get('/admin/payment-reviews', async (c) => {
  const user = await findUserBySession(c, c.req.header('cookie') ?? null)
  if (!user || user.role !== 'ADMIN') return c.redirect('/login')
  return c.redirect('/admin/exceptions', 302)
})

app.post('/admin/withdrawals/:id/status', async (c) => {
  const user = await findUserBySession(c, c.req.header('cookie') ?? null)
  if (!user || user.role !== 'ADMIN') {
    return c.redirect('/login')
  }

  const withdrawalId = c.req.param('id')
  const form = await c.req.parseBody()
  const status = String(form.status || 'pending')

  if (!['completed', 'rejected', 'approved'].includes(status)) {
    return c.redirect('/admin/withdrawals')
  }

  const withdrawal = await c.env.RENT.prepare('SELECT id, user_id, amount, status FROM commission_withdrawals WHERE id = ?').bind(withdrawalId).first() as any
  if (!withdrawal) return c.redirect('/admin/withdrawals')
  // Already finalised — don't re-refund or re-complete.
  if (['completed', 'rejected'].includes(String(withdrawal.status))) return c.redirect('/admin/withdrawals')

  if (status === 'rejected') {
    // 未打款而驳回：把预留的佣金退回 commission_balance，并释放被划走的奖励。
    await c.env.RENT.batch([
      c.env.RENT.prepare("UPDATE commission_withdrawals SET status = 'rejected', processed_at = CURRENT_TIMESTAMP, processed_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status IN ('pending', 'approved')").bind(user.id, withdrawalId),
      c.env.RENT.prepare('UPDATE users SET commission_balance = commission_balance + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(Number(withdrawal.amount || 0), withdrawal.user_id),
      c.env.RENT.prepare("UPDATE referral_rewards SET withdrawn_at = NULL, withdrawal_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE withdrawal_id = ?").bind(withdrawalId),
    ])
    await createAuditLog(c, { actor: user, action: 'WITHDRAWAL_REJECTED', targetType: 'COMMISSION_WITHDRAWAL', targetId: withdrawalId, before: { status: withdrawal.status }, after: { status: 'rejected', refunded: Number(withdrawal.amount || 0), userId: withdrawal.user_id } })
  } else {
    await c.env.RENT.prepare("UPDATE commission_withdrawals SET status = ?, processed_at = CURRENT_TIMESTAMP, processed_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(status, user.id, withdrawalId).run()
    if (status === 'completed') await createAuditLog(c, { actor: user, action: 'WITHDRAWAL_COMPLETED', targetType: 'COMMISSION_WITHDRAWAL', targetId: withdrawalId, before: { status: withdrawal.status }, after: { status: 'completed', amount: Number(withdrawal.amount || 0), userId: withdrawal.user_id } })
  }

  return c.redirect('/admin/withdrawals')
})

app.get('/admin/contracts/signing-status', async (c) => {
  const user = await findUserBySession(c, c.req.header('cookie') ?? null)
  if (!user || user.role !== 'ADMIN') {
    return c.redirect('/login')
  }
  return c.redirect('/admin/contracts?status=pending')
})

app.get('/admin/contracts/archive', async (c) => {
  const user = await findUserBySession(c, c.req.header('cookie') ?? null)
  if (!user || user.role !== 'ADMIN') {
    return c.redirect('/login')
  }
  return c.redirect('/admin/contracts?status=completed')
})

app.get('/admin/orders/export', async (c) => {
  const user = await findUserBySession(c, c.req.header('cookie') ?? null)
  if (!user || user.role !== 'ADMIN') {
    return c.redirect('/login')
  }

  const url = new URL(c.req.url)
  const userIdFilter = url.searchParams.get('userId') || ''
  const statusFilter = url.searchParams.get('status') || 'all'
  const searchTerm = (url.searchParams.get('search') || '').trim()
  const dateFrom = (url.searchParams.get('dateFrom') || '').trim()
  const dateTo = (url.searchParams.get('dateTo') || '').trim()

  const filteredOrders = await pages.getFilteredAdminOrders(c, {
    userId: userIdFilter,
    status: statusFilter,
    search: searchTerm,
    dateFrom,
    dateTo,
  })

  const csvRows = [
    ['订单号', '客户', '邮箱', '设备', '总金额', '状态', '租期', '下单日期'],
    ...filteredOrders.map((order: any) => {
      const totalAmount = order.total_amount || order.totalAmount || 0
      const startDate = order.start_date || order.startDate || '-'
      const endDate = order.end_date || order.endDate || '-'
      const createdAt = order.created_at || order.createdAt || '-'
      return [
        order.id || '',
        order.customer?.name || '未知用户',
        order.customer?.email || '',
        order.device?.name || '未知设备',
        String(totalAmount),
        order.status || '',
        `${startDate} ~ ${endDate}`,
        createdAt,
      ]
    })
  ]

  const escapeCsvValue = (value: any) => {
    let text = String(value ?? '')
    if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`
    if (/[",\n]/.test(text)) {
      return `"${text.replace(/"/g, '""')}"`
    }
    return text
  }

  const csv = csvRows.map(row => row.map(escapeCsvValue).join(',')).join('\n')

  c.header('Content-Type', 'text/csv; charset=utf-8')
  c.header('Content-Disposition', `attachment; filename="orders-${new Date().toISOString().slice(0, 10)}.csv"`)
  return c.body(csv)
})

app.get('/admin/orders', async (c) => {
  const user = await findUserBySession(c, c.req.header('cookie') ?? null)
  if (!user || user.role !== 'ADMIN') {
    return c.redirect('/login')
  }
  return c.html(await pages.renderAdminOrders(c, user))
})

app.get('/admin/rental-links', async (c) => {
  const user = c.get('user')
  if (!user || user.role !== 'ADMIN') return c.html(renderForbidden(), 403)
  return c.html(await pages.renderAdminRentalLinks(c, user))
})
app.post('/admin/rental-links', (c) => actions.createAdminRentalLink(c))
app.post('/admin/rental-links/:id/toggle', (c) => actions.toggleAdminRentalLink(c))

app.get('/admin/delivery', async (c) => {
  const user = await findUserBySession(c, c.req.header('cookie') ?? null)
  if (!user || user.role !== 'ADMIN') return c.redirect('/login')
  return c.html(await pages.renderAdminDelivery(c, user))
})

app.post('/admin/delivery/bookings', async (c) => {
  const user = c.get('user')
  if (!user || user.role !== 'ADMIN') return c.html(renderForbidden(), 403)
  const form = await c.req.parseBody()
  const orderId = String(form.orderId || '').trim()
  const direction = String(form.direction || '')
  if (!orderId || !['outbound', 'return'].includes(direction)) return c.redirect('/admin/delivery?error=' + encodeURIComponent('配送订单参数无效'))
  const order = await getOrderById(c, orderId) as any
  const status = String(order?.status || '').toLowerCase()
  const allowedStatuses = direction === 'outbound' ? ['paid', 'pending_pickup', 'active'] : ['active', 'extended', 'overdue', 'suspended', 'pending_return']
  if (!order || String(order.deliveryMethod || '') !== 'Delivery') return c.redirect('/admin/delivery?error=' + encodeURIComponent('该订单不是送货订单'))
  if (!allowedStatuses.includes(status)) return c.redirect('/admin/delivery?error=' + encodeURIComponent('当前订单状态不可创建该配送订单'))
  const result = await createAdminDeliveryBooking(c, { orderId, direction: direction as any, readyDateTime: String(form.readyDateTime || '') })
  if (!result.ok) return c.redirect('/admin/delivery?error=' + encodeURIComponent(result.message))
  await createAuditLog(c, { actor: user, action: 'DELIVERY_BOOKING_CREATED', targetType: 'ORDER', targetId: orderId, after: { direction, delivery: result.payload.booking || null } })
  return c.redirect('/admin/delivery?success=' + encodeURIComponent(`${direction === 'outbound' ? '派送' : '回收'}订单已创建`), 303)
})

app.post('/internal/delivery-status-email', (c) => handleDeliveryStatusEmail(c as any))

app.get('/admin/order-review', async (c) => {
  const user = await findUserBySession(c, c.req.header('cookie') ?? null)
  if (!user || user.role !== 'ADMIN') return c.redirect('/login')
  return c.html(await pages.renderAdminOrderReview(c, user))
})

app.get('/admin/contracts', async (c) => {
  const user = await findUserBySession(c, c.req.header('cookie') ?? null)
  if (!user || user.role !== 'ADMIN') {
    return c.redirect('/login')
  }
  return c.html(await pages.renderStaffContracts(c, user, c.req.query('status'), undefined, undefined, c.req.query('searchTerm'), c.req.query('staffId')))
})


app.get('/admin/contracts/:id', async (c) => {
  const user = await findUserBySession(c, c.req.header('cookie') ?? null)
  if (!user || user.role !== 'ADMIN') {
    return c.redirect('/login')
  }
  return c.html(await pages.renderAdminContractDetail(c, user, c.req.param('id')))
})

app.get('/admin/contracts/:id/data', async (c) => {
  const user = await findUserBySession(c, c.req.header('cookie') ?? null)
  if (!user || user.role !== 'ADMIN') return c.redirect('/login')
  return c.html(await pages.renderAdminContractData(c, user, c.req.param('id')))
})

app.post('/admin/contracts/:id/data', async (c) => {
  const user = await findUserBySession(c, c.req.header('cookie') ?? null)
  if (!user || user.role !== 'ADMIN') return c.redirect('/login')
  const contract = await getContractById(c, c.req.param('id'))
  if (!contract) return c.notFound()
  let form: Record<string, any>
  try { form = await parseFormBodyForRequest(c) } catch (error: any) {
    if (String(error?.message || '').startsWith('FORM_LIMIT:')) return c.text('表单内容过长或字段过多', 413)
    throw error
  }
  const allowed = new Set(CONTRACT_OPERATIONAL_FIELDS.map(([name]) => name))
  const existing = typeof contract.contract_data === 'string' ? JSON.parse(contract.contract_data || '{}') : (contract.contract_data || {})
  // 已签署字段直接忽略，不报错；签署记录始终保持原值。
  const submitted = Object.entries(form).filter(([name]) => allowed.has(name as any) && !(contract.status === 'signed' && CONTRACT_SIGNED_FIELDS.has(name))).map(([name, value]) => [name, String(value).trim().slice(0, 4000)])
  const submittedData = Object.fromEntries(submitted)
  if (allowed.has('damage_photos') && !(contract.status === 'signed' && CONTRACT_SIGNED_FIELDS.has('damage_photos'))) {
    try { await addWatermarkedContractDamagePhotos(c, form, submittedData) } catch (error: any) { return c.text(error.message, 400) }
  }
  for (const name of ['delivery_fee', 'discount', 'replacement_cost', 'repair_cost', 'battery_cycles', 'insurance_fee']) {
    const value = submittedData[name]
    if (value && (!Number.isFinite(Number(value)) || Number(value) < 0)) return c.text(`${name} 必须是非负数字`, 400)
  }
  const allowedOptions: Record<string, string[]> = { delivery_method: ['', 'Pickup', 'Delivery'], return_status: ['', 'Returned', 'Overdue', 'Damaged'], collection_required: ['', '否', '是'], power_test: ['', '通过', '失败'], insurance_selected: ['', '否', '是'], waiver_signed: ['', '否', '是'], jurisdiction: ['', 'VIC', 'NSW', 'QLD', 'SA', 'WA', 'TAS', 'NT', 'ACT'] }
  for (const [name, options] of Object.entries(allowedOptions)) if (!options.includes(submittedData[name] || '')) return c.text(`${name} 的值无效`, 400)
  const data = { ...existing, ...submittedData }
  await c.env.RENT.prepare('UPDATE contracts SET contract_data = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?').bind(JSON.stringify(data), contract.id).run()
  return c.redirect(`/admin/contracts/${contract.id}`)
})

app.get('/admin/orders/balance-topups', async (c) => {
  const user = await findUserBySession(c, c.req.header('cookie') ?? null)
  if (!user || user.role !== 'ADMIN') {
    return c.redirect('/login')
  }
  return c.html(await pages.renderAdminBalanceTopups(c, user))
})

app.get('/admin/orders/new', async (c) => {
  const user = c.get('user')
  if (!user || user.role !== 'ADMIN') return c.html(renderForbidden(), 403)
  return c.html(await pages.renderAdminManualOrder(c, user))
})

app.post('/admin/orders/new', (c) => actions.saveAdminManualOrder(c))
app.post('/admin/orders/:id/edit', (c) => actions.saveAdminManualOrder(c, c.req.param('id')))

app.get('/admin/orders/:id', async (c) => {
  const user = await findUserBySession(c, c.req.header('cookie') ?? null)
  if (!user || user.role !== 'ADMIN') {
    return c.redirect('/login')
  }
  return c.html(await pages.renderAdminOrderDetail(c, user, c.req.param('id')))
})

app.post('/admin/orders/:id/changes', async (c) => {
  const admin = c.get('user')
  if (!admin || admin.role !== 'ADMIN') return c.html(renderForbidden(), 403)
  const order = await getOrderById(c, c.req.param('id')) as any
  const form = await c.req.parseBody()
  const type = String(form.changeType || '')
  if (order?.is_manual === 1) return c.text('请在手动订单详情页修改，已完成或已取消的订单不可编辑', 409)
  if (!order || order.status === 'cancelled' || (order.status === 'completed' && type !== 'REFUND_METHOD')) return c.text('订单不存在或已结束，不能修改', 409)
  const reason = String(form.reason || '').trim().slice(0, 500)
  if (!reason) return c.text('订单修改必须填写原因', 400)

  const before = orderChangeSnapshot(order)
  if (order.billing_mode === 'MONTHLY' && ['EXTENSION', 'DEVICE_SWAP', 'PRICE_ADJUSTMENT'].includes(type)
      && await c.env.RENT.prepare("SELECT id FROM rental_installments WHERE order_id = ? AND status IN ('paid', 'processing') LIMIT 1").bind(order.id).first()) {
    return c.text('月付订单收款后暂不支持修改租期、设备或金额', 409)
  }
  const plan = buildOrderChangePlan(type, before, {
    startDate: form.startDate != null ? String(form.startDate) : undefined,
    endDate: form.endDate != null ? String(form.endDate) : undefined,
    deviceId: form.deviceId != null ? String(form.deviceId) : undefined,
    totalAmount: form.totalAmount != null ? String(form.totalAmount) : undefined,
    depositAmount: form.depositAmount != null ? String(form.depositAmount) : undefined,
    discountAmount: form.discountAmount != null ? String(form.discountAmount) : undefined,
    pickupLocation: form.pickupLocation != null ? String(form.pickupLocation) : undefined,
    returnLocation: form.returnLocation != null ? String(form.returnLocation) : undefined,
    deliveryMethod: form.deliveryMethod != null ? String(form.deliveryMethod) : undefined,
    refundMethod: form.refundMethod != null ? String(form.refundMethod) : undefined,
    refundBsb: form.refundBsb != null ? String(form.refundBsb) : undefined,
    refundAccountNumber: form.refundAccountNumber != null ? String(form.refundAccountNumber) : undefined,
    refundAccountName: form.refundAccountName != null ? String(form.refundAccountName) : undefined,
  })
  if ('error' in plan) return c.text(plan.error, 400)

  if (plan.deviceAvailabilityCheck) {
    const device = await getDeviceById(c, plan.deviceAvailabilityCheck)
    if (!device || ['maintenance', 'retired'].includes(String(device.status))) return c.text('替换设备不可用', 409)
  }
  const bookingRules = plan.bookingCheck ? await getDeviceRentalRules(c, plan.bookingCheck.deviceId) : null
  if (plan.bookingCheck && await hasDeviceBookingConflict(c, plan.bookingCheck.deviceId, plan.bookingCheck.startDate, plan.bookingCheck.endDate, order.id, bookingRules?.bufferDays ?? 0)) {
    return c.text('目标设备在该租期存在预约冲突', 409)
  }

  const after = { ...before, ...plan.patch }
  const changeId = `och-${nanoid(12)}`
  await c.env.RENT.batch([
    c.env.RENT.prepare('UPDATE orders SET deviceId = ?, startDate = ?, endDate = ?, rentalPeriod = ?, totalAmount = ?, depositAmount = ?, discount_amount = ?, pickupLocation = ?, returnLocation = ?, deliveryMethod = ?, refundMethod = ?, refundBsb = ?, refundAccountNumber = ?, refundAccountName = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?')
      .bind(after.deviceId, after.startDate, after.endDate, after.rentalPeriod, after.totalAmount, after.depositAmount, after.discountAmount, after.pickupLocation || null, after.returnLocation || null, after.deliveryMethod, after.refundMethod, after.refundBsb || null, after.refundAccountNumber || null, after.refundAccountName || null, order.id),
    c.env.RENT.prepare('INSERT INTO order_change_history (id, order_id, change_type, before_json, after_json, reason, changed_by) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(changeId, order.id, type, JSON.stringify(before), JSON.stringify(after), reason, admin.id),
  ])
  if (type === 'DEVICE_SWAP') { await releaseDeviceIfUnbooked(c, before.deviceId); await recordDeviceLifecycle(c, after.deviceId, 'RESERVED', { orderId: order.id, reason: '订单换机', changedBy: admin.id }) }

  // 设计文档/优惠码：改租期 / 换机 / 改价后，若可打折基数跌破优惠码最低消费，
  // 该优惠码不再成立——释放名额、移除折扣、把折扣额加回订单总价，并留痕。
  if (['EXTENSION', 'DEVICE_SWAP', 'PRICE_ADJUSTMENT'].includes(type) && (order as any).coupon_id && Number(after.discountAmount || 0) > 0) {
    const coupon = await c.env.RENT.prepare('SELECT * FROM coupons WHERE id = ? AND deleted_at IS NULL').bind((order as any).coupon_id).first() as any
    if (coupon && coupon.minimum_order_amount) {
      const dailyRate = type === 'DEVICE_SWAP'
        ? Number((await getDeviceById(c, after.deviceId) as any)?.pricePerDay || (order as any).dailyRate || 0)
        : Number((order as any).dailyRate || 0)
      const newRentalFee = Number((Number(after.rentalPeriod || order.rentalPeriod || 0) * dailyRate).toFixed(2))
      const base = couponDiscountableBase(coupon, {
        rentalFee: newRentalFee,
        deliveryFee: Number((order as any).deliveryFee || 0),
        depositFee: Number(after.depositAmount || (order as any).depositAmount || 0),
      })
      if (base < Number(coupon.minimum_order_amount)) {
        const droppedDiscount = Number(after.discountAmount || 0)
        await releaseCouponForOrder(c, order.id)
        await c.env.RENT.prepare('UPDATE orders SET discount_amount = 0, coupon_code = NULL, totalAmount = totalAmount + ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?').bind(droppedDiscount, order.id).run()
        await c.env.RENT.prepare("INSERT INTO order_change_history (id, order_id, change_type, before_json, after_json, reason, changed_by) VALUES (?, ?, 'COUPON_REVALIDATED', ?, ?, ?, ?)")
          .bind(`och-${nanoid(12)}`, order.id, JSON.stringify({ couponCode: (order as any).coupon_code, discountAmount: droppedDiscount }), JSON.stringify({ couponCode: null, discountAmount: 0 }), `订单变更后可打折金额 AUD$${base.toFixed(2)} 低于优惠码最低消费 AUD$${Number(coupon.minimum_order_amount).toFixed(2)}，已移除优惠码`, admin.id).run()
        await createAuditLog(c, { actor: admin, action: 'COUPON_REVALIDATED', targetType: 'ORDER', targetId: order.id, before: { couponCode: (order as any).coupon_code, discountAmount: droppedDiscount }, after: { couponCode: null, discountAmount: 0 }, reason: '订单变更后不再满足优惠码条件' })
      }
    }
  }
  const finalOrder = await getOrderById(c, order.id) as any
  if (finalOrder && Number(finalOrder.totalAmount) < Number(before.totalAmount)) {
    try {
      const adjustment = await applyOrderPriceAdjustment(c, { orderId: order.id, beforeTotal: Number(before.totalAmount), afterTotal: Number(finalOrder.totalAmount), adjustmentId: `opa-${changeId}`, actorId: admin.id, refundMethod: form.priceRefundMethod })
      if (adjustment.pendingDepositRefund) await createNotification(c, { recipientId: order.userId, senderId: admin.id, type: 'order_price_adjustment', title: '订单价格已下调', message: `您的订单 ${order.orderNo || order.id} 已下调 ${adjustment.amount.toFixed(2)} AUD，转账类付款差价将在押金退款时一并退还。`, orderId: order.id })
    } catch (error: any) {
      return c.text(error?.message || '订单降价退款失败，请联系管理员处理', 502)
    }
  } else if (finalOrder && Number(finalOrder.totalAmount) > Number(before.totalAmount) && String(order.paymentMethod) === 'balance') {
    try {
      const adjustment = await applyBalanceOrderPriceIncrease(c, { orderId: order.id, beforeTotal: Number(before.totalAmount), afterTotal: Number(finalOrder.totalAmount), adjustmentId: `opa-${changeId}`, actorId: admin.id })
      if (!adjustment.paid) await createNotification(c, { recipientId: order.userId, senderId: admin.id, type: 'order_price_adjustment', title: '账户余额不足，请充值', message: `您的订单 ${order.orderNo || order.id} 涨价 ${adjustment.amount.toFixed(2)} AUD，当前余额为 ${adjustment.balanceAfter.toFixed(2)} AUD。请在订单详情使用其他支付方式补交差价，或充值至非负余额。`, orderId: order.id })
    } catch (error: any) {
      return c.text(error?.message || '余额差价处理失败，请联系管理员处理', 502)
    }
  }
  await createAuditLog(c, { actor: admin, action: 'ORDER_CHANGED', targetType: 'ORDER', targetId: order.id, before, after, reason })
  return c.redirect(`/admin/orders/${order.id}`, 303)
})

app.post('/admin/orders/:id/update', async (c) => {
  const wantsJson = c.req.header('accept')?.includes('application/json') || c.req.header('x-requested-with') === 'XMLHttpRequest'
  const user = c.get('user')
  if (!user || user.role !== 'ADMIN') return wantsJson ? c.json({ ok: false, error: '登录已失效或没有管理员权限' }, 403) : c.html(renderForbidden(), 403)
  const form = await c.req.parseBody()
  const status = String(form.status || '')
  const force = String(form.force || '') === '1'
  const reason = String(form.reason || '').trim().slice(0, 300)
  const order = await getOrderById(c, c.req.param('id'))
  // 'completed' 必须在这里放行，否则下面第 3996 行「跳过归还验机并强制完成」
  // 的校验逻辑永远走不到——订单详情页的强制完成按钮此前一直被这里挡在 409。
  const editableStatuses = ['suspended', 'active', 'cancelled', 'completed']
  if (order?.is_manual === 1) return wantsJson ? c.json({ ok: false, error: '请在手动订单详情页修改' }, 409) : c.text('请在手动订单详情页修改', 409)
  const isResume = status === 'active' && order?.status === 'suspended'
  if (!order || !editableStatuses.includes(status) || (status === 'active' && !isResume) || !canTransitionOrder(order.status, status)) return wantsJson ? c.json({ ok: false, error: '不允许的订单状态转换，请刷新页面查看最新状态' }, 409) : c.text('不允许的订单状态转换', 409)
  if ((status === 'suspended' || status === 'cancelled') && !reason) return wantsJson ? c.json({ ok: false, error: '请填写暂停/取消原因' }, 400) : c.text('请填写暂停/取消原因', 400)
  if (status === 'cancelled') {
    try {
      const response = await cancelAndRefund(c, user, order.id, reason)
      if (response.status >= 400) return wantsJson ? c.json({ ok: false, error: await response.text() }, response.status as any) : response
      return wantsJson ? c.json({ ok: true }) : response
    } catch (error: any) { return wantsJson ? c.json({ ok: false, error: error?.message || '全额退款失败' }, 502) : c.text(error?.message || '全额退款失败', 502) }
  }
  if (status === 'completed') {
    const contract = await c.env.RENT.prepare('SELECT contract_data FROM contracts WHERE orderId = ? AND deleted_at IS NULL ORDER BY createdAt DESC LIMIT 1').bind(order.id).first() as any
    if (!JSON.parse(contract?.contract_data || '{}').inspection_date && !force) return wantsJson ? c.json({ ok: false, error: '完成订单前必须提交归还验机' }, 409) : c.text('完成订单前必须提交归还验机', 409)
  }
  await updateOrderStatus(c, order.id, status, { reason, triggeredBy: user.id })
  if (status === 'suspended') await createNotification(c, { recipientId: order.userId, senderId: user.id, type: 'rental_suspended', title: '租赁已暂停', message: `您的订单 ${order.orderNo || order.id} 已由${user.name || '管理员'}暂停，原因：${reason}。`, orderId: order.id })
  if (status === 'completed') {
    await enqueueRentalUserDeletion(c, order)
    const settlementResponse = await settleCompletedOrderAuthorization(c, user, order.id)
    if (settlementResponse && settlementResponse.status >= 400) return wantsJson ? c.json({ ok: false, error: await settlementResponse.text() }, settlementResponse.status as any) : settlementResponse
  }
  if (status === 'paid') await ensureOrderNumber(c, order.id)
  if (wantsJson) return c.json({ ok: true })
  return c.redirect(`/admin/orders/${c.req.param('id')}`)
})

app.post('/admin/orders/:id/transfer-proof/approve', async (c) => {
  const user = c.get('user')
  if (!user || user.role !== 'ADMIN') return c.html(renderForbidden(), 403)
  const order = await getOrderById(c, c.req.param('id'))
  if (!order) return c.text('订单状态不允许审核', 409)
  const proof = await c.env.RENT.prepare("SELECT pp.id, pp.payment_id, pp.reference_number, p.payment_method AS proof_payment_method, p.deposit_amount AS proof_deposit_amount, a.id AS adjustment_id, a.amount AS adjustment_amount FROM payment_proofs pp JOIN payments p ON p.id = pp.payment_id LEFT JOIN order_price_adjustments a ON a.payment_id = p.id AND a.direction = 'increase' WHERE p.rental_id = ? AND pp.status = 'submitted' ORDER BY pp.uploaded_at DESC LIMIT 1").bind(order.id).first() as any
  if (!proof) return c.text('没有待审核的转账信息', 409)
  const isSquareDepositProof = !proof.adjustment_id && String(order.paymentProvider || order.payment_provider || '') === 'square' && proof.proof_payment_method === 'bank_transfer' && Number(proof.proof_deposit_amount || 0) > 0
  if (isSquareDepositProof) {
    const depositAmount = Number(order.depositAmount || order.deposit_amount || 0)
    if (depositAmount <= 0 || Number(proof.proof_deposit_amount) !== depositAmount) return c.text('押金凭证金额与订单押金不一致', 409)
    if (!['pending_payment', 'paid', 'pending_pickup'].includes(String(order.status))) return c.text('订单状态不允许审核押金', 409)
    await c.env.RENT.batch([
      c.env.RENT.prepare("UPDATE payment_proofs SET status = 'approved', verified_at = CURRENT_TIMESTAMP, verified_by = ? WHERE id = ? AND status = 'submitted'").bind(user.id, proof.id),
      c.env.RENT.prepare("UPDATE payments SET status = 'paid', transaction_id = COALESCE(transaction_id, ?), paid_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'pending'").bind(generateReferenceNumber('TXN'), proof.payment_id),
      c.env.RENT.prepare("UPDATE orders SET deposit_status = 'PAID', deposit_paid_at = COALESCE(deposit_paid_at, CURRENT_TIMESTAMP), deposit_held_amount = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ? AND deposit_status = 'PENDING'").bind(depositAmount, order.id),
    ])
    await createNotification(c, { recipientId: order.userId, senderId: user.id, type: 'payment_approved', title: '押金付款审核已通过', message: `您的订单 ${order.orderNo || order.id} 押金转账凭证已审核通过，押金 AUD$ ${depositAmount.toFixed(2)} 已确认到账。`, orderId: order.id })
    await cleanupCompletedPaymentReviewNotifications(c)
    await createAuditLog(c, { actor: user, action: 'DEPOSIT_PAYMENT_PROOF_APPROVED', targetType: 'PAYMENT_PROOF', targetId: proof.id, after: { orderId: order.id, reference: proof.reference_number, depositAmount } })
    return c.redirect('/admin/exceptions')
  }
  if (!proof.adjustment_id && !['bank_transfer', 'alipay', 'wechat'].includes(String(order.paymentMethod))) return c.text('订单状态不允许审核', 409)
  if (!proof.adjustment_id && order.status !== 'pending_payment') return c.text('订单状态不允许审核首次付款', 409)
  if (proof.adjustment_id) {
    await c.env.RENT.batch([
      c.env.RENT.prepare("UPDATE payment_proofs SET status = 'approved', verified_at = CURRENT_TIMESTAMP, verified_by = ? WHERE id = ? AND status = 'submitted'").bind(user.id, proof.id),
      c.env.RENT.prepare("UPDATE payments SET status = 'paid', transaction_id = COALESCE(transaction_id, ?), paid_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'pending'").bind(generateReferenceNumber('TXN'), proof.payment_id),
      ...(String(order.paymentMethod) === 'balance' ? [] : [c.env.RENT.prepare("UPDATE order_price_adjustments SET status = 'succeeded', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'pending'").bind(proof.adjustment_id)]),
    ])
    await settleBalancePriceAdjustment(c, order.id, proof.adjustment_id)
    await createNotification(c, { recipientId: order.userId, senderId: user.id, type: 'payment_approved', title: '差价付款审核已通过', message: `您的订单 ${order.orderNo || order.id} 差价付款凭证已审核通过，补交 ${Number(proof.adjustment_amount || 0).toFixed(2)} AUD。`, orderId: order.id })
    await cleanupCompletedPaymentReviewNotifications(c)
    await createAuditLog(c, { actor: user, action: 'PRICE_ADJUSTMENT_PAYMENT_APPROVED', targetType: 'ORDER_PRICE_ADJUSTMENT', targetId: proof.adjustment_id, after: { orderId: order.id, reference: proof.reference_number } })
    return c.redirect('/admin/exceptions')
  }
  const riskCustomer = await getUserById(c, order.userId)
  const customerRisk = riskCustomer?.role === 'CUSTOMER' ? await getCustomerRiskAssessment(c, riskCustomer.id) : null
  if (customerRisk?.blocked) return c.text(`该客户存在风控限制，不能创建合同或审核订单（风险分 ${customerRisk.score}/100）`, 403)
  await c.env.RENT.batch([
    c.env.RENT.prepare("UPDATE payment_proofs SET status = 'approved', verified_at = CURRENT_TIMESTAMP, verified_by = ? WHERE id = ? AND status = 'submitted'").bind(user.id, proof.id),
    c.env.RENT.prepare("UPDATE payments SET status = 'paid', transaction_id = COALESCE(transaction_id, ?), paid_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'pending'").bind(generateReferenceNumber('TXN'), proof.payment_id),
    c.env.RENT.prepare("UPDATE orders SET status = 'paid', order_status = 'CONFIRMED', payment_status = 'PAID', rental_status = 'READY_FOR_PICKUP', updatedAt = CURRENT_TIMESTAMP WHERE id = ? AND status = 'pending_payment'").bind(order.id),
  ])
  await ensureContractForOrder(c, order, user.id)
  await recordDeviceLifecycle(c, order.deviceId, 'RESERVED', { orderId: order.id, reason: '付款凭证审核通过', changedBy: user.id })
  await c.env.RENT.prepare("UPDATE coupon_redemptions SET status = 'REDEEMED', redeemed_at = CURRENT_TIMESTAMP WHERE order_id = ? AND status = 'RESERVED'").bind(order.id).run()
  await ensureOrderNumber(c, order.id, String(proof.reference_number || proof.payment_id || ''))
  await recordExternalRentalFlow(c, order.userId, Number(order.totalAmount), '银行转账', user.id, order.id)
  // 同上：开票失败要能被看见，且不能挡住下面的 Windows 账号创建步骤继续执行。
  await issueInvoice(c, order.id).catch(error => logError(c, 'CRITICAL', 'issueInvoice failed after bank-transfer approval', error, { orderId: order.id }))
  // Bank-transfer approval is a completed payment event too: enqueue the
  // Windows rental-user creation immediately instead of waiting for the cron.
  const contract = await c.env.RENT.prepare('SELECT id, contract_data FROM contracts WHERE orderId = ? AND deleted_at IS NULL ORDER BY createdAt DESC LIMIT 1').bind(order.id).first() as any
  if (contract?.contract_data) {
    let contractData: any = {}
    try { contractData = JSON.parse(contract.contract_data) } catch (_) { }
    const password = await decryptSecret(c, contractData.windows_password)
    const username = String(contractData.windows_username || order.customer?.name || 'RentalUser')
    if (password && !contractData.windows_account_created) {
      await ensureDeviceCommandTables(c.env.RENT)
      await c.env.RENT.prepare("INSERT INTO device_commands (id, device_id, command_type, payload, created_by, expires_at) VALUES (?, ?, 'CREATE_RENTAL_USER', ?, NULL, datetime('now', '+7 days'))").bind(`cmd-${nanoid(12)}`, order.deviceId, JSON.stringify({ username, password })).run()
      contractData.windows_account_created = true
      await c.env.RENT.prepare('UPDATE contracts SET contract_data = ? WHERE id = ?').bind(JSON.stringify(contractData), contract.id).run()
    }
  }
  const customer = await getUserById(c, order.userId) as any
  const title = '付款审核已通过'
  const message = `您的订单 ${order.orderNo || order.id} 付款凭证已审核通过，订单已确认。`
  await createNotification(c, { recipientId: order.userId, senderId: user.id, type: 'payment_approved', title, message, orderId: order.id })
  await cleanupCompletedPaymentReviewNotifications(c)
  await sendPaymentReviewEmail(c, customer, title, message, order.id)
  await createAuditLog(c, { actor: user, action: 'PAYMENT_PROOF_APPROVED', targetType: 'PAYMENT_PROOF', targetId: proof.id, after: { orderId: order.id, reference: proof.reference_number } })
  return c.redirect('/admin/exceptions')
})

app.post('/admin/orders/:id/transfer-proof/reject', async (c) => {
  const user = c.get('user')
  if (!user || user.role !== 'ADMIN') return c.html(renderForbidden(), 403)
  const reason = String((await c.req.parseBody()).reason || '').trim().slice(0, 300)
  if (!reason) return c.text('请填写驳回原因', 400)
  const order = await getOrderById(c, c.req.param('id')) as any
  if (!order) return c.text('订单不存在', 404)
  await c.env.RENT.prepare("UPDATE payment_proofs SET status = 'rejected', rejection_reason = ?, rejected_at = CURRENT_TIMESTAMP, rejected_by = ? WHERE id = (SELECT pp.id FROM payment_proofs pp JOIN payments p ON p.id = pp.payment_id WHERE p.rental_id = ? AND pp.status = 'submitted' ORDER BY pp.uploaded_at DESC LIMIT 1)").bind(reason, user.id, order.id).run()
  const customer = await getUserById(c, order.userId) as any
  const title = '付款审核未通过'
  const message = `您的订单 ${order.orderNo || order.id} 付款凭证未通过审核。原因：${reason}。请重新提交正确的付款凭证。`
  await createNotification(c, { recipientId: order.userId, senderId: user.id, type: 'payment_rejected', title, message, orderId: order.id })
  await cleanupCompletedPaymentReviewNotifications(c)
  await sendPaymentReviewEmail(c, customer, title, message, order.id)
  await createAuditLog(c, { actor: user, action: 'PAYMENT_PROOF_REJECTED', targetType: 'ORDER', targetId: order.id, reason })
  return c.redirect('/admin/exceptions')
})

app.post('/admin/orders/bulk-update', async (c) => {
  const user = await findUserBySession(c, c.req.header('cookie') ?? null)
  if (!user || user.role !== 'ADMIN') {
    return c.redirect('/login')
  }

  const form = await c.req.parseBody()
  const targetStatus = String(form.status || '')
  const reason = String(form.reason || '').trim().slice(0, 300)
  const selectedIds = Array.isArray(form.orderIds) ? form.orderIds.map(String) : form.orderIds ? [String(form.orderIds)] : []

  // 界面下拉框（BULK_STATUS_OPTIONS）与服务端接受的状态必须一致。传了不支持的状态
  // 以前会静默重定向回列表、什么都不发生；现在明确回显错误，让操作者知道没生效。
  if (!['suspended', 'cancelled'].includes(targetStatus)) {
    return c.redirect(`/admin/orders?error=${encodeURIComponent('批量更新只支持「已取消」和「已暂停」两种状态')}`)
  }
  if (selectedIds.length === 0) {
    return c.redirect(`/admin/orders?error=${encodeURIComponent('请先勾选需要更新的订单')}`)
  }
  if (!reason) {
    return c.redirect(`/admin/orders?error=${encodeURIComponent('请填写取消或暂停原因')}`)
  }

  const selectedOrders = await Promise.all(selectedIds.map(orderId => getOrderById(c, orderId)))
  const foundOrders = selectedOrders.filter((order): order is NonNullable<typeof order> => Boolean(order))
  // 手动订单有自己的编辑页，不进批量流程；只有它们被选中时要给出可执行的下一步。
  const manualOnly = foundOrders.length > 0 && foundOrders.every(order => order.is_manual === 1)
  const validOrders = foundOrders.filter(order => order.is_manual !== 1 && canTransitionOrder(order.status, targetStatus))
  if (!validOrders.length) {
    const message = manualOnly ? '手动订单请在订单详情页修改' : '所选订单当前状态都不允许该操作'
    return c.redirect(`/admin/orders?error=${encodeURIComponent(message)}`)
  }
  let processed = 0
  for (const order of validOrders) {
    if (targetStatus === 'cancelled') {
      let response: Response
      try { response = await cancelAndRefund(c, user, order.id, reason) }
      catch (error: any) { response = c.text(error?.message || '全额退款失败', 502) }
      if (response.status >= 400) {
        const detail = (await response.text()).slice(0, 200)
        return c.redirect(`/admin/orders?error=${encodeURIComponent(`已处理 ${processed} 条后停止：${detail}`)}`)
      }
    } else {
      await updateOrderStatus(c, order.id, targetStatus, { reason, triggeredBy: user.id })
      if (targetStatus === 'suspended') await createNotification(c, { recipientId: order.userId, senderId: user.id, type: 'rental_suspended', title: '租赁已暂停', message: `您的订单 ${order.orderNo || order.id} 已由${user.name || '管理员'}暂停，原因：${reason}。`, orderId: order.id })
    }
    processed++
  }

  const skipped = selectedOrders.length - validOrders.length
  return c.redirect(`/admin/orders?success=${encodeURIComponent(`已更新 ${validOrders.length} 条订单${skipped ? `，跳过 ${skipped} 条不适用订单` : ''}`)}`)
})

app.post('/admin/orders/:id/refund', async (c) => {
  const user = c.get('user')
  if (!user || user.role !== 'ADMIN') return c.html(renderForbidden(), 403)
  return c.text('此退款入口已停用，请选择“处理押金”或“取消并全额退款”', 410)
})

app.post('/admin/orders/:id/deposit-refund', async (c) => {
  const user = c.get('user')
  if (!user || user.role !== 'ADMIN') return c.html(renderForbidden(), 403)
  const settlement = await c.env.RENT.prepare("SELECT * FROM deposit_settlements WHERE order_id = ? ORDER BY requested_at DESC LIMIT 1").bind(c.req.param('id')).first() as any
  if (!settlement || settlement.status !== 'APPROVED') return c.text('押金结算须先由 Manager 审批通过', 409)
  try {
    const form = await c.req.parseBody()
    const settlementOrder = await getOrderById(c, c.req.param('id'))
    const isSetupIntentDeposit = String(settlementOrder?.deposit_payment_mode || '') === 'SETUP_INTENT'
    if (settlementOrder?.deposit_payment_mode === 'PREAUTH' && String(form.refundMethod || settlementOrder.refundMethod || 'balance') !== String(settlement.refund_method)) return c.text('退款方式必须与已批准的结算单一致', 409)
    const submittedAmount = isSetupIntentDeposit ? Number(form.deductionAmount || 0) : Number(form.refundAmount)
    const approvedAmount = isSetupIntentDeposit ? Number(settlement.deduction_amount || 0) : Number(settlement.refund_amount)
    if (submittedAmount !== approvedAmount || String(form.deductionCategory || '') !== String(settlement.deduction_category || '') || String(form.deductionReason || '').trim() !== String(settlement.deduction_reason || '')) return c.text('执行金额或扣款说明必须与已批准的结算单一致', 409)
    return executeApprovedDepositSettlement(c, user, settlement.id, c.req.param('id'), form)
  } catch (error: any) {
    return c.text(error.message || '押金退款失败', 502)
  }
})

app.post('/admin/orders/:id/deposit-settlements', async (c) => {
  const user = c.get('user')
  if (!user || user.role !== 'ADMIN') return c.html(renderForbidden(), 403)
  const order = await getOrderById(c, c.req.param('id'))
  if (!order) return c.text('订单不存在', 404)
  if (order.status !== 'completed') return c.text('只有已归还并完成的订单才能提交押金结算', 409)
  const completedDepositRefund = await c.env.RENT.prepare("SELECT id FROM payment_refunds WHERE order_id = ? AND type = 'deposit' AND status = 'succeeded' LIMIT 1").bind(order.id).first()
  if (isCardDepositSettled(order, Boolean(completedDepositRefund))) return c.text('该笔押金已结算，不能重复处理', 409)
  const existing = await c.env.RENT.prepare("SELECT id FROM deposit_settlements WHERE order_id = ? AND status IN ('PENDING_MANAGER_APPROVAL', 'APPROVED', 'EXECUTED')").bind(order.id).first()
  if (existing) return c.text('该订单已有待处理或已完成的押金结算单', 409)
  const form = await c.req.parseBody()
  const refundText = String(form.refundAmount ?? '').trim()
  const refundAmount = Number(refundText)
  const depositAmount = Number(order.depositAmount || 0)
  const pendingPriceRefund = Number((await c.env.RENT.prepare("SELECT COALESCE(SUM(amount), 0) AS amount FROM order_price_adjustments WHERE order_id = ? AND direction = 'decrease' AND status = 'succeeded' AND refund_method = 'pending_deposit' AND deposit_refunded = 0").bind(order.id).first() as any)?.amount || 0)
  const remainingDepositRefund = Number((await c.env.RENT.prepare("SELECT COALESCE(SUM(refund_amount), 0) AS amount FROM payment_refunds WHERE order_id = ? AND type = 'deposit' AND status = 'succeeded'").bind(order.id).first() as any)?.amount || 0)
  const maxRefundAmount = Number((Math.max(0, depositAmount - remainingDepositRefund) + pendingPriceRefund).toFixed(2))
  const isSetupIntentDeposit = String((order as any).deposit_payment_mode || '') === 'SETUP_INTENT'
  let deductionAmount = 0
  if (isSetupIntentDeposit) {
    const deductionText = String(form.deductionAmount ?? '0').trim()
    deductionAmount = Number(deductionText)
    if (!/^\d+(\.\d{1,2})?$/.test(deductionText) || !Number.isFinite(deductionAmount) || deductionAmount < 0 || deductionAmount > depositAmount) return c.text('扣款金额无效：不能高于押金金额', 400)
  } else {
    if (!/^\d+(\.\d{1,2})?$/.test(refundText) || !Number.isFinite(refundAmount) || refundAmount < 0 || refundAmount > maxRefundAmount || (pendingPriceRefund > 0 && refundAmount < pendingPriceRefund)) return c.text(`退款金额无效：本次应至少包含差价 ${pendingPriceRefund.toFixed(2)} AUD，最多可退 ${maxRefundAmount.toFixed(2)} AUD`, 400)
    const includedPriceRefund = Math.min(pendingPriceRefund, refundAmount)
    const depositRefundAmount = Number((refundAmount - includedPriceRefund).toFixed(2))
    deductionAmount = Number((depositAmount - depositRefundAmount).toFixed(2))
  }
  const deductionCategory = String(form.deductionCategory || '').trim()
  const deductionReason = String(form.deductionReason || '').trim()
  const refundMethod = String(form.refundMethod || 'balance').trim()
  if (!['balance', 'original', 'bank_transfer'].includes(refundMethod)) return c.text('退款方式无效', 400)
  if (deductionAmount > 0 && !['DAMAGE', 'MISSING_ACCESSORY', 'LATE_FEE', 'DEVICE_NOT_RETURNED', 'OTHER'].includes(deductionCategory)) return c.text('请选择有效的押金扣款类别', 400)
  if (deductionAmount > 0 && !deductionReason) return c.text('扣除押金时必须填写原因', 400)
  const snapshot = { orderId: order.id, orderNo: order.orderNo, customerId: order.userId, depositAmount, pendingPriceRefund, refundAmount: isSetupIntentDeposit ? 0 : refundAmount, deductionAmount, deductionCategory: deductionAmount ? deductionCategory : null, deductionReason: deductionAmount ? deductionReason : null, refundMethod, requestedAt: new Date().toISOString(), requestedBy: user.id }
  const settlementId = `dst-${nanoid(12)}`
  await c.env.RENT.batch([
    c.env.RENT.prepare("INSERT INTO deposit_settlements (id, order_id, deposit_amount, refund_amount, deduction_amount, deduction_category, deduction_reason, refund_method, status, requested_by, reviewed_by, reviewed_at, review_note, settlement_number, document_snapshot) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'APPROVED', ?, ?, CURRENT_TIMESTAMP, '管理员提交，自动审批通过', ?, ?)").bind(settlementId, order.id, depositAmount, isSetupIntentDeposit ? 0 : refundAmount, deductionAmount, deductionAmount ? deductionCategory : null, deductionAmount ? deductionReason : null, refundMethod, user.id, user.id, generateReferenceNumber('DST'), JSON.stringify(snapshot)),
    c.env.RENT.prepare("UPDATE orders SET deposit_status = 'REFUND_PENDING', settlement_status = ? WHERE id = ?").bind(computeOrderSettlementStatus({ status: order.status, overdue_outstanding_amount: order.overdue_outstanding_amount, deposit_status: 'REFUND_PENDING' }), order.id),
  ])
  await createAuditLog(c, { actor: user, action: 'DEPOSIT_SETTLEMENT_AUTO_APPROVED', targetType: 'DEPOSIT_SETTLEMENT', targetId: settlementId, after: { ...snapshot, status: 'APPROVED' }, reason: deductionReason || '管理员提交，自动审批通过' })
  return c.redirect(`/admin/orders/${order.id}`, 303)
})

app.get('/manager/deposit-settlements', async (c) => {
  const manager = await findUserBySession(c, c.req.header('cookie') ?? null)
  if (!manager || getAccessLevel(manager) !== 'MANAGER') return c.html(renderForbidden(), 403)
  const { results = [] } = await c.env.RENT.prepare("SELECT ds.*, o.orderNo FROM deposit_settlements ds JOIN orders o ON o.id = ds.order_id WHERE ds.status = 'PENDING_MANAGER_APPROVAL' ORDER BY ds.requested_at ASC").all() as any
  const rows = results.map((item: any) => `<tr><td>${sanitizePlainText(item.settlement_number, 40)}</td><td>${sanitizePlainText(item.orderNo, 40)}</td><td>AUD$ ${Number(item.deposit_amount).toFixed(2)}</td><td>AUD$ ${Number(item.refund_amount).toFixed(2)}</td><td>${item.deduction_amount ? `${sanitizePlainText(item.deduction_category, 40)}：${sanitizePlainText(item.deduction_reason, 300)}` : '无扣款'}</td><td><form method="post" action="/manager/deposit-settlements/${encodeURIComponent(item.id)}/approve" data-site-confirm="批准后管理员将按结算单执行退款或扣款。请核对押金、退款金额与扣款原因。" data-confirm-variant="danger" data-confirm-title="批准押金结算？" data-confirm-label="批准结算"><button class="button button-primary">批准</button></form><form method="post" action="/manager/deposit-settlements/${encodeURIComponent(item.id)}/reject" style="margin-top:8px" data-site-confirm="确认驳回这份押金结算单吗？驳回后需重新提交结算。" data-confirm-variant="danger" data-confirm-title="驳回押金结算？" data-confirm-label="驳回结算"><input class="form-control" name="note" maxlength="300" required placeholder="驳回原因"><button class="button button-danger" style="margin-top:6px">驳回</button></form></td></tr>`).join('') || '<tr><td colspan="6">暂无待审批押金结算单</td></tr>'
  return c.html(buildLayout('押金结算审批', `<div class="panel"><h2>押金结算审批</h2><p>批准后由管理员执行退款；批准或驳回均会留下审计记录。</p><div class="table-wrapper"><table><thead><tr><th>结算单号</th><th>订单</th><th>押金</th><th>退款</th><th>扣款</th><th>操作</th></tr></thead><tbody>${rows}</tbody></table></div></div>`, manager))
})

app.post('/manager/deposit-settlements/:id/approve', async (c) => {
  const manager = await findUserBySession(c, c.req.header('cookie') ?? null)
  if (!manager || getAccessLevel(manager) !== 'MANAGER') return c.html(renderForbidden(), 403)
  const settlement = await c.env.RENT.prepare("SELECT * FROM deposit_settlements WHERE id = ? AND status = 'PENDING_MANAGER_APPROVAL'").bind(c.req.param('id')).first() as any
  if (!settlement) return c.text('结算单不存在或已处理', 409)
  const result = await c.env.RENT.prepare("UPDATE deposit_settlements SET status = 'APPROVED', reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'PENDING_MANAGER_APPROVAL'").bind(manager.id, settlement.id).run() as any
  if (!result.meta?.changes) return c.text('结算单不存在或已处理', 409)
  await createAuditLog(c, { actor: manager, action: 'DEPOSIT_SETTLEMENT_APPROVED', targetType: 'DEPOSIT_SETTLEMENT', targetId: settlement.id, before: { status: settlement.status }, after: { status: 'APPROVED' } })
  return c.redirect('/manager/deposit-settlements')
})

app.post('/manager/deposit-settlements/:id/reject', async (c) => {
  const manager = await findUserBySession(c, c.req.header('cookie') ?? null)
  if (!manager || getAccessLevel(manager) !== 'MANAGER') return c.html(renderForbidden(), 403)
  const note = String((await c.req.parseBody()).note || '').trim()
  if (!note) return c.text('驳回必须填写原因', 400)
  const settlement = await c.env.RENT.prepare("SELECT * FROM deposit_settlements WHERE id = ? AND status = 'PENDING_MANAGER_APPROVAL'").bind(c.req.param('id')).first() as any
  if (!settlement) return c.text('结算单不存在或已处理', 409)
  await c.env.RENT.prepare("UPDATE deposit_settlements SET status = 'REJECTED', reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP, review_note = ? WHERE id = ?").bind(manager.id, note, settlement.id).run()
  await createAuditLog(c, { actor: manager, action: 'DEPOSIT_SETTLEMENT_REJECTED', targetType: 'DEPOSIT_SETTLEMENT', targetId: settlement.id, before: { status: settlement.status }, after: { status: 'REJECTED' }, reason: note })
  return c.redirect('/manager/deposit-settlements')
})

app.post('/admin/refund-requests/:id/:decision', async (c) => {
  const user = c.get('user')
  if (!user || user.role !== 'ADMIN') return c.html(renderForbidden(), 403)
  try {
    const decision = c.req.param('decision')
    if (decision === 'approve') await actions.approveCustomerRefund(c, user, c.req.param('id'))
    else if (decision === 'reject') await actions.rejectCustomerRefund(c, user, c.req.param('id'), sanitizePlainText((await c.req.parseBody()).note, 300))
    else return c.notFound()
    return c.redirect('/admin/refunds', 303)
  } catch (error: any) { return c.text(error.message || '退款申请处理失败', 409) }
})

app.post('/admin/refunds/:id/complete-customer-refund', async (c) => {
  const user = c.get('user')
  if (!user || user.role !== 'ADMIN') return c.html(renderForbidden(), 403)
  try {
    await actions.completeCustomerManualRefund(c, user, c.req.param('id'))
    return c.redirect('/admin/refunds', 303)
  } catch (error: any) { return c.text(error.message || '退款处理失败', 409) }
})

app.post('/admin/orders/:id/cancel-and-refund', async (c) => {
  const user = c.get('user')
  if (!user || user.role !== 'ADMIN') return c.html(renderForbidden(), 403)
  try {
    const response = await cancelAndRefund(c, user, c.req.param('id'))
    if (response.status < 400) await createAuditLog(c, { actor: user, action: 'REFUND_APPROVED', targetType: 'ORDER', targetId: c.req.param('id'), reason: '取消订单并全额退款' })
    return response
  } catch (error: any) {
    return c.text(error.message || '全额退款失败', 502)
  }
})

app.post('/admin/orders/:id/retry-cancellation-refund', async (c) => {
  const user = c.get('user')
  if (!user || user.role !== 'ADMIN') return c.html(renderForbidden(), 403)
  try {
    const response = await retryCancellationRefund(c, user, c.req.param('id'))
    if (response.status < 400) await createAuditLog(c, { actor: user, action: 'REFUND_APPROVED', targetType: 'ORDER', targetId: c.req.param('id'), reason: '重试取消订单退款' })
    return response
  } catch (error: any) {
    return c.text(error.message || '重试退款失败', 502)
  }
})

app.post('/admin/orders/:id/ignore-refund', async (c) => {
  const admin = c.get('user')
  if (!admin || admin.role !== 'ADMIN') return c.html(renderForbidden(), 403)
  try {
    const note = String((await c.req.parseBody()).note || '').trim()
    await ignorePendingRefund(c, admin, c.req.param('id'), note)
    await createAuditLog(c, { actor: admin, action: 'REFUND_IGNORED', targetType: 'ORDER', targetId: c.req.param('id'), reason: note || '管理员标记为无需退款' })
    return c.redirect('/admin/refunds')
  } catch (error: any) {
    return c.text(error.message || '标记失败', 409)
  }
})

app.post('/admin/refunds/:id/complete-bank-transfer', async (c) => {
  const admin = c.get('user')
  if (!admin || admin.role !== 'ADMIN') return c.text('无权限', 403)
  try {
    await completeBankTransferRefund(c, admin, c.req.param('id'))
    await createAuditLog(c, { actor: admin, action: 'REFUND_COMPLETED', targetType: 'PAYMENT_REFUND', targetId: c.req.param('id') })
    return c.redirect('/admin/refunds')
  } catch (error: any) {
    return c.text(error.message || '退款处理失败', 409)
  }
})

app.post('/admin/orders/:id/delete', async (c) => {
  const user = c.get('user')
  if (!user || user.role !== 'ADMIN') return c.redirect('/login')
  const order = await getOrderById(c, c.req.param('id'))
  if (!order) return c.redirect('/admin/orders?error=' + encodeURIComponent('订单不存在或已被删除'))
  if (!['draft', 'pending_approval', 'approved', 'pending_payment', 'cancelled'].includes(order.status)) {
    return c.redirect('/admin/orders?error=' + encodeURIComponent('只能删除未付款或已取消的订单，请先确认订单状态'))
  }
  await releaseCouponForOrder(c, order.id)
  await c.env.RENT.prepare('UPDATE orders SET deleted_at = CURRENT_TIMESTAMP, updatedAt = CURRENT_TIMESTAMP WHERE id = ? AND deleted_at IS NULL').bind(order.id).run()
  await c.env.RENT.prepare('UPDATE contracts SET deleted_at = CURRENT_TIMESTAMP WHERE orderId = ? AND deleted_at IS NULL').bind(order.id).run()
  await c.env.RENT.prepare("UPDATE notifications SET deleted_at = CURRENT_TIMESTAMP WHERE order_id = ? AND deleted_at IS NULL").bind(order.id).run()
  return c.redirect('/admin/orders?success=' + encodeURIComponent('订单已删除'))
})

app.get('/admin/documents', async (c) => {
  const user = c.get('user')
  if (!user || user.role !== 'ADMIN') return c.html(renderForbidden(), 403)
  return c.html(await pages.renderAdminDocuments(c, user))
})

app.get('/admin/documents/:kind/:id', async (c) => {
  const user = c.get('user')
  if (!user || user.role !== 'ADMIN') return c.html(renderForbidden(), 403)
  const html = await pages.renderAdminDocument(c, user, c.req.param('kind'), c.req.param('id'))
  return html === null ? c.html(renderNotFound(), 404) : c.html(html)
})

app.get('/admin/finance', async (c) => {
  const user = await findUserBySession(c, c.req.header('cookie') ?? null)
  if (!user || user.role !== 'ADMIN') {
    return c.redirect('/login')
  }
  const transferSearch = String(c.req.query('transferCode') || '').trim().toUpperCase()
  const [revenueData, transfers] = await Promise.all([pages.getRevenueData(c), listBankTransferPayments(c, transferSearch)])
  return c.html(pages.renderAdminFinance(user, revenueData.orders, revenueData.refunds, revenueData.withdrawals, { transfers, search: transferSearch, ownerSettlements: revenueData.ownerSettlements }))
})

app.get('/admin/finance/payment-disputes', async (c) => {
  const user = await findUserBySession(c, c.req.header('cookie') ?? null)
  if (!user || !['MANAGER', 'ADMIN'].includes(getAccessLevel(user))) return c.redirect('/login')
  const disputes = await c.env.RENT.prepare(`SELECT d.*, o.orderNo AS order_no, u.name AS customer_name, u.email AS customer_email, dev.name AS device_name, dev.serialNumber AS device_serial, rf.flag_type AS risk_flag_type, rf.status AS risk_flag_status FROM payment_disputes d LEFT JOIN orders o ON o.id = d.order_id LEFT JOIN users u ON u.id = d.customer_id LEFT JOIN devices dev ON dev.id = d.device_id LEFT JOIN risk_flags rf ON rf.id = d.risk_flag_id ORDER BY CASE WHEN d.status IN ('DISPUTE_OPENED', 'DISPUTE_UNDER_REVIEW') THEN 0 ELSE 1 END, d.evidence_due_by ASC, d.updated_at DESC`).all()
  return c.html(pages.renderAdminPaymentDisputes(user, disputes.results || []))
})

app.post('/admin/finance/payment-disputes/:id', async (c) => {
  const admin = c.get('user')
  if (!admin || !['MANAGER', 'ADMIN'].includes(getAccessLevel(admin))) return c.html(renderForbidden(), 403)
  const form = await c.req.parseBody()
  const status = String(form.status || '')
  const evidenceStatus = sanitizePlainText(String(form.evidenceStatus || ''), 200).trim() || null
  const result = sanitizePlainText(String(form.result || ''), 1000).trim() || null
  const impactText = String(form.financialImpact || '').trim()
  const financialImpact = impactText === '' ? null : Number(impactText)
  if (!PAYMENT_DISPUTE_STATES.includes(status as any)) return c.text('争议状态无效', 400)
  if (['DISPUTE_WON', 'DISPUTE_LOST', 'DISPUTE_CLOSED'].includes(status) && !result) return c.text('结案时必须填写处理结论', 400)
  if (financialImpact !== null && (!Number.isFinite(financialImpact) || financialImpact < 0)) return c.text('财务影响必须是非负金额', 400)
  const dispute = await c.env.RENT.prepare('SELECT * FROM payment_disputes WHERE id = ?').bind(c.req.param('id')).first() as any
  if (!dispute) return c.text('支付争议不存在', 404)
  if (!canTransitionPaymentDispute(String(dispute.status), status)) return c.text(`不允许从 ${dispute.status} 变更为 ${status}`, 409)
  const updated = await c.env.RENT.prepare("UPDATE payment_disputes SET status = ?, evidence_status = ?, result = ?, financial_impact = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status IN ('DISPUTE_OPENED', 'DISPUTE_UNDER_REVIEW')").bind(status, evidenceStatus, result, financialImpact, dispute.id).run()
  if (!updated.meta?.changes) return c.text('支付争议已结案或已被其他管理员更新', 409)
  await createAuditLog(c, { actor: admin, action: 'PAYMENT_DISPUTE_UPDATED', targetType: 'PAYMENT_DISPUTE', targetId: dispute.id, before: { status: dispute.status }, after: { status, evidenceStatus, financialImpact }, reason: result || evidenceStatus || '更新支付争议' })
  return c.redirect('/admin/finance/payment-disputes', 303)
})

app.get('/admin/finance/anomalous-orders', async (c) => {
  const user = await findUserBySession(c, c.req.header('cookie') ?? null)
  if (!user || user.role !== 'ADMIN') return c.redirect('/login')
  const reviews = await c.env.RENT.prepare(`SELECT r.*, o.orderNo AS order_no, u.name AS customer_name, u.email AS customer_email, reviewer.name AS reviewer_name FROM anomalous_order_reviews r LEFT JOIN orders o ON o.id = r.order_id LEFT JOIN users u ON u.id = o.userId LEFT JOIN users reviewer ON reviewer.id = r.reviewed_by ORDER BY CASE WHEN r.status = 'PENDING' THEN 0 ELSE 1 END, r.detected_at DESC`).all()
  return c.html(pages.renderAdminAnomalousOrders(user, reviews.results || []))
})

app.post('/admin/finance/anomalous-orders/:id', async (c) => {
  const admin = c.get('user')
  if (!admin || admin.role !== 'ADMIN') return c.html(renderForbidden(), 403)
  const form = await c.req.parseBody()
  const decision = String(form.decision || '')
  const note = sanitizePlainText(String(form.note || ''), 1000).trim()
  if (!['restore', 'confirm'].includes(decision) || !note) return c.text('请选择审核结果并填写说明', 400)
  const review = await c.env.RENT.prepare("SELECT * FROM anomalous_order_reviews WHERE id = ? AND status = 'PENDING'").bind(c.req.param('id')).first() as any
  if (!review) return c.text('异常订单不存在或已审核', 409)
  const order = await getOrderById(c, review.order_id)
  if (!order || order.status !== 'suspended') return c.text('订单当前不是系统暂停状态，无法按此审核记录处理', 409)
  if (decision === 'restore') await updateOrderStatus(c, order.id, review.original_status)
  await c.env.RENT.batch([
    c.env.RENT.prepare("UPDATE anomalous_order_reviews SET status = ?, reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP, review_note = ? WHERE id = ? AND status = 'PENDING'").bind(decision === 'restore' ? 'RESTORED' : 'CONFIRMED', admin.id, note, review.id),
    c.env.RENT.prepare('UPDATE data_consistency_issues SET resolved_at = CURRENT_TIMESTAMP WHERE id = ? AND resolved_at IS NULL').bind(review.consistency_issue_id),
  ])
  await createAuditLog(c, { actor: admin, action: 'ANOMALOUS_ORDER_REVIEWED', targetType: 'ORDER', targetId: order.id, before: { status: 'suspended', anomalyType: review.anomaly_type }, after: { status: decision === 'restore' ? review.original_status : 'suspended', decision }, reason: note })
  return c.redirect('/admin/finance/anomalous-orders', 303)
})

app.get('/admin/revenue-stats', async (c) => {
  const user = await findUserBySession(c, c.req.header('cookie') ?? null)
  if (!user || user.role !== 'ADMIN') return c.redirect('/login')
  return c.html(pages.renderAdminRevenueStats(user, await pages.getRevenueData(c)))
})

// 运营分析报表（完善.md）——金额一律从 Ledger / Payment / Refund 明细汇总。
app.get('/admin/reports', async (c) => {
  const user = await findUserBySession(c, c.req.header('cookie') ?? null)
  if (!user || user.role !== 'ADMIN') return c.redirect('/login')
  const windowDays = [7, 30, 90, 365].includes(Number(c.req.query('days'))) ? Number(c.req.query('days')) : 30
  // 窗口天数虽然只能来自上面的枚举，仍然走绑定参数而不是把值拼进 SQL：
  // 所有以 since 为界的时间列都绑定同一个 `-N days` 偏移量。
  const since = "datetime('now', ?)"
  const sinceOffset = `-${windowDays} days`
  const [rentalRevenue, refundTotal, deposits, outstanding, overdue, fleet, rentedDays, damage, maintenance, coupon, referral, methods] = await Promise.all([
    c.env.RENT.prepare(`SELECT COALESCE(SUM(COALESCE(rental_amount, amount)), 0) AS v FROM payments WHERE status = 'paid' AND paid_at >= ${since}`).bind(sinceOffset).first<{ v: number }>(),
    c.env.RENT.prepare(`SELECT COALESCE(SUM(CASE WHEN r.type = 'cancellation' THEN MAX(0, MIN(r.refund_amount, COALESCE(p.rental_amount, 0))) ELSE MAX(0, r.refund_amount) END), 0) AS v
      FROM payment_refunds r LEFT JOIN payments p ON p.id = r.payment_id
      WHERE r.status = 'succeeded' AND r.type <> 'deposit' AND r.created_at >= ${since}`).bind(sinceOffset).first<{ v: number }>(),
    c.env.RENT.prepare(`SELECT
        COALESCE(SUM(CASE WHEN deposit_status IN ('HELD','PAID','PARTIALLY_DEDUCTED','REFUND_PENDING') THEN deposit_held_amount ELSE 0 END), 0) AS held,
        COALESCE(SUM(CASE WHEN deposit_status IN ('REFUNDED','PARTIALLY_REFUNDED') AND deposit_refund_at >= ${since} THEN deposit_refund_amount ELSE 0 END), 0) AS refunded,
        COALESCE(SUM(CASE WHEN deposit_status = 'FORFEITED' AND deposit_refund_at >= ${since} THEN deposit_deduction_amount ELSE 0 END), 0) AS forfeited
      FROM orders`).bind(sinceOffset, sinceOffset).first<{ held: number; refunded: number; forfeited: number }>(),
    c.env.RENT.prepare("SELECT COALESCE(SUM(totalAmount), 0) AS v FROM orders WHERE status = 'pending_payment'").first<{ v: number }>(),
    c.env.RENT.prepare("SELECT COUNT(*) AS v FROM orders WHERE rental_status = 'OVERDUE' OR (status IN ('active','extended') AND endDate < date('now'))").first<{ v: number }>(),
    c.env.RENT.prepare("SELECT COUNT(*) AS v FROM devices WHERE COALESCE(lifecycle_status, status, '') NOT IN ('RETIRED','retired')").first<{ v: number }>(),
    c.env.RENT.prepare(`SELECT COALESCE(SUM(rentalPeriod), 0) AS v FROM orders WHERE status IN ('active','extended','completed','overdue','returned','pending_return','paid','pending_pickup') AND createdAt >= ${since}`).bind(sinceOffset).first<{ v: number }>(),
    c.env.RENT.prepare(`SELECT COALESCE(SUM(COALESCE(final_cost_cents, estimated_cost_cents)), 0) AS v FROM damage_cases WHERE created_at >= ${since}`).bind(sinceOffset).first<{ v: number }>(),
    c.env.RENT.prepare(`SELECT COALESCE(SUM(cost), 0) AS v FROM maintenance_records WHERE COALESCE(completed_at, started_at) >= ${since}`).bind(sinceOffset).first<{ v: number }>(),
    c.env.RENT.prepare(`SELECT COALESCE(SUM(discount_amount), 0) AS v FROM coupon_redemptions WHERE status = 'REDEEMED' AND COALESCE(redeemed_at, created_at) >= ${since}`).bind(sinceOffset).first<{ v: number }>(),
    c.env.RENT.prepare(`SELECT COALESCE(SUM(reward_amount), 0) AS v FROM referral_rewards WHERE status IN ('APPROVED','AVAILABLE') AND created_at >= ${since}`).bind(sinceOffset).first<{ v: number }>(),
    c.env.RENT.prepare(`SELECT CASE WHEN payment_method = 'card' AND payment_provider = 'square' THEN 'square' ELSE payment_method END AS method, COALESCE(SUM(amount), 0) AS amount, COUNT(*) AS count FROM payments WHERE status = 'paid' AND paid_at >= ${since} GROUP BY CASE WHEN payment_method = 'card' AND payment_provider = 'square' THEN 'square' ELSE payment_method END`).bind(sinceOffset).all(),
  ])
  return c.html(pages.renderAdminOperationsReport(user, {
    windowDays,
    rentalRevenue: Number(rentalRevenue?.v || 0),
    refundTotal: Number(refundTotal?.v || 0),
    depositHeld: Number(deposits?.held || 0),
    depositRefunded: Number(deposits?.refunded || 0),
    depositForfeited: Number(deposits?.forfeited || 0),
    outstandingBalance: Number(outstanding?.v || 0),
    overdueRentals: Number(overdue?.v || 0),
    fleetSize: Number(fleet?.v || 0),
    rentedDeviceDays: Number(rentedDays?.v || 0),
    damageCost: Number(damage?.v || 0) / 100,
    maintenanceCost: Number(maintenance?.v || 0),
    couponDiscountCost: Number(coupon?.v || 0),
    referralRewardCost: Number(referral?.v || 0),
    paymentMethods: ((methods?.results || []) as any[]).map(r => ({ method: String(r.method || 'unknown'), amount: Number(r.amount || 0), count: Number(r.count || 0) })),
  }))
})

// 数据保留策略（完善.md / P3 #18）
const RETENTION_PREVIEW_SOURCES: Record<string, { table: string; dateCol: string }> = {
  CONTRACTS: { table: 'contracts', dateCol: 'createdAt' },
  FINANCIAL_RECORDS: { table: 'financial_ledger_entries', dateCol: 'created_at' },
  REFERRAL_RECORDS: { table: 'referral_rewards', dateCol: 'created_at' },
  COUPON_RECORDS: { table: 'coupon_redemptions', dateCol: 'created_at' },
  AUDIT_LOGS: { table: 'audit_logs', dateCol: 'created_at' },
}

app.get('/admin/data-retention', async (c) => {
  const user = await findUserBySession(c, c.req.header('cookie') ?? null)
  if (!user || user.role !== 'ADMIN') return c.redirect('/login')
  const policies = (await c.env.RENT.prepare('SELECT * FROM data_retention_policies ORDER BY rowid').all()).results as any[]
  const preview: Record<string, number> = {}
  for (const p of policies) {
    const src = RETENTION_PREVIEW_SOURCES[p.category]
    if (!src) continue
    // 表名 / 列名无法参数化，只能白名单：映射本身是常量，这里再断言一次标识符形状，
    // 即使以后映射改成来自数据库也不会变成拼接注入点。
    if (!SQL_IDENTIFIER.test(src.table) || !SQL_IDENTIFIER.test(src.dateCol)) continue
    try {
      const row = await c.env.RENT.prepare(`SELECT COUNT(*) AS v FROM ${src.table} WHERE ${src.dateCol} <= datetime('now', ?)`).bind(`-${Math.max(0, Number(p.retention_days) || 0)} days`).first<{ v: number }>()
      preview[p.category] = Number(row?.v || 0)
    } catch { /* 该类别暂无对应可预览表 */ }
  }
  return c.html(pages.renderAdminDataRetention(user, policies, preview))
})

app.post('/admin/data-retention/:category', async (c) => {
  const admin = c.get('user')
  if (!admin || admin.role !== 'ADMIN') return c.html(renderForbidden(), 403)
  const category = c.req.param('category')
  const existing = await c.env.RENT.prepare('SELECT * FROM data_retention_policies WHERE category = ?').bind(category).first() as any
  if (!existing) return c.text('未知的数据类别', 404)
  const form = await c.req.parseBody()
  const retentionDays = Math.round(Number(form.retentionDays))
  const action = String(form.action || '')
  const basis = sanitizePlainText(String(form.basis || ''), 200).trim()
  const notes = sanitizePlainText(String(form.notes || ''), 300).trim() || null
  const enabled = form.enabled === '1' ? 1 : 0
  if (!Number.isFinite(retentionDays) || retentionDays < 0 || retentionDays > 36500) return c.text('保留天数无效', 400)
  if (!['RETAIN', 'ARCHIVE', 'DELETE', 'ANONYMISE'].includes(action)) return c.text('到期动作无效', 400)
  if (!basis) return c.text('必须填写保留依据', 400)
  if (action === 'DELETE' && ['CONTRACTS', 'FINANCIAL_RECORDS', 'AUDIT_LOGS'].includes(category)) return c.text('合同 / 财务 / 审计记录不允许设置为删除', 409)
  await c.env.RENT.prepare('UPDATE data_retention_policies SET retention_days = ?, action = ?, basis = ?, notes = ?, enabled = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE category = ?')
    .bind(retentionDays, action, basis, notes, enabled, admin.id, category).run()
  await createAuditLog(c, { actor: admin, action: 'DATA_RETENTION_POLICY_UPDATED', targetType: 'DATA_RETENTION_POLICY', targetId: category, before: { retentionDays: existing.retention_days, action: existing.action, enabled: existing.enabled }, after: { retentionDays, action, enabled }, reason: notes || basis })
  return c.redirect('/admin/data-retention', 303)
})

// 系统健康监控（完善.md / P8 #32, #33）
app.get('/admin/monitoring', async (c) => {
  const user = await findUserBySession(c, c.req.header('cookie') ?? null)
  if (!user || user.role !== 'ADMIN') return c.redirect('/login')
  const [metrics, history, jobRuns] = await Promise.all([
    collectMonitoringMetrics(c),
    getMonitoringHistory(c, 168),
    c.env.RENT.prepare('SELECT job_name, status, started_at, completed_at, error_message, result_summary FROM scheduled_job_runs ORDER BY started_at DESC LIMIT 25').all().then(r => r.results || []),
  ])
  return c.html(pages.renderAdminMonitoring(user, metrics, jobRuns as any[], history))
})

app.get('/admin/connectivity', async (c) => {
  const user = await findUserBySession(c, c.req.header('cookie') ?? null)
  if (!user || user.role !== 'ADMIN') return c.redirect('/login')
  return c.html(pages.renderAdminConnectivity(user))
})

app.post('/admin/connectivity/check', async (c) => {
  const user = await findUserBySession(c, c.req.header('cookie') ?? null)
  if (!user || user.role !== 'ADMIN') return c.json({ error: '无权限执行检测' }, 403)
  const input = await c.req.json().catch(() => ({})) as any
  try {
    const results = await runConnectivityProbes(c, String(input.target || 'all'))
    return c.json({ results }, 200, { 'Cache-Control': 'no-store' })
  } catch (error: any) {
    return c.json({ error: String(error?.message || '检测失败').slice(0, 160) }, 400, { 'Cache-Control': 'no-store' })
  }
})

// 代理计划（完善.md §29，预留未启用）：路由已下线，入口从后台导航移除

app.get('/admin/coupons', async (c) => {
  const admin = await findUserBySession(c, c.req.header('cookie') ?? null)
  if (!admin || admin.role !== 'ADMIN') return c.redirect('/login')
  const coupons = (await c.env.RENT.prepare('SELECT * FROM coupons WHERE deleted_at IS NULL ORDER BY created_at DESC').all()).results || []
  const devices = (await c.env.RENT.prepare('SELECT id, name, brand, model FROM devices WHERE deleted_at IS NULL ORDER BY name').all()).results || []
  return c.html(pages.renderAdminCoupons(admin, coupons as any[], devices as any[]))
})

app.get('/admin/device-agent-bindings', async (c) => {
  const user = await findUserBySession(c, c.req.header('cookie') ?? null)
  if (!user || user.role !== 'ADMIN') return c.redirect('/login')
  const monitorToken = await c.env.RENT.prepare("SELECT value FROM systemSettings WHERE key = 'monitorApiTokenHash' AND deleted_at IS NULL").first() as any
  return c.html(await pages.renderAdminDeviceAgentBindings(c, user, { monitorApiConfigured: Boolean(monitorToken?.value) }))
})

app.post('/admin/device-agent-bindings/monitor-token', async (c) => {
  const user = await findUserBySession(c, c.req.header('cookie') ?? null)
  if (!user || user.role !== 'ADMIN') return c.html(renderForbidden(), 403)
  const token = crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '')
  const tokenHash = await hashAgentValue(token)
  const existing = await c.env.RENT.prepare("SELECT value FROM systemSettings WHERE key = 'monitorApiTokenHash' AND deleted_at IS NULL").first() as any
  await c.env.RENT.prepare(`INSERT INTO systemSettings (key, value) VALUES ('monitorApiTokenHash', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updatedAt = CURRENT_TIMESTAMP, deleted_at = NULL`).bind(tokenHash).run()
  invalidateMonitorApiTokenCache()
  await createAuditLog(c, { actor: user, action: existing?.value ? 'MONITOR_API_TOKEN_ROTATED' : 'MONITOR_API_TOKEN_CREATED', targetType: 'SYSTEM', targetId: 'monitor-api' })
  c.header('Cache-Control', 'no-store')
  return c.html(await pages.renderAdminDeviceAgentBindings(c, user, { monitorApiConfigured: true, newMonitorApiToken: token }))
})

app.post('/admin/device-agent-bindings/:id/unbind', async (c) => {
  const user = await findUserBySession(c, c.req.header('cookie') ?? null)
  if (!user || user.role !== 'ADMIN') return c.redirect('/login')
  await c.env.RENT.prepare("UPDATE devices SET agent_token_hash = NULL, agent_registered_at = NULL, agent_last_seen_at = NULL, agent_last_ip = NULL, agent_hostname = NULL, agent_os_version = NULL, agent_cpu = NULL, agent_memory_mb = NULL, agent_storage_free_bytes = NULL, agent_status = 'unregistered', agent_setup_code_hash = NULL, agent_setup_code_expires_at = NULL, updatedAt = CURRENT_TIMESTAMP WHERE id = ?").bind(c.req.param('id')).run()
  return c.redirect('/admin/device-agent-bindings')
})

app.get('/admin/devices', async (c) => {
  const user = await findUserBySession(c, c.req.header('cookie') ?? null)
  if (!user || user.role !== 'ADMIN') {
    return c.redirect('/login')
  }
  const { getDevicesAsync } = await import('./site')
  const devices = await getDevicesAsync(c)
  return c.html(pages.renderAdminDevices(user, devices))
})

app.get('/admin/devices/relist', async (c) => {
  const user = c.get('user')
  if (!user || user.role !== 'ADMIN') return c.html(renderForbidden(), 403)
  return c.html(pages.renderAdminDeviceRelistList(user, await actions.getRelistableDevices(c)))
})

app.get('/admin/devices/:id/relist', async (c) => {
  const user = c.get('user')
  if (!user || user.role !== 'ADMIN') return c.html(renderForbidden(), 403)
  const device = await getDeviceById(c, c.req.param('id'))
  if (!device) return c.text('设备不存在', 404)
  return c.html(pages.renderAdminDeviceRelist(user, device, await actions.deviceRelistBlockReason(c, device)))
})

app.post('/admin/devices/:id/relist', async (c) => {
  const user = c.get('user')
  if (!user || user.role !== 'ADMIN') return c.html(renderForbidden(), 403)
  return actions.relistReturnedDevice(c, user, c.req.param('id'))
})

app.get('/admin/devices/new', async (c) => {
  const user = await findUserBySession(c, c.req.header('cookie') ?? null)
  if (!user || user.role !== 'ADMIN') {
    return c.redirect('/login')
  }
  return c.html(pages.renderAdminDeviceNew(user))
})

async function generateAssetTag(c: any, brand: string): Promise<string> {
  const letters = String(brand || '').normalize('NFKD').replace(/[^a-zA-Z0-9]/g, '').toUpperCase()
  const fallback = Array.from(String(brand || '').trim()).slice(0, 2).join('').toUpperCase()
  const code = (letters.slice(0, 2) || fallback || 'DV').padEnd(2, 'X').slice(0, 2)
  const prefix = `RT-${code}-`
  const rows = (await c.env.RENT.prepare("SELECT asset_tag FROM devices WHERE asset_tag LIKE ? ORDER BY asset_tag DESC").bind(`${prefix}%`).all()).results || []
  const used = new Set(rows.map((row: any) => String(row.asset_tag || '')))
  let sequence = rows.reduce((max: number, row: any) => {
    const match = String(row.asset_tag || '').match(new RegExp(`^${prefix}(\\d{6})$`))
    return Math.max(max, match ? Number(match[1]) : 0)
  }, 0) + 1
  let candidate = `${prefix}${String(sequence).padStart(6, '0')}`
  while (used.has(candidate)) candidate = `${prefix}${String(++sequence).padStart(6, '0')}`
  return candidate
}

app.post('/admin/devices/new', async (c) => {
  const user = await findUserBySession(c, c.req.header('cookie') ?? null)
  if (!user || user.role !== 'ADMIN') {
    return c.redirect('/login')
  }
  const body = await c.req.text()
  const form = parseFormBody(body)
  if (![form.name, form.brand, form.model, form.serialNumber].every(value => value?.trim())) return c.text('请完整填写设备名称、品牌、型号和序列号', 400)
  if (!Number.isFinite(Number(form.pricePerDay)) || Number(form.pricePerDay) < 0 || !Number.isFinite(Number(form.depositAmount)) || Number(form.depositAmount) < 0) return c.text('日租金和押金必须是有效的非负金额', 400)
  const weeklyDiscountPercent = parseDeviceDiscountPercent(form.weeklyDiscountPercent)
  const monthlyDiscountPercent = parseDeviceDiscountPercent(form.monthlyDiscountPercent)
  if (weeklyDiscountPercent === null || monthlyDiscountPercent === null) return c.text('周租和月租折扣必须是 0%–100% 之间的数字', 400)
  if (!['available', 'rented', 'maintenance', 'retired'].includes(form.status || 'available')) return c.text('设备状态无效', 400)
  if (form.lifecycleStatus && !['RESERVED', 'READY', 'RENTED', 'RETURNED', 'INSPECTION', 'MAINTENANCE', 'DAMAGED', 'RETIRED'].includes(form.lifecycleStatus)) return c.text('设备生命周期状态无效', 400)
  const serialNumber = String(form.serialNumber || '').trim().slice(0, 120)
  const duplicate = await c.env.RENT.prepare('SELECT id FROM devices WHERE serialNumber = ?').bind(serialNumber).first()
  if (duplicate) return c.html(pages.renderAdminDeviceNew(user, '序列号已存在，请检查后重新填写。'), 409)
  const registrationKey = nanoid(48)
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(registrationKey))
  const agentTokenHash = Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, '0')).join('')
  try {
    await insertDevice(c, {
      name: form.name || '',
      category: form.category || '其他',
      brand: form.brand || '',
      model: form.model || '',
      assetTag: await generateAssetTag(c, form.brand || ''),
      serialNumber,
      cpu: form.cpu || '',
      ram: form.ram || '',
      storage: form.storage || '',
      gpu: form.gpu || '',
      os: form.os || '',
      pricePerDay: Number(form.pricePerDay) || 0,
      depositAmount: Number(form.depositAmount) || 0,
      weeklyDiscountPercent,
      monthlyDiscountPercent,
      weeklyDiscountOverride: String(form.weeklyDiscountPercent ?? '').trim() ? weeklyDiscountPercent : null,
      monthlyDiscountOverride: String(form.monthlyDiscountPercent ?? '').trim() ? monthlyDiscountPercent : null,
      demoMode: form.demoMode === '1',
      status: (form.status as any) || 'available',
      description: form.description || form.remark || '',
      agentTokenHash
    })
  } catch (error: any) {
    if (/UNIQUE constraint failed: devices\.serial(Number|_number)/i.test(String(error?.message || error))) return c.html(pages.renderAdminDeviceNew(user, '序列号已存在，请检查后重新填写。'), 409)
    throw error
  }
  return c.html(pages.renderAdminDeviceNew(user, '设备已成功入库，以下是本次生成的设备注册密钥：', registrationKey))
})

app.get('/admin/devices/:id/edit', async (c) => {
  const user = await findUserBySession(c, c.req.header('cookie') ?? null)
  if (!user || user.role !== 'ADMIN') {
    return c.redirect('/login')
  }
  const device = await getDeviceById(c, c.req.param('id'))
  if (!device) {
    return c.redirect('/admin/devices')
  }
  const unavailableDates = ((await c.env.RENT.prepare('SELECT unavailable_date FROM device_unavailable_dates WHERE device_id = ? AND deleted_at IS NULL ORDER BY unavailable_date').bind(device.id).all()).results || []).map((row: any) => row.unavailable_date)
  const unavailableTimeSlots = ((await c.env.RENT.prepare('SELECT unavailable_date, time_slot FROM device_unavailable_time_slots WHERE device_id = ? AND deleted_at IS NULL ORDER BY unavailable_date, time_slot').bind(device.id).all().catch(() => ({ results: [] }))).results || []).reduce((result: Record<string, string[]>, row: any) => {
    const date = String(row.unavailable_date)
      ; (result[date] ||= []).push(String(row.time_slot))
    return result
  }, {})
  const lifecycleEvents = (await c.env.RENT.prepare('SELECT previous_status, next_status, reason, changed_by, created_at FROM device_lifecycle_events WHERE device_id = ? ORDER BY created_at DESC LIMIT 8').bind(device.id).all()).results || []
  return c.html(pages.renderAdminDeviceEdit(user, { ...device, unavailableDates, unavailableTimeSlots, lifecycleEvents }))
})

app.get('/admin/devices/:id/control', async (c) => {
  const user = await findUserBySession(c, c.req.header('cookie') ?? null)
  if (!user || user.role !== 'ADMIN') return c.redirect('/login')
  await ensureDeviceCommandTables(c.env.RENT)
  const device = await getDeviceById(c, c.req.param('id'))
  if (!device) return c.redirect('/admin/devices')
  const commands = (await c.env.RENT.prepare(`SELECT dc.id, dc.created_at, dc.command_type, dc.status, dc.sent_at, dc.acknowledged_at, dc.started_at, dc.completed_at, dc.error_message, dcr.result_message FROM device_commands dc LEFT JOIN device_command_results dcr ON dcr.command_id = dc.id WHERE dc.device_id = ? ORDER BY dc.created_at DESC LIMIT 20`).bind(device.id).all()).results || []
  const [maintenanceRes, checkRes] = await Promise.all([
    c.env.RENT.prepare("SELECT id, maintenance_type, status, description, cost, vendor, invoice_url, technician, replacement_parts, repair_notes, data_wipe_method, notes, started_at, completed_at, failure_reason FROM maintenance_records WHERE device_id = ? ORDER BY started_at DESC LIMIT 8").bind(device.id).all(),
    c.env.RENT.prepare("SELECT mpc.maintenance_id, mpc.check_type, mpc.passed, mpc.details FROM maintenance_preparation_checks mpc JOIN maintenance_records mr ON mr.id = mpc.maintenance_id WHERE mr.device_id = ? ORDER BY mpc.verified_at DESC").bind(device.id).all(),
  ])
  const maintenance = (maintenanceRes.results || []) as any[]
  const checksByRecord: Record<string, any[]> = {}
  for (const row of (checkRes.results || []) as any[]) (checksByRecord[row.maintenance_id] ||= []).push(row)
  return c.html(pages.renderAdminDeviceControl(user, device, commands as any[], { maintenance, checksByRecord, checkTypes: [...MAINTENANCE_CHECK_TYPES] }, c.req.query('success')))
})

app.get('/admin/devices/:id/agent-binding-status', async (c) => {
  const user = await findUserBySession(c, c.req.header('cookie') ?? null)
  if (!user || user.role !== 'ADMIN') return c.json({ ok: false }, 401)
  const device = await getDeviceById(c, c.req.param('id')) as any
  if (!device) return c.json({ ok: false }, 404)
  return c.json({ ok: true, bound: Boolean(device.agent_token_hash || device.agentTokenHash) })
})

app.get('/admin/devices/:id/agent-install', async (c) => {
  const user = await findUserBySession(c, c.req.header('cookie') ?? null)
  if (!user || user.role !== 'ADMIN') return c.redirect('/login')
  const device = await getDeviceById(c, c.req.param('id')) as any
  if (!device) return c.redirect('/admin/devices')
  if (device.agent_token_hash || device.agentTokenHash) {
    const body = `<div class="page-header"><div><p class="section-code">WINDOWS AGENT</p><h2>Windows 客户端安装信息</h2><p>${sanitizePlainText(device.name, 120)} 已完成客户端绑定。</p></div><a href="/admin/device-agent-bindings" class="button button-secondary">返回绑定设备</a></div><div class="panel"><h3>已绑定</h3><p>此设备已与 Windows 客户端绑定，无需访问码。</p><div class="record-actions"><a class="button button-secondary" href="/admin/device-agent-bindings">返回绑定设备</a><a class="button button-primary" href="/downloads/RentDeviceAgent-Setup.exe">下载 Windows 安装程序（EXE）</a></div></div>`
    return c.html(buildLayout('Windows 客户端安装信息 - 电脑租赁管理系统', body, user))
  }
  const code = String(Math.floor(100000 + Math.random() * 900000))
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(code))
  const codeHash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString()
  const expiresAtMs = Date.parse(expiresAt)
  await c.env.RENT.prepare("UPDATE devices SET agent_token_hash = NULL, agent_registered_at = NULL, agent_last_seen_at = NULL, agent_last_ip = NULL, agent_hostname = NULL, agent_os_version = NULL, agent_cpu = NULL, agent_memory_mb = NULL, agent_storage_free_bytes = NULL, agent_status = 'unregistered', agent_setup_code_hash = ?, agent_setup_code_expires_at = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?").bind(codeHash, expiresAt, device.id).run()
  const body = `<div class="page-header"><div><p class="section-code">WINDOWS AGENT</p><h2>Windows 客户端安装信息</h2><p>${sanitizePlainText(device.name, 120)} · 访问码有效 15 分钟且只能使用一次。</p></div><a href="/admin/device-agent-bindings" class="button button-secondary">返回绑定设备</a></div><div class="panel"><h3 id="agent-code-title">6 位 Windows 客户端访问码</h3><p id="agent-code-hint">安装时请输入此访问码。BIOS 序列号会被记录，但不能单独完成绑定。</p><div id="agent-setup-code" style="font-size:42px;letter-spacing:12px;font-weight:700;margin:28px 0;color:var(--accent,#2563eb);"><code>${code}</code></div><div class="record-actions"><button class="button button-primary" type="button" id="copy-agent-code">复制 6 位访问码</button><a class="button button-primary" href="/downloads/RentDeviceAgent-Setup.exe">下载 Windows 安装程序（EXE）</a></div><p id="agent-code-expiry">访问码剩余：<strong id="agent-code-countdown" data-expires-at="${expiresAtMs}">15 分钟</strong>。安装程序会安装到系统目录并注册 Windows Service。</p><p class="page-notification page-notification--warning" id="agent-code-warning">访问码只显示这一次。关闭页面后无法恢复，只能重新生成。绑定成功后访问码立即失效。</p></div><script>(()=>{const b=document.getElementById('copy-agent-code'),c=document.getElementById('agent-code-countdown'),expires=Number(c?.dataset.expiresAt||0),code=document.getElementById('agent-setup-code'),title=document.getElementById('agent-code-title'),hint=document.getElementById('agent-code-hint'),expiry=document.getElementById('agent-code-expiry'),warning=document.getElementById('agent-code-warning');let bound=false;b?.addEventListener('click',async()=>{await navigator.clipboard.writeText('${code}');b.textContent='已复制';setTimeout(()=>{if(!bound)b.textContent='复制 6 位访问码';},1600);});const showBound=()=>{if(bound)return;bound=true;title.textContent='已绑定';hint.textContent='此访问码已被 Windows 客户端成功使用。';code.innerHTML='<strong>已绑定</strong>';code.style.letterSpacing='normal';code.style.fontSize='28px';code.style.color='var(--success,#15803d)';b.disabled=true;b.hidden=true;expiry.hidden=true;warning.hidden=true;};const check=async()=>{try{const r=await fetch('/admin/devices/${encodeURIComponent(device.id)}/agent-binding-status');const data=await r.json();if(data.bound){showBound();return;}}catch{}if(!bound)setTimeout(check,3000);};const tick=()=>{const left=Math.max(0,expires-Date.now());if(!c||bound)return;if(!left){c.textContent='已过期';c.style.color='#b42318';return;}const total=Math.ceil(left/1000),minutes=Math.floor(total/60),seconds=total%60;c.textContent=minutes?minutes+' 分 '+String(seconds).padStart(2,'0')+' 秒':seconds+' 秒';setTimeout(tick,1000);};tick();check();})();</script>`
  return c.html(buildLayout('Windows 客户端安装信息 - 电脑租赁管理系统', body, user))
})

app.post('/api/device-agent/register-legacy', async (c) => {
  const payload = await c.req.json().catch(() => ({})) as any
  const registrationCode = String(payload.registrationCode || '')
  if (!registrationCode) return c.json({ error: 'registrationCode is required' }, 400)
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(registrationCode))
  const codeHash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
  const row = await c.env.RENT.prepare("SELECT id, device_id FROM device_registration_codes WHERE code_hash = ? AND used_at IS NULL AND expires_at > CURRENT_TIMESTAMP ORDER BY created_at DESC LIMIT 1").bind(codeHash).first() as any
  if (!row) return c.json({ error: 'registration code is invalid, expired, or already used' }, 401)
  const now = new Date().toISOString()
  const result = await c.env.RENT.prepare('UPDATE device_registration_codes SET used_at = ? WHERE id = ? AND used_at IS NULL').bind(now, row.id).run()
  if (!result.success || !result.meta?.changes) return c.json({ error: 'registration code is already used' }, 409)
  const agentToken = nanoid(48)
  const tokenDigest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(agentToken))
  const tokenHash = Array.from(new Uint8Array(tokenDigest), byte => byte.toString(16).padStart(2, '0')).join('')
  await c.env.RENT.prepare("UPDATE devices SET agent_token_hash = ?, agent_registered_at = ?, agent_last_seen_at = ?, agent_last_ip = ?, agent_hostname = ?, agent_os_version = ?, agent_cpu = ?, agent_memory_mb = ?, agent_storage_free_bytes = ?, agent_version = ?, agent_status = 'online' WHERE id = ?").bind(tokenHash, now, now, c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For') || '', String(payload.hostname || ''), String(payload.osVersion || ''), String(payload.cpu || ''), Number(payload.memoryMb) || null, Number(payload.storageFreeBytes) || null, String(payload.version || ''), row.device_id).run()
  return c.json({ deviceId: row.device_id, agentToken, heartbeatUrl: new URL('/api/device-agent/heartbeat', c.req.url).toString() })
})

app.post('/admin/devices/:id/commands', async (c) => {
  const user = await findUserBySession(c, c.req.header('cookie') ?? null)
  if (!user || !['MANAGER', 'ADMIN'].includes(getAccessLevel(user))) return c.redirect('/login')
  await ensureDeviceCommandTables(c.env.RENT)
  const device = await c.env.RENT.prepare('SELECT id FROM devices WHERE id = ?').bind(c.req.param('id')).first()
  if (!device) return c.text('设备不存在', 404)
  const deviceStatus = await c.env.RENT.prepare('SELECT agent_status FROM devices WHERE id = ?').bind(c.req.param('id')).first() as any
  if (String(deviceStatus?.agent_status || '').toLowerCase() !== 'online') return c.text('设备当前不在线，无法执行远程操作', 409)
  const form = await c.req.parseBody()
  // Accept the current field name and the names used by older cached control
  // pages, then normalize it before validating the command.
  const type = String(form.commandType || form.command || form.type || '').trim().toUpperCase()
  const allowed = ['SYNC', 'SHOW_MESSAGE', 'PAUSE_RENTAL', 'RESUME_RENTAL', 'REFRESH_DEVICE_INFO', 'CHECK_UPDATE', 'CREATE_RENTAL_USER', 'UPDATE_RENTAL_USER', 'DELETE_RENTAL_USER', 'LOCK_DEVICE', 'REBOOT', 'DATA_WIPE', 'SYSTEM_RESET', 'REREGISTER_AGENT']
  if (!allowed.includes(type)) return c.text('命令类型无效', 400)
  const highRisk = isHighRiskDeviceCommand(type)
  if (highRisk && String(form.confirmed || '') !== '1') return c.text('高风险命令必须二次确认', 400)
  const payload = type === 'SHOW_MESSAGE' ? JSON.stringify({ title: String(form.title || '租赁通知').slice(0, 120), message: String(form.message || '').slice(0, 500) }) : '{}'
  if (type === 'SHOW_MESSAGE' && !JSON.parse(payload).message) return c.text('通知内容不能为空', 400)
  // Idempotency: an explicit key from the caller, otherwise collapse identical
  // rapid re-submits (double-click / retried POST) into one queued command by
  // bucketing to a 10s window. ON CONFLICT DO NOTHING keeps it exactly-once.
  const explicitKey = String(form.idempotencyKey || '').trim().slice(0, 160)
  const idempotencyKey = explicitKey || `dc-${c.req.param('id')}-${type}-${payload.slice(0, 80)}-${Math.floor(Date.now() / 10000)}`.slice(0, 200)
  // Commands must remain available while a device is briefly offline. The
  // client will claim and complete them as soon as its next poll succeeds.
  const expiryHours = 24
  const inserted = await c.env.RENT.prepare("INSERT INTO device_commands (id, device_id, command_type, payload, created_by, expires_at, idempotency_key) VALUES (?, ?, ?, ?, ?, datetime('now', ?), ?) ON CONFLICT(idempotency_key) DO NOTHING").bind(`cmd-${nanoid(12)}`, c.req.param('id'), type, payload, user.id, `+${expiryHours} hours`, idempotencyKey).run() as any
  if (!Number(inserted.meta?.changes ?? inserted.changes ?? 0)) {
    return c.redirect(`/admin/devices/${encodeURIComponent(c.req.param('id'))}/control?success=相同命令已在队列中，未重复下发`)
  }
  await createAuditLog(c, { actor: user, action: 'REMOTE_COMMAND_QUEUED', targetType: 'DEVICE', targetId: c.req.param('id'), after: { commandType: type, highRisk }, reason: highRisk ? '已二次确认高风险远程命令' : undefined })
  return c.redirect(`/admin/devices/${encodeURIComponent(c.req.param('id'))}/control?success=命令已发送，设备下次同步时执行`)
})

app.post('/admin/devices/:id/maintenance', async (c) => {
  const user = c.get('user')
  if (!user || user.role !== 'ADMIN') return c.html(renderForbidden(), 403)
  const device = await getDeviceById(c, c.req.param('id'))
  if (!device) return c.text('设备不存在', 404)
  const form = await c.req.parseBody()
  const description = String(form.description || '').trim()
  const type = String(form.type || 'RETURN_PREPARATION').trim().slice(0, 60)
  if (!description) return c.text('维护说明不能为空', 400)
  const id = `mnt-${nanoid(12)}`
  await c.env.RENT.batch([
    c.env.RENT.prepare("INSERT INTO maintenance_records (id, device_id, maintenance_type, status, description, technician, notes, created_by) VALUES (?, ?, ?, 'OPEN', ?, ?, ?, ?)").bind(id, device.id, type, description, String(form.technician || '').trim() || null, String(form.notes || '').trim() || null, user.id),
    c.env.RENT.prepare("UPDATE devices SET status = 'maintenance', device_mode = 'maintenance' WHERE id = ?").bind(device.id),
  ])
  await recordDeviceLifecycle(c, device.id, 'MAINTENANCE', { reason: description, changedBy: user.id })
  await createAuditLog(c, { actor: user, action: 'MAINTENANCE_CREATED', targetType: 'MAINTENANCE_RECORD', targetId: id, after: { deviceId: device.id, type, status: 'OPEN' }, reason: description })
  return c.redirect(`/admin/devices/${device.id}/control`, 303)
})

// 一步到位的"验收"：把新建维护记录→推进四个阶段→逐项打勾→完成维护这一串操作
// 合并成单个表单提交，覆盖归还状况良好、不需要真正维修的常见情况。只要十项
// 验证全部通过，设备当场回到 READY；只要有一项不通过，就落到跟详细流程完全
// 一致的 CLIENT_CHECK 维护记录上，管理员可以去设备详情页继续处理未通过的项目。
// 独立成单独页面（而不是塞进设备远程控制页），点「去验收」直接落地到这个表单。
app.get('/admin/devices/:id/accept', async (c) => {
  const user = await findUserBySession(c, c.req.header('cookie') ?? null)
  if (!user || !['STAFF', 'ADMIN'].includes(user.role)) return c.redirect('/login')
  const device = await getDeviceById(c, c.req.param('id'))
  if (!device) return c.redirect('/admin/devices')
  const activeOrder = await c.env.RENT.prepare("SELECT id FROM orders WHERE deviceId = ? AND status IN ('paid','active','pending_pickup','extended','overdue','suspended') LIMIT 1").bind(device.id).first()
  const openMaintenance = await c.env.RENT.prepare("SELECT id FROM maintenance_records WHERE device_id = ? AND status IN ('OPEN','IN_PROGRESS','DATA_CLEAN','SYSTEM_RESET','CLIENT_CHECK') LIMIT 1").bind(device.id).first()
  const blockedReason = activeOrder ? '该设备仍关联进行中的租赁订单，暂时不能验收。' : openMaintenance ? '该设备已有进行中的维护记录，请先处理。' : undefined
  return c.html(pages.renderAdminDeviceAccept(user, device, [...MAINTENANCE_CHECK_TYPES], blockedReason, c.req.query('success')))
})

app.post('/admin/devices/:id/accept', async (c) => {
  const user = c.get('user')
  if (!user || !['STAFF', 'ADMIN'].includes(user.role)) return c.html(renderForbidden(), 403)
  const device = await getDeviceById(c, c.req.param('id'))
  if (!device) return c.text('设备不存在', 404)
  const activeOrder = await c.env.RENT.prepare("SELECT id FROM orders WHERE deviceId = ? AND status IN ('paid','active','pending_pickup','extended','overdue','suspended') LIMIT 1").bind(device.id).first()
  if (activeOrder) return c.text('该设备仍关联进行中的租赁订单，不能验收', 409)
  const openMaintenance = await c.env.RENT.prepare("SELECT id FROM maintenance_records WHERE device_id = ? AND status IN ('OPEN','IN_PROGRESS','DATA_CLEAN','SYSTEM_RESET','CLIENT_CHECK') LIMIT 1").bind(device.id).first()
  if (openMaintenance) return c.text('该设备已有进行中的维护记录，请去设备详情页继续处理', 409)
  const form = await c.req.parseBody()
  const results: Record<string, boolean> = {}
  for (const type of MAINTENANCE_CHECK_TYPES) {
    const value = String(form[`check_${type}`] || '')
    if (value !== '1' && value !== '0') return c.text(`验证项 ${type} 结果无效`, 400)
    results[type] = value === '1'
  }
  const allPassed = Object.values(results).every(Boolean)
  const notes = String(form.notes || '').trim().slice(0, 1000) || null
  const technician = String(form.technician || '').trim().slice(0, 200) || null
  const id = `mnt-${nanoid(12)}`
  const now = new Date().toISOString()
  const statements = [
    c.env.RENT.prepare(
      `INSERT INTO maintenance_records (id, device_id, maintenance_type, status, description, technician, notes, created_by, completed_at)
       VALUES (?, ?, 'RETURN_PREPARATION', ?, ?, ?, ?, ?, ?)`
    ).bind(id, device.id, allPassed ? 'COMPLETED' : 'CLIENT_CHECK', allPassed ? '一键验收，十项验证全部通过' : '一键验收，部分验证项未通过，转入维护', technician, notes, user.id, allPassed ? now : null),
    ...MAINTENANCE_CHECK_TYPES.map(type => c.env.RENT.prepare(
      'INSERT INTO maintenance_preparation_checks (id, maintenance_id, check_type, passed, verified_by) VALUES (?, ?, ?, ?, ?)'
    ).bind(`mpc-${nanoid(12)}`, id, type, results[type] ? 1 : 0, user.id)),
  ]
  statements.push(c.env.RENT.prepare("UPDATE devices SET status = ?, device_mode = ? WHERE id = ?").bind(allPassed ? 'available' : 'maintenance', allPassed ? 'normal' : 'maintenance', device.id))
  await c.env.RENT.batch(statements)
  await recordDeviceLifecycle(c, device.id, allPassed ? 'READY' : 'MAINTENANCE', { orderId: undefined, reason: allPassed ? '一键验收，十项验证全部通过' : '一键验收发现未通过项，转入维护', changedBy: user.id })
  await createAuditLog(c, { actor: user, action: 'DEVICE_RETURN_ACCEPTED', targetType: 'MAINTENANCE_RECORD', targetId: id, after: { deviceId: device.id, allPassed, results }, reason: notes || undefined })
  return c.redirect(`/admin/devices/${device.id}/accept?success=${encodeURIComponent(allPassed ? '验收通过，设备已可租' : '验收发现未通过项，设备已转入维护')}`, 303)
})

app.post('/admin/maintenance/:id/advance', async (c) => {
  const user = c.get('user')
  if (!user || user.role !== 'ADMIN') return c.html(renderForbidden(), 403)
  const record = await c.env.RENT.prepare("SELECT * FROM maintenance_records WHERE id = ? AND status NOT IN ('COMPLETED','FAILED')").bind(c.req.param('id')).first() as any
  if (!record) return c.text('维护记录不存在或已结束', 409)
  // CLIENT_CHECK is the last phase; completing it manually is only allowed once
  // every one of the ten return-preparation checks has been recorded as passed
  // (完善.md — "完成维护前禁止进入 READY").
  if (record.status === 'CLIENT_CHECK') {
    const passed = await c.env.RENT.prepare('SELECT COUNT(*) AS n FROM maintenance_preparation_checks WHERE maintenance_id = ? AND passed = 1').bind(record.id).first() as any
    if (Number(passed?.n || 0) < 10) return c.text(`还有 ${10 - Number(passed?.n || 0)} 项设备验证未通过，不能完成维护`, 409)
    const manualRelist = record.maintenance_type === 'REPAIR'
    await c.env.RENT.batch([
      c.env.RENT.prepare("UPDATE maintenance_records SET status = 'COMPLETED', completed_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'CLIENT_CHECK'").bind(record.id),
      c.env.RENT.prepare('UPDATE devices SET status = ?, device_mode = ? WHERE id = ?').bind(manualRelist ? 'maintenance' : 'available', manualRelist ? 'maintenance' : 'normal', record.device_id),
    ])
    await recordDeviceLifecycle(c, record.device_id, manualRelist ? 'MAINTENANCE' : 'READY', { reason: '维护完成，十项设备验证通过', changedBy: user.id })
    await createAuditLog(c, { actor: user, action: 'MAINTENANCE_ADVANCED', targetType: 'MAINTENANCE_RECORD', targetId: record.id, before: { status: 'CLIENT_CHECK' }, after: { status: 'COMPLETED' } })
    return c.redirect(`/admin/devices/${record.device_id}/${manualRelist ? 'relist' : 'control'}`, 303)
  }
  const next = ({ OPEN: 'IN_PROGRESS', IN_PROGRESS: 'DATA_CLEAN', DATA_CLEAN: 'SYSTEM_RESET', SYSTEM_RESET: 'CLIENT_CHECK' } as Record<string, string>)[record.status]
  if (!next) return c.text('维护状态无效', 409)
  await c.env.RENT.prepare("UPDATE maintenance_records SET status = ? WHERE id = ?").bind(next, record.id).run()
  if (next === 'CLIENT_CHECK') await c.env.RENT.prepare("INSERT INTO device_commands (id, device_id, command_type, payload, created_by, expires_at) VALUES (?, ?, 'CHECK_UPDATE', '{}', ?, datetime('now', '+24 hours'))").bind(`cmd-${nanoid(12)}`, record.device_id, user.id).run()
  await createAuditLog(c, { actor: user, action: 'MAINTENANCE_ADVANCED', targetType: 'MAINTENANCE_RECORD', targetId: record.id, before: { status: record.status }, after: { status: next } })
  return c.redirect(`/admin/devices/${record.device_id}/control`, 303)
})

app.post('/admin/maintenance/:id/update', async (c) => {
  const user = c.get('user')
  if (!user || !['MANAGER', 'ADMIN'].includes(getAccessLevel(user))) return c.html(renderForbidden(), 403)
  const record = await c.env.RENT.prepare('SELECT * FROM maintenance_records WHERE id = ?').bind(c.req.param('id')).first() as any
  if (!record) return c.text('维护记录不存在', 404)
  const form = await c.req.parseBody()
  const cost = Number(form.cost)
  if (form.cost !== undefined && form.cost !== '' && (!Number.isFinite(cost) || cost < 0)) return c.text('维修成本必须是非负数字', 400)
  // Absent or blank field -> null, which COALESCE(?, col) leaves untouched.
  const text = (key: string, max = 1000): string | null => { const v = form[key]; return v == null ? null : (String(v).trim().slice(0, max) || null) }
  const invoiceUrl = text('invoiceUrl', 500)
  if (invoiceUrl) { try { validateHostedImageUrls(invoiceUrl, 1) } catch { return c.text('发票 / 附件链接必须是公开 HTTPS 链接', 400) } }
  await c.env.RENT.prepare(
    `UPDATE maintenance_records SET
       cost = COALESCE(?, cost), vendor = COALESCE(?, vendor), invoice_url = COALESCE(?, invoice_url),
       technician = COALESCE(?, technician), replacement_parts = COALESCE(?, replacement_parts),
       repair_notes = COALESCE(?, repair_notes), data_wipe_method = COALESCE(?, data_wipe_method), notes = COALESCE(?, notes)
     WHERE id = ?`,
  ).bind(
    form.cost === undefined || form.cost === '' ? null : Number(cost.toFixed(2)),
    text('vendor', 200), invoiceUrl, text('technician', 200), text('replacementParts'), text('repairNotes'),
    text('dataWipeMethod', 200), text('notes'), record.id,
  ).run()
  await createAuditLog(c, { actor: user, action: 'MAINTENANCE_UPDATED', targetType: 'MAINTENANCE_RECORD', targetId: record.id, before: { cost: record.cost, vendor: record.vendor }, after: { cost: form.cost ?? record.cost } })
  return c.redirect(`/admin/devices/${record.device_id}/control`, 303)
})

app.post('/admin/devices/:id/retire', async (c) => {
  const user = await findUserBySession(c, c.req.header('cookie') ?? null)
  if (!user || !['MANAGER', 'ADMIN'].includes(getAccessLevel(user))) return c.redirect('/login')
  const device = await getDeviceById(c, c.req.param('id')) as any
  if (!device) return c.text('设备不存在', 404)
  const form = await c.req.parseBody()
  const reason = String(form.reason || '').trim().slice(0, 500)
  if (!reason) return c.text('退役设备必须填写原因', 400)
  const activeRental = await c.env.RENT.prepare("SELECT id FROM orders WHERE deviceId = ? AND status IN ('paid','active','pending_pickup','pending_return','extended','overdue','suspended') LIMIT 1").bind(device.id).first()
  if (activeRental) return c.text('该设备还有进行中的订单，不能退役', 409)
  const currentLifecycle = String(device.lifecycle_status || device.lifecycleStatus || 'READY')
  if (!canTransitionDeviceLifecycle(currentLifecycle, 'RETIRED') && String(form.force || '') !== '1') {
    return c.text(`当前生命周期为 ${currentLifecycle}，通常应先进入维护 / 损坏处理再退役；如确需强制退役请勾选强制。`, 409)
  }
  await c.env.RENT.prepare("UPDATE maintenance_records SET status = 'FAILED', failure_reason = COALESCE(failure_reason, '设备退役'), completed_at = CURRENT_TIMESTAMP WHERE device_id = ? AND status IN ('OPEN','IN_PROGRESS','DATA_CLEAN','SYSTEM_RESET','CLIENT_CHECK')").bind(device.id).run()
  await recordDeviceLifecycle(c, device.id, 'RETIRED', { reason, changedBy: user.id })
  await createAuditLog(c, { actor: user, action: 'DEVICE_RETIRED', targetType: 'DEVICE', targetId: device.id, before: { lifecycle: currentLifecycle }, after: { lifecycle: 'RETIRED' }, reason })
  return c.redirect(`/admin/devices/${encodeURIComponent(device.id)}/control?success=设备已退役`, 303)
})

app.post('/admin/maintenance/:id/checks', async (c) => {
  const user = c.get('user')
  if (!user || user.role !== 'ADMIN') return c.html(renderForbidden(), 403)
  const record = await c.env.RENT.prepare("SELECT * FROM maintenance_records WHERE id = ? AND status IN ('DATA_CLEAN','SYSTEM_RESET','CLIENT_CHECK')").bind(c.req.param('id')).first() as any
  if (!record) return c.text('维护记录不在可验证阶段', 409)
  const form = await c.req.parseBody()
  const checkType = String(form.checkType || '')
  const passed = String(form.passed || '') === '1'
  const allowed = new Set(['DATA_WIPE', 'SYSTEM_RESET', 'WINDOWS_BOOT', 'AGENT_INSTALLED', 'AGENT_VERSION', 'DEVICE_SERIAL', 'DISK_HEALTH', 'NETWORK', 'HARDWARE', 'ACCESSORIES'])
  if (!allowed.has(checkType)) return c.text('维护检查项无效', 400)
  await c.env.RENT.prepare('INSERT INTO maintenance_preparation_checks (id, maintenance_id, check_type, passed, details, verified_by) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(maintenance_id, check_type) DO UPDATE SET passed = excluded.passed, details = excluded.details, verified_by = excluded.verified_by, verified_at = CURRENT_TIMESTAMP').bind(`mpc-${nanoid(12)}`, record.id, checkType, passed ? 1 : 0, String(form.details || '').trim().slice(0, 1000) || null, user.id).run()
  await createAuditLog(c, { actor: user, action: 'MAINTENANCE_CHECK_RECORDED', targetType: 'MAINTENANCE_RECORD', targetId: record.id, after: { checkType, passed } })
  return c.redirect(`/admin/devices/${record.device_id}/control`, 303)
})

app.post('/admin/devices/:id/edit', async (c) => {
  const user = await findUserBySession(c, c.req.header('cookie') ?? null)
  if (!user || user.role !== 'ADMIN') {
    return c.redirect('/login')
  }
  const body = await c.req.text()
  const form = parseFormBody(body)
  let dates: string[]
  try { dates = parseUnavailableDates(String(form.unavailableDates || '')) }
  catch (error) { return c.text(error instanceof Error ? error.message : '不可用日期格式无效', 400) }
  if (![form.name, form.brand, form.model, form.serialNumber].every(value => value?.trim())) return c.text('请完整填写设备名称、品牌、型号和序列号', 400)
  if (!Number.isFinite(Number(form.pricePerDay)) || Number(form.pricePerDay) < 0 || !Number.isFinite(Number(form.depositAmount)) || Number(form.depositAmount) < 0) return c.text('日租金和押金必须是有效的非负金额', 400)
  const weeklyDiscountPercent = parseDeviceDiscountPercent(form.weeklyDiscountPercent)
  const monthlyDiscountPercent = parseDeviceDiscountPercent(form.monthlyDiscountPercent)
  if (weeklyDiscountPercent === null || monthlyDiscountPercent === null) return c.text('周租和月租折扣必须是 0%–100% 之间的数字', 400)
  const minimumRentalDays = String(form.minimumRentalDays || '').trim() ? Number(form.minimumRentalDays) : null
  const bufferDays = String(form.bufferDays || '').trim() ? Number(form.bufferDays) : null
  if ((minimumRentalDays !== null && (!Number.isInteger(minimumRentalDays) || minimumRentalDays < 1)) || (bufferDays !== null && (!Number.isInteger(bufferDays) || bufferDays < 0))) return c.text('设备最短租赁天数必须为至少 1 天，缓冲天数必须为非负整数', 400)
  if (!['available', 'rented', 'maintenance', 'retired'].includes(form.status || 'available')) return c.text('设备状态无效', 400)
  if (form.lifecycleStatus && !['RESERVED', 'READY', 'RENTED', 'RETURNED', 'INSPECTION', 'MAINTENANCE', 'DAMAGED', 'RETIRED'].includes(form.lifecycleStatus)) return c.text('设备生命周期状态无效', 400)
  if (!['unregistered', 'online', 'offline', 'paused'].includes(form.agentStatus || 'unregistered')) return c.text('代理状态无效', 400)
  if (!['normal', 'return', 'maintenance', 'lost'].includes(form.deviceMode || 'normal')) return c.text('客户设备状态无效', 400)
  // 完善.md：设备还有未完成的维护记录时，不能被标记为可用 / READY。
  if ((form.status === 'available' || form.lifecycleStatus === 'READY')) {
    const openMaintenance = await c.env.RENT.prepare("SELECT id FROM maintenance_records WHERE device_id = ? AND status IN ('OPEN','IN_PROGRESS','DATA_CLEAN','SYSTEM_RESET','CLIENT_CHECK') LIMIT 1").bind(c.req.param('id')).first()
    if (openMaintenance) return c.text('该设备还有未完成的维护记录，完成维护后才能标记为可用', 409)
  }
  const deviceBefore = await getDeviceById(c, c.req.param('id')) as any
  await updateDevice(c, c.req.param('id'), {
    name: form.name,
    category: form.category || '其他',
    brand: form.brand,
    model: form.model,
    serialNumber: form.serialNumber,
    cpu: form.cpu,
    ram: form.ram,
    storage: form.storage,
    gpu: form.gpu,
    os: form.os,
    pricePerDay: Number(form.pricePerDay),
    depositAmount: Number(form.depositAmount),
    weeklyDiscountPercent,
    monthlyDiscountPercent,
    weeklyDiscountOverride: String(form.weeklyDiscountPercent ?? '').trim() ? weeklyDiscountPercent : null,
    monthlyDiscountOverride: String(form.monthlyDiscountPercent ?? '').trim() ? monthlyDiscountPercent : null,
    minimumRentalDays,
    bufferDays,
    demoMode: form.demoMode === '1',
    status: form.status as any,
    agentStatus: form.agentStatus as any,
    deviceMode: form.deviceMode as any,
    description: form.description || form.remark
  })
  if (form.lifecycleStatus) await recordDeviceLifecycle(c, c.req.param('id'), form.lifecycleStatus as any, { reason: '管理员手动更新设备生命周期', changedBy: user.id })
  if (deviceBefore && (deviceBefore.status !== form.status || deviceBefore.agent_status !== form.agentStatus || deviceBefore.device_mode !== form.deviceMode)) {
    await createAuditLog(c, {
      actor: user, action: 'DEVICE_STATUS_CHANGED', targetType: 'DEVICE', targetId: c.req.param('id'),
      before: { status: deviceBefore.status, agentStatus: deviceBefore.agent_status, deviceMode: deviceBefore.device_mode },
      after: { status: form.status, agentStatus: form.agentStatus, deviceMode: form.deviceMode },
    })
  }
  await c.env.RENT.prepare('UPDATE device_unavailable_dates SET deleted_at = CURRENT_TIMESTAMP WHERE device_id = ? AND deleted_at IS NULL').bind(c.req.param('id')).run()
  if (dates.length) await c.env.RENT.batch(dates.map(date => c.env.RENT.prepare('INSERT INTO device_unavailable_dates (device_id, unavailable_date) VALUES (?, ?) ON CONFLICT(device_id, unavailable_date) DO UPDATE SET deleted_at = NULL').bind(c.req.param('id'), date)))
  const allowedDeviceTimeSlots = new Set(['morning_service', 'morning', 'afternoon', 'evening_service', 'delivery_morning', 'delivery_afternoon'])
  const timeSlots = new Map<string, string[]>()
  for (const line of String(form.unavailableTimeSlots || '').split(/\n+/)) {
    const separator = line.indexOf(':')
    if (separator < 0) continue
    const date = line.slice(0, separator).trim()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue
    const slots = [...new Set(line.slice(separator + 1).split(',').map(value => value.trim()).filter(value => allowedDeviceTimeSlots.has(value)))]
    if (slots.length) timeSlots.set(date, slots)
  }
  await c.env.RENT.prepare('UPDATE device_unavailable_time_slots SET deleted_at = CURRENT_TIMESTAMP WHERE device_id = ? AND deleted_at IS NULL').bind(c.req.param('id')).run()
  const timeSlotStatements = [...timeSlots.entries()].flatMap(([date, slots]) => slots.map(slot => c.env.RENT.prepare('INSERT INTO device_unavailable_time_slots (device_id, unavailable_date, time_slot) VALUES (?, ?, ?) ON CONFLICT(device_id, unavailable_date, time_slot) DO UPDATE SET deleted_at = NULL').bind(c.req.param('id'), date, slot)))
  if (timeSlotStatements.length) await c.env.RENT.batch(timeSlotStatements)
  return c.redirect(`/admin/devices/${encodeURIComponent(c.req.param('id'))}/edit?success=设备资料已保存`)
})

app.post('/admin/devices/:id/delete', async (c) => {
  const user = await findUserBySession(c, c.req.header('cookie') ?? null)
  if (!user || user.role !== 'ADMIN') {
    return c.redirect('/login')
  }
  const deleted = await deleteDevice(c, c.req.param('id'))
  if (!deleted) return c.text('设备有进行中的订单，或已被删除', 409)
  return c.redirect('/admin/devices')
})


app.get('/admin/settings/client-features', async (c) => {
  const user = c.get('user')
  if (!user || user.role !== 'ADMIN') return c.html(renderForbidden(),403)
  let settings
  try { settings = await readClientAccess(c.env.RENT) }
  catch(error) { if (!(error instanceof SyntaxError)) throw error; settings=normalizeClientAccess({console:{enabled:false},web:{enabled:false}}) }
  return c.html(pages.renderAdminClientFeatures(user,settings,c.req.query('saved') === '1'))
})
app.post('/admin/settings/client-features',actions.saveClientFeatures)

app.get('/admin/settings', async (c) => {
  const user = await findUserBySession(c, c.req.header('cookie') ?? null)
  if (!user || user.role !== 'ADMIN') {
    return c.redirect('/login')
  }
  await loadSystemSettingsFromDB(c)
  return c.html(pages.renderAdminSettings(user))
})

app.get('/admin/rental-rules', async (c) => {
  const user = c.get('user')
  if (!user || user.role !== 'ADMIN') return c.html(renderForbidden(), 403)
  await loadSystemSettingsFromDB(c)
  return c.html(pages.renderAdminRentalRules(user))
})

app.post('/admin/settings/rental-rules/save', async (c) => {
  const user = c.get('user')
  if (!user || user.role !== 'ADMIN') return c.json({ success: false, error: '无权限' }, 403)
  try { return await actions.handleSaveRentalRules(c) }
  catch (error: any) { return c.json({ success: false, error: error.message || '保存失败' }, 400) }
})

app.get('/admin/api-settings', async (c) => {
  const user = await findUserBySession(c, c.req.header('cookie') ?? null)
  if (!user || user.role !== 'ADMIN') return c.redirect('/login')
  await loadSystemSettingsFromDB(c)
  return c.html(pages.renderAdminApiSettings(user, await getStripeConfigSummary(c), await getNotifyChannelsSummary(c), await getTurnstileConfigSummary(c), await getSquareConfigSummary(c), await getDeliveryConfigSummary(c), await getCloudinaryConfigSummary(c), await getEmailConfigSummary(c), await getTranslationConfigSummary(c)))
})

app.get('/admin/tax-invoice-template', async (c) => {
  const user = await findUserBySession(c, c.req.header('cookie') ?? null)
  if (!user || user.role !== 'ADMIN') return c.redirect('/login')
  await loadSystemSettingsFromDB(c)
  return c.html(pages.renderAdminTaxInvoiceTemplate(user))
})

app.post('/admin/settings/upload-image', async (c) => {
  const user = await findUserBySession(c, c.req.header('cookie') ?? null)
  if (!user || user.role !== 'ADMIN') return c.json({ success: false, error: '无权限' }, 403)
  const form = await c.req.parseBody()
  const kind = String(form.kind || '')
  const folder = kind === 'alipay' ? 'rent/rmb-payment-qr/alipay' : kind === 'wechat' ? 'rent/rmb-payment-qr/wechat' : kind === 'login' ? 'rent/brand/login' : ''
  if (!folder) return c.json({ success: false, error: '不支持的图片类型' }, 400)
  try {
    const url = await uploadCloudinaryImage(form.imageFile, await getCloudinaryRuntimeConfig(c), folder)
    return c.json({ success: true, url })
  } catch (error: any) {
    return c.json({ success: false, error: error?.message || '图片上传失败' }, 400)
  }
})

app.get('/admin/feedback-rewards', async (c) => {
  const user = await findUserBySession(c, c.req.header('cookie') ?? null)
  if (!user || user.role !== 'ADMIN') return c.redirect('/login')
  const rewards = (await c.env.RENT.prepare(`
    SELECT fr.id, fr.customer_id, fr.reward_type, fr.reward_amount, fr.status, fr.failure_reason, fr.issued_at, fr.created_at, u.name AS customer_name
    FROM feedback_rewards fr
    LEFT JOIN users u ON u.id = fr.customer_id
    ORDER BY fr.created_at DESC LIMIT 200
  `).all()).results || []
  return c.html(pages.renderAdminFeedbackRewards(user, rewards as any[]))
})

app.post('/admin/feedback-rewards/:id/retry', async (c) => {
  const user = await findUserBySession(c, c.req.header('cookie') ?? null)
  if (!user || user.role !== 'ADMIN') return c.redirect('/login')
  const result = await actions.retryFeedbackReward(c, c.req.param('id'))
  if (!result.rewarded) return c.text(result.reason === 'not_found' ? '该反馈奖励记录不存在' : result.reason === 'not_retryable' ? '该反馈奖励当前状态不允许重试' : `重试失败：${result.reason}`, 409)
  await createAuditLog(c, { actor: user, action: 'FEEDBACK_REWARD_RETRIED', targetType: 'FEEDBACK_REWARD', targetId: c.req.param('id') })
  return c.redirect('/admin/feedback-rewards')
})

app.get('/admin/feedback-gift-cards', async (c) => {
  const user = await findUserBySession(c, c.req.header('cookie') ?? null)
  if (!user || user.role !== 'ADMIN') return c.redirect('/login')
  const cards = (await c.env.RENT.prepare('SELECT brand, code, amount, status, created_at FROM feedback_gift_cards ORDER BY created_at DESC, id DESC LIMIT 200').all()).results || []
  return c.html(pages.renderAdminFeedbackGiftCards(user, cards as any[]))
})

app.post('/admin/feedback-gift-cards', async (c) => {
  const user = await findUserBySession(c, c.req.header('cookie') ?? null)
  if (!user || user.role !== 'ADMIN') return c.redirect('/login')
  const form = await c.req.parseBody()
  const brand = String(form.brand || '').trim().slice(0, 80)
  const code = String(form.code || '').trim().slice(0, 160)
  const amountText = String(form.amount || '').trim()
  const amount = amountText ? Number(amountText) : null
  if (!brand || !code || (amount !== null && (!Number.isFinite(amount) || amount < 0))) return c.text('请填写有效的礼品卡品牌、兑换码和面值', 400)
  try {
    await c.env.RENT.prepare('INSERT INTO feedback_gift_cards (id, brand, code, amount, created_by) VALUES (?, ?, ?, ?, ?)').bind(`fgc-${nanoid(12)}`, brand, code, amount, user.id).run()
  } catch (error: any) {
    if (String(error?.message || '').toLowerCase().includes('unique')) return c.text('该礼品卡兑换码已存在', 409)
    throw error
  }
  return c.redirect('/admin/feedback-gift-cards')
})

app.post('/admin/notify-channels/test', async (c) => {
  const user = await findUserBySession(c, c.req.header('cookie') ?? null)
  if (!user || user.role !== 'ADMIN') return c.json({ error: '需要管理员权限' }, 403)
  try {
    const title = 'PC Rental 测试推送'
    const message = `这是一条来自管理后台的测试通知，发送人：${user.name || user.email || user.id}。`
    const results = await dispatchChannelAlert(c, { title, message, url: new URL('/admin/settings', c.req.url).toString() }, { force: false })
    const email = String(user.email || '').trim()
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      const { provider, apiKey, from } = await resolveEmailCredentials(c)
      if ((provider !== 'smtp' && !apiKey) || !from) {
        results.push({ channel: `email (${provider})`, ok: false, detail: !from ? '尚未配置发件邮箱' : '尚未配置当前邮件服务商 API Key' })
      } else {
        const sent = await sendTransactionalEmail(c, { to: email, subject: title, text: message })
        results.push({ channel: `email (${provider})`, ok: sent.ok, detail: sent.ok ? `已发送至 ${email}` : (sent.error || '发送失败') })
      }
    } else results.push({ channel: 'email', ok: false, detail: '管理员账户没有有效邮箱，无法发送测试邮件' })
    return c.json({ success: true, results })
  } catch (error: any) {
    return c.json({ error: String(error?.message || error).slice(0, 300) }, 500)
  }
})

function parseCouponFormFields(form: Record<string, any>) {
  const discountType = String(form.discountType || '')
  const discountValue = Number(form.discountValue)
  const maxUses = String(form.maxUses || '').trim() ? Number(form.maxUses) : null
  const maxUsesPerCustomer = String(form.maxUsesPerCustomer || '').trim() ? Number(form.maxUsesPerCustomer) : null
  const maxDiscountAmount = String(form.maxDiscountAmount || '').trim() ? Number(form.maxDiscountAmount) : null
  const minimumOrderAmount = String(form.minimumOrderAmount || '').trim() ? Number(form.minimumOrderAmount) : null
  const rawDeviceIds = form.deviceId != null
    ? (Array.isArray(form.deviceId) ? form.deviceId : [form.deviceId])
    : []
  const deviceId = [...new Set(rawDeviceIds
    .map((value: unknown) => String(value).trim())
    .filter(Boolean))].join(',') || null
  const brand = String(form.brand || '').trim().slice(0, 120) || null
  const configKeyword = String(form.configKeyword || '').trim().slice(0, 120) || null
  const status = ['DRAFT', 'ACTIVE', 'DISABLED'].includes(String(form.status)) ? String(form.status) : 'ACTIVE'
  const allowedComponents = new Set(['RENTAL_FEE', 'DELIVERY_FEE', 'DEPOSIT_FEE'])
  const rawComponents = form.applicableComponents != null
    ? (Array.isArray(form.applicableComponents) ? form.applicableComponents : [form.applicableComponents])
    : (form.applyDeliveryFee ? ['RENTAL_FEE', 'DELIVERY_FEE'] : [])
  const applicableComponents = [...new Set(rawComponents
    .map((value: unknown) => String(value).trim().toUpperCase())
    .filter((value: string) => allowedComponents.has(value)))].join(',') || 'RENTAL_FEE'
  const valid = ['percent', 'fixed'].includes(discountType) && Number.isFinite(discountValue) && discountValue > 0 && !(discountType === 'percent' && discountValue > 100) &&
    (maxUses === null || (Number.isInteger(maxUses) && maxUses >= 1)) &&
    (maxUsesPerCustomer === null || (Number.isInteger(maxUsesPerCustomer) && maxUsesPerCustomer >= 1)) &&
    (maxDiscountAmount === null || (Number.isFinite(maxDiscountAmount) && maxDiscountAmount >= 0)) &&
    (minimumOrderAmount === null || (Number.isFinite(minimumOrderAmount) && minimumOrderAmount >= 0))
  return {
    valid, discountType, discountValue, maxUses, maxUsesPerCustomer, maxDiscountAmount, minimumOrderAmount, deviceId, brand, configKeyword, status,
    applicableComponents,
    newCustomerOnly: form.newCustomerOnly ? 1 : 0,
    stackable: form.stackable ? 1 : 0,
    restoreOnCancellation: form.restoreOnCancellation ? 1 : 0,
    startsAt: String(form.startsAt || '').replace('T', ' ') || null,
    expiresAt: String(form.expiresAt || '').replace('T', ' ') || null,
  }
}

app.post('/admin/coupons', async (c) => {
  const admin = await findUserBySession(c, c.req.header('cookie') ?? null)
  if (!admin || admin.role !== 'ADMIN') return c.redirect('/login')
  const form = await c.req.parseBody()
  const code = String(form.code || '').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 40)
  const fields = parseCouponFormFields(form)
  if (!code || !fields.valid) return c.redirect('/admin/coupons?error=' + encodeURIComponent('请检查优惠码、折扣值和使用次数限制'))
  const couponId = `cp-${nanoid(10)}`
  try {
    await c.env.RENT.prepare('INSERT INTO coupons (id, code, discount_type, discount_value, max_uses, starts_at, expires_at, created_by, device_id, brand, config_keyword, max_discount_amount, minimum_order_amount, max_uses_per_customer, new_customer_only, stackable, restore_on_cancellation, status, active, applicable_components) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(couponId, code, fields.discountType, fields.discountValue, fields.maxUses, fields.startsAt, fields.expiresAt, admin.id, fields.deviceId, fields.brand, fields.configKeyword, fields.maxDiscountAmount, fields.minimumOrderAmount, fields.maxUsesPerCustomer, fields.newCustomerOnly, fields.stackable, fields.restoreOnCancellation, fields.status, fields.status === 'ACTIVE' ? 1 : 0, fields.applicableComponents).run()
  } catch (error: any) {
    if (String(error?.message || '').toLowerCase().includes('unique')) return c.redirect('/admin/coupons?error=' + encodeURIComponent('优惠码已存在，请换一个代码'))
    throw error
  }
  await createAuditLog(c, { actor: admin, action: 'COUPON_CREATED', targetType: 'COUPON', targetId: couponId, after: { code, discountType: fields.discountType, discountValue: fields.discountValue, status: fields.status } })
  if (fields.status === 'ACTIVE') {
    const customers = (await getUsers(c)).filter((account: any) => account.role === 'CUSTOMER' && account.status === 'active')
    const formatCouponDate = (value: string | null): string => {
      if (!value) return '长期有效'
      const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/)
      return match ? `${match[1]}年${Number(match[2])}月${Number(match[3])}日` : value
    }
    const discountText = fields.discountType === 'percent'
      ? `${fields.discountValue}% 的折扣`
      : `AUD$${Number(fields.discountValue).toFixed(2)} 的优惠`
    const noticeMessage = [
      '🎉新优惠现已开启！',
      '',
      `使用优惠码 <strong>${code}</strong>，即可享受下次租赁 <strong>${discountText}</strong>。`,
      '',
      `有效期至 <strong>${formatCouponDate(fields.expiresAt)}</strong>`,
    ].join('\n')
    await Promise.all(customers.map((customer: any) => createNotification(c, {
      recipientId: customer.id,
      senderId: admin.id,
      type: 'announcement',
      title: '🎉新优惠现已开启！',
      message: noticeMessage,
      expiresAt: fields.expiresAt,
    })))
  }
  return c.redirect('/admin/coupons?success=' + encodeURIComponent('优惠码创建成功'))
})

app.get('/admin/coupons/:id/edit', async (c) => {
  const admin = await findUserBySession(c, c.req.header('cookie') ?? null)
  if (!admin || admin.role !== 'ADMIN') return c.redirect('/login')
  const coupon = await c.env.RENT.prepare('SELECT * FROM coupons WHERE id = ? AND deleted_at IS NULL').bind(c.req.param('id')).first() as any
  if (!coupon) return c.html(renderNotFound(), 404)
  const devices = (await c.env.RENT.prepare('SELECT id, name, brand, model FROM devices WHERE deleted_at IS NULL ORDER BY name').all()).results || []
  return c.html(pages.renderAdminCouponEdit(admin, coupon, devices as any[]))
})

app.post('/admin/coupons/:id', async (c) => {
  const admin = await findUserBySession(c, c.req.header('cookie') ?? null)
  if (!admin || admin.role !== 'ADMIN') return c.redirect('/login')
  const coupon = await c.env.RENT.prepare('SELECT * FROM coupons WHERE id = ? AND deleted_at IS NULL').bind(c.req.param('id')).first() as any
  if (!coupon) return c.text('优惠码不存在', 404)
  const form = await c.req.parseBody()
  const locked = Number(coupon.used_count) > 0
  const fields = parseCouponFormFields(form)
  if (!locked && !fields.valid) return c.redirect(`/admin/coupons/${encodeURIComponent(coupon.id)}/edit?error=` + encodeURIComponent('请检查折扣值和使用次数限制'))
  const discountType = locked ? coupon.discount_type : fields.discountType
  const discountValue = locked ? coupon.discount_value : fields.discountValue
  await c.env.RENT.prepare(`UPDATE coupons SET discount_type = ?, discount_value = ?, max_uses = ?, starts_at = ?, expires_at = ?, device_id = ?, brand = ?, config_keyword = ?, max_discount_amount = ?, minimum_order_amount = ?, max_uses_per_customer = ?, new_customer_only = ?, stackable = ?, restore_on_cancellation = ?, status = ?, active = ?, applicable_components = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND deleted_at IS NULL`)
    .bind(discountType, discountValue, fields.maxUses, fields.startsAt, fields.expiresAt, fields.deviceId, fields.brand, fields.configKeyword, fields.maxDiscountAmount, fields.minimumOrderAmount, fields.maxUsesPerCustomer, fields.newCustomerOnly, fields.stackable, fields.restoreOnCancellation, fields.status, fields.status === 'ACTIVE' ? 1 : 0, fields.applicableComponents, admin.id, coupon.id).run()
  await createAuditLog(c, { actor: admin, action: 'COUPON_UPDATED', targetType: 'COUPON', targetId: coupon.id, before: { discountType: coupon.discount_type, discountValue: coupon.discount_value, status: coupon.status }, after: { discountType, discountValue, status: fields.status } })
  return c.redirect('/admin/coupons?success=' + encodeURIComponent('优惠码已更新'))
})

app.post('/admin/coupons/:id/delete', async (c) => {
  const admin = await findUserBySession(c, c.req.header('cookie') ?? null)
  if (!admin || admin.role !== 'ADMIN') return c.redirect('/login')
  const coupon = await c.env.RENT.prepare('SELECT id FROM coupons WHERE id = ? AND deleted_at IS NULL').bind(c.req.param('id')).first() as any
  if (!coupon) return c.redirect('/admin/coupons?error=' + encodeURIComponent('优惠码不存在'))
  await c.env.RENT.prepare("UPDATE coupons SET deleted_at = CURRENT_TIMESTAMP, active = 0, status = 'DISABLED', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND deleted_at IS NULL").bind(c.req.param('id')).run()
  return c.redirect('/admin/coupons?success=' + encodeURIComponent('优惠码已删除'))
})

app.post('/admin/coupons/:id/toggle', async (c) => {
  const admin = await findUserBySession(c, c.req.header('cookie') ?? null)
  if (!admin || admin.role !== 'ADMIN') return c.redirect('/login')
  const before = await c.env.RENT.prepare('SELECT active, status FROM coupons WHERE id = ? AND deleted_at IS NULL').bind(c.req.param('id')).first() as any
  if (!before) return c.redirect('/admin/coupons?error=' + encodeURIComponent('优惠码不存在'))
  await c.env.RENT.prepare("UPDATE coupons SET active = CASE active WHEN 1 THEN 0 ELSE 1 END, status = CASE active WHEN 1 THEN 'DISABLED' ELSE 'ACTIVE' END, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND deleted_at IS NULL").bind(c.req.param('id')).run()
  await createAuditLog(c, { actor: admin, action: before.active ? 'COUPON_DISABLED' : 'COUPON_ENABLED', targetType: 'COUPON', targetId: c.req.param('id'), before: { active: Boolean(before.active), status: before.status }, after: { active: !before.active, status: before.active ? 'DISABLED' : 'ACTIVE' } })
  return c.redirect('/admin/coupons')
})

app.get('/admin/templates', async (c) => {
  const user = await findUserBySession(c, c.req.header('cookie') ?? null)
  if (!user || user.role !== 'ADMIN') return c.redirect('/login')
  return c.html(pages.renderAdminTemplateHub(user))
})

app.get('/admin/templates/preview', async (c) => {
  const user = await findUserBySession(c, c.req.header('cookie') ?? null)
  if (!user || user.role !== 'ADMIN') return c.redirect('/login')
  await loadSystemSettingsFromDB(c)
  return c.redirect('/admin/templates/preview/agreements')
})

app.get('/admin/templates/preview/:previewKind', async (c) => {
  const user = await findUserBySession(c, c.req.header('cookie') ?? null)
  if (!user || user.role !== 'ADMIN') return c.redirect('/login')
  const previewKind = c.req.param('previewKind')
  if (!['agreements', 'contract'].includes(previewKind)) return c.html(renderNotFound(), 404)
  await loadSystemSettingsFromDB(c)
  return c.html(await pages.renderAdminTemplatePreview(user, c, previewKind))
})

// 可在 /admin/templates 编辑的协议：kind → D1 设置键 + 站内信/邮件里显示的名称。
const EDITABLE_AGREEMENTS: Record<string, { settingKey: SystemSettingsKey; settingKeyEn: SystemSettingsKey; label: string }> = {
  user: { settingKey: 'userTerms', settingKeyEn: 'userTermsEn', label: '用户协议' },
  rental: { settingKey: 'rentalTerms', settingKeyEn: 'rentalTermsEn', label: '租赁协议' },
  service: { settingKey: 'serviceTerms', settingKeyEn: 'serviceTermsEn', label: '服务条款' },
  privacy: { settingKey: 'privacyPolicy', settingKeyEn: 'privacyPolicyEn', label: '隐私政策' },
  software: { settingKey: 'softwareTerms', settingKeyEn: 'softwareTermsEn', label: '软件使用协议' },
  copyright: { settingKey: 'copyrightNotice', settingKeyEn: 'copyrightNoticeEn', label: '退款政策' },
  cookie: { settingKey: 'cookiePolicy', settingKeyEn: 'cookiePolicyEn', label: 'Cookie 政策' },
  complaints: { settingKey: 'complaintsPolicy', settingKeyEn: 'complaintsPolicyEn', label: '投诉与争议解决政策' },
  aup: { settingKey: 'acceptableUsePolicy', settingKeyEn: 'acceptableUsePolicyEn', label: '可接受使用政策' },
  consumer: { settingKey: 'consumerRights', settingKeyEn: 'consumerRightsEn', label: '澳大利亚消费者法下的权利' },
}

app.get('/admin/templates/:kind', async (c) => {
  const user = await findUserBySession(c, c.req.header('cookie') ?? null)
  if (!user || user.role !== 'ADMIN') return c.redirect('/login')
  const kind = c.req.param('kind')
  if (kind === 'contract') return c.html(await pages.renderAdminContracts(c, user))
  if (!(kind in EDITABLE_AGREEMENTS)) return c.html(renderNotFound(), 404)
  await loadSystemSettingsFromDB(c)
  const settingKey = EDITABLE_AGREEMENTS[kind].settingKey
  const settingKeyEn = EDITABLE_AGREEMENTS[kind].settingKeyEn
  const databaseSetting = await c.env.RENT.prepare('SELECT value FROM systemSettings WHERE key = ? AND deleted_at IS NULL').bind(settingKey).first() as any
  const databaseSettingEn = await c.env.RENT.prepare('SELECT value FROM systemSettings WHERE key = ? AND deleted_at IS NULL').bind(settingKeyEn).first() as any
  return c.html(pages.renderAdminAgreementEditor(
    user,
    kind as any,
    databaseSetting?.value !== undefined ? String(databaseSetting.value) : undefined,
    databaseSettingEn?.value !== undefined ? String(databaseSettingEn.value) : undefined,
  ))
})

app.post('/admin/templates/:kind', async (c) => {
  const user = await findUserBySession(c, c.req.header('cookie') ?? null)
  if (!user || user.role !== 'ADMIN') return c.json({ success: false, error: '无权限保存协议' }, 403)
  const kind = c.req.param('kind')
  if (!(kind in EDITABLE_AGREEMENTS)) return c.json({ success: false, error: '未知的协议类型' }, 404)
  try {
    const contentType = c.req.header('content-type') || ''
    const payload = contentType.includes('application/json')
      ? await c.req.json()
      : await c.req.parseBody()
    const content = sanitizeRichHtml(payload?.content || '')
    if (!String(content).trim()) return c.json({ success: false, error: '协议内容不能为空，请填写后再保存' }, 400)
    // English content is an optional, admin-reviewable placeholder translation:
    // unlike the Chinese original, it is allowed to be empty (the public page
    // falls back to a "not provided yet" notice when it is).
    const contentEn = sanitizeRichHtml(payload?.contentEn || '')
    await loadSystemSettingsFromDB(c)
    const settingKey = EDITABLE_AGREEMENTS[kind].settingKey
    const settingKeyEn = EDITABLE_AGREEMENTS[kind].settingKeyEn
    const metadata = getSystemSettings().legalMetadata || {}
    // 直接读取数据库中的正文，避免 isolate 级设置缓存让“未变化”被误判为变化。
    const previous = await c.env.RENT.prepare('SELECT value FROM systemSettings WHERE key = ? AND deleted_at IS NULL').bind(settingKey).first() as any
    const before = sanitizeRichHtml(previous?.value || '')
    const previousEn = await c.env.RENT.prepare('SELECT value FROM systemSettings WHERE key = ? AND deleted_at IS NULL').bind(settingKeyEn).first() as any
    const beforeEn = sanitizeRichHtml(previousEn?.value || '')
    // Either language changing counts as an update worth notifying about —
    // an English-only revision (e.g. fixing the machine-translation placeholder)
    // is still a real change to the published document.
    const contentChanged = before !== content || beforeEn !== contentEn
    const suppliedDate = String(payload?.lastUpdatedDate || '').trim()
    const existingDate = String(metadata?.[kind]?.lastUpdatedDate || '').trim()
    const melbourneToday = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Australia/Melbourne', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date())
    // An unchanged save must not move the document date forward. When the
    // protocol body really changes, an empty date means "today" in Melbourne,
    // not the UTC date returned by toISOString().
    const lastUpdatedDate = /^\d{4}-\d{2}-\d{2}$/.test(suppliedDate)
      ? suppliedDate
      : (contentChanged || !/^\d{4}-\d{2}-\d{2}$/.test(existingDate) ? melbourneToday : existingDate)
    const legalMetadata = { ...metadata, [kind]: { version: String(payload?.version || '1.0').trim().slice(0, 30) || '1.0', lastUpdatedDate } }
    await c.env.RENT.batch([
      c.env.RENT.prepare('INSERT INTO systemSettings (key, value, updatedAt) VALUES (?, ?, CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updatedAt = CURRENT_TIMESTAMP, deleted_at = NULL').bind(settingKey, content),
      c.env.RENT.prepare('INSERT INTO systemSettings (key, value, updatedAt) VALUES (?, ?, CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updatedAt = CURRENT_TIMESTAMP, deleted_at = NULL').bind(settingKeyEn, contentEn),
      c.env.RENT.prepare('INSERT INTO systemSettings (key, value, updatedAt) VALUES (?, ?, CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updatedAt = CURRENT_TIMESTAMP, deleted_at = NULL').bind('legalMetadata', JSON.stringify(legalMetadata)),
    ])
    const saved = await c.env.RENT.prepare('SELECT value FROM systemSettings WHERE key = ? AND deleted_at IS NULL').bind(settingKey).first() as any
    if (String(saved?.value ?? '') !== content) throw new Error('协议保存校验失败，请重试')
    invalidateSystemSettingsCache()
    await loadSystemSettingsFromDB(c)
    if (contentChanged) {
      // 这里只排队，不在保存请求中创建通知或发送邮件；定时任务会把窗口内的协议变更合并发送。
      const notifyPayload: Array<[string, string]> = [[settingKey, EDITABLE_AGREEMENTS[kind].label]]
      await notifyAgreementUpdate(c, notifyPayload, undefined, content)
    }
    return contentType.includes('application/json') ? c.json({ success: true }) : c.redirect(`/admin/templates/${kind}`)
  } catch (error: any) {
    return c.json({ success: false, error: error?.message || '协议保存失败' }, 400)
  }
})

app.post('/admin/template-preview', async (c) => {
  const user = await findUserBySession(c, c.req.header('cookie') ?? null)
  if (!user || user.role !== 'ADMIN') return c.json({ success: false, error: '无权限预览' }, 403)
  try {
    const payload = await c.req.json()
    const kind = String(payload?.kind || '').trim()
    const content = String(payload?.content || '')
    if (!content) return c.json({ success: false, error: '缺少内容' }, 400)
    await loadSystemSettingsFromDB(c)
    let html = ''
    if (kind === 'rental') {
      const sampleContract = {
        id: 'sample-contract',
        rentalId: 'sample-order',
        contractNumber: 'CTR-0001',
        content,
        signedAt: null,
        status: 'pending_sign',
        contract_data: {
          customer_name: '测试客户',
          customer_email: 'test@example.com',
          customer_phone: '0412345678',
          customer_address: '墨尔本 VIC',
          device_name: 'MacBook Pro',
          device_model: 'M2',
          device_sn: 'SN123456',
          pickup_location: '市中心门店',
          return_location: '市中心门店',
          payment_reference: 'REF123456',
        }
      } as any
      const sampleOrder = {
        id: 'sample-order',
        orderNo: 'OD20260806',
        deviceId: 'device-1',
        startDate: '2026-08-10',
        endDate: '2026-08-15',
        rentalPeriod: 5,
        totalAmount: 1500,
        depositAmount: 300,
        dailyRate: 240,
        paymentMethod: 'card',
        status: 'pending_payment',
      } as any
      const sampleDevice = {
        id: 'device-1',
        name: 'MacBook Pro',
        brand: 'Apple',
        model: 'M2',
        serialNumber: 'SN123456',
        cpu: 'M2',
        ram: '16GB',
        storage: '512GB',
        gpu: 'Apple',
        os: 'macOS Ventura',
      } as any
      const sampleCustomer = {
        name: '测试客户',
        email: 'test@example.com',
        phone: '0412345678',
      } as any
      const sampleExtra = {
        payment_date: '2026-08-08',
        payment_reference: 'REF123456',
        contract_url: 'https://example.com/contract/CTR-0001',
        invoice_url: 'https://example.com/invoice/INV-0001',
      }
      html = renderContractVariables(content, sampleContract, sampleOrder, sampleDevice, sampleCustomer, sampleExtra, true)
    } else if (kind === 'contract') {
      const sampleContract = {
        id: 'sample-contract',
        rentalId: 'sample-order',
        contractNumber: 'CTR-0001',
        content,
        signedAt: '2026-08-08T10:00:00.000Z',
        status: 'signed',
        contract_data: {
          customer_name: '测试客户',
          customer_email: 'test@example.com',
          customer_phone: '0412345678',
          customer_address: '墨尔本 VIC',
          device_name: 'MacBook Pro',
          device_model: 'M2',
          device_sn: 'SN123456',
          pickup_location: '市中心门店',
          return_location: '市中心门店',
          payment_reference: 'REF123456',
        }
      } as any
      const sampleOrder = {
        id: 'sample-order',
        orderNo: 'OD20260806',
        deviceId: 'device-1',
        startDate: '2026-08-10',
        endDate: '2026-08-15',
        rentalPeriod: 5,
        totalAmount: 1500,
        depositAmount: 300,
        dailyRate: 240,
        paymentMethod: 'card',
        status: 'completed',
      } as any
      const sampleDevice = {
        id: 'device-1',
        name: 'MacBook Pro',
        brand: 'Apple',
        model: 'M2',
        serialNumber: 'SN123456',
        cpu: 'M2',
        ram: '16GB',
        storage: '512GB',
        gpu: 'Apple',
        os: 'macOS Ventura',
      } as any
      const sampleCustomer = {
        name: '测试客户',
        email: 'test@example.com',
        phone: '0412345678',
      } as any
      const sampleExtra = {
        payment_date: '2026-08-08',
        payment_reference: 'REF123456',
        contract_url: 'https://example.com/contract/CTR-0001',
        invoice_url: 'https://example.com/invoice/INV-0001',
      }
      html = renderContractVariables(content, sampleContract, sampleOrder, sampleDevice, sampleCustomer, sampleExtra, true)
    } else if (kind === 'email') {
      html = renderSiteVariables(content, user, {
        order_no: 'OD20260806',
        contract_number: 'CTR-0001',
        device_name: 'MacBook Pro',
        sign_link: 'https://example.com/sign/abc',
        expire_time: '2026-08-15',
      })
    } else {
      html = renderSiteVariables(content, user)
    }
    return c.json({ success: true, html })
  } catch (error: any) {
    return c.json({ success: false, error: error?.message || '预览失败' }, 400)
  }
})

app.post('/admin/settings/save', async (c) => {
  const user = await findUserBySession(c, c.req.header('cookie') ?? null)
  if (!user || user.role !== 'ADMIN') {
    return c.text('无权限', 403)
  }
  try {
    return await actions.handleSaveAdminSettings(c)
  } catch (error: any) {
    return c.json({ success: false, error: error.message || '保存失败' }, 400)
  }
})

app.post('/admin/api-settings/save', async (c) => {
  const user = await findUserBySession(c, c.req.header('cookie') ?? null)
  if (!user || user.role !== 'ADMIN') return c.json({ success: false, error: '无权限' }, 403)
  try {
    return await actions.handleSaveAdminSettings(c)
  } catch (error: any) {
    return c.json({ success: false, error: error.message || '保存失败' }, 400)
  }
})

app.get('/api/address/autocomplete', async (c) => {
  const user = c.get('user')
  if (!user || !['STAFF', 'ADMIN'].includes(user.role)) return c.json({ error: '无权限查询地址' }, 403)
  const input = String(c.req.query('q') || '').trim().slice(0, 120)
  if (input.length < 3) return c.json({ suggestions: [] })
  const headers = { Accept: 'application/json', 'User-Agent': 'PC-Rental/1.0 address search' }
  const cacheUrl = new URL(c.req.url)
  cacheUrl.search = `?q=${encodeURIComponent(input)}&__address_cache_v=2`
  const cacheKey = new Request(cacheUrl.toString(), { method: 'GET' })
  const cache = caches.default
  const cached = await cache.match(cacheKey)
  if (cached) return cached
  const searchController = new AbortController()
  const timeout = setTimeout(() => searchController.abort(), 1800)
  const providers = [
    async (signal: AbortSignal) => {
      const response = await fetch('https://photon.komoot.io/api/?' + new URLSearchParams({ q: `${input}, Melbourne, Victoria, Australia`, limit: '6', lang: 'en' }), { headers, signal })
      if (!response.ok) throw new Error(`Photon ${response.status}`)
      const data = await response.json() as any
      return (data.features || []).map((feature: any) => feature.properties || {})
    },
    async (signal: AbortSignal) => {
      const response = await fetch('https://nominatim.openstreetmap.org/search?' + new URLSearchParams({ q: `${input}, Melbourne, Victoria, Australia`, format: 'jsonv2', addressdetails: '1', limit: '6', countrycodes: 'au' }), { headers, signal })
      if (!response.ok) throw new Error(`Nominatim ${response.status}`)
      const data = await response.json() as any[]
      return data.map((item: any) => ({ ...item.address, osm_type: item.osm_type, osm_id: item.osm_id, display_name: item.display_name }))
    },
  ]
  try {
    const items = await Promise.any(providers.map((provider) => provider(searchController.signal).then((results) => {
      if (!results.length) throw new Error('No address suggestions')
      return results
    })))
    const suggestions = items.slice(0, 6).map((p: any) => {
      const street = [p.housenumber, p.house_number, p.street, p.road].filter(Boolean).join(' ')
      const text = [street, p.city || p.town || p.suburb || p.locality, p.state, p.postcode].filter(Boolean).join(', ') || String(p.display_name || '')
      const placeId = `${p.osm_type || 'osm'}_${p.osm_id || text}`.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 300)
      const stateNames: Record<string, string> = { victoria: 'VIC', vic: 'VIC', 'new south wales': 'NSW', nsw: 'NSW', queensland: 'QLD', qld: 'QLD', 'south australia': 'SA', sa: 'SA', 'western australia': 'WA', wa: 'WA', tasmania: 'TAS', tas: 'TAS', 'northern territory': 'NT', nt: 'NT', 'australian capital territory': 'ACT', act: 'ACT' }
      const rawState = String(p.state || '').trim()
      const state = stateNames[rawState.toLowerCase()] || rawState.toUpperCase()
      return { placeId, text, street, suburb: p.city || p.town || p.suburb || p.locality || '', state, postcode: p.postcode || '', formattedAddress: text }
    }).filter((item: any) => item.placeId && item.text)
    const response = new Response(JSON.stringify({ suggestions }), { status: 200, headers: { 'content-type': 'application/json; charset=UTF-8', 'cache-control': 'public, max-age=300, s-maxage=900' } })
    c.executionCtx.waitUntil(cache.put(cacheKey, response.clone()))
    return response
  } catch (error: any) {
    console.error('Address providers failed:', error?.message || error)
    return c.json({ error: '地址联想暂时不可用，可手工填写地址' }, 502)
  } finally {
    clearTimeout(timeout)
    searchController.abort()
  }
})

app.get('/api/address/details', async (c) => {
  const user = c.get('user')
  if (!user || !['STAFF', 'ADMIN'].includes(user.role)) return c.json({ error: '无权限查询地址' }, 403)
  const apiKey = String(c.env.GOOGLE_MAPS_API_KEY || '')
  if (!apiKey) return c.json({ error: '地址联想尚未配置' }, 503)
  const placeId = String(c.req.query('placeId') || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 300)
  const sessionToken = String(c.req.query('session') || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64)
  if (!placeId) return c.json({ error: '地址标识无效' }, 400)
  const params = new URLSearchParams({ languageCode: 'en', regionCode: 'AU', ...(sessionToken ? { sessionToken } : {}) })
  const response = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}?${params}`, { headers: { 'X-Goog-Api-Key': apiKey, 'X-Goog-FieldMask': 'formattedAddress,addressComponents' } })
  if (!response.ok) {
    console.error('Google address details failed:', response.status)
    return c.json({ error: '无法读取地址详情，请手工填写' }, 502)
  }
  const place = await response.json() as any
  const component = (type: string, short = false) => {
    const item = (place.addressComponents || []).find((entry: any) => entry.types?.includes(type))
    return String((short ? item?.shortText : item?.longText) || '')
  }
  const street = [component('street_number'), component('route')].filter(Boolean).join(' ')
  const suburb = component('locality') || component('postal_town') || component('sublocality_level_1')
  return c.json({ formattedAddress: String(place.formattedAddress || ''), street, suburb, state: component('administrative_area_level_1', true), postcode: component('postal_code') })
})


async function hashAgentValue(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest)).map((item) => item.toString(16).padStart(2, '0')).join('')
}

// monitorApiTokenHash 只在管理员手动轮换时改变，但每个受保护的监控探针请求都要
// 读一次。用 isolate 级短 TTL 缓存把这条 D1 往返从热路径上摘掉；轮换处会主动失效。
let monitorApiTokenHashCache: { value: string | null; loadedAt: number } | null = null
const MONITOR_API_TOKEN_TTL_MS = 30_000

export function invalidateMonitorApiTokenCache(): void {
  monitorApiTokenHashCache = null
}

async function loadMonitorApiTokenHash(c: any): Promise<string | null> {
  if (monitorApiTokenHashCache && Date.now() - monitorApiTokenHashCache.loadedAt < MONITOR_API_TOKEN_TTL_MS) {
    return monitorApiTokenHashCache.value
  }
  const tokenRow = await c.env.RENT.prepare("SELECT value FROM systemSettings WHERE key = 'monitorApiTokenHash' AND deleted_at IS NULL").first() as any
  const value = tokenRow?.value ? String(tokenRow.value) : null
  monitorApiTokenHashCache = { value, loadedAt: Date.now() }
  return value
}

// 监控探针接口只给程序化调用（curl / uptime 检查 / Agent）。用浏览器直接打开这些
// URL 属于误访问 —— 顶层导航（Sec-Fetch-Mode: navigate / Sec-Fetch-Dest: document，
// 或 Accept 里带 text/html）一律跳回主页，而不是把 JSON 错误甩到用户脸上。
function isBrowserNavigation(c: any): boolean {
  // 带 Bearer token 的一律放行 —— 那是程序化调用，哪怕它的 Accept 头长得像浏览器。
  if (parseBearerToken(c.req.header('Authorization'))) return false
  if ((c.req.header('Sec-Fetch-Mode') || '').toLowerCase() === 'navigate') return true
  if ((c.req.header('Sec-Fetch-Dest') || '').toLowerCase() === 'document') return true
  return (c.req.header('Accept') || '').toLowerCase().includes('text/html')
}

async function hasValidMonitorApiToken(c: any): Promise<boolean> {
  const providedToken = parseBearerToken(c.req.header('Authorization'))
  if (!providedToken) return false
  const [storedHash, providedHash] = await Promise.all([
    loadMonitorApiTokenHash(c),
    hashAgentValue(providedToken),
  ])
  return Boolean(storedHash && timingSafeEqualStr(providedHash, storedHash))
}

async function getAgentDevice(c: any): Promise<any | null> {
  const header = String(c.req.header('Authorization') || '')
  if (!header.startsWith('Bearer ')) return null
  return await c.env.RENT.prepare('SELECT * FROM devices WHERE agent_token_hash = ? AND deleted_at IS NULL').bind(await hashAgentValue(header.slice(7).trim())).first()
}

app.post('/api/device-agent/register', async (c) => {
  if (new URL(c.req.url).protocol !== 'https:') return c.json({ ok: false, error: 'HTTPS is required for device registration' }, 400)
  const payload = await c.req.json().catch(() => ({})) as any
  const serialNumber = String(payload.serialNumber || '').trim()
  const setupCode = String(payload.setupCode || '').trim()
  if (!/^\d{6}$/.test(setupCode)) return c.json({ ok: false, error: 'setupCode must be exactly 6 digits' }, 400)
  const setupCodeHash = await hashAgentValue(setupCode)
  const device = await c.env.RENT.prepare('SELECT id, name, serialNumber FROM devices WHERE agent_setup_code_hash = ? AND agent_setup_code_expires_at > CURRENT_TIMESTAMP AND deleted_at IS NULL').bind(setupCodeHash).first() as any
  if (!device) return c.json({ ok: false, error: 'Invalid or expired setup code' }, 401)
  const token = crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '')
  const registration = await c.env.RENT.prepare(`UPDATE devices SET agent_token_hash = ?, agent_setup_code_hash = NULL, agent_setup_code_expires_at = NULL, agent_registered_at = CURRENT_TIMESTAMP, agent_status = 'offline', updatedAt = CURRENT_TIMESTAMP WHERE id = ? AND agent_setup_code_hash = ? AND agent_setup_code_expires_at > CURRENT_TIMESTAMP`).bind(await hashAgentValue(token), device.id, setupCodeHash).run()
  if (!registration.meta?.changes) return c.json({ ok: false, error: 'Invalid or expired setup code' }, 401)
  return c.json({ ok: true, apiBaseUrl: new URL(c.req.url).origin, deviceId: device.id, serialNumber: device.serialNumber, deviceName: device.name, uniqueCode: device.id, token })
})

app.post('/api/device-agent/heartbeat', async (c) => {
  const device = await getAgentDevice(c)
  if (!device) return c.json({ ok: false, error: 'Invalid device token' }, 401)
  const payload = await c.req.json().catch(() => ({})) as any
  await c.env.RENT.prepare(`UPDATE devices SET agent_last_seen_at = CURRENT_TIMESTAMP, agent_last_ip = ?, agent_hostname = ?, agent_os_version = ?, agent_cpu = ?, agent_memory_mb = ?, agent_storage_free_bytes = ?, agent_version = ?, agent_detected_serial = ?, agent_status = 'online', updatedAt = CURRENT_TIMESTAMP WHERE id = ?`).bind(c.req.header('CF-Connecting-IP') || null, payload.hostname || null, payload.osVersion || null, payload.cpu || null, Number.isFinite(payload.memoryMb) ? payload.memoryMb : null, Number.isFinite(payload.storageFreeBytes) ? payload.storageFreeBytes : null, String(payload.version || ''), String(payload.serialNumber || ''), device.id).run()
  return c.json({ ok: true, deviceId: device.id, deviceMode: device.device_mode || 'normal', remoteLockEnabled: Boolean(device.remote_lock_enabled), lockMessage: device.remote_lock_message || null })
})

app.post('/api/device-agent/inspection', async (c) => {
  const device = await getAgentDevice(c)
  if (!device) return c.json({ ok: false, error: 'Invalid device token' }, 401)
  const payload = await c.req.json().catch(() => ({})) as any
  const type = ['before_rental', 'after_return', 'automated_health'].includes(payload.inspectionType) ? payload.inspectionType : 'automated_health'
  const snapshot = JSON.stringify(payload.snapshot || {})
  const previous = await c.env.RENT.prepare('SELECT snapshot_json FROM device_inspections WHERE deleted_at IS NULL AND device_id = ? ORDER BY created_at DESC LIMIT 1').bind(device.id).first() as any
  const before = previous ? JSON.parse(previous.snapshot_json || '{}') : {}
  const current = payload.snapshot || {}
  if (type === 'automated_health' && device.inspection_requested_at) {
    const pendingRentalInspection = await c.env.RENT.prepare("SELECT i.id FROM device_inspections i JOIN orders o ON o.id = i.rental_id WHERE i.deleted_at IS NULL AND i.device_id = ? AND i.inspection_type = 'before_rental' AND o.status = 'draft' ORDER BY i.created_at DESC LIMIT 1").bind(device.id).first() as any
    if (pendingRentalInspection?.id) {
      await c.env.RENT.batch([
        c.env.RENT.prepare('UPDATE device_inspections SET snapshot_json = ?, differences_json = ?, created_at = CURRENT_TIMESTAMP WHERE id = ?').bind(snapshot, JSON.stringify({}), pendingRentalInspection.id),
        c.env.RENT.prepare('UPDATE devices SET inspection_requested_at = NULL WHERE id = ?').bind(device.id),
      ])
      return c.json({ ok: true, inspectionId: pendingRentalInspection.id, updated: true })
    }
  }
  const differences = Object.fromEntries(Object.keys({ ...before, ...current }).filter(key => String(before[key] ?? '') !== String(current[key] ?? '')).map(key => [key, { before: before[key] ?? null, after: current[key] ?? null }]))
  const id = `inspection-${nanoid(12)}`
  if (type === 'automated_health') {
    await c.env.RENT.batch([
      c.env.RENT.prepare("UPDATE device_inspections SET deleted_at = CURRENT_TIMESTAMP WHERE device_id = ? AND inspection_type = 'automated_health' AND date(created_at) < date('now') AND deleted_at IS NULL").bind(device.id),
      c.env.RENT.prepare('INSERT INTO device_inspections (id, device_id, inspection_type, snapshot_json, differences_json) VALUES (?, ?, ?, ?, ?)').bind(id, device.id, type, snapshot, JSON.stringify(differences)),
    ])
  } else {
    await c.env.RENT.prepare('INSERT INTO device_inspections (id, device_id, inspection_type, snapshot_json, differences_json) VALUES (?, ?, ?, ?, ?)').bind(id, device.id, type, snapshot, JSON.stringify(differences)).run()
  }
  if (type === 'automated_health') await c.env.RENT.prepare('UPDATE devices SET inspection_requested_at = NULL WHERE id = ?').bind(device.id).run()
  if (type === 'automated_health' && Number(current.storageFreeBytes) < 10 * 1024 * 1024 * 1024) await c.env.RENT.prepare("INSERT INTO device_health_alerts (id, device_id, alert_type, severity, message) VALUES (?, ?, 'low_storage', 'warning', ?)").bind(`alert-${nanoid(12)}`, device.id, '设备剩余空间低于 10GB').run()
  return c.json({ ok: true, inspectionId: id, differences })
})

app.get('/api/device-agent/state', async (c) => {
  if (isBrowserNavigation(c)) return c.redirect('/', 302)
  try {
    // 设备 token 与监控 token 是互斥的两条鉴权路径，但监控探针（无设备 token）过去要
    // 串行跑 getAgentDevice → hasValidMonitorApiToken → COUNT 三条 D1 往返。并发前两条，
    // 监控 token 已走 isolate 缓存，热路径就只剩一条 COUNT 往返。
    const [device, monitorTokenValid] = await Promise.all([
      getAgentDevice(c),
      hasValidMonitorApiToken(c),
    ])
    if (!device) {
      if (!monitorTokenValid) return c.json({ ok: false, error: 'Invalid token' }, 401, { 'Cache-Control': 'no-store', 'WWW-Authenticate': 'Bearer realm="device-agent-state"' })
      const row = await c.env.RENT.prepare('SELECT COUNT(*) AS bound_devices FROM devices WHERE agent_token_hash IS NOT NULL').first() as any
      return c.json({ ok: true, status: 'ok', service: 'device-agent-state', boundDevices: Number(row?.bound_devices || 0), checkedAt: new Date().toISOString() }, 200, { 'Cache-Control': 'no-store' })
    }
    const rental = await c.env.RENT.prepare(`SELECT o.id, o.startDate AS start_date, o.endDate AS end_date, o.status, COALESCE(o.rental_status, CASE o.status WHEN 'active' THEN 'ACTIVE' WHEN 'paid' THEN 'CONFIRMED' ELSE o.status END) AS rental_status, COALESCE(o.payment_status, CASE WHEN o.status IN ('paid', 'active') THEN 'PAID' ELSE 'UNPAID' END) AS payment_status, u.name AS customer_name FROM orders o LEFT JOIN users u ON u.id = o.userId WHERE o.deviceId = ? AND o.status IN ('paid', 'active', 'pending_pickup', 'pending_return') ORDER BY CASE o.status WHEN 'active' THEN 0 WHEN 'pending_return' THEN 1 WHEN 'pending_pickup' THEN 2 ELSE 3 END, o.endDate DESC LIMIT 1`).bind(device.id).first()
    return c.json({ ok: true, serverTime: new Date().toISOString(), inspectionRequested: Boolean(device.inspection_requested_at), deviceId: device.id, deviceStatus: device.agent_status, deviceMode: device.device_mode || 'normal', remoteLockEnabled: Boolean(device.remote_lock_enabled), lockMessage: device.remote_lock_message || null, contractLink: device.contract_link || null, cleanupRequested: Boolean(device.cleanup_requested), cleanupRequestId: device.cleanup_requested_at || null, rental }, 200, { 'Cache-Control': 'no-store' })
  } catch (error: any) {
    console.error('Device agent state monitor failed:', error?.message || error)
    return c.json({ ok: false, status: 'down', error: 'state service unavailable' }, 503, { 'Cache-Control': 'no-store' })
  }
})

app.get('/api/device-agent/commands', async (c) => {
  const device = await getAgentDevice(c)
  if (!device) return c.json({ ok: false, error: 'Invalid device token' }, 401)
  await ensureDeviceCommandTables(c.env.RENT)
  await c.env.RENT.prepare("UPDATE device_commands SET status = 'EXPIRED', payload = CASE WHEN command_type IN ('CREATE_RENTAL_USER', 'UPDATE_RENTAL_USER', 'DELETE_RENTAL_USER') THEN '{}' ELSE payload END, completed_at = CURRENT_TIMESTAMP WHERE device_id = ? AND status IN ('QUEUED', 'SENT', 'ACKNOWLEDGED', 'RUNNING') AND datetime(expires_at) <= CURRENT_TIMESTAMP").bind(device.id).run()
  // Return the camelCase contract expected by the Windows client. SQLite column
  // names use snake_case, and System.Text.Json does not translate underscores.
  const commands = (await c.env.RENT.prepare("SELECT id, device_id AS deviceId, command_type AS commandType, payload, status, created_at AS createdAt, expires_at AS expiresAt FROM device_commands WHERE device_id = ? AND status = 'QUEUED' AND datetime(expires_at) > CURRENT_TIMESTAMP ORDER BY created_at ASC LIMIT 10").bind(device.id).all()).results || []
  if (commands.length) await c.env.RENT.prepare(`UPDATE device_commands SET status = 'SENT', sent_at = COALESCE(sent_at, CURRENT_TIMESTAMP), claimed_at = COALESCE(claimed_at, CURRENT_TIMESTAMP) WHERE device_id = ? AND status = 'QUEUED' AND id IN (${commands.map(() => '?').join(',')})`).bind(device.id, ...commands.map((item: any) => item.id)).run()
  return c.json({ ok: true, commands })
})

// Advance a device command one step. A repeated call from the client (network
// retry) for a step already taken returns { ok:true, duplicate:true } instead
// of a 409, so agents can retry safely without special-casing.
async function advanceDeviceCommand(c: any, targetState: 'ACKNOWLEDGED' | 'RUNNING', timestampColumn: string) {
  const device = await getAgentDevice(c)
  if (!device) return c.json({ ok: false, error: 'Invalid device token' }, 401)
  const id = c.req.param('id')
  const cmd = await c.env.RENT.prepare('SELECT status FROM device_commands WHERE id = ? AND device_id = ?').bind(id, device.id).first() as any
  if (!cmd) return c.json({ ok: false, error: 'Command not found' }, 404)
  const from = String(cmd.status)
  if (from === targetState || DEVICE_COMMAND_TERMINAL_STATES.has(from) || (targetState === 'ACKNOWLEDGED' && from === 'RUNNING')) {
    return c.json({ ok: true, duplicate: true })
  }
  if (!canTransitionDeviceCommand(from, targetState)) return c.json({ ok: false, error: `Command is not ${targetState === 'ACKNOWLEDGED' ? 'awaiting acknowledgement' : 'runnable'}` }, 409)
  const timestamp = sqlIdentifier(timestampColumn)
  await c.env.RENT.prepare(`UPDATE device_commands SET status = ?, ${timestamp} = COALESCE(${timestamp}, CURRENT_TIMESTAMP) WHERE id = ? AND device_id = ? AND status = ?`).bind(targetState, id, device.id, from).run()
  return c.json({ ok: true })
}

app.post('/api/device-agent/commands/:id/ack', (c) => advanceDeviceCommand(c, 'ACKNOWLEDGED', 'acknowledged_at'))
app.post('/api/device-agent/commands/:id/start', (c) => advanceDeviceCommand(c, 'RUNNING', 'started_at'))

app.post('/admin/devices/:id/commands/:cmdId/cancel', async (c) => {
  const user = await findUserBySession(c, c.req.header('cookie') ?? null)
  if (!user || !['MANAGER', 'ADMIN'].includes(getAccessLevel(user))) return c.redirect('/login')
  await ensureDeviceCommandTables(c.env.RENT)
  const cmd = await c.env.RENT.prepare('SELECT device_id, status, command_type FROM device_commands WHERE id = ? AND device_id = ?').bind(c.req.param('cmdId'), c.req.param('id')).first() as any
  if (!cmd) return c.text('命令不存在', 404)
  if (!canTransitionDeviceCommand(String(cmd.status), 'CANCELLED')) return c.text('命令已被认领或已结束，无法取消', 409)
  const result = await c.env.RENT.prepare("UPDATE device_commands SET status = 'CANCELLED', payload = CASE WHEN command_type IN ('CREATE_RENTAL_USER', 'UPDATE_RENTAL_USER', 'DELETE_RENTAL_USER') THEN '{}' ELSE payload END, completed_at = CURRENT_TIMESTAMP, error_message = COALESCE(error_message, '管理员取消') WHERE id = ? AND status = 'QUEUED'").bind(c.req.param('cmdId')).run() as any
  if (!Number(result.meta?.changes ?? result.changes ?? 0)) return c.text('命令已被认领或已结束，无法取消', 409)
  await createAuditLog(c, { actor: user, action: 'REMOTE_COMMAND_CANCELLED', targetType: 'DEVICE', targetId: String(cmd.device_id), before: { status: cmd.status }, after: { status: 'CANCELLED', commandType: cmd.command_type } })
  return c.redirect(`/admin/devices/${encodeURIComponent(String(cmd.device_id))}/control?success=命令已取消`, 303)
})

app.post('/api/device-agent/command-results', async (c) => {
  const device = await getAgentDevice(c)
  if (!device) return c.json({ ok: false, error: 'Invalid device token' }, 401)
  await ensureDeviceCommandTables(c.env.RENT)
  const payload = await c.req.json().catch(() => ({})) as any
  const commandId = String(payload.commandId || '').slice(0, 120)
  const resultCode = String(payload.resultCode || 'FAILED').slice(0, 40)
  if (!commandId || !/^[A-Z0-9_]+$/.test(resultCode)) return c.json({ ok: false, error: 'Invalid command result' }, 400)
  const command = await c.env.RENT.prepare('SELECT id, status FROM device_commands WHERE id = ? AND device_id = ?').bind(commandId, device.id).first() as any
  if (!command) return c.json({ ok: false, error: 'Command not found' }, 404)
  // Already finished (client retried its result POST): acknowledge without
  // re-running downstream side effects such as maintenance completion.
  if (DEVICE_COMMAND_TERMINAL_STATES.has(String(command.status))) return c.json({ ok: true, duplicate: true })
  const success = Boolean(payload.success)
  const executedAt = String(payload.executedAt || new Date().toISOString()).slice(0, 40)
  await c.env.RENT.batch([
    c.env.RENT.prepare("UPDATE device_commands SET status = ?, payload = CASE WHEN command_type IN ('CREATE_RENTAL_USER', 'UPDATE_RENTAL_USER', 'DELETE_RENTAL_USER') THEN '{}' ELSE payload END, completed_at = CURRENT_TIMESTAMP, error_message = ? WHERE id = ? AND device_id = ? AND status IN ('SENT', 'ACKNOWLEDGED', 'RUNNING')").bind(success ? 'SUCCESS' : 'FAILED', success ? null : String(payload.message || '').slice(0, 500), commandId, device.id),
    c.env.RENT.prepare('INSERT OR IGNORE INTO device_command_results (id, command_id, device_id, success, result_code, result_message, executed_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(`result-${nanoid(12)}`, commandId, device.id, success ? 1 : 0, resultCode, String(payload.message || '').slice(0, 500), executedAt),
  ])
  if (success) {
    const maintenance = await c.env.RENT.prepare("SELECT id, maintenance_type FROM maintenance_records WHERE device_id = ? AND status = 'CLIENT_CHECK' ORDER BY started_at DESC LIMIT 1").bind(device.id).first() as any
    if (maintenance) {
      const checks = await c.env.RENT.prepare('SELECT COUNT(*) AS total FROM maintenance_preparation_checks WHERE maintenance_id = ? AND passed = 1').bind(maintenance.id).first() as any
      if (Number(checks?.total || 0) === 10) {
        const manualRelist = maintenance.maintenance_type === 'REPAIR'
        await c.env.RENT.batch([
          c.env.RENT.prepare("UPDATE maintenance_records SET status = 'COMPLETED', completed_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'CLIENT_CHECK'").bind(maintenance.id),
          c.env.RENT.prepare('UPDATE devices SET status = ?, device_mode = ? WHERE id = ?').bind(manualRelist ? 'maintenance' : 'available', manualRelist ? 'maintenance' : 'normal', device.id),
        ])
        await recordDeviceLifecycle(c, device.id, manualRelist ? 'MAINTENANCE' : 'READY', { reason: '维护、数据清除、系统重置与十项设备验证均通过' })
      }
    }
  }
  return c.json({ ok: true })
})

app.get('*', async (c) => {
  const user = await findUserBySession(c, c.req.header('cookie') ?? null)
  return c.html(pages.renderNotFound(user))
})

// Handle scheduled events (cron jobs) for Cloudflare Workers
export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledEvent, env: any, ctx: ExecutionContext) {
    // Create a minimal context object that implements what our cleanup function needs
    const c = {
      env,
      get: (key: string) => undefined,
      set: () => { },
      req: { url: 'https://scheduled-event', method: 'CRON', header: () => undefined },
      text: (body: string, status = 200) => new Response(body, { status }),
      redirect: (url: string, status = 302) => new Response(null, { status, headers: { Location: url } }),
      // Expose getDB function that the site.ts functions expect
      ...(() => {
        const getDB = () => env.RENT
        return { getDB }
      })()
    } as any

    // Import and run the cleanup function
    const { cleanupExpiredAndCancelledContracts, cleanupExpiredGuestAccounts, cancelExpiredPendingPaymentOrders, notifyOverduePaymentProofs, runDataConsistencyChecks, releaseQualifiedReferralRewards, runMonitoringSweep, runScheduledJob, deliverPendingAgreementUpdates } = await import('./site')

    const batches = scheduledBatches(event.cron, event.scheduledTime)
    if (batches.reminders) {
      ctx.waitUntil(runScheduledJob(c,'rental_payout_requests',()=>runRentalPayouts(c)))
      ctx.waitUntil(runScheduledJob(c,'deliver_c2c_emails',async()=>{await loadSystemSettingsFromDB(c);return deliverC2CEmails(c)}))
      ctx.waitUntil(runScheduledJob(c, 'send_pickup_reminders', async () => {
        await loadSystemSettingsFromDB(c)
        const { sendScheduledPickupReminders } = await import('./site')
        return sendScheduledPickupReminders(c)
      }))
    }

    if (batches.quarterHourly) {
      ctx.waitUntil((async () => {
        await runScheduledJob(c, 'expire_missed_pickups', () => expireMissedPickupOrders(c))
        await runScheduledJob(c, 'expire_rental_link_drafts', () => expireRentalLinkDrafts(c))
        await runScheduledJob(c, 'charge_overdue_returns', () => chargeOverdueReturns(c))
        await runScheduledJob(c, 'charge_monthly_rentals', () => chargeDueRentalInstallments(c))
      })())
    }

    if (batches.hourly) {
      ctx.waitUntil(runScheduledJob(c, 'cancel_expired_pending_payments', () => cancelExpiredPendingPaymentOrders(c)))
    }

    if (!batches.daily) return

    ctx.waitUntil(
      (async () => {
        // Each step below runs through runScheduledJob so it's isolated: a step
        // that throws is recorded as FAILED and logged, but no longer prevents
        // every step queued after it in this tick from running (the previous
        // design wrapped the whole sequence in one try/catch).
        await runScheduledJob(c, 'ensure_device_command_tables', () => ensureDeviceCommandTables(env.RENT))
        await runScheduledJob(c, 'migrate_legacy_contract_secrets', () => migrateLegacyContractSecrets(c))

        await runScheduledJob(c, 'mark_overdue_handovers', async () => {
          const handoverRows = (await env.RENT.prepare("SELECT id, rental_status, startDate FROM orders WHERE payment_status = 'PAID' AND rental_status = 'READY_FOR_PICKUP' AND startDate <= date('now')").all()).results || []
          for (const row of handoverRows as any[]) {
            await env.RENT.batch([
              env.RENT.prepare("UPDATE orders SET rental_status = 'HANDOVER_PENDING', handover_overdue = 1, updatedAt = CURRENT_TIMESTAMP WHERE id = ? AND rental_status = 'READY_FOR_PICKUP'").bind(row.id),
              env.RENT.prepare("INSERT INTO rental_status_history (id, rental_id, old_status, new_status, trigger_type, reason) VALUES (?, ?, ?, ?, 'SYSTEM', ?)").bind(`rsh-${crypto.randomUUID()}`, row.id, row.rental_status, 'HANDOVER_PENDING', '已到预约取货日期但尚未确认交付')
            ])
          }
          return handoverRows.length
        })

        await runScheduledJob(c, 'windows_rental_user_lifecycle', async () => {
          const lifecycleRows = (await env.RENT.prepare(`SELECT o.id, o.deviceId, o.status, o.startDate, o.endDate, c.id AS contract_id, c.contract_data, u.name AS customer_name FROM orders o JOIN contracts c ON c.orderId = o.id LEFT JOIN users u ON u.id = o.userId WHERE o.status IN ('paid', 'active', 'completed') AND c.status IN ('signed', 'completed')`).all()).results || []
          const today = new Date().toISOString().slice(0, 10)
          let touched = 0
          for (const row of lifecycleRows as any[]) {
            let data: any = {}
            try { data = JSON.parse(row.contract_data || '{}') } catch (_) { }
            const windowsPassword = await decryptSecret(c, data.windows_password)
            if (!windowsPassword) continue
            const username = data.windows_username || row.customer_name || 'RentalUser'
            if (['paid', 'active'].includes(String(row.status)) && String(row.startDate) <= today && !data.windows_account_created) {
              await env.RENT.prepare("INSERT INTO device_commands (id, device_id, command_type, payload, created_by, expires_at) VALUES (?, ?, 'CREATE_RENTAL_USER', ?, NULL, datetime('now', '+7 days'))").bind(`cmd-${crypto.randomUUID()}`, row.deviceId, JSON.stringify({ username, password: windowsPassword })).run()
              data.windows_account_created = true
              await env.RENT.prepare('UPDATE contracts SET contract_data = ? WHERE id = ?').bind(JSON.stringify(data), row.contract_id).run()
              touched++
            }
            if (String(row.status) === 'completed' && !data.windows_account_deleted) {
              await env.RENT.prepare("INSERT INTO device_commands (id, device_id, command_type, payload, created_by, expires_at) VALUES (?, ?, 'DELETE_RENTAL_USER', ?, NULL, datetime('now', '+30 days'))").bind(`cmd-${crypto.randomUUID()}`, row.deviceId, JSON.stringify({ username })).run()
              data.windows_account_deleted = true
              await env.RENT.prepare('UPDATE contracts SET contract_data = ? WHERE id = ?').bind(JSON.stringify(data), row.contract_id).run()
              touched++
            }
          }
          return touched
        })

        await runScheduledJob(c, 'purge_scheduled_account_deletions', async () => {
          for (const column of ['deletion_requested_at', 'deletion_scheduled_at']) {
            try { await env.RENT.prepare(`ALTER TABLE users ADD COLUMN ${sqlIdentifier(column)} TEXT`).run() } catch (_) { }
          }
          // Legacy databases differ in which of these columns they carry (snake_case
          // vs camelCase, and some never had a bank `account` column at all — the app
          // treats it as an alias of account_number). Building the SET clause from the
          // columns that actually exist keeps this from failing with "no such column".
          const userColumns = new Set<string>(
            ((await env.RENT.prepare('PRAGMA table_info(users)').all()).results || []).map((row: any) => String(row.name))
          )
          const scrubExpr: Record<string, string> = {
            name: `'删除账户'`,
            email: `'deleted-account-' || id || '@invalid.local'`,
            phone: 'NULL',
            bsb: 'NULL',
            account: 'NULL',
            account_number: 'NULL',
            accountNumber: 'NULL',
            balance: '0',
            commission_balance: '0',
            commissionBalance: '0',
            password_hash: `'disabled'`,
            password_salt: `'disabled'`,
            referral_code: 'NULL',
            referrer_id: 'NULL',
            staff_id: 'NULL',
            user_agreement_accepted_ip: 'NULL',
            status: `'inactive'`,
            account_status: `'inactive'`,
            deleted_at: 'CURRENT_TIMESTAMP',
            deletion_requested_at: 'NULL',
            deletion_scheduled_at: 'NULL',
            updated_at: 'CURRENT_TIMESTAMP',
          }
          const setClause = Object.entries(scrubExpr)
            .filter(([col]) => userColumns.has(col) && SQL_IDENTIFIER.test(col))
            .map(([col, expr]) => `${sqlIdentifier(col)} = ${expr}`)
            .join(', ')
          const deletedAccountResult = await env.RENT.prepare(`UPDATE users SET ${setClause} WHERE role = 'CUSTOMER' AND status = 'active' AND deletion_scheduled_at IS NOT NULL AND deletion_scheduled_at <= CURRENT_TIMESTAMP`).run()
          return Number(deletedAccountResult.meta?.changes || 0)
        })

        await runScheduledJob(c, 'cleanup_expired_contracts', () => cleanupExpiredAndCancelledContracts(c))
        await runScheduledJob(c, 'cleanup_expired_guest_accounts', () => cleanupExpiredGuestAccounts(c))
        await runScheduledJob(c, 'create_due_date_notifications', () => createDueDateNotifications(c))
        await runScheduledJob(c, 'notify_overdue_payment_proofs', () => notifyOverduePaymentProofs(c))
        await runScheduledJob(c, 'deliver_pending_agreement_updates', () => deliverPendingAgreementUpdates(c))
        await runScheduledJob(c, 'purge_old_device_inspections', async () => {
          const result = await env.RENT.prepare("UPDATE device_inspections SET deleted_at = CURRENT_TIMESTAMP WHERE created_at < datetime('now', '-1 year') AND deleted_at IS NULL").run()
          return Number(result.meta?.changes || 0)
        })
        await runScheduledJob(c, 'run_data_consistency_checks', () => runDataConsistencyChecks(c))
        await runScheduledJob(c, 'run_monitoring_sweep', () => runMonitoringSweep(c))
        await runScheduledJob(c, 'release_qualified_referral_rewards', () => releaseQualifiedReferralRewards(c))
      })()
    )
  }
}
