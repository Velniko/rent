/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

import { rentalPriceBreakdown, type RentalPricingDeviceLike } from '../../domain/rentalPricing'
import { formatCurrency } from '../../site'

export function renderRentalDiscounts(order: any, device: RentalPricingDeviceLike): string {
  const pricing = order.rental_pricing_json ? JSON.parse(order.rental_pricing_json) : device
  const price = rentalPriceBreakdown(pricing, Number(order.rentalPeriod || 0))
  const coupon = Math.max(0, Number(order.discountAmount ?? order.discount_amount ?? 0))
  const rent = Number(order.totalAmount) - Number(order.depositAmount || 0) - Number(order.serviceFee ?? order.service_fee ?? 0) - Number(order.deliveryFee ?? order.delivery_fee ?? 0)
  // 历史订单没有价格快照时，不能用设备现价伪造优惠。
  if (Math.abs(price.total - rent - coupon) > 0.01 || !(price.monthlyDiscountAmount || price.weeklyDiscountAmount || coupon)) return ''
  return `<dl class="data-list rental-discounts"><div><dt>租金原价</dt><dd>${formatCurrency(price.originalAmount)}</dd></div>${price.monthlyDiscountAmount > 0 ? `<div><dt>月租优惠</dt><dd>−${formatCurrency(price.monthlyDiscountAmount)}</dd></div>` : ''}${price.weeklyDiscountAmount > 0 ? `<div><dt>周租优惠</dt><dd>−${formatCurrency(price.weeklyDiscountAmount)}</dd></div>` : ''}${coupon > 0 ? `<div><dt>优惠码优惠</dt><dd>−${formatCurrency(coupon)}</dd></div>` : ''}<div><dt>优惠后租金</dt><dd>${formatCurrency(rent)}</dd></div></dl>`
}
