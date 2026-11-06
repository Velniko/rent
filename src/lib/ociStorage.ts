/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

export interface ObjectStorageEnv {
  OCI_NAMESPACE?: string
  OCI_REGION?: string
  OCI_MEDIA_BUCKET?: string
  OCI_PRIVATE_BUCKET?: string
  OCI_ARCHIVE_BUCKET?: string
  OCI_ACCESS_KEY_ID?: string
  OCI_SECRET_ACCESS_KEY?: string
  STORAGE_ENCRYPTION_KEY?: string
  STORAGE_BACKUP?: R2Bucket
}
export type StorageTier = 'STANDARD' | 'ARCHIVE'
const encoder = new TextEncoder()
export const hex = (value: ArrayBuffer) => Array.from(new Uint8Array(value), byte => byte.toString(16).padStart(2, '0')).join('')
export async function sha256(value: ArrayBuffer | string): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', typeof value === 'string' ? encoder.encode(value) : value))
}
async function hmac(key: string | ArrayBuffer, value: string): Promise<ArrayBuffer> {
  const imported = await crypto.subtle.importKey('raw', typeof key === 'string' ? encoder.encode(key) : key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return crypto.subtle.sign('HMAC', imported, encoder.encode(value))
}
const encode = (value: string) => encodeURIComponent(value).replace(/[!'()*]/g, char => '%' + char.charCodeAt(0).toString(16).toUpperCase())
export function hasOciStorage(env: ObjectStorageEnv): boolean {
  return Boolean(env.OCI_NAMESPACE && env.OCI_REGION && env.OCI_ARCHIVE_BUCKET && env.OCI_ACCESS_KEY_ID && env.OCI_SECRET_ACCESS_KEY)
}
export function storageBucket(env: ObjectStorageEnv, tier: StorageTier, privateObject: boolean): string {
  const bucket = tier === 'ARCHIVE' ? env.OCI_ARCHIVE_BUCKET : privateObject ? env.OCI_PRIVATE_BUCKET : env.OCI_MEDIA_BUCKET
  if (!bucket) throw new Error('对象存储尚未配置')
  return bucket
}
// Path-style SigV4, with no presigned or public bucket URLs returned to a browser.
export async function signOciRequest(env: ObjectStorageEnv, bucket: string, key: string, method: string, body?: ArrayBuffer, query = '', now = new Date()): Promise<Request> {
  if (!hasOciStorage(env)) throw new Error('对象存储尚未配置')
  if (!/^[a-zA-Z0-9_-]+$/.test(env.OCI_NAMESPACE!) || !/^[a-z0-9-]+$/.test(env.OCI_REGION!)) throw new Error('对象存储配置无效')
  const host = `${env.OCI_NAMESPACE}.compat.objectstorage.${env.OCI_REGION}.oraclecloud.com`
  const path = '/' + [bucket, ...key.split('/')].map(encode).join('/')
  const date = now.toISOString().replace(/[:-]|\.\d{3}/g, '')
  const payloadHash = await sha256(body || new ArrayBuffer(0))
  const headers = new Headers({ 'x-amz-date': date, 'x-amz-content-sha256': payloadHash })
  const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${date}\n`
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date'
  const canonicalQuery = [...new URLSearchParams(query)].map(([k, v]) => [encode(k), encode(v)]).sort((a,b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1])).map(pair => pair.join('=')).join('&')
  const canonical = [method, path, canonicalQuery, canonicalHeaders, signedHeaders, payloadHash].join('\n')
  const scope = `${date.slice(0, 8)}/${env.OCI_REGION}/s3/aws4_request`
  let signingKey = await hmac('AWS4' + env.OCI_SECRET_ACCESS_KEY, date.slice(0, 8))
  for (const part of [env.OCI_REGION!, 's3', 'aws4_request']) signingKey = await hmac(signingKey, part)
  const signature = hex(await hmac(signingKey, `AWS4-HMAC-SHA256\n${date}\n${scope}\n${await sha256(canonical)}`))
  headers.set('Authorization', `AWS4-HMAC-SHA256 Credential=${env.OCI_ACCESS_KEY_ID}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`)
  return new Request(`https://${host}${path}${canonicalQuery ? '?' + canonicalQuery : ''}`, { method, headers, ...(body ? { body } : {}) , redirect: 'error', signal: AbortSignal.timeout(20000) })
}
export async function ociRequest(env: ObjectStorageEnv, bucket: string, key: string, method: string, body?: ArrayBuffer, query = ''): Promise<Response> {
  return fetch(await signOciRequest(env, bucket, key, method, body, query))
}
export async function encryptObject(env: ObjectStorageEnv, id: string, bytes: ArrayBuffer): Promise<ArrayBuffer> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(id) }, await objectKey(env), bytes)
  const output = new Uint8Array(12 + encrypted.byteLength)
  output.set(iv); output.set(new Uint8Array(encrypted), 12)
  return output.buffer
}
export async function decryptObject(env: ObjectStorageEnv, id: string, bytes: ArrayBuffer): Promise<ArrayBuffer> {
  if (bytes.byteLength < 28) throw new Error('文件校验失败')
  return crypto.subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(bytes.slice(0, 12)), additionalData: encoder.encode(id) }, await objectKey(env), bytes.slice(12))
}
async function objectKey(env: ObjectStorageEnv): Promise<CryptoKey> {
  if (!env.STORAGE_ENCRYPTION_KEY || env.STORAGE_ENCRYPTION_KEY.length < 32) throw new Error('尚未配置文件加密密钥')
  return crypto.subtle.importKey('raw', await crypto.subtle.digest('SHA-256', encoder.encode('rent-files-v1:' + env.STORAGE_ENCRYPTION_KEY)), 'AES-GCM', false, ['encrypt', 'decrypt'])
}
export async function readBoundedBytes(response: Response, max = 5 * 1024 * 1024): Promise<ArrayBuffer> {
  if (!response.body) throw new Error('文件读取失败')
  if (Number(response.headers.get('Content-Length')) > max) { await response.body.cancel(); throw new Error('文件过大') }
  const reader = response.body.getReader(), chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.length
      if (size > max) throw new Error('文件过大')
      chunks.push(value)
    }
  } catch (error) { await reader.cancel(); throw error }
  const output = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length }
  return output.buffer
}
