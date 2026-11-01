/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync, readdirSync } from 'node:fs'
import { URL } from 'node:url'
import worker from '../src/index'
import { createAuthSession, getDeviceById, getDevices, getSystemSettings, invalidateSystemSettingsCache } from '../src/site'
import { calculateRentalFee } from '../src/domain/rentalPricing'
import { extractInlineScripts } from './helpers'

test('rental rules have an admin page, isolated saving, validation and inherited pricing', async t => {
  const sqlite = new DatabaseSync(':memory:'), previousRules = structuredClone(getSystemSettings().rentalRules)
  t.after(() => { getSystemSettings().rentalRules = previousRules; invalidateSystemSettingsCache(); sqlite.close() })
  const files = readdirSync(new URL('../migrations/', import.meta.url)).filter(name => name.endsWith('.sql')).sort()
  for (const file of files.filter(file => !file.startsWith('0171_'))) sqlite.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8'))
  sqlite.exec("INSERT INTO users (id,name,email,role) VALUES ('rules-admin','管理员','rules-admin@example.test','ADMIN'),('rules-staff','员工','rules-staff@example.test','STAFF'),('rules-customer','客户','rules-customer@example.test','CUSTOMER'); INSERT INTO devices (id,name,model,serialNumber,pricePerDay,depositAmount,weekly_discount_percent,monthly_discount_percent) VALUES ('inherit','跟随全局','Test','RULES-1',100,200,0,0),('custom','单独设置','Test','RULES-2',100,200,5,15)")
  sqlite.exec(readFileSync(new URL('../migrations/0171_add_device_discount_overrides.sql', import.meta.url), 'utf8'))
  assert.equal(sqlite.prepare("SELECT weekly_discount_override FROM devices WHERE id='inherit'").get()?.weekly_discount_override, null)
  assert.equal(sqlite.prepare("SELECT weekly_discount_override FROM devices WHERE id='custom'").get()?.weekly_discount_override, 5)
  const db = { prepare(sql: string) {
    let params: any[] = []
    const statement = { bind(...values: any[]) { params = values; return statement }, async first() { return sqlite.prepare(sql).get(...params) || null }, async all() { return {results:sqlite.prepare(sql).all(...params)} }, async run() { return {success:true,meta:{changes:Number(sqlite.prepare(sql).run(...params).changes)}} } }
    return statement
  }, async batch(statements: any[]) { return Promise.all(statements.map(statement => statement.run())) } }
  const env = {RENT:db}, context = {env} as any
  invalidateSystemSettingsCache()
  const sessions = Object.fromEntries(await Promise.all(['admin','staff','customer'].map(async role => [role,(await createAuthSession(context,'rules-'+role)).token])))
  const request = (path: string, payload?: unknown, role='admin') => worker.fetch(new Request('https://rent.example.test'+path, {method:payload===undefined?'GET':'POST',headers:{Cookie:`session=${sessions[role]||''}`,Origin:'https://rent.example.test','Sec-Fetch-Site':'same-origin','Content-Type':'application/json'},...(payload===undefined?{}:{body:JSON.stringify(payload)})}),env,{waitUntil(){}} as any)
  const stored = () => JSON.parse(String(sqlite.prepare("SELECT value FROM systemSettings WHERE key='rentalRules'").get()?.value))

  const page = await request('/admin/rental-rules')
  assert.equal(page.status,200)
  const html = await page.text()
  assert.match(html, /<summary>租赁管理[\s\S]*?href="\/admin\/rental-rules"/)
  for (const field of ['businessHoursStart','serviceRangeList','unavailablePickupRanges','weeklyDiscountPercent','monthlyDiscountPercent']) assert.ok(html.includes(`id="${field}"`))
  for (const script of extractInlineScripts(html)) assert.doesNotThrow(() => new Function(script))
  const general = await (await request('/admin/settings')).text()
  assert.doesNotMatch(general,/id="businessHoursStart"|id="minimumRentalDays"|const timeRanges/)
  assert.match(general,/href="\/admin\/rental-rules"/)
  for (const role of ['staff','customer','anonymous']) {
    assert.equal((await request('/admin/rental-rules',undefined,role)).status,403)
    assert.equal((await request('/admin/settings/rental-rules/save',{rentalRules:{}},role)).status,403)
  }

  const before = sqlite.prepare('SELECT key,value FROM systemSettings ORDER BY key').all()
  const rules = {weeklyDiscountPercent:10,monthlyDiscountPercent:20,minimumRentalDays:2,bufferDays:1,serviceFeeRate:0.15,businessHours:{start:'09:30',end:'19:30'},serviceFeeHours:[{start:'07:00',end:'09:00'},{start:'20:00',end:'23:00'}],unavailablePickupHours:[{weekday:1,start:'12:00',end:'13:00'}],unavailablePickupRanges:[{start:'2090-01-01T09:00',end:'2090-01-02T10:00'}]}
  assert.equal((await request('/admin/settings/rental-rules/save',{rentalRules:rules,companyDetails:{name:'ignored'}})).status,200)
  assert.deepEqual(sqlite.prepare("SELECT key,value FROM systemSettings WHERE key != 'rentalRules' ORDER BY key").all(),before.filter(row=>row.key!=='rentalRules'))
  for (const [key,value] of Object.entries(rules)) assert.deepEqual(stored()[key],value)
  const inherited = (await getDeviceById(context,'inherit'))!
  assert.equal(calculateRentalFee(inherited,7),630)
  assert.equal(calculateRentalFee(inherited,30),2400)
  assert.equal(calculateRentalFee((await getDeviceById(context,'custom'))!,7),665)
  assert.equal(calculateRentalFee((await getDeviceById(context,'custom'))!,30),2550)
  assert.equal((await getDevices(context)).find(device=>device.id==='inherit')?.weeklyDiscountPercent,10)

  // Explicit zero and blank must remain distinct through the real device edit route.
  const edit = (discount: string) => worker.fetch(new Request('https://rent.example.test/staff/devices/inherit/edit',{method:'POST',headers:{Cookie:`session=${sessions.admin}`,Origin:'https://rent.example.test','Sec-Fetch-Site':'same-origin'},body:new URLSearchParams({name:'跟随全局',model:'Test',serialNumber:'RULES-1',dailyRate:'100',status:'available',weeklyDiscountPercent:discount,monthlyDiscountPercent:discount})}),env,{waitUntil(){}} as any)
  assert.equal((await edit('0')).status,302)
  assert.equal(calculateRentalFee((await getDeviceById(context,'inherit'))!,7),700)
  assert.equal((await edit('')).status,302)
  assert.equal(calculateRentalFee((await getDeviceById(context,'inherit'))!,7),630)
  const editPage = await (await request('/staff/devices/inherit/edit')).text()
  assert.match(editPage,/name="weeklyDiscountPercent"[^>]*value=""/)

  const good = stored()
  for (const invalid of [{weeklyDiscountPercent:-1},{monthlyDiscountPercent:101},{weeklyDiscountPercent:'invalid'},{minimumRentalDays:0},{minimumRentalDays:1.5},{bufferDays:-1},{serviceFeeRate:2},{businessHours:{start:'20:00',end:'09:00'}},{serviceFeeHours:[{start:'10:00',end:'12:00'}]},{unavailablePickupRanges:[{start:'2090-01-02T09:00',end:'2090-01-01T10:00'}]}]) {
    assert.equal((await request('/admin/settings/rental-rules/save',{rentalRules:invalid})).status,400,JSON.stringify(invalid))
    assert.deepEqual(stored(),good)
  }
  assert.equal((await request('/admin/settings/save',{companyDetails:{name:'Company'}})).status,200)
  assert.deepEqual(stored(),good,'general settings preserve all relocated rules')
})
