/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

// 安全边界工具：跳转白名单、请求体上限、表单字段长度、CSP 构建、Cookie 序列化、常量时间比较。
// 集中放在这里而不是 src/index.ts，是为了让 tests/security*.test.ts 能对纯函数做负向测试
// （src/index.ts 有 @ts-nocheck 且加载即注册全部路由，行为测试成本很高）。

/** 允许作为登录后跳转目标的站内路径前缀白名单。 */
const REDIRECT_PREFIXES = [
  '/customer', '/staff', '/admin', '/manager', '/orders', '/contract',
  '/notifications', '/payment', '/rent', '/verify', '/feedback', '/profile',
  '/settings', '/redeem', '/reset-password', '/verify-email', '/sso',
]

function isSafeRelativePath(value: string): boolean {
  if (!value || value.length > 2048) return false
  // 只允许以单个 '/' 开头的站内绝对路径：拒绝协议相对（//evil）、绝对 URL（http:、javascript:）、
  // 反斜杠（浏览器会把 \ 归一化成 /，/\evil.com 等价于 //evil.com）以及任何控制字符/空白。
  if (value[0] !== '/') return false
  if (value[1] === '/' || value[1] === '\\') return false
  if (value.includes('\\')) return false
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f\s]/.test(value)) return false
  const lower = value.toLowerCase()
  if (lower.startsWith('/%2f') || lower.startsWith('/%5c')) return false
  return true
}

/**
 * 把用户可控的 redirect 参数收敛成安全的站内相对路径。
 * 非法输入一律返回 fallback（默认空串，由调用方决定默认落地页）。
 */
export function sanitizeRedirectPath(value: unknown, fallback = ''): string {
  const input = String(value ?? '')
  // 先拒绝控制字符/空白，**再** trim：否则 '/customer\r\n' 会被 trim 成 '/customer' 悄悄放行，
  // 掩盖了携带 CR/LF 的恶意输入（这类值一旦被写回 Set-Cookie / Location 就是响应拆分面）。
  if (/[\u0000-\u001f\u007f]/.test(input)) return fallback
  const raw = input.trim()
  if (!raw) return fallback
  if (raw !== input) return fallback
  if (!isSafeRelativePath(raw)) return fallback
  try {
    // 以任意 base 解析：解析后必须仍然是同源路径，杜绝 /..%2f..、多重编码、#// 等技巧。
    const parsed = new URL(raw, 'https://internal.invalid')
    if (parsed.origin !== 'https://internal.invalid') return fallback
    const resolved = `${parsed.pathname}${parsed.search}${parsed.hash}`
    if (!isSafeRelativePath(resolved)) return fallback
    const pathLower = parsed.pathname.toLowerCase()
    if (!REDIRECT_PREFIXES.some((prefix) => pathLower === prefix || pathLower.startsWith(`${prefix}/`) || pathLower.startsWith(`${prefix}?`))) {
      return fallback
    }
    return resolved
  } catch {
    return fallback
  }
}

/** 请求体上限（字节）。multipart 上传单独放宽，webhook 由支付方决定体积。 */
export const WEBHOOK_BODY_LIMIT_BYTES = 512 * 1024
export const UPLOAD_BODY_LIMIT_BYTES = 6 * 1024 * 1024
export const DEFAULT_BODY_LIMIT_BYTES = 128 * 1024

const UPLOAD_PATH_PATTERNS: RegExp[] = [
  /^\/customer\/identity(?:\/(?:visa|driver-licence|passport|other))?$/,
  /^\/customer\/(?:c2c|rental-program)\/photos$/,
  /^\/contract\/sign$/,
  /^\/customer\/balance\/top-up\/transfer$/,
  /^\/admin\/settings\/upload-image$/,
  /^\/customer\/orders\/[^/]+\/bank-transfer-proof$/,
  /^\/staff\/orders\/[^/]+\/(?:inspection|pickup)$/,
  /^\/admin\/inventory\/[^/]+\/(?:damage|inspection)$/,
  /^\/staff\/inventory\/[^/]+\/(?:damage|inspection)$/,
]

export function isUploadPath(pathname: string, method = 'GET'): boolean {
  return method === 'POST' && UPLOAD_PATH_PATTERNS.some((pattern) => pattern.test(pathname))
}

/** 按路径/方法返回允许的最大请求体字节数。 */
export function maxRequestBodyBytes(pathname: string, method = 'GET'): number {
  if (['/webhooks/stripe', '/webhooks/square', '/webhooks/tally'].includes(pathname)) return WEBHOOK_BODY_LIMIT_BYTES
  if (isUploadPath(pathname, method)) return UPLOAD_BODY_LIMIT_BYTES
  return DEFAULT_BODY_LIMIT_BYTES
}

/**
 * 选择可用的请求体长度：
 * - 有数字 Content-Length 就用它（网关如果做缓冲，这个值就是真实体积）；
 * - 缺少 Content-Length（如 chunked 上传）时，multipart 用 CF 提供的 content-length 头
 *   兜底；再没有就返回 null，由调用方自己缓冲后再量。
 * 旧实现的 `Number(header || 0)` 一旦遇到缺失或非数字头就退化成 0，等于完全绕过上限。
 */
export function resolveContentLength(rawHeader: string | null | undefined): number | null {
  // 注意 Number('') === 0：空串必须当成「没有声明长度」，否则又会退化成 0 字节上限。
  const raw = String(rawHeader ?? '').trim()
  if (!/^\d+$/.test(raw)) return null
  const parsed = Number(raw)
  return Number.isSafeInteger(parsed) ? parsed : null
}

/** 单个表单文本字段的最大长度。超出直接拒绝，避免超长文本写库 / 撑爆内存。 */
export const MAX_FORM_FIELD_LENGTH = 64 * 1024
/** 单个请求允许的表单字段总数。 */
export const MAX_FORM_FIELD_COUNT = 200

export type FormFieldLimitResult =
  | { ok: true }
  | { ok: false; reason: 'too_many_fields' | 'field_too_long'; field?: string }

/** 校验 parseBody() 之后的文本字段长度与数量。File 字段不计入长度。 */
export function checkFormFieldLimits(form: Record<string, unknown>): FormFieldLimitResult {
  const keys = Object.keys(form)
  if (keys.length > MAX_FORM_FIELD_COUNT) return { ok: false, reason: 'too_many_fields' }
  for (const key of keys) {
    const value = form[key]
    if (typeof value !== 'string') continue
    if (value.length > MAX_FORM_FIELD_LENGTH) return { ok: false, reason: 'field_too_long', field: key }
  }
  return { ok: true }
}

/**
 * 常量时间字符串比较：先比长度再逐字符 XOR，长度不同时也遍历 min(len) 次，
 * 避免「长度不同立刻返回」暴露前缀长度信息。
 */
export function constantTimeEqual(a: unknown, b: unknown): boolean {
  const x = typeof a === 'string' ? a : String(a ?? '')
  const y = typeof b === 'string' ? b : String(b ?? '')
  let diff = x.length ^ y.length
  const length = Math.max(x.length, y.length)
  for (let index = 0; index < length; index++) {
    diff |= (x.charCodeAt(index % (x.length || 1)) || 0) ^ (y.charCodeAt(index % (y.length || 1)) || 0)
  }
  return diff === 0
}

/** Cookie 序列化选项；集中在一处，避免各处手拼字符串时漏属性。 */
export type AuthCookieOptions = { maxAge?: number; secure: boolean }

// 会话 Cookie 名字固定为 session：改名（例如 __Host-session）会让所有已登录用户
// 在部署瞬间掉登录，属于运行时行为变更，不在本次安全加固范围内。遗留建议见
// SECURITY 报告：后续可以平滑迁移到 __Host- 前缀（双重下发 + 双读一段时间后再切换）。
const AUTH_COOKIE_NAME = 'session'

/** 登录 / SSO / 注册 / 改密后重新签发会话 Cookie 的 Set-Cookie 值（属性与旧实现完全一致）。 */
export function serializeAuthCookie(token: string, options: AuthCookieOptions): string {
  const safeToken = /^[A-Za-z0-9_-]+$/.test(String(token ?? '')) ? String(token) : ''
  const maxAge = options.maxAge === undefined ? '' : `; Max-Age=${Math.max(0, Math.floor(Number(options.maxAge) || 0))}`
  return `${AUTH_COOKIE_NAME}=${safeToken}; Path=/; HttpOnly; SameSite=Lax${maxAge}${options.secure ? '; Secure' : ''}`
}

/** 登出 / 注销 / 删除账户时清理会话 Cookie：过期时间 + 属性齐全，确保各种浏览器都能删掉。 */
export function serializeAuthCookieClear(secure: boolean): string[] {
  const expiry = '; Expires=Thu, 01 Jan 1970 00:00:00 GMT'
  const attrs = `Path=/; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`
  return [`${AUTH_COOKIE_NAME}=; ${attrs}${expiry}`]
}

/** 从 Cookie 头里取会话 token（名字保持 session）。 */
export function readAuthTokenFromCookie(cookieHeader: string | null | undefined): string {
  const header = String(cookieHeader ?? '')
  let token = ''
  for (const item of header.split(';')) {
    const [rawName, ...rawValue] = item.trim().split('=')
    if (rawName !== AUTH_COOKIE_NAME) continue
    token = rawValue.join('=')
    break
  }
  return token
}

export const CSP_SCRIPT_HOSTS = [
  'https://cdn.jsdelivr.net',
  'https://challenges.cloudflare.com',
  'https://js.stripe.com',
  'https://tally.so',
  'https://web.squarecdn.com',
  'https://sandbox.web.squarecdn.com',
]

export const CSP_CONNECT_HOSTS = [
  'https://challenges.cloudflare.com',
  'https://api.stripe.com',
  'https://tally.so',
  'https://connect.squareup.com',
  'https://connect.squareupsandbox.com',
]

export const CSP_FRAME_HOSTS = [
  'https://challenges.cloudflare.com',
  'https://js.stripe.com',
  'https://hooks.stripe.com',
  'https://tally.so',
]

export const CSP_FORM_ACTION_HOSTS = ['https://app.squareup.com']

export type CspOptions = { nonce?: string }

/**
 * 构建 Content-Security-Policy。
 *
 * 关于 'unsafe-inline'：页面里还有大量内联 <script>（layout 注入的引导脚本、
 * 各页面的交互脚本），全部改成 nonce/external 属于跨模块大改造，回归风险高于收益。
 * 因此这里保留 script-src 'unsafe-inline'，但：
 *   1) 绝不出现 'unsafe-eval'（tests/securityHeaders.test.ts 断言）；
 *   2) 其余指令保持严格：object-src 'none'、base-uri 'self'、frame-ancestors 'none'、
 *      form-action 白名单，default-src 'self'；
 *   3) 提供 nonce 选项：一旦所有内联脚本都带上 nonce，调用方传 nonce 即自动切换为
 *      'nonce-...' + 'strict-dynamic'，可以原地去掉 'unsafe-inline'。
 */
export function buildContentSecurityPolicy(options: CspOptions = {}): string {
  const scriptHosts = CSP_SCRIPT_HOSTS.join(' ')
  const scriptSrc = options.nonce
    ? `script-src 'self' 'nonce-${options.nonce}' 'strict-dynamic' https: http:`
    : `script-src 'self' 'unsafe-inline' ${scriptHosts}`
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    scriptSrc,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: https:",
    `connect-src 'self' ${CSP_CONNECT_HOSTS.join(' ')}`,
    `frame-src ${CSP_FRAME_HOSTS.join(' ')}`,
    "frame-ancestors 'none'",
    `form-action 'self' ${CSP_FORM_ACTION_HOSTS.join(' ')}`,
    "worker-src 'self'",
  ].join('; ')
}
