/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

import type { Context } from 'hono'
import { isC2CMember } from '../../services/c2c'
import { savePayoutPreference,requestRentalPayouts,notifyRentalPayouts,refreshRentalPayout,completeRentalPayout } from '../../services/rentalPayouts'

function message(error:unknown){return error instanceof Error&&!/D1|SQLITE|constraint/i.test(error.message)?error.message:'操作失败，请刷新后重试'}
export async function customerRentalSettlementAction(c:Context,action:'request'|'preferences'){
  const user=c.get('user') as any
  if(!user||user.role!=='CUSTOMER'||(user.accountType ?? user.account_type ?? 'formal')!=='formal'||!await isC2CMember(c,user.id))return c.text('无权访问',403)
  try{
    if(action==='preferences')await savePayoutPreference(c,user.id,await c.req.parseBody())
    else{await requestRentalPayouts(c,user.id);await notifyRentalPayouts(c)}
    return c.redirect('/customer/rental-program/settlements?success='+encodeURIComponent(action==='request'?'结算申请已提交':'结算方式已保存'),303)
  }catch(error){return c.redirect('/customer/rental-program/settlements?error='+encodeURIComponent(message(error)),303)}
}
export async function adminRentalSettlementAction(c:Context,action:'paid'|'refresh'){
  const user=c.get('user') as any
  if(!user||user.role!=='ADMIN')return c.text('无权访问',403)
  try{
    const form=await c.req.parseBody()
    if(action==='paid')await completeRentalPayout(c,c.req.param('id') || '',String(form.reference || ''),String(form.quote || ''))
    else await refreshRentalPayout(c,c.req.param('id') || '')
    return c.redirect('/admin/rental-settlements?success='+encodeURIComponent(action==='paid'?'已登记转账':'结算资料已重新核对'),303)
  }catch(error){return c.redirect('/admin/rental-settlements?error='+encodeURIComponent(message(error)),303)}
}
