/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

import { parsePageRequest,clampPageRequest,buildPaginationMeta } from '../lib/pagination'
import type { Context } from 'hono'
import { createAuditLog } from './audit'
import { createNotification } from './notifications'
import { c2cSettlementQuote,settleC2COrder,type C2CQuote } from './c2c'

export type PayoutCadence='manual'|'every_other_day'|'weekly'
export interface PayoutPreference {cadence:PayoutCadence;weekday:number|null;next_run_date:string|null}
export interface RentalPayout extends C2CQuote {id:string;account_name:string;status:'pending'|'paid';origin:PayoutCadence;requested_at:string;paid_at:string|null;payable:number;current_owner_cents:number;current_account_name:string;current_bsb:string;current_account_number:string}
const bankValid="length(replace(q.bsb,'-',''))=6 AND replace(q.bsb,'-','') NOT GLOB '*[^0-9]*' AND length(q.account_number) BETWEEN 5 AND 20 AND q.account_number NOT GLOB '*[^0-9]*'"
const available=`q.eligible=1 AND q.owner_cents>0 AND q.rental_cents>0 AND ${bankValid} AND NOT EXISTS(SELECT 1 FROM c2c_settlements s WHERE s.order_id=q.order_id) AND NOT EXISTS(SELECT 1 FROM c2c_payout_requests r WHERE r.order_id=q.order_id)`
export function payoutClock(now=new Date()) {
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Australia/Melbourne',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'}).formatToParts(now)
  const part=(type:string)=>parts.find(item=>item.type===type)?.value || ''
  return {date:`${part('year')}-${part('month')}-${part('day')}`,hour:Number(part('hour'))}
}
function plusDays(date:string,days:number){return new Date(Date.parse(date+'T00:00:00Z')+days*86400000).toISOString().slice(0,10)}
export function nextPayoutDate(cadence:PayoutCadence,weekday:number|null,now=new Date()):string|null {
  if(cadence==='manual')return null
  const clock=payoutClock(now)
  if(cadence==='every_other_day')return plusDays(clock.date,2)
  const current=new Date(clock.date+'T00:00:00Z').getUTCDay()
  const delta=((weekday! - current + 7)%7)|| (clock.hour<9?0:7)
  return plusDays(clock.date,delta)
}
export async function getPayoutPreference(c:Context,ownerId:string):Promise<PayoutPreference>{
  return await c.env.RENT.prepare('SELECT cadence,weekday,next_run_date FROM c2c_payout_preferences WHERE owner_id=?').bind(ownerId).first() as PayoutPreference || {cadence:'manual',weekday:null,next_run_date:null}
}
export async function savePayoutPreference(c:Context,ownerId:string,form:Record<string,unknown>) {
  const cadence=String(form.cadence || '') as PayoutCadence
  if(!['manual','every_other_day','weekly'].includes(cadence))throw new Error('请选择结算方式')
  const weekday=cadence==='weekly' && /^[0-6]$/.test(String(form.weekday))?Number(form.weekday):null
  if(cadence==='weekly' && weekday===null)throw new Error('请选择每周结算日')
  const bank=await c.env.RENT.prepare("SELECT 1 FROM users WHERE id=? AND length(replace(bsb,'-',''))=6 AND replace(bsb,'-','') NOT GLOB '*[^0-9]*' AND length(account_number) BETWEEN 5 AND 20 AND account_number NOT GLOB '*[^0-9]*'").bind(ownerId).first()
  if(cadence!=='manual'&&!bank)throw new Error('请先设置有效的收款账户')
  const before=await getPayoutPreference(c,ownerId)
  if(before.cadence===cadence && before.weekday===weekday)return
  const next=nextPayoutDate(cadence,weekday)
  await c.env.RENT.prepare(`INSERT INTO c2c_payout_preferences (owner_id,cadence,weekday,next_run_date) VALUES (?,?,?,?) ON CONFLICT(owner_id) DO UPDATE SET cadence=excluded.cadence,weekday=excluded.weekday,next_run_date=excluded.next_run_date,updated_at=CURRENT_TIMESTAMP`).bind(ownerId,cadence,weekday,next).run()
  await createAuditLog(c,{action:'RENTAL_PAYOUT_PREFERENCE',targetType:'user',targetId:ownerId,before,after:{cadence,weekday,next}})
}
export async function requestRentalPayouts(c:Context,ownerId:string,automatic?:PayoutPreference):Promise<number>{
  const origin=automatic?.cadence || 'manual'
  const date=automatic?.next_run_date || ''
  const guard=automatic?"AND EXISTS(SELECT 1 FROM c2c_payout_preferences p WHERE p.owner_id=q.owner_id AND p.cadence=? AND p.next_run_date=?)":''
  const statement=c.env.RENT.prepare(`INSERT OR IGNORE INTO c2c_payout_requests (id,order_id,owner_id,origin,commission_bps,rental_cents,commission_cents,owner_cents,account_name,bsb,account_number)
    SELECT 'rp-'||lower(hex(randomblob(12))),q.order_id,q.owner_id,?,q.commission_bps,q.rental_cents,q.commission_cents,q.owner_cents,q.owner_name,q.bsb,q.account_number
    FROM c2c_settlement_quotes q JOIN users u ON u.id=q.owner_id WHERE q.owner_id=? AND u.status='active' AND u.deleted_at IS NULL AND ${available} ${guard} ORDER BY q.created_at LIMIT 500`)
    .bind(origin,ownerId,...(automatic?[origin,date]:[]))
  const statements=[statement]
  if(automatic){
    const today=payoutClock().date
    let next=date;do{next=plusDays(next,origin==='weekly'?7:2)}while(next<=today)
    statements.push(c.env.RENT.prepare('UPDATE c2c_payout_preferences SET next_run_date=? WHERE owner_id=? AND cadence=? AND next_run_date=?').bind(next,ownerId,origin,date))
  }
  const result=await c.env.RENT.batch(statements)
  const count=Number(result[0].meta.changes || 0)
  if(!automatic&&!count)throw new Error('暂无可申请的收入，请检查收款账户')
  if(count)await createAuditLog(c,{action:'RENTAL_PAYOUT_REQUEST',targetType:'user',targetId:ownerId,after:{origin,count}})
  return count
}
export async function notifyRentalPayouts(c:Context):Promise<number>{
  const requests=(await c.env.RENT.prepare("SELECT id,owner_id,account_name,owner_cents FROM c2c_payout_requests WHERE status='pending' AND notified_at IS NULL ORDER BY requested_at LIMIT 50").all()).results as any[]
  if(!requests.length)return 0
  const admins=(await c.env.RENT.prepare("SELECT id FROM users WHERE role='ADMIN' AND status='active' AND deleted_at IS NULL").all()).results as {id:string}[]
  if(!admins.length)return 0
  for(const request of requests){
    for(const admin of admins)await createNotification(c,{recipientId:admin.id,type:'c2c_payout_pending',title:'出租结算待转账',titleEn:'Rental payout awaiting bank transfer',message:`${request.account_name} · AUD$${(request.owner_cents/100).toFixed(2)}`,messageEn:`${request.account_name} · AUD$${(request.owner_cents/100).toFixed(2)}`,dedupeKey:`c2c-payout:${request.id}:${admin.id}`,notifyByEmail:false})
    await c.env.RENT.prepare('UPDATE c2c_payout_requests SET notified_at=CURRENT_TIMESTAMP WHERE id=? AND notified_at IS NULL').bind(request.id).run()
  }
  return requests.length
}
export async function runRentalPayouts(c:Context):Promise<{created:number;notified:number}>{
  const clock=payoutClock();let created=0
  if(clock.hour>=9){
    const due=(await c.env.RENT.prepare("SELECT owner_id,cadence,weekday,next_run_date FROM c2c_payout_preferences WHERE cadence<>'manual' AND next_run_date<=? ORDER BY next_run_date LIMIT 25").bind(clock.date).all()).results as (PayoutPreference&{owner_id:string})[]
    for(const row of due)created+=await requestRentalPayouts(c,row.owner_id,row)
  }
  return {created,notified:await notifyRentalPayouts(c)}
}
export async function rentalPayouts(c:Context,ownerId?:string){
  const count=await c.env.RENT.prepare(`SELECT COUNT(*) AS total FROM c2c_payout_requests ${ownerId?'WHERE owner_id=?':''}`).bind(...(ownerId?[ownerId]:[])).first() as {total:number}
  const page=clampPageRequest(parsePageRequest(c.req.query('page')),count.total)
  const requests=((await c.env.RENT.prepare(`SELECT r.*,r.account_name AS owner_name,q.orderNo,q.order_status,q.eligible,q.owner_cents AS current_owner_cents,q.owner_name AS current_account_name,q.bsb AS current_bsb,q.account_number AS current_account_number,s.transfer_reference,
    CASE WHEN r.status='pending' AND q.eligible=1 AND s.order_id IS NULL AND q.rental_cents=r.rental_cents AND q.owner_cents=r.owner_cents AND q.commission_cents=r.commission_cents AND q.commission_bps=r.commission_bps AND q.owner_name=r.account_name AND q.bsb=r.bsb AND q.account_number=r.account_number THEN 1 ELSE 0 END AS payable
    FROM c2c_payout_requests r JOIN c2c_settlement_quotes q ON q.order_id=r.order_id LEFT JOIN c2c_settlements s ON s.order_id=r.order_id ${ownerId?'WHERE r.owner_id=?':''} ORDER BY r.status DESC,r.requested_at DESC,r.id DESC LIMIT ? OFFSET ?`).bind(...(ownerId?[ownerId]:[]),page.pageSize,page.offset).all()).results || []) as RentalPayout[]
  return {requests,meta:buildPaginationMeta(count.total,page,requests.length)}
}
export async function refreshRentalPayout(c:Context,id:string){
  const before=await c.env.RENT.prepare('SELECT * FROM c2c_payout_requests WHERE id=?').bind(id).first()
  const result=await c.env.RENT.prepare(`UPDATE c2c_payout_requests SET (commission_bps,rental_cents,commission_cents,owner_cents,account_name,bsb,account_number,refreshed_at)=
    (SELECT q.commission_bps,q.rental_cents,q.commission_cents,q.owner_cents,q.owner_name,q.bsb,q.account_number,CURRENT_TIMESTAMP FROM c2c_settlement_quotes q WHERE q.order_id=c2c_payout_requests.order_id)
    WHERE id=? AND status='pending' AND EXISTS(SELECT 1 FROM c2c_settlement_quotes q WHERE q.order_id=c2c_payout_requests.order_id AND q.eligible=1 AND q.owner_cents>0 AND ${bankValid})`).bind(id).run()
  if(!result.meta.changes)throw new Error('当前收入不可转账，请核对订单和收款账户')
  await createAuditLog(c,{action:'RENTAL_PAYOUT_REFRESH',targetType:'rental_payout',targetId:id,before,after:await c.env.RENT.prepare('SELECT * FROM c2c_payout_requests WHERE id=?').bind(id).first()})
}
export async function completeRentalPayout(c:Context,id:string,reference:string,quote:string){
  const row=await c.env.RENT.prepare("SELECT r.*,r.account_name AS owner_name FROM c2c_payout_requests r WHERE id=? AND status='pending'").bind(id).first() as RentalPayout|null
  if(!row || quote!==c2cSettlementQuote(row))throw new Error('结算资料已更新，请刷新后核对')
  await settleC2COrder(c,row.order_id,reference,quote)
}
