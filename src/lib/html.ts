/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

import sanitizeHtml from 'sanitize-html'

export function sanitizeRichHtml(value: unknown): string {
  return sanitizeHtml(String(value ?? ''), {
    allowedTags: ['h1', 'h2', 'h3', 'h4', 'p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'ol', 'ul', 'li', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'blockquote', 'a', 'span', 'div', 'hr', 'code', 'pre', 'img'],
    allowedAttributes: { a: ['href', 'target', 'rel'], img: ['src', 'alt'], '*': ['class', 'style'] },
    allowedSchemes: ['http', 'https', 'mailto', 'data'],
    allowedSchemesByTag: { a: ['http', 'https', 'mailto'], img: ['data'] },
    allowedStyles: {
      '*': {
        color: [/^#[0-9a-f]{3,8}$/i, /^rgb\([\d\s,.%]+\)$/i],
        'background-color': [/^#[0-9a-f]{3,8}$/i, /^rgb\([\d\s,.%]+\)$/i],
        'text-align': [/^(left|right|center|justify)$/],
        'font-weight': [/^(normal|bold|[1-9]00)$/],
        width: [/^\d+(\.\d+)?(%|px)$/],
        margin: [/^[\d\s.%px-]+$/], padding: [/^[\d\s.%px-]+$/],
        border: [/^[\d\s.#a-z()-]+$/i], 'border-left': [/^[\d\s.#a-z()-]+$/i], 'border-collapse': [/^(collapse|separate)$/],
        'page-break-after': [/^(always|avoid|auto|left|right)$/],
        'break-after': [/^(auto|avoid|always|page|column|region)$/],
      },
    },
    transformTags: { a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer' }, true) },
  })
}

// 把未被填充的 `${token}` / `{token}` 占位符替换为可读的空位标记。
// 用于把含合同变量的模板（如 rentalTerms）作为「范本」公开展示：读者看到结构，
// 未知字段显示为 —— 而不是花括号变量名。
export function neutralizeTemplateTokens(html: string, placeholder = '<span class="doc-blank">——</span>'): string {
  return String(html ?? '').replace(/\$?\{[a-z0-9_]+\}/gi, placeholder)
}

export function sanitizePlainText(value: unknown, maxLength = 500): string {
  return sanitizeHtml(String(value ?? ''), { allowedTags: [], allowedAttributes: {} })
    .trim()
    .slice(0, maxLength)
}

export function renderNotificationMarkdown(value: unknown): string {
  return sanitizeRichHtml(String(value ?? '').slice(0, 20000))
}

export function renderFlexibleContent(value: unknown, format?: unknown): string {
  return sanitizeRichHtml(String(value ?? '').slice(0, 20000))
}

type EmailShellOptions = {
  title: unknown
  content: string
  companyName?: string
  companyEmail?: string
  themeColor?: string
  eyebrow?: string
  footer: string
  unsubscribeUrl?: string
  logoUrl?: string
}

export function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character] || character))
}

function renderEmailShell(options: EmailShellOptions): string {
  const safeTitle = escapeHtml(sanitizePlainText(options.title, 200))
  const safeCompany = escapeHtml(sanitizePlainText(options.companyName || 'PC Rental', 120))
  const companyEmail = sanitizePlainText(options.companyEmail || '', 200)
  const safeEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(companyEmail) ? escapeHtml(companyEmail) : ''
  const accent = /^#[0-9a-f]{6}$/i.test(String(options.themeColor)) ? String(options.themeColor) : '#f0a35b'
  const eyebrow = escapeHtml(options.eyebrow || '限时优惠')
  const safeLogoUrl = /^https?:\/\//i.test(String(options.logoUrl || '')) ? escapeHtml(String(options.logoUrl).slice(0, 1000)) : ''
  const logo = safeLogoUrl
    ? `<td width="80" align="right" valign="middle" style="width:80px;padding-left:16px;"><img class="brand-logo" src="${safeLogoUrl}" width="72" height="72" alt="${safeCompany} Logo" style="display:block;width:72px;height:72px;border:4px solid #f3f4f6;border-radius:50%;background-color:#ffffff;object-fit:contain;"></td>`
    : ''
  const unsubscribe = options.unsubscribeUrl
    ? `<a href="${options.unsubscribeUrl}" style="color:#9ca3af;text-decoration:underline;">取消订阅</a>`
    : ''
  const contact = safeEmail
    ? `<p style="margin:0 0 14px;color:#6b7280;font-size:12px;line-height:1.6;"><a href="mailto:${safeEmail}" style="color:#6b7280;text-decoration:none;">${safeEmail}</a></p>`
    : ''
  return `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${safeTitle}</title><style>.email-button{display:inline-block;padding:14px 30px;color:#ffffff!important;background-color:${accent};font-size:15px;font-weight:700;line-height:1.4;text-decoration:none;border-radius:7px}@media screen and (max-width:600px){.container{width:100%!important}.content{padding:26px 20px!important}.hero-title{font-size:28px!important}.product-column{display:block!important;width:100%!important;padding:0 0 16px!important}.mobile-button{width:100%!important}.email-button{display:block!important;width:100%!important;box-sizing:border-box!important;text-align:center!important}.brand-logo{width:64px!important;height:64px!important}}</style></head><body style="margin:0;padding:0;background-color:#f3f5f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Microsoft YaHei',Arial,sans-serif;color:#1f2937;"><div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${safeTitle}</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f3f5f8;"><tr><td align="center" style="padding:30px 16px;"><table role="presentation" class="container" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background-color:#ffffff;border-radius:12px;overflow:hidden;"><tr><td style="padding:24px 32px;background-color:#111827;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td valign="middle"><p style="margin:0;color:#ffffff;font-size:20px;font-weight:700;line-height:1.4;">${safeCompany}</p><p style="margin:6px 0 0;color:#d1d5db;font-size:13px;line-height:1.5;">灵活、可靠的电脑设备租赁服务</p></td>${logo}</tr></table></td></tr><tr><td style="background-color:#eef2ff;padding:42px 32px 38px;text-align:center;"><p style="margin:0 0 14px;color:${accent};font-size:14px;font-weight:700;letter-spacing:1px;">${eyebrow}</p><h1 class="hero-title" style="margin:0;color:#111827;font-size:36px;line-height:1.25;font-weight:800;">${safeTitle}</h1></td></tr><tr><td class="content" style="padding:34px 40px 38px;"><div style="font-size:15px;line-height:1.8;color:#4b5563;">${options.content}</div></td></tr><tr><td style="padding:24px 32px;background-color:#f9fafb;border-top:1px solid #f0f1f3;text-align:center;"><p style="margin:0 0 8px;color:#374151;font-size:13px;line-height:1.6;"><strong>${safeCompany}</strong></p>${contact}<p style="margin:0;color:#9ca3af;font-size:11px;line-height:1.6;">您收到这封邮件，是因为您曾使用过或订阅了我们的租赁服务。${unsubscribe ? `<br>${unsubscribe}` : ''}</p></td></tr></table><p style="margin:16px 0 0;color:#9ca3af;font-size:11px;text-align:center;">© ${safeCompany}</p></td></tr></table></body></html>`
}

function renderNotificationEmailShell(options: EmailShellOptions): string {
  const safeTitle = sanitizePlainText(options.title, 200)
  const safeCompany = sanitizePlainText(options.companyName || 'PC Rental', 120)
  const accent = /^#[0-9a-f]{6}$/i.test(String(options.themeColor)) ? String(options.themeColor) : '#2563eb'
  const preheader = escapeHtml(`${safeCompany}：${safeTitle}`)
  return `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${safeTitle}</title><style>@media screen and (max-width:600px){.container{width:100%!important}.content{padding:24px 20px!important}.amount{font-size:30px!important}.mobile-block{display:block!important;width:100%!important}}</style></head><body style="margin:0;padding:0;background-color:#f3f5f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Microsoft YaHei',Arial,sans-serif;color:#1f2937;"><div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${preheader}</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f3f5f8;"><tr><td align="center" style="padding:32px 16px;"><table role="presentation" class="container" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background-color:#ffffff;border-radius:12px;overflow:hidden;"><tr><td style="padding:28px 32px;background-color:#111827;"><p style="margin:0;color:#ffffff;font-size:20px;font-weight:700;line-height:1.4;">${safeCompany}</p><p style="margin:8px 0 0;color:#d1d5db;font-size:13px;line-height:1.5;">电脑设备租赁服务</p></td></tr><tr><td class="content" style="padding:36px 40px 32px;"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td style="padding:7px 12px;background-color:#f8fafc;border:1px solid ${accent};border-radius:999px;"><span style="color:${accent};font-size:13px;font-weight:600;">✓ 账户服务通知</span></td></tr></table><h1 style="margin:20px 0 12px;color:#111827;font-size:26px;line-height:1.35;font-weight:700;">${safeTitle}</h1><div style="font-size:15px;line-height:1.8;color:#4b5563;">${options.content}</div></td></tr><tr><td style="padding:20px 40px 28px;background-color:#f9fafb;border-top:1px solid #f0f1f3;"><p style="margin:0;color:#9ca3af;font-size:12px;line-height:1.7;text-align:center;">${options.footer}</p></td></tr></table><p style="margin:16px 0 0;color:#9ca3af;font-size:11px;line-height:1.5;text-align:center;">© ${safeCompany}</p></td></tr></table></body></html>`
}

export function renderEmailNotificationHtml(title: unknown, content: unknown, companyName = 'PC Rental', themeColor = '#f0a35b', trustedAppendHtml = ''): string {
  const safeCompany = sanitizePlainText(companyName, 120)
  return renderNotificationEmailShell({
    title,
    content: `${renderFlexibleContent(content)}${trustedAppendHtml}`,
    companyName,
    themeColor,
    footer: `${safeCompany}<br>这是一封系统通知邮件，请勿直接回复。`,
  })
}

// Marketing emails are admin-authored (ADMIN role only) and rendered solely by the
// recipient's mail client, not by our own site — so unlike renderNotificationMarkdown's
// narrow allowlist (aimed at user/staff-submitted content shown inside our own pages),
// this only needs to strip actively dangerous content (script execution, event handlers)
// while leaving full layout/styling freedom for real marketing HTML (tables, buttons,
// inline styles, <style> blocks) that the shared allowlist would otherwise mangle.
export function sanitizeMarketingEmailHtml(value: unknown): string {
  return sanitizeHtml(String(value ?? '').slice(0, 20000), {
    allowedTags: false,
    allowedAttributes: false,
    allowedSchemes: ['http', 'https', 'mailto', 'tel', 'data'],
    disallowedTagsMode: 'discard',
    allowVulnerableTags: true, // script/style are dropped or defanged below, not left as-is; this only silences sanitize-html's console warning about them being in the (here: unrestricted) allowedTags set
    exclusiveFilter: (frame) => ['script', 'iframe', 'object', 'embed', 'link', 'meta', 'base', 'form', 'noscript'].includes(frame.tag.toLowerCase()),
    transformTags: {
      '*': (tagName, attribs) => {
        const safe: Record<string, string> = {}
        for (const [key, value] of Object.entries(attribs)) {
          if (/^on/i.test(key)) continue
          if (['href', 'src', 'background', 'action'].includes(key.toLowerCase()) && /^\s*javascript:/i.test(value)) continue
          safe[key] = value
        }
        return { tagName, attribs: safe }
      },
    },
  })
}

export function renderMarketingEmailHtml(title: unknown, content: unknown, companyName = 'PC Rental', themeColor = '#f0a35b', unsubscribeUrl?: string, companyEmail = '', logoUrl = ''): string {
  const messageHtml = sanitizeMarketingEmailHtml(content)
  const safeUnsubscribeUrl = unsubscribeUrl && /^https?:\/\//i.test(unsubscribeUrl) ? escapeHtml(unsubscribeUrl.slice(0, 500)) : ''
  return renderEmailShell({ title, content: messageHtml, companyName, companyEmail, themeColor, eyebrow: '限时优惠', unsubscribeUrl: safeUnsubscribeUrl || undefined, logoUrl, footer: '' })
}

export function renderPlainTextEmailHtml(title: unknown, text: unknown, companyName = 'PC Rental'): string {
  const paragraphs = sanitizePlainText(text, 20000)
    .split(/\n{2,}/)
    .map(paragraph => `<p style="margin:0 0 16px;">${escapeHtml(paragraph).replace(/\n/g, '<br>')}</p>`)
    .join('')
  return renderNotificationEmailShell({
    title,
    content: paragraphs,
    companyName,
    footer: `${sanitizePlainText(companyName, 120)}<br>这是一封系统邮件，请勿直接回复。`,
  })
}

export function createPageBreakHtml(): string {
  return '<div class="page-break" style="page-break-after: always; break-after: page;"></div><p><br></p>'
}
