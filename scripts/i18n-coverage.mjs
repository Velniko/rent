#!/usr/bin/env node
/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

// i18n 覆盖率扫描
// -----------------------------------------------------------------------------
// 站点是服务端渲染的中文 HTML，英文模式由 src/lib/i18n.ts 里的客户端脚本在
// 浏览器端把文本节点 / 属性 / option / confirm 文案替换成英文。字典一旦缺条目，
// 英文模式就会出现中文残留。这个脚本在 Node 里静态扫描源码，把「可能出现在
// 页面上的中文文案」抽出来，和 src/lib/i18nData.ts 的字典比对，输出：
//   - 中文文案出现频次 Top N
//   - 未被字典覆盖的清单（控制台 + JSON 文件）
//   - 覆盖率与残留率；--strict 时低于阈值则非零退出（供测试 / CI 使用）
//
// 用法：
//   node scripts/i18n-coverage.mjs                 # 控制台报告
//   node scripts/i18n-coverage.mjs --json out.json # 同时写 JSON
//   node scripts/i18n-coverage.mjs --strict        # 低于阈值非零退出
//   node scripts/i18n-coverage.mjs --top 60        # Top N（默认 40）
//   node scripts/i18n-coverage.mjs --missing 80    # 打印未覆盖条数（默认 40）
//
// 阈值（与 tests/i18nCoverage.test.ts 共用同一份定义）：
//   short  = 不含换行、按字符计长度 ≤ 12 的纯中文短文本 → 覆盖率 ≥ 98%
//   long   = 其余中文文案（整句 / 长描述）            → 覆盖率 ≥ 95%
//   overall（按出现次数加权）                         → 残留率 < 2%
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, relative, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

export const THRESHOLDS = {
  short: 0.98,
  long: 0.95,
  maxResidue: 0.02,
  // 单个词条被判定为「短文本」的最大字符数（含标点）
  shortMaxLength: 12,
}

const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/

export function hasChinese(value) {
  return CJK.test(String(value || ''))
}

// ---------------------------------------------------------------------------
// 1. 读取字典
// ---------------------------------------------------------------------------
export function loadDictionary() {
  const file = join(ROOT, 'src/lib/i18nData.ts')
  const source = readFileSync(file, 'utf8')
  const entries = new Map()
  const duplicates = []
  const re = /'((?:[^'\\]|\\.)*)'\s*:\s*'((?:[^'\\]|\\.)*)'/g
  // 只解析对象字面量区间（跳过文件头注释里的示例）
  const start = source.indexOf('const common')
  const body = start === -1 ? source : source.slice(start)
  let match
  while ((match = re.exec(body))) {
    const key = unescapeTs(match[1])
    const value = unescapeTs(match[2])
    if (entries.has(key)) duplicates.push(key)
    entries.set(key, value)
  }
  return { entries, duplicates, bytes: Buffer.byteLength(source) }
}

export function unescapeTs(value) {
  return String(value).replace(/\\(['\\n])/g, (_, character) => character === 'n' ? '\n' : character)
}

// ---------------------------------------------------------------------------
// 2. 抽取源码里的中文文案
// ---------------------------------------------------------------------------
// 待扫描文件：页面模板、数据层（邮件 / 通知 / 合同文案）、客户端脚本
export function listSourceFiles() {
  const files = []
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name)
      const stat = statSync(full)
      if (stat.isDirectory()) walk(full)
      else if (/\.(ts|txt)$/.test(name) && !/\.test\.ts$/.test(name)) files.push(full)
    }
  }
  walk(join(ROOT, 'src/pages'))
  files.push(join(ROOT, 'src/site.ts'))
  files.push(join(ROOT, 'src/appClient.js.txt'))
  files.push(join(ROOT, 'src/layout.html'))
  for (const extra of ['src/actions', 'src/domain', 'src/services']) {
    try {
      if (statSync(join(ROOT, extra)).isDirectory()) walk(join(ROOT, extra))
    } catch (_) {}
  }
  return files.filter((file) => {
    try {
      return statSync(file).isFile()
    } catch (_) {
      return false
    }
  })
}

// 从一段字符串里拆出「单独的文本节点 vs 句子碎片」：
//   - 模板字符串 `${...}` 处是动态数据边界，两侧可以单独翻译
//   - HTML 标签位置是节点边界
//   - 空白是边界
//   - 句子标点（。！？；：，）是边界
//   - 标签之间的空白缩进不是边界
const TAG = /<\/?[A-Za-z!][^>]*>/g
// 只按「句子结束」切分，不再按逗号/顿号切：运行期翻译的单位是 DOM 文本节点，
// 也就是模板里的静态片段；按逗号切会造出运行期并不存在的片段。
const PUNCT = /[。！？；]/g

// 内联 <script> 里的可执行 JS 片段不是「文案」，一律丢弃。
const LOOKS_LIKE_CODE = (piece) =>
  // 以运算符、引号、括号、赋值号开头的片段是代码拼接残留，不是独立文案
  /^['"=?:(){}\[\]+|*&<>\/,;]/.test(piece) ||
  // SQL 行注释（`-- 说明`）只出现在 SQL 字符串里，不会渲染
  /^--\s/.test(piece) ||
  // 模板字符串 / 字符串拼接残留：`${...}`、反引号、引号、赋值号、三元问号、竖线
  // 都是代码语法，中文文案里不会出现（全角？和引号不在此列）。
  /\$\{|\$[A-Za-z_]|`|['"=]|\?[^？]|\|/.test(piece) ||
  /=>|\bdocument\.|\bwindow\.|\bgetElementById\b|\bquerySelector(All)?\b|\bfunction\b|\bconst\b|\blet\b|\breturn\b|\bthrow\b|\baddEventListener\b/.test(piece) ||
  // 对象字面量 / 数组 / 三元 / 选项映射表：`: 'xxx'`、`},`、`['a','b']` 之类
  /[:\[\]{}]\s*['"]|['"]\s*,?\s*[\]}]\s*,?$|\?\s*['"]/.test(piece) ||
  // 键值对 / 调用表达式：`foo: 'bar'`、`buildLayout(...)`、`setError(...)`
  /\w+\s*:\s*['"`]|\b\w+\([^()]*['"]/.test(piece)

export function segmentText(raw) {
  let text = String(raw || '')
    .replace(/\\n/g, '\n')
    .replace(/\\'/g, "'")
    .replace(/\\"/g, '"')
    // 去掉 CSS 注释（/* ... */，含多行）、JS 注释（* @param / // 说明）：
    // 它们只出现在 <style> / <script> 里，不会渲染成页面文案。
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\*.*$/gm, ' ')
    .replace(/\/\/.*$/gm, ' ')
    // 内联 <style> 块整体丢弃
    .replace(/<style[^>]*>[\s\S]*?<\/style>/g, ' ')
    // 模板字符串嵌套 / 代码拼接残留：反引号与 `${` 都当作边界
    .replace(/[^\s<>{}='"]*\$\{[^}]*\}/g, '\x00')
    .replace(/`/g, '\x00')
  // 动态部分（模板表达式 / HTML 标签 / 句子标点）切成分隔符，两侧各自成为独立片段
  text = text.replace(TAG, '\x00')
  text = text.replace(PUNCT, '\x00')
  return text
    .split(/[\x00\n\r\t]+/)
    .map((piece) => piece.trim())
    .map((piece) => piece.replace(/^[>\s]+/, '').replace(/[<\s]+$/, ''))
    // 句末残留的代码标识（如 `order.endDate}`、`devices.length}`）去掉，
    // 只保留中文部分，避免把 JS 变量名当成文案
    .map((piece) => piece.split(/\s+/).filter((token) => !/^[A-Za-z_$][\w$.,:;?!&|+\-=[\](){}]*$/.test(token) && !/^[a-z]\w*\??\.\w+/.test(token)).join(' ').trim())
    // 视觉分隔符（`·`、`・`、`|`、`、`）在渲染时与相邻文案处在同一个文本节点里，
    // 运行期按「中文片段」替换，所以这里剥掉首尾分隔符再比对字典。
    .map((piece) => piece.replace(/^[\s·・|、]+/, '').replace(/[\s·・|]+$/, ''))
    .filter((piece) => piece && hasChinese(piece) && !LOOKS_LIKE_CODE(piece))
}

// 从源码里抽取所有字符串字面量（'...' / "..." / `...`），跨行，处理转义。
export function extractStrings(source) {
  const results = []
  let index = 0
  const length = source.length
  let i = 0
  let line = 1
  while (i < length) {
    const char = source[i]
    if (char === '\n') {
      line++
      i++
      continue
    }
    if (char === '/' && source[i + 1] === '/') {
      while (i < length && source[i] !== '\n') i++
      continue
    }
    if (char === '/' && source[i + 1] === '*') {
      i += 2
      while (i < length && !(source[i] === '*' && source[i + 1] === '/')) {
        if (source[i] === '\n') line++
        i++
      }
      i += 2
      continue
    }
    if (char === "'" || char === '"' || char === '`') {
      const quote = char
      const startLine = line
      let value = ''
      i++
      while (i < length && source[i] !== quote) {
        if (source[i] === '\\') {
          value += source[i] + source[i + 1]
          if (source[i + 1] === '\n') line++
          i += 2
          continue
        }
        if (source[i] === '\n') line++
        // 模板字符串内部再出现未转义的反引号 = 嵌套模板（外层模板里拼内层模板），
        // 到这里就结束当前字面量，避免把后面的代码当成文案。
        if (quote === '`' && source[i] === '`') break
        value += source[i]
        i++
      }
      i++
      results.push({ value, line: startLine, index })
      continue
    }
    i++
  }
  return results
}

// 属性上下文分类：placeholder / title / aria-label / value / option / 文本节点
function classifyContext(source, offset) {
  const before = source.slice(Math.max(0, offset - 160), offset)
  const attr = before.match(/(placeholder|title|aria-label|alt|value)\s*=\s*["']?[^"']*$/)
  if (attr) return attr[1]
  const confirm = before.match(/(?:confirm|alert|prompt)\s*\(\s*$/)
  if (confirm) return 'dialog'
  if (/<option[^>]*>\s*$/.test(before)) return 'option'
  if (/<label[^>]*>\s*$/.test(before)) return 'label'
  return 'text'
}

// ---------------------------------------------------------------------------
// 3. 主流程
// ---------------------------------------------------------------------------
export function scan({ silent = false } = {}) {
  const dictionary = loadDictionary()
  const files = listSourceFiles()
  const hits = new Map() // phrase -> { count, files:Set, contexts:Set }
  for (const file of files) {
    const source = readFileSync(file, 'utf8')
    const rel = relative(ROOT, file)
    for (const literal of extractStrings(source)) {
      if (!hasChinese(literal.value)) continue
      const context = classifyContext(source, literal.index)
      for (const phrase of segmentText(literal.value)) {
        const entry = hits.get(phrase) || { count: 0, files: new Set(), contexts: new Set() }
        entry.count++
        entry.files.add(rel)
        entry.contexts.add(context)
        hits.set(phrase, entry)
      }
    }
  }

  // 与 src/lib/i18n.ts 的运行期算法保持一致：先精确匹配整条文案，否则按「字典里较长的
  // 键、且两侧不是中文」做片段替换。这样「5 单待取」这类数字+中文的节点会被判为已覆盖，
  // 而不是要求字典里存在整条「5 单待取」。
  const fragmentKeys = [...dictionary.entries.keys()].filter((key) => key.length >= 2).sort((a, b) => b.length - a.length)
  const translateLikeRuntime = (text) => {
    if (dictionary.entries.has(text)) return dictionary.entries.get(text)
    if (!/[A-Za-z0-9]/.test(text) && /[\u3400-\u9fff]/.test(text)) {
      // 纯中文且未收录：运行期原样保留（但片段替换仍可能命中，全部按片段再试一遍）
    }
    let out = text
    for (const key of fragmentKeys) {
      let offset = 0
      let position
      while ((position = out.indexOf(key, offset)) !== -1) {
        const left = position ? out.charAt(position - 1) : ''
        const right = out.charAt(position + key.length)
        const replacement = dictionary.entries.get(key) || ''
        if (!hasChinese(left) && !hasChinese(right)) {
          out = out.slice(0, position) + replacement + out.slice(position + key.length)
          offset = position + replacement.length
        } else {
          offset = position + key.length
        }
      }
    }
    return out
  }
  const covered = (phrase) => !hasChinese(translateLikeRuntime(phrase))
  const rows = [...hits.entries()]
    .map(([phrase, meta]) => ({ phrase, count: meta.count, files: [...meta.files], contexts: [...meta.contexts], covered: covered(phrase) }))
    .sort((a, b) => b.count - a.count || b.phrase.length - a.phrase.length)

  const isShort = (phrase) => phrase.length <= THRESHOLDS.shortMaxLength && !phrase.includes('\n')
  const stats = { short: { total: 0, covered: 0 }, long: { total: 0, covered: 0 } }
  for (const row of rows) {
    const bucket = isShort(row.phrase) ? stats.short : stats.long
    bucket.total++
    if (row.covered) bucket.covered++
  }
  const total = stats.short.total + stats.long.total
  const totalCovered = stats.short.covered + stats.long.covered
  const shortRate = stats.short.total ? stats.short.covered / stats.short.total : 1
  const longRate = stats.long.total ? stats.long.covered / stats.long.total : 1
  const overallRate = total ? totalCovered / total : 1
  const residueRate = 1 - overallRate

  const missing = rows.filter((row) => !row.covered)

  const report = {
    files: files.length,
    phrases: total,
    dictionary: { entries: dictionary.entries.size, duplicates: dictionary.duplicates, bytes: dictionary.bytes },
    stats,
    shortRate,
    longRate,
    overallRate,
    residueRate,
    top: rows.slice(0, 40),
    missing,
    thresholds: THRESHOLDS,
    pass:
      shortRate >= THRESHOLDS.short &&
      longRate >= THRESHOLDS.long &&
      residueRate < THRESHOLDS.maxResidue,
  }

  if (!silent) printReport(report)
  return report
}

function pct(value) {
  return (value * 100).toFixed(2) + '%'
}

function printReport(report) {
  const out = console.log
  out('i18n coverage report')
  out('====================')
  out(`扫描文件：${report.files} 个；抽取到中文文案：${report.phrases} 条（去重后）`)
  out(`字典条目：${report.dictionary.entries}（重复 key ${report.dictionary.duplicates.length}，${report.dictionary.bytes} 字节）`)
  out('')
  out(`短文本（≤${THRESHOLDS.shortMaxLength} 字）覆盖率：${pct(report.shortRate)}  (${report.stats.short.covered}/${report.stats.short.total})  阈值 ${pct(THRESHOLDS.short)}`)
  out(`长句（>${THRESHOLDS.shortMaxLength} 字）覆盖率：${pct(report.longRate)}  (${report.stats.long.covered}/${report.stats.long.total})  阈值 ${pct(THRESHOLDS.long)}`)
  out(`整体覆盖率：${pct(report.overallRate)}；中文残留率：${pct(report.residueRate)}  阈值 < ${pct(THRESHOLDS.maxResidue)}`)
  out('')
  out('出现频次 Top 20：')
  for (const row of report.top.slice(0, 20)) {
    out(`  ${String(row.count).padStart(5)}  ${row.covered ? '✓' : '✗'}  ${row.phrase.replace(/\n/g, '⏎').slice(0, 70)}`)
  }
  out('')
  out(`未覆盖清单：${report.missing.length} 条（按频次）`)
  const limit = Number(process.env.I18N_MISSING_LIMIT || process.argv.find((arg) => arg.startsWith('--missing='))?.split('=')[1] || 40)
  for (const row of report.missing.slice(0, limit)) {
    out(`  ${String(row.count).padStart(5)}  [${row.contexts.join(',')}]  ${row.phrase.replace(/\n/g, '⏎').slice(0, 90)}`)
  }
  out('')
  out(report.pass ? 'RESULT: PASS' : 'RESULT: FAIL（覆盖率未达阈值）')
}

// ---------------------------------------------------------------------------
// 4. CLI
// ---------------------------------------------------------------------------
function main() {
  const argv = process.argv.slice(2)
  const report = scan()
  const jsonArg = argv.find((arg) => arg.startsWith('--json=') || arg === '--json')
  if (jsonArg) {
    const target = jsonArg.includes('=') ? jsonArg.split('=')[1] : join(ROOT, 'tmp/i18n-coverage.json')
    writeFileSync(target, JSON.stringify(report, null, 2))
    console.log(`JSON 已写入 ${target}`)
  }
  const strict = argv.includes('--strict')
  if (report.dictionary.duplicates.length) {
    console.error(`\n发现重复 key：${report.dictionary.duplicates.join(', ')}`)
    process.exit(1)
  }
  if (strict && !report.pass) process.exit(1)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main()
