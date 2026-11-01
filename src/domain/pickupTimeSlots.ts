/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

export const HALF_HOUR_TIME_OPTIONS = Array.from({ length: 48 }, (_, index) => `${String(Math.floor(index / 2)).padStart(2, '0')}:${index % 2 ? '30' : '00'}`)

export type TimeRange = { start: string; end: string }
export type WeeklyUnavailablePickupRange = TimeRange & { weekday: number }
export type UnavailablePickupRange = { start: string; end: string }
export type PickupTimeSettings = {
  businessHours: TimeRange
  serviceFeeHours: TimeRange[]
  unavailablePickupHours: WeeklyUnavailablePickupRange[]
  unavailablePickupRanges: UnavailablePickupRange[]
}

const defaults: PickupTimeSettings = {
  businessHours: { start: '09:00', end: '20:00' },
  serviceFeeHours: [{ start: '07:00', end: '08:00' }, { start: '21:00', end: '23:00' }],
  unavailablePickupHours: [],
  unavailablePickupRanges: [],
}

/** 墨尔本本地日期时间用固定格式比较，避免夏令时改变封闭日期的边界。 */
export function pickupRangeYearEnd(start: string): string {
  const year = Number(start.slice(0, 4)) + 1, month = Number(start.slice(5, 7))
  const day = Math.min(Number(start.slice(8, 10)), new Date(Date.UTC(year, month, 0)).getUTCDate())
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}${start.slice(10)}`
}

function validLocalDateTime(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):(?:00|30)$/.test(value)
    && Number.isFinite(Date.parse(`${value}:00Z`)) && new Date(`${value}:00Z`).toISOString().slice(0, 16) === value
}

export function validateUnavailablePickupRanges(value: unknown): UnavailablePickupRange[] {
  if (!Array.isArray(value) || value.length > 50) throw new Error('不营业时间最多可添加 50 段')
  return value.map(range => {
    if (!validLocalDateTime(range?.start) || !validLocalDateTime(range?.end)) throw new Error('请选择有效的不营业开始和结束时间')
    if (range.end <= range.start) throw new Error('不营业结束时间必须晚于开始时间')
    if (range.end > pickupRangeYearEnd(range.start)) throw new Error('每段不营业时间最长一年')
    return { start: range.start, end: range.end }
  })
}

export const minutes = (value: string) => { const [hour, minute] = value.split(':').map(Number); return hour * 60 + minute }
const validTime = (value: unknown, fallback: string) => HALF_HOUR_TIME_OPTIONS.includes(String(value)) ? String(value) : fallback
const validRange = (value: any): value is TimeRange => value && HALF_HOUR_TIME_OPTIONS.includes(String(value.start)) && HALF_HOUR_TIME_OPTIONS.includes(String(value.end)) && minutes(String(value.start)) < minutes(String(value.end))

function ranges(value: unknown, fallback: TimeRange[]): TimeRange[] {
  if (Array.isArray(value)) return value.filter(validRange).map(range => ({ start: String(range.start), end: String(range.end) })).slice(0, 12)
  const legacy = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const legacyRanges = [
    { start: validTime(legacy.morningStart, ''), end: validTime(legacy.morningEnd, '') },
    { start: validTime(legacy.eveningStart, ''), end: validTime(legacy.eveningEnd, '') },
  ].filter(validRange)
  return legacyRanges.length ? legacyRanges : fallback.map(range => ({ ...range }))
}

export function pickupTimeSettings(rules: any): PickupTimeSettings {
  const business = rules?.businessHours || {}
  const unavailable = Array.isArray(rules?.unavailablePickupHours) ? rules.unavailablePickupHours : []
  return {
    businessHours: { start: validTime(business.start, defaults.businessHours.start), end: validTime(business.end, defaults.businessHours.end) },
    serviceFeeHours: ranges(rules?.serviceFeeHours, defaults.serviceFeeHours),
    unavailablePickupHours: unavailable.filter((range: any) => validRange(range) && Number.isInteger(Number((range as any).weekday)) && Number((range as any).weekday) >= 0 && Number((range as any).weekday) <= 6).map((range: any) => ({ start: String(range.start), end: String(range.end), weekday: Number((range as any).weekday) })).slice(0, 24),
    unavailablePickupRanges: validateUnavailablePickupRanges(rules?.unavailablePickupRanges ?? []),
  }
}

export function serviceFeeRate(rules: any): number {
  const rate = Number(rules?.serviceFeeRate ?? 0.1)
  return Number.isFinite(rate) ? Math.min(1, Math.max(0, rate)) : 0.1
}

export function hasValidPickupTimeSettings(settings: PickupTimeSettings): boolean {
  if (!validRange(settings.businessHours) || !settings.serviceFeeHours.length) return false
  const businessStart = minutes(settings.businessHours.start), businessEnd = minutes(settings.businessHours.end)
  return settings.serviceFeeHours.every(validRange)
    && settings.serviceFeeHours.every(range => minutes(range.end) <= businessStart || minutes(range.start) >= businessEnd)
    && settings.unavailablePickupHours.every(range => validRange(range) && Number.isInteger(range.weekday) && range.weekday >= 0 && range.weekday <= 6)
}

function inRange(time: string, range: TimeRange): boolean {
  const value = minutes(time)
  return value >= minutes(range.start) && value < minutes(range.end)
}

export function pickupTimeMode(time: string, rules: any): 'business' | 'non_business' | '' {
  const settings = pickupTimeSettings(rules)
  if (!HALF_HOUR_TIME_OPTIONS.includes(time)) return ''
  if (inRange(time, settings.businessHours)) return 'business'
  return settings.serviceFeeHours.some(range => inRange(time, range)) ? 'non_business' : ''
}

export function legacyPickupSlot(time: string, rules: any): string {
  const mode = pickupTimeMode(time, rules)
  if (mode === 'non_business') return minutes(time) < 12 * 60 ? 'morning_service' : 'evening_service'
  if (mode === 'business') return minutes(time) < 13 * 60 ? 'morning' : 'afternoon'
  return ''
}

export function isUnavailablePickupTime(time: string, date: string, rules: any): boolean {
  const settings = pickupTimeSettings(rules)
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay()
  const blocked = (value: string) => settings.unavailablePickupHours.some(range => range.weekday === weekday && inRange(value, range))
    || settings.unavailablePickupRanges.some(range => range.start <= `${date}T${value}` && `${date}T${value}` < range.end)
  if (HALF_HOUR_TIME_OPTIONS.includes(time)) return blocked(time)
  if (!['morning_service', 'morning', 'afternoon', 'evening_service'].includes(time)) return false
  const options = HALF_HOUR_TIME_OPTIONS.filter(value => legacyPickupSlot(value, rules) === time)
  return options.length === 0 || options.every(blocked)
}

export function pickupTimeOptions(rules: any, date: string, mode: 'business' | 'non_business'): string[] {
  return HALF_HOUR_TIME_OPTIONS.filter(time => pickupTimeMode(time, rules) === mode && !isUnavailablePickupTime(time, date, rules))
}

export function pickupClosureConfig(rules: any) {
  const settings = pickupTimeSettings(rules)
  const options = HALF_HOUR_TIME_OPTIONS.filter(time => Boolean(pickupTimeMode(time, rules)))
  return { ranges: settings.unavailablePickupRanges, weekly: settings.unavailablePickupHours,
    periodTimes: { AM: options.filter(time => time < '13:00'), PM: options.filter(time => time >= '13:00') } as Record<string, string[]> }
}

/** 自包含，供日期选择器内联；休业仅阻止取还端点，不占用客户已经租用的日期。 */
export function isPickupPeriodClosed(date: string, period: string, closure: ReturnType<typeof pickupClosureConfig>): boolean {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay()
  return (closure.periodTimes[period] || []).every(time =>
    closure.ranges.some(range => range.start <= `${date}T${time}` && `${date}T${time}` < range.end)
    || closure.weekly.some(range => range.weekday === weekday && range.start <= time && time < range.end))
}

export function pickupTimeSlotEndMinutes(slot: string, rules: any): number {
  if (HALF_HOUR_TIME_OPTIONS.includes(slot)) return minutes(slot)
  const settings = pickupTimeSettings(rules)
  const endTimes: Record<string, string> = {
    morning_service: settings.serviceFeeHours[0]?.end || '08:00',
    morning: '12:00',
    afternoon: settings.businessHours.end,
    evening_service: settings.serviceFeeHours[1]?.end || '23:00',
    delivery_morning: '12:00',
    delivery_afternoon: '19:00',
  }
  return endTimes[slot] ? minutes(endTimes[slot]) : 24 * 60
}

// Keep the legacy half-day values used by existing customer forms and orders
// while the newer settings page exposes exact half-hour options.
export function pickupTimeSlots(rules: any): Array<[string, string]> {
  const settings = pickupTimeSettings(rules)
  const feePercent = Number((serviceFeeRate(rules) * 100).toFixed(2))
  const displayTime = (value: string) => value.replace(/^0/, '')
  return [
    ['morning_service', `${displayTime(settings.serviceFeeHours[0]?.start || '07:00')}–${displayTime(settings.serviceFeeHours[0]?.end || '08:00')}（早间服务费 ${feePercent}%）`],
    ['morning', `${displayTime(settings.businessHours.start)}–12:00（无服务费）`],
    ['afternoon', `13:00–${displayTime(settings.businessHours.end)}（无服务费）`],
    ['evening_service', `${displayTime(settings.serviceFeeHours[1]?.start || '21:00')}–${displayTime(settings.serviceFeeHours[1]?.end || '23:00')}（晚间服务费 ${feePercent}%）`],
  ]
}
