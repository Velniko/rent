/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { URL } from 'node:url'
import { readFileSync, readdirSync } from 'node:fs'
import worker from '../src/index'
import { createAuthSession, invalidateSystemSettingsCache } from '../src/site'
import { CLIENT_FEATURES, clientFeatureForPath, clientMaintenanceHtml, normalizeClientAccess, readClientAccess } from '../src/clientAccess'

test('client controls protect direct requests, aliases and writes while retaining essential functions', async t => {
  const sqlite = new DatabaseSync(':memory:'); t.after(()=>sqlite.close())
  for (const name of readdirSync(new URL('../migrations/',import.meta.url)).filter(name=>name.endsWith('.sql')).sort()) sqlite.exec(readFileSync(new URL(`../migrations/${name}`,import.meta.url),'utf8'))
  sqlite.exec(`INSERT INTO users (id,name,email,role,status,account_type,access_level) VALUES
    ('admin','管理员','admin@example.test','ADMIN','active','formal','ADMIN'),
    ('customer','客户','customer@example.test','CUSTOMER','active','formal','STAFF'),
    ('staff','员工','staff@example.test','STAFF','active','formal','STAFF')`)
  const db = {prepare(sql: string) {
    let values: any[] = []
    const statement = {bind(...args: any[]) {values=args;return statement},
      async first(){return sqlite.prepare(sql).get(...values) || null},
      async all(){return {results:sqlite.prepare(sql).all(...values)}},
      async run(){return {success:true,meta:{changes:Number(sqlite.prepare(sql).run(...values).changes)}}}}
    return statement
  },async batch(statements: any[]){const result=[];for(const statement of statements) result.push(await statement.run());return result}}
  const env = {RENT:db}; const c = {env,req:{url:'https://rent.example.test',header:()=>undefined}} as any
  invalidateSystemSettingsCache()
  const sessions = new Map<string,string>()
  for (const user of ['admin','customer','staff']) sessions.set(user,(await createAuthSession(c,user)).token)
  const request = (path: string, actor = 'customer', form?: Record<string,string>, origin = 'https://rent.example.test')=>worker.fetch(new Request(`https://rent.example.test${path}`,{
    method:form?'POST':'GET',body:form?new URLSearchParams(form):undefined,
    headers:{Cookie:`session=${sessions.get(actor)||''}`,Origin:origin,'CF-Connecting-IP':actor,'Sec-Fetch-Site':origin==='https://rent.example.test'?'same-origin':'cross-site'},
  }),env,{waitUntil(){}} as any)
  const allEnabled = Object.fromEntries(CLIENT_FEATURES.map(([key])=>[`feature_${key}`,'on']))
  const initial = await readClientAccess(db)
  assert.equal(initial.console.enabled,true)
  assert.equal((await request('/admin/settings/client-features','customer')).status,403)
  assert.equal((await request('/admin/settings/client-features','staff',allEnabled)).status,403)
  assert.equal((await request('/admin/settings/client-features','admin')).status,200)
  assert.equal((await request('/admin/settings/client-features','admin',allEnabled,'https://evil.test')).status,403)
  const form: Record<string,string> = {console_enabled:'on',web_enabled:'on',...allEnabled}
  delete form.feature_rentalProgram; delete form.feature_referralProgram; delete form.feature_walletTopUp
  const saved = await request('/admin/settings/client-features','admin',form)
  assert.equal(saved.status,303)
  for (const path of ['/customer/rental-program','/customer/c2c','/customer/referral','/customer/balance/top-up']) {
    const response = await request(path)
    assert.equal(response.status,503,path)
    assert.match(response.headers.get('cache-control')!,/no-store/)
  }
  for (const path of ['/customer/c2c/join','/customer/rental-program/join','/customer/referral/join','/customer/balance/top-up']) assert.equal((await request(path,'customer',{})).status,503,path)
  const dashboard = await request('/customer/dashboard')
  assert.equal(dashboard.status,200)
  const html = await dashboard.text()
  assert.doesNotMatch(html,/href="\/customer\/(?:rental-program|referral|balance\/top-up)"/)
  for (const path of ['/customer/profile','/customer/security','/customer/orders','/customer/rentals','/customer/balance']) assert.equal((await request(path)).status,200,path)
  const disabled = {web_enabled:'on',...allEnabled,console_message:'维护至周五 <script>alert(1)</script>'}
  assert.equal((await request('/admin/settings/client-features','admin',disabled)).status,303)
  assert.equal((await request('/customer/dashboard')).status,503)
  assert.equal((await request('/staff/dashboard','staff')).status,503)
  const message = await (await request('/customer/dashboard')).text()
  assert.match(message,/&lt;script&gt;alert\(1\)&lt;\/script&gt;/)
  assert.doesNotMatch(message,/<script>alert\(1\)/)
  for (const path of ['/customer/profile','/customer/security','/customer/orders','/customer/rentals']) assert.equal((await request(path)).status,200,path)
  assert.equal((await request('/admin/settings/client-features','admin')).status,200)
  assert.equal((await request('/admin/settings/client-features','admin',{...allEnabled,console_enabled:'on',web_enabled:'on'})).status,303)
  assert.equal((await request('/customer/dashboard')).status,200,'reopening is effective on the next request')
  assert.ok(sqlite.prepare("SELECT id FROM audit_logs WHERE target_id='clientAccess'").get())
  sqlite.prepare("UPDATE systemSettings SET value='{' WHERE key='clientAccess'").run()
  assert.equal((await request('/customer/dashboard')).status,503,'invalid settings fail closed')
  assert.equal((await request('/login','anonymous')).status,200,'admin sign-in remains available')
  assert.equal((await request('/customer/orders')).status,200,'essential functions survive invalid policy JSON')
  assert.equal((await request('/admin/settings/client-features','admin')).status,200,'administrator can repair invalid policy JSON')
  assert.equal((await request('/admin/settings/client-features','admin',{...allEnabled,console_enabled:'on',web_enabled:'on'})).status,303)
})

test('client control route mappings and maintenance scripts remain valid',()=>{
  for (const [path,key] of [['/products/a','newRentals'],['/api/rental-request','newRentals'],['/api/rental-setup-intent','newRentals'],['/gift-cards','giftCards'],['/referral','referralProgram'],['/api/public-notices','publicNotices'],['/register','registration']] as const) assert.equal(clientFeatureForPath(path,'web'),key,path)
  const html = clientMaintenanceHtml('Custom <&>')
  assert.match(html,/Custom &lt;&amp;&gt;/)
  for (const script of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) assert.doesNotThrow(()=>new Function(script[1]))
  assert.equal(normalizeClientAccess({features:{newRentals:false}}).features.newRentals,false)
  assert.equal(normalizeClientAccess({features:{newRentals:false}}).features.feedback,true)
})
