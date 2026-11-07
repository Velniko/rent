/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

import { canTransitionOrder } from './orderStatus'
import { sanitizePlainText } from '../lib/html'

export const manualOrderStatuses: Record<string, string> = {
  active: '租赁中', suspended: '已暂停', pending_return: '待归还', completed: '已完成', cancelled: '已取消',
}

export function canEditManualOrder(order: { is_manual?: number; status: string }): boolean {
  return order.is_manual === 1 && !['completed', 'cancelled'].includes(order.status)
}

export function parseManualOrder(form: Record<string, unknown>, currentStatus = 'active') {
  const deviceId = String(form.deviceId || '').trim()
  if (!deviceId) return { error: '请选择设备' } as const
  const startDate = String(form.startDate || '').trim()
  const endDate = String(form.endDate || '').trim()
  if (!startDate || !endDate) return { error: '请填写起租日期和归还日期' } as const
  for (const date of [startDate, endDate]) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) return { error: '日期格式无效' } as const
  }
  const startPeriod = form.startPeriod === 'PM' ? 'PM' : form.startPeriod === 'AM' ? 'AM' : ''
  const endPeriod = form.endPeriod === 'PM' ? 'PM' : form.endPeriod === 'AM' ? 'AM' : ''
  if (!startPeriod) return { error: '请选择取货时段' } as const
  if (!endPeriod) return { error: '请选择归还时段' } as const
  const halfDays = Math.round((Date.parse(endDate) - Date.parse(startDate)) / 86400000) * 2 + (endPeriod === 'PM' ? 1 : 0) - (startPeriod === 'PM' ? 1 : 0)
  if (halfDays <= 0) return { error: '归还时段必须晚于取货时段' } as const
  const amount = (name: string) => String(form[name] ?? '').trim() === '' ? 0 : Number(form[name])
  const rentalAmount = amount('rentalAmount'), depositAmount = amount('depositAmount')
  if ([rentalAmount, depositAmount].some(value => !Number.isFinite(value) || value < 0 || value > 99999999.99 || Math.abs(value * 100 - Math.round(value * 100)) > 0.000001)) return { error: '金额必须为非负数，最多保留两位小数' } as const
  const status = String(form.status || currentStatus)
  if (!manualOrderStatuses[status] || !canTransitionOrder(currentStatus, status)) return { error: '不允许的订单状态转换' } as const
  const paymentMethod = String(form.paymentMethod || '')
  if (!['', 'card', 'bank_transfer', 'balance'].includes(paymentMethod)) return { error: '付款方式无效' } as const
  return { data: {
    deviceId, userId: String(form.userId || '').trim() || null,
    startDate, endDate, startPeriod, endPeriod,
    rentalPeriod: Math.round((Date.parse(endDate) - Date.parse(startDate)) / 86400000),
    totalAmount: Math.round((rentalAmount + depositAmount) * 100) / 100, depositAmount, paymentMethod: paymentMethod || null,
    pickupLocation: sanitizePlainText(form.pickupLocation, 300), returnLocation: sanitizePlainText(form.returnLocation, 300),
    rentalNote: sanitizePlainText(form.rentalNote, 2000), status,
  } } as const
}

export type ManualOrderData = NonNullable<ReturnType<typeof parseManualOrder>['data']>
