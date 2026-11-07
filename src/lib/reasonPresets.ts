/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

import { escapeHtml } from './html'

// 渲染一个「选择常见原因」下拉框：选中后由 appClient.js.txt 里的委托监听器把值填入
// data-reason-preset-for 指向的字段（textarea/input），填完仍可自由编辑。
export function renderReasonPresets(targetId: string, presets: readonly string[], options: { hidden?: boolean } = {}): string {
  const optionTags = presets.map(preset => `<option value="${escapeHtml(preset)}">${escapeHtml(preset)}</option>`).join('')
  return `<select class="form-control reason-preset-select" data-reason-preset-for="${escapeHtml(targetId)}" aria-label="选择常见原因" style="margin-bottom:6px"${options.hidden ? ' hidden' : ''}><option value="">选择常见原因…</option>${optionTags}</select>`
}

export const IDENTITY_REJECTION_REASON_PRESETS = [
  '证件照片模糊，无法辨认信息',
  '证件信息与姓名不一致',
  '证件已过期',
  '未提供有效证件',
  '证件存在涂改或伪造痕迹',
  '手持证件照片缺失',
] as const

export const PAYMENT_PROOF_REJECTION_REASON_PRESETS = [
  '凭证信息不清晰',
  '金额与订单不一致',
  '转账备注/Reference 缺失或错误',
  '付款时间与订单不符',
  '收款账户不符',
] as const

export const ORDER_CANCEL_REASON_PRESETS = [
  '客户申请取消',
  '设备无货',
  '订单信息有误',
  '客户逾期未付款',
] as const

export const ORDER_SUSPEND_REASON_PRESETS = [
  '设备维修中',
  '客户申请暂停',
  '等待客户补充材料',
] as const

export const REFUND_REJECTION_REASON_PRESETS = [
  '退款信息不完整',
  '银行账户信息有误',
  '订单状态不符合退款条件',
  '退款金额与订单不一致',
] as const
