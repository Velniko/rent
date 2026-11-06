/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

import { readRentalCity } from './rentalPickup'
import type { Context } from 'hono'
import { shippingAddressFromForm,formatShippingAddress } from '../domain/rentalProgramAddress'
import { nanoid } from 'nanoid'
import { sanitizePlainText } from '../lib/html'
import { createAuditLog } from './audit'
import { uploadSiteImage } from './objectStorage'
import { validateHostedImageUrls } from '../lib/hostedImages'
import { C2C_PHOTO_SLOTS, hasRequiredC2CPhotos } from '../domain/c2cPhotos'
import type { C2CPhotos } from '../domain/c2cPhotos'
import { createNotification } from './notifications'
import { parsePageRequest, clampPageRequest, buildPaginationMeta } from '../lib/pagination'

export interface C2CListing {
  id: string; owner_id: string; device_id: string; name: string; model: string;
  serial_number: string; description: string; photos_json: string; daily_rate: number; deposit: number;
  public_city:string; listing_mode: C2CMode; pickup_address: string; pickup_address_json:string; listed_at: string | null; custody_received_at: string | null; pause_locked?:number; unlist_after?:string;
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
export type C2CMode='self' | 'managed'
export const c2cModeLabels={self:'自行交付',managed:'墨尔本托管'}
export interface C2CSettings {commission_bps:number;managed_commission_bps:number|null;shipping_address:string;shipping_address_json:string}
export async function getC2CSettings(c: Context): Promise<C2CSettings> {
  return await c.env.RENT.prepare('SELECT commission_bps,managed_commission_bps,shipping_address,shipping_address_json FROM c2c_settings WHERE id=1').first() as C2CSettings
}
export async function getC2CMembership(c: Context,userId: string): Promise<{mode:C2CMode;mode_change_locked:number;mode_change_after:string}|null> {
  return await c.env.RENT.prepare("SELECT mode,datetime(COALESCE(mode_changed_at,joined_at),'+3 months') AS mode_change_after,CASE WHEN julianday('now')<=julianday(COALESCE(mode_changed_at,joined_at),'+3 months') THEN 1 ELSE 0 END AS mode_change_locked FROM c2c_memberships WHERE user_id=?").bind(userId).first() as {mode:C2CMode;mode_change_locked:number;mode_change_after:string}|null
}
export async function canChangeC2CMode(c: Context,userId: string): Promise<boolean> {
  const membership=await getC2CMembership(c,userId)
  if (membership?.mode_change_locked) return false
  return !await c.env.RENT.prepare(`SELECT 1 FROM c2c_listings WHERE owner_id=? AND status IN ('pending','approved')
    UNION ALL SELECT 1 FROM c2c_order_terms t JOIN orders o ON o.id=t.order_id WHERE t.owner_id=? AND o.deleted_at IS NULL AND o.status NOT IN ('completed','cancelled') LIMIT 1`).bind(userId,userId).first()
}
export async function joinC2C(c: Context,userId: string,input: unknown): Promise<void> {
  if (input!=='self' && input!=='managed') throw new Error('请选择出租模式')
  const existing=await getC2CMembership(c,userId)
  if (existing?.mode===input) return
  if (existing?.mode_change_locked) throw new Error('切换出租模式需间隔超过 3 个月')
  const settings=await getC2CSettings(c)
  if (input==='managed' && (settings.managed_commission_bps==null || !settings.shipping_address.trim())) throw new Error('托管模式暂未开放')
  if (existing && !await canChangeC2CMode(c,userId)) throw new Error('请先下架全部设备并完成出租订单')
  try {
    await c.env.RENT.prepare(`INSERT INTO c2c_memberships (user_id,mode) VALUES (?,?) ON CONFLICT(user_id) DO UPDATE SET mode=excluded.mode`).bind(userId,input).run()
  } catch (error) {
    if (String(error).includes('C2C_MODE_CHANGE_COOLDOWN')) throw new Error('切换出租模式需间隔超过 3 个月')
    if (String(error).includes('C2C_UNLIST_ALL_BEFORE_MODE_CHANGE')) throw new Error('请先下架全部设备并完成出租订单')
    throw error
  }
  await createAuditLog(c,{action:existing?'C2C_MODE_CHANGE':'C2C_JOIN',targetType:'user',targetId:userId,before:existing?.mode,after:input})
}
export async function uploadC2CPhoto(c: Context,ownerId: string,form: Record<string,unknown>) {
  if (!await isC2CMember(c,ownerId)) throw new Error('请先加入出租计划')
  const slot=String(form.slot || '')
  if (!C2C_PHOTO_SLOTS.some(item=>item.key===slot)) throw new Error('请选择照片部位')
  const url=validateHostedImageUrls(await uploadSiteImage(form.file,c,'rent/c2c'),1)[0]
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

export async function listC2CListings(c: Context, ownerId?: string) {
  const count=await c.env.RENT.prepare(`SELECT COUNT(*) AS total FROM c2c_listings ${ownerId?'WHERE owner_id=?':''}`).bind(...(ownerId?[ownerId]:[])).first() as {total:number}
  const page=clampPageRequest(parsePageRequest(c.req.query('page')),count.total)
  const result = await c.env.RENT.prepare(`SELECT l.*, u.name AS owner_name,datetime(l.listed_at,'+6 months') AS unlist_after,CASE WHEN l.listing_mode='managed' AND l.listed_at IS NOT NULL AND julianday('now')<=julianday(l.listed_at,'+6 months') THEN 1 ELSE 0 END AS pause_locked FROM c2c_listings l JOIN users u ON u.id=l.owner_id ${ownerId ? 'WHERE l.owner_id=?' : ''} ORDER BY l.created_at DESC,l.id DESC LIMIT ? OFFSET ?`).bind(...(ownerId ? [ownerId] : []),page.pageSize,page.offset).all()
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
  const listing = await c.env.RENT.prepare(`SELECT l.owner_id, l.status, l.pickup_address, l.listing_mode, l.custody_received_at, m.mode AS member_mode, s.managed_commission_bps, u.status AS owner_status, u.deleted_at, l.photos_json, m.user_id AS member_id
    FROM c2c_listings l JOIN users u ON u.id=l.owner_id LEFT JOIN c2c_memberships m ON m.user_id=l.owner_id CROSS JOIN c2c_settings s WHERE l.device_id=?`).bind(deviceId).first() as any
  if (!listing) return null
  if (listing.owner_id === customerId) return '不能租赁自己发布的设备'
  return listing.status !== 'approved' || listing.owner_status !== 'active' || listing.deleted_at || !listing.member_id || !listing.pickup_address.trim() || listing.listing_mode!==listing.member_mode || (listing.listing_mode==='managed' && (!listing.custody_received_at || listing.managed_commission_bps==null)) || !hasRequiredC2CPhotos(listing.photos_json) ? '该设备暂不可租' : null
}
export async function submitC2CListing(c: Context, ownerId: string, form: Record<string, unknown>, id?: string): Promise<void> {
  const membership=await getC2CMembership(c,ownerId)
  if (!membership) throw new Error('请先加入出租计划')
  if (form.mode!==membership.mode) throw new Error('出租模式已变更，请刷新后重试')
  const settings=await getC2CSettings(c)
  if (membership.mode==='self' && form.pickupAddress) throw new Error('地址表单已更新，请刷新后填写')
  const address=membership.mode==='managed'?null:shippingAddressFromForm(form,'pickup')
  const pickupAddress=membership.mode==='managed'?settings.shipping_address:formatShippingAddress(address!)
  const publicCity=membership.mode==='managed'?'墨尔本':readRentalCity(form.publicCity,address?.city)
  const pickupAddressJson=membership.mode==='managed'?settings.shipping_address_json:JSON.stringify(address)
  if (pickupAddress.length>500) throw new Error('请填写有效的取件地址')
  if (!pickupAddress.trim()) throw new Error(membership.mode==='managed'?'托管模式暂未开放':'请填写取件地址')
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
    const result=await c.env.RENT.prepare(`UPDATE c2c_listings SET name=?,model=?,serial_number=?,description=?,daily_rate=?,deposit=?,photos_json=?,listing_mode=?,pickup_address=?,pickup_address_json=?,public_city=?,listed_at=NULL,custody_received_at=NULL,status='pending',review_note='',reviewed_by=NULL,reviewed_at=NULL,updated_at=CURRENT_TIMESTAMP
      WHERE id=? AND owner_id=? AND status IN ('rejected','paused') AND EXISTS(SELECT 1 FROM c2c_memberships WHERE user_id=? AND mode=?)`).bind(name,model,serial,description,daily,deposit,photos,membership.mode,pickupAddress,pickupAddressJson,publicCity,id,ownerId,ownerId,membership.mode).run()
    if (!result.meta.changes) throw new Error('设备当前不可编辑')
  } else {
    id=`c2c-${nanoid(16)}`
    const result=await c.env.RENT.prepare('INSERT INTO c2c_listings (id,owner_id,device_id,name,model,serial_number,description,daily_rate,deposit,photos_json,listing_mode,pickup_address,pickup_address_json,public_city) SELECT ?,?,?,?,?,?,?,?,?,?,mode,?,?,? FROM c2c_memberships WHERE user_id=? AND mode=?').bind(id,ownerId,`d-${id}`,name,model,serial,description,daily,deposit,photos,pickupAddress,pickupAddressJson,publicCity,ownerId,membership.mode).run()
    if (!result.meta.changes) throw new Error('出租模式已变更，请刷新后重试')
  }
  await createAuditLog(c,{action:'C2C_SUBMIT',targetType:'c2c_listing',targetId:id})
}
export async function reviewC2CListing(c: Context, id: string, action: string, note: string, received=false): Promise<void> {
  const listing=await c.env.RENT.prepare('SELECT * FROM c2c_listings WHERE id=?').bind(id).first() as C2CListing | null
  if (!listing || listing.status!=='pending' || !['approve','reject'].includes(action)) throw new Error('发布申请已处理')
  if (action==='reject' && !note.trim()) throw new Error('请填写驳回原因')
  const db=c.env.RENT
  const statements=[]
  if (action==='approve') {
    if (listing.listing_mode==='managed' && !received) throw new Error('请先确认已收到托管设备')
    if (!await isC2CMember(c,listing.owner_id) || !hasRequiredC2CPhotos(listing.photos_json)) throw new Error('请先补齐设备照片并加入出租计划')
    // The listing remains pending until the device and review commit together.
    statements.push(db.prepare(`INSERT INTO devices (id,name,model,serialNumber,description,pricePerDay,depositAmount,status,lifecycle_status)
      SELECT device_id,name,model,serial_number,description,daily_rate,deposit,'available','READY' FROM c2c_listings WHERE id=? AND status='pending'
      ON CONFLICT(id) DO UPDATE SET name=excluded.name,model=excluded.model,serialNumber=excluded.serialNumber,description=excluded.description,
        pricePerDay=excluded.pricePerDay,depositAmount=excluded.depositAmount,status='available',lifecycle_status='READY'`).bind(id))
  }
  statements.push(db.prepare("UPDATE c2c_listings SET status=?,review_note=?,reviewed_by=?,reviewed_at=CURRENT_TIMESTAMP,listed_at=CASE WHEN ?='approve' THEN CURRENT_TIMESTAMP ELSE listed_at END,custody_received_at=CASE WHEN ?='approve' AND listing_mode='managed' THEN CURRENT_TIMESTAMP ELSE custody_received_at END,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='pending'").bind(action==='approve'?'approved':'rejected',sanitizePlainText(note,500),c.get('user').id,action,action,id))
  const results=await db.batch(statements)
  if (!results[results.length-1].meta.changes) throw new Error('发布申请已处理')
  await createAuditLog(c,{action:'C2C_REVIEW',targetType:'c2c_listing',targetId:id,before:listing.status,after:action,reason:note})
  await createNotification(c,{recipientId:listing.owner_id,type:'manual',title:action==='approve'?'设备发布已通过':'设备发布未通过',message:action==='approve'?listing.name:`${listing.name}：${note}`})
}
export async function pauseC2CListing(c: Context,id: string,ownerId?: string): Promise<void> {
  const locked=await c.env.RENT.prepare("SELECT 1 FROM c2c_listings WHERE id=? AND listing_mode='managed' AND listed_at IS NOT NULL AND julianday('now')<=julianday(listed_at,'+6 months')").bind(id).first()
  if (locked) throw new Error('托管设备上架超过 6 个月后才可下架')
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
