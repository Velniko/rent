/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

/** 月付租赁首期收取押金。 */
export const LONG_TERM_RENTAL_DAYS = 30

export type DepositPaymentMode = 'PAID' | 'PREAUTH' | 'SETUP_INTENT'
export type SecurityDepositMethod = 'bank_transfer' | 'cash' | 'card_hold'

export function normalizeSecurityDepositMethod(value: unknown, fallback: SecurityDepositMethod = 'card_hold'): SecurityDepositMethod {
  const method = String(value || '').trim().toLowerCase()
  return method === 'bank_transfer' || method === 'cash' || method === 'card_hold' ? method : fallback
}

export function securityDepositMethodLabel(value: unknown): string {
  return normalizeSecurityDepositMethod(value) === 'bank_transfer'
    ? '银行转账'
    : normalizeSecurityDepositMethod(value) === 'cash'
      ? '现金'
      : '信用卡预授权 / SetupIntent'
}

export function depositAuthorizationWindowDays(cardBrand: unknown): 7 | 30 {
  const brand = String(cardBrand || '').trim().toLowerCase()
  return brand === 'visa' || brand === 'mastercard' ? 30 : 7
}

export function depositPaymentModeForRental(rentalPeriod: number, cardPayment = true, cardBrand?: unknown): DepositPaymentMode {
  if (!cardPayment) return 'PAID'
  const days = Number(rentalPeriod || 0)
  return days >= LONG_TERM_RENTAL_DAYS ? 'PAID' : days > depositAuthorizationWindowDays(cardBrand) ? 'SETUP_INTENT' : 'PREAUTH'
}

export function depositPaymentModeForOrder(order: { deposit_payment_mode?: unknown; depositPaymentMode?: unknown; rentalPeriod?: unknown; rental_period?: unknown }): DepositPaymentMode {
  const stored = String(order.deposit_payment_mode ?? order.depositPaymentMode ?? '').toUpperCase()
  if (stored === 'PREAUTH' || stored === 'SETUP_INTENT' || stored === 'PAID') return stored
  return 'PAID'
}

/** 预授权释放不产生现金退款，不能用已退款金额判断是否已结算。 */
export function isCardDepositSettled(order: { deposit_payment_mode?: unknown; depositPaymentMode?: unknown; deposit_refund_at?: unknown; deposit_status?: unknown }, hasSucceededDepositRefund = false): boolean {
  return depositPaymentModeForOrder(order) !== 'PAID' && (hasSucceededDepositRefund || Boolean(order.deposit_refund_at) || order.deposit_status === 'REFUNDED')
}
