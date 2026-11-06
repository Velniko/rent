/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

import type { Context } from 'hono'
import { hasOciStorage, readBoundedBytes, sha256 } from '../lib/ociStorage'
import { storeObject, validateImageFile, type StoredObject } from './objectStorage'
import { validateHostedImageUrls } from '../lib/hostedImages'
import { createAuditLog } from './audit'

// All identifiers below are code constants, never request data. C2C photo rows
// must change before their listing snapshots to preserve the evidence triggers.
const IMAGE_SOURCES = [
  { table:'c2c_photos', column:'url', category:'rental-program', owner:'owner_id', public:true },
  { table:'c2c_listings', column:'photos_json', category:'rental-program', owner:'owner_id', public:true },
  { table:'balance_topups', column:'proof_image_url', category:'payment-proofs', owner:'user_id', public:false },
  { table:'payment_proofs', column:'image_url', category:'payment-proofs', owner:null, public:false },
  { table:'damage_cases', column:'photo_urls', category:'inspections', owner:null, public:false },
  { table:'contracts', column:'contract_data', category:'inspections', owner:null, public:false },
  { table:'systemSettings', column:'value', category:'branding', owner:null, public:true },
] as const
export function migrationImageUrls(value: string): string[] {
  return [...new Set(value.match(/https:\/\/[^\s"'<>\\]+/g) || [])].filter(url => /\.(?:jpe?g|png|webp)(?:[?#]|$)/i.test(url) || new URL(url).hostname === 'res.cloudinary.com')
}
export function allowedMigrationUrl(c: Context, raw: string): string {
  const url = new URL(validateHostedImageUrls(raw,1)[0])
  const allowed = new Set(['res.cloudinary.com', ...String(c.env.IMAGE_MIGRATION_HOSTS || '').split(',').map(host=>host.trim().toLowerCase()).filter(Boolean)])
  if (!allowed.has(url.hostname) || url.port && url.port !== '443') throw new Error('图片域名尚未加入迁移白名单')
  return url.href
}
export async function migrateLegacyImages(c: Context): Promise<number> {
  if (!c.env.STORAGE_BACKUP || !c.env.STORAGE_PUBLIC_ORIGIN) return 0
  const origin = new URL(String(c.env.STORAGE_PUBLIC_ORIGIN)).origin
  if (!origin.startsWith('https://')) throw new Error('文件访问域名必须使用 HTTPS')
  let moved = 0
  for (const source of IMAGE_SOURCES) {
    const name = `${source.table}.${source.column}`
    const cursor = await c.env.RENT.prepare('SELECT last_rowid FROM storage_migration_cursors WHERE source = ?').bind(name).first() as any
    const rows = (await c.env.RENT.prepare(`SELECT rowid AS source_rowid,${source.column} AS value${source.owner ? ','+source.owner+' AS owner_id' : ''} FROM ${source.table} WHERE rowid > ? ORDER BY rowid LIMIT 5`).bind(cursor?.last_rowid || 0).all()).results as any[]
    for (const row of rows) {
      const value = String(row.value || '')
      // Settings secrets and legal content are excluded. Only configured image values
      // are copied; contract snapshots are limited to the operational damage field.
      let imageValue = value
      if (source.table === 'contracts') {
        try { imageValue = String(JSON.parse(value).damage_photos || '') } catch { imageValue = '' }
      }
      if (source.table === 'systemSettings') {
        const settingsKey = await c.env.RENT.prepare('SELECT key FROM systemSettings WHERE rowid = ?').bind(row.source_rowid).first() as any
        if (!['companyDetails','bankDetails','rmbPayment','paymentMethods','brandAssets','systemSettings','paymentSettings','alipayQrCode','wechatQrCode'].includes(settingsKey?.key)) imageValue = ''
      }
      for (const raw of migrationImageUrls(imageValue)) {
        if (raw.startsWith(new URL('/media/',origin).href)) continue
        const existing = await c.env.RENT.prepare('SELECT * FROM stored_objects WHERE source_url = ?').bind(raw).first() as StoredObject | null
        let object = existing
        if (!object) {
          const url = allowedMigrationUrl(c, raw)
          const response = await fetch(url, { redirect:'error', signal:AbortSignal.timeout(15000) })
          if (!response.ok) throw new Error('历史图片读取失败')
          const type = response.headers.get('Content-Type')?.split(';')[0] || ''
          const bytes = await readBoundedBytes(response)
          await validateImageFile(new File([bytes],'image',{ type }))
          object = await storeObject(c, { bytes, category:source.category, contentType:type, ownerId:row.owner_id, visibility:source.public ? 'PUBLIC' : 'OWNER', sourceUrl:raw })
        }
        const replacement = new URL(`/media/${object.id}`,origin).href
        // Update only this field, preserving unrelated concurrent edits. Linked C2C
        // photo references are updated atomically, before the listing snapshot.
        const targets = source.table === 'c2c_photos' || source.table === 'c2c_listings' ? IMAGE_SOURCES.filter(s=>s.table.startsWith('c2c_')) : [source]
        await c.env.RENT.batch(targets.map(target => c.env.RENT.prepare(`UPDATE ${target.table} SET ${target.column} = replace(${target.column}, ?, ?) WHERE instr(${target.column}, ?) > 0`).bind(raw,replacement,raw)))
        moved++
        if (moved >= 5) return moved // Resume this row on the next bounded run.
      }
      await c.env.RENT.prepare('INSERT INTO storage_migration_cursors (source,last_rowid) VALUES (?,?) ON CONFLICT(source) DO UPDATE SET last_rowid = excluded.last_rowid').bind(name,row.source_rowid).run()
    }
    if (!rows.length) await c.env.RENT.prepare('INSERT INTO storage_migration_cursors (source,last_rowid) VALUES (?,0) ON CONFLICT(source) DO UPDATE SET last_rowid = 0').bind(name).run()
  }
  return moved
}
const ARCHIVE_SOURCES = [
  { table:'orders', where:"s.status IN ('completed','cancelled')", version:'updatedAt', category:'orders' },
  { table:'contracts', where:"EXISTS (SELECT 1 FROM orders o WHERE o.id = s.orderId AND o.status IN ('completed','cancelled'))", version:'updatedAt', category:'contracts' },
  { table:'payments', where:"EXISTS (SELECT 1 FROM orders o WHERE o.id = s.rental_id AND o.status IN ('completed','cancelled'))", version:'updated_at', category:'payments' },
  { table:'invoices', where:"EXISTS (SELECT 1 FROM orders o WHERE o.id = s.order_id AND o.status IN ('completed','cancelled'))", version:'issued_at', category:'invoices' },
  { table:'receipts', where:"EXISTS (SELECT 1 FROM orders o WHERE o.id = s.order_id AND o.status IN ('completed','cancelled'))", version:'issued_at', category:'receipts' },
  { table:'payment_refunds', where:"s.status = 'succeeded' AND EXISTS (SELECT 1 FROM orders o WHERE o.id = s.order_id AND o.status IN ('completed','cancelled'))", version:'created_at', category:'refunds' },
  { table:'financial_ledger_entries', where:"EXISTS (SELECT 1 FROM orders o WHERE o.id = s.order_id AND o.status IN ('completed','cancelled'))", version:'created_at', category:'financial-ledger' },
  { table:'referral_rewards', where:"EXISTS (SELECT 1 FROM data_retention_policies p WHERE p.category = 'REFERRAL_RECORDS' AND p.enabled = 1 AND p.action = 'ARCHIVE' AND s.created_at <= datetime('now', '-' || p.retention_days || ' days'))", version:'created_at', category:'referrals' },
  { table:'coupon_redemptions', where:"EXISTS (SELECT 1 FROM data_retention_policies p WHERE p.category = 'COUPON_RECORDS' AND p.enabled = 1 AND p.action = 'ARCHIVE' AND s.created_at <= datetime('now', '-' || p.retention_days || ' days'))", version:'created_at', category:'coupons' },
] as const
export async function archiveHistoricalData(c: Context): Promise<number> {
  if (!hasOciStorage(c.env) || !c.env.STORAGE_BACKUP) return 0
  let total = 0
  for (const source of ARCHIVE_SOURCES) {
    const rows = (await c.env.RENT.prepare(`SELECT s.* FROM ${source.table} s WHERE ${source.where}
      AND NOT EXISTS (SELECT 1 FROM storage_archive_records a WHERE a.source_table = ? AND a.source_id = s.id AND datetime(a.created_at) >= datetime(s.${source.version})) ORDER BY s.${source.version},s.id LIMIT 5`).bind(source.table).all()).results as any[]
    for (const row of rows) {
      const json = JSON.stringify({ schemaVersion:1, sourceTable:source.table, archivedAt:new Date().toISOString(), record:row })
      const hash = await sha256(JSON.stringify(row))
      const existing = await c.env.RENT.prepare('SELECT object_id FROM storage_archive_records WHERE source_table = ? AND source_id = ? AND content_hash = ?').bind(source.table,row.id,hash).first()
      if (existing) continue
      const object = await storeObject(c, { bytes:new Uint8Array(new TextEncoder().encode(json)).buffer, category:source.category, contentType:'application/json', visibility:'ADMIN', tier:'ARCHIVE' })
      await c.env.RENT.prepare('INSERT OR IGNORE INTO storage_archive_records (source_table,source_id,content_hash,object_id) VALUES (?,?,?,?)').bind(source.table,row.id,hash,object.id).run()
      await createAuditLog(c, { action:'DATA_ARCHIVED',targetType:source.table,targetId:row.id,after:{ objectId:object.id } })
      if (++total >= 5) return total
    }
  }
  return total
}
