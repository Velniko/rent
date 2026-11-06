/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

// 静态资源被打包进 Worker，内容随部署变化。这里用内容指纹给它们的 URL 加版本号，
// 从而可以安全地设置一年期 immutable 缓存：部署后指纹变化即自动 cache-bust，
// 平时浏览器 / CF 边缘完全命中缓存。

import siteStyles from '../styles.css'
import workspaceStyles from '../workspace.css'
import workspaceInnerStyles from '../workspaceInner.css'
import rosterStyles from '../roster.css'
import motionStyles from '../motion.css'
import motionScript from '../client/motion.js.txt'
import clientScript from '../appClient.js.txt'
import { languageScript } from './i18n'
import { minifyCss } from './cssMin'

// 源文件（排版过的样式表），保留给需要检查原文的测试/工具使用。
export const styleSheetSource: string = `${siteStyles}\n${workspaceStyles}\n${workspaceInnerStyles}\n${rosterStyles}\n${motionStyles}`
// /styles.css 实际返回的内容：模块加载时压缩一次，整个 isolate 复用同一个字符串。
// 传输量因此从 ~195KB 降到 ~162KB（见 tests/perfCssMin.test.ts 的体积断言）。
export const styleSheetText: string = minifyCss(styleSheetSource)
// 压缩后样式的 UTF-8 字节数：/styles.css 直接把它写进 Content-Length，
// 不必每次请求重新编码统计。
export const styleSheetByteLength: number = new TextEncoder().encode(styleSheetText).length
const combinedClientScript = `${motionScript}\n${clientScript}`
export const appScriptText: string = combinedClientScript
export const languageScriptText: string = languageScript

// FNV-1a 32-bit —— 快、稳定、无依赖，足够用作缓存版本号。
function fnv1a(input: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(36)
}

// 指纹必须基于「真正返回给浏览器的字节」，否则改压缩规则而源码不变时 URL 不变，
// 一年期 immutable 缓存会把旧内容一直留在浏览器里。
// 加 'css1:' 前缀用于区分「压缩前历史指纹」，升级时强制换一次 URL。
export const styleSheetVersion: string = fnv1a(`css1:${styleSheetText}`)
export const styleSheetHref: string = `/styles.css?v=${styleSheetVersion}`

export const appScriptVersion: string = fnv1a(combinedClientScript)
export const appScriptHref: string = `/app.js?v=${appScriptVersion}`

export const languageScriptVersion: string = fnv1a(languageScript)
export const languageScriptHref: string = `/i18n.js?v=${languageScriptVersion}`
