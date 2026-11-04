/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

import test from 'node:test'
import assert from 'node:assert/strict'
import { scheduledBatches } from '../src/domain/scheduledBatches'

test('one minute trigger preserves all four UTC job frequencies for a full day', () => {
  const counts = { reminders: 0, quarterHourly: 0, hourly: 0, daily: 0 }
  const midnight = Date.parse('2026-11-03T00:00:00Z')
  for (let minute = 0; minute < 24 * 60; minute++) {
    const batches = scheduledBatches('* * * * *', midnight + minute * 60_000)
    for (const key of Object.keys(counts) as Array<keyof typeof counts>) {
      if (batches[key]) counts[key]++
    }
  }
  assert.deepEqual(counts, { reminders: 1440, quarterHourly: 96, hourly: 24, daily: 1 })
})

test('midnight runs every batch and an hourly tick does not run daily maintenance', () => {
  assert.deepEqual(scheduledBatches('* * * * *', Date.parse('2026-11-03T00:00:00Z')), {
    reminders: true, quarterHourly: true, hourly: true, daily: true,
  })
  assert.deepEqual(scheduledBatches('* * * * *', Date.parse('2026-11-03T13:00:00Z')), {
    reminders: true, quarterHourly: true, hourly: true, daily: false,
  })
})

test('legacy cron events stay isolated while trigger changes propagate', () => {
  const time = Date.parse('2026-11-03T00:00:00Z')
  assert.deepEqual(scheduledBatches('*/15 * * * *', time), {
    reminders: false, quarterHourly: true, hourly: false, daily: false,
  })
  assert.deepEqual(scheduledBatches('0 * * * *', time), {
    reminders: false, quarterHourly: false, hourly: true, daily: false,
  })
  assert.deepEqual(scheduledBatches('0 0 * * *', time), {
    reminders: false, quarterHourly: false, hourly: true, daily: true,
  })
})

test('unknown crons and invalid minute timestamps do not run daily maintenance', () => {
  for (const [cron, time] of [['unknown', Date.now()], ['* * * * *', NaN]] as const) {
    assert.deepEqual(scheduledBatches(cron, time), {
      reminders: false, quarterHourly: false, hourly: false, daily: false,
    })
  }
})
