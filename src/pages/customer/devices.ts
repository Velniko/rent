/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

import { buildLayout, getDevices, formatCurrency } from '../../site'
import { escapeHtml } from '../../lib/html'
import type { Context } from 'hono'

export async function renderCustomerDevices(c: Context,user: any) {
  const rows=(await c.env.RENT.prepare(`SELECT l.device_id,l.owner_id,l.status,u.status AS owner_status,u.deleted_at
    FROM c2c_listings l JOIN users u ON u.id=l.owner_id`).all()).results || []
  const listings=new Map<string,any>(rows.map((l: any)=>[l.device_id,l]))
  const mode=c.req.query('mode')
  const devices=(await getDevices(c)).filter(device=>{
    const l=listings.get(device.id)
    return device.status==='available' && (!l || (l.status==='approved' && l.owner_id!==user.id && l.owner_status==='active' && !l.deleted_at))
      && (mode==='c2c'?Boolean(l):mode==='platform'?!l:true)
  })
  const body=`<div class="panel"><div class="section-title"><h2>设备租赁</h2><a class="button button-primary" href="/customer/c2c">发布我的设备</a></div>
    <nav class="record-actions" aria-label="设备来源"><a class="button button-secondary" href="/customer/devices" ${!mode?'aria-current="page"':''}>全部设备</a><a class="button button-secondary" href="/customer/devices?mode=platform" ${mode==='platform'?'aria-current="page"':''}>平台自营</a><a class="button button-secondary" href="/customer/devices?mode=c2c" ${mode==='c2c'?'aria-current="page"':''}>个人设备</a></nav>
    ${devices.length?`<div class="device-list grid grid-3">${devices.map(device=>`<div class="device-card card"><span class="badge">${listings.has(device.id)?'个人设备':'平台自营'}</span>
      <h3>${escapeHtml(device.name)}</h3><p>分类: ${escapeHtml(device.category || '其他')}</p><p>型号: ${escapeHtml(device.model)}</p><p>日租金: ${formatCurrency(device.pricePerDay ?? device.dailyRate ?? 0)}</p><p>押金: ${formatCurrency(device.depositAmount)}</p>
      <a class="button button-primary" href="/customer/rent/${encodeURIComponent(device.id)}">立即租赁</a></div>`).join('')}</div>`:'<p>暂无可用设备。</p>'}</div>`
  return buildLayout('设备租赁 - 电脑租赁管理系统',body,user)
}
