/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

import type { Context } from 'hono'
import { getSystemSettings, loadSystemSettingsFromDB, updateSystemSettings } from '../../site'
import { hasValidPickupTimeSettings, pickupTimeSettings } from '../../domain/pickupTimeSlots'
import { parseDeviceDiscountPercent } from '../../domain/rentalPricing'

export async function handleSaveRentalRules(c: Context): Promise<Response> {
  const payload = await c.req.json() as { rentalRules?: Record<string, unknown> }
  if (!payload.rentalRules || typeof payload.rentalRules !== 'object' || Array.isArray(payload.rentalRules)) throw new Error('租赁规则无效')
  await loadSystemSettingsFromDB(c)
  const current = getSystemSettings().rentalRules, input = payload.rentalRules
  const hours = pickupTimeSettings({ ...current, ...input })
  if (!hasValidPickupTimeSettings(hours)) throw new Error('服务费时段与营业时段必须依次排列，且每段结束时间要晚于开始时间')
  const weeklyDiscountPercent = parseDeviceDiscountPercent(input.weeklyDiscountPercent ?? current.weeklyDiscountPercent)
  const monthlyDiscountPercent = parseDeviceDiscountPercent(input.monthlyDiscountPercent ?? current.monthlyDiscountPercent)
  if (weeklyDiscountPercent === null || monthlyDiscountPercent === null) throw new Error('周租和月租折扣必须是 0%–100% 之间的数字')
  const serviceFeeRate = Number(input.serviceFeeRate ?? current.serviceFeeRate)
  if (!Number.isFinite(serviceFeeRate) || serviceFeeRate < 0 || serviceFeeRate > 1) throw new Error('时段服务费比例必须在 0% 到 100% 之间')
  const minimumRentalDays = Number(input.minimumRentalDays ?? current.minimumRentalDays), bufferDays = Number(input.bufferDays ?? current.bufferDays)
  if (!Number.isInteger(minimumRentalDays) || minimumRentalDays < 1 || !Number.isInteger(bufferDays) || bufferDays < 0) throw new Error('设备最短租赁天数必须为至少 1 天，缓冲天数必须为非负整数')
  await updateSystemSettings(c, { rentalRules: { ...current, ...hours, serviceFeeRate, minimumRentalDays, bufferDays, weeklyDiscountPercent, monthlyDiscountPercent } } as any)
  return c.json({ success: true })
}
