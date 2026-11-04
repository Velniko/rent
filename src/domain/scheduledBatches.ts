/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

export function scheduledBatches(cron: string, scheduledTime: number) {
  const time = new Date(scheduledTime)
  const minuteTick = cron === '* * * * *' && Number.isFinite(time.getTime())
  const hourly = minuteTick && time.getUTCMinutes() === 0
  return {
    reminders: minuteTick,
    quarterHourly: (minuteTick && time.getUTCMinutes() % 15 === 0) || cron === '*/15 * * * *',
    hourly: hourly || cron === '0 * * * *' || cron === '0 0 * * *',
    daily: (hourly && time.getUTCHours() === 0) || cron === '0 0 * * *',
  }
}
