/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

// scripts/i18n-coverage.mjs 的类型声明。脚本本身是 node 直跑的 .mjs（不需要编译），
// 但 tests/i18nCoverage.test.ts 会 import 它，没有声明文件 tsc 会报 TS7016。

export interface I18nCoverageThresholds {
  /** 纯中文短文本覆盖率阈值（0–1） */
  short: number
  /** 长句覆盖率阈值（0–1） */
  long: number
  /** 允许的最大中文残留率（0–1，按出现次数加权） */
  maxResidue: number
  /** 判定为「短文本」的最大字符数 */
  shortMaxLength: number
}

export interface I18nCoverageRow {
  phrase: string
  count: number
  files: string[]
  contexts: string[]
  covered: boolean
}

export interface I18nCoverageReport {
  files: number
  phrases: number
  dictionary: { entries: number; duplicates: string[]; bytes: number }
  stats: {
    short: { total: number; covered: number }
    long: { total: number; covered: number }
  }
  shortRate: number
  longRate: number
  overallRate: number
  residueRate: number
  top: I18nCoverageRow[]
  missing: I18nCoverageRow[]
  thresholds: I18nCoverageThresholds
  pass: boolean
}

export const ROOT: string
export const THRESHOLDS: I18nCoverageThresholds

export function hasChinese(value: string): boolean
export function unescapeTs(value: string): string
export function loadDictionary(): { entries: Map<string, string>; duplicates: string[]; bytes: number }
export function listSourceFiles(): string[]
export function segmentText(raw: string): string[]
export function extractStrings(source: string): Array<{ value: string; line: number; index: number }>
export function scan(options?: { silent?: boolean }): I18nCoverageReport
