/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

import { clientPathEnabled } from './clientAccess'
import { Context } from 'hono'
import { stripeRequest } from './stripe'
import { expireStripeCheckout } from './services/stripeCheckout'
import rawLayoutTemplate from './layout.html'
import { styleSheetHref, appScriptHref, languageScriptHref } from './lib/assetVersion'
import { languageBootScript, i18nDomainsForRole } from './lib/i18n'
import { nanoid } from 'nanoid'

// 给 styles.css / app.js 链接注入内容指纹版本号，配合 ?v=<hash> 的一年期 immutable 缓存。
const layoutTemplate = rawLayoutTemplate
  .replace('href="/styles.css"', `href="${styleSheetHref}"`)
  .replace('src="{{APP_SCRIPT}}"', `src="${appScriptHref}"`)
  .replace('src="/i18n.js"', `src="${languageScriptHref}"`)
  .replace('href="/i18n.js"', `href="${languageScriptHref}"`)

// ---------------------------------------------------------------------------
// 通用工具函数已拆分到 src/lib/*。这里 import 供本文件内部使用，并在文件内
// 统一 re-export，让既有 `import { ... } from './site'`（页面 / action / 测试）
// 保持零改动。
// ---------------------------------------------------------------------------
import { generateReferenceNumber, generateContractNumber, splitOrderNo, staffOrderPath } from './lib/reference'
import {
  sanitizeRichHtml, sanitizePlainText, neutralizeTemplateTokens,
  renderNotificationMarkdown, renderFlexibleContent, renderEmailNotificationHtml, createPageBreakHtml,
  sanitizeMarketingEmailHtml, renderMarketingEmailHtml,
} from './lib/html'
import { splitPersonName, combinePersonName, getAvatarInitials } from './lib/personName'
import { getAccessLevel, canManageUser, canUseAccountBalance, getAccountTypeDisplay } from './lib/access'
import type { Role, AccessLevel } from './lib/access'
import { formatCurrency, formatMelbourneDateTime, formatMelbourneDate, formatDate } from './lib/format'
import { hashPassword, verifyPassword, isStrongPassword, generateTemporaryPassword } from './lib/password'
import { timingSafeEqualStr } from './lib/checksum'
import { parseCookie } from './lib/cookie'
import { generateUserId, generateReferralCode } from './lib/userId'
import { validateHostedImageUrls } from './lib/hostedImages'
import { uploadCloudinaryImage, uploadCloudinaryImages } from './lib/cloudinary'
import { safeJsonParse } from './lib/json'
import { normalizeReferralSettings } from './domain/referral'
import { injectTableDataLabels } from './lib/tableLabels'
import { dispatchChannelAlert } from './notifyChannels'

export {
  generateReferenceNumber, generateContractNumber, splitOrderNo, staffOrderPath,
  sanitizeRichHtml, sanitizePlainText, neutralizeTemplateTokens,
  renderNotificationMarkdown, renderFlexibleContent, renderEmailNotificationHtml, createPageBreakHtml,
  sanitizeMarketingEmailHtml, renderMarketingEmailHtml,
  splitPersonName, combinePersonName, getAvatarInitials,
  getAccessLevel, canManageUser, canUseAccountBalance, getAccountTypeDisplay,
  formatCurrency, formatMelbourneDateTime, formatMelbourneDate, formatDate,
  hashPassword, verifyPassword, isStrongPassword, generateTemporaryPassword,
  timingSafeEqualStr,
  parseCookie,
  generateUserId, generateReferralCode,
  validateHostedImageUrls,
  uploadCloudinaryImage, uploadCloudinaryImages,
  formatOrderChangeActor,
}
export type { Role, AccessLevel }

export function getCustomerSigningUser(user: User | null | undefined): User | null {
  return user?.role === 'CUSTOMER' ? user : null
}

// 风险分每次操作前从历史数据和当前有效标记重新计算，不落库，避免标记解除后仍保留旧分数。
// ---------------------------------------------------------------------------
// 纯业务逻辑 / 状态机已拆分到 src/domain/*（均有独立单元测试）。同样 import
// 供本文件使用并统一 re-export。
// ---------------------------------------------------------------------------
import { canTransitionOrder } from './domain/orderStatus'
import {
  ORDER_CHANGE_TYPES, ORDER_CHANGE_TYPE_LABELS,
  orderChangeSnapshot, diffOrderSnapshots, buildOrderChangePlan, formatOrderChangeActor,
} from './domain/orderChanges'
import type { OrderChangeType, OrderChangePlan } from './domain/orderChanges'
import {
  DEVICE_COMMAND_STATES, DEVICE_COMMAND_TERMINAL_STATES,
  canTransitionDeviceCommand, HIGH_RISK_DEVICE_COMMANDS, isHighRiskDeviceCommand,
} from './domain/deviceCommand'
import type { DeviceCommandState } from './domain/deviceCommand'
import {
  DEVICE_LIFECYCLE_FLOW, canTransitionDeviceLifecycle,
  MAINTENANCE_OPEN_STATES, MAINTENANCE_ADVANCE_NEXT, MAINTENANCE_CHECK_TYPES,
} from './domain/deviceLifecycle'
import {
  PAYMENT_DISPUTE_STATES, PAYMENT_DISPUTE_OPEN_STATES, PAYMENT_DISPUTE_TERMINAL_STATES,
  canTransitionPaymentDispute, isPaymentDisputeOpen, paymentsBlockedByDispute, mapStripeDisputeStatus,
} from './domain/paymentDispute'
import type { PaymentDisputeState } from './domain/paymentDispute'
import {
  RISK_FLAG_TYPES, RISK_FLAG_SEVERITIES, ORDER_BLOCKING_RISK_FLAG_TYPES,
  isRiskFlagCurrentlyActive, findBlockingRiskFlag, calculateCustomerRiskAssessment, calculateReferralRiskAssessment,
  RISK_SCORE_HIGH_THRESHOLD,
} from './domain/riskFlags'
import type { RiskFlagType, RiskFlagLike, CustomerRiskFacts, CustomerRiskAssessment, ReferralRiskFacts, ReferralRiskAssessment } from './domain/riskFlags'
import { deviceUtilisationRate, paymentMethodBreakdown, rentalRefundAmount } from './domain/operationsReport'
import { pickupTimeSlots } from './domain/pickupTimeSlots'
import type { PaymentMethodRow, PaymentMethodShare } from './domain/operationsReport'
import {
  RETENTION_ACTIONS, retentionCutoffDate, isPastRetention, retentionSweepActionable,
} from './domain/dataRetention'
import type { RetentionAction, RetentionPolicyLike } from './domain/dataRetention'
import { rateHealth, countHealth, worstHealthLevel, summarizeMetricHistory, staleMonitoringAlertIds } from './domain/monitoring'
import type { HealthLevel, MonitorMetric, MonitorMetricKind, MetricHistoryPoint, MetricHistorySummary } from './domain/monitoring'
import { agentCommission } from './domain/agentProgram'
import { buildRefundAllocation, evaluatePaymentReconciliation } from './domain/refundAllocation'
import { computeOrderSettlementStatus } from './domain/orderSettlement'
import type {
  RefundSource, RefundAllocationLine, ReconInput, ReconIssue, ReconResult,
} from './domain/refundAllocation'

export {
  canTransitionOrder,
  ORDER_CHANGE_TYPES, ORDER_CHANGE_TYPE_LABELS,
  orderChangeSnapshot, diffOrderSnapshots, buildOrderChangePlan,
  DEVICE_COMMAND_STATES, DEVICE_COMMAND_TERMINAL_STATES,
  canTransitionDeviceCommand, HIGH_RISK_DEVICE_COMMANDS, isHighRiskDeviceCommand,
  DEVICE_LIFECYCLE_FLOW, canTransitionDeviceLifecycle,
  MAINTENANCE_OPEN_STATES, MAINTENANCE_ADVANCE_NEXT, MAINTENANCE_CHECK_TYPES,
  PAYMENT_DISPUTE_STATES, PAYMENT_DISPUTE_OPEN_STATES, PAYMENT_DISPUTE_TERMINAL_STATES,
  canTransitionPaymentDispute, isPaymentDisputeOpen, paymentsBlockedByDispute, mapStripeDisputeStatus,
  RISK_FLAG_TYPES, RISK_FLAG_SEVERITIES, ORDER_BLOCKING_RISK_FLAG_TYPES,
  isRiskFlagCurrentlyActive, findBlockingRiskFlag, calculateCustomerRiskAssessment, calculateReferralRiskAssessment,
  RISK_SCORE_HIGH_THRESHOLD,
  deviceUtilisationRate, paymentMethodBreakdown, rentalRefundAmount,
  RETENTION_ACTIONS, retentionCutoffDate, isPastRetention, retentionSweepActionable,
  rateHealth, countHealth, worstHealthLevel, summarizeMetricHistory, staleMonitoringAlertIds,
  agentCommission,
  buildRefundAllocation, evaluatePaymentReconciliation,
}
export type {
  OrderChangeType, OrderChangePlan, DeviceCommandState, PaymentDisputeState,
  RiskFlagType, RiskFlagLike, CustomerRiskFacts, CustomerRiskAssessment, ReferralRiskFacts, ReferralRiskAssessment, PaymentMethodRow, PaymentMethodShare,
  RetentionAction, RetentionPolicyLike, HealthLevel, MonitorMetric, MonitorMetricKind, MetricHistoryPoint, MetricHistorySummary,
  RefundSource, RefundAllocationLine, ReconInput, ReconIssue, ReconResult,
}

// ---------------------------------------------------------------------------
// 数据库句柄与领域实体类型已拆到 src/db/*。同样 import 使用并 re-export，
// 让既有 `import { getDB, type User, ... } from './site'` 保持不变。
// ---------------------------------------------------------------------------
import { getDB } from './db/client'
import type { User, Device, DeviceLifecycleStatus, Order, Contract, ContractTemplate } from './db/types'
export { getDB }
export type { User, Device, DeviceLifecycleStatus, Order, Contract, ContractTemplate }

// ---------------------------------------------------------------------------
// 系统设置的内存默认值 + 访问器已拆到 src/settings/*。loadSystemSettingsFromDB /
// updateSystemSettings 仍在本文件，就地读写导入的 systemSettings（同一引用）。
// ---------------------------------------------------------------------------
import { systemSettings, getSystemSettings, rentalTerms } from './settings/systemSettings'
import type { SystemSettingsKey } from './settings/systemSettings'
import { normalizeTallyEmbedUrl } from './lib/tally'
import { decryptSecret, encryptSecret } from './lib/secretBox'
export { systemSettings, getSystemSettings, rentalTerms }
export type { SystemSettingsKey }

// ---------------------------------------------------------------------------
// 领域实体 CRUD（用户 / 订单 / 设备 / 合同）已拆到 src/db/repositories.ts。
// 编排逻辑（updateOrderStatus、调度清理、webhook、对账）仍在本文件，从这里
// import 需要的 CRUD。site.ts 统一 re-export，pages/actions/tests 零改动。
// ---------------------------------------------------------------------------
import {
  normalizeUserRow, userHasColumn,
  generateUniqueUserId, getUserById, findUserByEmail, verifyUserCredentials, findUserByReferralCode,
  getUsers, getUsersByIds, getUsersAsync, insertUser, updateUser,
  getOrderById, getOrderByOrderNo, getOrders, getOrdersForUser, getOrdersWithDetailsForUser, getOrdersByIds, getOrdersAsync,
  insertOrder, ensureOrderNumber, updateOrder, updateOrderInDB, hasDeviceBookingConflict,
  getDeviceById, getDeviceBySerialNumber, getDevices, getDevicesByIds, getDevicesAsync,
  insertDevice, updateDevice, deleteDevice, updateDeviceStatus, recordDeviceLifecycle, releaseDeviceIfUnbooked,
  getContractById, getContractByOrderId, getAllContracts, getContractByContractNumber, getContractBySignToken,
  insertContract, updateContractStatus, updateContractStatusInDB,
} from './db/repositories'

export {
  generateUniqueUserId, getUserById, findUserByEmail, verifyUserCredentials, findUserByReferralCode,
  getUsers, getUsersByIds, getUsersAsync, insertUser, updateUser,
  getOrderById, getOrderByOrderNo, getOrders, getOrdersForUser, getOrdersWithDetailsForUser, getOrdersByIds, getOrdersAsync,
  insertOrder, ensureOrderNumber, updateOrder, updateOrderInDB, hasDeviceBookingConflict,
  getDeviceById, getDeviceBySerialNumber, getDevices, getDevicesByIds, getDevicesAsync,
  insertDevice, updateDevice, deleteDevice, updateDeviceStatus, recordDeviceLifecycle, releaseDeviceIfUnbooked,
  getContractById, getContractByOrderId, getAllContracts, getContractByContractNumber, getContractBySignToken,
  insertContract, updateContractStatus, updateContractStatusInDB,
}

// ---------------------------------------------------------------------------
// 审计 / 错误日志已拆到 src/services/audit.ts（叶子层：仅依赖 db/client + nanoid）。
// 拆在这里是为了让其它服务模块能 import logError 而不与 site.ts 形成循环依赖。
// ---------------------------------------------------------------------------
import { createAuditLog, logError, cleanupOldErrorLogs } from './services/audit'
import type { ErrorLevel } from './services/audit'
export { createAuditLog, logError, cleanupOldErrorLogs }
export type { ErrorLevel }

// ---------------------------------------------------------------------------
// 业务服务已拆到 src/services/*：ledger（余额 / 财务台账）、notifications（站内
// 通知 + cron 邮件）、referral（推荐计划）、rentalProvisioning（外部付款入账 +
// Windows 账户命令）。依赖方向 services → db/lib/settings/audit，无回边。
// site.ts 仅 import 自身编排逻辑（updateOrderStatus / issueInvoice 等）需要的，
// 并统一 re-export。
// ---------------------------------------------------------------------------
import { recordBalanceTransaction, recordFinancialLedgerEntry } from './services/ledger'
import {
  ensureNotificationsTable, createNotification, getNotifications,
  deleteRentalApplicationNotifications, cleanupCompletedRentalApplicationNotifications, cleanupCompletedPaymentReviewNotifications,
  createDueDateNotifications, sendScheduledPickupReminders, enqueueAgreementUpdate, deliverPendingAgreementNotifications,
  deliverPendingAgreementEmails, deliverPendingAgreementUpdates, notifyOverduePaymentProofs,
  notifyOverdueBankTransferRefunds,
} from './services/notifications'
import {
  ensureReferralProgram, lockReferralRelationship, syncReferralOrderState,
  revokeReferralRewardForOrder, releaseQualifiedReferralRewards, releaseReferralRewardNow,
} from './services/referral'
import { getCustomerRiskAssessment, getCustomerRiskLevels, getReferralRiskAssessment } from './services/risk'
import {
  recordExternalRentalFlow, enqueueRentalUserCreation, enqueueRentalUserDeletion,
} from './services/rentalProvisioning'
import { issueInvoice, issueCreditNote } from './services/invoice'
import { planWithdrawalConsumption, createWithdrawalRequest } from './services/withdrawal'
import type { WithdrawableReward, WithdrawalPlan } from './services/withdrawal'
import { getPendingOrdersWithDetails, getStaffDashboardData } from './services/staffDashboard'

export {
  recordBalanceTransaction, recordFinancialLedgerEntry,
  ensureNotificationsTable, createNotification, getNotifications,
  deleteRentalApplicationNotifications, cleanupCompletedRentalApplicationNotifications, cleanupCompletedPaymentReviewNotifications,
  createDueDateNotifications, sendScheduledPickupReminders, enqueueAgreementUpdate, deliverPendingAgreementNotifications,
  deliverPendingAgreementEmails, deliverPendingAgreementUpdates, notifyOverduePaymentProofs,
  notifyOverdueBankTransferRefunds,
  ensureReferralProgram, lockReferralRelationship, syncReferralOrderState,
  revokeReferralRewardForOrder, releaseQualifiedReferralRewards, releaseReferralRewardNow,
  getCustomerRiskAssessment, getCustomerRiskLevels, getReferralRiskAssessment,
  recordExternalRentalFlow, enqueueRentalUserCreation, enqueueRentalUserDeletion,
  issueInvoice, issueCreditNote,
  planWithdrawalConsumption, createWithdrawalRequest,
  getPendingOrdersWithDetails, getStaffDashboardData,
}
export type { WithdrawableReward, WithdrawalPlan }

// ---------------------------------------------------------------------------
// Cookie 会话 + 限流已拆到 src/auth/session.ts（依赖 db + lib/cookie）。
// ---------------------------------------------------------------------------
import {
  findUserBySession, createAuthSession, revokeAllSessions, deleteAuthSession, enforceRateLimit,
} from './auth/session'
export {
  findUserBySession, createAuthSession, revokeAllSessions, deleteAuthSession, enforceRateLimit,
}

function renderLayoutTemplate(values: Record<string, string>): string {
  // 占位符名允许数字（如 I18N_BOOT 的邻居 I18N_DOMAINS 之外还有 H1 之类的未来扩展）；
  // 只写 [A-Z_] 会把 {{I18N2}} 一类占位符漏替换，直接出现在线上 HTML 里。
  return layoutTemplate.replace(/\{\{([A-Z][A-Z0-9_]*)\}\}/g, (placeholder, key: string) =>
    Object.prototype.hasOwnProperty.call(values, key) ? values[key] : placeholder
  )
}

export function renderSiteVariables(content: string, currentUser: any = {}, extraValues: Record<string, unknown> = {}): string {
  const values: Record<string, unknown> = {
    company_name: systemSettings.companyDetails.name,
    company_abn: systemSettings.companyDetails.abn,
    company_address: systemSettings.companyDetails.address,
    company_phone: systemSettings.companyDetails.phone,
    company_email: systemSettings.companyDetails.email,
    company_website: systemSettings.companyDetails.website,
    company_logo: systemSettings.companyDetails.logo,
    user_terms_version: systemSettings.legalMetadata.user.version,
    user_terms_last_updated_date: systemSettings.legalMetadata.user.lastUpdatedDate,
    // 兼容旧模板变量名（迁移 0114 早期版本使用 user_agreement_* 而非与页面 varPrefix 一致的 user_terms_*）
    user_agreement_version: systemSettings.legalMetadata.user.version,
    user_agreement_last_updated_date: systemSettings.legalMetadata.user.lastUpdatedDate,
    service_terms_version: systemSettings.legalMetadata.service.version,
    service_terms_last_updated_date: systemSettings.legalMetadata.service.lastUpdatedDate,
    privacy_policy_version: systemSettings.legalMetadata.privacy.version,
    privacy_policy_last_updated_date: systemSettings.legalMetadata.privacy.lastUpdatedDate,
    refund_policy_version: systemSettings.legalMetadata.copyright.version,
    refund_policy_last_updated_date: systemSettings.legalMetadata.copyright.lastUpdatedDate,
    cookie_policy_version: systemSettings.legalMetadata.cookie.version,
    cookie_policy_last_updated_date: systemSettings.legalMetadata.cookie.lastUpdatedDate,
    complaints_policy_version: systemSettings.legalMetadata.complaints.version,
    complaints_policy_last_updated_date: systemSettings.legalMetadata.complaints.lastUpdatedDate,
    acceptable_use_policy_version: systemSettings.legalMetadata.aup.version,
    acceptable_use_policy_last_updated_date: systemSettings.legalMetadata.aup.lastUpdatedDate,
    consumer_rights_version: systemSettings.legalMetadata.consumer.version,
    consumer_rights_last_updated_date: systemSettings.legalMetadata.consumer.lastUpdatedDate,
    user_name: currentUser?.name || '',
    user_email: currentUser?.email || '',
    ...extraValues,
  }

  const filled = Object.entries(values).reduce((result, [key, value]) => {
    return result.replace(new RegExp(`\\$\\{${key}\\}|\\{${key}\\}`, 'g'), escapeContractValue(value))
  }, String(content ?? ''))

  return sanitizeRichHtml(filled)
}


export function isContractExpired(contract: Contract, now = Date.now()): boolean {
  if ((contract.status as string) === 'expired') return true
  if (!['draft', 'pending_sign'].includes(contract.status)) return false
  const expiry = contract.signExpiresAt || contract.sign_expires_at || contract.validUntil || contract.valid_until
  if (!expiry) return false
  const expiryTime = new Date(expiry).getTime()
  return Number.isFinite(expiryTime) && expiryTime < now
}

export function isContractFinalized(contract: Contract | null | undefined): boolean {
  return Boolean(contract && ['signed', 'completed'].includes(contract.status) && contract.signedAt && contract.signed_content)
}

// 将数据库行归一化为同时包含 snake_case 和 camelCase 字段的 User 对象
export async function cancelExpiredPendingPaymentOrders(c: Context): Promise<number> {
  const orders = await c.env.RENT.prepare(`
    SELECT id, deviceId FROM orders
    WHERE status = 'pending_payment'
      AND datetime(createdAt) <= datetime('now', '-24 hours')
  `).all() as any
  let cancelled = 0
  for (const order of (orders.results || []) as any[]) {
    if (await applyPendingPaymentCancellation(c, order)) cancelled += 1
  }
  return cancelled + await cancelExpiredPendingBalanceTopUps(c)
}

// 余额充值也使用 pending 表示尚未完成付款；超过 24 小时后改为失败态，
// 沿用手动取消充值的状态约定，避免继续显示为可支付记录。
export async function cancelExpiredPendingBalanceTopUps(c: Context): Promise<number> {
  const topups = await c.env.RENT.prepare(`
    SELECT id, stripe_payment_intent_id, stripe_checkout_session_id FROM balance_topups
    WHERE status = 'pending'
      AND datetime(created_at) <= datetime('now', '-24 hours')
  `).all() as any
  let cancelled = 0
  for (const topup of (topups.results || []) as any[]) {
    if (await applyPendingBalanceTopUpCancellation(c, topup)) cancelled += 1
  }
  return cancelled
}

async function applyPendingBalanceTopUpCancellation(c: Context, topup: { id: string; stripe_payment_intent_id?: string | null; stripe_checkout_session_id?: string | null }): Promise<boolean> {
  const result = await c.env.RENT.prepare(`
    UPDATE balance_topups
    SET status = 'failed',
        note = CASE WHEN note IS NULL OR note = '' THEN '系统自动取消：超过24小时未完成付款' ELSE note || '；系统自动取消：超过24小时未完成付款' END,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND status = 'pending'
  `).bind(topup.id).run() as any
  const changes = Number(result.meta?.changes ?? result.changes ?? 0)
  if (changes < 1) return false
  await expireStripeCheckout(c, topup.stripe_checkout_session_id).catch(() => null)
  await releaseStripePendingIntent(c, topup.stripe_payment_intent_id, `pending-topup-cancel-${topup.id}`)
  return true
}

// 把一笔待支付订单标记为已取消：订单本身状态翻转成功时才继续收尾（取消合同草稿、
// 失败挂起的付款、释放设备与优惠码），供 24 小时自动取消和客户手动取消共用。
export async function applyPendingPaymentCancellation(c: Context, order: { id: string; deviceId: string }): Promise<boolean> {
  const result = await c.env.RENT.prepare(`
    UPDATE orders SET status = 'cancelled', updatedAt = CURRENT_TIMESTAMP
    WHERE id = ? AND status = 'pending_payment'
  `).bind(order.id).run() as any
  const changes = Number(result.meta?.changes ?? result.changes ?? 0)
  if (changes < 1) return false
  await releaseStripePendingPaymentIntents(c, order.id)
  await c.env.RENT.prepare("UPDATE contracts SET status = 'cancelled', updatedAt = CURRENT_TIMESTAMP WHERE orderId = ? AND status IN ('draft', 'pending_sign', 'signed')").bind(order.id).run()
  await c.env.RENT.prepare(`UPDATE payments SET status = 'failed', updated_at = CURRENT_TIMESTAMP WHERE rental_id = ? AND status = 'pending'`).bind(order.id).run()
  await releaseDeviceIfUnbooked(c, order.deviceId)
  const { releaseCouponForOrder } = await import('./actions/coupons')
  await releaseCouponForOrder(c, order.id)
  return true
}

// 订单取消时同步告诉 Stripe 放弃这笔订单尚未结算的 PaymentIntent（常规收款或短租
// 一次性预授权），避免站内订单已取消，Stripe 那边的授权额度却继续占用客户信用卡。
// 尽力而为：单个 PaymentIntent 请求失败不阻断订单取消本身。
export async function releaseStripePendingPaymentIntents(c: Context, orderId: string): Promise<void> {
  const pendingPayments = await c.env.RENT.prepare(
    "SELECT stripe_payment_intent_id, stripe_checkout_session_id FROM payments WHERE rental_id = ? AND status = 'pending' AND (stripe_payment_intent_id IS NOT NULL OR stripe_checkout_session_id IS NOT NULL)"
  ).bind(orderId).all() as any
  for (const payment of (pendingPayments.results || []) as any[]) {
    await expireStripeCheckout(c, payment.stripe_checkout_session_id).catch(() => null)
    await releaseStripePendingIntent(c, payment.stripe_payment_intent_id, `pending-payment-cancel-${orderId}`)
  }
}

async function releaseStripePendingIntent(c: Context, rawIntentId: unknown, idempotencyKey: string): Promise<void> {
  const intentId = String(rawIntentId || '')
  if (!/^pi_[A-Za-z0-9_]+$/.test(intentId)) return
  const intent = await stripeRequest(c, `payment_intents/${intentId}`).catch(() => null)
  if (intent && ['requires_payment_method', 'requires_confirmation', 'requires_action', 'requires_capture'].includes(String(intent.status))) {
    await stripeRequest(c, `payment_intents/${intentId}/cancel`, new URLSearchParams(), idempotencyKey).catch(() => null)
  }
}

// Periodically scans for known invariant violations (e.g. a paid order with no
// successful payment row) and records them so they surface in the admin
// Exception Queue instead of only being discoverable by manual investigation.
// Runs one named step of the scheduled() cron in isolation: records a
// scheduled_job_runs row, and — critically — catches its own error so one
// failing step can no longer abort every step queued after it in the same
// cron tick (the previous design was one flat try/catch around everything).
// Returns the step's result, or null if it threw (the error is logged both
// to scheduled_job_runs and via logError, matching existing convention).
export async function runScheduledJob<T>(c: Context, jobName: string, fn: () => Promise<T>): Promise<T | null> {
  const runId = `sjr-${nanoid(16)}`
  await c.env.RENT.prepare("INSERT INTO scheduled_job_runs (id, job_name, status) VALUES (?, ?, 'RUNNING')").bind(runId, jobName).run()
  try {
    const result = await fn()
    await c.env.RENT.prepare("UPDATE scheduled_job_runs SET status = 'SUCCESS', completed_at = CURRENT_TIMESTAMP, result_summary = ? WHERE id = ?").bind(JSON.stringify(result ?? null).slice(0, 2000), runId).run()
    return result
  } catch (error: any) {
    await c.env.RENT.prepare("UPDATE scheduled_job_runs SET status = 'FAILED', completed_at = CURRENT_TIMESTAMP, error_message = ? WHERE id = ?").bind(String(error?.message || error).slice(0, 2000), runId).run()
    await logError(c, 'ERROR', `Scheduled job failed: ${jobName}`, error as Error)
    return null
  }
}

export async function runDataConsistencyChecks(c: Context): Promise<number> {
  const checks: Array<{ issueType: string; entityType: string; sql: string; autoSuspend?: boolean }> = [
    {
      issueType: 'PAID_ORDER_WITHOUT_PAYMENT',
      entityType: 'ORDER',
      autoSuspend: true,
      sql: `SELECT o.id FROM orders o WHERE o.payment_status = 'PAID' AND NOT EXISTS (
        SELECT 1 FROM payments p WHERE p.rental_id = o.id AND (p.status = 'paid' OR (
          p.status = 'pending' AND p.payment_method = 'card' AND p.stripe_payment_intent_id = o.stripe_deposit_payment_intent_id
          AND o.deposit_payment_mode = 'PREAUTH' AND o.deposit_status = 'HELD'
          AND p.rental_amount >= MAX(o.totalAmount - COALESCE(o.depositAmount, 0), 0))))`,
    },
    {
      issueType: 'ACTIVE_ORDER_WITHOUT_HANDOVER',
      entityType: 'ORDER',
      autoSuspend: true,
      sql: `SELECT o.id FROM orders o WHERE o.is_manual = 0 AND o.status IN ('active', 'extended', 'overdue') AND o.handover_completed_at IS NULL`,
    },
    {
      issueType: 'COMPLETED_ORDER_DEPOSIT_HELD',
      entityType: 'ORDER',
      sql: `SELECT o.id FROM orders o WHERE o.status = 'completed' AND o.deposit_status = 'HELD'`,
    },
    {
      issueType: 'DEVICE_RENTED_WITHOUT_ACTIVE_ORDER',
      entityType: 'DEVICE',
      sql: `SELECT d.id FROM devices d WHERE d.lifecycle_status = 'RENTED' AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.deviceId = d.id AND (o.status IN ('active', 'paid', 'extended', 'overdue', 'pending_return') OR (o.is_manual = 1 AND o.status = 'suspended')))`,
    },
    {
      issueType: 'RETURNED_ORDER_WITHOUT_RETURN_RECORD',
      entityType: 'ORDER',
      sql: `SELECT o.id FROM orders o WHERE o.status IN ('returned', 'pending_return', 'completed') AND o.rental_status IN ('RETURNED', 'COMPLETED') AND o.return_received_at IS NULL`,
    },
    {
      issueType: 'REFUNDED_ORDER_WITHOUT_REFUND_TXN',
      entityType: 'ORDER',
      sql: `SELECT o.id FROM orders o WHERE o.payment_status IN ('REFUNDED', 'PARTIALLY_REFUNDED') AND NOT EXISTS (SELECT 1 FROM payment_refunds r WHERE r.order_id = o.id AND r.status = 'succeeded')`,
    },
    {
      issueType: 'INVOICE_WITHOUT_PAYMENT',
      entityType: 'ORDER',
      sql: `SELECT i.order_id AS id FROM invoices i WHERE NOT EXISTS (SELECT 1 FROM payments p WHERE p.rental_id = i.order_id AND p.status = 'paid')`,
    },
    {
      issueType: 'DEVICE_AVAILABLE_WITH_ACTIVE_ORDER',
      entityType: 'DEVICE',
      sql: `SELECT d.id FROM devices d WHERE COALESCE(d.lifecycle_status, d.status) IN ('AVAILABLE', 'available', 'READY') AND EXISTS (SELECT 1 FROM orders o WHERE o.deviceId = d.id AND o.status IN ('active', 'extended', 'overdue', 'pending_return'))`,
    },
  ]
  let found = 0
  for (const check of checks) {
    const rows = (await c.env.RENT.prepare(check.sql).all()).results || []
    // Auto-close previously recorded issues of this type whose entity no longer
    // trips the invariant (data since fixed by staff or a later code change).
    // Without this, resolved problems sit in the queue forever and keep
    // open_exception_backlog pinned to CRITICAL.
    const stillOffending = (rows as any[]).map(r => String(r.id))
    const notInClause = stillOffending.length ? ` AND entity_id NOT IN (${stillOffending.map(() => '?').join(',')})` : ''
    await c.env.RENT.prepare(`UPDATE data_consistency_issues SET resolved_at = CURRENT_TIMESTAMP WHERE issue_type = ? AND resolved_at IS NULL${notInClause}`)
      .bind(check.issueType, ...stillOffending).run()
    for (const row of rows as any[]) {
      const result = await c.env.RENT.prepare('INSERT OR IGNORE INTO data_consistency_issues (id, issue_type, entity_type, entity_id, details_json) VALUES (?, ?, ?, ?, ?)')
        .bind(`dci-${nanoid(12)}`, check.issueType, check.entityType, row.id, JSON.stringify(row)).run() as any
      if (Number(result.meta?.changes ?? result.changes ?? 0) > 0) found++
      if (Number(result.meta?.changes ?? result.changes ?? 0) > 0 && check.autoSuspend) {
        const order = await c.env.RENT.prepare("SELECT id, status FROM orders WHERE id = ? AND status IN ('paid', 'active', 'extended', 'overdue')").bind(row.id).first() as any
        if (order) {
          const issue = await c.env.RENT.prepare('SELECT id FROM data_consistency_issues WHERE issue_type = ? AND entity_id = ? AND resolved_at IS NULL').bind(check.issueType, order.id).first() as any
          if (issue) {
            await c.env.RENT.prepare('INSERT OR IGNORE INTO anomalous_order_reviews (id, order_id, consistency_issue_id, anomaly_type, original_status) VALUES (?, ?, ?, ?, ?)').bind(`aor-${nanoid(12)}`, order.id, issue.id, check.issueType, order.status).run()
            await updateOrderStatus(c, order.id, 'suspended')
          }
        }
      }
    }
  }
  return found
}

// 系统健康监控（完善.md P8 #32）：所有健康检查（/admin/monitoring、/health、cron sweep）
// 共用这一份指标定义，避免同一段口径散落在多处后各自漂移。
//   kind='rate'  ：SQL 需 SELECT n（分子）与 d（分母），按 warn/crit 比率分级；d<=0 记 OK。
//   kind='count' ：SQL 只需 SELECT n，按 warn/crit 条数分级，不伪造分母。
export interface MonitorMetricDef {
  key: string
  label: string
  kind: MonitorMetricKind
  warn: number
  crit: number
  sql: string
  note?: string
}

const MONITOR_SNAPSHOT_RETENTION_DAYS = 30

export const MONITOR_METRIC_DEFS: MonitorMetricDef[] = [
  {
    key: 'api_error_rate', label: 'API 错误率（24h）', kind: 'rate', warn: 0.02, crit: 0.1,
    sql: `SELECT (SELECT COUNT(*) FROM error_logs WHERE error_level IN ('ERROR','FATAL') AND created_at > datetime('now','-1 day')) AS n, (SELECT COUNT(*) FROM error_logs WHERE created_at > datetime('now','-1 day')) AS d`
  },
  {
    key: 'payment_failure_rate', label: '付款失败率（24h）', kind: 'rate', warn: 0.1, crit: 0.3,
    sql: `SELECT SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS n, COUNT(*) AS d FROM payments WHERE created_at > datetime('now','-1 day')`
  },
  {
    key: 'webhook_failure_rate', label: 'Webhook 失败率（24h）', kind: 'rate', warn: 0.1, crit: 0.3,
    sql: `SELECT SUM(CASE WHEN status = 'FAILED' THEN 1 ELSE 0 END) AS n, COUNT(*) AS d FROM webhook_events WHERE received_at > datetime('now','-1 day')`
  },
  {
    key: 'email_failure_rate', label: '邮件失败率（24h）', kind: 'rate', warn: 0.1, crit: 0.3,
    sql: `SELECT SUM(CASE WHEN status = 'FAILED' THEN 1 ELSE 0 END) AS n, COUNT(*) AS d FROM email_events WHERE created_at > datetime('now','-1 day')`
  },
  // 离线判定按心跳时间：没有任何 sweep 会把 agent_status 从 'online' 改回 'offline'，
  // 只能靠 agent_last_seen_at 是否陈旧。5 分钟阈值与绑定设备页一致。
  {
    key: 'device_offline_rate', label: '设备离线率', kind: 'rate', warn: 0.2, crit: 0.5,
    sql: `SELECT SUM(CASE WHEN agent_last_seen_at IS NULL OR agent_last_seen_at <= datetime('now', '-5 minutes') THEN 1 ELSE 0 END) AS n, COUNT(*) AS d FROM devices WHERE agent_token_hash IS NOT NULL`
  },
  {
    key: 'remote_command_failure_rate', label: '远程命令失败率（24h）', kind: 'rate', warn: 0.15, crit: 0.4,
    sql: `SELECT SUM(CASE WHEN status = 'FAILED' THEN 1 ELSE 0 END) AS n, SUM(CASE WHEN status IN ('SUCCESS','FAILED','EXPIRED') THEN 1 ELSE 0 END) AS d FROM device_commands WHERE created_at > datetime('now','-1 day')`
  },
  {
    key: 'scheduled_job_failure_rate', label: '定时任务失败率（24h）', kind: 'rate', warn: 0.1, crit: 0.25,
    sql: `SELECT SUM(CASE WHEN status = 'FAILED' THEN 1 ELSE 0 END) AS n, COUNT(*) AS d FROM scheduled_job_runs WHERE started_at > datetime('now','-1 day')`
  },
  // 计数型：积压排除 MONITORING_ALERT 自身，否则「告警写回 data_consistency_issues → 抬高积压 → 再告警」自循环。
  {
    key: 'open_exception_backlog', label: '异常任务积压', kind: 'count', warn: 3, crit: 10,
    sql: `SELECT (SELECT COUNT(*) FROM data_consistency_issues WHERE resolved_at IS NULL AND issue_type <> 'MONITORING_ALERT') + (SELECT COUNT(*) FROM anomalous_order_reviews WHERE status = 'PENDING') AS n`,
    note: '未处理异常条数（WARN ≥3 / CRITICAL ≥10）'
  },
]

// 近 minutes 分钟内 ERROR/CRITICAL 日志计数。/api/system-status 与 /api/monitor 的实时错误探针共用，
// 用比 collectMonitoringMetrics（24h 口径）更短的窗口做即时告警。
export async function recentErrorLogCount(c: Context, minutes: number): Promise<{ total: number; critical: number }> {
  const row = await c.env.RENT.prepare(
    `SELECT COUNT(*) AS total, SUM(CASE WHEN error_level = 'CRITICAL' THEN 1 ELSE 0 END) AS critical
     FROM error_logs WHERE error_level IN ('ERROR', 'CRITICAL') AND datetime(created_at) >= datetime('now', ?)`,
  ).bind(`-${Math.max(1, Math.floor(minutes))} minutes`).first() as any
  return { total: Number(row?.total || 0), critical: Number(row?.critical || 0) }
}

// 每个指标独立 try/catch，缺表不影响其它指标。
export async function collectMonitoringMetrics(c: Context): Promise<MonitorMetric[]> {
  const metrics: MonitorMetric[] = []
  for (const def of MONITOR_METRIC_DEFS) {
    try {
      const row = await c.env.RENT.prepare(def.sql).first() as { n?: number; d?: number } | null
      const numerator = Number(row?.n || 0)
      if (def.kind === 'count') {
        const { level } = countHealth(numerator, def.warn, def.crit)
        metrics.push({ key: def.key, label: def.label, kind: 'count', numerator, denominator: 0, rate: 0, level, note: def.note })
      } else {
        const denominator = Number(row?.d || 0)
        const { rate, level } = rateHealth(numerator, denominator, def.warn, def.crit)
        metrics.push({ key: def.key, label: def.label, kind: 'rate', numerator, denominator, rate, level, note: def.note })
      }
    } catch {
      metrics.push({ key: def.key, label: def.label, kind: def.kind, numerator: 0, denominator: 0, rate: 0, level: 'OK', note: '无数据源' })
    }
  }
  return metrics
}

// 近 windowHours 内的指标快照，按 metric_key 分组、时间升序，供 /admin/monitoring 画趋势。
export async function getMonitoringHistory(c: Context, windowHours = 168): Promise<Record<string, MetricHistoryPoint[]>> {
  const out: Record<string, MetricHistoryPoint[]> = {}
  try {
    const rows = (await c.env.RENT.prepare(
      `SELECT metric_key, captured_at, rate, level FROM monitoring_metric_snapshots
       WHERE captured_at > datetime('now', ?) ORDER BY captured_at ASC`,
    ).bind(`-${Math.max(1, Math.floor(windowHours))} hours`).all()).results as any[]
    for (const r of rows || []) {
      const key = String(r.metric_key)
        ; (out[key] ||= []).push({ capturedAt: String(r.captured_at), rate: Number(r.rate) || 0, level: r.level as HealthLevel })
    }
  } catch { /* 快照表尚未迁移时静默降级为空趋势 */ }
  return out
}

// 调度步骤：跑一遍监控，落盘快照（并清理过期），若有 CRITICAL 指标则写入异常任务中心（去重按当天）。
// 指标恢复后自动关闭历史 MONITORING_ALERT 行，让告警可以自愈而不是永久堆积。
export async function runMonitoringSweep(c: Context): Promise<{ metrics: number; alerts: number; resolved: number }> {
  const metrics = await collectMonitoringMetrics(c)
  try {
    for (const m of metrics) {
      // count 型没有比率，用条数作为可绘制的量级存进 rate 列（level 列仍是权威分级）。
      const graphable = m.kind === 'count' ? m.numerator : m.rate
      await c.env.RENT.prepare(
        `INSERT INTO monitoring_metric_snapshots (id, metric_key, numerator, denominator, rate, level) VALUES (?, ?, ?, ?, ?, ?)`,
      ).bind(`mms-${nanoid(14)}`, m.key, m.numerator, m.denominator, graphable, m.level).run()
    }
    await c.env.RENT.prepare(
      `DELETE FROM monitoring_metric_snapshots WHERE captured_at < datetime('now', ?)`,
    ).bind(`-${MONITOR_SNAPSHOT_RETENTION_DAYS} days`).run()
  } catch { /* 快照表尚未迁移时不影响告警逻辑 */ }

  let alerts = 0
  for (const m of metrics.filter(x => x.level === 'CRITICAL')) {
    const res = await c.env.RENT.prepare('INSERT OR IGNORE INTO data_consistency_issues (id, issue_type, entity_type, entity_id, details_json) VALUES (?, ?, ?, ?, ?)')
      .bind(`dci-${nanoid(12)}`, 'MONITORING_ALERT', 'METRIC', `${m.key}:${new Date().toISOString().slice(0, 10)}`, JSON.stringify(m)).run() as any
    if (Number(res.meta?.changes ?? res.changes ?? 0) > 0) {
      alerts++
      // 当天首次出现的 CRITICAL 指标推送到已启用的通知渠道；尽力而为。
      try {
        await dispatchChannelAlert(c, {
          title: `监控告警：${(m as any).label || m.key}`,
          message: `指标 ${m.key} 触发 CRITICAL${(m as any).detail ? `：${(m as any).detail}` : ''}。请打开 /admin/monitoring 查看。`,
          url: new URL('/admin/monitoring', c.req.url).toString(),
        })
      } catch (error: any) {
        console.error('monitoring alert dispatch failed:', error?.message || error)
      }
    }
  }
  const criticalKeys = metrics.filter(x => x.level === 'CRITICAL').map(x => x.key)
  const openAlerts = ((await c.env.RENT.prepare("SELECT id, entity_id FROM data_consistency_issues WHERE issue_type = 'MONITORING_ALERT' AND resolved_at IS NULL").all()).results || []) as Array<{ id: string; entity_id: string }>
  const staleIds = staleMonitoringAlertIds(openAlerts, criticalKeys)
  let resolved = 0
  if (staleIds.length) {
    await c.env.RENT.batch(staleIds.map(id => c.env.RENT.prepare("UPDATE data_consistency_issues SET resolved_at = CURRENT_TIMESTAMP WHERE id = ? AND resolved_at IS NULL").bind(id)))
    resolved = staleIds.length
  }
  return { metrics: metrics.length, alerts, resolved }
}

export async function updateOrderStatus(c: Context, orderId: string, status: string, options?: { reason?: string; triggeredBy?: string; expectedStatus?: string }): Promise<boolean> {
  const db = getDB(c);
  const mapping: Record<string, { order: string, payment: string, rental: string }> = {
    pending_approval: { order: 'PENDING', payment: 'UNPAID', rental: 'PENDING' },
    approved: { order: 'AWAITING_PAYMENT', payment: 'UNPAID', rental: 'AWAITING_PAYMENT' },
    pending_payment: { order: 'AWAITING_PAYMENT', payment: 'UNPAID', rental: 'PENDING' },
    awaiting_signature: { order: 'AWAITING_SIGNATURE', payment: 'UNPAID', rental: 'AWAITING_SIGNATURE' },
    paid: { order: 'CONFIRMED', payment: 'PAID', rental: 'READY_FOR_PICKUP' },
    pending_pickup: { order: 'READY_FOR_PICKUP', payment: 'PAID', rental: 'READY_FOR_PICKUP' },
    active: { order: 'ACTIVE', payment: 'PAID', rental: 'ACTIVE' },
    extended: { order: 'EXTENDED', payment: 'PAID', rental: 'EXTENDED' },
    overdue: { order: 'OVERDUE', payment: 'PAID', rental: 'OVERDUE' },
    suspended: { order: 'SUSPENDED', payment: 'PAID', rental: 'SUSPENDED' },
    pending_return: { order: 'RETURN_PENDING', payment: 'PAID', rental: 'RETURN_PENDING' },
    returned: { order: 'RETURNED', payment: 'PAID', rental: 'RETURNED' },
    completed: { order: 'COMPLETED', payment: 'PAID', rental: 'COMPLETED' },
    cancelled: { order: 'CANCELLED', payment: 'PAYMENT_FAILED', rental: 'CANCELLED' },
  }
  const next = mapping[status] || { order: status.toUpperCase(), payment: 'UNPAID', rental: status.toUpperCase() }
  const previous = await db.prepare('SELECT deviceId, rental_status, deposit_status, depositAmount, deposit_payment_mode, is_manual, payment_status FROM orders WHERE id = ?').bind(orderId).first() as any
  if (previous?.is_manual === 1 && previous.payment_status === 'UNPAID' && next.payment === 'PAID' && !['paid', 'pending_pickup'].includes(status)) next.payment = 'UNPAID'
  const result = await db.prepare(`UPDATE orders SET status = ?, order_status = ?, payment_status = ?, rental_status = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?${options?.expectedStatus ? ' AND status = ?' : ''}`)
    .bind(status, next.order, next.payment, next.rental, orderId, ...(options?.expectedStatus ? [options.expectedStatus] : [])).run();
  if (options?.expectedStatus && !Number(result.meta?.changes ?? result.changes ?? 0)) return false
  // 归还时间独立于押金结算，覆盖免押金、预授权和已持有押金的订单。
  if (status === 'returned' || status === 'completed') {
    await db.prepare("UPDATE orders SET return_received_at = COALESCE(return_received_at, CURRENT_TIMESTAMP) WHERE id = ?").bind(orderId).run()
  }
  if (next.payment === 'PAID' && Number(previous?.depositAmount || 0) > 0 && String(previous?.deposit_payment_mode || 'PAID') === 'PAID' && ['PENDING', 'PAID'].includes(String(previous?.deposit_status || 'PENDING'))) {
    await db.prepare("UPDATE orders SET deposit_status = 'HELD', deposit_paid_at = COALESCE(deposit_paid_at, CURRENT_TIMESTAMP), deposit_held_amount = depositAmount WHERE id = ?").bind(orderId).run()
  }
  if (status === 'completed') {
    if (previous?.deviceId) await releaseDeviceIfUnbooked(c, previous.deviceId)
    // “已完成”只代表租赁流程走完，跟押金是否结清是两回事——这里单独刷新
    // settlement_status，读取本次调用之后的最终 deposit_status（上面 HELD 分支
    // 可能刚改过）。updateOrderStatus 是所有普通状态流转的统一入口，在这里做
    // 是唯一能覆盖到强制完成 / 自动流转等所有路径的地方。
    const depositState = await db.prepare('SELECT deposit_status, overdue_outstanding_amount FROM orders WHERE id = ?').bind(orderId).first() as any
    await db.prepare('UPDATE orders SET settlement_status = ? WHERE id = ?').bind(computeOrderSettlementStatus({ status: 'completed', deposit_status: depositState?.deposit_status, overdue_outstanding_amount: depositState?.overdue_outstanding_amount }), orderId).run()
  }
  if (previous && previous.rental_status !== next.rental) {
    const reason = options?.reason?.trim()
    if (reason && options?.triggeredBy) {
      await db.prepare('INSERT INTO rental_status_history (id, rental_id, old_status, new_status, trigger_type, triggered_by, reason) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(`rsh-${nanoid(16)}`, orderId, previous.rental_status || null, next.rental, 'MANUAL', options.triggeredBy, reason).run()
    } else {
      await db.prepare('INSERT INTO rental_status_history (id, rental_id, old_status, new_status, trigger_type, reason) VALUES (?, ?, ?, ?, ?, ?)').bind(`rsh-${nanoid(16)}`, orderId, previous.rental_status || null, next.rental, 'SYSTEM', reason || '订单状态同步').run()
    }
  }
  const lifecycleByOrderStatus: Partial<Record<string, DeviceLifecycleStatus>> = { paid: 'RESERVED', pending_pickup: 'RESERVED', active: 'RENTED', extended: 'RENTED', overdue: 'RENTED', suspended: 'RENTED', pending_return: 'INSPECTION' }
  const lifecycleStatus = lifecycleByOrderStatus[status]
  if (previous?.deviceId && lifecycleStatus) await recordDeviceLifecycle(c, previous.deviceId, lifecycleStatus, { orderId, reason: `订单状态：${status}` })
  await syncReferralOrderState(c, orderId, next.rental)
  if (status === 'cancelled') {
    // 订单取消时同步作废关联合同（含已签署但尚未完成的合同）；已完成/已过期/已取消的合同保持原状态不变。
    await db.prepare("UPDATE contracts SET status = 'cancelled', updatedAt = CURRENT_TIMESTAMP WHERE orderId = ? AND status IN ('draft', 'pending_sign', 'signed')").bind(orderId).run()
    // Dynamic import avoids a static circular dependency (actions/coupons.ts imports
    // recordFinancialLedgerEntry from this file).
    const { releaseCouponForOrder } = await import('./actions/coupons')
    await releaseCouponForOrder(c, orderId)
  }
  return true
}

// ---------------------------------------------------------------------------
// 通用 Webhook 幂等 (TODO.md P7 / 完善.md)
//
// Stripe、设备回调、未来第三方服务共用一张 webhook_events：provider + event_id
// 唯一，保证同一事件只产生一次业务副作用，并可安全重试。
// ---------------------------------------------------------------------------

export type WebhookClaim =
  | { firstDelivery: true; recordId: string }
  | { firstDelivery: false; status: 'RECEIVED' | 'PROCESSED' | 'FAILED'; recordId: string }

// 记录一次 webhook 投递。首次投递写入 RECEIVED 并返回 firstDelivery=true；
// 重复投递返回既有记录的状态（并累加 attempts），调用方据此决定跳过或重跑。
export async function claimWebhookEvent(
  c: Context,
  input: { provider: string; eventId: string; eventType?: string; payloadHash?: string },
): Promise<WebhookClaim> {
  const db = getDB(c)
  const id = `wh-${nanoid(16)}`
  const inserted = await db.prepare(
    `INSERT INTO webhook_events (id, provider, event_id, event_type, payload_hash, status)
     VALUES (?, ?, ?, ?, ?, 'RECEIVED')
     ON CONFLICT(provider, event_id) DO NOTHING`,
  ).bind(id, input.provider, input.eventId, input.eventType ?? null, input.payloadHash ?? null).run() as any
  if (Number(inserted.meta?.changes ?? inserted.changes ?? 0) > 0) {
    return { firstDelivery: true, recordId: id }
  }
  const existing = await db.prepare(
    'SELECT id, status FROM webhook_events WHERE provider = ? AND event_id = ?',
  ).bind(input.provider, input.eventId).first() as any
  await db.prepare(
    'UPDATE webhook_events SET attempts = attempts + 1 WHERE provider = ? AND event_id = ?',
  ).bind(input.provider, input.eventId).run()
  return { firstDelivery: false, status: String(existing?.status || 'RECEIVED') as any, recordId: String(existing?.id || '') }
}

export async function markWebhookProcessed(c: Context, recordId: string): Promise<void> {
  await getDB(c).prepare(
    "UPDATE webhook_events SET status = 'PROCESSED', processed_at = CURRENT_TIMESTAMP, failure_reason = NULL WHERE id = ?",
  ).bind(recordId).run()
}

export async function markWebhookFailed(c: Context, recordId: string, reason: string): Promise<void> {
  await getDB(c).prepare(
    "UPDATE webhook_events SET status = 'FAILED', failure_reason = ? WHERE id = ?",
  ).bind(String(reason || '').slice(0, 500), recordId).run()
}


// D1 包装：读取订单相关行并跑纯对账。
export async function reconcileOrderPayments(c: Context, orderId: string): Promise<ReconResult> {
  const db = getDB(c)
  const [payments, refunds] = await Promise.all([
    db.prepare(`SELECT p.id, p.amount, p.processing_fee, p.status,
      CASE WHEN p.status = 'pending' AND p.payment_method = 'card' AND p.stripe_payment_intent_id = o.stripe_deposit_payment_intent_id
        AND o.deposit_payment_mode = 'PREAUTH' AND o.deposit_status IN ('HELD', 'REFUND_PENDING') THEN 1 ELSE 0 END AS is_authorization
      FROM payments p LEFT JOIN orders o ON o.id = p.rental_id WHERE p.rental_id = ?`).bind(orderId).all().then((r: any) => (r.results || []) as any[]),
    db.prepare('SELECT id, payment_id, refund_amount, status FROM payment_refunds WHERE order_id = ?').bind(orderId).all().then((r: any) => (r.results || []) as any[]),
  ])
  const paymentRows = payments as any[]
  const refundRows = refunds as any[]
  const paymentIds = paymentRows.map((p: any) => p.id)
  const inClause = paymentIds.map(() => '?').join(',') || "''"
  const [paymentAllocations, refundAllocations] = await Promise.all([
    paymentIds.length ? db.prepare(`SELECT payment_id, amount FROM payment_allocations WHERE payment_id IN (${inClause})`).bind(...paymentIds).all().then((r: any) => (r.results || []) as any[]) : Promise.resolve([] as any[]),
    refundRows.length ? db.prepare(`SELECT refund_id, payment_id, amount FROM refund_allocations WHERE refund_id IN (${refundRows.map(() => '?').join(',')})`).bind(...refundRows.map((r: any) => r.id)).all().then((r: any) => (r.results || []) as any[]) : Promise.resolve([] as any[]),
  ])
  return evaluatePaymentReconciliation({ payments: paymentRows, paymentAllocations, refunds: refundRows, refundAllocations })
}

// Compatibility aliases expected by legacy code
// 定期清理过期和已取消的合同
export async function cleanupExpiredAndCancelledContracts(c: Context): Promise<number> {
  const db = getDB(c)
  const now = new Date().toISOString()

  // 删除条件：
  // 1. 已过期且未签署的合同 (status = 'pending_sign' 且 signExpiresAt < 当前时间)
  // 2. 已被取消的合同，且取消时间超过7天 (status = 'cancelled' 且 updatedAt < 7天前)
  const sevenDaysAgo = new Date()
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
  const sevenDaysAgoISO = sevenDaysAgo.toISOString()

  try {
    const expiredResult = await db.prepare(`
      UPDATE contracts SET status = 'cancelled', updatedAt = CURRENT_TIMESTAMP
      WHERE status = 'pending_sign' AND (signExpiresAt < ? OR sign_expires_at < ?)
    `).bind(now, now).run()
    const deletedResult = await db.prepare(`
      UPDATE contracts SET deleted_at = CURRENT_TIMESTAMP WHERE status = 'cancelled' AND updatedAt < ? AND deleted_at IS NULL
    `).bind(sevenDaysAgoISO).run()

    const changedCount = Number(expiredResult.meta?.changes || 0) + Number(deletedResult.meta?.changes || 0)
    if (changedCount > 0) {
      await logError(c, 'INFO', `Updated or cleaned up ${changedCount} expired/cancelled contracts`)
    }
    return changedCount
  } catch (error) {
    await logError(c, 'ERROR', 'Failed to cleanup expired/cancelled contracts', error as Error)
    return 0
  }
}

export async function cleanupExpiredGuestAccounts(c: Context): Promise<number> {
  // 访客租期结束后先立即撤销登录权限并清除凭据；保留匿名业务记录，避免破坏合同/订单/付款外键。
  const expired = await c.env.RENT.prepare(`
    SELECT id FROM users
    WHERE account_type = 'guest' AND guest_expires_at IS NOT NULL
      AND date(guest_expires_at) < date('now')
  `).all() as any
  const ids = (expired.results || []).map((row: any) => String(row.id))
  if (!ids.length) return 0
  const placeholders = ids.map(() => '?').join(', ')
  await c.env.RENT.batch([
    c.env.RENT.prepare(`DELETE FROM auth_sessions WHERE user_id IN (${placeholders})`).bind(...ids),
    c.env.RENT.prepare(`UPDATE users SET account_type = 'deleted_guest', status = 'inactive', email = 'deleted-guest-' || id || '@invalid.local', phone = NULL, bsb = NULL, account_number = NULL, password_hash = 'disabled', password_salt = 'disabled', guest_order_id = NULL, guest_expires_at = NULL, deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id IN (${placeholders})`).bind(...ids),
  ])

  return ids.length
}

// 每次 loadSystemSettingsFromDB 都要跑一次 D1 查询 + 对约 10 个富文本字段做
// sanitize-html（CPU 密集，整体 ~500ms）。设置极少变化，用 isolate 级短 TTL 缓存把
// 连续调用（设备端轮询、各页面渲染）挡在重复计算之前。updateSystemSettings 会失效它。
const SYSTEM_SETTINGS_CACHE_TTL_MS = 30_000
let systemSettingsLoadedAt = 0

export function invalidateSystemSettingsCache(): void {
  systemSettingsLoadedAt = 0
}

export async function loadSystemSettingsFromDB(c: Context): Promise<typeof systemSettings> {
  if (systemSettingsLoadedAt && Date.now() - systemSettingsLoadedAt < SYSTEM_SETTINGS_CACHE_TTL_MS) {
    return systemSettings
  }
  const db = getDB(c)
  const rows = await db.prepare('SELECT key, value FROM systemSettings WHERE deleted_at IS NULL').all() as any
  systemSettingsLoadedAt = Date.now()
  const values = new Map<SystemSettingsKey, string>((rows.results || []).map((row: any) => [row.key, row.value]))
  const userTermsValue = values.get('userTerms')
  const rentalTermsValue = values.get('rentalTerms')
  const serviceTermsValue = values.get('serviceTerms')
  const privacyPolicyValue = values.get('privacyPolicy')
  const softwareTermsValue = values.get('softwareTerms')
  const copyrightNoticeValue = values.get('copyrightNotice')
  const cookiePolicyValue = values.get('cookiePolicy')
  const complaintsPolicyValue = values.get('complaintsPolicy')
  const acceptableUsePolicyValue = values.get('acceptableUsePolicy')
  const consumerRightsValue = values.get('consumerRights')
  const userTermsEnValue = values.get('userTermsEn')
  const rentalTermsEnValue = values.get('rentalTermsEn')
  const serviceTermsEnValue = values.get('serviceTermsEn')
  const privacyPolicyEnValue = values.get('privacyPolicyEn')
  const softwareTermsEnValue = values.get('softwareTermsEn')
  const copyrightNoticeEnValue = values.get('copyrightNoticeEn')
  const cookiePolicyEnValue = values.get('cookiePolicyEn')
  const complaintsPolicyEnValue = values.get('complaintsPolicyEn')
  const acceptableUsePolicyEnValue = values.get('acceptableUsePolicyEn')
  const consumerRightsEnValue = values.get('consumerRightsEn')
  const paymentMethodsValue = values.get('paymentMethods')
  const bankDetailsValue = values.get('bankDetails')
  const rmbPaymentValue = values.get('rmbPayment')
  const referralSettingsValue = values.get('referralSettings')
  const companyDetailsValue = values.get('companyDetails')
  const taxInvoiceTemplateValue = values.get('taxInvoiceTemplate')
  const rentalRulesValue = values.get('rentalRules')
  const registrationSettingsValue = values.get('registrationSettings')
  const notificationSettingsValue = values.get('notificationSettings')
  const legalMetadataValue = values.get('legalMetadata')
  const tallyFormUrlValue = values.get('tallyFormUrl')
  const feedbackRewardsValue = values.get('feedbackRewards')

  // Only update values that actually exist in the database AND are non-empty
  // to prevent overwriting database-backed content with empty defaults or null values
  if (String(userTermsValue || '').trim()) systemSettings.userTerms = sanitizeRichHtml(userTermsValue)
  if (String(rentalTermsValue || '').trim()) systemSettings.rentalTerms = sanitizeRichHtml(rentalTermsValue)
  if (String(serviceTermsValue || '').trim()) systemSettings.serviceTerms = sanitizeRichHtml(serviceTermsValue)
  if (String(privacyPolicyValue || '').trim()) systemSettings.privacyPolicy = sanitizeRichHtml(privacyPolicyValue)
  if (String(softwareTermsValue || '').trim()) systemSettings.softwareTerms = sanitizeRichHtml(softwareTermsValue)
  if (String(copyrightNoticeValue || '').trim()) systemSettings.copyrightNotice = sanitizeRichHtml(copyrightNoticeValue)
  if (String(cookiePolicyValue || '').trim()) systemSettings.cookiePolicy = sanitizeRichHtml(cookiePolicyValue)
  if (String(complaintsPolicyValue || '').trim()) systemSettings.complaintsPolicy = sanitizeRichHtml(complaintsPolicyValue)
  if (String(acceptableUsePolicyValue || '').trim()) systemSettings.acceptableUsePolicy = sanitizeRichHtml(acceptableUsePolicyValue)
  if (String(consumerRightsValue || '').trim()) systemSettings.consumerRights = sanitizeRichHtml(consumerRightsValue)
  // English versions are optional placeholder translations: an admin may clear
  // them intentionally, so only overwrite the in-memory value when the DB row
  // is actually non-empty (same "don't overwrite with empty" rule as above).
  if (String(userTermsEnValue || '').trim()) systemSettings.userTermsEn = sanitizeRichHtml(userTermsEnValue)
  if (String(rentalTermsEnValue || '').trim()) systemSettings.rentalTermsEn = sanitizeRichHtml(rentalTermsEnValue)
  if (String(serviceTermsEnValue || '').trim()) systemSettings.serviceTermsEn = sanitizeRichHtml(serviceTermsEnValue)
  if (String(privacyPolicyEnValue || '').trim()) systemSettings.privacyPolicyEn = sanitizeRichHtml(privacyPolicyEnValue)
  if (String(softwareTermsEnValue || '').trim()) systemSettings.softwareTermsEn = sanitizeRichHtml(softwareTermsEnValue)
  if (String(copyrightNoticeEnValue || '').trim()) systemSettings.copyrightNoticeEn = sanitizeRichHtml(copyrightNoticeEnValue)
  if (String(cookiePolicyEnValue || '').trim()) systemSettings.cookiePolicyEn = sanitizeRichHtml(cookiePolicyEnValue)
  if (String(complaintsPolicyEnValue || '').trim()) systemSettings.complaintsPolicyEn = sanitizeRichHtml(complaintsPolicyEnValue)
  if (String(acceptableUsePolicyEnValue || '').trim()) systemSettings.acceptableUsePolicyEn = sanitizeRichHtml(acceptableUsePolicyEnValue)
  if (String(consumerRightsEnValue || '').trim()) systemSettings.consumerRightsEn = sanitizeRichHtml(consumerRightsEnValue)
  const parsedLegalMetadata = safeJsonParse<any>(legalMetadataValue)
  if (parsedLegalMetadata) systemSettings.legalMetadata = { ...systemSettings.legalMetadata, ...parsedLegalMetadata }

  const parsedPaymentMethods = safeJsonParse<typeof systemSettings.paymentMethods>(paymentMethodsValue)
  const parsedBankDetails = safeJsonParse<typeof systemSettings.bankDetails>(bankDetailsValue)
  const parsedRmbPayment = safeJsonParse<typeof systemSettings.rmbPayment>(rmbPaymentValue)
  const parsedReferralSettings = safeJsonParse<typeof systemSettings.referralSettings>(referralSettingsValue)
  const parsedCompanyDetails = safeJsonParse<typeof systemSettings.companyDetails>(companyDetailsValue)
  const parsedTaxInvoiceTemplate = safeJsonParse<typeof systemSettings.taxInvoiceTemplate>(taxInvoiceTemplateValue)
  const parsedRentalRules = safeJsonParse<typeof systemSettings.rentalRules>(rentalRulesValue)
  const parsedRegistrationSettings = safeJsonParse<typeof systemSettings.registrationSettings>(registrationSettingsValue)
  const parsedNotificationSettings = safeJsonParse<typeof systemSettings.notificationSettings>(notificationSettingsValue)
  const parsedFeedbackRewards = safeJsonParse<typeof systemSettings.feedbackRewards>(feedbackRewardsValue)

  if (parsedPaymentMethods) {
    systemSettings.paymentMethods = {
      stripe: Boolean((parsedPaymentMethods as any).stripe),
      square: Boolean((parsedPaymentMethods as any).square),
      bankTransfer: Boolean((parsedPaymentMethods as any).bankTransfer),
      balancePayment: (parsedPaymentMethods as any).balancePayment === undefined
        ? systemSettings.paymentMethods.balancePayment
        : Boolean((parsedPaymentMethods as any).balancePayment),
      processingFeeRate: 0,
      squareProcessingFeeRate: Math.min(1, Math.max(0, Number((parsedPaymentMethods as any).squareProcessingFeeRate ?? systemSettings.paymentMethods.squareProcessingFeeRate ?? 0.022))),
      alipay: Boolean((parsedPaymentMethods as any).alipay),
      wechat: Boolean((parsedPaymentMethods as any).wechat),
    }
  }
  // Older deployments stored bank details without bankName. Keep the current
  // shape when loading those rows so all bank fields remain available to the UI.
  if (parsedBankDetails) systemSettings.bankDetails = { ...systemSettings.bankDetails, ...parsedBankDetails }
  if (parsedRmbPayment) systemSettings.rmbPayment = { ...systemSettings.rmbPayment, ...parsedRmbPayment }
  if (parsedReferralSettings) systemSettings.referralSettings = normalizeReferralSettings(parsedReferralSettings)
  if (parsedCompanyDetails) systemSettings.companyDetails = { ...systemSettings.companyDetails, ...parsedCompanyDetails }
  if (parsedTaxInvoiceTemplate) systemSettings.taxInvoiceTemplate = { ...systemSettings.taxInvoiceTemplate, ...parsedTaxInvoiceTemplate }
  if (parsedRentalRules) systemSettings.rentalRules = { ...systemSettings.rentalRules, ...parsedRentalRules }
  if (parsedRegistrationSettings) systemSettings.registrationSettings = { ...systemSettings.registrationSettings, ...parsedRegistrationSettings }
  if (parsedNotificationSettings) systemSettings.notificationSettings = {
    ...systemSettings.notificationSettings,
    defaultDelivery: ['in_app_only', 'email_only'].includes(parsedNotificationSettings.defaultDelivery) ? parsedNotificationSettings.defaultDelivery : 'in_app_email',
  }
  if (tallyFormUrlValue !== undefined) systemSettings.tallyFormUrl = normalizeTallyEmbedUrl(tallyFormUrlValue)
  if (parsedFeedbackRewards) {
    systemSettings.feedbackRewards = {
      ...systemSettings.feedbackRewards,
      enabled: Boolean(parsedFeedbackRewards.enabled),
      rewardType: ['BALANCE', 'COUPON', 'GIFT_CARD'].includes(String(parsedFeedbackRewards.rewardType)) ? parsedFeedbackRewards.rewardType : systemSettings.feedbackRewards.rewardType,
      balanceAmount: Math.min(10000, Math.max(0, Number(parsedFeedbackRewards.balanceAmount) || 0)),
      balanceAmountMin: Math.min(10000, Math.max(0, Number(parsedFeedbackRewards.balanceAmountMin ?? parsedFeedbackRewards.balanceAmount) || 0)),
      balanceAmountMax: Math.min(10000, Math.max(0, Number(parsedFeedbackRewards.balanceAmountMax ?? parsedFeedbackRewards.balanceAmount) || 0)),
      couponDiscountType: parsedFeedbackRewards.couponDiscountType === 'percent' ? 'percent' : 'fixed',
      couponDiscountValue: Math.min(10000, Math.max(0, Number(parsedFeedbackRewards.couponDiscountValue) || 0)),
      couponDiscountValueMin: Math.min(10000, Math.max(0, Number(parsedFeedbackRewards.couponDiscountValueMin ?? parsedFeedbackRewards.couponDiscountValue) || 0)),
      couponDiscountValueMax: Math.min(10000, Math.max(0, Number(parsedFeedbackRewards.couponDiscountValueMax ?? parsedFeedbackRewards.couponDiscountValue) || 0)),
      couponExpiresDays: Math.min(365, Math.max(1, Math.floor(Number(parsedFeedbackRewards.couponExpiresDays) || 30))),
    }
  }

  systemSettingsLoadedAt = Date.now()
  return systemSettings
}

/** 返回设备实际使用的租赁规则；设备未单独配置的项目继承全局设置。 */
export async function getDeviceRentalRules(c: Context, deviceId: string): Promise<typeof systemSettings.rentalRules> {
  await loadSystemSettingsFromDB(c)
  const globalRules = getSystemSettings().rentalRules
  const device = await getDeviceById(c, deviceId)
  if (!device) return globalRules

  const deviceDates = ((await c.env.RENT.prepare(
    'SELECT unavailable_date FROM device_unavailable_dates WHERE device_id = ? AND deleted_at IS NULL ORDER BY unavailable_date'
  ).bind(deviceId).all().catch(() => ({ results: [] }))).results || [])
    .map((row: any) => String(row.unavailable_date).slice(0, 10))

  const deviceSlots = ((await c.env.RENT.prepare(
    'SELECT unavailable_date, time_slot FROM device_unavailable_time_slots WHERE device_id = ? AND deleted_at IS NULL ORDER BY unavailable_date, time_slot'
  ).bind(deviceId).all().catch(() => ({ results: [] }))).results || []) as any[]
  const unavailableTimeSlots: Record<string, string[]> = Object.fromEntries(
    Object.entries(globalRules.unavailableTimeSlots || {}).map(([date, slots]) => [date, [...slots]])
  )
  for (const row of deviceSlots) {
    const date = String(row.unavailable_date).slice(0, 10)
    const slots = unavailableTimeSlots[date] || []
    if (!slots.includes(String(row.time_slot))) slots.push(String(row.time_slot))
    unavailableTimeSlots[date] = slots
  }

  const deviceMinimum = Number(device.minimumRentalDays ?? device.minimum_rental_days)
  const deviceBuffer = Number(device.bufferDays ?? device.buffer_days)
  return {
    ...globalRules,
    unavailableDates: [...new Set([...(globalRules.unavailableDates || []), ...deviceDates])],
    unavailableTimeSlots,
    minimumRentalDays: Number.isInteger(deviceMinimum) && deviceMinimum >= 1 ? deviceMinimum : globalRules.minimumRentalDays,
    bufferDays: Number.isInteger(deviceBuffer) && deviceBuffer >= 0 ? deviceBuffer : globalRules.bufferDays,
  }
}

export async function updateSystemSettings(c: Context, updates: Partial<typeof systemSettings>): Promise<typeof systemSettings> {
  Object.assign(systemSettings, updates)
  invalidateSystemSettingsCache()

  const db = getDB(c)

  const write = async (key: SystemSettingsKey, value: any) => {
    const serialized = typeof value === 'string' ? value : JSON.stringify(value)
    await db.prepare(`
      INSERT INTO systemSettings (key, value)
      VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updatedAt = CURRENT_TIMESTAMP, deleted_at = NULL
    `).bind(key, serialized).run()
    const saved = await db.prepare('SELECT value FROM systemSettings WHERE key = ? AND deleted_at IS NULL').bind(key).first() as any
    if (String(saved?.value ?? '') !== serialized) throw new Error(`系统设置保存校验失败：${key}`)
  }

  // Only write fields that were explicitly provided in the updates object
  // to prevent accidentally overwriting other fields with stale or default values
  const fieldsToWrite: Array<[SystemSettingsKey, any]> = [
    ['userTerms', systemSettings.userTerms],
    ['rentalTerms', systemSettings.rentalTerms],
    ['serviceTerms', systemSettings.serviceTerms],
    ['privacyPolicy', systemSettings.privacyPolicy],
    ['softwareTerms', systemSettings.softwareTerms],
    ['copyrightNotice', systemSettings.copyrightNotice],
    ['cookiePolicy', systemSettings.cookiePolicy],
    ['complaintsPolicy', systemSettings.complaintsPolicy],
    ['acceptableUsePolicy', systemSettings.acceptableUsePolicy],
    ['consumerRights', systemSettings.consumerRights],
    ['userTermsEn', systemSettings.userTermsEn],
    ['rentalTermsEn', systemSettings.rentalTermsEn],
    ['serviceTermsEn', systemSettings.serviceTermsEn],
    ['privacyPolicyEn', systemSettings.privacyPolicyEn],
    ['softwareTermsEn', systemSettings.softwareTermsEn],
    ['copyrightNoticeEn', systemSettings.copyrightNoticeEn],
    ['cookiePolicyEn', systemSettings.cookiePolicyEn],
    ['complaintsPolicyEn', systemSettings.complaintsPolicyEn],
    ['acceptableUsePolicyEn', systemSettings.acceptableUsePolicyEn],
    ['consumerRightsEn', systemSettings.consumerRightsEn],
    ['paymentMethods', systemSettings.paymentMethods],
    ['bankDetails', systemSettings.bankDetails],
    ['rmbPayment', systemSettings.rmbPayment],
    ['referralSettings', systemSettings.referralSettings],
    ['companyDetails', systemSettings.companyDetails],
    ['taxInvoiceTemplate', systemSettings.taxInvoiceTemplate],
    ['rentalRules', systemSettings.rentalRules],
    ['legalMetadata', systemSettings.legalMetadata],
    ['registrationSettings', systemSettings.registrationSettings],
    ['notificationSettings', systemSettings.notificationSettings],
    ['tallyFormUrl', systemSettings.tallyFormUrl],
    ['feedbackRewards', systemSettings.feedbackRewards],
  ]

  for (const [key, value] of fieldsToWrite) {
    if (key in updates) {
      // Prevent writing empty content for text fields that must have content
      const textContentFields = new Set(['userTerms', 'rentalTerms', 'serviceTerms', 'privacyPolicy', 'softwareTerms', 'copyrightNotice', 'cookiePolicy', 'complaintsPolicy', 'acceptableUsePolicy', 'consumerRights'])
      if (textContentFields.has(key) && typeof value === 'string' && !String(value).trim()) {
        console.warn(`Skipping empty content for field: ${key}`)
        continue
      }
      await write(key, value)
    }
  }

  return systemSettings
}

export async function updateContractTemplateInDB(c: Context, newTemplate: { id: string; name: string; content: string }) {
  return updateContractTemplate(c, newTemplate)
}



function escapeContractValue(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] || char))
}

function maskContractValue(name: string, value: unknown): string {
  const text = String(value ?? '')
  if (!text) return ''
  if (name === 'customer_id_number') return text.length <= 4 ? '****' : `${text.slice(0, 2)}${'*'.repeat(Math.max(2, text.length - 4))}${text.slice(-2)}`
  if (name === 'customer_dob') return '****-**-**'
  if (name === 'customer_address') return text.length > 8 ? `${text.slice(0, 8)}****` : '****'
  if (name === 'esign_ip') return text.includes(':') ? `${text.split(':').slice(0, 2).join(':')}:****` : `${text.split('.').slice(0, 2).join('.')}.*.*`
  return text
}

export const CONTRACT_VARIABLE_NAMES = [
  'contract_number', 'agreement_version', 'contract_status', 'created_time', 'updated_time', 'jurisdiction',
  'company_name', 'company_abn', 'company_address', 'company_phone', 'company_email', 'company_website', 'company_logo',
  'customer_name', 'customer_phone', 'customer_email', 'customer_address', 'customer_dob', 'customer_country', 'customer_id_type', 'customer_id_number', 'customer_driver_expiry', 'emergency_contact', 'emergency_phone',
  'device_id', 'asset_tag', 'device_name', 'device_brand', 'device_model', 'device_cpu', 'device_ram', 'device_storage', 'device_gpu', 'device_os', 'device_sn', 'charger_sn', 'battery_health', 'battery_cycles', 'device_condition', 'device_accessories',
  'start_date', 'end_date', 'rental_days', 'pickup_location', 'return_location', 'delivery_method', 'delivery_fee', 'return_method', 'return_date', 'return_status',
  'currency', 'daily_rate', 'subtotal', 'gst_included', 'gst_amount', 'discount', 'coupon_code', 'total_rent', 'deposit_amount', 'deposit_paid', 'rent_paid', 'amount_due', 'payment_method', 'payment_date', 'payment_reference',
  'bank_name', 'account_name', 'bank_bsb', 'bank_account',
  'late_days', 'late_fee_per_day', 'late_fee',
  'inspection_date', 'inspection_by', 'screen_condition', 'keyboard_condition', 'trackpad_condition', 'body_condition', 'camera_condition', 'wifi_condition', 'power_test', 'inspection_notes',
  'damage_description', 'damage_photos', 'repair_cost', 'replacement_cost', 'deduction_amount', 'repair_invoice',
  'deposit_refund', 'refund_amount', 'refund_date',
  'signer_name', 'sign_time', 'esign_signature', 'company_signature', 'esign_ip', 'esign_device', 'esign_browser', 'esign_os',
  'company_representative', 'customer_initials', 'insurance_selected', 'insurance_fee',
  'pickup_time', 'return_time', 'accessories_returned', 'customer_acknowledgement',
  'created_by', 'approved_by', 'notes', 'qr_code', 'contract_url', 'invoice_number', 'invoice_url',
] as const

export const CONTRACT_VARIABLE_GROUPS = [
  ['合同', ['contract_number', 'agreement_version', 'contract_status', 'created_time', 'updated_time', 'jurisdiction']],
  ['公司', ['company_name', 'company_abn', 'company_address', 'company_phone', 'company_email', 'company_website', 'company_logo']],
  ['客户', ['customer_name', 'customer_phone', 'customer_email', 'customer_address', 'customer_dob', 'customer_country', 'customer_id_type', 'customer_id_number', 'customer_driver_expiry', 'emergency_contact', 'emergency_phone']],
  ['设备', ['device_id', 'asset_tag', 'device_name', 'device_brand', 'device_model', 'device_cpu', 'device_ram', 'device_storage', 'device_gpu', 'device_os', 'device_sn', 'charger_sn', 'battery_health', 'battery_cycles', 'device_condition', 'device_accessories']],
  ['租赁', ['start_date', 'end_date', 'rental_days', 'pickup_location', 'return_location', 'delivery_method', 'delivery_fee', 'return_method', 'return_date', 'return_status']],
  ['付款', ['currency', 'daily_rate', 'subtotal', 'gst_included', 'gst_amount', 'discount', 'coupon_code', 'total_rent', 'deposit_amount', 'deposit_paid', 'rent_paid', 'amount_due', 'payment_method', 'payment_date', 'payment_reference']],
  ['银行', ['bank_name', 'account_name', 'bank_bsb', 'bank_account']],
  ['逾期归还', ['late_days', 'late_fee_per_day', 'late_fee']],
  ['验机', ['inspection_date', 'inspection_by', 'screen_condition', 'keyboard_condition', 'trackpad_condition', 'body_condition', 'camera_condition', 'wifi_condition', 'power_test', 'inspection_notes']],
  ['损坏', ['damage_description', 'damage_photos', 'repair_cost', 'replacement_cost', 'deduction_amount', 'repair_invoice']],
  ['退款', ['deposit_refund', 'refund_amount', 'refund_date']],
  ['电子签名', ['signer_name', 'sign_time', 'esign_signature', 'company_signature', 'esign_ip', 'esign_device', 'esign_browser', 'esign_os']],
  ['代表与确认', ['company_representative', 'customer_initials']],
  ['保险', ['insurance_selected', 'insurance_fee']],
  ['取还时间', ['pickup_time', 'return_time', 'accessories_returned', 'customer_acknowledgement']],
  ['系统', ['created_by', 'approved_by', 'notes', 'qr_code', 'contract_url', 'invoice_number', 'invoice_url']],
] as const

// 证件号码在任何非本人视图里默认脱敏；只有 MANAGER/ADMIN 主动“显示完整证件”
// （经 sensitive_data_access_logs + 审计）或客户查看本人合同时才展示完整值。
// 完善.md — 普通 STAFF 不得查看完整证件号码。
export const SENSITIVE_CONTRACT_FIELDS = new Set(['customer_id_number'])

export type ContractCustomerSnapshot = {
  name: string
  email: string
  phone: string
  lockedAt: string
}

export function getContractCustomerSnapshot(contract: Pick<Contract, 'contract_data'>): ContractCustomerSnapshot | null {
  const stored = typeof contract.contract_data === 'string'
    ? (safeJsonParse<Record<string, unknown>>(contract.contract_data) || {})
    : (contract.contract_data || {})
  const lockedAt = String(stored.customer_identity_locked_at || '').trim()
  const name = String(stored.customer_name || '').trim()
  const email = String(stored.customer_email || '').trim()
  const phone = String(stored.customer_phone || '').trim()
  if (!lockedAt || !name || !email || !phone) return null
  return { name, email, phone, lockedAt }
}

export async function logSensitiveDataAccess(
  c: Context,
  input: { actorId: string; targetUserId: string; field: string; purpose: string },
): Promise<void> {
  await getDB(c).prepare(
    'INSERT INTO sensitive_data_access_logs (id, actor_id, target_user_id, field_name, purpose) VALUES (?, ?, ?, ?, ?)',
  ).bind(`sda-${nanoid(14)}`, input.actorId, input.targetUserId, input.field, String(input.purpose || '').slice(0, 200)).run()
}

function contractTimeSlot(value: unknown): string {
  const slot = String(value || '')
  if (slot === 'delivery_morning') return '9:00–12:00'
  if (slot === 'delivery_afternoon') return '13:00–19:00'
  return pickupTimeSlots(systemSettings.rentalRules).find(([key]) => key === slot)?.[1].split('（')[0] || slot
}

export function renderContractVariables(content: string, contract: Contract, order?: any, device?: any, customer?: any, extra: Record<string, unknown> = {}, includeInternal = false, revealSensitive = false): string {
  const rentOnly = Math.max(0, Number(order?.totalAmount ?? order?.total_amount ?? 0) - Number(order?.depositAmount ?? order?.deposit_amount ?? 0))
  const stored = typeof contract.contract_data === 'string' ? (safeJsonParse<Record<string, unknown>>(contract.contract_data) || {}) : (contract.contract_data || {})
  const creatorName = String(extra.created_by || stored.created_by || '').trim()
  const emptyVariables = Object.fromEntries(CONTRACT_VARIABLE_NAMES.map(name => [name, '']))
  const values: Record<string, unknown> = {
    ...emptyVariables,
    ...stored,
    ...extra,
    contract_number: contract.contractNumber,
    order_no: order?.orderNo ?? order?.order_no,
    agreement_version: stored.agreement_version || '1.0',
    jurisdiction: stored.jurisdiction || 'VIC',
    company_name: systemSettings.companyDetails.name,
    company_address: systemSettings.companyDetails.address,
    company_phone: systemSettings.companyDetails.phone,
    company_email: systemSettings.companyDetails.email,
    company_contact: systemSettings.companyDetails.contact,
    company_website: systemSettings.companyDetails.website,
    company_logo: systemSettings.companyDetails.logo,
    customer_name: stored.customer_name || customer?.name,
    customer_phone: stored.customer_phone || customer?.phone,
    customer_email: stored.customer_email || customer?.email,
    customer_address: stored.customer_address || customer?.address,
    customer_dob: stored.customer_dob || customer?.dob,
    customer_country: stored.customer_country || customer?.country,
    customer_id_type: stored.customer_id_type || contract.customer_id_type,
    customer_id_number: stored.customer_id_number || contract.customer_id_number,
    device_name: device?.name ?? order?.deviceName,
    device_brand: device?.brand,
    device_model: device?.model,
    device_cpu: device?.cpu,
    device_ram: device?.ram,
    device_storage: device?.storage,
    device_gpu: device?.gpu,
    device_os: device?.os,
    device_sn: device?.serialNumber ?? device?.serial_number,
    asset_tag: device?.assetTag ?? device?.asset_tag,
    charger_sn: stored.charger_sn || device?.chargerSn || device?.charger_sn,
    battery_health: stored.battery_health || device?.batteryHealth || device?.battery_health,
    battery_cycles: stored.battery_cycles || device?.batteryCycles || device?.battery_cycles,
    device_condition: stored.device_condition || contract.device_condition,
    device_accessories: stored.device_accessories || contract.device_accessories,
    start_date: order?.startDate ?? order?.start_date,
    end_date: order?.endDate ?? order?.end_date,
    rental_days: order?.rentalPeriod ?? order?.rental_period,
    daily_rate: Number(order?.dailyRate ?? order?.daily_rate ?? device?.pricePerDay ?? 0).toFixed(2),
    total_rent: rentOnly.toFixed(2),
    deposit_amount: Number(order?.depositAmount ?? order?.deposit_amount ?? 0).toFixed(2),
    late_fee_per_day: Number(stored.late_fee_per_day ?? contract.late_fee_per_day ?? 0).toFixed(2),
    repair_cost: stored.repair_cost ?? (contract.repair_cost == null ? '' : Number(contract.repair_cost).toFixed(2)),
    pickup_location: stored.pickup_location || contract.pickup_location || order?.pickupLocation || order?.pickup_location,
    return_location: stored.return_location || contract.return_location || order?.returnLocation || order?.return_location,
    pickup_time: stored.pickup_time || extra.pickup_time || contractTimeSlot(order?.pickupTimeSlot || order?.pickup_time_slot),
    return_time: stored.return_time || extra.return_time || contractTimeSlot(order?.returnTimeSlot || order?.return_time_slot),
    return_method: stored.return_method || extra.return_method || (order && (order.returnLocation === '到店归还' || order.return_location === '到店归还' || (order.deliveryMethod || order.delivery_method || 'Pickup') === 'Pickup') ? 'StoreReturn' : ''),
    return_date: stored.return_date || extra.return_date || order?.endDate || order?.end_date,
    payment_method: order?.paymentMethod ?? order?.payment_method,
    bank_name: systemSettings.bankDetails.bankName,
    bank_bsb: systemSettings.bankDetails.bsb,
    bank_account: systemSettings.bankDetails.account,
    account_name: systemSettings.bankDetails.accountName,
    company_abn: systemSettings.companyDetails.abn,
    gst_included: systemSettings.companyDetails.gstIncluded ? '是' : '否',
    company_signature: creatorName,
    signer_name: stored.signer_name || customer?.name,
    sign_time: formatMelbourneDateTime(contract.signedAt),
    esign_ip: contract.esign_ip,
    esign_device: contract.esign_device,
    device_id: device?.id ?? order?.deviceId ?? order?.device_id,
    currency: 'AUD',
    created_time: contract.createdAt ?? (contract as any).created_at,
    updated_time: (contract as any).updatedAt ?? (contract as any).updated_at,
    contract_status: contract.status,
    refund_policy_version: stored.refund_policy_version || systemSettings.legalMetadata.copyright.version,
    last_updated_date: stored.last_updated_date || systemSettings.legalMetadata.copyright.lastUpdatedDate,
    rental_agreement_version: stored.rental_agreement_version || systemSettings.legalMetadata.rental.version,
    rental_agreement_last_updated_date: stored.rental_agreement_last_updated_date || systemSettings.legalMetadata.rental.lastUpdatedDate,
    contract_version: systemSettings.legalMetadata.contract.version,
    contract_last_updated_date: systemSettings.legalMetadata.contract.lastUpdatedDate,
    company_representative: creatorName,
    contract_url: stored.contract_url || `/contract/view/${contract.id}`,
    invoice_url: stored.invoice_url || (order?.id ? `/orders/${order.id}/invoice` : ''),
    deleted: contract.deleted_at ? '是' : '否',
  }
  if (!includeInternal) values.deleted = ''
  const filled = Object.entries(values).reduce((result, [name, value]) => {
    const signature = name === 'esign_signature' || name === 'company_signature'
    const raw = String(value ?? '')
    const forceMaskSensitive = SENSITIVE_CONTRACT_FIELDS.has(name) && !revealSensitive
    const safe = !raw.trim()
      ? (name === 'deleted' && !includeInternal ? '' : 'N/A')
      : signature && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(raw)
      ? `<img src="${raw}" alt="电子签名" style="max-width:280px;max-height:100px;object-fit:contain">`
      : escapeContractValue(forceMaskSensitive || !includeInternal ? maskContractValue(name, value) : value)
    return result.replace(new RegExp(`\\$\\{${name}\\}|\\{${name}\\}`, 'g'), safe)
  }, String(content || ''))
  return renderFlexibleContent(filled)
}

export const CONTRACT_OPERATIONAL_FIELDS = [
  ['refund_policy_version', '退款政策版本'], ['last_updated_date', '协议最后更新日期'],
  ['rental_agreement_version', '租赁协议版本'], ['rental_agreement_last_updated_date', '租赁协议最后更新日期'],
  ['contract_version', '正式合同版本'], ['contract_last_updated_date', '正式合同最后更新日期'],
  ['agreement_version', '合同版本'], ['jurisdiction', '司法管辖区'],
  ['customer_address', '客户地址'], ['customer_dob', '客户出生日期'], ['customer_country', '客户国家'], ['customer_id_type', '证件类型'], ['customer_id_number', '证件号码'], ['customer_driver_expiry', '驾照到期日'], ['emergency_contact', '紧急联系人'], ['emergency_phone', '紧急联系电话'],
  ['invoice_number', '发票编号'], ['delivery_method', '配送方式（Pickup / Delivery）'], ['delivery_fee', '配送费'], ['return_method', '归还方式（CourierPickup / StoreReturn）'], ['pickup_location', '取货地点'], ['return_location', '归还地点'], ['pickup_time', '取货时间'], ['return_time', '归还时间'],
  ['return_status', '归还状态'], ['return_date', '实际归还日期'], ['inspection_date', '检查日期'], ['inspection_by', '检查员工'],
  ['device_brand', '设备品牌'], ['device_cpu', 'CPU'], ['device_ram', '内存'], ['device_storage', '存储'], ['device_gpu', '显卡'], ['device_os', '设备操作系统'],
  ['battery_health', '电池健康'], ['charger_sn', '充电器 SN'], ['asset_tag', '公司资产编号'], ['device_condition', '设备状况'], ['device_accessories', '交付配件'],
  ['esign_signature', '客户电子签名'], ['company_signature', '公司电子签名'], ['esign_location', '签约 GPS 位置'], ['esign_browser', '签约浏览器'], ['esign_os', '签约操作系统'], ['company_representative', '公司代表'], ['customer_initials', '客户姓名首字母'],
  ['discount', '优惠金额'], ['coupon_code', '优惠码'],
  ['damage_description', '损坏说明'], ['damage_photos', '损坏照片 URL'], ['repair_invoice', '维修发票'], ['replacement_cost', '更换费用'], ['repair_cost', '维修费用'],
  ['collection_required', '是否需要追回'], ['collection_date', '回收日期'],
  ['screen_condition', '屏幕状况'], ['keyboard_condition', '键盘状况'], ['trackpad_condition', '触控板状况'], ['body_condition', '外壳状况'], ['camera_condition', '摄像头状况'], ['wifi_condition', 'WiFi 状况'], ['battery_cycles', '电池循环次数'], ['power_test', '开机测试'], ['inspection_notes', '验机备注'], ['accessories_returned', '已归还配件'], ['customer_acknowledgement', '客户确认'],
  ['approved_by', '审批员工'], ['notes', '内部备注'], ['qr_code', '合同二维码图片 URL'],
  ['insurance_selected', '是否选择保险'], ['insurance_fee', '保险费用'], ['insurance_provider', '保险公司'], ['waiver_signed', '是否签署免责'], ['privacy_version', '隐私政策版本'],
] as const

export const CONTRACT_COMPUTED_FIELDS = [
  ['device_id', '系统内部设备 ID'], ['currency', '币种'], ['deposit_paid', '已支付押金'], ['rent_paid', '已支付租金'], ['amount_due', '剩余应付款'], ['payment_date', '付款日期'], ['payment_reference', '银行 Reference'],
  ['subtotal', '小计'], ['gst_amount', 'GST 金额'], ['refund_amount', '退款金额'], ['deposit_refund', '押金退款'], ['refund_date', '退款日期'], ['deduction_amount', '押金扣除金额'],
  ['late_days', '逾期天数'], ['late_fee', '逾期费用'], ['created_by', '创建员工'], ['created_time', '创建时间'], ['updated_time', '更新时间'], ['contract_status', '合同状态'], ['deleted', '是否删除'],
] as const

export const CONTRACT_SIGNED_FIELDS = new Set([
  'signer_name', 'customer_initials', 'esign_signature', 'company_signature', 'esign_location', 'esign_browser', 'esign_os', 'agreement_version',
])

export async function getContractVariableData(c: Context, contract: Contract, order: any): Promise<Record<string, unknown>> {
  const stored = typeof contract.contract_data === 'string' ? (safeJsonParse<Record<string, unknown>>(contract.contract_data) || {}) : (contract.contract_data || {})
  const [payments, reference, refund, creator] = await Promise.all([
    c.env.RENT.prepare("SELECT COALESCE(SUM(amount),0) paid, COALESCE(SUM(deposit_amount),0) deposit_paid, COALESCE(SUM(rental_amount),0) rent_paid, MAX(paid_at) payment_date, MAX(currency) currency FROM payments WHERE rental_id = ? AND status = 'paid'").bind(order.id).first(),
    c.env.RENT.prepare(`SELECT p.stripe_payment_intent_id, p.stripe_checkout_session_id, p.transaction_id, pp.reference_number
      FROM payments p LEFT JOIN payment_proofs pp ON pp.payment_id = p.id AND pp.status = 'approved'
      WHERE p.rental_id = ? AND (p.status = 'paid' OR (p.status = 'pending' AND p.stripe_payment_intent_id = ? AND ? = 'HELD'))
      ORDER BY CASE WHEN p.status = 'paid' THEN 0 ELSE 1 END, p.paid_at DESC, p.created_at DESC, pp.created_at DESC LIMIT 1`)
      .bind(order.id, order.stripe_deposit_payment_intent_id || '', order.deposit_status || '').first(),
    c.env.RENT.prepare("SELECT type, refund_amount, deduction_amount, created_at FROM payment_refunds WHERE order_id = ? AND status = 'succeeded' ORDER BY created_at DESC LIMIT 1").bind(order.id).first(),
    (contract.createdBy || contract.created_by) ? getUserById(c, contract.createdBy || contract.created_by || '') : Promise.resolve(null),
  ]) as any[]
  const invoice = await c.env.RENT.prepare("SELECT invoice_number FROM invoices WHERE order_id = ? AND type = 'invoice' ORDER BY issued_at DESC LIMIT 1").bind(order.id).first() as any
  const publicOrigin = new URL(c.req.url).origin
  const paid = Number(payments?.paid || 0)
  const deposit = Number(order.depositAmount ?? order.deposit_amount ?? 0)
  const total = Number(order.totalAmount ?? order.total_amount ?? 0)
  const discount = Number(stored.discount || 0)
  const deliveryFee = Number(stored.delivery_fee || 0)
  const rentSubtotal = Math.max(0, total - deposit - deliveryFee + discount)
  const returnDate = stored.return_date ? new Date(String(stored.return_date)) : null
  const dueDate = new Date(order.endDate ?? order.end_date)
  const lateDays = returnDate && returnDate > dueDate ? Math.ceil((returnDate.getTime() - dueDate.getTime()) / 86400000) : 0
  const returnStatus = stored.damage_description ? 'Damaged' : stored.return_date ? (lateDays > 0 ? 'Overdue' : 'Returned') : (order.status === 'completed' ? 'Returned' : '')
  return {
    ...stored,
    invoice_number: invoice?.invoice_number || stored.invoice_number || generateReferenceNumber('INV'),
    currency: payments?.currency || 'AUD',
    deposit_paid: Number(payments?.deposit_paid || 0).toFixed(2),
    rent_paid: Number(payments?.rent_paid || 0).toFixed(2),
    amount_due: Math.max(0, total - paid).toFixed(2),
    payment_date: formatMelbourneDateTime(payments?.payment_date),
    payment_reference: reference?.stripe_payment_intent_id || reference?.reference_number || reference?.transaction_id || reference?.stripe_checkout_session_id || '',
    subtotal: rentSubtotal.toFixed(2),
    gst_amount: systemSettings.companyDetails.gstIncluded ? (rentSubtotal / 11).toFixed(2) : '0.00',
    refund_amount: Number(refund?.refund_amount || 0).toFixed(2),
    deposit_refund: Number(refund?.type === 'deposit' ? refund.refund_amount : 0).toFixed(2),
    refund_date: refund?.created_at || '',
    deduction_amount: Number(refund?.deduction_amount || 0).toFixed(2),
    late_days: lateDays,
    late_fee: (lateDays * Number(contract.late_fee_per_day || 0)).toFixed(2),
    return_status: returnStatus,
    created_by: creator?.name || contract.createdBy || '',
    contract_url: `/contract/view/${contract.id}`,
    invoice_url: new URL(`/orders/${order.id}/invoice`, publicOrigin).toString(),
  }
}

export const DEFAULT_CONTRACT_TEMPLATE_HTML = `<h1>设备租赁合同</h1>
<p>合同编号：<strong>{contract_number}</strong>　合同版本：{contract_version}　最后更新：{contract_last_updated_date}</p>
<p>生成时间：{created_time}　签署时间：<strong>{sign_time}</strong>　管辖地：{jurisdiction}</p>
<p>本设备租赁合同（下称「本合同」）由下列双方签署，构成具有法律约束力的租赁（bailment）合同。承租方以电子方式签署，即表示已阅读、理解并接受本合同全部条款。</p>

<h2>一、双方当事人</h2>
<table style="width:100%;border-collapse:collapse;margin:12px 0;">
  <tr style="background:#f3f4f6;"><th style="border:1px solid #e5e7eb;padding:8px;text-align:left;width:22%;">出租方（甲方）</th><td style="border:1px solid #e5e7eb;padding:8px;">{company_name}（ABN {company_abn}）</td></tr>
  <tr><td style="border:1px solid #e5e7eb;padding:8px;">地址</td><td style="border:1px solid #e5e7eb;padding:8px;">{company_address}</td></tr>
  <tr><td style="border:1px solid #e5e7eb;padding:8px;">联系方式</td><td style="border:1px solid #e5e7eb;padding:8px;">电话 {company_phone}　邮箱 {company_email}</td></tr>
  <tr style="background:#f3f4f6;"><th style="border:1px solid #e5e7eb;padding:8px;text-align:left;">承租方（乙方）</th><td style="border:1px solid #e5e7eb;padding:8px;">{customer_name}</td></tr>
  <tr><td style="border:1px solid #e5e7eb;padding:8px;">证件</td><td style="border:1px solid #e5e7eb;padding:8px;">{customer_id_type} {customer_id_number}　出生日期 {customer_dob}</td></tr>
  <tr><td style="border:1px solid #e5e7eb;padding:8px;">联系方式</td><td style="border:1px solid #e5e7eb;padding:8px;">电话 {customer_phone}　邮箱 {customer_email}</td></tr>
  <tr><td style="border:1px solid #e5e7eb;padding:8px;">联系地址</td><td style="border:1px solid #e5e7eb;padding:8px;">{customer_address}</td></tr>
  <tr><td style="border:1px solid #e5e7eb;padding:8px;">紧急联系人</td><td style="border:1px solid #e5e7eb;padding:8px;">{emergency_contact}　{emergency_phone}</td></tr>
</table>

<h2>二、租赁设备</h2>
<table style="width:100%;border-collapse:collapse;margin:12px 0;">
  <tr style="background:#f3f4f6;"><th style="border:1px solid #e5e7eb;padding:8px;text-align:left;width:22%;">设备名称</th><td style="border:1px solid #e5e7eb;padding:8px;">{device_name}</td></tr>
  <tr><td style="border:1px solid #e5e7eb;padding:8px;">品牌 / 型号</td><td style="border:1px solid #e5e7eb;padding:8px;">{device_brand} / {device_model}</td></tr>
  <tr><td style="border:1px solid #e5e7eb;padding:8px;">序列号 / 资产编号</td><td style="border:1px solid #e5e7eb;padding:8px;">{device_sn} / {asset_tag}</td></tr>
  <tr><td style="border:1px solid #e5e7eb;padding:8px;">配置</td><td style="border:1px solid #e5e7eb;padding:8px;">{device_cpu}　{device_ram}　{device_storage}　{device_gpu}　{device_os}</td></tr>
  <tr><td style="border:1px solid #e5e7eb;padding:8px;">电池健康</td><td style="border:1px solid #e5e7eb;padding:8px;">{battery_health}</td></tr>
  <tr><td style="border:1px solid #e5e7eb;padding:8px;">交付状况</td><td style="border:1px solid #e5e7eb;padding:8px;">{device_condition}</td></tr>
  <tr><td style="border:1px solid #e5e7eb;padding:8px;">随附配件</td><td style="border:1px solid #e5e7eb;padding:8px;">{device_accessories}</td></tr>
</table>
<p>设备在交付时应处于可正常使用的状况。承租方应当场检查设备及配件并及时提出问题；签署本合同不视为已收到或验收设备。</p>

<h2>三、租期、交付与归还</h2>
<ul>
<li>租期：<strong>{start_date}</strong> 至 <strong>{end_date}</strong>，共 {rental_days} 天。</li>
<li>交付方式：{delivery_method}（配送费 {currency} {delivery_fee}）　取件地点：{pickup_location}</li>
<li>归还方式：{return_method}　归还地点：{return_location}　约定归还日：{return_date}</li>
<li>承租方应在租期届满时，以交付时的状况（正常损耗除外）连同全部配件归还设备。</li>
</ul>

<h2>四、费用与付款</h2>
<table style="width:100%;border-collapse:collapse;margin:12px 0;">
  <tr style="background:#f3f4f6;"><th style="border:1px solid #e5e7eb;padding:8px;text-align:left;width:40%;">项目</th><th style="border:1px solid #e5e7eb;padding:8px;text-align:left;">金额（{currency}）</th></tr>
  <tr><td style="border:1px solid #e5e7eb;padding:8px;">日租金</td><td style="border:1px solid #e5e7eb;padding:8px;">{daily_rate}</td></tr>
  <tr><td style="border:1px solid #e5e7eb;padding:8px;">租金小计</td><td style="border:1px solid #e5e7eb;padding:8px;">{subtotal}</td></tr>
  <tr><td style="border:1px solid #e5e7eb;padding:8px;">优惠（{coupon_code}）</td><td style="border:1px solid #e5e7eb;padding:8px;">-{discount}</td></tr>
  <tr><td style="border:1px solid #e5e7eb;padding:8px;">保险（{insurance_selected}）</td><td style="border:1px solid #e5e7eb;padding:8px;">{insurance_fee}</td></tr>
  <tr><td style="border:1px solid #e5e7eb;padding:8px;">租金总额（含 GST：{gst_included}，其中 GST {gst_amount}）</td><td style="border:1px solid #e5e7eb;padding:8px;"><strong>{total_rent}</strong></td></tr>
  <tr><td style="border:1px solid #e5e7eb;padding:8px;">押金（security bond）</td><td style="border:1px solid #e5e7eb;padding:8px;"><strong>{deposit_amount}</strong></td></tr>
  <tr><td style="border:1px solid #e5e7eb;padding:8px;">已付租金 / 已付押金</td><td style="border:1px solid #e5e7eb;padding:8px;">{rent_paid} / {deposit_paid}</td></tr>
  <tr><td style="border:1px solid #e5e7eb;padding:8px;">应付余额</td><td style="border:1px solid #e5e7eb;padding:8px;"><strong>{amount_due}</strong></td></tr>
</table>
<p>付款方式：{payment_method}　付款日期：{payment_date}　付款参考号：{payment_reference}　税务发票编号：{invoice_number}</p>
<p>所有价格以澳元（AUD）列示，适用 GST 计入展示总价，发票按适用税法开具。配送费、时段服务费及支付手续费应在确认或付款前单独列示。支付费用须符合适用法律及卡组织规则，不得向适用卡种另收支付附加费。人民币付款及退款的币种和兑换汇率应另行明确。</p>
<p>不足 30 天按完整周及剩余日计算；满 30 天按完整的 30 天月租计算，余期少于 21 天按周租日价折算，满 21 天按月租日价折算。折扣及优惠以确认报价为准。不足 60 天一次性付清；满 60 天且提供月付选项时可选 Stripe 月付或一次性付清。月付为每 30 天一期，末期按剩余天数结算，首期包含适用押金及订单列明的一次性费用，各期支付手续费另列。</p>
<p>选择月付并完成首次付款时，承租方授权 Stripe 保存支付方式，按订单付款计划收取到期款项；失败或需验证时应按通知补付。月付不自动续租，也不免除已到期款项。取消或归还设备后停止未发生的后续期款，退款按《退款政策》办理。确认后的租金和押金不因后续定价或风险评分变化而自动上调。</p>

<h2>五、押金</h2>
<p>押金用于担保履约，不是租金、保险或罚金。新订单根据身份核验、履约、付款、退款、逾期、损坏及有效风险标记评估，六档押金倍数为设备基础押金的 0、0.5、1、1.25、1.5 或 2 倍；具体金额应在确认前列明，可申请人工复核。满 60 天一次性付清且风险倍数不高于 1 时可免押金；风险加收的押金不因一次性付清而免除。</p>
<p>月付押金在首期实际收取。其他订单按已选方式收取押金、办理信用卡预授权或通过 SetupIntent 保存后续扣款授权。预授权期限受卡组织及银行限制，通常 Visa、Mastercard 最长 30 天，其他卡最长 7 天；以支付服务商实际期限为准。保存卡片并不表示已冻结或支付押金。出租方仅可就本订单有依据、已披露的应付金额进行授权范围内的扣款；在合理可行时先提供说明及提出异议的机会，不得无限额或重复扣款。</p>
<p>承租方应按约定归还设备及全部配件，并在归还前备份和移除个人数据。出租方记录实际接收时间并进行验机；归还后的验机或退款等待不继续产生占用租金。完成验机后 10 个营业日内安排退还可退押金、释放预授权或结清后续扣款，银行实际到账或解除冻结时间由支付机构决定。正常损耗不扣款，扣款应逐项列明并提供照片、报价或发票等依据；已收费用不得再次从押金扣除。承租方可对验机及扣款提出异议。</p>

<h2>六、所有权与使用限制</h2>
<ul>
<li>设备所有权始终归甲方所有，不含购买权或购买义务，租期以订单为准；依法适用的消费者租赁、信贷及其他强制性规定仍然适用。</li>
<li>承租方不得转租、转借、出售、质押设备，或将设备移出澳大利亚境外。</li>
<li>设备仅限合法用途；不得拆解、改装，不得移除资产标签或管理软件，不得越权刷写系统。</li>
<li>承租方应保持操作系统与安全更新为最新，妥善保管登录凭据。</li>
</ul>

<h2>七、风险、损坏与赔偿</h2>
<p>因承租方或其授权使用人的过错造成丢失或超出正常损耗的损坏，应承担有凭证的合理损失；以合理维修费用或扣除折旧后的重置价值中适用且较低者为限，不包括甲方过错造成的损失。正常损耗不扣款，免押金不免除依法应承担的赔偿责任。</p>

<h2>八、逾期归还</h2>
<p>超过约定归还时间 2 小时仍未归还的，收取一次 AUD 25 操作费；跨过约定归还日后，按逾期日数及订单日租金补收占用租金。已结算金额和押金已抵扣金额从应付中扣除。费用在实际接收设备时停止累计，不因验机或退款处理而增加。收费受适用法律限制，仅用于补偿合理损失及成本，不得重复赔偿。</p>

<h2>九、设备管理软件</h2>
<p>管理软件可能上报设备状态、硬件、租期及安全信息。远程锁定、重启、注销或清除仅在《软件使用协议》所列必要情形依法实施；合理可行时先通知并给予补救及备份机会。数据清除会删除设备上的用户数据；出租方不以本条排除依法应承担的数据安全责任。信息处理见《隐私政策》。</p>

<h2>十、消费者保障</h2>
<p>本合同项下提供的商品与服务附带《澳大利亚消费者法》规定的消费者保障，包括设备须具有<strong>可接受的质量</strong>、与描述相符、适合告知的特定用途，服务须以合理的谨慎与技能提供。这些保障<strong>不能被排除、限制或修改</strong>。就重大失败，承租方有权解除本合同并要求退还相应款项，或就价值减损获得赔偿；就非重大失败，甲方将在合理时间内修理或更换。</p>

<h2>十一、责任限制</h2>
<p>在法律允许且不影响上述不可排除的消费者保障的前提下，甲方不对承租方的数据丢失、业务中断或其他间接或后果性损失负责；甲方可依法限制的责任，以重新提供服务或支付其合理费用为限，或以本合同项下已付租金总额为限。本合同中的任何内容均不排除或限制依法不能排除的责任。</p>

<h2>十二、违约与取回</h2>
<p>如承租方未支付到期款项、违反使用限制或存在欺诈，甲方可在发出合理书面通知并给予补救期后终止本合同。甲方仅可通过合法方式取回设备，不得进入住宅或采用胁迫手段。终止不影响已产生的付款义务。</p>

<h2>十三、不可抗力</h2>
<p>因超出一方合理控制的事件（如自然灾害、战争、罢工、电信或电力中断、政府行为）导致的履约迟延或不能，该方在受影响范围内不承担违约责任，但应尽快通知对方并努力减轻影响。</p>

<h2>十四、适用法律与争议解决</h2>
<p>本合同受澳大利亚 {jurisdiction} 法律管辖，适用法院非专属管辖，不影响承租方依法可选择的其他争议渠道。请按《投诉与争议解决政策》申请复核或向消费者机构、VCAT 或有管辖权法院寻求协助；ACCC 接收系统性问题报告，不处理个别纠纷。</p>

<h2>十五、电子签名</h2>
<p>双方同意以电子方式订立与签署本合同。依据 1999 年《电子交易法》（Electronic Transactions Act 1999 (Cth)）及《2000 年电子交易（维多利亚）法》，电子签名与手写签名具有同等法律效力。系统记录的签署证据如下：</p>
<ul>
<li>签署时间：{sign_time}</li>
<li>签署 IP：{esign_ip}</li>
<li>签署设备：{esign_device}</li>
<li>浏览器 / 系统：{esign_browser} / {esign_os}</li>
</ul>

<h2>十六、其他条款</h2>
<p>本合同连同其引用的政策构成双方就本次设备租赁的完整约定，取代此前一切口头或书面沟通。新增费用或实质变更须经双方另行书面确认，不追溯改写已签合同。若任何条款被认定无效或不可执行，不影响其余条款的效力。</p>

<h2>十七、银行账户</h2>
<p>开户行：{bank_name}　账户名：{account_name}　BSB：{bank_bsb}　账号：{bank_account}</p>

<h2>十八、取消、未取货与提前归还</h2>
<p>订单确认前取消不收取消手续费；确认后、实际取货或交付前，承租方个人原因取消按订单总额的 5% 收费。门店自提超过预约取货开始时间 2 小时仍未领取的，订单可被取消并释放设备，收取 AUD 25 未取货操作费，剩余款项退还；该费用不与同一次取消的 5% 手续费叠加。配送订单不适用门店未取货规则。提前归还的未使用租金及押金分别结算，详见<a href="/refund-policy">《退款政策》</a>。上述个人原因收费不适用于出租方原因或法定退款。</p>

<h2>十九、双方签署</h2>
<table style="width:100%;border-collapse:collapse;margin:12px 0;">
  <tr style="background:#f3f4f6;"><th style="border:1px solid #e5e7eb;padding:8px;text-align:left;width:50%;">出租方（甲方）</th><th style="border:1px solid #e5e7eb;padding:8px;text-align:left;">承租方（乙方）</th></tr>
  <tr>
    <td style="border:1px solid #e5e7eb;padding:8px;">{company_name}<br>授权代表：{company_representative}<br>签章：{company_signature}<br>日期：{sign_time}</td>
    <td style="border:1px solid #e5e7eb;padding:8px;">{signer_name}<br>姓名首字母确认：{customer_initials}<br>签名：{esign_signature}<br>日期：{sign_time}</td>
  </tr>
</table>
<p>承租方确认：本人已阅读并理解本合同全部条款，确认所填资料真实准确，并同意受本合同约束。</p>`

export const contractTemplate = {
  id: 'tmpl-1',
  name: '标准租赁合同模板',
  content: DEFAULT_CONTRACT_TEMPLATE_HTML,
}

export async function getContractTemplate(c: Context): Promise<ContractTemplate> {
  const db = getDB(c);
  const template = await db.prepare('SELECT * FROM contract_templates WHERE id = ?').bind('default').first() as ContractTemplate | null
  if (template) {
    return { ...template, content: sanitizeRichHtml(template.content) };
  }
  // Fallback to a default in-memory template if not found in DB
  return {
    id: 'default',
    name: '标准租赁合同模板',
    content: DEFAULT_CONTRACT_TEMPLATE_HTML,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

// 为已审核订单准备客户签署用的合同。审批和订单详情页都会调用此函数，
// 因此必须先查已有合同，避免重复生成签约链接。
export async function ensureContractForOrder(c: Context, order: Order, createdBy?: string | null): Promise<Contract> {
  if (order.is_manual === 1) throw new Error('手动订单无需创建合同')
  const existing = await getContractByOrderId(c, order.id)
  if (existing && existing.status !== 'cancelled' && !existing.deleted_at) return existing

  const now = new Date()
  const signExpiresAt = new Date(now)
  signExpiresAt.setDate(signExpiresAt.getDate() + 7)
  const device = await getDeviceById(c, order.deviceId)
  const customer = order.userId ? await getUserById(c, order.userId) : null
  const template = await getContractTemplate(c)
  const customerSnapshot = customer?.role === 'CUSTOMER' && customer.name && customer.email && customer.phone
    ? {
      customer_name: customer.name,
      customer_email: customer.email,
      customer_phone: customer.phone,
      customer_identity_locked_at: now.toISOString(),
    }
    : {}
  const contract: Contract = {
    id: `ct-${nanoid(10)}`,
    rentalId: order.id,
    contractNumber: generateContractNumber(),
    content: template.content,
    signedAt: null,
    createdAt: now.toISOString(),
    signToken: nanoid(32),
    status: 'pending_sign',
    validFrom: order.startDate || null,
    validUntil: order.endDate || null,
    signExpiresAt: signExpiresAt.toISOString(),
    createdBy: createdBy || null,
    device_condition: '交付时以设备验机记录为准。',
    device_accessories: null,
    late_fee_per_day: 0,
    repair_cost: null,
    pickup_location: order.pickupLocation || null,
    return_location: order.returnLocation || null,
    contract_data: {
      website_order: true,
      ...customerSnapshot,
      invoice_number: '',
      delivery_method: order.deliveryMethod || 'Pickup',
      delivery_fee: Number(order.deliveryFee || order.delivery_fee || 0).toFixed(2),
      return_method: 'StoreReturn',
      pickup_location: order.pickupLocation || '',
      return_location: order.returnLocation || '',
      agreement_version: '1.0',
      device_name: device?.name || '',
    },
  }

  await insertContract(c, contract)
  await c.env.RENT.prepare('UPDATE orders SET contractId = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?').bind(contract.id, order.id).run()
  return contract
}

export async function updateContractTemplate(c: Context, newTemplate: { id: string; name: string; content: string }): Promise<ContractTemplate> {
  const db = getDB(c);
  await db.prepare('INSERT INTO contract_templates (id, name, content, updatedAt) VALUES (?, ?, ?, CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET name = EXCLUDED.name, content = EXCLUDED.content, updatedAt = EXCLUDED.updatedAt')
    .bind(newTemplate.id, String(newTemplate.name || '').slice(0, 100), sanitizeRichHtml(newTemplate.content))
    .run();
  return getContractTemplate(c);
}

function toNumber(value: any): number {
  if (value === undefined || value === null || value === '') return 0
  return Number(value)
}

export async function seedDatabaseIfEmpty(c: Context): Promise<void> {
  const db = getDB(c)

  const host = String(c.req.header('Host') || '').split(':')[0].toLowerCase()
  const demoEnvironment = String((c.env as any).SHOW_TEST_ACCOUNTS || '').toLowerCase() === 'true' && host === 'test-rent.ydnw6zt6vj.workers.dev'
  if (!demoEnvironment) return

  const countResult = await db.prepare('SELECT COUNT(*) AS count FROM users').all()
  const count = Number(countResult.results?.[0]?.count ?? 0)

  const usersToSeed = [
    { id: 'u-admin', name: 'Admin User', email: 'admin@example.com', password: 'Admin123', role: 'ADMIN', accountNumber: '00000000' },
    { id: 'u-staff', name: 'Staff User', email: 'staff@example.com', password: 'Staff123', role: 'STAFF', accountNumber: '00000001' },
    { id: 'u-customer', name: 'Customer User', email: 'customer@example.com', password: 'Customer123', role: 'CUSTOMER', accountNumber: '00000002' },
  ]

  // users 表字段：兼容 snake_case / camelCase（同时避免插入时引用不存在的列）
  const hasReferralCodeSnake = await userHasColumn(c, 'referral_code')
  const hasReferralCodeCamel = await userHasColumn(c, 'referralCode')
  const hasAccountNumberSnake = await userHasColumn(c, 'account_number')
  const hasAccountNumberCamel = await userHasColumn(c, 'accountNumber')
  const hasCommissionBalanceSnake = await userHasColumn(c, 'commission_balance')
  const hasCommissionBalanceCamel = await userHasColumn(c, 'commissionBalance')

  const hasPasswordHashSnake = await userHasColumn(c, 'password_hash')
  const hasPasswordHashCamel = await userHasColumn(c, 'passwordHash')

  const passwordHashCol = hasPasswordHashSnake ? 'password_hash' : 'passwordHash'
  const accountNumberCol = hasAccountNumberSnake ? 'account_number' : 'accountNumber'
  const commissionBalanceCol = hasCommissionBalanceSnake ? 'commission_balance' : 'commissionBalance'
  const referralCodeCol = hasReferralCodeSnake ? 'referral_code' : 'referralCode'

  const hasUsersTableCols = (arr: string[]) => arr.every((col) => {
    // 只在已确认列存在时才写入（避免不同库状态混乱）
    return true
  })

  // 仅在 users 已存在时也要“修正默认用户密码/字段”，否则会出现你现在看到的“账号或密码错误”
  const userUpserts: any[] = []
  for (const user of usersToSeed) {
    const hash = await hashPassword(user.password)

    const cols: string[] = ['id', 'name', 'email', 'role', 'status', 'balance', passwordHashCol]
    const vals: any[] = [user.id, user.name, user.email, user.role, 'active', 0, hash]

    if (hasAccountNumberSnake || hasAccountNumberCamel) {
      cols.push(accountNumberCol)
      vals.push(user.accountNumber)
    }
    if (hasCommissionBalanceSnake || hasCommissionBalanceCamel) {
      cols.push(commissionBalanceCol)
      vals.push(0)
    }
    if (hasReferralCodeSnake || hasReferralCodeCamel) {
      cols.push(referralCodeCol)
      vals.push(null)
    }

    const setParts: string[] = cols
      .filter((col) => col !== 'id')
      .map((col) => `${col} = EXCLUDED.${col}`)

    const placeholders = cols.map(() => '?').join(', ')
    const sql = `INSERT INTO users (${cols.join(', ')}) VALUES (${placeholders}) ON CONFLICT(id) DO UPDATE SET ${setParts.join(', ')}`
    userUpserts.push(db.prepare(sql).bind(...vals))
  }
  await db.batch(userUpserts)

  if (count > 0) return

  // Seed示例设备
  const devicesToSeed = [
    { id: 'd-mbp14', name: 'MacBook Pro 14寸', model: 'M4 Pro 18GB 512GB', serial_number: 'SN-MBP14-001', pricePerDay: 40.0, depositAmount: 2000.0, status: 'available', description: 'Apple M4 Pro芯片，18GB内存，512GB固态硬盘，14英寸Liquid Retina XDR显示屏' },
    { id: 'd-xps13', name: 'Dell XPS 13', model: 'Intel i7-1360P 16GB', serial_number: 'SN-XPS13-001', pricePerDay: 35.0, depositAmount: 1500.0, status: 'available', description: '第13代Intel酷睿i7处理器，16GB LPDDR5内存，512GB NVMe SSD' },
    { id: 'd-thinkpad', name: 'Lenovo ThinkPad X1 Carbon', model: 'i7-1365U 16GB', serial_number: 'SN-TPX1-001', pricePerDay: 38.0, depositAmount: 1800.0, status: 'rented', description: '13代Intel vPro i7，16GB内存，1TB SSD，14英寸2.8K OLED屏' },
    { id: 'd-imac', name: 'iMac 24寸', model: 'M3 8GB 256GB', serial_number: 'SN-IMAC24-001', pricePerDay: 45.0, depositAmount: 2200.0, status: 'maintenance', description: 'Apple M3芯片，8GB统一内存，256GB SSD，24英寸4.5K Retina显示屏' },
  ]

  const deviceInsert = db.prepare('INSERT INTO devices (id, name, model, serial_number, price_per_day, deposit_amount, status, description) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
  const deviceInserts = devicesToSeed.map(d =>
    deviceInsert.bind(
      d.id,
      d.name,
      d.model,
      d.serial_number,
      d.pricePerDay ?? 0,
      d.depositAmount ?? 0,
      d.status,
      d.description
    )
  )
  await db.batch(deviceInserts)

  // Seed示例订单
  const now = new Date().toISOString()
  const ordersToSeed = [
    {
      id: 'o-1', userId: 'u-customer', deviceId: 'd-thinkpad',
      startDate: '2026-07-10', endDate: '2026-08-10', rentalPeriod: 31,
      totalAmount: 1178.0, depositAmount: 1800.0, status: 'active', paymentMethod: 'bank_transfer'
    },
    {
      id: 'o-2', userId: 'u-customer', deviceId: 'd-mbp14',
      startDate: '2026-07-01', endDate: '2026-07-07', rentalPeriod: 7,
      totalAmount: 280.0, depositAmount: 2000.0, status: 'completed', paymentMethod: 'card'
    },
    {
      id: 'o-3', userId: 'u-customer', deviceId: 'd-xps13',
      startDate: '2026-07-20', endDate: '2026-07-27', rentalPeriod: 7,
      totalAmount: 245.0, depositAmount: 1500.0, status: 'pending_payment', paymentMethod: null
    },
  ]

  const orderInsert = db.prepare('INSERT INTO orders (id, userId, deviceId, startDate, endDate, rentalPeriod, totalAmount, depositAmount, status, paymentMethod, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
  const orderInserts = ordersToSeed.map(o =>
    orderInsert.bind(o.id, o.userId, o.deviceId, o.startDate, o.endDate, o.rentalPeriod, o.totalAmount, o.depositAmount, o.status, o.paymentMethod, now, now)
  )
  await db.batch(orderInserts)
}

export async function loadDatabaseData(c: Context): Promise<void> {
  const db = getDB(c)
  await seedDatabaseIfEmpty(c)
}


export function buildLayout(title: string, body: string, currentUser?: (User & { clientAccess?: import('./clientAccess').ClientAccess }) | null, options: { compactStaffNav?: boolean; currentPath?: string } = {}): string {
  const normalizedTitle = title.includes('电脑租赁管理系统') ? title : `${title} - 电脑租赁管理系统`
  // 当前路径：用于手机端底部 tab 的 aria-current 高亮（服务端渲染，无需等脚本）。
  const currentPath = (options.currentPath || '').replace(/\/$/, '') || ''
  const isAuthPage = title.includes('登录') || title.includes('注册') || title.includes('找回密码')
  const topNav =
    currentUser || isAuthPage
      ? ``
      : `
      <a href="/login">登录</a>
      <a href="/register">注册</a>
    `

  const userBlockHtml = currentUser
    ? `
        <button class="notification-bell" type="button" aria-label="打开通知中心" aria-expanded="false"><svg class="notification-bell__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"></path><path d="M10 21h4"></path></svg><b class="notification-bell__count" hidden>0</b></button>
        <a class="user-profile-link" href="${currentUser.role === 'ADMIN' ? `/admin/users/${encodeURIComponent(currentUser.id)}/edit` : currentUser.role === 'STAFF' ? '/staff/profile' : '/customer/profile'}" aria-label="编辑个人信息"><span class="user-label">${currentUser.name}${currentUser.accountType === 'guest' ? ` · 访客（${currentUser.guestExpiresAt || '租期结束'}删除）` : ''}</span><div class="user-avatar">${getAvatarInitials(currentUser.name)}</div></a>
        <form method="post" action="/logout" style="display:inline"><button type="submit" class="logout-button">登出</button></form>
      `
    : ''

  const navIcons: Record<string, string> = {
    '/customer/dashboard': 'rental-console', '/customer/rentals': '▤', '/customer/orders': '▦',
    '/customer/profile': '◎', '/customer/security': '⚿', '/customer/referral': '✦', '/customer/devices': 'laptop', '/customer/rental-program': 'c2c-rental', '/admin/rental-program': 'c2c-rental', '/customer/balance': '◌', '/customer/guest': '▰', '/customer/guest/upgrade': '↥',
    '/admin/roster':'◷','/staff/roster':'◷','/admin/returns':'↺','/staff/returns':'↺','/staff/dashboard': 'rental-console', '/staff/orders': '◓', '/staff/orders/ongoing': '◷', '/staff/customers': '♧', '/staff/contracts': 'rental-contract',
    '/staff/contracts/new': 'file-plus', '/staff/contracts?status=pending_sign': '✍', '/staff/inspections': 'device-inspection', '/staff/mobile/scan': 'scan', '/staff/rentals/tracking': '⌖', '/staff/devices': 'asset-register', '/manager/staff': 'people',
    '/staff/mobile': 'today', '/staff/mobile/pickup': 'pickup', '/staff/mobile/return': 'return',
    '/admin/rental-settlements': 'bank-transfer', '/admin/settings/client-features': 'client-controls', '/manager/email-events': 'mail-history',
    '/admin/notifications/settings': 'bell-settings', '/admin/rental-links': 'link', '/admin/delivery': 'truck',
    '/admin/marketing-emails/data': 'marketing-chart', '/admin/api-settings': 'code',
    '/notifications': 'N', '/notifications/compose': 'bell-settings', '/admin/notifications': 'inbox', '/admin/dashboard': 'rental-console', '/admin/users': 'people', '/admin/orders': '▥',
    '/admin/refunds': 'deposit-return', '/admin/contracts': 'rental-contract', '/admin/templates/contract': '▧', '/admin/finance': 'rental-finance',
    '/admin/withdrawals': '↗', '/admin/exceptions': 'alert', '/admin/devices': 'asset-register', '/admin/devices/relist': 'device-listing', '/admin/device-agent-bindings': 'device-binding', '/admin/inspections': 'device-inspection', '/admin/calendar': '◫', '/admin/rental-rules': '⚙', '/admin/coupons': '%', '/admin/templates': '◇', '/admin/email-templates': '✉', '/admin/in-app-notification-templates': 'message-template', '/admin/tax-invoice-template': 'receipt', '/admin/documents': 'receipt', '/admin/marketing-emails': '⚑', '/admin/settings': '⚙',
    '/admin/devices/reports': 'device-reports', '/admin/reports': 'trend', '/admin/data-retention': 'data-retention', '/admin/monitoring': 'activity', '/admin/connectivity': '⌘', '/admin/referrals': 'gift',
    '/admin/order-review': 'order-review', '/admin/orders/balance-topups': '↥', '/admin/feedback-rewards': 'feedback-reward', '/admin/feedback-gift-cards': 'gift-card'
  }

  const navIconSvg = (kind: string) => {
    const paths: Record<string, string> = {
      'bank-transfer': '<path d="m3 8 9-5 9 5H3ZM5 11v6M10 11v6M15 11v2M3 20h9M15 16h7m-3-3 3 3-3 3"></path>',
      'client-controls': '<rect x="3" y="4" width="18" height="16" rx="2"></rect><path d="M3 9h18M7 6.5h.01M10 6.5h.01M7 13h10M7 17h10"></path><circle cx="10" cy="13" r="1.5" fill="currentColor"></circle><circle cx="14" cy="17" r="1.5" fill="currentColor"></circle>',
      'mail-history': '<path d="M21 10V5H3v14h9M3 6l9 6 9-6"></path><circle cx="18" cy="17" r="5"></circle><path d="M18 14v3l2 1"></path>',
      'c2c-rental': '<rect x="3" y="3" width="14" height="11" rx="1.5"></rect><path d="M2 18h10M7 14v4M10 7h3M19 12l3 3-3 3M22 15h-7M17 22l-3-3 3-3M14 19h7"></path>',
      'rental-console': '<rect x="3" y="3" width="18" height="18" rx="2"></rect><path d="M3 9h18M9 9v12M13 13h4M13 17h2M7 6h.01M10 6h.01"></path>',
      'people': '<rect x="3" y="4" width="18" height="16" rx="2"></rect><circle cx="9" cy="10" r="2"></circle><path d="M5 17c.5-2 1.8-3 4-3s3.5 1 4 3M16 8h2M16 12h2M16 16h2"></path>',
      'rental-contract': '<path d="M14 3H5v18h14V8l-5-5ZM14 3v5h5M8 11h7M8 14h3M8 18l2-2 2 2 3-3M15 18h1"></path>',
      'asset-register': '<rect x="3" y="4" width="13" height="11" rx="1.5"></rect><path d="M2 19h15M7 15v4M12 15v4M6 8h6M6 11h3"></path><rect x="18" y="8" width="4" height="13" rx="1"></rect><path d="M20 17h.01"></path>',
      'device-listing': '<path d="M12 5H4v12h16v-5M2 21h20M16 9V2m-4 4 4-4 4 4"></path>',
      'device-binding': '<rect x="2" y="3" width="12" height="10" rx="1.5"></rect><path d="M8 13v4M5 17h6M14 8h5v4"></path><rect x="15" y="12" width="7" height="10" rx="1.5"></rect><path d="m17 16 1.5 1.5L21 15M18 20h1"></path>',
      'device-inspection': '<rect x="3" y="4" width="18" height="13" rx="1.5"></rect><path d="m8 10 3 3 5-5M8 21h8M12 17v4"></path>',
      'device-reports': '<path d="M14 3H4v18h16V9l-6-6ZM14 3v6h6M8 17v-3M12 17v-6M16 17v-4"></path>',
      'rental-finance': '<path d="M12 21H4V3h13v6M7 7h6M7 11h3M7 15h2"></path><circle cx="17" cy="16" r="5"></circle><path d="M18.5 14h-2a1 1 0 0 0 0 2h1a1 1 0 0 1 0 2h-2M17 13v6"></path>',
      'deposit-return': '<path d="M4 9a8 8 0 1 1 0 7M4 4v5h5"></path><path d="M14.5 9h-3a1.5 1.5 0 0 0 0 3h1a1.5 1.5 0 0 1 0 3h-3M12 7v10"></path>',
      'data-retention': '<path d="M4 8v13h7M3 3h18v5H3V3ZM8 12h3"></path><circle cx="17" cy="16" r="5"></circle><path d="M17 13v3l2 1"></path>',
      '◉': '<circle cx="12" cy="12" r="7"></circle><circle cx="12" cy="12" r="2"></circle>',
      '▤': '<rect x="5" y="4" width="14" height="17" rx="2"></rect><path d="M9 4V2h6v2M8 9h8M8 13h8M8 17h5"></path>',
      '▦': '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z"></path><path d="M9 7h6M9 11h6M9 15h3"></path>',
      '◎': '<circle cx="12" cy="8" r="3"></circle><path d="M6 20c.7-3.3 2.7-5 6-5s5.3 1.7 6 5"></path>',
      '▣': '<rect x="5" y="5" width="14" height="14" rx="2"></rect><path d="M8 8h8v8H8z"></path>',
      '⚙': '<path d="m10 3-.5 3-2 .9L5 5l-2 3 2.5 2-.2 2L3 14l2 3 3-1 1.5 1.2.5 3h4l.5-3 2-.9L19 18l2-3-2.5-2 .2-2L21 9l-2-3-3 1L14.5 6 14 3h-4Z"></path><circle cx="12" cy="12" r="3"></circle>',
      'N': '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"></path><path d="M10 21h4"></path>',
      '◷': '<circle cx="12" cy="12" r="8"></circle><path d="M12 7v5l3 2"></path>',
      '↺': '<path d="M5 9a8 8 0 1 1 1 8"></path><path d="M5 5v4h4"></path>',
      '↗': '<path d="M7 17 17 7M9 7h8v8"></path>',
      '$': '<path d="M12 3v18M16 7.5c-.8-1-2-1.5-4-1.5-2.4 0-4 1.2-4 3s1.6 3 4 3 4 1.2 4 3-1.6 3-4 3c-2 0-3.2-.5-4-1.5"></path>',
      '⚿': '<rect x="5" y="10" width="14" height="10" rx="2"></rect><path d="M8 10V7a4 4 0 0 1 8 0v3"></path>',
      '✦': '<circle cx="6" cy="12" r="3"></circle><circle cx="18" cy="5" r="3"></circle><circle cx="18" cy="19" r="3"></circle><path d="m8.6 10.5 6.8-4M8.6 13.5l6.8 4"></path>',
      '◈': '<rect x="6" y="4" width="12" height="17" rx="2"></rect><path d="M9 4V3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1"></path><path d="m9 13 2 2 4-4"></path>',
      'grid': '<rect x="4" y="4" width="7" height="7" rx="1.5"></rect><rect x="13" y="4" width="7" height="7" rx="1.5"></rect><rect x="4" y="13" width="7" height="7" rx="1.5"></rect><rect x="13" y="13" width="7" height="7" rx="1.5"></rect>',
      'alert': '<path d="M12 3 2 20h20L12 3Z"></path><path d="M12 9.5v4.5"></path><circle cx="12" cy="17" r="0.9" fill="currentColor" stroke="none"></circle>',
      'inbox': '<path d="M4 12h4l2 3h4l2-3h4"></path><path d="M5.5 5h13L21 12v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-6L5.5 5Z"></path>',
      'chart': '<path d="M4 20V10M10 20V4M16 20v-6"></path><path d="M3 20h18"></path>',
      'gift': '<rect x="3" y="8" width="18" height="4" rx="1"></rect><path d="M5 12v9h14v-9M12 8v13"></path><path d="M12 8H8a3 3 0 1 1 3-3l1 3Zm0 0h4a3 3 0 1 0-3-3l-1 3Z"></path>',
      'laptop': '<rect x="3" y="4" width="18" height="12" rx="1.5"></rect><path d="M2 20h20"></path>',
      '+': '<path d="M12 5v14M5 12h14"></path>',
      '♙': '<circle cx="9" cy="8" r="3"></circle><path d="M3 20v-2a6 6 0 0 1 10-4M18 12l4 2v3c0 2-2 4-4 5-2-1-4-3-4-5v-3l4-2Z"></path><path d="m16.5 17 1 1 2-2"></path>',
      '▥': '<rect x="4" y="5" width="16" height="16" rx="2"></rect><path d="M8 3v4M16 3v4M8 11h8M8 15h8M8 18h4"></path>',
      '⌑': '<path d="m12 3 8 5-8 5-8-5 8-5Z"></path><path d="m6 12 6 4 6-4M6 16l6 4 6-4"></path>',
      '⌁': '<rect x="3" y="3" width="14" height="11" rx="2"></rect><path d="M10 14v4M6 18h6M15 17l2-2a2.1 2.1 0 0 1 3 3l-2 2a2.1 2.1 0 0 1-3 0M13 19l-2 2a2.1 2.1 0 0 1-3-3l2-2a2.1 2.1 0 0 1 3 0"></path>',
      '◫': '<rect x="3" y="5" width="18" height="16" rx="2"></rect><path d="M7 3v4M17 3v4M3 10h18M7 14h2M13 14h4M7 17h2"></path>',
      '%': '<path d="M3 8V5h18v4a3 3 0 0 0 0 6v4H3v-4a3 3 0 0 0 0-6V8Z"></path><path d="m15 8-6 8"></path><circle cx="9" cy="8" r="1"></circle><circle cx="15" cy="16" r="1"></circle>',
      '◇': '<path d="m12 3 9 5-9 5-9-5 9-5ZM3 12l9 5 9-5M3 16l9 5 9-5"></path>',
      '✉': '<rect x="4" y="6" width="16" height="12" rx="2"></rect><path d="m5 8 7 5 7-5"></path>'
      , '◌': '<path d="M20 8V6a2 2 0 0 0-2-2H6a3 3 0 0 0 0 6h14v10H6a3 3 0 0 1-3-3V7"></path><path d="M20 12h-5v4h5"></path><circle cx="17" cy="14" r=".5" fill="currentColor" stroke="none"></circle>'
      , '↥': '<path d="M12 19V5"></path><path d="m7 10 5-5 5 5"></path><path d="M5 19h14"></path>'
      , '⌂': '<path d="m4 11 8-7 8 7"></path><path d="M6 10v10h12V10M10 20v-6h4v6"></path>'
      , '◍': '<path d="M4.9 18a9 9 0 1 1 14.2 0H4.9Z"></path><path d="m12 13 4-5M6 12h1M17 12h1M12 5v1"></path><circle cx="12" cy="13" r="1"></circle>'
      , '▰': '<rect x="4" y="6" width="16" height="12" rx="2"></rect><path d="M4 10h16M8 14h3M8 16h6"></path>'
      , '♧': '<circle cx="9" cy="8" r="3"></circle><path d="M3 20v-2a6 6 0 0 1 12 0v2M16 5a3 3 0 0 1 0 6M18 14a5 5 0 0 1 3 4v2"></path>'
      , '▱': '<path d="M6 4h9l3 3v13H6z"></path><path d="M15 4v4h4M9 12h6M9 16h4"></path>'
      , '⌖': '<circle cx="12" cy="12" r="7"></circle><circle cx="12" cy="12" r="2"></circle><path d="M12 3v2M12 19v2M3 12h2M19 12h2"></path>'
      , '▭': '<rect x="3" y="4" width="18" height="13" rx="2"></rect><path d="M12 17v4M8 21h8"></path>'
      , '☷': '<path d="M5 6h14M5 12h14M5 18h14"></path><circle cx="8" cy="6" r="1"></circle><circle cx="16" cy="12" r="1"></circle><circle cx="10" cy="18" r="1"></circle>'
      , '◓': '<rect x="4" y="5" width="16" height="15" rx="2"></rect><path d="M8 3v4M16 3v4M8 11h1M12 11h4M8 16h1M12 16h4"></path>'
      , '◒': '<path d="M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16Z"></path><path d="M12 4a8 8 0 0 0 0 16Z"></path>'
      , '⌘': '<rect x="9" y="3" width="6" height="5" rx="1"></rect><rect x="3" y="16" width="6" height="5" rx="1"></rect><rect x="15" y="16" width="6" height="5" rx="1"></rect><path d="M12 8v4M6 16v-4h12v4"></path>'
      , '✍': '<path d="M4 20h4L18.5 9.5a2 2 0 0 0-3-3L5 17Z"></path><path d="M13.5 6.5l3 3"></path><path d="M4 20l1-3"></path>'
      , '▧': '<rect x="4" y="4" width="16" height="16" rx="2"></rect><path d="M4 9h16"></path><path d="M10 9v11"></path>'
      , 'trend': '<path d="M4 18l6-6 4 4 6-7"></path><path d="M15 9h5v5"></path><path d="M3 21h18"></path>'
      , '⧗': '<path d="M6 4h12M6 20h12"></path><path d="M7 4c0 4 10 5 10 8s-10 4-10 8"></path><path d="M17 4c0 4-10 5-10 8"></path>'
      , 'activity': '<path d="M3 12h4l3 8 4-16 3 8h4"></path>'
      , '⚑': '<path d="m3 10 14-6v16L3 14v-4ZM17 9h3v6h-3M5 15l2 6h4l-2-5M3 10v4"></path>'
      , 'file-plus': '<path d="M14 3H5v18h14V8l-5-5ZM14 3v5h5M8 14h8M12 10v8"></path>'
      , 'scan': '<path d="M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5M3 12h18M7 7h3v3H7zM14 7h3v3h-3zM7 15h3v3H7zM14 15h3v3h-3z"></path>'
      , 'receipt': '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z"></path><path d="M9 7h6M9 11h6M9 15h2M14 15h1"></path>'
      , 'message-template': '<path d="M21 14a2 2 0 0 1-2 2H9l-6 5V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v9Z"></path><path d="M7 7h10M7 11h6"></path>'
      , 'order-review': '<path d="M10 21H5V3h12v7M8 7h6M8 11h2"></path><circle cx="16" cy="16" r="4"></circle><path d="m19 19 3 3M14.5 16l1 1 2-2"></path>'
      , 'gift-card': '<rect x="3" y="5" width="18" height="14" rx="2"></rect><path d="M3 10h18M14 10v9M11 15h6M7 14h2"></path><path d="M14 10c-5 0-4-5-1-3l1 3Zm0 0c5 0 4-5 1-3l-1 3Z"></path>'
      , 'feedback-reward': '<path d="M13 16H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v5M7 7h10M7 11h4"></path><circle cx="18" cy="16" r="3"></circle><path d="m16 19-1 3 3-1 3 1-1-3"></path>'
      , 'bell-settings': '<path d="M12 3a6 6 0 0 0-6 6c0 5-3 5-3 7h9M10 20h3M15 5h6M18 3v4M15 11h6M16 9v4M15 17h6M19 15v4"></path>'
      , 'link': '<path d="m10 7 3-3a5 5 0 0 1 7 7l-3 3M14 17l-3 3a5 5 0 0 1-7-7l3-3M8 16l8-8"></path>'
      , 'truck': '<path d="M3 5h11v12H3V5ZM14 9h4l3 4v4h-7M14 13h7"></path><circle cx="7" cy="18" r="2"></circle><circle cx="18" cy="18" r="2"></circle>'
      , 'marketing-chart': '<path d="M3 3v18h18M7 17v-4M12 17V9M17 17v-6M6 9l5-4 5 2 5-4M17 3h4v4"></path>'
      , 'code': '<path d="m7 7-5 5 5 5M17 7l5 5-5 5M14 4l-4 16"></path>'
      , 'today': '<rect x="3" y="5" width="18" height="16" rx="2"></rect><path d="M7 3v4M17 3v4M3 10h18"></path><circle cx="12" cy="15.5" r="2.5"></circle>'
      , 'pickup': '<path d="m3 7 9-4 9 4-9 4-9-4ZM3 7v10l9 4 9-4V7M12 11v10M8 14H2M5 11l3 3-3 3"></path>'
      , 'return': '<path d="m3 7 9-4 9 4-9 4-9-4ZM3 7v10l9 4 9-4V7M12 11v10M16 14h6M19 11l-3 3 3 3"></path>'
    }
    return `<svg class="nav-icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[kind] || paths['▣']}</svg>`
  }
  const renderNavLink = (href: string, text: string) => {
    if (currentUser?.role !== 'ADMIN' && currentUser?.clientAccess && !clientPathEnabled(currentUser.clientAccess,href,'console')) return ''
    const icon = navIcons[href] || navIcons[href.split('?')[0]] || '▣'
    return `<a href="${href}"><span class="nav-icon">${navIconSvg(icon)}</span>${text}</a>`
  }
  const chevronSvg = '<span class="nav-group-chevron" aria-hidden="true"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"></path></svg></span>'
  const navGroupIcons: Record<string, string> = { '合同中心': 'rental-contract', '租赁工作区': 'laptop', '账户与钱包': '◌', '租赁管理': '▥', '合同管理': 'rental-contract', '设备运营': 'asset-register', '人员管理': 'people', '通知中心': 'inbox', '设备管理': 'asset-register', '财务管理': 'rental-finance', '营销增长': 'marketing-chart', '系统设置': 'client-controls' }
  const renderNavGroup = (label: string, links: Array<[string, string]>) => {
    const content = links.map(([href, text]) => renderNavLink(href, text)).join('')
    return content ? `<details class="sidebar-nav-group"><summary>${label}<span class="nav-group-icon" aria-hidden="true">${navIconSvg(navGroupIcons[label] || 'grid')}</span>${chevronSvg}</summary><div class="nav-group-links">${content}</div></details>` : ''
  }

  // 手机端底部 tab：只放最高频的核心动作（完整能力在「更多」抽屉与手机工作台里）。
  // 第三个元素是该 tab 视为「当前页」的路径前缀，用于输出 aria-current 与 active 高亮。
  const mobileLinks: Array<[string, string, string, string[]]> = currentUser?.role === 'ADMIN' || currentUser?.role === 'STAFF'
    ? [
        ['/staff/mobile', '今日订单', '◉', ['/staff/mobile/today']],
        ['/staff/mobile/pickup', '取货', '◷', ['/staff/mobile/pickup']],
        ['/staff/mobile/return', '归还', '↺', ['/staff/mobile/return']],
        ['/staff/inspections', '验机', '◈', ['/staff/inspections']],
      ]
      : currentUser?.accountType === 'guest'
        ? [['/customer/guest', '合同中心', '▤', ['/customer/guest']], ['/customer/guest/upgrade', '升级账户', '✦', ['/customer/guest/upgrade']]]
        : [['/customer/dashboard', '首页', '◉', ['/customer/dashboard']], ['/notifications', '通知', 'N', ['/notifications']], ['/customer/devices', '可租设备', 'laptop', ['/customer/devices']], ['/customer/rental-program', '我的出租', 'laptop', ['/customer/rental-program']], ['/customer/rentals', '租赁', '▤', ['/customer/rentals']], ['/customer/orders', '订单', '▦', ['/customer/orders']], ['/customer/balance', '钱包', '$', ['/customer/balance']], ['/customer/profile', '我的', '◎', ['/customer/profile']]]
  const mobileNav = currentUser
    ? mobileLinks.filter(([href]) => currentUser?.role === 'ADMIN' || !currentUser?.clientAccess || clientPathEnabled(currentUser.clientAccess,href,'console')).map(([href, text, icon, activePaths]) => {
        const isCurrent = (href === '/staff/mobile' && currentPath === href) || activePaths.some(path => currentPath === path || currentPath.startsWith(`${path}/`))
        return `<a href="${href}"${isCurrent ? ' class="active" aria-current="page"' : ''}><span class="nav-icon">${navIconSvg(navIcons[href] || icon)}</span><small>${text}</small></a>`
      }).join('')
    : `<a href="/login"><span class="nav-icon">${navIconSvg('↗')}</span><small>登录</small></a><a href="/register"><span class="nav-icon">${navIconSvg('+')}</span><small>注册</small></a>`
  const mobileLabel = currentUser?.role === 'ADMIN' ? '管理端' : currentUser?.role === 'STAFF' ? '员工端' : currentUser?.accountType === 'guest' ? '访客合同' : '客户端'
  const mobileUserBlock = currentUser ? `<details class="mobile-account-menu"><summary aria-label="账户菜单"><span class="mobile-user-avatar" aria-hidden="true">${getAvatarInitials(currentUser.name)}</span></summary><div class="mobile-account-menu__panel"><strong>${sanitizePlainText(currentUser.name, 80)}</strong><a href="${currentUser.role === 'ADMIN' ? `/admin/users/${encodeURIComponent(currentUser.id)}/edit` : currentUser.role === 'STAFF' ? '/staff/profile' : '/customer/profile'}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M5 21v-2a7 7 0 0 1 14 0v2"/></svg>个人信息</a><form method="post" action="/logout"><button type="submit"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/></svg>退出登录</button></form></div></details>` : ''

  const languageSwitcher = `<button class="language-toggle" type="button" data-language-toggle data-language-label aria-label="切换到英文" title="切换到英文">English</button>`

  const mobileNavToggle = currentUser
    ? `<button class="mobile-nav-toggle" type="button" aria-label="打开导航菜单" aria-expanded="false" aria-controls="app-sidebar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"></path></svg></button>`
    : ''

  const searchTrigger = currentUser
    ? `<button class="sidebar-search-trigger" type="button" data-global-search-trigger aria-controls="global-search"><span class="sidebar-search-trigger__icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="6.5"></circle><path d="m16 16 4 4"></path></svg></span><span class="sidebar-search-trigger__label">快速定位</span><kbd>⌘ K</kbd></button>`
    : ''

  const searchIndex = currentUser?.role === 'ADMIN'
    ? [
        ['/admin/settings#companyName', '公司资料', '系统设置', '公司名称 ABN 地址 联系方式 自取地点 配送区域'],
        ['/admin/rental-rules', '租赁规则', '租赁管理', '取还时间 营业时段 不营业 服务费 最短租期 缓冲天数 周租 月租 折扣'],
        ['/admin/settings#requireEmailVerification', '注册安全与邮箱验证', '系统设置', '注册 安全 邮箱验证 验证码'],
        ['/admin/marketing-emails#feedbackRewards', '反馈奖励与礼品卡', '营销增长', 'Tally 反馈 奖励 余额 优惠码 礼品卡'],
        ['/admin/settings#enableStripe', '支付方式与手续费', '系统设置', '支付 Stripe Square 银行转账 余额 手续费'],
        ['/admin/settings#bankName', '银行转账账户信息', '系统设置', '银行 BSB 账号 账户 转账'],
        ['/admin/settings#alipayQrUrl', '支付宝 / 微信收款码', '系统设置', '支付宝 微信 收款码 二维码 RMB 人民币 图片付款'],
        ['/admin/settings#defaultReferralRate', '推荐返佣规则', '系统设置', '推荐 返佣 分成 结算'],
        ['/admin/api-settings#turnstileSiteKey', 'Turnstile 验证', 'API 设置', 'Cloudflare Turnstile 人机 验证码 bot 注册'],
        ['/admin/api-settings#emailProvider', '邮件与通知渠道', 'API 设置', 'Resend Brevo MailerSend 邮件 Webhook 通知 推送'],
        ['/admin/api-settings#stripePublishableKey', 'Stripe 支付配置', 'API 设置', 'Stripe API 信用卡 支付 Webhook 密钥'],
        ['/admin/api-settings#squareApplicationId', 'Square 礼品卡配置', 'API 设置', 'Square API 礼品卡 支付 沙盒'],
        ['/admin/api-settings#cloudinaryCloudName', 'Cloudinary 媒体上传', 'API 设置', 'Cloudinary API 付款凭证 损坏照片 图片上传'],
        ['/admin/api-settings#zoom2uApiToken', 'Zoom2u 配送配置', 'API 设置', 'Zoom2u 配送 API 派送 回收 取货'],
      ]
    : []
  const searchIndexHtml = searchIndex.length
    ? `<div id="global-search-index" hidden aria-hidden="true">${searchIndex.map(([href, label, group, keywords]) => `<a href="${href}" data-search-group="${group}" data-search-keywords="${keywords}">${label}</a>`).join('')}</div>`
    : ''

  const searchPanel = currentUser
    ? `<aside class="global-search" id="global-search" aria-hidden="true">
        <div class="global-search__scrim" data-global-search-close></div>
        <section class="global-search__panel" role="dialog" aria-modal="true" aria-labelledby="global-search-title">
          <div class="global-search__head"><div><span class="section-code">QUICK NAVIGATION</span><h2 id="global-search-title">去哪里？</h2></div><button class="global-search__close" type="button" data-global-search-close aria-label="关闭搜索">Esc</button></div>
          <label class="global-search__input-wrap" for="global-search-input"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6.5"></circle><path d="m16 16 4 4"></path></svg><input id="global-search-input" type="search" autocomplete="off" spellcheck="false" placeholder="查找订单、单据、客户或设置功能" aria-controls="global-search-results" aria-autocomplete="list"></label>
          <div class="global-search__meta" id="global-search-meta">搜索页面、订单与单据</div>
          <div class="global-search__results" id="global-search-results" role="listbox" aria-label="搜索结果"></div>
          <div class="global-search__foot"><span><kbd>↑</kbd><kbd>↓</kbd> 选择</span><span><kbd>Enter</kbd> 打开</span><span><kbd>Esc</kbd> 关闭</span></div>
        </section>
      </aside>${searchIndexHtml}`
    : ''

  const sidebar = currentUser
    ? `<aside class="sidebar ${currentUser.role === 'ADMIN' || currentUser.role === 'STAFF' ? 'sidebar--desktop' : ''}" id="${currentUser.role === 'ADMIN' || currentUser.role === 'STAFF' ? 'desktop-sidebar' : 'app-sidebar'}">
        <div class="sidebar-section">
          <div class="workspace-switch"><span class="workspace-switch__mark" aria-hidden="true">${navIconSvg(currentUser.role === 'CUSTOMER' ? 'laptop' : 'rental-console')}</span><div><small>PC RENTAL</small><strong>${mobileLabel}</strong></div></div>
          ${searchTrigger}
          ${currentUser.role === 'CUSTOMER' ? `
            ${currentUser.accountType === 'guest' ? renderNavGroup('合同中心', [['/customer/guest', '访客合同中心'], ['/customer/guest/upgrade', '升级账户']]) : `
              ${renderNavLink('/customer/dashboard', '控制台')}
              ${renderNavGroup('租赁工作区', [['/customer/rentals', '我的租赁'], ['/customer/orders', '订单管理'], ['/customer/devices', '可租设备'], ['/customer/rental-program', '我的出租']])}
              ${renderNavGroup('账户与钱包', [['/customer/balance', '我的钱包'], ['/customer/profile', '个人资料'], ['/customer/security', '安全设置'], ['/customer/referral', '推荐计划']])}
            `}
          ` : ''}
          ${currentUser.role === 'STAFF' ? `
            ${renderNavLink('/staff/dashboard', '工作台')}${renderNavLink('/staff/roster', '我的排班')}${renderNavLink('/staff/mobile/pickup', '今日自提')}${renderNavLink('/staff/mobile/return', '今日归还')}
            ${renderNavLink('/notifications', '通知中心')}
            ${renderNavGroup('租赁管理', [['/staff/orders', '租赁订单'], ['/staff/orders/ongoing', '进行中的租赁'], ['/staff/returns', '归还管理']])}
            ${renderNavGroup('合同管理', [['/staff/contracts', '合同列表'], ['/staff/contracts?status=pending_sign', '待签署合同']])}
            ${renderNavGroup('设备运营', [['/staff/devices', '设备管理'], ['/staff/inspections', '验机记录'], ['/staff/rentals/tracking', '租赁追踪']])}
            ${getAccessLevel(currentUser) === 'MANAGER' ? renderNavGroup('人员管理', [['/manager/staff', 'Staff 员工']]) : ''}
          ` : ''}
          ${currentUser.role === 'ADMIN' ? `
            ${renderNavLink('/admin/dashboard', '控制台')}${renderNavLink('/admin/roster', '员工排班')}
            ${renderNavLink('/admin/users', '用户管理')}
            ${renderNavGroup('通知中心', [['/notifications', '通知中心'], ['/notifications/compose', '发布通知'], ['/manager/email-events', '邮件发送记录'], ['/admin/email-templates', '邮件通知模板'], ['/admin/in-app-notification-templates', '站内通知模板'], ['/admin/notifications/settings', '通知设置']])}
            ${renderNavGroup('租赁管理', [['/admin/order-review', '网站订单审核'], ['/admin/orders', '租赁订单'], ['/admin/returns', '归还管理'], ['/admin/delivery', '配送管理'], ['/admin/calendar', '租赁日历'], ['/admin/rental-rules', '租赁规则']])}
            ${renderNavGroup('合同管理', [['/admin/contracts', '合同列表'], ['/admin/templates/contract', '合同模板'], ['/admin/templates', '协议模板']])}
            ${renderNavGroup('设备管理', [['/admin/rental-program', '设备出租管理'], ['/admin/devices', '设备管理'], ['/admin/devices/relist', '设备上架'], ['/admin/device-agent-bindings', '绑定设备'], ['/admin/inspections', '验机记录'], ['/admin/devices/reports', '设备运营报表']])}
            ${renderNavGroup('财务管理', [['/admin/finance', '财务总览'], ['/admin/rental-settlements', '出租结算转账'], ['/admin/documents', '单据中心'], ['/admin/reports', '运营分析报表'], ['/admin/refunds', '退款管理'], ['/admin/withdrawals', '佣金提现']])}
            ${renderNavGroup('营销增长', [['/admin/coupons', '优惠码管理'], ['/admin/marketing-emails', '营销邮件'], ['/admin/marketing-emails/data', '营销数据'], ['/admin/referrals', '推荐奖励管理'], ['/admin/feedback-rewards', '反馈奖励记录'], ['/admin/feedback-gift-cards', '礼品卡库存'], ['/admin/website-advertisements', '官网广告']])}
            ${renderNavGroup('系统设置', [['/admin/tax-invoice-template', 'Tax Invoice PDF 模板'], ['/admin/settings', '系统设置'], ['/admin/settings/client-features', '客户端功能'], ['/admin/api-settings', 'API 设置'], ['/admin/connectivity', '通讯检测'], ['/admin/exceptions', '异常任务中心'], ['/admin/monitoring', '系统健康监控'], ['/admin/data-retention', '数据保留策略']])}
          ` : ''}
        </div>
        <div class="sidebar-footer">
          <div class="status-indicator online" id="system-status-indicator" title="正在检查系统状态">
            <span class="led"></span>
            <span id="system-status-label">正常</span>
          </div>
        </div>
      </aside>`
    : ''

  const mobileOperationsSidebar = currentUser && (currentUser.role === 'ADMIN' || currentUser.role === 'STAFF')
    ? `<aside class="sidebar sidebar--mobile" id="app-sidebar">
        <div class="sidebar-section">
          <div class="workspace-switch"><span class="workspace-switch__mark" aria-hidden="true">${navIconSvg('rental-console')}</span><div><small>PC RENTAL</small><strong>租赁操作</strong></div></div>
          ${searchTrigger}
          ${mobileLinks.map(([href, text]) => renderNavLink(href, text)).join('')}
        </div>
        <div class="sidebar-footer">
          <div class="status-indicator online" title="正在检查系统状态">
            <span class="led"></span>
            <span>正常</span>
          </div>
        </div>
      </aside>`
    : ''

  const footerCompany = sanitizePlainText(systemSettings.companyDetails.name || 'PC Rental', 80)
  // 页脚在所有页面（登录前后）保持一致：平铺三个核心法律链接，其余合规页面
  // 统一收进「更多」折叠菜单，避免一长排链接换行。
  const footerPrimaryLinks: Array<[string, string]> = [
    ['/user-terms', '用户协议'], ['/service-terms', '服务条款'], ['/privacy', '隐私政策'],
  ]
  const footerMoreLinks: Array<[string, string]> = [
    ['/cookies', 'Cookie 政策'], ['/refund-policy', '退款政策'], ['/consumer-rights', '消费者权利'],
    ['/complaints', '投诉与争议'], ['/acceptable-use', '可接受使用'], ['/software-terms', '软件协议'],
  ]
  const renderFooterLink = ([href, text]: [string, string]) => `<a href="${href}">${text}</a>`
  const footerNav = footerPrimaryLinks.map(renderFooterLink).join('')
  const footerMore = footerMoreLinks.length
    ? `<details class="legal-footer__more"><summary>更多</summary><div class="legal-footer__more-panel">${footerMoreLinks.map(renderFooterLink).join('')}</div></details>`
    : ''
  const footerHtml = `<footer class="legal-footer"><span class="legal-footer__copyright">© ${new Date().getFullYear()} ${footerCompany}</span><nav aria-label="网站法律信息">${footerNav}${footerMore}</nav></footer>`

  const layoutHtml = renderLayoutTemplate({
    TITLE: normalizedTitle,
    BODY_CLASS: isAuthPage ? 'auth-page' : currentUser ? `app-page workspace workspace--${currentUser.role.toLowerCase()}` : 'public-page',
    TOP_NAV: topNav,
    USER_BLOCK: userBlockHtml,
    MOBILE_NAV: mobileNav,
    MOBILE_NAV_TOGGLE: mobileNavToggle,
    MOBILE_LABEL: mobileLabel,
    MOBILE_USER_BLOCK: mobileUserBlock,
    LANGUAGE_SWITCHER: languageSwitcher,
    SEARCH: searchPanel,
    SIDEBAR: sidebar + mobileOperationsSidebar,
    CONTENT: body,
    FOOTER: footerHtml,
    // 首屏语言脚本（极小内联，见 lib/i18n）：在 <head> 同步执行写入
    // <html data-language>，避免英文偏好用户先看到中文再切换的闪烁。
    I18N_BOOT: languageBootScript,
    I18N_DOMAINS: i18nDomainsForRole(currentUser?.role, (currentUser as any)?.accountType)
  })
  return injectTableDataLabels(layoutHtml) // 移动端表格卡片补齐字段名（见 lib/tableLabels）
}

// ==================== 签约会话持久化管理 ====================
const SESSION_EXPIRY_HOURS = 24 // 会话24小时过期

/**
 * 获取或创建签约会话
 * @param c Hono上下文对象
 * @param token 会话token
 * @param contractToken 关联的合同token
 */
export async function getOrCreateSignSession(c: Context, token: string, contractToken: string): Promise<Record<string, any>> {
  const db = getDB(c)

  try {
    // 先尝试获取现有会话 - 使用正确的snake_case列名匹配数据库schema
    const existingSession = await db.prepare(`
      SELECT session_data, expires_at FROM sign_sessions WHERE token = ?
    `).bind(token).first()

    if (existingSession) {
      const sessionData = JSON.parse((existingSession as any).session_data)
      if (sessionData.userInfo?.windowsPassword) sessionData.userInfo.windowsPassword = await decryptSecret(c, sessionData.userInfo.windowsPassword)
      if (sessionData.guestPassword) sessionData.guestPassword = await decryptSecret(c, sessionData.guestPassword)
      const expiresAt = new Date((existingSession as any).expires_at)

      // 检查会话是否过期
      if (expiresAt > new Date()) {
        await logError(c, 'DEBUG', `Retrieved existing sign session`, undefined, { token, contractToken })
        return sessionData
      } else {
        // 会话已过期，删除并创建新的
        await db.prepare('DELETE FROM sign_sessions WHERE token = ?').bind(token).run()
        await logError(c, 'INFO', `Removed expired sign session`, undefined, { token, contractToken })
      }
    }

    // 创建新会话 - 使用正确的snake_case列名匹配数据库schema
    const newSession: Record<string, any> = {}
    const expiresAt = new Date()
    expiresAt.setHours(expiresAt.getHours() + SESSION_EXPIRY_HOURS)

    await db.prepare(`
      INSERT INTO sign_sessions (token, contract_token, session_data, expires_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `).bind(token, contractToken, JSON.stringify(newSession), expiresAt.toISOString()).run()

    await logError(c, 'INFO', `Created new sign session`, undefined, { token, contractToken })
    return newSession
  } catch (error) {
    await logError(c, 'ERROR', `Failed to get or create sign session`, error as Error, { token, contractToken })
    throw error
  }
}

/**
 * 更新签约会话数据
 * @param c Hono上下文对象
 * @param token 会话token
 * @param data 要更新的会话数据
 */
export async function updateSignSession(c: Context, token: string, data: Record<string, any>): Promise<void> {
  const db = getDB(c)

  try {
    // 先获取当前会话
    const currentSession = await db.prepare(`
      SELECT session_data FROM sign_sessions WHERE token = ?
    `).bind(token).first()

    if (!currentSession) {
      throw new Error(`Sign session not found: ${token}`)
    }

    const sessionData = JSON.parse((currentSession as any).session_data)
    const updatedSession = { ...sessionData, ...data }
    if (updatedSession.userInfo?.windowsPassword) {
      updatedSession.userInfo = { ...updatedSession.userInfo, windowsPassword: await encryptSecret(c, updatedSession.userInfo.windowsPassword) }
    }
    if (updatedSession.guestPassword) updatedSession.guestPassword = await encryptSecret(c, updatedSession.guestPassword)

    // 更新数据库中的会话 - 使用正确的snake_case列名匹配数据库schema
    await db.prepare(`
      UPDATE sign_sessions 
      SET session_data = ?, updated_at = CURRENT_TIMESTAMP 
      WHERE token = ?
    `).bind(JSON.stringify(updatedSession), token).run()

    await logError(c, 'DEBUG', `Updated sign session`, undefined, { token, updates: Object.keys(data) })
  } catch (error) {
    await logError(c, 'ERROR', `Failed to update sign session`, error as Error, { token, updates: Object.keys(data) })
    throw error
  }
}

/**
 * 删除签约会话（签约完成后清理）
 * @param c Hono上下文对象
 * @param token 会话token
 */
export async function deleteSignSession(c: Context, token: string): Promise<void> {
  const db = getDB(c)

  try {
    await db.prepare('DELETE FROM sign_sessions WHERE token = ?').bind(token).run()
    await logError(c, 'INFO', `Deleted sign session successfully`, undefined, { token })
  } catch (error) {
    await logError(c, 'WARNING', `Failed to delete sign session`, error as Error, { token })
  }
}

/**
 * 清理所有过期的签约会话
 * @param c Hono上下文对象
 */
export async function cleanupExpiredSignSessions(c: Context): Promise<void> {
  const db = getDB(c)
  const now = new Date().toISOString()

  try {
    const result = await db.prepare(`
      DELETE FROM sign_sessions WHERE expiresAt < ?
    `).bind(now).run()

    const deletedCount = (result as any).changes || 0
    if (deletedCount > 0) {
      await logError(c, 'INFO', `Cleaned up ${deletedCount} expired sign sessions`)
    }
  } catch (error) {
    await logError(c, 'WARNING', 'Failed to cleanup expired sign sessions', error as Error)
  }
}


// Legacy/local in-memory helpers have been removed to avoid shadowing DB-backed exports.
