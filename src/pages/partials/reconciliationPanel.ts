/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

// 「付款与退款对账」面板 —— 管理端 / 员工端订单详情共用。
//
// 分级呈现，避免把「台账待补录」误报成红色账目异常，也避免把「钱还没到账」误报成绿色账目一致：
//   蓝色  待确认付款      有付款仍是 pending，未计入实付，不参与下方一致性检查
//   绿色  账目一致       已确认部分没有任何问题
//   琥珀  账目平衡·待补录  钱能对上，只是缺来源分配行（无害，补录迁移会自愈）
//   红色  账目不一致      拆分不符 / 超退 / 分配错挂，需人工处理
//
// 金额一律走 formatCurrency，问题码显示成小圆角 chip 而非 [CODE] 前缀。

import { formatCurrency, formatMelbourneDateTime } from '../../lib/format'
import type { ReconIssue, ReconResult } from '../../domain/refundAllocation'

const esc = (value: unknown): string =>
  String(value ?? '—').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const CODE_LABELS: Record<string, string> = {
  ALLOCATION_MISMATCH: '拆分不符',
  OVER_REFUND_SOURCE: '来源超退',
  OVER_REFUND_ORDER: '订单超退',
  ORPHAN_REFUND_ALLOCATION: '分配错挂',
  UNALLOCATED_REFUND: '待补分配',
  PENDING_PAYMENT: '待确认付款',
}

const chip = (code: string): string =>
  `<code style="display:inline-block;padding:1px 7px;border-radius:999px;background:rgba(0,0,0,0.06);font-size:0.72rem;letter-spacing:0.02em;vertical-align:middle;margin-right:6px">${esc(CODE_LABELS[code] || code)}</code>`

const issueList = (issues: ReconIssue[], color: string): string =>
  `<ul style="margin:8px 0 0;padding:0;list-style:none;display:grid;gap:6px">${issues
    .map(i => `<li style="display:flex;align-items:baseline;line-height:1.5;color:${color}">${chip(i.code)}<span>${esc(i.detail)}</span></li>`)
    .join('')}</ul>`

const card = (bg: string, border: string, text: string, icon: string, title: string, bodyHtml: string): string =>
  `<div style="border:1px solid ${border};background:${bg};color:${text};border-radius:12px;padding:14px 16px;margin-bottom:16px">
    <div style="display:flex;align-items:center;gap:8px;font-weight:600">
      <span aria-hidden="true" style="font-size:1rem;line-height:1">${icon}</span><span>${esc(title)}</span>
    </div>
    ${bodyHtml}
  </div>`

function statusCard(recon: ReconResult, readOnly: boolean): string {
  const authorizationBlock = recon.authorizedPaymentIds.length
    ? card('#eff6ff', '#bfdbfe', '#1e3a8a', '✓', `已预授权 ${formatCurrency(recon.authorizedTotal)}`, '<p style="margin:6px 0 0;font-size:0.82rem">归还结算时扣款。</p>') : ''
  const pendingBlock = authorizationBlock + (recon.infos.length
    ? card('#eff6ff', '#bfdbfe', '#1e3a8a', '⏳', `${recon.infos.length} 笔付款待确认（合计 ${formatCurrency(recon.pendingTotal)}）`,
        issueList(recon.infos, '#1d4ed8'))
    : '')

  // 已确认金额为 0（只有 pending 付款，还没有任何实付/退款）时，"账目一致"是在夸一个
  // 空集合，跟上面的"待确认"提示放在一起反而像自相矛盾——这种情况只留待确认卡，不画蛇添足。
  const hasConfirmedActivity = recon.paidTotal > 0 || recon.refundedTotal > 0
  if (recon.errors.length === 0 && recon.warnings.length === 0) {
    if (!hasConfirmedActivity && (recon.infos.length || recon.authorizedPaymentIds.length)) return pendingBlock
    return pendingBlock + card('#ecfdf5', '#a7f3d0', '#065f46', '✓', recon.infos.length ? '已确认部分账目一致' : '账目一致',
      '<p style="margin:6px 0 0;font-size:0.85rem;color:#047857">分配合计与实付 / 退款完全相符，无超退。</p>')
  }

  const errorBlock = recon.errors.length
    ? card('#fef2f2', '#fecaca', '#991b1b', '⚠', `发现 ${recon.errors.length} 处账目不一致${readOnly ? '，请通知管理员' : ''}`,
        issueList(recon.errors, '#b91c1c') +
        (recon.warnings.length ? `<p style="margin:10px 0 0;font-size:0.8rem;color:#9a6b00">另有 ${recon.warnings.length} 条台账待补录（见下）。</p>` : ''))
    : ''

  const warnBlock = recon.warnings.length && !recon.errors.length
    ? card('#fffbeb', '#fde68a', '#92400e', 'ℹ', `账目平衡 · ${recon.warnings.length} 条记录待补录`,
        '<p style="margin:6px 0 0;font-size:0.82rem;color:#a16207">钱能对上，只是退款尚未写入来源分配台账。属正常历史数据，运行补录迁移后会自动消除，无需人工干预。</p>' +
        issueList(recon.warnings, '#a16207'))
    : (recon.warnings.length && recon.errors.length
        ? card('#fffbeb', '#fde68a', '#92400e', 'ℹ', `${recon.warnings.length} 条记录待补录`, issueList(recon.warnings, '#a16207'))
        : '')

  return pendingBlock + errorBlock + warnBlock
}

export interface ReconciliationPanelData {
  reconciliation: ReconResult
  paymentSources: any[]
  refundRows: any[]
}

export function renderReconciliationPanel(
  data: ReconciliationPanelData,
  opts: { readOnly?: boolean; margin?: string } = {},
): string {
  const { reconciliation, paymentSources, refundRows } = data
  if (!paymentSources.length && !refundRows.length) return ''
  const readOnly = opts.readOnly === true
  const margin = opts.margin ?? '0 0 24px'

  const paymentTable = `<div class="table-wrapper"><table><thead><tr><th>付款来源</th><th>方式</th><th>金额</th><th>手续费</th><th>状态</th></tr></thead><tbody>${
    paymentSources.map((p: any) => `<tr><td class="mono">${esc(p.id)}</td><td>${esc(p.payment_provider === 'square' ? 'Square 礼品卡' : ({ cash: '现金', card: '信用卡（Stripe）', bank_transfer: '银行转账', balance: '账户余额', alipay: '支付宝', wechat: '微信' } as Record<string, string>)[p.payment_method] || p.payment_method)}</td><td>${formatCurrency(p.amount)}</td><td>${formatCurrency(p.processing_fee || 0)}</td><td>${esc(reconciliation.authorizedPaymentIds.includes(p.id) ? '已预授权' : ({ pending: '待确认', paid: '已扣款', refunded: '已退款', failed: '已失效' } as Record<string, string>)[p.status] || p.status)}</td></tr>`).join('')
      || '<tr><td colspan="5" class="empty-state">无付款记录</td></tr>'
  }</tbody></table></div>`

  const refundTable = refundRows.length
    ? `<div class="table-wrapper" style="margin-top:12px"><table><thead><tr><th>退款单</th><th>对应付款</th><th>类型</th><th>金额</th><th>方式</th><th>状态</th><th>时间</th></tr></thead><tbody>${
        refundRows.map((r: any) => `<tr><td class="mono">${esc(r.id)}</td><td class="mono">${esc(r.payment_id || '—')}</td><td>${esc(r.type)}</td><td>${formatCurrency(r.refund_amount)}</td><td>${esc(r.refund_method || '—')}</td><td>${esc(r.status)}</td><td class="mono">${esc(formatMelbourneDateTime(r.created_at))}</td></tr>`).join('')
      }</tbody></table></div>`
    : ''

  return `<section class="panel" style="margin: ${margin};">
      <div class="section-title"><h3>付款与退款对账</h3><span class="section-note">${readOnly ? '只读 · ' : ''}实付 ${formatCurrency(reconciliation.paidTotal)} · 已退 ${formatCurrency(reconciliation.refundedTotal)}${reconciliation.authorizedTotal > 0 ? ` · 已预授权 ${formatCurrency(reconciliation.authorizedTotal)}` : ''}${reconciliation.pendingTotal > 0 ? ` · 待确认 ${formatCurrency(reconciliation.pendingTotal)}` : ''}</span></div>
      ${statusCard(reconciliation, readOnly)}
      ${paymentTable}
      ${refundTable}
    </section>`
}
