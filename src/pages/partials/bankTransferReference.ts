/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

import { escapeHtml } from '../../lib/html'

export function renderBankTransferReference(code: string): string {
  return `<p><strong>转账备注码</strong>：<strong class="mono" data-bank-transfer-reference>${escapeHtml(code)}</strong></p><p class="form-text">请在银行转账备注中填写此码。</p>`
}
