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
import { createAuthSession } from '../src/site'
import { readIdentityDocument, purgeExpiredIdentityMaterials } from '../src/services/identityVerification'
import { storeObject, readStoredObject, repairStorageReplicas, fileCategory } from '../src/services/objectStorage'
import { signOciRequest, encryptObject, decryptObject, sha256 } from '../src/lib/ociStorage'
import { archiveHistoricalData, migrateLegacyImages } from '../src/services/storageMaintenance'
import { identityRecognitionInput } from '../src/services/identityRecognition'
import { identityRecognitionError, parseIdentityRecognition, IDENTITY_DOCUMENT_OPTIONS } from '../src/domain/identityDocument'
import { extractInlineScripts } from './helpers'

// A real 1x1 PNG, not a file extension masquerading as an image.
const png = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jVh0AAAAASUVORK5CYII=','base64'))
async function fixture(t: any) {
  const sqlite = new DatabaseSync(':memory:'); t.after(()=>sqlite.close())
  for (const name of readdirSync(new URL('../migrations/',import.meta.url)).filter(n=>n.endsWith('.sql')).sort()) sqlite.exec(readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8'))
  sqlite.exec("INSERT INTO users(id,name,email,role) VALUES ('admin','管理员','admin@test.invalid','ADMIN'),('customer','客户','customer@test.invalid','CUSTOMER'),('other','其他客户','other@test.invalid','CUSTOMER'),('staff','员工','staff@test.invalid','STAFF')")
  const db = { prepare(sql:string) {
    let values:any[]=[]
    const statement = { bind(...args:any[]) { values=args;return statement }, async first() {return sqlite.prepare(sql).get(...values)||null}, async all(){return {results:sqlite.prepare(sql).all(...values)}}, async run(){return {success:true,meta:{changes:Number(sqlite.prepare(sql).run(...values).changes)}}} }
    return statement
  }, async batch(statements:any[]) {
    sqlite.exec('BEGIN')
    try { const values=[]; for(const s of statements) values.push(await s.run());sqlite.exec('COMMIT');return values }
    catch(error){sqlite.exec('ROLLBACK');throw error}
  } }
  const blobs=new Map<string,ArrayBuffer>(); let reads=0
  const r2={async put(key:string,body:ArrayBuffer){blobs.set(key,body.slice(0));return {}},async get(key:string){reads++;const data=blobs.get(key);return data?{body:new Response(data).body}:null},async delete(key:string){blobs.delete(key)}}
  let pdfCalls=0,pdfResult:unknown={format:'markdown',data:'Visa Grant Notice. Official visa grant details and conditions. This is a test fixture, not a real document.'}
  let aiCalls=0, recognition:unknown={detected_type:'VISA',side:'VISA_PAGE',readable:true,single_document:true,confidence:0.99}
  const env:any={AI:{async toMarkdown(file:any,options:any){pdfCalls++;assert.equal(file.name,'identity.pdf');assert.equal(file.blob.type,'application/pdf');assert.equal(options.conversionOptions.pdf.metadata,false);return pdfResult},async run(){aiCalls++;return {choices:[{message:{content:typeof recognition === 'string'?recognition:JSON.stringify(recognition)}}]}}},RENT:db,STORAGE_BACKUP:r2,STORAGE_ENCRYPTION_KEY:'test-storage-encryption-key-32-bytes-long',STORAGE_PUBLIC_ORIGIN:'https://rent.example.test'}
  const context:any={env,get:()=>({id:'admin',role:'ADMIN'}),req:{url:env.STORAGE_PUBLIC_ORIGIN,method:'POST',header:()=>undefined}}
  const tokens:Record<string,string>={}
  for(const actor of ['admin','customer','staff','other']) tokens[actor]=(await createAuthSession(context,actor)).token
  const request=(path:string,actor='customer',body?:FormData|URLSearchParams,origin=env.STORAGE_PUBLIC_ORIGIN)=>worker.fetch(new Request(env.STORAGE_PUBLIC_ORIGIN+path,{method:body?'POST':'GET',...(body?{body}:{}),headers:{Cookie:`session=${tokens[actor]}`,Origin:origin,'Sec-Fetch-Site':origin===env.STORAGE_PUBLIC_ORIGIN?'same-origin':'cross-site'}}),env,{waitUntil(){}} as any)
  const submit=()=>{const form=new FormData();form.set('documentType','VISA');form.set('documentFile',new File([png],'visa.png',{type:'image/png'}));return request('/customer/identity/visa','customer',form)}
  return {sqlite,env,context,blobs,request,submit,reads:()=>reads,aiCalls:()=>aiCalls,setRecognition:(value:unknown)=>{recognition=value},pdfCalls:()=>pdfCalls,setPdfResult:(value:unknown)=>{pdfResult=value}}
}
test('identity documents are encrypted, admin-only, audited and immutable after certification',async t=>{
  const f=await fixture(t)
  assert.equal((await f.submit()).status,303)
  const doc=f.sqlite.prepare('SELECT * FROM identity_documents').get() as any
  const object=f.sqlite.prepare('SELECT * FROM stored_objects').get() as any
  assert.equal(object.oci_ready,0); assert.equal(object.r2_ready,1)
  assert.equal(Buffer.from(f.blobs.get(object.object_key)!).includes(Buffer.from(png)),false)
  for(const actor of ['customer','other','staff']) assert.equal((await f.request(`/admin/identity-documents/${doc.id}/view`,actor,new URLSearchParams({purpose:'审核'}))).status,403)
  assert.equal((await f.request(`/media/${object.id}`,'admin')).status,404)
  assert.equal((await f.request(`/admin/users/customer/identity-status`,'admin',new URLSearchParams({documentId:doc.id,status:'VERIFIED'}))).status,400)
  assert.equal((await f.request(`/admin/identity-documents/${doc.id}/view`,'admin',new URLSearchParams({purpose:'审核'}),'https://evil.test')).status,403)
  const opened=await f.request(`/admin/identity-documents/${doc.id}/view`,'admin',new URLSearchParams({purpose:'等级押金审核'}))
  assert.equal(opened.status,200);assert.match(opened.headers.get('Cache-Control')!,/no-store/)
  assert.deepEqual(new Uint8Array(await opened.arrayBuffer()),png)
  assert.equal((await f.request('/admin/users/customer/identity-status','admin',new URLSearchParams({documentId:doc.id,status:'VERIFIED'}))).status,303)
  assert.ok(f.sqlite.prepare('SELECT certified_at FROM identity_documents').get()!.certified_at)
  assert.equal((await f.submit()).status,400);assert.equal(f.blobs.size,1)
  const identity=await(await f.request('/customer/identity')).text(), profile=await(await f.request('/customer/profile')).text()
  assert.match(identity,/认证成功后不可更改/);assert.doesNotMatch(identity,/name="documentFile"/)
  assert.match(profile,/href="\/customer\/identity"/)
  for(const html of [identity,profile]) for(const script of extractInlineScripts(html)) assert.doesNotThrow(()=>new Function(script))
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM sensitive_data_access_logs WHERE field_name LIKE 'identity_document:%'").get()!.n,1)
  assert.throws(()=>f.sqlite.exec("UPDATE identity_documents SET object_id='other'"),/IMMUTABLE/)
  assert.throws(()=>f.sqlite.exec("INSERT INTO identity_documents(id,customer_id,object_id,document_type) VALUES ('b','customer','b','VISA')"),/ALREADY_CERTIFIED/)
  assert.throws(()=>f.sqlite.exec('DELETE FROM sensitive_data_access_logs'),/IMMUTABLE/)
  assert.throws(()=>f.sqlite.exec("DELETE FROM audit_logs WHERE action='IDENTITY_DOCUMENT_VIEW'"),/IMMUTABLE/)
})
test('an audit write failure prevents fetching and decrypting identity bytes',async t=>{
  const f=await fixture(t);await f.submit()
  const doc=f.sqlite.prepare('SELECT id FROM identity_documents').get() as any
  f.sqlite.exec("CREATE TRIGGER reject_access BEFORE INSERT ON sensitive_data_access_logs BEGIN SELECT RAISE(ABORT,'AUDIT_UNAVAILABLE'); END")
  const before=f.reads()
  await assert.rejects(()=>readIdentityDocument(f.context,{id:'admin',role:'ADMIN'},doc.id,'审核'),/AUDIT_UNAVAILABLE/)
  assert.equal(f.reads(),before)
})
test('expired identity materials are removed from storage while approval facts remain locked',async t=>{
  const f=await fixture(t);await f.submit()
  f.sqlite.exec("UPDATE identity_documents SET status='VERIFIED',certified_at='2020-01-01',reviewed_at='2020-01-01'")
  assert.equal(await purgeExpiredIdentityMaterials(f.context),1)
  assert.equal(f.blobs.size,0)
  assert.ok(f.sqlite.prepare('SELECT deleted_at FROM stored_objects').get()!.deleted_at)
  assert.equal(f.sqlite.prepare('SELECT status FROM identity_documents').get()!.status,'VERIFIED')
  assert.equal((await f.submit()).status,400)
})
test('standard files default to R2 and archive files fall back to encrypted R2 copies',async t=>{
  const f=await fixture(t);let network=0
  const remote=new Map<string,ArrayBuffer>()
  t.mock.method(globalThis,'fetch',async(request:Request)=>{network++;if(request.method==='PUT'){remote.set(request.url,await request.arrayBuffer());return new Response(null,{status:200})}return new Response(null,{status:403})})
  const row=await storeObject(f.context,{bytes:png.buffer,category:'website-images',contentType:'image/png',visibility:'PUBLIC'})
  assert.equal(network,0)
  assert.deepEqual(new Uint8Array(await readStoredObject(f.context,row)),png)
  Object.assign(f.env,{OCI_NAMESPACE:'namespace',OCI_REGION:'ap-melbourne-1',OCI_ARCHIVE_BUCKET:'archive',OCI_ACCESS_KEY_ID:'test-access',OCI_SECRET_ACCESS_KEY:'test-secret'})
  const archived=await storeObject(f.context,{bytes:png.buffer,category:'contracts',contentType:'application/json',visibility:'ADMIN',tier:'ARCHIVE'})
  assert.equal(archived.oci_ready,1);assert.equal(remote.size,1)
  assert.deepEqual(new Uint8Array(await readStoredObject(f.context,archived)),png)
  const archiveUrl=[...remote.keys()][0];assert.match(archiveUrl,/\/archive\/archive\/contracts\//)
  assert.equal(await repairStorageReplicas(f.context),0)
  assert.equal(fileCategory('rent/rmb-payment-qr/alipay'),'branding')
})
test('object encryption binds ciphertext to its object ID and signing encodes paths',async()=>{
  const env={OCI_NAMESPACE:'namespace',OCI_REGION:'ap-melbourne-1',OCI_ARCHIVE_BUCKET:'archive',OCI_ACCESS_KEY_ID:'access',OCI_SECRET_ACCESS_KEY:'secret',STORAGE_ENCRYPTION_KEY:'a-file-encryption-secret-with-32-characters'}
  const encrypted=await encryptObject(env,'one',png.buffer)
  assert.deepEqual(new Uint8Array(await decryptObject(env,'one',encrypted)),png)
  await assert.rejects(()=>decryptObject(env,'two',encrypted))
  const request=await signOciRequest(env,'archive','category/a b+中','PUT',png.buffer,'',new Date('2026-11-05T00:00:00Z'))
  assert.match(request.url,/a%20b%2B%E4%B8%AD/)
  assert.match(request.headers.get('Authorization')!,/Credential=access\/20261105\/ap-melbourne-1\/s3\/aws4_request/)
  assert.equal(request.headers.get('x-amz-content-sha256'),await sha256(png.buffer))
})

test('historical media migration preserves the legacy URL and archives retain D1 source records',async t=>{
  const f=await fixture(t)
  Object.assign(f.env,{OCI_NAMESPACE:'namespace',OCI_REGION:'ap-melbourne-1',OCI_ARCHIVE_BUCKET:'archive',OCI_ACCESS_KEY_ID:'test-access',OCI_SECRET_ACCESS_KEY:'test-secret'})
  const remote: string[]=[]
  t.mock.method(globalThis,'fetch',async(input:Request|string)=>{
    if(typeof input==='string'){assert.equal(input,'https://res.cloudinary.com/demo/image/upload/logo.png');return new Response(png,{headers:{'Content-Type':'image/png'}})}
    remote.push(input.url);return new Response(null,{status:200})
  })
  f.sqlite.exec(`DELETE FROM systemSettings;
    INSERT INTO systemSettings(key,value) VALUES ('companyDetails','{"logo":"https://res.cloudinary.com/demo/image/upload/logo.png"}');
    INSERT INTO devices(id,name,model,pricePerDay,depositAmount,serialNumber,status) VALUES ('device','电脑','Test',10,100,'STORAGE-DEVICE','available');
    INSERT INTO orders(id,userId,deviceId,startDate,endDate,rentalPeriod,totalAmount,depositAmount,status,paymentMethod) VALUES ('closed','customer','device','2020-01-01','2020-01-08',7,170,100,'completed','card');
    INSERT INTO contracts(id,orderId,contractNumber,content,status) VALUES ('contract','closed','CON-STORAGE','合同原文','signed');`)
  assert.equal(await migrateLegacyImages(f.context),1)
  const image=f.sqlite.prepare("SELECT * FROM stored_objects WHERE category='branding'").get() as any
  assert.equal(image.source_url,'https://res.cloudinary.com/demo/image/upload/logo.png')
  assert.match(String(f.sqlite.prepare("SELECT value FROM systemSettings WHERE key='companyDetails'").get()!.value),new RegExp('/media/'+image.id))
  assert.equal(await archiveHistoricalData(f.context),2)
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM orders').get()!.n,1)
  assert.equal(f.sqlite.prepare("SELECT content FROM contracts WHERE id='contract'").get()!.content,'合同原文')
  assert.equal(await archiveHistoricalData(f.context),0)
  assert.equal(remote.length,2)
})

test('a private proof image is available to the linked customer and staff, not other customers',async t=>{
  const f=await fixture(t)
  const object=await storeObject(f.context,{bytes:png.buffer,category:'payment-proofs',contentType:'image/png',visibility:'OWNER',ownerId:'staff'})
  f.sqlite.prepare("INSERT INTO balance_topups(id,user_id,amount,payment_method,status,proof_image_url) VALUES ('proof','customer',10,'bank_transfer','submitted',?)").run('https://rent.example.test/media/'+object.id)
  assert.equal((await f.request('/media/'+object.id,'customer')).status,200)
  assert.equal((await f.request('/media/'+object.id,'staff')).status,200)
  assert.equal((await f.request('/media/'+object.id,'other')).status,403)
})


test('each document type has a distinct upload page and rejects forged type fields',async t=>{
  const f=await fixture(t)
  const hub=await(await f.request('/customer/identity')).text()
  assert.doesNotMatch(hub,/name="documentFile"/)
  for(const option of IDENTITY_DOCUMENT_OPTIONS){
    assert.match(hub,new RegExp('href="/customer/identity/'+option.slug+'"'))
    const page=await(await f.request('/customer/identity/'+option.slug)).text()
    assert.ok(page.includes(option.title));assert.ok(page.includes('name="documentType" value="'+option.kind+'"'))
    for(const script of extractInlineScripts(page))assert.doesNotThrow(()=>new Function(script))
    const form=new FormData();form.set('documentType',option.kind==='VISA'?'PASSPORT':'VISA');form.set('documentFile',new File([png],'passport.png',{type:'image/png'}))
    assert.equal((await f.request('/customer/identity/'+option.slug,'customer',form)).status,400)
  }
  assert.equal(f.aiCalls(),0);assert.equal(f.blobs.size,0)
  assert.equal((await f.request('/customer/identity','customer',new URLSearchParams({documentType:'VISA'}))).status,400)
  assert.equal((await f.request('/customer/identity/unknown')).status,404)
})
test('unrelated, mismatched, unreadable and malformed model outputs cannot create a document',async t=>{
  const f=await fixture(t)
  for(const value of [
    {detected_type:'NON_DOCUMENT',side:'OTHER',readable:true,single_document:true,confidence:0.99},
    {detected_type:'PASSPORT',side:'BIO_PAGE',readable:true,single_document:true,confidence:0.99},
    {detected_type:'VISA',side:'VISA_PAGE',readable:false,single_document:true,confidence:0.99},
    {detected_type:'VISA',side:'VISA_PAGE',readable:true,single_document:true,confidence:0.5},
    {detected_type:'VISA',side:'VISA_PAGE',readable:true,single_document:false,confidence:0.99},
    'not json',
  ]){f.setRecognition(value);assert.equal((await f.submit()).status,400)}
  assert.equal(f.blobs.size,0)
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM identity_documents').get()!.n,0)
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE action='IDENTITY_RECOGNITION_REQUEST'").get()!.n,6)
})
test('recognition accepts correct licence, passport and other document pages without approving identity',async t=>{
  const f=await fixture(t)
  for(const option of IDENTITY_DOCUMENT_OPTIONS){
    f.setRecognition({detected_type:option.kind,side:option.side,readable:true,single_document:true,confidence:0.96})
    const form=new FormData();form.set('documentType',option.kind);form.set('documentFile',new File([png],'unrelated-filename.png',{type:'image/png'}))
    assert.equal((await f.request('/customer/identity/'+option.slug,'customer',form)).status,303)
    const row=f.sqlite.prepare('SELECT * FROM identity_documents ORDER BY rowid DESC LIMIT 1').get()!
    assert.equal(row.document_kind,option.kind);assert.equal(row.recognition_status,'MATCH');assert.equal(row.status,'PENDING')
  }
  f.sqlite.exec("UPDATE identity_documents SET status='VERIFIED',certified_at=CURRENT_TIMESTAMP WHERE rowid=(SELECT MAX(rowid) FROM identity_documents)")
  assert.throws(()=>f.sqlite.exec("UPDATE identity_documents SET document_kind='VISA' WHERE certified_at IS NOT NULL"),/IMMUTABLE/)
})
test('recognition service outages and failed audit writes fail closed before saving images',async t=>{
  const f=await fixture(t)
  t.mock.method(f.env.AI,'run',async()=>{throw new Error('upstream error with sensitive request details')})
  const response=await f.submit()
  assert.equal(response.status,400);assert.match(await response.text(),/证件识别暂不可用/);assert.equal(f.blobs.size,0)
  f.sqlite.exec("CREATE TRIGGER reject_recognition BEFORE INSERT ON audit_logs WHEN NEW.action='IDENTITY_RECOGNITION_REQUEST' BEGIN SELECT RAISE(ABORT,'AUDIT_UNAVAILABLE'); END")
  const before=f.aiCalls();assert.equal((await f.submit()).status,400);assert.equal(f.aiCalls(),before);assert.equal(f.blobs.size,0)
})
test('recognition ignores filenames and accepts only its exact classification schema',()=>{
  const input=identityRecognitionInput(png.buffer,'image/png')
  assert.equal(input.store,false);assert.equal(JSON.stringify(input).includes('passport.png'),false)
  assert.throws(()=>parseIdentityRecognition({detected_type:'VISA',side:'VISA_PAGE',readable:true,single_document:true,confidence:'0.99'}))
  assert.throws(()=>parseIdentityRecognition({detected_type:'VISA',side:'VISA_PAGE',readable:true,single_document:true,confidence:0.99,name:'MUST NOT BE STORED'}))
  const back={detected_type:'DRIVER_LICENCE',side:'BACK',readable:true,single_document:true,confidence:0.99} as const
  assert.match(identityRecognitionError('DRIVER_LICENCE',back)!,/正面/)
})


test('recognition migration preserves previously certified evidence and locks the new type metadata',t=>{
  const db=new DatabaseSync(':memory:');t.after(()=>db.close())
  for(const name of readdirSync(new URL('../migrations/',import.meta.url)).filter(n=>n.endsWith('.sql')&&n<'0190').sort())db.exec(readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8'))
  db.exec("INSERT INTO stored_objects(id,object_key,category,visibility,storage_tier,content_type,byte_size,sha256) VALUES ('old-file','old-file','identity-documents','ADMIN','STANDARD','image/png',1,'hash'); INSERT INTO identity_documents(id,customer_id,object_id,document_type,status,certified_at) VALUES ('old-doc','old-customer','old-file','VISA','VERIFIED','2026-11-01 12:00:00')")
  const before=db.prepare('SELECT rowid,* FROM identity_documents').get()!
  db.exec(readFileSync(new URL('../migrations/0190_identity_document_recognition.sql',import.meta.url),'utf8'))
  const after=db.prepare('SELECT rowid,* FROM identity_documents').get()!
  for(const field of Object.keys(before))assert.equal(after[field],before[field])
  assert.equal(after.document_kind,'VISA');assert.equal(after.recognition_status,null)
  assert.throws(()=>db.exec("UPDATE identity_documents SET document_kind='PASSPORT'"),/IMMUTABLE/)
})


function testPdf(): Uint8Array<ArrayBuffer> {
  const content='BT /F1 12 Tf 24 150 Td (NOT AN IDENTITY DOCUMENT - TEST ONLY) Tj ET'
  const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>','<< /Length '+content.length+' >>\nstream\n'+content+'\nendstream']
  let pdf='%PDF-1.4\n';const offsets=[0]
  for(const [i,object] of objects.entries()){offsets.push(pdf.length);pdf+=(i+1)+' 0 obj\n'+object+'\nendobj\n'}
  const xref=pdf.length;pdf+='xref\n0 6\n0000000000 65535 f \n'+offsets.slice(1).map(offset=>String(offset).padStart(10,'0')+' 00000 n \n').join('')+'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n'+xref+'\n%%EOF\n'
  return new Uint8Array(new TextEncoder().encode(pdf))
}
test('PDF evidence is converted before classification, encrypted and admin-only',async t=>{
  const f=await fixture(t),bytes=testPdf(),form=new FormData()
  form.set('documentType','VISA');form.set('documentFile',new File([bytes],'private-name.pdf',{type:'application/pdf'}))
  const response=await f.request('/customer/identity/visa','customer',form)
  assert.equal(response.status,303,await response.text());assert.equal(f.pdfCalls(),1)
  const doc=f.sqlite.prepare('SELECT * FROM identity_documents').get()!,object=f.sqlite.prepare('SELECT * FROM stored_objects').get()!
  assert.equal(object.content_type,'application/pdf');assert.equal(object.visibility,'ADMIN');assert.equal(doc.status,'PENDING')
  assert.equal(Buffer.from(f.blobs.get(String(object.object_key))!).includes(Buffer.from(bytes)),false)
  assert.equal((await f.request('/media/'+object.id,'customer')).status,404)
  const viewed=await f.request('/admin/identity-documents/'+doc.id+'/view','admin',new URLSearchParams({purpose:'PDF审核'}))
  assert.equal(viewed.status,200);assert.equal(viewed.headers.get('Content-Type'),'application/pdf');assert.match(viewed.headers.get('Content-Disposition')!,/\.pdf/)
  assert.deepEqual(new Uint8Array(await viewed.arrayBuffer()),bytes)
})
test('malformed, unreadable and overlong PDFs cannot be saved or silently bypass checking',async t=>{
  const f=await fixture(t)
  const upload=(bytes:Uint8Array<ArrayBuffer>)=>{const form=new FormData();form.set('documentType','VISA');form.set('documentFile',new File([bytes],'visa.pdf',{type:'application/pdf'}));return f.request('/customer/identity/visa','customer',form)}
  assert.equal((await upload(png)).status,400);assert.equal(f.pdfCalls(),0)
  for(const result of [{format:'error',error:'private converter details'},{format:'markdown',data:''},{format:'markdown',data:'x'.repeat(32001)}]){f.setPdfResult(result);assert.equal((await upload(testPdf())).status,400)}
  assert.equal(f.aiCalls(),0);assert.equal(f.blobs.size,0)
  t.mock.method(f.env.AI,'toMarkdown',async()=>{throw new Error('converter unavailable')})
  assert.equal((await upload(testPdf())).status,400);assert.equal(f.blobs.size,0)
})
