/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

import { sanitizePlainText } from './html'

export const MANUAL_INSPECTION_CHECKS = [
  ['screenCondition', '屏幕', 'screen_condition', 'screen'],
  ['keyboardCondition', '键盘', 'keyboard_condition', 'keyboard'],
  ['trackpadCondition', '触控板', 'trackpad_condition', 'touchpad'],
  ['bodyCondition', '外壳', 'body_condition', 'body'],
  ['cameraCondition', '摄像头', 'camera_condition', 'camera'],
  ['wifiCondition', 'Wi‑Fi', 'wifi_condition', 'wifi'],
  ['powerTest', '开机测试', 'power_test', 'power'],
] as const

const allowed = new Set(['正常', '异常', '未测试'])

export function renderManualInspectionFields(snapshot: Record<string, any> = {}, required = true): string {
  return MANUAL_INSPECTION_CHECKS.map(([input, label, storedKey, shortKey]) => {
    const selected = String(snapshot[storedKey] || snapshot[shortKey] || '未测试')
    return `<div class="form-group"><label class="form-label" for="${input}">${label}</label><select class="form-control" id="${input}" name="${input}"${required ? ' required' : ''}>${['正常', '异常', '未测试'].map(value => `<option value="${value}"${value === selected ? ' selected' : ''}>${value}</option>`).join('')}</select></div>`
  }).join('')
}

export function readManualInspectionFields(form: Record<string, any>, required = true): { checks: Record<string, string>; missing: string[] } {
  const checks: Record<string, string> = {}
  const missing: string[] = []
  for (const [input, label, storedKey, shortKey] of MANUAL_INSPECTION_CHECKS) {
    const value = String(form[input] || '')
    if (!allowed.has(value)) { if (required) missing.push(label); else { checks[storedKey] = '未测试'; checks[shortKey] = '未测试' } }
    else { checks[storedKey] = value; checks[shortKey] = value }
  }
  return { checks, missing }
}

export const PRE_INSPECTION_SOURCE = 'pre_inspection_manual'

export function isPreInspectionComplete(snapshot: Record<string, any> = {}): boolean {
  return snapshot.source === PRE_INSPECTION_SOURCE
}

export function inspectionText(value: unknown, maxLength = 300): string {
  return sanitizePlainText(String(value || ''), maxLength).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
