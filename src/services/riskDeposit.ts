/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

import type { Context } from 'hono'
import { calculateCustomerRiskAssessment, riskDepositSnapshot } from '../domain/riskFlags'
import { getCustomerRiskAssessment } from './risk'
import { approvedIdentityDocument } from './identityVerification'
import { getDeviceById } from '../site'
import { findEligibleCoupon, calculateCouponDiscount } from '../actions/coupons'
import { calculateRentalFee } from '../domain/rentalPricing'

// Apply once when the customer is identified, before confirming an unsigned contract.
// Existing order snapshots keep their quoted deposit even when the rating changes.
export async function applyOrderRiskDeposit(c: Context, order: any, customerId?: string): Promise<void> {
  const pricing = JSON.parse(order.rental_pricing_json || '{}')
  if (order.contractSigned || !['draft', 'pending_approval', 'approved', 'awaiting_signature', 'pending_payment'].includes(order.status)) return
  const paid = await c.env.RENT.prepare("SELECT id FROM payments WHERE rental_id = ? AND status IN ('paid', 'refunded') LIMIT 1").bind(order.id).first()
  if (paid) return
  if (Number(pricing.depositMultiplier ?? 1) < 1 && !(customerId && await approvedIdentityDocument(c, customerId))) throw new Error('请先完成身份验证，再申请等级押金减免')
  if (pricing.depositRiskLevel) return
  const risk = customerId ? await getCustomerRiskAssessment(c, customerId) : calculateCustomerRiskAssessment({})
  const base = Number(pricing.baseDepositAmount ?? pricing.depositAmountBeforeWaiver ?? order.depositAmount ?? 0)
  const snapshot = { ...pricing, ...riskDepositSnapshot(base, risk) }
  const waive = snapshot.billingMode === 'FULL' && Number(order.rentalPeriod) >= 60 && snapshot.depositMultiplier <= 1
  const deposit = waive ? 0 : snapshot.depositAmountBeforeWaiver
  const previousDiscount = Number(order.discount_amount ?? order.discountAmount ?? 0)
  let discount = previousDiscount
  const couponCode = String(order.coupon_code ?? order.couponCode ?? '')
  if (couponCode && !order.coupon_id) {
    const device = await getDeviceById(c, order.deviceId)
    if (!device) throw new Error('设备不存在')
    const parts = { rentalFee: calculateRentalFee(device, Number(order.rentalPeriod)), deliveryFee: Number(order.deliveryFee || 0), depositFee: deposit }
    try { discount = calculateCouponDiscount(await findEligibleCoupon(c, couponCode, device, parts), parts) }
    catch { discount = 0 } // The signing step rechecks eligibility before reserving the coupon.
  }
  const total = Number((Number(order.totalAmount) - Number(order.depositAmount) + deposit + previousDiscount - discount).toFixed(2))
  if (!Number.isFinite(total) || total < 0) throw new Error('订单金额无效')
  const stored = JSON.stringify(snapshot)
  const result = await c.env.RENT.prepare(`UPDATE orders SET depositAmount = ?, totalAmount = ?, rental_pricing_json = ?, deposit_status = ?, discount_amount = ?, updatedAt = CURRENT_TIMESTAMP
    WHERE id = ? AND status IN ('draft', 'pending_approval', 'approved', 'awaiting_signature', 'pending_payment')
      AND COALESCE(contractSigned, 0) = 0 AND NOT EXISTS (SELECT 1 FROM payments WHERE rental_id = orders.id AND status IN ('paid', 'refunded'))`)
    .bind(deposit, total, stored, deposit > 0 ? 'PENDING' : 'NOT_REQUIRED', discount, order.id).run()
  if (Number(result.meta?.changes || 0) > 0) Object.assign(order, { depositAmount: deposit, totalAmount: total, rental_pricing_json: stored, discount_amount: discount })
}
