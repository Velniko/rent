/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

export const IDENTITY_DOCUMENT_KINDS = ['VISA','DRIVER_LICENCE','PASSPORT','OTHER'] as const
export type IdentityDocumentKind = typeof IDENTITY_DOCUMENT_KINDS[number]
export const IDENTITY_DOCUMENT_OPTIONS = [
  { kind:'VISA', slug:'visa', label:'签证', title:'签证认证', upload:'上传签证页', side:'VISA_PAGE' },
  { kind:'DRIVER_LICENCE', slug:'driver-licence', label:'驾照', title:'驾照认证', upload:'上传驾照正面', side:'FRONT' },
  { kind:'PASSPORT', slug:'passport', label:'护照', title:'护照认证', upload:'上传护照资料页', side:'BIO_PAGE' },
  { kind:'OTHER', slug:'other', label:'其他身份证件', title:'其他证件认证', upload:'上传证件正面', side:'FRONT' },
] as const
export function identityDocumentOption(slug: string) { return IDENTITY_DOCUMENT_OPTIONS.find(option=>option.slug===slug) }
export function identityDocumentLabel(doc: { document_kind?: string; document_type?: string }): string {
  return IDENTITY_DOCUMENT_OPTIONS.find(option=>option.kind===(doc.document_kind || (doc.document_type==='VISA'?'VISA':'OTHER')))?.label || '其他身份证件'
}
export interface IdentityRecognition {
  detected_type: IdentityDocumentKind | 'NON_DOCUMENT' | 'UNKNOWN'
  side: 'FRONT' | 'BIO_PAGE' | 'VISA_PAGE' | 'BACK' | 'OTHER' | 'UNKNOWN'
  readable: boolean
  single_document: boolean
  confidence: number
}
export function parseIdentityRecognition(output: unknown): IdentityRecognition {
  let value: unknown = output
  if (typeof value === 'string') {
    if (value.length > 2000) throw new Error('证件识别结果无效，请重新上传')
    try { value = JSON.parse(value) } catch { throw new Error('证件识别结果无效，请重新上传') }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('证件识别结果无效，请重新上传')
  const row = value as Record<string, unknown>
  if (!Object.keys(row).every(key=>['detected_type','side','readable','single_document','confidence'].includes(key)) ||
      ![...IDENTITY_DOCUMENT_KINDS,'NON_DOCUMENT','UNKNOWN'].includes(String(row.detected_type)) ||
      !['FRONT','BIO_PAGE','VISA_PAGE','BACK','OTHER','UNKNOWN'].includes(String(row.side)) ||
      typeof row.readable !== 'boolean' || typeof row.single_document !== 'boolean' ||
      typeof row.confidence !== 'number' || !Number.isFinite(row.confidence) || row.confidence < 0 || row.confidence > 1) throw new Error('证件识别结果无效，请重新上传')
  return { detected_type: row.detected_type as IdentityRecognition['detected_type'], side: row.side as IdentityRecognition['side'], readable: row.readable, single_document:row.single_document, confidence: row.confidence }
}
export function identityRecognitionError(kind: IdentityDocumentKind, result: IdentityRecognition): string | null {
  if (result.detected_type === 'NON_DOCUMENT') return '未识别到身份证件，请重新上传'
  if (!result.single_document) return '请一次上传一份证件'
  if (!result.readable || result.detected_type === 'UNKNOWN' || result.confidence < 0.9) return '证件照片不清晰，请重新拍摄'
  if (result.detected_type !== kind) return '证件类型不符，请上传当前页面要求的证件'
  const option = IDENTITY_DOCUMENT_OPTIONS.find(option=>option.kind===kind)!
  if (result.side !== option.side) return kind === 'PASSPORT' ? '请上传护照资料页' : kind === 'VISA' ? '请上传完整签证页' : '请上传证件正面'
  return null
}
