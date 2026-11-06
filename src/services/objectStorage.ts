/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

import type { Context } from 'hono'
import { hasOciStorage, storageBucket, ociRequest, sha256, encryptObject, decryptObject, readBoundedBytes } from '../lib/ociStorage'
import type { ObjectStorageEnv, StorageTier } from '../lib/ociStorage'
import { uploadCloudinaryImage, getCloudinaryRuntimeConfig, type CloudinaryUploadOptions } from '../lib/cloudinary'

export interface StoredObject {
  id: string; object_key: string; category: string; owner_id: string | null
  visibility: 'PUBLIC' | 'OWNER' | 'ADMIN'; storage_tier: StorageTier
  content_type: string; byte_size: number; sha256: string; encrypted: number
  oci_ready: number; r2_ready: number; source_url: string | null
}
export function fileCategory(folder: string): string {
  if (/proof|transfer/.test(folder)) return 'payment-proofs'
  if (/damage|inspection/.test(folder)) return 'inspections'
  if (/c2c|rental-program/.test(folder)) return 'rental-program'
  if (/logo|brand|qr/.test(folder)) return 'branding'
  return 'website-images'
}
export async function storeObject(c: Context, input: { bytes: ArrayBuffer; category: string; contentType: string; ownerId?: string; visibility: StoredObject['visibility']; tier?: StorageTier; sourceUrl?: string }): Promise<StoredObject> {
  const env = c.env as ObjectStorageEnv
  if (!env.STORAGE_BACKUP) throw new Error('R2 对象存储尚未配置')
  if (input.tier === 'ARCHIVE' && !hasOciStorage(env)) throw new Error('甲骨文归档存储尚未配置')
  if (!/^[a-z0-9-]+$/.test(input.category)) throw new Error('文件分类无效')
  const id = crypto.randomUUID(), tier = input.tier || 'STANDARD'
  const encrypted = input.visibility !== 'PUBLIC'
  const bytes = encrypted ? await encryptObject(env, id, input.bytes) : input.bytes
  const key = `${tier.toLowerCase()}/${input.category}/${new Date().toISOString().slice(0, 10).replace(/-/g, '/')}/${id}`
  const hash = await sha256(bytes)
  let ociReady = 0, r2Ready = 0
  try {
    if (!hasOciStorage(env) || (tier === 'STANDARD' && !(encrypted ? env.OCI_PRIVATE_BUCKET : env.OCI_MEDIA_BUCKET))) throw new Error('OCI_REPLICA_DISABLED')
    const result = await ociRequest(env, storageBucket(env, tier, encrypted), key, 'PUT', bytes)
    ociReady = result.ok ? 1 : 0
    await result.body?.cancel()
  } catch { /* R2 retains the durable copy until replication succeeds. */ }
  try {
    await env.STORAGE_BACKUP.put(key, bytes, { httpMetadata: { contentType: 'application/octet-stream' }, customMetadata: { sha256: hash } })
    r2Ready = 1
  } catch { /* A successful OCI write can be repaired into R2 by the scheduled job. */ }
  if (!ociReady && !r2Ready) throw new Error('文件保存失败，请稍后重试')
  const row: StoredObject = { id, object_key: key, category: input.category, owner_id: input.ownerId || null, visibility: input.visibility, storage_tier: tier, content_type: input.contentType, byte_size: input.bytes.byteLength, sha256: hash, encrypted: encrypted ? 1 : 0, oci_ready: ociReady, r2_ready: r2Ready, source_url: input.sourceUrl || null }
  await c.env.RENT.prepare(`INSERT INTO stored_objects (id,object_key,category,owner_id,visibility,storage_tier,content_type,byte_size,sha256,encrypted,oci_ready,r2_ready,source_url) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(row.id,row.object_key,row.category,row.owner_id,row.visibility,row.storage_tier,row.content_type,row.byte_size,row.sha256,row.encrypted,row.oci_ready,row.r2_ready,row.source_url).run()
  return row
}
export async function getStoredObject(c: Context, id: string): Promise<StoredObject | null> {
  return c.env.RENT.prepare('SELECT * FROM stored_objects WHERE id = ? AND deleted_at IS NULL').bind(id).first()
}
async function storedBytes(c: Context, row: StoredObject): Promise<ArrayBuffer> {
  const env = c.env as ObjectStorageEnv
  const fromR2 = async (): Promise<ArrayBuffer | null> => {
    if (!row.r2_ready || !env.STORAGE_BACKUP) return null
    try {
      const backup = await env.STORAGE_BACKUP.get(row.object_key)
      if (!backup) return null
      const bytes = await readBoundedBytes(new Response(backup.body), row.byte_size + 28)
      return await sha256(bytes) === row.sha256 ? bytes : null
    } catch { return null }
  }
  if (row.storage_tier === 'STANDARD') {
    const primary = await fromR2()
    if (primary) return primary
  }
  if (row.oci_ready && hasOciStorage(env)) {
    try {
      const response = await ociRequest(env, storageBucket(env, row.storage_tier, Boolean(row.encrypted)), row.object_key, 'GET')
      if (response.ok) {
        const bytes = await readBoundedBytes(response, row.byte_size + 28)
        if (await sha256(bytes) === row.sha256) return bytes
      } else await response.body?.cancel()
    } catch { /* Use the other durable copy on timeout or integrity failure. */ }
  }
  if (row.storage_tier === 'ARCHIVE') {
    const backup = await fromR2()
    if (backup) return backup
  }
  throw new Error('文件暂时无法读取，请稍后重试')
}
export async function readStoredObject(c: Context, row: StoredObject): Promise<ArrayBuffer> {
  const bytes = await storedBytes(c, row)
  return row.encrypted ? decryptObject(c.env, row.id, bytes) : bytes
}
export async function repairStorageReplicas(c: Context): Promise<number> {
  if (!c.env.STORAGE_BACKUP) return 0
  const rows = (await c.env.RENT.prepare("SELECT * FROM stored_objects WHERE deleted_at IS NULL AND (r2_ready = 0 OR (oci_ready = 0 AND ? = 1 AND (storage_tier = 'ARCHIVE' OR ? = 1))) ORDER BY created_at LIMIT 10").bind(hasOciStorage(c.env) ? 1 : 0, hasOciStorage(c.env) && c.env.OCI_MEDIA_BUCKET && c.env.OCI_PRIVATE_BUCKET ? 1 : 0).all()).results as StoredObject[]
  let repaired = 0
  for (const row of rows) {
    const bytes = await storedBytes(c, row)
    if (!row.oci_ready && hasOciStorage(c.env)) {
      const response = await ociRequest(c.env, storageBucket(c.env, row.storage_tier, Boolean(row.encrypted)), row.object_key, 'PUT', bytes)
      const ok = response.ok; await response.body?.cancel()
      if (!ok) throw new Error('主存储同步失败')
      await c.env.RENT.prepare('UPDATE stored_objects SET oci_ready = 1 WHERE id = ?').bind(row.id).run()
    }
    if (!row.r2_ready) {
      await c.env.STORAGE_BACKUP.put(row.object_key, bytes, { customMetadata: { sha256: row.sha256 } })
      await c.env.RENT.prepare('UPDATE stored_objects SET r2_ready = 1 WHERE id = ?').bind(row.id).run()
    }
    repaired++
  }
  return repaired
}
export function imageFiles(value: unknown): File[] {
  return (Array.isArray(value) ? value : [value]).filter((item): item is File => Boolean(item && typeof item === 'object' && typeof item.arrayBuffer === 'function' && item.size > 0))
}
export async function validateImageFile(file: File): Promise<ArrayBuffer> {
  if (file.size > 5 * 1024 * 1024) throw new Error('单张图片不能超过 5MB')
  const bytes = await file.arrayBuffer(), b = new Uint8Array(bytes)
  const valid = file.type === 'image/jpeg' ? b[0] === 255 && b[1] === 216 && b[2] === 255
    : file.type === 'image/png' ? [137,80,78,71,13,10,26,10].every((v,i) => b[i] === v)
    : file.type === 'image/webp' && new TextDecoder().decode(b.slice(0,4)) === 'RIFF' && new TextDecoder().decode(b.slice(8,12)) === 'WEBP'
  if (!valid) throw new Error('只支持 JPG、PNG 或 WebP 图片')
  return bytes
}
export async function uploadSiteImage(value: unknown, c: Context, folder: string, options: CloudinaryUploadOptions = {}): Promise<string> {
  const files = imageFiles(value)
  if (files.length !== 1) throw new Error('请上传一张图片')
  if (!c.env.STORAGE_BACKUP) return uploadCloudinaryImage(value, await getCloudinaryRuntimeConfig(c), folder, options)
  const file = files[0], category = fileCategory(folder)
  let bytes = await validateImageFile(file)
  let contentType = file.type
  // Preserve the existing incoming watermark transformation for evidence photos.
  // Identity documents never use this public image service.
  if (options.watermark) {
    const watermarked = await uploadCloudinaryImage(file, await getCloudinaryRuntimeConfig(c), folder, options)
    const response = await fetch(watermarked, { redirect: 'error', signal: AbortSignal.timeout(15000) })
    if (!response.ok) throw new Error('图片上传失败，请稍后重试')
    bytes = await readBoundedBytes(response)
    const type = response.headers.get('Content-Type')?.split(';')[0] || file.type
    contentType = type
    await validateImageFile(new File([bytes], 'image', { type }))
  }
  const row = await storeObject(c, { bytes, category, contentType, ownerId: c.get('user')?.id, visibility: ['payment-proofs','inspections'].includes(category) ? 'OWNER' : 'PUBLIC' })
  return new URL(`/media/${row.id}`, c.env.STORAGE_PUBLIC_ORIGIN || c.req.url).href
}
export async function uploadSiteImages(value: unknown, c: Context, folder: string, max = 5, options: CloudinaryUploadOptions = {}): Promise<string[]> {
  const files = imageFiles(value)
  if (files.length > max) throw new Error(`最多上传 ${max} 张图片`)
  const urls: string[] = []
  for (const file of files) urls.push(await uploadSiteImage(file, c, folder, options))
  return urls
}

export async function canReadSiteImage(c: Context, object: StoredObject, user: any): Promise<boolean> {
  if (object.visibility === 'ADMIN') return false
  if (object.visibility === 'PUBLIC') return true
  if (!user) return false
  if (['ADMIN','STAFF'].includes(user.role) || object.owner_id === user.id) return true
  if (user.role !== 'CUSTOMER') return false
  const suffix = '/media/' + object.id
  const linked = await c.env.RENT.prepare(`SELECT p.id FROM payment_proofs p JOIN payments pay ON pay.id = p.payment_id WHERE pay.customer_id = ? AND instr(p.image_url, ?) > 0
    UNION ALL SELECT b.id FROM balance_topups b WHERE b.user_id = ? AND instr(b.proof_image_url, ?) > 0
    UNION ALL SELECT d.id FROM damage_cases d JOIN orders o ON o.id = d.order_id WHERE o.userId = ? AND instr(d.photo_urls, ?) > 0
    UNION ALL SELECT ct.id FROM contracts ct JOIN orders o ON o.id = ct.orderId WHERE o.userId = ? AND instr(ct.contract_data, ?) > 0 LIMIT 1`)
    .bind(user.id,suffix,user.id,suffix,user.id,suffix,user.id,suffix).first()
  return Boolean(linked)
}

export async function resolveImageUrls(fileValue: unknown, legacyUrl: unknown, c: Context, folder: string, maxFiles = 1): Promise<string[]> {
  if (fileValue) {
    const uploaded = await uploadSiteImages(fileValue, c, folder, maxFiles, { watermark: true })
    if (uploaded.length) return uploaded
  }
  if (String(legacyUrl || '').trim()) throw new Error('请直接上传图片，系统会自动添加上传日期和唯一编号水印')
  return []
}
