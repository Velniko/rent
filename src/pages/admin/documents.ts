/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

import type { Context } from 'hono'
import { buildLayout, formatCurrency, formatMelbourneDateTime } from '../../site'
import { escapeHtml as esc } from '../../lib/html'
import { renderPager } from '../../lib/pagination'
import { DOCUMENT_TYPES, documentPath, documentStatus, getBusinessDocument, listBusinessDocuments } from '../../services/documents'

const documentAmount = (value: number, currency: string) => currency === 'AUD' ? formatCurrency(value) : `${currency} ${Number(value).toFixed(2)}`

export async function renderAdminDocuments(c: Context, user: any) {
  const query = String(c.req.query('q') || '').trim().slice(0, 80)
  const type = String(c.req.query('type') || '')
  const { documents, meta } = await listBusinessDocuments(c, query, type, c.req.query('page'))
  const options = Object.entries(DOCUMENT_TYPES).map(([value, label]) => `<option value="${value}"${value === type ? ' selected' : ''}>${label}</option>`).join('')
  const rows = documents.map(doc => `<tr><td>${esc(DOCUMENT_TYPES[doc.kind])}</td><td class="mono"><a href="${documentPath(doc)}">${esc(doc.number)}</a></td><td><a href="/admin/orders/${encodeURIComponent(doc.order_id)}">${esc(doc.orderNo || doc.order_id)}</a></td><td>${esc(doc.customerName || '—')}</td><td>${doc.amount === null ? '—' : esc(documentAmount(doc.amount, doc.currency))}</td><td>${esc(documentStatus(doc.displayStatus))}</td><td>${esc(formatMelbourneDateTime(doc.created_at))}</td><td><a class="button button-sm button-secondary" href="${documentPath(doc)}">查看单据</a></td></tr>`).join('')
  const search = new URLSearchParams({ ...(query ? { q: query } : {}), ...(DOCUMENT_TYPES[type] ? { type } : {}) }).toString()
  return buildLayout('单据中心', `<div class="panel"><div class="section-title"><h2>单据中心</h2><span class="section-note">共 ${meta.total} 条</span></div><form method="get" action="/admin/documents" class="form-grid"><div class="form-group"><label class="form-label" for="documentQuery">单号、订单号、客户或交易号</label><input class="form-control" type="search" id="documentQuery" name="q" maxlength="80" value="${esc(query)}"></div><div class="form-group"><label class="form-label" for="documentType">单据类型</label><select class="form-control" id="documentType" name="type"><option value="">全部类型</option>${options}</select></div><div class="record-actions"><button class="button button-primary" type="submit">搜索</button><a class="button button-secondary" href="/admin/documents">重置</a></div></form><div class="table-wrapper"><table><thead><tr><th>类型</th><th>单号</th><th>订单</th><th>客户</th><th>金额</th><th>状态</th><th>时间</th><th>操作</th></tr></thead><tbody>${rows || '<tr><td colspan="8" class="empty-state">暂无匹配单据</td></tr>'}</tbody></table></div>${renderPager(meta, { basePath: '/admin/documents', search })}</div>`, user)
}

export async function renderAdminDocument(c: Context, user: any, kind: string, id: string): Promise<string | null> {
  const result = await getBusinessDocument(c, kind, id)
  if (!result) return null
  const { document: doc, record } = result
  const fields: Array<[string, string, boolean?]> = kind === 'settlement' ? [
    ['deposit_amount', '押金金额', true], ['refund_amount', '退还金额', true], ['deduction_amount', '扣款金额', true],
    ['deduction_category', '扣款类别'], ['deduction_reason', '扣款原因'], ['refund_method', '退款方式'],
    ['requested_by', '提交人'], ['requested_at', '提交时间'], ['reviewed_by', '审批人'], ['reviewed_at', '审批时间'],
    ['review_note', '审批备注'], ['executed_by', '执行人'], ['executed_at', '执行时间'],
  ] : [
    ['rental_amount', '租金', true], ['deposit_amount', '押金金额', true], ['processing_fee', '手续费', true],
    ['refund_amount', '退还金额', true], ['deduction_amount', '扣款金额', true], ['deduction_reason', '扣款原因'],
    ['payment_method', '付款方式'], ['refund_method', '退款方式'], ['paid_at', '付款时间'],
    ['stripe_payment_intent_id', 'Stripe 交易号'], ['stripe_refund_id', 'Stripe 退款号'], ['description', '备注'],
  ]
  const labels: Record<string, string> = { original: '原路退回', stripe: 'Stripe 原路退回', balance: '账户余额', bank_transfer: '银行转账', card: '信用卡', cash: '现金', DAMAGE: '损坏', MISSING_ACCESSORY: '配件缺失', LATE_FEE: '逾期费用', DEVICE_NOT_RETURNED: '设备未归还', OTHER: '其他' }
  const details = fields.filter(([key]) => record[key] !== null && record[key] !== undefined && record[key] !== '').map(([key, label, money]) => {
    const value = money ? documentAmount(Number(record[key]), doc.currency) : key.endsWith('_at') ? formatMelbourneDateTime(String(record[key])) : labels[String(record[key])] || String(record[key])
    return `<tr><th>${label}</th><td>${esc(value)}</td></tr>`
  }).join('')
  const sourceLink = ['invoice', 'receipt', 'credit_note'].includes(kind)
    ? `<a class="button button-primary" href="/orders/${encodeURIComponent(doc.order_id)}/invoice">查看发票 / 收据</a>`
    : kind === 'contract' ? `<a class="button button-primary" href="/contract/view/${encodeURIComponent(doc.id)}?from=order">查看合同</a>` : ''
  return buildLayout(DOCUMENT_TYPES[kind], `<div class="panel"><div class="section-title"><div><h2>${DOCUMENT_TYPES[kind]}</h2><p class="mono">${esc(doc.number)}</p></div><span class="badge">${esc(documentStatus(doc.displayStatus))}</span></div><div class="record-actions">${sourceLink}<a class="button button-secondary" href="/admin/orders/${encodeURIComponent(doc.order_id)}">查看订单</a><a class="button button-secondary" href="/admin/documents">返回单据中心</a></div><div class="table-wrapper"><table><tbody><tr><th>订单</th><td>${esc(doc.orderNo || doc.order_id)}</td></tr><tr><th>客户</th><td>${esc(doc.customerName || '—')} · ${esc(doc.customerEmail || '')}</td></tr>${doc.amount !== null ? `<tr><th>金额</th><td>${esc(documentAmount(doc.amount, doc.currency))}</td></tr>` : ''}<tr><th>时间</th><td>${esc(formatMelbourneDateTime(doc.created_at))}</td></tr>${details}</tbody></table></div></div>`, user)
}
