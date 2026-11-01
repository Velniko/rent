/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync, readdirSync } from 'node:fs'
import { URL } from 'node:url'
import { Hono } from 'hono'
import { handleSaveAdminSettings } from '../src/actions/admin/saveSettings'
import { getSystemSettings, invalidateSystemSettingsCache, loadSystemSettingsFromDB } from '../src/site'
import { isUnavailablePickupTime, pickupTimeOptions, pickupRangeYearEnd, validateUnavailablePickupRanges, pickupClosureConfig } from '../src/domain/pickupTimeSlots'
import { createRentalLinkAvailability } from '../src/domain/rentalLinkAvailability'
import { renderAdminRentalRules } from '../src/pages/admin/rentalRules'
import { extractInlineScripts } from './helpers'

test('closed ranges validate calendar dates, half-hour times and a calendar year including leap days', () => {
  assert.equal(pickupRangeYearEnd('2028-02-29T09:00'), '2029-02-28T09:00')
  assert.deepEqual(validateUnavailablePickupRanges([{ start: '2027-03-01T09:00', end: '2028-03-01T09:00' }]), [{ start: '2027-03-01T09:00', end: '2028-03-01T09:00' }])
  for (const range of [
    { start: '2027-03-01T09:00', end: '2028-03-01T09:30' },
    { start: '2027-02-29T09:00', end: '2027-03-01T09:00' },
    { start: '2027-03-01T09:15', end: '2027-03-01T10:00' },
    { start: '2027-03-01T09:00', end: '2027-03-01T09:00' },
    { start: '2027-03-02T09:00', end: '2027-03-01T09:00' },
  ]) assert.throws(() => validateUnavailablePickupRanges([range]))
})

test('closures block business and paid service hours with an exclusive end boundary', () => {
  const rules = { unavailablePickupRanges: [{ start: '2090-01-04T19:00', end: '2090-01-06T09:30' }] }
  assert.equal(isUnavailablePickupTime('18:30', '2090-01-04', rules), false)
  assert.equal(isUnavailablePickupTime('19:00', '2090-01-04', rules), true)
  assert.equal(isUnavailablePickupTime('21:30', '2090-01-04', rules), true)
  assert.equal(isUnavailablePickupTime('morning', '2090-01-05', rules), true)
  assert.equal(isUnavailablePickupTime('09:00', '2090-01-06', rules), true)
  assert.equal(isUnavailablePickupTime('09:30', '2090-01-06', rules), false)
  assert.deepEqual(pickupTimeOptions(rules, '2090-01-05', 'business'), [])
  assert.deepEqual(pickupTimeOptions(rules, '2090-01-05', 'non_business'), [])
  assert.ok(pickupTimeOptions(rules, '2090-01-06', 'business').includes('09:30'))
})

test('a rental may span a closure while its pickup and return endpoints must be open', () => {
  const rules = { unavailablePickupRanges: [{ start: '2090-01-05T00:00', end: '2090-01-07T13:00' }] }
  const calendar = createRentalLinkAvailability({ today: '2090-01-01', minutes: 0, minimumRentalDays: 1, bufferDays: 0, unavailableDates: [], unavailableTimeSlots: {}, bookings: [], pickupClosure: pickupClosureConfig(rules) })
  assert.equal(calendar.canStart('2090-01-05', 'AM'), false)
  assert.equal(calendar.canStart('2090-01-06', 'PM'), false)
  assert.equal(calendar.canStart('2090-01-07', 'AM'), false)
  assert.equal(calendar.canStart('2090-01-07', 'PM'), true)
  assert.equal(calendar.canEnd('2090-01-04', 'AM', '2090-01-06', 'AM'), false)
  assert.equal(calendar.canEnd('2090-01-04', 'AM', '2090-01-08', 'PM'), true)
})

test('settings persist and reload closures, preserve them on other saves and reject invalid changes', async t => {
  const sqlite = new DatabaseSync(':memory:')
  const previousRules = structuredClone(getSystemSettings().rentalRules)
  t.after(() => { getSystemSettings().rentalRules = previousRules; invalidateSystemSettingsCache(); sqlite.close() })
  for (const file of readdirSync(new URL('../migrations/', import.meta.url)).filter(name => name.endsWith('.sql')).sort()) sqlite.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8'))
  const db = { prepare(sql: string) {
    let params: any[] = []
    const statement = { bind(...values: any[]) { params = values; return statement }, async first() { return sqlite.prepare(sql).get(...params) || null }, async all() { return { results: sqlite.prepare(sql).all(...params) } }, async run() { return { success: true, meta: { changes: Number(sqlite.prepare(sql).run(...params).changes) } } } }
    return statement
  }, async batch(statements: any[]) { return Promise.all(statements.map(statement => statement.run())) } }
  const app = new Hono()
  app.post('/', c => handleSaveAdminSettings(c))
  const env = { RENT: db }, ranges = [{ start: '2090-01-04T19:00', end: '2090-01-06T09:30' }]
  const save = (payload: unknown) => app.request('https://example.test/', { method: 'POST', body: JSON.stringify(payload) }, env)
  invalidateSystemSettingsCache()
  assert.equal((await save({ rentalRules: { unavailablePickupRanges: ranges } })).status, 200)
  assert.equal((await save({ companyDetails: { name: 'Test rental' } })).status, 200)
  const stored = () => JSON.parse(String((sqlite.prepare("SELECT value FROM systemSettings WHERE key = 'rentalRules'").get() as any).value))
  assert.deepEqual(stored().unavailablePickupRanges, ranges)
  invalidateSystemSettingsCache()
  await loadSystemSettingsFromDB({ env } as any)
  assert.deepEqual(getSystemSettings().rentalRules.unavailablePickupRanges, ranges)
  const html = renderAdminRentalRules({ id: 'admin', name: '管理员', role: 'ADMIN' })
  assert.match(html, /添加不营业时间/)
  assert.match(html, /2090-01-04T19:00/)
  for (const script of extractInlineScripts(html)) assert.doesNotThrow(() => new Function(script))
  assert.equal((await save({ rentalRules: { unavailablePickupRanges: [{ start: '2090-01-01T09:00', end: '2091-01-01T09:30' }] } })).status, 500)
  assert.deepEqual(stored().unavailablePickupRanges, ranges)
  assert.equal((await save({ rentalRules: { unavailablePickupRanges: [] } })).status, 200)
  assert.deepEqual(stored().unavailablePickupRanges, [])
})
