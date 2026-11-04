/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { URL } from 'node:url'
import { readFileSync,readdirSync } from 'node:fs'
import worker from '../src/index'
import { createAuthSession,invalidateSystemSettingsCache } from '../src/site'
import { requestRentalPayouts,notifyRentalPayouts,runRentalPayouts,savePayoutPreference,rentalPayouts,completeRentalPayout,refreshRentalPayout,nextPayoutDate,payoutClock } from '../src/services/rentalPayouts'
import { c2cSettlementQuote } from '../src/services/c2c'
import { addRentalPickupBlock,removeRentalPickupBlock,rentalPickupBlocks,rentalPickupBlocked } from '../src/services/rentalPickup'

async function setup(t:any){
  const sqlite=new DatabaseSync(':memory:');t.after(()=>sqlite.close())
  for(const file of readdirSync(new URL('../migrations/',import.meta.url)).filter(file=>file.endsWith('.sql')).sort())sqlite.exec(readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8'))
  sqlite.exec(`INSERT INTO users (id,name,email,role,status,account_type,bsb,account_number,access_level) VALUES
   ('owner','设备主人','owner@example.test','CUSTOMER','active','formal','123-456','12345678','CUSTOMER'),
   ('other','其他客户','other@example.test','CUSTOMER','active','formal',NULL,NULL,'CUSTOMER'),
   ('admin','管理员','admin@example.test','ADMIN','active','formal',NULL,NULL,'ADMIN'),
   ('admin2','另一管理员','admin2@example.test','ADMIN','active','formal',NULL,NULL,'ADMIN'),
   ('staff','员工','staff@example.test','STAFF','active','formal',NULL,NULL,'STAFF');
   INSERT INTO devices (id,name,model,serialNumber,pricePerDay,depositAmount,status,lifecycle_status) VALUES ('d-owned','测试个人设备','M4','RENTAL-PAYOUT-TEST',20,0,'available','READY');
   INSERT INTO c2c_memberships (user_id,mode) VALUES ('owner','self');`)
  const photos:Record<string,unknown>={}
  for(const [i,slot] of ['a','b','c','d','power'].entries()){
    const id='c2cp-'+String(i).padStart(16,'0'),url=`https://res.cloudinary.com/demo/image/upload/test-${slot}.jpg`
    photos[slot]={id,url};sqlite.prepare('INSERT INTO c2c_photos (id,owner_id,slot,url) VALUES (?,?,?,?)').run(id,'owner',slot,url)
  }
  sqlite.prepare("INSERT INTO c2c_listings (id,owner_id,device_id,name,model,serial_number,daily_rate,deposit,status,listing_mode,pickup_address,pickup_address_json,public_city,photos_json) VALUES ('listing','owner','d-owned','测试个人设备','M4','RENTAL-PAYOUT-TEST',20,0,'approved','self',?,?,?,?)").run('123 Secret Street\nCarlton VIC 3053',JSON.stringify({line1:'123 Secret Street',city:'Carlton',state:'VIC',postcode:'3053'}),'墨尔本',JSON.stringify(photos))
  let batchTail=Promise.resolve<any>(null)
  const db={prepare(sql:string){let values:any[]=[];const statement={bind(...args:any[]){values=args;return statement},async first(){return sqlite.prepare(sql).get(...values)||null},async all(){return {results:sqlite.prepare(sql).all(...values)}},async run(){return {success:true,meta:{changes:Number(sqlite.prepare(sql).run(...values).changes)}}}};return statement},batch(statements:any[]){const result=batchTail.then(async()=>{sqlite.exec('BEGIN');try{const results=[];for(const statement of statements)results.push(await statement.run());sqlite.exec('COMMIT');return results}catch(error){sqlite.exec('ROLLBACK');throw error}});batchTail=result.catch(()=>null);return result}}
  const env={RENT:db};const contexts=new Map<string,any>()
  const sessions=new Map<string,string>()
  for(const id of ['owner','other','admin','staff']){
    const context={env,get:()=>({id,role:id==='admin'?'ADMIN':id==='staff'?'STAFF':'CUSTOMER'}),req:{url:'https://rent.example.test/',header:()=>undefined,query:()=>undefined}} as any
    contexts.set(id,context);sessions.set(id,(await createAuthSession(context,id)).token)
  }
  invalidateSystemSettingsCache()
  const request=(path:string,actor='owner',form?:Record<string,string>,origin='https://rent.example.test')=>worker.fetch(new Request('https://rent.example.test'+path,{method:form?'POST':'GET',body:form?new URLSearchParams(form):undefined,headers:{Cookie:`session=${sessions.get(actor)||''}`,Origin:origin,'CF-Connecting-IP':actor,'Sec-Fetch-Site':origin==='https://rent.example.test'?'same-origin':'cross-site'}}),env,{waitUntil(){}} as any)
  const order=(id:string,amount=100)=>{
    sqlite.prepare("INSERT INTO orders (id,orderNo,userId,deviceId,startDate,endDate,rentalPeriod,totalAmount,depositAmount,status,deposit_status,settlement_status,return_received_at,deliveryMethod,pickupTimeSlot,returnTimeSlot) VALUES (?,?, 'other','d-owned','2030-01-10','2030-01-12',2,?,0,'completed','NOT_REQUIRED','SETTLED','2030-01-12 10:00:00','Pickup','09:00','10:00')").run(id,'OD-'+id,amount)
    sqlite.prepare("INSERT INTO payments (id,rental_id,customer_id,payment_method,amount,deposit_amount,rental_amount,status,currency) VALUES (?,?,'other','card',?,0,?,'paid','AUD')").run('pay-'+id,id,amount,amount)
  }
  const row=(sql:string,...args:any[])=>sqlite.prepare(sql).get(...args) as any
  return {sqlite,env,owner:contexts.get('owner'),admin:contexts.get('admin'),other:contexts.get('other'),request,order,row}
}

test('payout requests snapshot platform-held income and prevent duplicate manual transfers',async t=>{
  const f=await setup(t);f.order('first',100);f.order('second',80)
  const results=await Promise.allSettled([requestRentalPayouts(f.owner,'owner'),requestRentalPayouts(f.owner,'owner')])
  assert.equal(results.filter(result=>result.status==='fulfilled').length,1)
  assert.equal(f.row('SELECT COUNT(*) AS n FROM c2c_payout_requests').n,2)
  assert.equal(f.row('SELECT COUNT(*) AS n FROM c2c_settlements').n,0,'request generation does not transfer or record paid funds')
  assert.equal(f.row('SELECT SUM(owner_cents) AS total FROM c2c_payout_requests').total,16200)
  const adminCount=f.row("SELECT COUNT(*) AS n FROM users WHERE role='ADMIN' AND status='active' AND deleted_at IS NULL").n
  await Promise.all([notifyRentalPayouts(f.owner),notifyRentalPayouts(f.owner)])
  assert.equal(f.row("SELECT COUNT(*) AS n FROM notifications WHERE type='c2c_payout_pending'").n,adminCount*2,'one notification per admin per request')
  await notifyRentalPayouts(f.owner)
  assert.equal(f.row("SELECT COUNT(*) AS n FROM notifications WHERE type='c2c_payout_pending'").n,adminCount*2)
  assert.equal((await f.request('/admin/rental-settlements','owner')).status,403)
  assert.equal((await f.request('/admin/rental-settlements','staff')).status,403)
  const page=await (await f.request('/admin/rental-settlements','admin')).text()
  assert.match(page,/123-456/);assert.match(page,/12345678/);assert.match(page,/AUD\$90\.00/)
  assert.doesNotMatch(await (await f.request('/customer/rental-program/settlements','other')).text(),/12345678/)
  let payout=(await rentalPayouts(f.admin)).requests.find(item=>item.order_id==='first')!
  const original=c2cSettlementQuote(payout)
  f.sqlite.exec("UPDATE users SET account_number='87654321' WHERE id='owner'")
  await assert.rejects(()=>completeRentalPayout(f.admin,payout.id,'BANK-1',original))
  assert.equal(f.row('SELECT COUNT(*) AS n FROM c2c_settlements').n,0)
  await refreshRentalPayout(f.admin,payout.id)
  await assert.rejects(()=>completeRentalPayout(f.admin,payout.id,'BANK-1',original),/资料已更新/)
  payout=(await rentalPayouts(f.admin)).requests.find(item=>item.order_id==='first')!
  await completeRentalPayout(f.admin,payout.id,'BANK-1',c2cSettlementQuote(payout))
  assert.equal(f.row("SELECT status FROM c2c_payout_requests WHERE id=?",payout.id).status,'paid')
  assert.equal(f.row('SELECT COUNT(*) AS n FROM c2c_settlements').n,1)
  assert.equal(f.row("SELECT account_number FROM c2c_settlements WHERE order_id='first'").account_number,'87654321')
  await assert.rejects(()=>completeRentalPayout(f.admin,payout.id,'BANK-1',c2cSettlementQuote(payout)))
  assert.throws(()=>f.sqlite.prepare('UPDATE c2c_payout_requests SET owner_cents=1 WHERE id=?').run(payout.id),/C2C_PAYOUT_(?:IMMUTABLE|NOT_ELIGIBLE)|CHECK/)
  const other=(await rentalPayouts(f.admin)).requests.find(item=>item.order_id==='second')!
  assert.equal((await f.request(`/admin/rental-settlements/${other.id}/paid`,'other',{reference:'HACK',quote:c2cSettlementQuote(other)})).status,403)
  assert.equal((await f.request(`/admin/rental-settlements/${other.id}/paid`,'admin',{reference:'HACK',quote:c2cSettlementQuote(other)},'https://evil.test')).status,403)
  f.sqlite.prepare('INSERT INTO systemSettings (key,value) VALUES (?,?)').run('clientAccess',JSON.stringify({console:{enabled:false},features:{rentalProgram:false}}))
  assert.equal((await f.request('/customer/rental-program/settlements')).status,200,'existing owner income remains accessible during closure')
  assert.match(await (await f.request('/customer/balance')).text(),/href="\/customer\/rental-program\/settlements"/)
})

test('automatic payout schedules use Melbourne dates, enqueue only eligible income and remain idempotent',async t=>{
  t.mock.timers.enable({apis:['Date'],now:new Date('2030-01-01T00:00:00Z')})
  const f=await setup(t);f.order('scheduled')
  await savePayoutPreference(f.owner,'owner',{cadence:'every_other_day'})
  assert.equal(f.row('SELECT next_run_date FROM c2c_payout_preferences').next_run_date,'2030-01-03')
  t.mock.timers.setTime(new Date('2030-01-02T21:59:00Z').getTime())
  await runRentalPayouts(f.owner);assert.equal(f.row('SELECT COUNT(*) AS n FROM c2c_payout_requests').n,0)
  t.mock.timers.setTime(new Date('2030-01-02T22:00:00Z').getTime())
  await Promise.all([runRentalPayouts(f.owner),runRentalPayouts(f.owner)])
  assert.equal(f.row('SELECT COUNT(*) AS n FROM c2c_payout_requests').n,1)
  assert.equal(f.row('SELECT next_run_date FROM c2c_payout_preferences').next_run_date,'2030-01-05')
  assert.equal(f.row('SELECT COUNT(*) AS n FROM c2c_settlements').n,0)
  f.order('pending')
  f.sqlite.exec("UPDATE orders SET settlement_status='PENDING' WHERE id='pending'")
  t.mock.timers.setTime(new Date('2030-01-04T22:00:00Z').getTime())
  await runRentalPayouts(f.owner)
  assert.equal(f.row('SELECT COUNT(*) AS n FROM c2c_payout_requests').n,1)
  assert.equal(f.row('SELECT next_run_date FROM c2c_payout_preferences').next_run_date,'2030-01-07')
  await savePayoutPreference(f.owner,'owner',{cadence:'manual'})
  assert.equal(f.row('SELECT next_run_date FROM c2c_payout_preferences').next_run_date,null)
  await assert.rejects(()=>savePayoutPreference(f.owner,'owner',{cadence:'weekly',weekday:7}),/每周结算日/)
  f.sqlite.exec("UPDATE users SET bsb=NULL WHERE id='owner'")
  await assert.rejects(()=>savePayoutPreference(f.owner,'owner',{cadence:'weekly',weekday:1}),/收款账户/)
  assert.equal(payoutClock(new Date('2026-10-03T22:00:00Z')).hour,9)
  assert.equal(nextPayoutDate('every_other_day',null,new Date('2026-10-03T22:00:00Z')),'2026-10-06')
  assert.equal(nextPayoutDate('weekly',0,new Date('2026-10-03T21:59:00Z')),'2026-10-04')
  assert.equal(nextPayoutDate('weekly',0,new Date('2026-10-03T22:00:00Z')),'2026-10-11')
  f.sqlite.exec("UPDATE users SET bsb='123-456' WHERE id='owner'")
  f.order('weekly')
  await savePayoutPreference(f.owner,'owner',{cadence:'weekly',weekday:5})
  assert.equal(f.row('SELECT next_run_date FROM c2c_payout_preferences').next_run_date,'2030-01-11')
  t.mock.timers.setTime(new Date('2030-01-10T21:59:00Z').getTime())
  await runRentalPayouts(f.owner);assert.equal(f.row('SELECT COUNT(*) AS n FROM c2c_payout_requests').n,1)
  t.mock.timers.setTime(new Date('2030-01-10T22:00:00Z').getTime())
  await runRentalPayouts(f.owner);assert.equal(f.row('SELECT COUNT(*) AS n FROM c2c_payout_requests').n,2)
  assert.equal(f.row('SELECT next_run_date FROM c2c_payout_preferences').next_run_date,'2030-01-18')
})

test('preview exposes only city; owner pickup blocks protect appointment boundaries and ownership',async t=>{
  const f=await setup(t)
  const preview=await (await f.request('/customer/devices','other')).text()
  assert.match(preview,/墨尔本/);assert.doesNotMatch(preview,/123 Secret Street|Carlton VIC 3053/)
  const checkout=await (await f.request('/customer/rent/d-owned','other')).text()
  assert.match(checkout,/123 Secret Street/)
  for(const script of checkout.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g))assert.doesNotThrow(()=>new Function(script[1]))
  await assert.rejects(()=>addRentalPickupBlock(f.other,'other','listing',{blockedDate:'2030-01-10',allDay:'1'}),/无权修改/)
  await assert.rejects(()=>addRentalPickupBlock(f.owner,'owner','listing',{blockedDate:'2030-02-30',allDay:'1'}),/有效/)
  await addRentalPickupBlock(f.owner,'owner','listing',{blockedDate:'2030-01-11',allDay:'1'})
  await addRentalPickupBlock(f.owner,'owner','listing',{blockedDate:'2030-01-10',startTime:'09:00',endTime:'10:00'})
  const blockedRequest=await f.request('/customer/rent/d-owned','other',{startDate:'2030-01-10',endDate:'2030-01-12',pickupTimeSlot:'09:30',returnTimeSlot:'10:00',deliveryMethod:'Pickup'})
  assert.equal(blockedRequest.status,400)
  assert.match(await blockedRequest.text(),/无法交付/)
  const blocks=await rentalPickupBlocks(f.owner,'d-owned')
  assert.equal(rentalPickupBlocked(blocks,'2030-01-10','09:30'),true)
  assert.equal(rentalPickupBlocked(blocks,'2030-01-10','10:00'),false)
  const insert=(id:string,start:string,end:string,time:string)=>f.sqlite.prepare("INSERT INTO orders (id,userId,deviceId,startDate,endDate,rentalPeriod,totalAmount,depositAmount,status,deliveryMethod,pickupTimeSlot,returnTimeSlot) VALUES (?,'other','d-owned',?,?,2,100,0,'pending_approval','Pickup',?,'10:00')").run(id,start,end,time)
  assert.throws(()=>insert('blocked','2030-01-10','2030-01-12','09:30'),/C2C_PICKUP_UNAVAILABLE/)
  insert('valid','2030-01-10','2030-01-12','10:00')
  assert.ok(f.row("SELECT id FROM orders WHERE id='valid'"),'a blocked date during the rental does not prevent pickup and return outside the block')
  await assert.rejects(()=>addRentalPickupBlock(f.owner,'owner','listing',{blockedDate:'2030-01-12',allDay:'1'}),/已有取还预约/)
  assert.throws(()=>f.sqlite.exec("UPDATE orders SET pickupTimeSlot='09:30' WHERE id='valid'"),/C2C_PICKUP_UNAVAILABLE/)
  await assert.rejects(()=>removeRentalPickupBlock(f.other,'other','listing',blocks[0].id),/无权修改/)
  await removeRentalPickupBlock(f.owner,'owner','listing',blocks[0].id)
  assert.equal((await rentalPickupBlocks(f.owner,'d-owned')).length,1)
  const accepted=await f.request('/customer/rent/d-owned','other',{startDate:'2030-01-20',endDate:'2030-01-22',pickupTimeSlot:'07:30',returnTimeSlot:'14:00',deliveryMethod:'Pickup'})
  assert.equal(accepted.status,302)
  const order=f.row("SELECT pickupTimeSlot,returnTimeSlot,startPeriod,endPeriod,serviceFee FROM orders WHERE pickupTimeSlot='07:30'")
  assert.ok(order,'a valid exact pickup time creates the application')
  assert.equal(order.endPeriod,'PM')
  assert.equal(order.startPeriod,'AM')
  assert.equal(order.serviceFee,6)
})
