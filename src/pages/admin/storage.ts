/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

import type { Context } from 'hono'
import { buildLayout, sanitizePlainText, formatMelbourneDateTime } from '../../site'
import { hasOciStorage } from '../../lib/ociStorage'
export async function renderAdminStorage(c: Context, user: any): Promise<string> {
  const totals = await c.env.RENT.prepare("SELECT COUNT(*) AS total,SUM(CASE WHEN (storage_tier = 'ARCHIVE' AND oci_ready = 0) OR r2_ready = 0 THEN 1 ELSE 0 END) AS pending FROM stored_objects").first() as any
  const rows = (await c.env.RENT.prepare("SELECT id,category,created_at,oci_ready,r2_ready FROM stored_objects WHERE storage_tier = 'ARCHIVE' ORDER BY created_at DESC LIMIT 30").all()).results as any[]
  const esc = (value: unknown) => sanitizePlainText(value,200)
  const body = `<div class="page-header"><h2>对象存储</h2><a class="button button-secondary" href="/admin/api-settings">API 设置</a></div><section class="panel"><dl class="data-list"><div><dt>甲骨文归档存储</dt><dd>${hasOciStorage(c.env) ? '已配置' : '未配置'}</dd></div><div><dt>R2 对象存储</dt><dd>${c.env.STORAGE_BACKUP ? '已配置' : '未配置'}</dd></div><div><dt>文件加密</dt><dd>${String(c.env.STORAGE_ENCRYPTION_KEY || '').length >= 32 ? '已配置' : '未配置'}</dd></div><div><dt>文件总数</dt><dd>${Number(totals?.total || 0)}</dd></div><div><dt>待同步</dt><dd>${Number(totals?.pending || 0)}</dd></div></dl><div class="record-actions">${[['migrate','迁移一批图片'],['archive','归档一批数据'],['repair','重试同步']].map(([action,label])=>`<form method="post" action="/admin/storage/${action}"><button class="button button-secondary" type="submit">${label}</button></form>`).join('')}</div></section><section class="panel"><h3>归档文件</h3>${rows.map(row=>`<details><summary>${esc(row.category)} · ${esc(formatMelbourneDateTime(row.created_at))} · ${row.oci_ready && row.r2_ready ? '已同步' : '待同步'}</summary><form method="post" action="/admin/storage/${encodeURIComponent(row.id)}/download"><label class="form-label">查看用途</label><input class="form-control" name="purpose" maxlength="200" required><button class="button button-secondary" type="submit">下载归档</button></form></details>`).join('') || '<p class="empty-state">暂无归档文件</p>'}</section>`
  return buildLayout('对象存储',body,user)
}
