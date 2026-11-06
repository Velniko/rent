/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */
import type { WorkspaceApp } from './types'
import { renderForbidden } from '../pages/public/notFound'
import { getOrderById, enforceRateLimit } from '../site'
import { createAuditLog } from '../services/audit'
import { parsePickupQrPayload } from '../lib/pickupQr'
import { RosterError } from '../services/roster'
import { issueOrderScan, confirmOrderScan, readOrderScan, hasReturnScan, orderScanLink, scanOrderAccess } from '../services/orderScanning'

export function registerOrderScanningRoutes(app:WorkspaceApp) {
  for(const operation of ['verify','confirm'])app.post('/staff/mobile/scan/'+operation,async c=>{
    const user=c.get('user')
    if(!user||!['ADMIN','STAFF'].includes(user.role))return c.html(renderForbidden(),403)
    if(c.req.header('Origin')!==new URL(c.req.url).origin)return c.json({error:'Invalid request origin'},403)
    if(!await enforceRateLimit(c,'order-scan',user.id,30,60))return c.json({error:'请求过于频繁，请稍后再试'},429)
    c.header('Cache-Control','no-store')
    let input:any
    try{input=await c.req.json();if(operation==='verify'&&input?.source==='code'&&!await enforceRateLimit(c,'order-verification-code',user.id,10,300))throw new RosterError('校验次数过多，请稍后重试或扫码',429);return c.json(operation==='verify'?await issueOrderScan(c,user,input):await confirmOrderScan(c,user,input))}
    catch(error){
      if(error instanceof RosterError){
        let orderId=typeof input?.orderId==='string'?input.orderId:input?.source==='camera'?parsePickupQrPayload(input.code):''
        if(!orderId&&input?.source==='code'&&typeof input.code==='string'){const match=await c.env.RENT.prepare('SELECT order_id FROM order_verification_codes WHERE verification_code=?').bind(input.code.trim().toUpperCase()).first() as any;orderId=match?.order_id||''}
        if(orderId&&await getOrderById(c,orderId))await createAuditLog(c,{actor:user,action:'ORDER_VERIFICATION_FAILED',targetType:'ORDER',targetId:orderId,reason:error.message,after:{operation,source:input?.source||null}})
        return c.json({error:error.message},error.status)
      }
      if(error instanceof SyntaxError)return c.json({error:'二维码无效'},400);throw error
    }
  })
  app.use('*',async(c,next)=>{
    const user=c.get('user');if(!user||!['ADMIN','STAFF'].includes(user.role))return next()
    const match=c.req.path.match(/^\/staff\/orders\/([^/]+)\/(handover|pickup|receive-return|inspection)$/)
    if(!match)return next()
    const [,orderId,action]=match,writing=c.req.method==='POST'
    const targetOrder=await getOrderById(c,orderId)
    if(targetOrder?.is_manual===1){
      try { await scanOrderAccess(c,user,targetOrder,action==='inspection'||action==='receive-return'?'return':'pickup') }
      catch(error){if(error instanceof RosterError)return c.text(error.message,error.status);throw error}
      return next()
    }
    if(action==='inspection'){
      if(writing){const order=await getOrderById(c,orderId);if(order&&!await hasReturnScan(c,order)){await createAuditLog(c,{actor:user,action:'ORDER_SCAN_OPERATION_BLOCKED',targetType:'ORDER',targetId:orderId,reason:'请先扫码并确认归还'});return c.text('请先扫码并确认归还',403)}}
      return next()
    }
    if(!writing&&action==='pickup')return next()
    if(!writing&&!['GET','HEAD'].includes(c.req.method))return next()
    const stage=action==='receive-return'?'return':'pickup'
    try{
      const {row,order}=await readOrderScan(c,user,orderId,stage),now=Date.now()
      if(!writing)return next()
      const claimed=await c.env.RENT.prepare('UPDATE order_scan_sessions SET claimed_at=? WHERE token_hash=? AND actor_id=? AND claimed_at IS NULL AND completed_at IS NULL AND confirmed_at IS NOT NULL AND expires_at>?').bind(now,row.token_hash,user.id,now).run()
      if(Number(claimed.meta.changes)!==1)throw new RosterError('扫码确认已失效，请重新扫码',409)
      await next()
      if(c.res.status<400){await c.env.RENT.prepare('UPDATE order_scan_sessions SET completed_at=? WHERE token_hash=? AND claimed_at=?').bind(Date.now(),row.token_hash,now).run();await createAuditLog(c,{actor:user,action:'ORDER_SCAN_OPERATION_COMPLETED',targetType:'ORDER',targetId:orderId,after:{stage,source:row.source},reason:stage==='pickup'?'取货扫码确认完成':'归还扫码确认完成'})}
      else {
        const current=await getOrderById(c,orderId)
        if(current?.status===order.status&&current.deviceId===order.deviceId&&current.userId===order.userId&&!current.handover_completed_at&&!current.return_received_at)await c.env.RENT.prepare('UPDATE order_scan_sessions SET claimed_at=NULL WHERE token_hash=? AND claimed_at=? AND completed_at IS NULL').bind(row.token_hash,now).run()
      }
    }catch(error){if(!(error instanceof RosterError))throw error;if(writing)await createAuditLog(c,{actor:user,action:'ORDER_SCAN_OPERATION_BLOCKED',targetType:'ORDER',targetId:orderId,reason:error.message});return writing?c.text(error.message,error.status):c.redirect(orderScanLink(orderId,stage))}
  })
}
