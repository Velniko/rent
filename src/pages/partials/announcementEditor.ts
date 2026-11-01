/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

import { escapeHtml } from '../../lib/html'
import { ANNOUNCEMENT_MAX_LENGTH } from '../../domain/announcement'

export function renderAnnouncementEditor(item: any = {}, prefix = 'announcement'): string {
  return `<div class="grid grid-2 announcement-editor">${[['zh', '中文', 'title', 'message', item.title, item.message], ['en', 'English', 'titleEn', 'messageEn', item.title_en, item.message_en]].map(([lang, label, titleName, messageName, title, message]) => `<section class="announcement-editor__language"><h4>${label}</h4><div class="form-group"><label class="form-label" for="${prefix}-${lang}-title">通告标题</label><input class="form-control" id="${prefix}-${lang}-title" name="${titleName}" value="${escapeHtml(title)}" maxlength="120" required data-i18n-ignore></div><div class="form-group"><label class="form-label" for="${prefix}-${lang}-message">通告内容（支持 HTML）</label><textarea class="form-control announcement-source" id="${prefix}-${lang}-message" name="${messageName}" rows="6" maxlength="${ANNOUNCEMENT_MAX_LENGTH}" wrap="soft" required data-i18n-ignore>${escapeHtml(message)}</textarea></div></section>`).join('')}</div>`
}
