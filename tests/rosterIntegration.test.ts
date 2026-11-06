/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */
import test from 'node:test'
import assert from 'node:assert/strict'
import {getOrderVerificationCode,generateOrderVerificationCode} from '../src/services/orderVerificationCodes'
import {URL} from 'node:url'
import {DatabaseSync} from 'node:sqlite'
import {readFileSync,readdirSync} from 'node:fs'
import worker from '../src/index'
import {createAuthSession,invalidateSystemSettingsCache} from '../src/site'
import {loadRoster,mutateRoster,rosterPermission,rosterClientData,rosterClock} from '../src/services/roster'
import { testOrderScanCookie,extractInlineScripts} from './helpers'

async function setup(t:any) {
 t.mock.timers.enable({apis:['Date'],now:new Date('2026-11-06T00:00:00Z')})
 const sql=new DatabaseSync(':memory:');t.after(()=>sql.close());invalidateSystemSettingsCache()
 for(const name of readdirSync(new URL('../migrations/',import.meta.url)).filter(n=>n.endsWith('.sql')).sort())sql.exec(readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8'))
 sql.exec(`INSERT INTO users(id,name,email,role,status,staff_id) VALUES ('admin','管理员','admin@roster.test','ADMIN','active',NULL),('a','员工 A','a@roster.test','STAFF','active',NULL),('b','员工 B','b@roster.test','STAFF','active',NULL),('c','客户','c@roster.test','CUSTOMER','active','b');
 INSERT INTO devices(id,name,model,serialNumber,pricePerDay,depositAmount,status,lifecycle_status) VALUES ('d','电脑','T','ROSTER',20,100,'rented','RENTED');
 INSERT INTO orders(id,orderNo,userId,deviceId,startDate,endDate,pickupTimeSlot,returnTimeSlot,rentalPeriod,totalAmount,depositAmount,status) VALUES ('o','OD-20261106-ROSTER','c','d','2026-11-01','2026-11-06','10:00','12:00',5,200,100,'active');`)
 const db={prepare(text:string){let values:any[]=[];const statement={bind(...items:any[]){values=items;return statement},async first(){return sql.prepare(text).get(...values)||null},async all(){return {results:sql.prepare(text).all(...values)}},async run(){return {success:true,meta:{changes:Number(sql.prepare(text).run(...values).changes)}}}};return statement},async batch(statements:any[]){sql.exec('BEGIN');try{const rows=[];for(const statement of statements)rows.push(await statement.run());sql.exec('COMMIT');return rows}catch(error){sql.exec('ROLLBACK');throw error}}}
 const objects=new Map();const env={RENT:db,STORAGE_ENCRYPTION_KEY:'roster-test-storage-encryption-key-32-chars',STORAGE_BACKUP:{async put(key:string,bytes:any){objects.set(key,bytes)},async get(){return null}}}
 const ctx={waitUntil() {}} as any
 const c={env,req:{url:'https://rent.test/admin/roster',query(){return undefined},header(){return undefined}},get(){return null}} as any
 const actors:any={admin:{id:'admin',name:'管理员',role:'ADMIN'},a:{id:'a',name:'员工 A',role:'STAFF'},b:{id:'b',name:'员工 B',role:'STAFF'},c:{id:'c',name:'客户',role:'CUSTOMER'}}
 const sessions:any={};for(const id of Object.keys(actors))sessions[id]=(await createAuthSession(c,id)).token
 const request=async(path:string,id='admin',body?:any,json=false)=>worker.fetch(new Request('https://rent.test'+path,{method:body?'POST':'GET',body:body?(json?JSON.stringify(body):body instanceof FormData?body:new URLSearchParams(body)):undefined,headers:{Cookie:'session='+sessions[id]+await testOrderScanCookie(sql,id,path,body),Origin:'https://rent.test','Sec-Fetch-Site':'same-origin',...(json?{'Content-Type':'application/json','Accept':'application/json'}:{})}}),env,ctx)
 const state=JSON.parse(String(sql.prepare('SELECT state_json FROM staff_roster').get()!.state_json));state.published=[{id:'shift-a',employeeId:'a',day:'2026-11-06',start:'09:00',end:'17:00'}];sql.prepare('UPDATE staff_roster SET state_json=?').run(JSON.stringify(state))
 const rawRequest=(path:string,id='a',body?:any,pass='',json=true)=>worker.fetch(new Request('https://rent.test'+path,{method:body?'POST':'GET',body:body?(json?JSON.stringify(body):new URLSearchParams(body)):undefined,headers:{Cookie:'session='+sessions[id]+(pass?'; '+pass:''),Origin:'https://rent.test','Sec-Fetch-Site':'same-origin',...(body?{'Content-Type':json?'application/json':'application/x-www-form-urlencoded'}:{})}}),env,ctx)
 return {sql,db,c,actors,request,rawRequest,objects,env,sessions}
}
test('real worker roster pages render without demo state, script syntax is valid, staff receives only own schedules',async t=>{
 const {request,c,actors}=await setup(t)
 const response=await request('/admin/roster');assert.equal(response.status,200);const html=await response.text();assert.match(html,/rosterRoot/);assert.doesNotMatch(html,/rent-preview|演示时间|admin-roster\.html/)
 for(const body of extractInlineScripts(html))if(!body.trim().startsWith('{'))new Function(body)
 const data=await loadRoster(c,actors.a),safe=rosterClientData(data,actors.a);assert.equal(safe.tasks[0].employeeId,'a');assert.equal(safe.drafts&&Object.keys(safe.drafts).length,0)
 assert.equal((await request('/admin/roster','a')).status,403)
 assert.equal((await request('/staff/roster','a')).status,200)
})
test('non-rostered staff direct writes and all staff approvals are rejected and audited',async t=>{
 const {request,sql}=await setup(t)
 assert.equal((await request('/staff/orders/o/receive-return','b',{received:'1'})).status,403)
 assert.equal((await request('/staff/orders/o/approve','a',{})).status,403)
 assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE action='STAFF_OPERATION_BLOCKED'").get()!.n,2)
 assert.equal(sql.prepare("SELECT status FROM orders WHERE id='o'").get()!.status,'active')
})
test('scheduled assignee can receive another CRM owner’s device; receipt and inspection are separate',async t=>{
 const {request,sql}=await setup(t)
 const response=await request('/staff/orders/o/receive-return','a',{received:'1',notes:'已收回设备'});assert.equal(response.status,303)
 assert.equal(sql.prepare("SELECT status FROM orders WHERE id='o'").get()!.status,'pending_return')
 assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM device_inspections WHERE inspection_type='after_return'").get()!.n,0)
 const page=await request('/staff/orders/o/inspection?fragment=1','a');assert.equal(page.status,200);const html=await page.text();assert.match(html,/inspectionPhoto_a/);assert.doesNotMatch(html,/<!DOCTYPE|desktop-sidebar/i)
 assert.equal((await request('/staff/orders/o/inspection','a',{})).status,409)
 const records=await request('/staff/orders/o','a');assert.equal(records.status,200);assert.match(await records.text(),/登记归还/)
})
test('preference changes enforce an exact 30-day server cooldown; admin changes preserve that timestamp and stale writes fail',async t=>{
 const {c,actors,sql}=await setup(t)
 let data=await loadRoster(c,actors.a)
 data=await mutateRoster(c,actors.a,{operation:'preference',revision:data.revision,employeeId:'a',start:'10:00',end:'18:00'})
 const last=data.employees.find(e=>e.id==='a')!.lastSelfPreferenceChange
 await assert.rejects(()=>mutateRoster(c,actors.a,{operation:'preference',revision:data.revision,employeeId:'a',start:'11:00',end:'19:00'}),/下次修改/)
 data=await mutateRoster(c,actors.admin,{operation:'preference',revision:data.revision,employeeId:'a',start:'09:00',end:'17:00'})
 assert.equal(data.employees.find(e=>e.id==='a')!.lastSelfPreferenceChange,last)
 await assert.rejects(()=>mutateRoster(c,actors.admin,{operation:'preference',revision:0,employeeId:'a',start:'08:00',end:'16:00'}),/刷新/)
 assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE action LIKE '%修改%偏好'").get()!.n,2)
 t.mock.timers.tick(30*86400000);data=await loadRoster(c,actors.a)
 assert.equal((await mutateRoster(c,actors.a,{operation:'preference',revision:data.revision,employeeId:'a',start:'10:00',end:'18:00'})).employees.find(e=>e.id==='a')!.preferredStart,'10:00')
})
test('temporary operation requests require admin review, are task-scoped, expire, and revocation is immediate',async t=>{
 const {c,actors}=await setup(t)
 let data=await loadRoster(c,actors.b)
 data=await mutateRoster(c,actors.b,{operation:'request',revision:data.revision,taskId:'o:return',start:'11:00',end:'13:00',reason:'现场协助归还'})
 const id=data.requests[0].id
 assert.equal((await rosterPermission(c,actors.b,'o','return')).allowed,false)
 await assert.rejects(()=>mutateRoster(c,actors.b,{operation:'decision',revision:data.revision,requestId:id,decision:'APPROVED',start:'11:00',end:'13:00'}),/管理员/)
 data=await mutateRoster(c,actors.admin,{operation:'decision',revision:data.revision,requestId:id,decision:'APPROVED',start:'11:00',end:'13:00'})
 assert.equal((await rosterPermission(c,actors.b,'o','return')).allowed,true)
 assert.equal((await rosterPermission(c,actors.b,'o','pickup')).allowed,false)
 await mutateRoster(c,actors.admin,{operation:'revoke',revision:data.revision,requestId:id})
 assert.equal((await rosterPermission(c,actors.b,'o','return')).allowed,false)
})
test('auto drafts use real employees, publish atomically, and never schedule unbooked paid service windows',async t=>{
 const {c,actors,sql}=await setup(t)
 let data=await loadRoster(c,actors.admin)
 data=await mutateRoster(c,actors.admin,{operation:'auto',revision:data.revision,start:'2026-11-07',dailyHours:8,minStaff:1,maxDays:7,maxConsecutive:7,employees:data.employees.map(e=>({...e,dailyHours:8,enabled:true}))})
 assert.equal(data.published.length,1);assert.ok(data.drafts['2026-11-07'].shifts.length>0)
 assert.ok(data.drafts['2026-11-07'].shifts.every(s=>s.start>='09:00'&&s.end<='20:00'))
 const published=await mutateRoster(c,actors.admin,{operation:'publish',revision:data.revision,startDate:'2026-11-07'})
 assert.equal(Object.keys(published.drafts).length,0)
 assert.ok(sql.prepare("SELECT id FROM audit_logs WHERE action='发布排班'").get())
})
test('roster clock uses Melbourne date at UTC midnight and DST transitions',()=>{
 assert.equal(rosterClock(new Date('2026-11-05T14:30Z')).now,'2026-11-06T01:30')
 assert.equal(rosterClock(new Date('2026-10-03T16:30Z')).now,'2026-10-04T03:30')
})

test('active administrators can be scheduled manually, automatically and receive assigned tasks', async t => {
 const {c,actors,sql}=await setup(t)
 sql.exec("INSERT INTO users(id,name,email,role,status) VALUES ('inactive-admin','停用管理员','inactive@roster.test','ADMIN','inactive'),('deleted-admin','已删除管理员','deleted@roster.test','ADMIN','active'); UPDATE users SET deleted_at=CURRENT_TIMESTAMP WHERE id='deleted-admin'")
 let data=await loadRoster(c,actors.admin)
 assert.equal(data.employees.find(employee=>employee.id==='admin')?.role,'ADMIN')
 assert.ok(data.employees.find(employee=>employee.id==='admin')?.enabled)
 assert.ok(!data.employees.some(employee=>['c','inactive-admin','deleted-admin'].includes(employee.id)))
 data=await mutateRoster(c,actors.admin,{operation:'shift',revision:data.revision,employeeId:'admin',day:data.today,start:'09:00',end:'17:00',locked:true})
 assert.ok(data.drafts[data.today].shifts.some(shift=>shift.employeeId==='admin'))
 data=await mutateRoster(c,actors.admin,{operation:'auto',revision:data.revision,start:data.today,dailyHours:11,minStaff:1,maxDays:7,maxConsecutive:7,employees:data.employees.map(employee=>({...employee,enabled:employee.id==='admin'}))})
 assert.ok(data.drafts[data.today].shifts.length>0)
 assert.ok(data.drafts[data.today].shifts.every(shift=>shift.employeeId==='admin'))
 data=await mutateRoster(c,actors.admin,{operation:'publish',revision:data.revision})
 assert.equal(data.tasks.find(task=>task.orderId==='o')?.employeeId,'admin')
 assert.ok(data.published.some(shift=>shift.employeeId==='admin'))
 assert.ok((await rosterPermission(c,actors.admin,'o','return')).allowed)
})

test('mobile orders embeds scanning, rejects GET code lookup and does not accept raw order IDs', async t => {
 const {request,sql,rawRequest}=await setup(t)
 sql.exec("UPDATE orders SET id='scan-order' WHERE id='o'")
 const inbox=await request('/staff/mobile','a');assert.equal(inbox.status,200)
 assert.match(inbox.headers.get('Permissions-Policy')||'',/camera=\(self\)/)
 const html=await inbox.text();assert.match(html,/<h1>今日订单<\/h1>/);assert.match(html,/id="open-mobile-scanner"/);assert.match(html,/6 位取还校验码/)
 for(const script of extractInlineScripts(html))new Function(script)
 assert.equal((await request('/staff/mobile/scan','a')).headers.get('location'),'/staff/mobile#scan')
 for(const code of ['scan-order','OD-20261106-ROSTER','ROSTER','RENT-PICKUP:scan-order'])assert.equal((await rawRequest('/staff/mobile/scan?code='+encodeURIComponent(code))).status,403)
 assert.equal((await rawRequest('/staff/mobile/scan/verify','a',{source:'camera',code:'scan-order'})).status,400)
})

test('scan verification needs manual confirmation, is bound to actor and order, and is consumed once',async t=>{
 const {sql,rawRequest}=await setup(t);sql.exec("UPDATE orders SET id='scan-order' WHERE id='o'")
 assert.equal((await rawRequest('/staff/orders/scan-order/receive-return','a',{received:'1'},'',false)).status,403)
 const verified=await rawRequest('/staff/mobile/scan/verify','a',{source:'camera',code:'https://rent.test/pickup/scan-order'})
 assert.equal(verified.status,200,await verified.clone().text());const data=await verified.json() as any
 assert.equal(data.stage,'return');assert.equal(sql.prepare("SELECT status FROM orders WHERE id='scan-order'").get()!.status,'active')
 const pass=verified.headers.get('set-cookie')!.split(';')[0]
 assert.equal((await rawRequest('/staff/orders/scan-order/receive-return','a',{received:'1'},pass,false)).status,403)
 assert.equal((await rawRequest('/staff/mobile/scan/confirm','a',{orderId:'wrong-order',stage:'return'},pass)).status,403)
 assert.equal((await rawRequest('/staff/mobile/scan/confirm','b',{orderId:'scan-order',stage:'return'},pass)).status,403)
 const confirmed=await rawRequest('/staff/mobile/scan/confirm','a',{orderId:'scan-order',stage:'return'},pass)
 assert.equal(confirmed.status,200);assert.equal((await confirmed.json() as any).next,'/staff/orders/scan-order')
 assert.equal(sql.prepare("SELECT status FROM orders WHERE id='scan-order'").get()!.status,'pending_return')
 assert.equal((await rawRequest('/staff/orders/scan-order/receive-return','a',{received:'1'},pass,false)).status,403)
 assert.equal(sql.prepare("SELECT status FROM orders WHERE id='scan-order'").get()!.status,'pending_return')
 assert.equal((await rawRequest('/staff/orders/scan-order/receive-return','a',{received:'1'},pass,false)).status,403)
 for(const action of ['ORDER_QR_SCANNED','ORDER_QR_CONFIRMED','ORDER_SCAN_OPERATION_COMPLETED','ORDER_SCAN_OPERATION_BLOCKED'])assert.ok(sql.prepare("SELECT id FROM audit_logs WHERE target_type='ORDER' AND target_id='scan-order' AND action=?").get(action),action)
})

test('random verification codes display uppercase, accept lowercase and expire with the confirmation session',async t=>{
 const {sql,rawRequest,c}=await setup(t);sql.exec("UPDATE orders SET id='scan-order' WHERE id='o'; INSERT INTO order_verification_codes(order_id,verification_code) VALUES ('scan-order','A7K2P9')")
 assert.equal(await getOrderVerificationCode(c,'scan-order'),'A7K2P9')
 for(let i=0;i<30;i++)assert.match(generateOrderVerificationCode(),/^[A-Z0-9]{6}$/)
 const verified=await rawRequest('/staff/mobile/scan/verify','a',{source:'code',code:'a7k2p9'});assert.equal(verified.status,200)
 const pass=verified.headers.get('set-cookie')!.split(';')[0]
 assert.ok(sql.prepare("SELECT id FROM audit_logs WHERE target_type='ORDER' AND target_id='scan-order' AND action='ORDER_CODE_VERIFIED'").get())
 assert.ok(!String(sql.prepare("SELECT after_json FROM audit_logs WHERE action='ORDER_CODE_VERIFIED'").get()!.after_json).includes('A7K2P9'))
 t.mock.timers.setTime(new Date('2026-11-06T00:31:00Z').getTime())
 assert.equal((await rawRequest('/staff/mobile/scan/confirm','a',{orderId:'scan-order',stage:'return'},pass)).status,403)
 assert.equal((await rawRequest('/staff/mobile/scan/verify','a',{source:'code',code:'ROSTER'})).status,400)
 const admin=await rawRequest('/admin/orders/scan-order/update','admin',{status:'completed',force:'1',reason:'测试强制完成',deviceConfirmed:'1'},'',false)
 assert.equal(admin.status,403)
 assert.equal(sql.prepare("SELECT status FROM orders WHERE id='scan-order'").get()!.status,'active')
})

test('a complete return inspection stores five encrypted R2 photos and separate order activity',async t=>{
 const {request,sql,env,objects}=await setup(t)
 Object.assign(env,{CLOUDINARY_CLOUD_NAME:'demo',CLOUDINARY_API_KEY:'key',CLOUDINARY_API_SECRET:'secret'})
 const png=new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,0,0,0,0,0])
 t.mock.method(globalThis,'fetch',async(input:any)=>String(input).startsWith('https://api.cloudinary.com/')?Response.json({secure_url:'https://res.cloudinary.com/demo/image/upload/inspection.png'}):new Response(png,{headers:{'Content-Type':'image/png'}}))
 sql.exec("INSERT INTO contracts(id,orderId,contractNumber,content,status) VALUES ('ct','o','CT-ROSTER','合同','signed')")
 assert.equal((await request('/staff/orders/o/receive-return','a',{received:'1'})).status,303)
 const form=new FormData();form.set('damageFound','yes');for(const key of ['screenCondition','keyboardCondition','trackpadCondition','bodyCondition','cameraCondition','wifiCondition','powerTest'])form.set(key,'正常');form.set('replacementCost','0');form.set('damageDescription','轻微划痕');form.set('damagePhotoFiles',new File([png],'damage.png',{type:'image/png'}))
 for(const key of ['a','b','c','d','power'])form.set('inspectionPhoto_'+key,new File([png],key+'.png',{type:'image/png'}))
 const response=await request('/staff/orders/o/inspection','a',form);assert.equal(response.status,302,await response.text())
 assert.equal(sql.prepare("SELECT status FROM orders WHERE id='o'").get()!.status,'completed')
 assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM stored_objects WHERE category='inspections' AND encrypted=1 AND r2_ready=1").get()!.n,6)
 assert.equal(objects.size,6)
 const snapshot=JSON.parse(String(sql.prepare("SELECT snapshot_json FROM device_inspections WHERE rental_id='o' AND inspection_type='after_return'").get()!.snapshot_json));assert.deepEqual(Object.keys(snapshot.inspectionPhotos),['a','b','c','d','power'])
 assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE target_type='ORDER' AND target_id='o' AND action IN ('RETURN_RECEIVED','RETURN_INSPECTION_COMPLETED_WITH_DAMAGE')").get()!.n,2)
})

test('staff browser action state uses the server’s Melbourne clock rather than UTC',async()=>{
 const {runInNewContext}=await import('node:vm')
 const {rosterMinutes,rosterOpenWindows,rosterTaskMode}=await import('../src/domain/roster.mjs')
 const source=readFileSync(new URL('../src/client/roster.js.txt',import.meta.url),'utf8')
 const start=source.indexOf('function rosterCanOperate('),end=source.indexOf('function rosterPreferencePermission(',start)
 const args={employeeId:'a',task:{id:'t',employeeId:'a',day:'2026-11-06',start:'12:00',end:'12:30'},shifts:[{employeeId:'a',day:'2026-11-06',start:'09:00',end:'17:00'}],grants:[],business:{businessHours:{start:'09:00',end:'20:00'},serviceFeeHours:[],unavailablePickupHours:[],unavailablePickupRanges:[]}}
 class UTCDate extends Date{constructor(){super('2026-11-06T00:00:00Z')}}
 const result=runInNewContext(source.slice(start,end)+';rosterCanOperate(args)',{args,ROSTER_NOW:'2026-11-06T11:00',rosterMinutes,rosterOpenWindows,rosterTaskMode,Date:UTCDate})
 assert.equal(result.allowed,true)
})

test('a staff member can be re-enabled in a new draft and the roster still publishes',async t=>{
 const {c,actors,sql}=await setup(t)
 const state=JSON.parse(String(sql.prepare('SELECT state_json FROM staff_roster').get()!.state_json))
 state.employees=[{id:'a',name:'员工 A',enabled:false,dailyHours:8,preferredStart:'',preferredEnd:'',unavailableDates:[]}]
 sql.prepare('UPDATE staff_roster SET state_json=?').run(JSON.stringify(state))
 const current=await loadRoster(c,actors.admin)
 const draft=await mutateRoster(c,actors.admin,{operation:'auto',revision:current.revision,start:'2026-11-07',dailyHours:8,minStaff:1,maxDays:7,maxConsecutive:7,employees:current.employees.map(e=>({...e,enabled:true,dailyHours:8}))})
 const published=await mutateRoster(c,actors.admin,{operation:'publish',revision:draft.revision,startDate:'2026-11-07'})
 assert.equal(published.employees.find(e=>e.id==='a')!.enabled,true)
 assert.ok(published.published.some(s=>s.employeeId==='a'&&s.day>='2026-11-07'))
})
test('malformed roster commands return a client error without changing the revision',async t=>{
 const {request,sql}=await setup(t)
 const response=await request('/admin/roster/action','admin',[],true)
 assert.equal(response.status,400)
 assert.equal(sql.prepare('SELECT revision FROM staff_roster').get()!.revision,0)
})
test('staff task cards escape other staff names and order labels before assigning innerHTML',async()=>{
 const {runInNewContext}=await import('node:vm')
 const {escapeHtml}=await import('../src/lib/html')
 const source=readFileSync(new URL('../src/client/roster.js.txt',import.meta.url),'utf8')
 const start=source.indexOf('function rosterRenderMine('),end=source.indexOf('function rosterOpenAuto(',start)
 const employee={id:'a',name:'Employee A'},other={id:'b',name:'<img src=x onerror=alert(1)>'},task={id:'t',employeeId:'b',day:'2026-11-06',kind:'return',start:'12:00',end:'12:30',deviceName:'电脑',customer:'客户',orderNo:'<script>alert(1)</script>'}
 const root={innerHTML:''};runInNewContext(source.slice(start,end)+';rosterRenderMine()',{rosterRoot:root,rosterState:{currentEmployeeId:'a',published:[],requests:[],selectedStart:'2026-11-06'},ROSTER_TODAY:'2026-11-06',ROSTER_NOW:'2026-11-06T11:00',rosterEscape:escapeHtml,rosterEmployee:(id:string)=>id==='a'?employee:other,rosterAssignments:()=>[task],rosterDays:()=>['2026-11-06'],rosterDate:()=>'',rosterShort:()=>'',rosterWeekday:()=>'',rosterRangeLabel:()=>'',rosterPreferencePermission:()=>({allowed:true}),rosterIcon:()=>'',rosterCanOperate:()=>({allowed:true})})
 assert.doesNotMatch(root.innerHTML,/<img|<script/)
 assert.match(root.innerHTML,/&lt;img/)
 assert.match(root.innerHTML,/&lt;script/)
})

test('manual orders share admin updates, bulk operations and cancellation without inventing a payment', async t => {
 const {sql,rawRequest}=await setup(t)
 const created=await rawRequest('/admin/orders/new','admin',{deviceId:'d',startDate:'2026-11-10',endDate:'2026-11-12'},'',false)
 assert.equal(created.status,303,await created.clone().text())
 const path=created.headers.get('location')!,id=path.split('/').at(-1)!
 const row=()=>sql.prepare('SELECT * FROM orders WHERE id=?').get(id)!
 const page=await rawRequest(path,'admin');assert.equal(page.status,200);const html=await page.text()
 assert.match(html,/订单管理操作/);assert.match(html,/登记归还/);assert.doesNotMatch(html,/#scan/)
 const list=await rawRequest('/admin/orders','admin');assert.match(await list.text(),new RegExp(`action="${path}/update"`))
 assert.equal((await rawRequest(path+'/update','admin',{status:'suspended',reason:'暂停'},'',false)).status,302)
 assert.equal(row().status,'suspended');assert.equal(row().payment_status,'UNPAID');assert.equal(row().deposit_status,'PENDING')
 assert.equal((await rawRequest(path+'/update','admin',{status:'active'},'',false)).status,302)
 const bulk=await rawRequest('/admin/orders/bulk-update','admin',{orderIds:id,status:'suspended',reason:'批量暂停'},'',false)
 assert.equal(bulk.status,302);assert.equal(row().status,'suspended')
 const changed=await rawRequest(path+'/changes','admin',{changeType:'LOCATION_CHANGE',pickupLocation:'门店',returnLocation:'门店',reason:'修改地点'},'',false)
 assert.equal(changed.status,303,await changed.clone().text())
 assert.equal((await rawRequest(path+'/edit','admin')).status,200)
 assert.equal((await rawRequest(path+'/edit','admin',{deviceId:'d',status:'completed'},'',false)).status,409)
 const cancelled=await rawRequest('/admin/orders/bulk-update','admin',{orderIds:id,status:'cancelled',reason:'取消'},'',false)
 assert.equal(cancelled.status,302);assert.equal(row().status,'cancelled')
 assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM payments WHERE rental_id=?').get(id)!.n,0)
 assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM payment_refunds WHERE order_id=?').get(id)!.n,0)
})

test('manual return skips scans while retaining receipt, inspection and roster permissions', async t => {
 const {sql,rawRequest}=await setup(t)
 sql.exec("UPDATE orders SET is_manual=1 WHERE id='o'")
 assert.equal((await rawRequest('/staff/orders/o/receive-return','b',{received:'1'},'',false)).status,403)
 assert.equal((await rawRequest('/staff/orders/o/receive-return','c',{received:'1'},'',false)).status,403)
 assert.equal((await rawRequest('/staff/orders/o/inspection','a',{damageFound:'no'},'',false)).status,409)
 const page=await rawRequest('/staff/mobile/return','a');const html=await page.text()
 assert.match(html,/\/staff\/orders\/o\/receive-return\?fragment=1/)
 assert.equal((await rawRequest('/staff/orders/o/receive-return','a',{},'',false)).status,400)
 assert.equal((await rawRequest('/staff/orders/o/receive-return','a',{received:'1'},'',false)).status,303)
 assert.equal(sql.prepare("SELECT status FROM orders WHERE id='o'").get()!.status,'pending_return')
 const done=await rawRequest('/staff/orders/o/inspection','a',{damageFound:'no'},'',false)
 assert.equal(done.status,302,await done.clone().text())
 assert.equal(sql.prepare("SELECT status FROM orders WHERE id='o'").get()!.status,'completed')
 assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM device_inspections WHERE rental_id='o' AND inspection_type='after_return'").get()!.n,1)
 assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM order_scan_sessions').get()!.n,0)
 assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM contracts').get()!.n,0)
})

test('manual pickup opens handover directly and still requires inspection before delivery', async t => {
 const {sql,rawRequest}=await setup(t)
 sql.exec("UPDATE orders SET is_manual=1,status='paid',startDate='2026-11-06',endDate='2026-11-08' WHERE id='o'")
 assert.equal((await rawRequest('/staff/orders/o/handover','a')).status,200)
 assert.equal((await rawRequest('/staff/orders/o/handover','b')).status,403)
 const response=await rawRequest('/staff/orders/o/pickup','a',{deviceSerialNumber:'ROSTER',accessories:'电源',conditionNotes:'正常',customerConfirmed:'1',customerConfirmationName:'客户'},'',false)
 assert.equal(response.status,409);assert.match(await response.text(),/出租前验机/)
 assert.equal(sql.prepare("SELECT status FROM orders WHERE id='o'").get()!.status,'paid')
 assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM order_scan_sessions').get()!.n,0)
})
