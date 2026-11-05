/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

// 安全加固的负向测试：所有用例都断言「攻击输入被拒绝」，而不是只断言正常路径可用。

import test from 'node:test'
import assert from 'node:assert/strict'
import { jsonForScript } from '../src/lib/scriptJson'
import {
  DEFAULT_BODY_LIMIT_BYTES,
  MAX_FORM_FIELD_COUNT,
  MAX_FORM_FIELD_LENGTH,
  UPLOAD_BODY_LIMIT_BYTES,
  WEBHOOK_BODY_LIMIT_BYTES,
  buildContentSecurityPolicy,
  checkFormFieldLimits,
  constantTimeEqual,
  isUploadPath,
  maxRequestBodyBytes,
  readAuthTokenFromCookie,
  resolveContentLength,
  sanitizeRedirectPath,
  serializeAuthCookie,
  serializeAuthCookieClear,
} from '../src/lib/security'

test('inline JSON cannot close a script element or enter HTML comment parsing', () => {
  const value = { date: '</ScRiPt ><script>throw new Error("injected")</script>', note: '<!--<script>\u2028\u2029&"' }
  const encoded = jsonForScript(value)
  assert.equal(encoded.includes('<'), false)
  assert.deepEqual(JSON.parse(encoded), value)
  assert.deepEqual(new Function(`return (${encoded})`)(), value)
})

test('open redirect: protocol-relative, backslash and absolute URLs are rejected', () => {
  const attacks = [
    '//evil.example',
    '///evil.example',
    '/\\evil.example',
    '\\\\evil.example',
    '\\/evil.example',
    '/%2f%2fevil.example',
    '/%5cevil.example',
    'http://evil.example',
    'https://evil.example/',
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    ' vbscript:msgbox(1)',
    'https:/evil.example',
    '//evil.example\\@good.example',
    '/\t/customer',
    '/customer\r\nSet-Cookie: session=stolen',
    '/customer\r\n',
    '/customer\u0000',
    '/customer/x\u000b',
    '/customer/x\u001f',
    // CR/LF/空白不能被 trim 掉后当成合法路径放行（否则会掩盖响应拆分面）。
    '  /customer/dashboard',
    '\t/customer/dashboard',
    '/ /evil.example',
    '/%2F%2Fevil.example',
    'customer/dashboard',
    '',
    '/',
  ]
  for (const attack of attacks) assert.equal(sanitizeRedirectPath(attack, ''), '', `should reject ${JSON.stringify(attack)}`)
})

test('open redirect: only same-origin app paths survive, and the value is normalised', () => {
  assert.equal(sanitizeRedirectPath('/customer/dashboard'), '/customer/dashboard')
  assert.equal(sanitizeRedirectPath('/customer/orders/order-1?tab=payments'), '/customer/orders/order-1?tab=payments')
  assert.equal(sanitizeRedirectPath('/staff/orders/abc#top'), '/staff/orders/abc#top')
  assert.equal(sanitizeRedirectPath('/contract/sign?token=t&step=2'), '/contract/sign?token=t&step=2')
  // 编码过的点段会被 URL 归一化成根路径，落地页退化成 fallback 而不是被当成跳转目标。
  assert.equal(sanitizeRedirectPath('/customer/../../etc/passwd'), '')
  // 不在白名单前缀内的站内路径（例如任意静态文件）不参与登录跳转。
  assert.equal(sanitizeRedirectPath('/downloads/RentDeviceAgent.exe'), '')
  assert.equal(sanitizeRedirectPath('/customer/dashboard', '/customer/dashboard'), '/customer/dashboard')
  assert.equal(sanitizeRedirectPath('//evil.example', '/customer/dashboard'), '/customer/dashboard')
})

test('request body limits cover multipart uploads, webhooks and the default form post', () => {
  assert.equal(maxRequestBodyBytes('/customer/orders/o1/bank-transfer-proof', 'POST'), UPLOAD_BODY_LIMIT_BYTES)
  assert.equal(maxRequestBodyBytes('/staff/orders/o1/inspection', 'POST'), UPLOAD_BODY_LIMIT_BYTES)
  assert.equal(maxRequestBodyBytes('/contract/sign', 'POST'), UPLOAD_BODY_LIMIT_BYTES)
  assert.equal(maxRequestBodyBytes('/admin/settings/upload-image', 'POST'), UPLOAD_BODY_LIMIT_BYTES)
  assert.equal(maxRequestBodyBytes('/customer/balance/top-up/transfer', 'POST'), UPLOAD_BODY_LIMIT_BYTES)
  // 同样的路径不是 POST 时按普通请求处理，不能被上传额度放大。
  assert.equal(maxRequestBodyBytes('/contract/sign', 'GET'), DEFAULT_BODY_LIMIT_BYTES)
  assert.equal(maxRequestBodyBytes('/webhooks/stripe', 'POST'), WEBHOOK_BODY_LIMIT_BYTES)
  assert.equal(maxRequestBodyBytes('/webhooks/square', 'POST'), WEBHOOK_BODY_LIMIT_BYTES)
  assert.equal(maxRequestBodyBytes('/login', 'POST'), DEFAULT_BODY_LIMIT_BYTES)
  assert.equal(isUploadPath('/customer/orders/o1/bank-transfer-proof', 'POST'), true)
  assert.equal(isUploadPath('/customer/orders/o1/bank-transfer-proof', 'GET'), false)
  assert.ok(UPLOAD_BODY_LIMIT_BYTES > DEFAULT_BODY_LIMIT_BYTES)
  assert.ok(WEBHOOK_BODY_LIMIT_BYTES >= DEFAULT_BODY_LIMIT_BYTES)
})

test('missing or non-numeric Content-Length no longer degrades to a zero-byte limit', () => {
  assert.equal(resolveContentLength('1024'), 1024)
  assert.equal(resolveContentLength('0'), 0)
  // 这些输入在旧实现里 Number(x || 0) 会得到 0，从而完全绕过上限。
  assert.equal(resolveContentLength(undefined), null)
  assert.equal(resolveContentLength(''), null)
  assert.equal(resolveContentLength('abc'), null)
  assert.equal(resolveContentLength('1048577'), 1048577)
  assert.equal(resolveContentLength('NaN'), null)
  assert.equal(resolveContentLength('-1'), null)
})

test('oversized form fields and too many fields are rejected before hitting D1', () => {
  assert.deepEqual(checkFormFieldLimits({ name: 'ok', note: 'x'.repeat(100) }), { ok: true })
  const tooLong = checkFormFieldLimits({ note: 'x'.repeat(MAX_FORM_FIELD_LENGTH + 1) })
  assert.equal(tooLong.ok, false)
  assert.equal((tooLong as any).field, 'note')
  const manyFields: Record<string, string> = {}
  for (let index = 0; index < MAX_FORM_FIELD_COUNT + 1; index++) manyFields[`field${index}`] = 'v'
  assert.equal(checkFormFieldLimits(manyFields).ok, false)
  // File 对象不受文本长度限制（上传走体积上限）。
  assert.equal(checkFormFieldLimits({ upload: new File(['x'], 'a.png') }).ok, true)
})

test('secret comparison is length-blind and rejects near-miss values', () => {
  assert.equal(constantTimeEqual('token-abc', 'token-abc'), true)
  assert.equal(constantTimeEqual('token-abc', 'token-abd'), false)
  assert.equal(constantTimeEqual('token-abc', 'token-abc '), false)
  assert.equal(constantTimeEqual('', ''), true)
  assert.equal(constantTimeEqual('a', ''), false)
  assert.equal(constantTimeEqual('description', 'd'), false)
  assert.equal(constantTimeEqual(undefined, 'x'), false)
})

test('CSP stays strict: no unsafe-eval, no wildcards for scripts, tight object/base/frame directives', () => {
  const csp = buildContentSecurityPolicy()
  assert.doesNotMatch(csp, /'unsafe-eval'/)
  assert.doesNotMatch(csp, /'unsafe-hashes'/)
  assert.match(csp, /object-src 'none'/)
  assert.match(csp, /base-uri 'self'/)
  assert.match(csp, /frame-ancestors 'none'/)
  assert.match(csp, /default-src 'self'/)
  // form-action 只允许本站与 Square 的托管收银台，不能是 *。
  const formAction = csp.split('; ').find((directive) => directive.startsWith('form-action'))
  assert.ok(formAction)
  assert.doesNotMatch(formAction!, /\*/)
  assert.match(formAction!, /'self' https:\/\/app\.squareup\.com/)
  // script-src 里不允许通配符主机，只允许显式列出的第三方。
  const scriptSrc = csp.split('; ').find((directive) => directive.startsWith('script-src'))
  assert.ok(scriptSrc)
  assert.doesNotMatch(scriptSrc!, /\*/)
  const scriptSources = scriptSrc!.split(/\s+/).slice(1)
  for (const host of ['https://js.stripe.com', 'https://challenges.cloudflare.com', 'https://tally.so']) assert.ok(scriptSources.includes(host))
})

test('CSP can drop unsafe-inline once a nonce is available', () => {
  const csp = buildContentSecurityPolicy({ nonce: 'abc123' })
  const scriptSrc = csp.split('; ').find((directive) => directive.startsWith('script-src'))!
  assert.ok(scriptSrc)
  assert.doesNotMatch(scriptSrc, /'unsafe-inline'/)
  assert.match(csp, /'nonce-abc123'/)
  assert.match(csp, /'strict-dynamic'/)
  assert.doesNotMatch(csp, /'unsafe-eval'/)
})

test('session cookie keeps its name and attributes compatible with existing logins', () => {
  const secure = serializeAuthCookie('tok_123', { maxAge: 600, secure: true })
  // 名字必须仍是 session：改名会让全部已登录用户在部署时掉登录。
  assert.match(secure, /^session=tok_123;/)
  assert.match(secure, /Path=\//)
  assert.match(secure, /HttpOnly/)
  assert.match(secure, /SameSite=Lax/)
  assert.match(secure, /Max-Age=600/)
  assert.match(secure, /Secure/)
  const local = serializeAuthCookie('tok_123', { maxAge: 60, secure: false })
  assert.doesNotMatch(local, /Secure/)
  // 非法 token（含分号 / 换行）不会注入额外 Cookie 属性。
  assert.doesNotMatch(serializeAuthCookie('abc; Domain=evil.example', { secure: true }), /Domain=evil/)
  assert.doesNotMatch(serializeAuthCookie('abc\r\nSet-Cookie: x=1', { secure: true }), /x=1/)
})

test('logout clears the session cookie with matching attributes', () => {
  for (const secure of [true, false]) {
    const clears = serializeAuthCookieClear(secure)
    assert.equal(clears.length, 1)
    assert.match(clears[0], /^session=;/)
    assert.match(clears[0], /Expires=Thu, 01 Jan 1970/)
    assert.match(clears[0], /Path=\//)
    assert.match(clears[0], /HttpOnly/)
    assert.match(clears[0], /SameSite=Lax/)
    assert.equal(/Secure/.test(clears[0]), secure)
  }
})

test('session token reader ignores look-alike cookie names', () => {
  assert.equal(readAuthTokenFromCookie('session=abc'), 'abc')
  assert.equal(readAuthTokenFromCookie('a=1; session=abc; b=2'), 'abc')
  assert.equal(readAuthTokenFromCookie('sessions=evil; session=abc'), 'abc')
  assert.equal(readAuthTokenFromCookie('__Host-session=evil'), '')
  assert.equal(readAuthTokenFromCookie(null), '')
})
