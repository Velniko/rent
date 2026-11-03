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
import { getRevenueData } from '../src/pages/admin/revenueStats'
import { renderAdminFinance } from '../src/pages/admin/finance'
import { C2C_PHOTO_SLOTS, hasRequiredC2CPhotos, parseC2CPhotos } from '../src/domain/c2cPhotos'
import { c2cPhotoUploadScript, renderC2CPhotoFields, renderC2CPhotoGallery } from '../src/pages/partials/c2cPhotos'
import { maxRequestBodyBytes, UPLOAD_BODY_LIMIT_BYTES, DEFAULT_BODY_LIMIT_BYTES } from '../src/lib/security'
import { deliverC2CEmails } from '../src/services/c2cEmails'
import { commissionBps, c2cSettlementQuote } from '../src/services/c2c'

test('C2C publishing, booking ownership, rental accounting and manual settlements', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2030-01-01T00:00:00Z') })
  const sqlite=new DatabaseSync(':memory:'); t.after(()=>sqlite.close())
  for (const name of readdirSync(new URL('../migrations/',import.meta.url)).filter(n=>n.endsWith('.sql')).sort()) sqlite.exec(readFileSync(new URL(`../migrations/${name}`,import.meta.url),'utf8'))
  invalidateSystemSettingsCache()
  sqlite.exec(`INSERT INTO users (id,name,email,role,status,account_type,bsb,account_number) VALUES
    ('owner','设备主人','owner@example.test','CUSTOMER','active','formal','123-456','12345678'),
    ('renter','租客','renter@example.test','CUSTOMER','active','formal',NULL,NULL),
    ('other','其他客户','other@example.test','CUSTOMER','active','formal',NULL,NULL),
    ('staff','员工','staff@example.test','STAFF','active','formal',NULL,NULL),
    ('admin','管理员','admin@example.test','ADMIN','active','formal',NULL,NULL),
    ('guest','访客','guest@example.test','CUSTOMER','active','guest',NULL,NULL);`)
  sqlite.exec("UPDATE users SET access_level='ADMIN' WHERE id='admin'")
  const db={prepare(sql: string) {
    let values: any[]=[]
    const statement={bind(...args: any[]) {values=args;return statement},
      async first(){return sqlite.prepare(sql).get(...values)||null},
      async all(){return {results:sqlite.prepare(sql).all(...values)}},
      async run(){return {success:true,meta:{changes:Number(sqlite.prepare(sql).run(...values).changes)}}}}
    return statement
  },async batch(statements: any[]) {
    sqlite.exec('BEGIN')
    try {const result=[];for(const s of statements)result.push(await s.run());sqlite.exec('COMMIT');return result}
    catch(error){sqlite.exec('ROLLBACK');throw error}
  }}
  const env={RENT:db,CLOUDINARY_CLOUD_NAME:'demo',CLOUDINARY_API_KEY:'test-key',CLOUDINARY_API_SECRET:'test-secret'}; const c={env,req:{url:'https://rent.example.test/',header:()=>undefined}} as any
  const sessions=new Map<string,string>()
  for (const actor of ['owner','renter','other','staff','admin','guest']) sessions.set(actor,(await createAuthSession(c,actor)).token)
  const request=(path: string,actor='owner',form?: Record<string,string> | FormData,origin='https://rent.example.test')=>worker.fetch(new Request(`https://rent.example.test${path}`,{
    method:form?'POST':'GET',body:form instanceof FormData?form:form?new URLSearchParams(form):undefined,
    headers:{Cookie:`session=${sessions.get(actor)||''}`,Origin:origin,'CF-Connecting-IP':actor,'Sec-Fetch-Site':origin==='https://rent.example.test'?'same-origin':'cross-site'}
  }),env,{waitUntil(){}} as any)
  const row=(sql: string,...args: any[])=>sqlite.prepare(sql).get(...args) as any
  const settleForm=(reference: string)=>({reference,quote:c2cSettlementQuote(row("SELECT * FROM c2c_settlement_quotes WHERE order_id='rental'"))})
  const listing=()=>row('SELECT * FROM c2c_listings LIMIT 1')
  const form: Record<string,string>={name:'个人笔记本 <img src=x onerror=alert(1)>',model:'M4" autofocus onfocus="alert(1)',serialNumber:'C2C-TEST',dailyRate:'20.50',deposit:'200',description:'设备描述 <script>alert(1)</script>',mode:'self',pickupAddress:'123 Example Street, Carlton VIC 3053'}

  let uploaded=0, unsafeUpload=false
  const externalFetch=t.mock.method(globalThis,'fetch',async (input: any,init: RequestInit)=>{
    assert.equal(String(input),'https://api.cloudinary.com/v1_1/demo/image/upload')
    const body=init.body as FormData
    assert.equal(body.get('folder'),'rent/c2c')
    assert.ok(body.get('file') instanceof File)
    uploaded++
    return Response.json({secure_url:unsafeUpload?'https://127.0.0.1/image.png':`https://res.cloudinary.com/demo/image/upload/photo-${uploaded}.png`})
  })
  const photoBody=(slot='a',type='image/png',size=32)=>{
    const body=new FormData();body.set('slot',slot);body.set('file',new File([new Uint8Array(size)],'device.png',{type}));return body
  }
  await t.test('membership is explicit, idempotent and required for uploads and publishing',async()=>{
    const landing=await (await request('/customer/c2c')).text()
    assert.match(landing,/加入出租计划/);assert.doesNotMatch(landing,/id="c2c-listing-form"/)
    assert.equal(row('SELECT COUNT(*) AS n FROM c2c_memberships').n,0)
    assert.equal((await request('/customer/c2c','owner',form)).status,403)
    assert.equal((await request('/customer/c2c/photos','owner',photoBody())).status,403)
    assert.equal(uploaded,0)
    assert.equal((await request('/customer/c2c/join','staff',{})).status,403)
    assert.equal((await request('/customer/c2c/join','guest',{})).headers.get('location'),'/customer/guest')
    assert.equal((await request('/customer/c2c/join','owner',{},'https://evil.example.test')).status,403)
    assert.match((await request('/customer/c2c/join','owner',{})).headers.get('location') || '',/error=/)
    await request('/admin/c2c/commission','admin',{commission:'10',managedCommission:'',shippingAddress:''})
    assert.equal(row('SELECT managed_commission_bps FROM c2c_settings').managed_commission_bps,null)
    assert.match((await request('/customer/c2c/join','owner',{mode:'managed'})).headers.get('location') || '',/error=/)
    await request('/customer/c2c/join','owner',{mode:'self'});await request('/customer/c2c/join','owner',{mode:'self'})
    assert.equal(row('SELECT COUNT(*) AS n FROM c2c_memberships').n,1)
    const joined=await (await request('/customer/c2c')).text()
    assert.match(joined,/id="c2c-listing-form"/)
    assert.equal((joined.match(/accept="image\/jpeg,image\/png,image\/webp"/g)||[]).length,6)
  })
  await t.test('five required photo angles are enforced and uploaded assets are owner and slot bound',async()=>{
    assert.match((await request('/customer/c2c','owner',form)).headers.get('location') || '',/error=/)
    assert.equal(row('SELECT COUNT(*) AS n FROM c2c_listings').n,0)
    assert.equal((await request('/customer/c2c/photos','owner',photoBody('wrong'))).status,400)
    assert.equal((await request('/customer/c2c/photos','owner',photoBody('a','text/plain'))).status,400)
    assert.equal((await request('/customer/c2c/photos','owner',photoBody('a','image/png',5*1024*1024+1))).status,400)
    assert.equal((await request('/customer/c2c/photos','owner',photoBody('a','image/png',6*1024*1024+1))).status,413)
    assert.equal(uploaded,0)
    unsafeUpload=true
    assert.equal((await request('/customer/c2c/photos','owner',photoBody())).status,400)
    assert.equal(row('SELECT COUNT(*) AS n FROM c2c_photos').n,0)
    unsafeUpload=false
    for (const slot of C2C_PHOTO_SLOTS) {
      const response=await request('/customer/c2c/photos','owner',photoBody(slot.key))
      assert.equal(response.status,200)
      const photo=await response.json() as {id:string;url:string}
      assert.match(photo.id,/^c2cp-/);assert.match(photo.url,/^https:\/\/res.cloudinary.com/)
      form[`photo_${slot.key}`]=photo.id
    }
    assert.equal(row('SELECT COUNT(*) AS n FROM c2c_photos').n,6)
    await request('/customer/c2c/join','other',{mode:'self'})
    const foreign=await (await request('/customer/c2c/photos','other',photoBody())).json() as {id:string}
    for (const bad of [{...form,photo_power:''},{...form,photo_a:'https://example.test/forged.png'},{...form,photo_a:form.photo_b},{...form,photo_a:foreign.id}]) {
      assert.match((await request('/customer/c2c','owner',bad)).headers.get('location') || '',/error=/)
      assert.equal(row('SELECT COUNT(*) AS n FROM c2c_listings').n,0)
    }
  })
  await t.test('only formal customers can submit; admin actions and CSRF are guarded',async()=>{
    assert.equal((await request('/customer/c2c','staff')).status,403)
    assert.equal((await request('/admin/c2c','owner')).status,403)
    assert.equal((await request('/customer/c2c','guest',form)).headers.get('location'),'/customer/guest')
    assert.equal((await request('/admin/c2c/commission','owner',{commission:'0'})).status,403)
    assert.equal((await request('/customer/c2c','owner',form,'https://evil.example.test')).status,403)
    const invalid=await request('/customer/c2c','owner',{...form,dailyRate:'-1'})
    assert.match(invalid.headers.get('location')||'',/error=/)
    assert.equal(row('SELECT COUNT(*) AS n FROM c2c_listings').n,0)
    await request('/customer/c2c','owner',form)
    assert.equal(listing().status,'pending')
    assert.ok(hasRequiredC2CPhotos(listing().photos_json))
    assert.equal(Object.keys(parseC2CPhotos(listing().photos_json)).length,6)
    assert.doesNotMatch(listing().name,/<img/)
    assert.equal(row('SELECT id FROM devices WHERE id=?',listing().device_id),undefined)
    assert.doesNotMatch(await (await request('/customer/devices?mode=c2c','renter')).text(),/C2C-TEST/)
  })
  await t.test('review, isolation, resubmission and owner booking rejection',async()=>{
    assert.equal((await request('/customer/profile/delete-account','owner',{confirmDelete:'on'})).status,409)
    const id=listing().id
    const review=await (await request('/admin/c2c','admin')).text()
    assert.match(review,/alt="屏幕开机画面"/);assert.match(review,/photo-2.png/)
    await request(`/admin/c2c/${id}/review`,'admin',{action:'reject',note:'请补充信息'})
    assert.equal(listing().status,'rejected')
    await request(`/customer/c2c/${id}/edit`,'other',form)
    assert.equal(listing().status,'rejected')
    await request(`/customer/c2c/${id}/edit`,'owner',{...form,photo_power:''})
    assert.equal(listing().status,'rejected')
    await request(`/customer/c2c/${id}/edit`,'owner',form)
    await request(`/admin/c2c/${id}/review`,'admin',{action:'approve'})
    assert.equal(listing().status,'approved')
    assert.equal(row('SELECT status FROM devices WHERE id=?',listing().device_id).status,'available')
    assert.match(await (await request('/customer/devices?mode=c2c','renter')).text(),/个人笔记本/)
    const rentPage=await (await request(`/customer/rent/${listing().device_id}`,'renter')).text()
    const staffEdit=await (await request(`/staff/devices/${listing().device_id}/edit`,'admin')).text()
    for (const page of [rentPage,staffEdit]) {
      assert.match(page,/M4&amp;quot;|M4&quot;/)
      assert.doesNotMatch(page,/value="M4" autofocus/)
    }
    assert.doesNotMatch(await (await request('/customer/devices?mode=c2c','owner')).text(),/个人笔记本/)
    assert.match(await (await request(`/customer/rent/${listing().device_id}`,'owner')).text(),/不能租赁自己发布的设备/)
    assert.equal((await request(`/customer/rent/${listing().device_id}`,'owner',{})).status,403)
  })
  await t.test('approved personal devices use the existing customer application route',async()=>{
    const response=await request(`/customer/rent/${listing().device_id}`,'renter',{
      startDate:'2030-03-04',endDate:'2030-03-08',deliveryMethod:'Pickup',pickupTimeSlot:'morning',returnTimeSlot:'morning'
    })
    assert.equal(response.status,302)
    const application=row("SELECT * FROM orders WHERE deviceId=? AND userId='renter'",listing().device_id)
    assert.ok(application)
    assert.equal(application.status,'pending_approval')
    assert.equal(row('SELECT owner_id FROM c2c_order_terms WHERE order_id=?',application.id).owner_id,'owner')
    assert.equal(application.depositAmount,200)
    assert.ok(application.totalAmount>200)
    sqlite.prepare("UPDATE orders SET status='cancelled' WHERE id=?").run(application.id)
    const page=await (await request('/admin/c2c','admin')).text()
    assert.doesNotMatch(page,/name="action" value="approve" type="submit"/)
  })
  const insertOrder=(id: string,customer='renter')=>sqlite.prepare(`INSERT INTO orders
    (id,orderNo,userId,deviceId,startDate,endDate,rentalPeriod,totalAmount,depositAmount,deliveryFee,serviceFee,status,paymentMethod,deposit_status,settlement_status)
    VALUES (?,? ,?,?,'2030-01-07','2030-01-12',5,330,200,20,10,'pending_approval','bank_transfer','HELD','NOT_APPLICABLE')`).run(id,`OD-${id}`,customer,listing().device_id)
  await t.test('all order insertion paths snapshot commission and prevent self rental and owner swaps',async()=>{
    assert.throws(()=>insertOrder('self','owner'),/C2C_DEVICE_UNAVAILABLE/)
    insertOrder('rental')
    assert.equal(row("SELECT commission_bps FROM c2c_order_terms WHERE order_id='rental'").commission_bps,1000)
    await request('/admin/c2c/commission','admin',{commission:'12.34',managedCommission:'20',shippingAddress:'456 Warehouse Road, Melbourne VIC 3000'})
    assert.equal(row('SELECT commission_bps FROM c2c_settings').commission_bps,1234)
    assert.equal(row("SELECT commission_bps FROM c2c_order_terms WHERE order_id='rental'").commission_bps,1000)
    assert.throws(()=>sqlite.exec("UPDATE orders SET userId='owner' WHERE id='rental'"),/C2C_ORDER_OWNERSHIP_LOCKED/)
    assert.throws(()=>sqlite.exec("UPDATE orders SET deviceId='d-mbp14' WHERE id='rental'"),/C2C_ORDER_OWNERSHIP_LOCKED/)
    assert.throws(()=>sqlite.exec("UPDATE c2c_order_terms SET commission_bps=0"),/C2C_TERMS_IMMUTABLE/)
    await request(`/customer/c2c/${listing().id}/pause`,'owner',{})
    assert.equal(listing().status,'approved')
  })
  await t.test('settlement excludes deposits, service, delivery and processing fees; pending refunds and disputes block payout',async()=>{
    sqlite.exec(`INSERT INTO payments (id,rental_id,customer_id,payment_method,amount,deposit_amount,rental_amount,processing_fee,currency,status)
      VALUES ('payment','rental','renter','bank_transfer',338.25,200,130,8.25,'AUD','paid');`)
    const quote=()=>row("SELECT * FROM c2c_settlement_quotes WHERE order_id='rental'")
    assert.equal(quote().rental_cents,10000)
    assert.equal(quote().commission_cents,1000)
    assert.equal(quote().owner_cents,9000)
    await request('/admin/c2c/orders/rental/settle','admin',settleForm('TOO-EARLY'))
    assert.equal(row('SELECT COUNT(*) AS n FROM c2c_settlements').n,0)
    sqlite.exec("UPDATE orders SET status='completed',return_received_at=CURRENT_TIMESTAMP,deposit_status='REFUNDED',settlement_status='SETTLED' WHERE id='rental'")
    assert.equal(quote().eligible,1)
    sqlite.exec(`INSERT INTO payment_refunds (id,order_id,payment_id,type,refundable_amount,refund_amount,status,processed_by,refund_method)
      VALUES ('early','rental','payment','early_return',100,20,'pending','admin','bank_transfer')`)
    assert.equal(quote().eligible,0)
    sqlite.exec("UPDATE payment_refunds SET status='succeeded' WHERE id='early'")
    assert.equal(quote().rental_cents,8000)
    assert.equal(quote().owner_cents,7200)
    sqlite.exec(`INSERT INTO payment_disputes (id,stripe_dispute_id,payment_id,order_id,amount,status) VALUES ('dispute','dp_1','payment','rental',20,'DISPUTE_OPENED')`)
    assert.equal(quote().eligible,0)
    sqlite.exec("UPDATE payment_disputes SET status='DISPUTE_WON' WHERE id='dispute'")
    assert.equal(quote().eligible,1)
    sqlite.exec("UPDATE users SET account_number=NULL WHERE id='owner'")
    await request('/admin/c2c/orders/rental/settle','admin',settleForm('MISSING-BANK'))
    assert.equal(row('SELECT COUNT(*) AS n FROM c2c_settlements').n,0)
    sqlite.exec("UPDATE users SET account_number='12345678' WHERE id='owner'")
    const stale=settleForm('STALE')
    sqlite.exec("UPDATE users SET account_number='87654321' WHERE id='owner'")
    await request('/admin/c2c/orders/rental/settle','admin',stale)
    assert.equal(row('SELECT COUNT(*) AS n FROM c2c_settlements').n,0)
    sqlite.exec("UPDATE users SET account_number='12345678' WHERE id='owner'")
    const adminPage=await (await request('/admin/c2c','admin')).text()
    assert.match(adminPage,/登记结算/)
    const [first,second]=await Promise.all([request('/admin/c2c/orders/rental/settle','admin',settleForm('TRANSFER-1')),request('/admin/c2c/orders/rental/settle','admin',settleForm('TRANSFER-1'))])
    assert.equal(first.status,303);assert.equal(second.status,303)
    assert.equal(row('SELECT COUNT(*) AS n FROM c2c_settlements').n,1)
    const settled=row('SELECT * FROM c2c_settlements')
    assert.equal(settled.owner_cents,7200)
    assert.equal(settled.bsb,'123-456')
    const revenue=await getRevenueData(c)
    assert.equal(revenue.ownerSettlements[0].amount,72)
    const finance=renderAdminFinance({id:'admin',role:'ADMIN'},revenue.orders,revenue.refunds,revenue.withdrawals,revenue.ownerSettlements)
    assert.match(finance,/AUD\$38\.00/)
    assert.equal((await request('/customer/profile/delete-account','owner',{confirmDelete:'on'})).status,409)
    assert.throws(()=>sqlite.exec("UPDATE c2c_settlements SET owner_cents=0"),/C2C_SETTLEMENT_IMMUTABLE/)
    assert.throws(()=>sqlite.exec('DELETE FROM c2c_settlements'),/C2C_SETTLEMENT_IMMUTABLE/)
    assert.match(await (await request('/customer/c2c','owner')).text(),/TRANSFER-1/)
    assert.doesNotMatch(await (await request('/customer/c2c','other')).text(),/TRANSFER-1/)
    // Display uses the immutable settlement even if later reconciliation changes the order.
    sqlite.exec("UPDATE orders SET totalAmount=220 WHERE id='rental'")
    assert.match(await (await request('/customer/c2c','owner')).text(),/72\.00/)
  })
  await t.test('withdrawal hides equipment and blocks direct booking, and reapproval is required after edits',async()=>{
    await request(`/customer/c2c/${listing().id}/pause`,'other',{})
    assert.equal(listing().status,'approved')
    await request(`/customer/c2c/${listing().id}/pause`,'owner',{})
    assert.equal(listing().status,'paused')
    assert.throws(()=>insertOrder('paused'),/C2C_DEVICE_UNAVAILABLE/)
    await request(`/customer/c2c/${listing().id}/edit`,'owner',{...form,dailyRate:'30'})
    assert.equal(listing().status,'pending')
    assert.throws(()=>insertOrder('pending'),/C2C_DEVICE_UNAVAILABLE/)
    await request(`/admin/c2c/${listing().id}/review`,'admin',{action:'approve'})
    insertOrder('new-rate')
    assert.equal(row("SELECT commission_bps FROM c2c_order_terms WHERE order_id='new-rate'").commission_bps,1234)
    assert.equal(row('SELECT pricePerDay FROM devices WHERE id=?',listing().device_id).pricePerDay,30)
  })
  await t.test('two explicit modes, independent fees, custody receipt and atomic six-month restrictions',async()=>{
    assert.match((await request('/customer/c2c/join','owner',{mode:'managed'})).headers.get('location') || '',/error=/)
    assert.equal(row("SELECT mode FROM c2c_memberships WHERE user_id='owner'").mode,'self')
    assert.throws(()=>sqlite.exec("UPDATE c2c_memberships SET mode='managed' WHERE user_id='owner'"),/C2C_UNLIST_ALL_BEFORE_MODE_CHANGE/)
    assert.match((await request('/admin/c2c/commission','admin',{commission:'10',managedCommission:'10',shippingAddress:'Warehouse'})).headers.get('location') || '',/error=/)
    assert.equal(row('SELECT managed_commission_bps FROM c2c_settings').managed_commission_bps,2000)
    await request('/customer/c2c/join','other',{mode:'managed'})
    const managedForm: Record<string,string>={...form,name:'托管笔记本',serialNumber:'MANAGED-TEST',mode:'managed',pickupAddress:''}
    for (const slot of C2C_PHOTO_SLOTS) {
      const photo=await (await request('/customer/c2c/photos','other',photoBody(slot.key))).json() as {id:string}
      managedForm[`photo_${slot.key}`]=photo.id
    }
    await request('/customer/c2c','other',managedForm)
    const managed=()=>row("SELECT * FROM c2c_listings WHERE owner_id='other'")
    assert.equal(managed().status,'pending');assert.equal(managed().listing_mode,'managed')
    assert.equal(managed().pickup_address,'456 Warehouse Road, Melbourne VIC 3000')
    const ownerPage=await (await request('/customer/c2c','other')).text()
    assert.match(ownerPage,/托管寄件地址/);assert.match(ownerPage,/运费自付/);assert.doesNotMatch(ownerPage,/name="pickupAddress"/)
    await request(`/admin/c2c/${managed().id}/review`,'admin',{action:'approve'})
    assert.equal(managed().status,'pending')
    await request(`/admin/c2c/${managed().id}/review`,'admin',{action:'approve',received:'1'})
    assert.equal(managed().status,'approved');assert.ok(managed().custody_received_at);assert.ok(managed().listed_at)
    assert.match(await (await request('/customer/c2c','other')).text(),/可下架时间/)
    assert.throws(()=>sqlite.prepare("UPDATE c2c_listings SET status='paused' WHERE id=?").run(managed().id),/C2C_MANAGED_SIX_MONTHS_REQUIRED/)
    for (const actor of ['other','admin']) {
      await request(`/${actor==='admin'?'admin':'customer'}/c2c/${managed().id}/pause`,actor,{})
      assert.equal(managed().status,'approved')
    }
    sqlite.prepare(`INSERT INTO orders (id,orderNo,userId,deviceId,startDate,endDate,rentalPeriod,totalAmount,depositAmount,status,paymentMethod)
      VALUES ('managed-rental','OD-MANAGED','renter',?,'2030-03-04','2030-03-08',4,282,200,'pending_approval','bank_transfer')`).run(managed().device_id)
    const terms=row("SELECT * FROM c2c_order_terms WHERE order_id='managed-rental'")
    assert.equal(terms.commission_bps,2000);assert.equal(terms.listing_mode,'managed');assert.equal(terms.pickup_address,managed().pickup_address)
    assert.equal(row("SELECT pickupLocation FROM orders WHERE id='managed-rental'").pickupLocation,managed().pickup_address)
    sqlite.exec('UPDATE c2c_settings SET managed_commission_bps=NULL')
    assert.match(await (await request('/customer/c2c','other')).text(),/平台手续费 —/)
    assert.doesNotMatch(await (await request('/customer/devices?mode=c2c','renter')).text(),/托管笔记本/)
    assert.match(await (await request(`/customer/rent/${managed().device_id}`,'renter')).text(),/该设备暂不可租/)
    await request('/admin/c2c/commission','admin',{commission:'12.34',managedCommission:'22',shippingAddress:'New Warehouse, Melbourne VIC 3000'})
    assert.equal(row("SELECT commission_bps FROM c2c_order_terms WHERE order_id='managed-rental'").commission_bps,2000)
    assert.equal(row("SELECT pickup_address FROM c2c_order_terms WHERE order_id='managed-rental'").pickup_address,'456 Warehouse Road, Melbourne VIC 3000')
    sqlite.prepare("UPDATE c2c_listings SET listed_at=datetime('now','-6 months','-1 day') WHERE id=?").run(managed().id)
    await request(`/customer/c2c/${managed().id}/pause`,'other',{})
    assert.equal(managed().status,'approved') // An unfinished order still holds the listing.
    sqlite.exec("UPDATE orders SET status='cancelled' WHERE id='managed-rental'")
    await request(`/customer/c2c/${managed().id}/pause`,'other',{})
    assert.equal(managed().status,'paused')
    await request(`/customer/c2c/${managed().id}/edit`,'other',managedForm)
    assert.equal(managed().listed_at,null)
    await request(`/admin/c2c/${managed().id}/review`,'admin',{action:'approve',received:'1'})
    assert.throws(()=>sqlite.prepare("UPDATE c2c_listings SET status='paused' WHERE id=?").run(managed().id),/C2C_MANAGED_SIX_MONTHS_REQUIRED/)
    sqlite.prepare("UPDATE c2c_listings SET listed_at=datetime('now','-7 months') WHERE id=?").run(managed().id)
    await request(`/customer/c2c/${managed().id}/pause`,'other',{})
    await request('/customer/c2c/join','other',{mode:'self'})
    assert.equal(row("SELECT mode FROM c2c_memberships WHERE user_id='other'").mode,'self')
    assert.equal(row("SELECT listing_mode FROM c2c_order_terms WHERE order_id='managed-rental'").listing_mode,'managed')
    await request(`/customer/c2c/${managed().id}/edit`,'other',managedForm)
    assert.equal(managed().status,'paused') // Reject the stale mode form.
    const rentPage=await (await request(`/customer/rent/${listing().device_id}`,'renter')).text()
    assert.match(rentPage,/123 Example Street/);assert.match(rentPage,/到址自取/);assert.doesNotMatch(rentPage,/<option value="Delivery"/)
    assert.equal((await request(`/customer/rent/${listing().device_id}`,'renter',{deliveryMethod:'Delivery'})).status,400)
    assert.equal(row("SELECT status FROM email_events WHERE order_id='managed-rental'").status,'PENDING')
  })
  await t.test('new rental emails are atomic, deduplicated and retry transport failures',async()=>{
    // Isolate the new event; previous events are covered by the order tests.
    sqlite.exec("UPDATE email_events SET status='SENT'")
    insertOrder('email-retry')
    const mail=()=>row("SELECT * FROM email_events WHERE order_id='email-retry'")
    assert.equal(mail().recipient,'owner@example.test');assert.equal(mail().event_type,'C2C_NEW_RENTAL')
    assert.match(mail().text_body,/自行交付/);assert.match(mail().text_body,/OD-email-retry/)
    assert.equal(await deliverC2CEmails(c),0);assert.equal(mail().status,'PENDING')
    Object.assign(env,{RESEND_API_KEY:'fake-resend-key',EMAIL_FROM:'PC Rental <test@example.test>'})
    let attempts=0,expectedOrder='OD-email-retry'
    externalFetch.mock.mockImplementation(async(input:any,init?:RequestInit)=>{
      assert.equal(String(input),'https://api.resend.com/emails')
      const body=JSON.parse(String(init?.body));assert.deepEqual(body.to,['owner@example.test']);assert.ok(body.text.includes(expectedOrder))
      attempts++
      return attempts===1?Response.json({message:'Temporary failure'},{status:503}):Response.json({id:'mock-message-id'})
    })
    await deliverC2CEmails(c);assert.equal(mail().status,'FAILED');assert.equal(mail().retry_count,1)
    const delivered=await Promise.all([deliverC2CEmails(c),deliverC2CEmails(c)])
    assert.equal(delivered.reduce((a,b)=>a+b,0),1);assert.equal(mail().status,'SENT');assert.equal(attempts,2)
    await deliverC2CEmails(c);assert.equal(attempts,2)
    assert.equal(row("SELECT COUNT(*) AS n FROM email_events WHERE idempotency_key='c2c-rental:email-retry'").n,1)
    expectedOrder='OD-email-manual';insertOrder('email-manual')
    const manual=row("SELECT * FROM email_events WHERE order_id='email-manual'")
    assert.equal((await request(`/manager/email-events/${manual.id}/retry`,'owner',{})).status,403)
    const manualResults=await Promise.all([request(`/manager/email-events/${manual.id}/retry`,'admin',{}),request(`/manager/email-events/${manual.id}/retry`,'admin',{})])
    assert.ok(manualResults.every(result=>[303,409].includes(result.status)),JSON.stringify(manualResults.map(result=>result.status)))
    assert.equal(row("SELECT status FROM email_events WHERE order_id='email-manual'").status,'SENT');assert.equal(attempts,3)
    insertOrder('cancelled-email');sqlite.exec("UPDATE orders SET status='cancelled' WHERE id='cancelled-email'")
    await deliverC2CEmails(c)
    assert.equal(row("SELECT status FROM email_events WHERE order_id='cancelled-email'").status,'SKIPPED')
  })

})

test('C2C commission accepts zero and 100 percent and rejects malformed input',()=>{
  assert.equal(commissionBps('0'),0);assert.equal(commissionBps('100'),10000);assert.equal(commissionBps('12.34'),1234)
  for(const input of ['',null,'-1','100.01','NaN','Infinity','1.001','0x10'])assert.throws(()=>commissionBps(input))
})

test('photo rendering is safe and uploads use a bounded dedicated endpoint',()=>{
  assert.doesNotThrow(()=>new Function(c2cPhotoUploadScript.replace(/^<script>|<\/script>$/g,'')))
  assert.equal(maxRequestBodyBytes('/customer/c2c/photos','POST'),UPLOAD_BODY_LIMIT_BYTES)
  assert.equal(maxRequestBodyBytes('/customer/c2c','POST'),DEFAULT_BODY_LIMIT_BYTES)
  assert.equal(maxRequestBodyBytes('/customer/c2c/photos','GET'),DEFAULT_BODY_LIMIT_BYTES)
  assert.equal(hasRequiredC2CPhotos('{}'),false)
  assert.deepEqual(parseC2CPhotos('{"a":{"id":"c2cp-1234567890123456","url":"https://127.0.0.1/x"}}'),{})
  assert.equal(renderC2CPhotoGallery('{"a":{"id":"c2cp-1234567890123456","url":"javascript:alert(1)"}}'),'')
  const saved=JSON.stringify({a:{id:'c2cp-1234567890123456',url:'https://images.example.test/a.png'}})
  assert.match(renderC2CPhotoFields(saved),/name="photo_a" value="c2cp-1234567890123456"/)
  assert.match(renderC2CPhotoGallery(saved),/target="_blank" rel="noopener noreferrer"/)
})
