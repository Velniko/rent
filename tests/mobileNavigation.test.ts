/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { URL } from 'node:url'
import { runInNewContext } from 'node:vm'
import { buildLayout } from '../src/site'
import { languageScriptHref } from '../src/lib/assetVersion'

const client = readFileSync(new URL('../src/appClient.js.txt', import.meta.url), 'utf8')
const start = client.indexOf('    // 使用浏览器导航：')
const end = client.indexOf("    document.addEventListener('DOMContentLoaded'", start)
const navigation = client.slice(start, end)

function runNavigation(path: string, hrefs: string[][]) {
  const groups = hrefs.map(group => group.map(href => {
    const attributes = new Map([['href', href], ['class', 'active'], ['aria-current', 'page']])
    return {
      href: new URL(href, 'https://rent.example').href,
      // 内容不参与高亮切换，图标与标签都应保留。
      innerHTML: '<span class="nav-icon"><svg></svg></span><small>导航</small>',
      getAttribute: (key: string) => attributes.get(key),
      setAttribute: (key: string, value: string) => attributes.set(key, value),
      removeAttribute: (key: string) => attributes.delete(key),
      classList: { add: () => attributes.set('class', 'active'), remove: () => attributes.delete('class') },
      closest: () => null,
    }
  }))
  runInNewContext(navigation, {
    URL,
    window: { location: { href: 'https://rent.example' + path } },
    document: { querySelectorAll: () => groups.map(links => ({ querySelectorAll: () => links })) },
  })
  return groups.map(links => links.filter(link => link.getAttribute('aria-current') === 'page').map(link => {
    assert.match(link.innerHTML, /<svg>/)
    return link.getAttribute('href')
  }))
}

test('mobile tabs select only the most specific destination on first load', () => {
  const hrefs = ['/staff/mobile', '/staff/mobile/pickup', '/staff/mobile/return']
  assert.deepEqual(runNavigation('/staff/mobile/pickup/order-1?source=scan', [hrefs, hrefs]), [['/staff/mobile/pickup'], ['/staff/mobile/pickup']])
  assert.deepEqual(runNavigation('/staff/mobile/today', [hrefs]), [['/staff/mobile']])
  assert.deepEqual(runNavigation('/staff/mobile-other', [hrefs]), [[]])
})

test('guest upgrade and query-specific sidebar links do not select their parent tab', () => {
  assert.deepEqual(runNavigation('/customer/guest/upgrade', [['/customer/guest', '/customer/guest/upgrade']]), [['/customer/guest/upgrade']])
  const links = ['/staff/contracts', '/staff/contracts?status=pending_sign']
  assert.deepEqual(runNavigation('/staff/contracts?status=signed', [links]), [['/staff/contracts']])
  assert.deepEqual(runNavigation('/staff/contracts?status=pending_sign', [links]), [['/staff/contracts?status=pending_sign']])
})

test('first paint has no script-dependent curtain and the language preload reuses the script URL', () => {
  const html = buildLayout('测试', '<p>测试</p>')
  assert.doesNotMatch(html, /class="[^"]*initial-load-curtain/)
  assert.ok(html.includes(`rel="preload" href="${languageScriptHref}"`))
  assert.ok(html.includes(`src="${languageScriptHref}"`))
  assert.doesNotMatch(client, /X-Site-Navigation|pageCache|DOMParser/)
  new Function(client)
})
