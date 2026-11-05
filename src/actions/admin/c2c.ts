/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

import type { Context } from 'hono'
import { shippingAddressFromForm,formatShippingAddress } from '../../domain/rentalProgramAddress'
import { commissionBps, reviewC2CListing, pauseC2CListing, settleC2COrder } from '../../services/c2c'
import { createAuditLog } from '../../services/audit'

export async function adminC2CAction(c: Context, action: 'review' | 'pause' | 'settle' | 'commission') {
  const user=c.get('user')
  if (!user || user.role!=='ADMIN') return c.text('无权访问',403)
  try {
    const form=await c.req.parseBody()
    if (action==='commission') {
      const bps=commissionBps(form.commission),managedBps=String(form.managedCommission ?? '').trim()?commissionBps(form.managedCommission):null
      if (managedBps!==null && bps===managedBps) throw new Error('两种模式的手续费应不同')
      if (form.shippingAddress && !Object.keys(form).some(key=>key.startsWith('shipping_'))) throw new Error('地址表单已更新，请刷新后填写')
      const shippingAddress=shippingAddressFromForm(form),address=formatShippingAddress(shippingAddress)
      if (address.length>500 || /[<>]/.test(address)) throw new Error('请填写有效的托管寄件地址')
      await c.env.RENT.prepare('UPDATE c2c_settings SET commission_bps=?,managed_commission_bps=?,shipping_address=?,shipping_address_json=? WHERE id=1').bind(bps,managedBps,address,JSON.stringify(shippingAddress)).run()
      await createAuditLog(c,{action:'C2C_COMMISSION',targetType:'settings',targetId:'c2c',after:{commissionBps:bps,managedCommissionBps:managedBps,shippingAddress:address}})
    } else if (action==='review') await reviewC2CListing(c,(c.req.param('id') || ''),String(form.action || ''),String(form.note || '').slice(0,500),form.received==='1')
    else if (action==='pause') await pauseC2CListing(c,(c.req.param('id') || ''))
    else await settleC2COrder(c,(c.req.param('orderId') || ''),String(form.reference || ''),String(form.quote || ''))
    return c.redirect(`/admin/rental-program?success=${encodeURIComponent('操作已保存')}`,303)
  } catch (error) {
    const message=error instanceof Error && !/D1|SQLITE|constraint/i.test(error.message) ? error.message : '操作失败，请刷新后重试'
    return c.redirect(`/admin/rental-program?error=${encodeURIComponent(message)}`,303)
  }
}
