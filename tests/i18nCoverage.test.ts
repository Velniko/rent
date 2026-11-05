/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

// 覆盖率门槛测试：直接复用 scripts/i18n-coverage.mjs 的扫描逻辑（纯静态、无网络），
// 字典缺条目时这里会失败 —— 这就是「英文模式不能有中文残留」的护栏。
import test from 'node:test'
import assert from 'node:assert/strict'
// 扫描器是 node 直跑的 .mjs，类型由 scripts/i18n-coverage.d.mts 声明。
import { scan, THRESHOLDS, unescapeTs } from '../scripts/i18n-coverage.mjs'
import type { I18nCoverageReport } from '../scripts/i18n-coverage.mjs'

const report: I18nCoverageReport = scan({ silent: true })

test('dictionary escapes are decoded once without changing literal backslash sequences', () => {
  assert.equal(unescapeTs(String.raw`第一行\n第二行`), '第一行\n第二行')
  assert.equal(unescapeTs(String.raw`用户\'s`), "用户's")
  assert.equal(unescapeTs(String.raw`路径\\new`), String.raw`路径\new`)
  assert.equal(unescapeTs(String.raw`\\\'`), String.raw`\'`)
  assert.equal(unescapeTs(String.raw`保留\t`), String.raw`保留\t`)
})

test('i18n coverage: 纯中文短文本覆盖率 ≥ 98%', () => {
  assert.ok(
    report.shortRate >= THRESHOLDS.short,
    `短文本覆盖率 ${(report.shortRate * 100).toFixed(2)}% 低于阈值 ${(THRESHOLDS.short * 100).toFixed(0)}%\n` +
      `未覆盖示例：${report.missing.slice(0, 15).map((row) => row.phrase).join(' | ')}`,
  )
})

test('i18n coverage: 长句覆盖率 ≥ 95%', () => {
  assert.ok(
    report.longRate >= THRESHOLDS.long,
    `长句覆盖率 ${(report.longRate * 100).toFixed(2)}% 低于阈值 ${(THRESHOLDS.long * 100).toFixed(0)}%\n` +
      `未覆盖示例：${report.missing.slice(0, 15).map((row) => row.phrase).join(' | ')}`,
  )
})

test('i18n coverage: 中文残留率 < 2%', () => {
  assert.ok(
    report.residueRate < THRESHOLDS.maxResidue,
    `中文残留率 ${(report.residueRate * 100).toFixed(2)}% 高于阈值 ${(THRESHOLDS.maxResidue * 100).toFixed(0)}%`,
  )
})

test('i18n coverage: 扫描覆盖面足够（防止扫描器被改窄后测试假绿）', () => {
  // 页面模板 / site.ts / appClient 都在扫描范围内
  assert.ok(report.files >= 100, `扫描文件数 ${report.files}，疑似扫描范围被缩小`)
  // 片段计数下限按「运行期模型」校准：扫描器只按 DOM 文本节点边界（`${}`、HTML 标签）
  // 切分，不再按中文逗号/顿号切，因此总数会比旧实现少（约 2800 条）。
  // 下限仍然要卡住「提取逻辑被破坏」这类事故，所以设 2500。
  assert.ok(report.phrases >= 2500, `抽取中文片段 ${report.phrases} 条，疑似提取逻辑被破坏`)
})
