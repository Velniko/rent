/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

import type { Context } from 'hono'
import { submitC2CListing, pauseC2CListing } from '../../services/c2c'

export async function customerC2CAction(c: Context, action: 'submit' | 'edit' | 'pause') {
  const user=c.get('user')
  if (!user || user.role!=='CUSTOMER' || (user.accountType ?? user.account_type ?? 'formal')!=='formal') return c.text('无权访问',403)
  try {
    if (action==='pause') await pauseC2CListing(c,(c.req.param('id') || ''),user.id)
    else await submitC2CListing(c,user.id,await c.req.parseBody(),action==='edit'?(c.req.param('id') || ''):undefined)
    return c.redirect(`/customer/c2c?success=${encodeURIComponent(action==='pause'?'设备已下架':'设备已提交审核')}`,303)
  } catch (error) {
    const message=error instanceof Error && !/D1|SQLITE|constraint/i.test(error.message) ? error.message : '操作失败，请刷新后重试'
    return c.redirect(`/customer/c2c?error=${encodeURIComponent(message)}`,303)
  }
}
