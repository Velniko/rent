/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

export interface RentalLinkAvailabilityConfig {
  today: string; minutes: number; minimumRentalDays: number; bufferDays: number;
  unavailableDates: string[]; unavailableTimeSlots: Record<string, string[]>;
  pickupClosure?: { ranges: { start: string; end: string }[]; weekly: { start: string; end: string; weekday: number }[]; periodTimes: Record<string, string[]> };
  bookings: { startDate: string | null; endDate: string | null; startPeriod?: string; endPeriod?: string }[];
}

// 自包含函数：同一实现供浏览器日历和测试使用，提交时仍由服务端重新核验。
export function createRentalLinkAvailability(config: RentalLinkAvailabilityConfig) {
  const unknownDates = config.bookings.some(booking => !booking.startDate || !booking.endDate)
  // 使用对象方法，避免 Wrangler 的 keepNames 为具名函数变量注入外部 __name 依赖，破坏 toString() 内联。
  const { index, dateAt, validDate, periodBlocked, pickupClosed, overlapsBooking, canStart, canEnd } = {
    index(date: string, period: string) { return Date.parse(`${date}T00:00:00Z`) / 86400000 * 2 + (period === 'PM' ? 1 : 0) },
    dateAt(value: number) { return new Date(Math.floor(value / 2) * 86400000).toISOString().slice(0, 10) },
    validDate(date: string) { return /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date },
    periodBlocked(date: string, period: string) {
      const slots = config.unavailableTimeSlots[date] || []
      return (period === 'AM' ? ['morning_service', 'morning'] : ['afternoon', 'evening_service']).every(slot => slots.includes(slot))
    },
    pickupClosed(date: string, period: string) {
      const closure = config.pickupClosure
      if (!closure) return false
      const weekday = new Date(`${date}T00:00:00Z`).getUTCDay()
      return (closure.periodTimes[period] || []).every(time => closure.ranges.some(range => range.start <= `${date}T${time}` && `${date}T${time}` < range.end)
        || closure.weekly.some(range => range.weekday === weekday && range.start <= time && time < range.end))
    },
    overlapsBooking(start: number, end: number) {
      const buffer = Math.max(0, config.bufferDays)
      const from = buffer ? Math.floor(start / 2) * 2 - buffer * 2 : start
      const until = buffer ? Math.floor(end / 2) * 2 + 1 + buffer * 2 : end
      return config.bookings.some(booking => !booking.startDate || !booking.endDate || (from < index(booking.endDate, booking.endPeriod || 'AM') && index(booking.startDate, booking.startPeriod || 'AM') < until))
    },
    canStart(date: string, period: string) {
      if (unknownDates || !validDate(date) || !['AM', 'PM'].includes(period) || date < config.today || config.unavailableDates.includes(date) || periodBlocked(date, period) || pickupClosed(date, period)) return false
      if (date === config.today && config.minutes >= (period === 'AM' ? 720 : 1380)) return false
      const value = index(date, period)
      const endpointUsed = config.bookings.some(booking => (booking.startDate === date && (booking.startPeriod || 'AM') === period) || (booking.endDate === date && (booking.endPeriod || 'AM') === period))
      return !endpointUsed && !overlapsBooking(value, value)
    },
    canEnd(startDate: string, startPeriod: string, endDate: string, endPeriod: string) {
      if (!canStart(startDate, startPeriod) || !canStart(endDate, endPeriod)) return false
      const from = index(startDate, startPeriod), until = index(endDate, endPeriod), days = Math.ceil((until - from) / 2)
      if (until <= from || days < config.minimumRentalDays || days > 366 || overlapsBooking(from, until)) return false
      for (let day = Math.floor(from / 2) * 2; day <= until; day += 2) if (config.unavailableDates.includes(dateAt(day))) return false
      for (let slot = from; slot < until; slot++) if (periodBlocked(dateAt(slot), slot % 2 ? 'PM' : 'AM')) return false
      return true
    }
  }
  return { canStart, canEnd }
}
