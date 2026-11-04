/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

import { addRentalPickupBlock,removeRentalPickupBlock } from '../../services/rentalPickup'
import type { Context } from 'hono'
import { submitC2CListing, pauseC2CListing, isC2CMember, joinC2C, uploadC2CPhoto } from '../../services/c2c'

export async function customerC2CAction(c: Context, action: 'submit' | 'edit' | 'pause' | 'join' | 'photo' | 'pickup-add' | 'pickup-remove') {
  const user=c.get('user')
  if (!user || user.role!=='CUSTOMER' || (user.accountType ?? user.account_type ?? 'formal')!=='formal') return action==='photo'?c.json({error:'无权访问'},403):c.text('无权访问',403)
  if (action!=='join' && action!=='pause' && !await isC2CMember(c,user.id)) return action==='photo'?c.json({error:'请先加入出租计划'},403):c.text('请先加入出租计划',403)
  try {
    if (action==='join') await joinC2C(c,user.id,(await c.req.parseBody()).mode)
    else if (action==='photo') return c.json(await uploadC2CPhoto(c,user.id,await c.req.parseBody()))
    else if(action==='pickup-add')await addRentalPickupBlock(c,user.id,c.req.param('id') || '',await c.req.parseBody())
    else if(action==='pickup-remove')await removeRentalPickupBlock(c,user.id,c.req.param('id') || '',c.req.param('blockId') || '')
    else if (action==='pause') await pauseC2CListing(c,(c.req.param('id') || ''),user.id)
    else await submitC2CListing(c,user.id,await c.req.parseBody(),action==='edit'?(c.req.param('id') || ''):undefined)
    if(action==='pickup-add'||action==='pickup-remove')return c.redirect(`/customer/rental-program/${encodeURIComponent(c.req.param('id') || '')}/pickup?success=${encodeURIComponent('取货时间已保存')}`,303)
    return c.redirect(`/customer/rental-program?success=${encodeURIComponent(action==='join'?'已加入出租计划':action==='pause'?'设备已下架':'设备已提交审核')}`,303)
  } catch (error) {
    const message=error instanceof Error && !/D1|SQLITE|constraint/i.test(error.message) ? error.message : '操作失败，请刷新后重试'
    if(action==='pickup-add'||action==='pickup-remove')return c.redirect(`/customer/rental-program/${encodeURIComponent(c.req.param('id') || '')}/pickup?error=${encodeURIComponent(message)}`,303)
    return action==='photo'?c.json({error:message},400):c.redirect(`/customer/rental-program?error=${encodeURIComponent(message)}`,303)
  }
}
