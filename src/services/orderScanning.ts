/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */
import type { Context } from 'hono'
import { parseCookie } from '../lib/cookie'
import { parsePickupQrPayload } from '../lib/pickupQr'
import { getOrderById, getUserById, getDeviceById, getContractByOrderId } from '../site'
import { rosterPermission, canStaffReadRosterOrder, RosterError } from './roster'
import { createAuditLog } from './audit'
import { registerOrderReturn } from './returnOperations'

export type ScanStage = 'pickup' | 'return'
export const ORDER_SCAN_COOKIE = 'rent_order_scan'
export const ORDER_SCAN_TTL = 30 * 60 * 1000
export async function scanTokenHash(token:string):Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token))),byte=>byte.toString(16).padStart(2,'0')).join('')
}
export function orderScanLink(orderId:string,stage:ScanStage):string {
  return `/staff/mobile?stage=${stage}&order=${encodeURIComponent(orderId)}#scan`
}
export async function scanOrderAccess(c:Context,user:any,order:any,requestedStage?:string):Promise<ScanStage> {
  if(!order||order.deleted_at)throw new RosterError('二维码对应的订单不存在',404)
  const customer=await getUserById(c,order.userId)
  if(user.role!=='ADMIN'&&(customer?.staffId!==user.id&&!await canStaffReadRosterOrder(c,user,order.id)))throw new RosterError('你没有权限处理该客户的订单。',403)
  const signed=order.status==='approved'&&(await getContractByOrderId(c,order.id))?.status==='signed'
  const stage:ScanStage|undefined=!order.handover_completed_at&&(['paid','pending_pickup'].includes(order.status)||signed)?'pickup':['active','extended','overdue','suspended','pending_return'].includes(order.status)?'return':undefined
  if(!stage||(requestedStage&&requestedStage!==stage))throw new RosterError('该订单当前没有待处理的取货或归还任务。',409)
  const permission=await rosterPermission(c,user,order.id,stage)
  if(!permission.allowed)throw new RosterError(permission.reason||'当前未排班',403)
  return stage
}
export async function issueOrderScan(c:Context,user:any,input:any) {
  if(!input||!['camera','code'].includes(input.source)||typeof input.code!=='string'||input.code.length>500)throw new RosterError('请扫码或输入取还校验码')
  const code=input.code.trim()
  let id=''
  if(input.source==='code'){
    const normalized=code.toUpperCase()
    if(!/^[A-Za-z0-9]{6}$/.test(code))throw new RosterError('请输入 6 位英文字母和数字校验码')
    const credential=await c.env.RENT.prepare('SELECT order_id FROM order_verification_codes WHERE verification_code=?').bind(normalized).first() as any
    if(!credential)throw new RosterError('校验码无效，请核对客户邮件')
    id=credential.order_id
  }else{
    id=parsePickupQrPayload(code)
    if(!id)throw new RosterError('请扫描客户邮件中的取还二维码')
    if(!code.startsWith('RENT-PICKUP:')){
      let url:URL;try{url=new URL(code)}catch{throw new RosterError('二维码无效')}
      if(url.origin!==new URL(c.req.url).origin||url.username||url.password)throw new RosterError('请扫描本站客户邮件中的二维码')
    }
  }
  if(input.orderId&&input.orderId!==id)throw new RosterError('二维码与当前订单不一致',409)
  const order=await getOrderById(c,id),stage=await scanOrderAccess(c,user,order,input.stage)
  const [customer,device]=await Promise.all([getUserById(c,order!.userId),getDeviceById(c,order!.deviceId)])
  const token=crypto.randomUUID().replaceAll('-','')+crypto.randomUUID().replaceAll('-',''),hash=await scanTokenHash(token),now=Date.now()
  await c.env.RENT.prepare('DELETE FROM order_scan_sessions WHERE expires_at < ? AND completed_at IS NULL').bind(now-86400000).run()
  await c.env.RENT.prepare('INSERT INTO order_scan_sessions(token_hash,actor_id,order_id,stage,device_id,customer_id,status_snapshot,scanned_at,expires_at,source) VALUES (?,?,?,?,?,?,?,?,?,?)').bind(hash,user.id,id,stage,order!.deviceId,String(order!.userId||''),order!.status,now,now+ORDER_SCAN_TTL,input.source).run()
  c.header('Set-Cookie',`${ORDER_SCAN_COOKIE}=${token}; Path=/staff; HttpOnly; SameSite=Strict; Max-Age=1800${new URL(c.req.url).protocol==='https:'?'; Secure':''}`)
  await createAuditLog(c,{actor:user,action:input.source==='code'?'ORDER_CODE_VERIFIED':'ORDER_QR_SCANNED',targetType:'ORDER',targetId:id,after:{stage,source:input.source},reason:input.source==='code'?'核验客户邮件校验码':'扫描客户邮件二维码'})
  return {orderId:id,orderNo:order!.orderNo||id,customer:customer?.name||'',device:device?.name||'',stage}
}
export async function readOrderScan(c:Context,user:any,orderId?:string,stage?:ScanStage,confirmed=true) {
  const token=parseCookie(c.req.header('Cookie')||'')[ORDER_SCAN_COOKIE]||''
  if(!/^[a-f0-9]{64}$/.test(token))throw new RosterError('请先扫码并确认本次取还操作',403)
  const hash=await scanTokenHash(token),row=await c.env.RENT.prepare('SELECT * FROM order_scan_sessions WHERE token_hash=? AND actor_id=?').bind(hash,user.id).first() as any
  if(!row||row.expires_at<=Date.now()||row.claimed_at||row.completed_at||(confirmed&&!row.confirmed_at)||(orderId&&row.order_id!==orderId)||(stage&&row.stage!==stage))throw new RosterError('扫码确认已失效，请重新扫码',403)
  const order=await getOrderById(c,row.order_id)
  if(!order||row.device_id!==order.deviceId||row.customer_id!==String(order.userId||'')||row.status_snapshot!==order.status)throw new RosterError('订单已变化，请重新扫码',409)
  await scanOrderAccess(c,user,order,row.stage)
  return {row,order}
}
export async function confirmOrderScan(c:Context,user:any,input:any) {
  if(!input||typeof input.orderId!=='string'||!['pickup','return'].includes(input.stage))throw new RosterError('请重新扫码确认订单')
  const {row,order}=await readOrderScan(c,user,input.orderId,input.stage,false),now=Date.now()
  const result=await c.env.RENT.prepare('UPDATE order_scan_sessions SET confirmed_at=? WHERE token_hash=? AND actor_id=? AND confirmed_at IS NULL AND claimed_at IS NULL AND expires_at>?').bind(now,row.token_hash,user.id,now).run()
  if(Number(result.meta.changes)!==1)throw new RosterError('扫码确认已失效，请重新扫码',409)
  await createAuditLog(c,{actor:user,action:'ORDER_QR_CONFIRMED',targetType:'ORDER',targetId:order.id,after:{stage:row.stage,source:row.source},reason:row.stage==='pickup'?'确认取货':'确认归还'})
  if(row.stage==='return'){
    const claim=await c.env.RENT.prepare('UPDATE order_scan_sessions SET claimed_at=? WHERE token_hash=? AND claimed_at IS NULL AND expires_at>?').bind(now,row.token_hash,now).run()
    if(Number(claim.meta.changes)!==1)throw new RosterError('扫码确认已失效，请重新扫码',409)
    if(!order.return_received_at)await registerOrderReturn(c,user,order.id,{received:'1'})
    await c.env.RENT.prepare('UPDATE order_scan_sessions SET completed_at=? WHERE token_hash=?').bind(Date.now(),row.token_hash).run()
    await createAuditLog(c,{actor:user,action:'ORDER_SCAN_OPERATION_COMPLETED',targetType:'ORDER',targetId:order.id,after:{stage:'return',source:row.source},reason:'归还扫码确认完成'})
  }
  return {next:row.stage==='pickup'?`/staff/orders/${encodeURIComponent(order.id)}/handover`:`/staff/orders/${encodeURIComponent(order.id)}`}
}
export async function hasReturnScan(c:Context,order:any):Promise<boolean> {
  return !!await c.env.RENT.prepare("SELECT token_hash FROM order_scan_sessions WHERE order_id=? AND device_id=? AND customer_id=? AND stage='return' AND completed_at IS NOT NULL LIMIT 1").bind(order.id,order.deviceId,String(order.userId||'')).first()
}
