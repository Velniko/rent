/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

import type { Context } from 'hono'
import type { Order } from '../../db/types'
import { buildLayout, formatCurrency, formatMelbourneDateTime } from '../../site'
import { escapeHtml as esc } from '../../lib/html'
import { canEditManualOrder, manualOrderStatuses } from '../../domain/manualOrders'

export async function renderAdminManualOrder(c: Context, user: any, order: Order | null = null, error = '', submitted?: Record<string, unknown>) {
  const editable = !order || canEditManualOrder(order)
  const values: Record<string, any> = submitted || (order ? { ...order, rentalAmount: Math.max(0, Number(order.totalAmount) - Number(order.depositAmount)) } : {})
  const [devices, customers, history] = await Promise.all([
    c.env.RENT.prepare("SELECT id, name, serialNumber, status, pricePerDay, depositAmount FROM devices WHERE deleted_at IS NULL AND (status IN ('available', 'rented', 'reserved') OR id = ?) ORDER BY name").bind(String(values.deviceId || '')).all(),
    c.env.RENT.prepare("SELECT id, name, email FROM users WHERE role = 'CUSTOMER' AND (COALESCE(status, 'active') != 'inactive' OR id = ?) ORDER BY name").bind(String(values.userId || '')).all(),
    order ? c.env.RENT.prepare("SELECT a.before_json, a.after_json, a.created_at, u.name AS actor_name FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id WHERE a.target_type = 'ORDER' AND a.target_id = ? AND a.action IN ('MANUAL_ORDER_CREATED', 'MANUAL_ORDER_UPDATED') ORDER BY a.created_at DESC LIMIT 20").bind(order.id).all() : Promise.resolve({ results: [] }),
  ])
  const field = (name: string, label: string, type = 'text', extra = '') => `<div class="form-group"><label class="form-label" for="manual-${name}">${label}（选填）</label><input class="form-control" id="manual-${name}" name="${name}" type="${type}" value="${esc(values[name] ?? '')}" ${extra}></div>`
  const deviceRows = devices.results as any[], customerRows = customers.results as any[]
  const paymentLabels: Record<string, string> = { card: '信用卡', bank_transfer: '银行转账', balance: '账户余额' }
  const body = `<div class="page-header"><div><h2>${order ? `手动订单 ${esc(order.orderNo || order.id)}` : '手动添加订单'}</h2><p>仅设备为必填项。</p></div><a class="button button-secondary" href="/admin/orders">返回订单列表</a></div>
    ${error ? `<div data-flash-notice class="page-notification page-notification--error" role="alert">${esc(error)}</div>` : ''}
    ${order ? `<div class="panel"><span class="badge badge-info">手动订单</span> <strong>${esc(manualOrderStatuses[order.status] || order.status)}</strong><p>租金 ${formatCurrency(Number(order.totalAmount) - Number(order.depositAmount))} · 押金 ${formatCurrency(order.depositAmount)}</p></div>` : ''}
    <div class="panel">${!editable ? '<p class="alert">订单已结束，不能再修改。</p>' : ''}<form method="POST" action="${order ? `/admin/orders/${encodeURIComponent(order.id)}/edit` : '/admin/orders/new'}">
      <fieldset ${editable ? '' : 'disabled'} style="border:0;padding:0;margin:0"><div class="grid grid-2">
        <div class="form-group"><label class="form-label" for="manual-deviceId">设备（必填）</label><select class="form-control" id="manual-deviceId" name="deviceId" required><option value="">请选择设备</option>${deviceRows.map(device => `<option value="${esc(device.id)}" data-price="${Number(device.pricePerDay) || 0}" data-deposit="${Number(device.depositAmount) || 0}" ${values.deviceId === device.id ? 'selected' : ''}>${esc(device.name)}${device.serialNumber ? ` · ${esc(device.serialNumber)}` : ''}</option>`).join('')}</select></div>
        <div class="form-group"><label class="form-label" for="manual-userId">关联客户（选填）</label><select class="form-control" id="manual-userId" name="userId"><option value="">暂不关联客户</option>${customerRows.map(customer => `<option value="${esc(customer.id)}" ${values.userId === customer.id ? 'selected' : ''}>${esc(customer.name)} · ${esc(customer.email)}</option>`).join('')}</select></div>
        ${field('startDate', '起租日期', 'date')}${field('endDate', '归还日期', 'date')}
        <div class="form-group"><label class="form-label" for="manual-startPeriod">取货时段（填写起租日期后必填）</label><select class="form-control" id="manual-startPeriod" name="startPeriod"><option value="AM" ${values.startPeriod !== 'PM' ? 'selected' : ''}>00:00–12:59</option><option value="PM" ${values.startPeriod === 'PM' ? 'selected' : ''}>13:00–23:59</option></select></div>
        <div class="form-group"><label class="form-label" for="manual-endPeriod">归还时段（填写归还日期后必填）</label><select class="form-control" id="manual-endPeriod" name="endPeriod"><option value="AM" ${values.endPeriod !== 'PM' ? 'selected' : ''}>00:00–12:59</option><option value="PM" ${values.endPeriod === 'PM' ? 'selected' : ''}>13:00–23:59</option></select></div>
        <div class="form-group"><label class="form-label" for="manual-rentalAmount">租金（AUD）（选填）</label><input class="form-control" id="manual-rentalAmount" name="rentalAmount" type="number" value="${esc(values.rentalAmount ?? '')}" min="0" max="99999999.99" step="0.01"><small class="form-text" id="manual-rental-suggest" hidden></small></div>${field('depositAmount', '押金（AUD）', 'number', 'min="0" max="99999999.99" step="0.01"')}
        ${field('pickupLocation', '取货地点', 'text', 'maxlength="300"')}${field('returnLocation', '归还地点', 'text', 'maxlength="300"')}
        <div class="form-group"><label class="form-label" for="manual-paymentMethod">付款方式（选填）</label><select class="form-control" id="manual-paymentMethod" name="paymentMethod"><option value="">暂不填写</option>${Object.entries(paymentLabels).map(([value, label]) => `<option value="${value}" ${values.paymentMethod === value ? 'selected' : ''}>${label}</option>`).join('')}</select></div>
      </div><div class="form-group"><label class="form-label" for="manual-rentalNote">备注（选填）</label><textarea class="form-control" id="manual-rentalNote" name="rentalNote" maxlength="2000" rows="4">${esc(values.rentalNote || '')}</textarea></div>
      ${editable ? `<button type="submit" class="button button-primary">${order ? '保存修改' : '创建订单'}</button>` : ''}</fieldset></form></div>
    ${(history.results || []).length ? `<div class="panel"><h3>操作记录</h3><ul>${(history.results as any[]).map(entry => `<li>${esc(formatMelbourneDateTime(entry.created_at))} · ${esc(entry.actor_name || '管理员')} · ${entry.before_json ? '修改订单' : '创建订单'}</li>`).join('')}</ul></div>` : ''}
    <script>(function () {
      var device = document.getElementById('manual-deviceId')
      var start = document.getElementById('manual-startDate')
      var end = document.getElementById('manual-endDate')
      var amount = document.getElementById('manual-rentalAmount')
      var hint = document.getElementById('manual-rental-suggest')
      if (!device || !start || !end || !amount || !hint) return
      function rentalDays() {
        var s = start.value, e = end.value
        if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || !/^\d{4}-\d{2}-\d{2}$/.test(e)) return 0
        var diff = Math.round((Date.parse(e) - Date.parse(s)) / 86400000)
        return diff > 0 ? diff : 0
      }
      function sync() {
        var option = device.options[device.selectedIndex]
        var price = option ? Number(option.getAttribute('data-price') || 0) : 0
        var days = rentalDays()
        if (!price || !days) { hint.hidden = true; hint.textContent = ''; return }
        var total = Math.round(price * days * 100) / 100
        hint.hidden = false
        hint.textContent = '按日租金 ' + price + ' × ' + days + ' 天 ≈ AUD ' + total.toFixed(2) + ' '
        var apply = document.createElement('button')
        apply.type = 'button'
        apply.className = 'link-button'
        apply.textContent = '填入'
        apply.addEventListener('click', function () { amount.value = total.toFixed(2) })
        hint.appendChild(apply)
      }
      device.addEventListener('change', sync)
      start.addEventListener('change', sync)
      end.addEventListener('change', sync)
      sync()
    })();</script>`
  return buildLayout(`${order ? '手动订单详情' : '手动添加订单'} - 电脑租赁管理系统`, body, user)
}
