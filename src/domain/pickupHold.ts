/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

const LEGACY_PICKUP_START_MINUTES: Record<string, number> = {
  morning_service: 7 * 60,
  morning: 9 * 60,
  afternoon: 13 * 60,
  evening_service: 21 * 60,
  delivery_morning: 9 * 60,
  delivery_afternoon: 13 * 60,
  // 手动订单只有 AM/PM 半天时段（startPeriod/endPeriod），没有具体的
  // pickupTimeSlot/returnTimeSlot，按半天切分成取货/归还判定的锚点时间。
  AM: 0,
  PM: 12 * 60,
}

function dateDay(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const timestamp = Date.parse(`${value}T00:00:00Z`)
  return Number.isFinite(timestamp) ? timestamp / 86_400_000 : null
}

function pickupStartMinutes(value: unknown): number | null {
  const slot = String(value || '').trim()
  if (slot in LEGACY_PICKUP_START_MINUTES) return LEGACY_PICKUP_START_MINUTES[slot]
  const match = /^(?:[01]\d|2[0-3]):[0-5]\d$/.exec(slot)
  if (!match) return null
  const [hours, minutes] = slot.split(':').map(Number)
  return hours * 60 + minutes
}

function melbourneDayAndMinutes(now: Date): { day: number; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Australia/Melbourne', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now).reduce<Record<string, string>>((values, part) => {
    if (part.type !== 'literal') values[part.type] = part.value
    return values
  }, {})
  const day = dateDay(`${parts.year}-${parts.month}-${parts.day}`)
  if (day === null) throw new Error('无法读取墨尔本当前日期')
  return { day, minutes: Number(parts.hour) * 60 + Number(parts.minute) }
}

// Store-pickup reservations are held for two hours after the scheduled pickup
// start. Delivery orders are deliberately excluded: their fulfilment window is
// managed by delivery bookings rather than an in-store collection appointment.
export function isPickupHoldExpired(order: any, now = new Date()): boolean {
  if (String(order?.deliveryMethod || order?.delivery_method || 'Pickup') === 'Delivery') return false
  const scheduledDay = dateDay(String(order?.startDate || order?.start_date || ''))
  const scheduledMinutes = pickupStartMinutes(order?.pickupTimeSlot || order?.pickup_time_slot)
  if (scheduledDay === null || scheduledMinutes === null) return false
  const current = melbourneDayAndMinutes(now)
  return current.day * 1440 + current.minutes >= scheduledDay * 1440 + scheduledMinutes + 120
}

// Returns the number of overdue calendar days after the two-hour return grace
// period. Zero means the return is overdue today but has not crossed midnight.
export function returnOverdueDays(order: any, now = new Date()): number | null {
  const scheduledDay = dateDay(String(order?.endDate || order?.end_date || ''))
  const scheduledMinutes = pickupStartMinutes(order?.returnTimeSlot || order?.return_time_slot || order?.endPeriod)
  if (scheduledDay === null || scheduledMinutes === null) return null
  const current = melbourneDayAndMinutes(now)
  if (current.day * 1440 + current.minutes < scheduledDay * 1440 + scheduledMinutes + 120) return null
  return Math.max(0, current.day - scheduledDay)
}
