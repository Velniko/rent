/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

import type { Context } from 'hono'
import { nanoid } from 'nanoid'
import { sanitizePlainText } from '../lib/html'
import { createAuditLog } from './audit'
import { getCloudinaryRuntimeConfig, uploadCloudinaryImage } from '../lib/cloudinary'
import { validateHostedImageUrls } from '../lib/hostedImages'
import { C2C_PHOTO_SLOTS, hasRequiredC2CPhotos } from '../domain/c2cPhotos'
import type { C2CPhotos } from '../domain/c2cPhotos'
import { createNotification } from './notifications'
import { parsePageRequest, clampPageRequest, buildPaginationMeta } from '../lib/pagination'

export interface C2CListing {
  id: string; owner_id: string; device_id: string; name: string; model: string;
  serial_number: string; description: string; photos_json: string; daily_rate: number; deposit: number;
  status: 'pending' | 'approved' | 'rejected' | 'paused'; review_note: string; owner_name?: string;
}
export interface C2CQuote {
  order_id: string; owner_id: string; orderNo: string; owner_name: string; order_status: string;
  commission_bps: number; rental_cents: number; commission_cents: number; owner_cents: number;
  eligible: number; bsb: string; account_number: string; transfer_reference?: string; settled_at?: string;
}

export async function isC2CMember(c: Context,userId: string): Promise<boolean> {
  return Boolean(await c.env.RENT.prepare('SELECT user_id FROM c2c_memberships WHERE user_id=?').bind(userId).first())
}
export async function joinC2C(c: Context,userId: string): Promise<void> {
  const result=await c.env.RENT.prepare('INSERT OR IGNORE INTO c2c_memberships (user_id) VALUES (?)').bind(userId).run()
  if (result.meta.changes) await createAuditLog(c,{action:'C2C_JOIN',targetType:'user',targetId:userId})
}
export async function uploadC2CPhoto(c: Context,ownerId: string,form: Record<string,unknown>) {
  if (!await isC2CMember(c,ownerId)) throw new Error('请先加入出租计划')
  const slot=String(form.slot || '')
  if (!C2C_PHOTO_SLOTS.some(item=>item.key===slot)) throw new Error('请选择照片部位')
  const url=validateHostedImageUrls(await uploadCloudinaryImage(form.file,await getCloudinaryRuntimeConfig(c),'rent/c2c'),1)[0]
  const id=`c2cp-${nanoid(16)}`
  await c.env.RENT.prepare('INSERT INTO c2c_photos (id,owner_id,slot,url) VALUES (?,?,?,?)').bind(id,ownerId,slot,url).run()
  return {id,url}
}
async function listingPhotos(c: Context,ownerId: string,form: Record<string,unknown>): Promise<C2CPhotos> {
  const selected=C2C_PHOTO_SLOTS.map(slot=>({...slot,id:String(form[`photo_${slot.key}`] || '')}))
  if (selected.some(slot=>(slot.required && !slot.id) || (slot.id && !/^c2cp-[A-Za-z0-9_-]{16}$/.test(slot.id)))) throw new Error('请上传设备 A、B、C、D 面及屏幕开机照片')
  const ids=selected.filter(slot=>slot.id).map(slot=>slot.id)
  const rows=(await c.env.RENT.prepare(`SELECT id,slot,url FROM c2c_photos WHERE owner_id=? AND id IN (${ids.map(()=>'?').join(',')})`).bind(ownerId,...ids).all()).results as {id:string;slot:string;url:string}[]
  const photos: C2CPhotos={}
  for (const slot of selected.filter(slot=>slot.id)) {
    const photo=rows.find(row=>row.id===slot.id && row.slot===slot.key)
    if (!photo) throw new Error('照片无效，请重新上传')
    photos[slot.key]={id:photo.id,url:validateHostedImageUrls(photo.url,1)[0]}
  }
  return photos
}
export function commissionBps(value: unknown): number {
  const text = String(value ?? '').trim()
  if (!/^\d{1,3}(?:\.\d{1,2})?$/.test(text) || Number(text) > 100) throw new Error('请输入 0 至 100 的佣金比例')
  return Math.round(Number(text) * 100)
}

export async function getC2CCommission(c: Context): Promise<number> {
  return Number((await c.env.RENT.prepare('SELECT commission_bps FROM c2c_settings WHERE id = 1').first() as {commission_bps: number}).commission_bps)
}
export async function listC2CListings(c: Context, ownerId?: string) {
  const count=await c.env.RENT.prepare(`SELECT COUNT(*) AS total FROM c2c_listings ${ownerId?'WHERE owner_id=?':''}`).bind(...(ownerId?[ownerId]:[])).first() as {total:number}
  const page=clampPageRequest(parsePageRequest(c.req.query('page')),count.total)
  const result = await c.env.RENT.prepare(`SELECT l.*, u.name AS owner_name FROM c2c_listings l JOIN users u ON u.id=l.owner_id ${ownerId ? 'WHERE l.owner_id=?' : ''} ORDER BY l.created_at DESC,l.id DESC LIMIT ? OFFSET ?`).bind(...(ownerId ? [ownerId] : []),page.pageSize,page.offset).all()
  const listings=(result.results || []) as C2CListing[]
  return {listings,meta:buildPaginationMeta(count.total,page,listings.length)}
}
export async function listC2CQuotes(c: Context, ownerId?: string) {
  const count=await c.env.RENT.prepare(`SELECT COUNT(*) AS total FROM c2c_order_terms ${ownerId?'WHERE owner_id=?':''}`).bind(...(ownerId?[ownerId]:[])).first() as {total:number}
  const page=clampPageRequest(parsePageRequest(c.req.query('page')),count.total)
  const result = await c.env.RENT.prepare(`SELECT q.order_id,q.owner_id,q.orderNo,COALESCE(s.account_name,q.owner_name) AS owner_name,q.order_status,q.commission_bps,q.eligible,COALESCE(s.bsb,q.bsb) AS bsb,COALESCE(s.account_number,q.account_number) AS account_number, s.transfer_reference, s.created_at AS settled_at,
    COALESCE(s.rental_cents,q.rental_cents) AS rental_cents, COALESCE(s.commission_cents,q.commission_cents) AS commission_cents,
    COALESCE(s.owner_cents,q.owner_cents) AS owner_cents FROM c2c_settlement_quotes q LEFT JOIN c2c_settlements s ON s.order_id=q.order_id
    ${ownerId ? 'WHERE q.owner_id=?' : ''} ORDER BY q.created_at DESC,q.order_id DESC LIMIT ? OFFSET ?`).bind(...(ownerId ? [ownerId] : []),page.pageSize,page.offset).all()
  const quotes=(result.results || []) as C2CQuote[]
  return {quotes,meta:buildPaginationMeta(count.total,page,quotes.length)}
}
export async function c2cBookingError(c: Context, deviceId: string, customerId: string): Promise<string | null> {
  const listing = await c.env.RENT.prepare(`SELECT l.owner_id, l.status, u.status AS owner_status, u.deleted_at, l.photos_json, m.user_id AS member_id
    FROM c2c_listings l JOIN users u ON u.id=l.owner_id LEFT JOIN c2c_memberships m ON m.user_id=l.owner_id WHERE l.device_id=?`).bind(deviceId).first() as any
  if (!listing) return null
  if (listing.owner_id === customerId) return '不能租赁自己发布的设备'
  return listing.status !== 'approved' || listing.owner_status !== 'active' || listing.deleted_at || !listing.member_id || !hasRequiredC2CPhotos(listing.photos_json) ? '该设备暂不可租' : null
}
export async function submitC2CListing(c: Context, ownerId: string, form: Record<string, unknown>, id?: string): Promise<void> {
  if (!await isC2CMember(c,ownerId)) throw new Error('请先加入出租计划')
  const text = (key: string, max: number) => sanitizePlainText(form[key], max)
  const name=text('name',120), model=text('model',120), serial=text('serialNumber',120), description=text('description',2000)
  const amount = (key: string) => {
    const raw=String(form[key] ?? '').trim()
    return /^\d+(?:\.\d{1,2})?$/.test(raw) ? Number(raw) : NaN
  }
  const daily=amount('dailyRate'), deposit=amount('deposit')
  if (!name || !model || !serial || !Number.isFinite(daily) || daily<=0 || daily>100000 || !Number.isFinite(deposit) || deposit<0 || deposit>1000000) throw new Error('请填写设备信息和有效金额')
  const duplicate=await c.env.RENT.prepare('SELECT id FROM devices WHERE serialNumber=? AND id<>? UNION ALL SELECT id FROM c2c_listings WHERE serial_number=? AND id<>? LIMIT 1').bind(serial,id ? `d-${id}` : '',serial,id || '').first()
  if (duplicate) throw new Error('设备序列号已存在')
  const photos=JSON.stringify(await listingPhotos(c,ownerId,form))
  if (id) {
    const result=await c.env.RENT.prepare(`UPDATE c2c_listings SET name=?,model=?,serial_number=?,description=?,daily_rate=?,deposit=?,photos_json=?,status='pending',review_note='',reviewed_by=NULL,reviewed_at=NULL,updated_at=CURRENT_TIMESTAMP
      WHERE id=? AND owner_id=? AND status IN ('rejected','paused')`).bind(name,model,serial,description,daily,deposit,photos,id,ownerId).run()
    if (!result.meta.changes) throw new Error('设备当前不可编辑')
  } else {
    id=`c2c-${nanoid(16)}`
    await c.env.RENT.prepare('INSERT INTO c2c_listings (id,owner_id,device_id,name,model,serial_number,description,daily_rate,deposit,photos_json) VALUES (?,?,?,?,?,?,?,?,?,?)').bind(id,ownerId,`d-${id}`,name,model,serial,description,daily,deposit,photos).run()
  }
  await createAuditLog(c,{action:'C2C_SUBMIT',targetType:'c2c_listing',targetId:id})
}
export async function reviewC2CListing(c: Context, id: string, action: string, note: string): Promise<void> {
  const listing=await c.env.RENT.prepare('SELECT * FROM c2c_listings WHERE id=?').bind(id).first() as C2CListing | null
  if (!listing || listing.status!=='pending' || !['approve','reject'].includes(action)) throw new Error('发布申请已处理')
  if (action==='reject' && !note.trim()) throw new Error('请填写驳回原因')
  const db=c.env.RENT
  const statements=[]
  if (action==='approve') {
    if (!await isC2CMember(c,listing.owner_id) || !hasRequiredC2CPhotos(listing.photos_json)) throw new Error('请先补齐设备照片并加入出租计划')
    // The listing remains pending until the device and review commit together.
    statements.push(db.prepare(`INSERT INTO devices (id,name,model,serialNumber,description,pricePerDay,depositAmount,status,lifecycle_status)
      SELECT device_id,name,model,serial_number,description,daily_rate,deposit,'available','READY' FROM c2c_listings WHERE id=? AND status='pending'
      ON CONFLICT(id) DO UPDATE SET name=excluded.name,model=excluded.model,serialNumber=excluded.serialNumber,description=excluded.description,
        pricePerDay=excluded.pricePerDay,depositAmount=excluded.depositAmount,status='available',lifecycle_status='READY'`).bind(id))
  }
  statements.push(db.prepare("UPDATE c2c_listings SET status=?,review_note=?,reviewed_by=?,reviewed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='pending'").bind(action==='approve'?'approved':'rejected',sanitizePlainText(note,500),c.get('user').id,id))
  const results=await db.batch(statements)
  if (!results[results.length-1].meta.changes) throw new Error('发布申请已处理')
  await createAuditLog(c,{action:'C2C_REVIEW',targetType:'c2c_listing',targetId:id,before:listing.status,after:action,reason:note})
  await createNotification(c,{recipientId:listing.owner_id,type:'manual',title:action==='approve'?'设备发布已通过':'设备发布未通过',message:action==='approve'?listing.name:`${listing.name}：${note}`})
}
export async function pauseC2CListing(c: Context,id: string,ownerId?: string): Promise<void> {
  const result=await c.env.RENT.prepare(`UPDATE c2c_listings SET status='paused',updated_at=CURRENT_TIMESTAMP WHERE id=? AND status IN ('approved','pending')
    ${ownerId ? 'AND owner_id=?' : ''} AND NOT EXISTS (SELECT 1 FROM orders WHERE deviceId=c2c_listings.device_id AND deleted_at IS NULL AND status NOT IN ('completed','cancelled'))`).bind(id,...(ownerId?[ownerId]:[])).run()
  if (!result.meta.changes) throw new Error('设备当前不可下架，请先处理进行中的订单')
  // Booking is guarded by the listing status even if this update is retried.
  await c.env.RENT.prepare("UPDATE devices SET status='retired',lifecycle_status='RETIRED' WHERE id=(SELECT device_id FROM c2c_listings WHERE id=? AND status='paused')").bind(id).run()
  await createAuditLog(c,{action:'C2C_PAUSE',targetType:'c2c_listing',targetId:id})
}
export function c2cSettlementQuote(q: C2CQuote): string {
  return JSON.stringify([q.order_id,q.owner_id,q.commission_bps,q.rental_cents,q.commission_cents,q.owner_cents,q.owner_name,q.bsb,q.account_number])
}
export async function settleC2COrder(c: Context,orderId: string,reference: string,quoteText: string): Promise<void> {
  let quote: unknown
  try { quote=JSON.parse(quoteText) } catch { throw new Error('请刷新后核对结算金额和收款账户') }
  if (!Array.isArray(quote) || quote.length!==9 || quote[0]!==orderId || !quote.every(v=>typeof v==='string' || (typeof v==='number' && Number.isFinite(v)))) throw new Error('请刷新后核对结算金额和收款账户')
  reference=sanitizePlainText(reference,120)
  if (!reference) throw new Error('请填写转账流水号')
  // One INSERT ... SELECT rechecks eligibility and bank details at claim time;
  // the order primary key prevents duplicate transfers being recorded.
  const result=await c.env.RENT.prepare(`INSERT OR IGNORE INTO c2c_settlements
    (order_id,owner_id,rental_cents,commission_cents,owner_cents,transfer_reference,account_name,bsb,account_number,processed_by)
    SELECT order_id,owner_id,rental_cents,commission_cents,owner_cents,?,owner_name,bsb,account_number,? FROM c2c_settlement_quotes
    WHERE order_id=? AND owner_id=? AND commission_bps=? AND rental_cents=? AND commission_cents=? AND owner_cents=? AND owner_name=? AND bsb=? AND account_number=? AND eligible=1 AND rental_cents>0 AND length(replace(bsb,'-',''))=6
      AND replace(bsb,'-','') NOT GLOB '*[^0-9]*' AND length(account_number) BETWEEN 5 AND 20 AND account_number NOT GLOB '*[^0-9]*'`)
    .bind(reference,c.get('user').id,...quote).run()
  if (!result.meta.changes) throw new Error('订单不可结算、收款信息不完整或已结算')
  await createAuditLog(c,{action:'C2C_SETTLE',targetType:'order',targetId:orderId,after:{reference}})
}
