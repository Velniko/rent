/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

import type { Context } from 'hono'
import { MANUAL_INSPECTION_CHECKS } from '../../lib/inspection'
import { buildLayout, getOrderById, sanitizePlainText } from '../../site'

const INSPECTION_TYPE_LABEL: Record<string, string> = { before_rental: '出租前验机报告', after_return: '归还后验机报告', automated_health: '设备自检报告' }

function photoGrid(urls: string[]): string {
  return urls.filter(Boolean).map(url => `<a href="${sanitizePlainText(url, 500)}" target="_blank" rel="noopener"><img src="${sanitizePlainText(url, 500)}" alt="验机照片" style="max-width:160px;border-radius:8px;margin:4px"></a>`).join('')
}

export async function renderInspectionView(c: Context, id: string, user: any) {
  if (!user) return buildLayout('验机报告', '<div class="panel"><h2>请先登录</h2></div>', user)
  const row = await c.env.RENT.prepare('SELECT * FROM device_inspections WHERE id = ? AND deleted_at IS NULL').bind(id).first() as any
  if (!row) return buildLayout('验机报告', '<div class="panel"><h2>验机报告不存在</h2></div>', user)
  const order = row.rental_id ? await getOrderById(c, row.rental_id) : null
  if (!(user.role === 'ADMIN' || user.role === 'STAFF' || (order && order.userId === user.id))) return buildLayout('无权查看', '<div class="panel"><h2>无权查看该验机报告</h2></div>', user)
  let snapshot: Record<string, any> = {}
  try { snapshot = JSON.parse(row.snapshot_json || '{}') } catch (_) { }
  const checks = MANUAL_INSPECTION_CHECKS.map(([, label, storedKey, shortKey]) => `<div><dt>${label}</dt><dd>${sanitizePlainText(String(snapshot[storedKey] || snapshot[shortKey] || '未测试'), 20)}</dd></div>`).join('')
  const photos = snapshot.inspectionPhotos && typeof snapshot.inspectionPhotos === 'object' ? photoGrid(Object.values(snapshot.inspectionPhotos) as string[]) : ''
  const damage = snapshot.damageDescription
    ? `<section class="panel" style="margin-top:16px;background:#fff7ed"><h3>损坏说明</h3><p>${sanitizePlainText(String(snapshot.damageDescription), 2000)}</p>${snapshot.damagePhotos ? photoGrid(String(snapshot.damagePhotos).split('\n')) : ''}</section>` : ''
  const body = `<div class="page-header"><div><p class="section-code">INSPECTION REPORT</p><h2>${INSPECTION_TYPE_LABEL[row.inspection_type] || '验机报告'}</h2>${order ? `<p>订单 ${sanitizePlainText(String(order.orderNo || order.id), 60)}</p>` : ''}</div></div><div class="panel"><dl class="data-list grid grid-2">${checks}<div><dt>电池循环次数</dt><dd>${sanitizePlainText(String(snapshot.batteryCycles ?? '—'), 20)}</dd></div><div><dt>电池健康</dt><dd>${sanitizePlainText(String(snapshot.batteryHealth || '—'), 100)}</dd></div><div><dt>验机人</dt><dd>${sanitizePlainText(String(snapshot.inspectionBy || '—'), 80)}</dd></div><div><dt>验机日期</dt><dd>${sanitizePlainText(String(snapshot.inspectionDate || snapshot.returnDate || '—'), 20)}</dd></div></dl>${snapshot.inspectionNotes ? `<p><strong>验机备注：</strong>${sanitizePlainText(String(snapshot.inspectionNotes), 2000)}</p>` : ''}${photos ? `<section style="margin-top:16px"><h3>验机照片</h3>${photos}</section>` : ''}${damage}</div>`
  return buildLayout(INSPECTION_TYPE_LABEL[row.inspection_type] || '验机报告', body, user)
}
