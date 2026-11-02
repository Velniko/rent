/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

// orders.settlement_status 的唯一计算逻辑。订单“已完成”只代表租赁流程本身走完
// （设备已归还），跟押金是否真正结清是两回事——这里把两者拆开，任何写入
// settlement_status 的地方都必须复用这个函数，不要在各处手写判断条件。
export type OrderSettlementStatus = 'NOT_APPLICABLE' | 'PENDING' | 'SETTLED'

const UNSETTLED_DEPOSIT_STATUSES = new Set(['PENDING', 'HELD', 'REFUND_PENDING'])

export function computeOrderSettlementStatus(order: { status?: unknown; deposit_status?: unknown; overdue_outstanding_amount?: unknown }): OrderSettlementStatus {
  if (String(order.status || '') !== 'completed') return 'NOT_APPLICABLE'
  if (Number(order.overdue_outstanding_amount || 0) > 0) return 'PENDING'
  const depositStatus = String(order.deposit_status || '').toUpperCase()
  return UNSETTLED_DEPOSIT_STATUSES.has(depositStatus) ? 'PENDING' : 'SETTLED'
}
