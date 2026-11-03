/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

import type { Context } from 'hono'
import { commissionBps, reviewC2CListing, pauseC2CListing, settleC2COrder } from '../../services/c2c'
import { createAuditLog } from '../../services/audit'

export async function adminC2CAction(c: Context, action: 'review' | 'pause' | 'settle' | 'commission') {
  const user=c.get('user')
  if (!user || user.role!=='ADMIN') return c.text('无权访问',403)
  try {
    const form=await c.req.parseBody()
    if (action==='commission') {
      const bps=commissionBps(form.commission)
      await c.env.RENT.prepare('UPDATE c2c_settings SET commission_bps=? WHERE id=1').bind(bps).run()
      await createAuditLog(c,{action:'C2C_COMMISSION',targetType:'settings',targetId:'c2c',after:{commissionBps:bps}})
    } else if (action==='review') await reviewC2CListing(c,(c.req.param('id') || ''),String(form.action || ''),String(form.note || '').slice(0,500))
    else if (action==='pause') await pauseC2CListing(c,(c.req.param('id') || ''))
    else await settleC2COrder(c,(c.req.param('orderId') || ''),String(form.reference || ''),String(form.quote || ''))
    return c.redirect(`/admin/c2c?success=${encodeURIComponent('操作已保存')}`,303)
  } catch (error) {
    const message=error instanceof Error && !/D1|SQLITE|constraint/i.test(error.message) ? error.message : '操作失败，请刷新后重试'
    return c.redirect(`/admin/c2c?error=${encodeURIComponent(message)}`,303)
  }
}
