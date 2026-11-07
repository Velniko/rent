/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

import { buildLayout, getOrderById, getUserById, getDeviceById, formatCurrency, formatMelbourneDateTime, getContractByOrderId, ensureContractForOrder, getCustomerRiskAssessment, systemSettings, isContractExpired, diffOrderSnapshots, ORDER_CHANGE_TYPE_LABELS, formatOrderChangeActor, reconcileOrderPayments } from '../../site'
import { renderOrderPickupAction, renderOrderReturnAction } from '../partials/orderFulfillmentActions'
import { isPreInspectionComplete } from '../../lib/inspection'
import { renderReconciliationPanel } from '../partials/reconciliationPanel'
import type { Context } from 'hono'
import { renderOrderOperations } from '../../services/returnOperations'
import { canStaffReadRosterOrder } from '../../services/roster'
import { getDeliveryBookingsForOrder, safeDeliveryTrackingUrl } from '../../services/deliveryViews'
import { deliveryStatusInfo } from '../../deliveryStatus'
import { renderPickupPreparation } from '../partials/pickupPreparation'
import { renderPickupAwareOrderStatusBadge } from '../partials/orderStatusBadge'

const esc = (value: unknown) => String(value ?? '—').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')

export async function renderStaffOrderDetail(c: Context, user: any, orderId: string, message?: string, type: 'success' | 'error' = 'error') {
  const order = await getOrderById(c, orderId)
  if (!order) {
    return buildLayout('订单详情 - 电脑租赁管理系统', '<div class="panel"><h2>订单未找到</h2><p>您请求的订单不存在。</p></div>', user)
  }
  const customer = await getUserById(c, order.userId)
  if (user.role !== 'ADMIN' && customer?.staffId !== user.id && !await canStaffReadRosterOrder(c,user,order.id)) {
    return buildLayout('无权查看订单', '<div class="panel"><h2>无权查看订单</h2></div>', user)
  }
  const deliveryBookings = await getDeliveryBookingsForOrder(c, order.id)
  const [device, existingContract, timeChanges, changeHistory] = await Promise.all([getDeviceById(c, order.deviceId), getContractByOrderId(c, order.id), c.env.RENT.prepare('SELECT * FROM order_time_change_history WHERE order_id = ? ORDER BY created_at DESC LIMIT 10').bind(order.id).all(), c.env.RENT.prepare('SELECT h.change_type, h.before_json, h.after_json, h.reason, h.changed_by, h.created_at, u.name AS changed_by_name FROM order_change_history h LEFT JOIN users u ON u.id = h.changed_by WHERE h.order_id = ? ORDER BY h.created_at DESC LIMIT 20').bind(order.id).all()])
  const risk = !existingContract && order.status === 'approved' && customer?.role === 'CUSTOMER' ? await getCustomerRiskAssessment(c, customer.id) : null
  if (risk?.blocked) return buildLayout('订单风控限制 - 电脑租赁管理系统', `<div class="panel"><h2>订单存在风控限制</h2><p>客户风险分 ${risk.score}/100，员工不能为该客户创建合同。请由管理员完成风控处理后再继续。</p></div>`, user)
  const contract = existingContract || (order.is_manual !== 1 && order.status === 'approved' ? await ensureContractForOrder(c, order, user.id) : null)
  const preRentalPending = !['cancelled', 'completed'].includes(String(order.status)) && !order.handover_completed_at
  const preInspection = preRentalPending
    ? await c.env.RENT.prepare("SELECT id, snapshot_json FROM device_inspections WHERE deleted_at IS NULL AND rental_id = ? AND inspection_type = 'before_rental' ORDER BY created_at DESC LIMIT 1").bind(order.id).first() as any
    : null
  let preInspectionSnapshot: Record<string, any> = {}
  try { preInspectionSnapshot = JSON.parse(preInspection?.snapshot_json || '{}') } catch (_) { }
  const preInspectionDone = !preRentalPending || isPreInspectionComplete(preInspectionSnapshot)
  const preInspectionAction = !preRentalPending ? '' : preInspectionDone
    ? `<a class="button button-secondary" href="/inspection/view/${preInspection.id}">查看验机报告</a>`
    : `<a class="button button-primary" href="/staff/orders/${order.id}/pre-inspection">填写出租前验机</a>`
  const returnInspection = order.return_received_at ? await c.env.RENT.prepare("SELECT id FROM device_inspections WHERE deleted_at IS NULL AND rental_id = ? AND inspection_type = 'after_return' ORDER BY created_at DESC LIMIT 1").bind(order.id).first() as any : null
  const returnInspectionAction = returnInspection ? `<a class="button button-secondary" href="/inspection/view/${returnInspection.id}">查看归还验机报告</a>` : ''
  const [reconciliation, paymentSources, refundRows] = await Promise.all([
    reconcileOrderPayments(c, order.id),
    c.env.RENT.prepare("SELECT id, payment_method, payment_provider, amount, status, processing_fee, stripe_payment_intent_id FROM payments WHERE rental_id = ? ORDER BY created_at").bind(order.id).all().then((r: any) => (r.results || []) as any[]),
    c.env.RENT.prepare("SELECT id, payment_id, type, refund_amount, refund_method, status, created_at FROM payment_refunds WHERE order_id = ? ORDER BY created_at").bind(order.id).all().then((r: any) => (r.results || []) as any[]),
  ])
  const cardAuthorization = order.deposit_payment_mode === 'PREAUTH' && order.deposit_status === 'HELD'
    ? paymentSources.find((payment: any) => payment.stripe_payment_intent_id === order.stripe_deposit_payment_intent_id && payment.status === 'pending') : null
  const contractExpired = contract ? isContractExpired(contract) : false
  const alertMessage = message ? `<div data-flash-notice class="page-notification page-notification--${type}">${message}</div>` : ''
  // 从订单列表带过来的 back 参数（searchTerm/page…）白名单回填，用于「返回列表」。
  const rawBack = String(c.req?.query?.('back') || '')
  const backParams = new URLSearchParams(rawBack)
  const safeBack = new URLSearchParams()
  if (backParams.get('searchTerm')) safeBack.set('searchTerm', String(backParams.get('searchTerm')).slice(0, 120))
  for (const key of ['page', 'perPage']) { const value = backParams.get(key); if (value && /^\d{1,6}$/.test(value)) safeBack.set(key, value) }
  // 纵深防御：safeBack 只由 URLSearchParams 序列化（全 ASCII、特殊字符已百分号编码），
  // 再断言一次不含 scheme/双斜杠/控制字符，确保拼进 href 后仍是本站 query，不会变成开放重定向。
  const backQueryText = safeBack.toString()
  const backSuffix = backQueryText && !/^(?:[a-z][a-z0-9+.-]*:|\/\/)|[\u0000-\u001f\u007f]/i.test(backQueryText) ? `?${backQueryText}` : ''

  const body = `
    <div class="panel order-detail-shell staff-order-detail">
      <div class="section-title order-detail-hero__row">
        <div>
          <h2>${order.orderNo ? `订单详情 #${order.orderNo}` : '订单详情'}</h2>
          ${order.orderNo ? `<p class="order-detail-hero__meta">${esc(customer?.name || '未知客户')} · ${esc(device?.name || '未知设备')}</p>` : '<span class="section-note">订单编号将在付款确认后生成。</span>'}
        </div>
        <div class="order-detail-hero__status">
          <a class="button button-secondary" href="/staff/orders${backSuffix}">返回订单列表</a>
        </div>
      </div>
      ${alertMessage}
      <div class="order-detail-grid">
        <div class="order-info-card">
          <h3>订单信息</h3>
          <p><strong>订单状态:</strong> ${renderPickupAwareOrderStatusBadge(order, contract)}</p>
          <p><strong>下单时间:</strong> ${esc(formatMelbourneDateTime(order.createdAt || order.orderDate)) || '—'}</p>
          <p><strong>租期:</strong> ${order.startDate} 至 ${order.endDate}</p>
          <p><strong>总金额:</strong> ${formatCurrency(order.totalAmount)}</p>
          <p><strong>押金:</strong> ${formatCurrency(order.depositAmount)}</p>
          <p><strong>租金:</strong> ${formatCurrency(order.totalAmount - order.depositAmount)}</p>
          ${cardAuthorization ? `<p><strong>Stripe 支付手续费:</strong> ${formatCurrency(Number(cardAuthorization.processing_fee || 0))}</p><p><strong>信用卡预授权总额:</strong> ${formatCurrency(Number(cardAuthorization.amount))}</p>` : ''}
          <p><strong>客户:</strong> ${customer?.name ?? '未知'} (${customer?.email ?? ''})</p>
          <p><strong>设备:</strong> ${device?.name ?? '未知'} (${device?.serialNumber ?? ''})</p>
        </div>
        <div class="order-info-card order-actions-card">
          <h3>操作</h3>
          ${renderPickupPreparation(order, contract, c.req?.query?.('pickupReady'))}
          ${user.role === 'ADMIN' && order.status === 'pending_approval' ? `
            <form method="POST" action="/staff/orders/${order.id}/approve" class="order-approval-form" style="margin-bottom: 10px;" data-site-confirm="批准后订单将进入待付款/待取货流程，并通知客户。" data-confirm-title="批准订单？" data-confirm-label="批准订单">
              <label class="form-label" for="order-delivery-method">交付方式</label>
              <select id="order-delivery-method" name="deliveryMethod" class="form-control"><option value="Pickup" ${String(order.deliveryMethod || 'Pickup') === 'Delivery' ? '' : 'selected'}>客户自取</option><option value="Delivery" ${String(order.deliveryMethod || 'Pickup') === 'Delivery' ? 'selected' : ''}>送货上门</option></select>
              <div id="order-delivery-fee-field" ${String(order.deliveryMethod || 'Pickup') === 'Delivery' ? '' : 'hidden'}><label class="form-label" for="order-delivery-fee">配送费（AUD）</label><input id="order-delivery-fee" name="deliveryFee" class="form-control" type="number" min="0" step="0.01" value="${Number(order.deliveryFee || 0).toFixed(2)}" ${String(order.deliveryMethod || 'Pickup') === 'Delivery' ? 'required' : 'disabled'} placeholder="请输入配送费"></div>
              <button class="button button-primary" type="submit">批准订单</button>
            </form>
            <form method="POST" action="/staff/orders/${order.id}/reject" data-site-confirm="拒绝后订单取消，客户会收到通知。" data-confirm-variant="danger" data-confirm-title="拒绝订单？" data-confirm-label="拒绝订单">
              <button class="button button-danger" type="submit">拒绝订单</button>
            </form>
          ` : ''}
          ${order.status === 'pending_payment' ? `
            <p class="alert">银行转账需管理员审核后确认付款。</p>
          ` : ''}
          ${preInspectionAction}
          ${(['paid', 'pending_pickup'].includes(String(order.status)) || (order.status === 'approved' && contract?.status === 'signed')) ? renderOrderPickupAction(order, preInspectionDone) : ''}
          ${user.role === 'ADMIN' && order.status === 'active' && order.early_return_requested_at ? `<div class="alert">客户已申请提前归还，等待审批。<form method="post" action="/staff/orders/${order.id}/early-return/approve" style="display:inline;margin-left:12px" data-site-confirm="确认批准客户提前归还吗？"><button class="button button-sm button-warning" type="submit">批准提前归还</button></form></div>` : ''}
          ${['active', 'extended', 'overdue'].includes(String(order.status)) ? `<form method="POST" action="/staff/orders/${order.id}/suspend" data-site-confirm="暂停后客户将无法继续使用设备，原因会随通知发送给客户。" data-confirm-title="暂停租赁？" data-confirm-label="暂停租赁"><label class="form-label" for="suspend-reason">暂停原因（必填，将随通知发送给客户）</label><input class="form-control" id="suspend-reason" name="reason" maxlength="300" required placeholder="例如：设备无货 / 客户申请"><button class="button button-warning" type="submit" style="margin-top:8px">暂停租赁</button><small class="form-text">仅绑定该客户的员工或管理员可操作。</small></form>` : ''}
          ${['active', 'extended', 'overdue', 'suspended', 'pending_return'].includes(String(order.status)) ? `
            ${renderOrderReturnAction(order)}
          ` : ''}
          ${returnInspectionAction}
          ${['paid', 'active', 'completed', 'pending_return'].includes(String(order.status)) ? `<a class="button button-secondary" href="/orders/${order.id}/invoice">查看发票 / 收据</a>` : ''}
          ${user.role === 'ADMIN' && (order.status === 'active' || order.status === 'paid') ? `
            <form method="POST" action="/staff/orders/${order.id}/cancel" data-site-confirm="取消后订单终止，设备释放并通知客户。" data-confirm-variant="danger" data-confirm-title="取消订单？" data-confirm-label="取消订单">
              <label class="form-label" for="cancel-reason">取消原因（必填，将随通知发送给客户）</label>
              <input class="form-control" id="cancel-reason" name="reason" maxlength="300" required placeholder="例如：设备无货 / 订单金额错误">
              <button class="button button-danger" type="submit" style="margin-top:8px">取消订单</button>
            </form>
          ` : ''}
        </div>
      </div>

      ${deliveryBookings.length ? `<div class="panel" style="margin-top:20px"><div class="section-title"><div><h3>配送状态</h3></div></div>${deliveryBookings.map((booking: any) => { const info = deliveryStatusInfo(booking.status); const trackingUrl = safeDeliveryTrackingUrl(booking.trackingUrl); return `<div class="delivery-status-row"><div><strong>${booking.direction === 'return' ? '回收' : '派送'}：${esc(info.label)}</strong><p class="section-note">${esc(info.description)}</p>${booking.providerReference ? `<small class="section-note">配送编号：${esc(booking.providerReference)}</small>` : ''}${info.special ? '<small class="delivery-lock-note">该状态下不能更新或取消配送订单。</small>' : ''}</div>${trackingUrl ? `<a class="button button-secondary" href="${esc(trackingUrl)}" target="_blank" rel="noopener noreferrer">查看追踪链接</a>` : ''}</div>` }).join('')}</div>` : ''}

      ${timeChanges?.results?.length ? `<div class="panel" style="margin-top:20px;"><h3>预约时间变更记录</h3>${timeChanges.results.map((change: any) => `<p>${formatMelbourneDateTime(change.created_at)}：${change.previous_pickup_slot || '未设置'} / ${change.previous_return_slot || '未设置'} → ${change.pickup_slot} / ${change.return_slot}${Number(change.additional_service_fee) > 0 ? `，新增服务费 ${formatCurrency(change.additional_service_fee)}` : ''}</p>`).join('')}</div>` : ''}

      ${changeHistory?.results?.length ? `<section class="panel" style="margin-top:20px"><div class="section-title"><h3>订单修改历史</h3><span class="section-note">最近 ${changeHistory.results.length} 条，只读。</span></div><div class="table-wrapper"><table><thead><tr><th>时间</th><th>类型</th><th>变更内容</th><th>原因</th><th>操作人</th></tr></thead><tbody>${changeHistory.results.map((item: any) => {
        let before: any = {}; let after: any = {}
        try { before = JSON.parse(item.before_json || '{}') } catch (_) {}
        try { after = JSON.parse(item.after_json || '{}') } catch (_) {}
        const diffs = diffOrderSnapshots(before, after)
        const detail = diffs.length ? diffs.map(d => `<div>${esc(d.label)}：<span class="mono">${esc(String(d.before ?? '—'))}</span> → <strong class="mono">${esc(String(d.after ?? '—'))}</strong></div>`).join('') : '—'
        return `<tr><td class="mono">${esc(formatMelbourneDateTime(item.created_at))}</td><td>${esc(ORDER_CHANGE_TYPE_LABELS[item.change_type] || item.change_type)}</td><td>${detail}</td><td>${esc(item.reason || '—')}</td><td>${esc(formatOrderChangeActor(item.changed_by_name, item.changed_by))}</td></tr>`
      }).join('')}</tbody></table></div></section>` : ''}

      ${renderReconciliationPanel({ reconciliation, paymentSources, refundRows }, { readOnly: true, margin: '20px 0 0' })}

      ${contract ? `
        <div class="section-title order-section-heading" style="margin-top: 24px;"><h3>合同详情 #${contract.contractNumber || '待生成'}</h3></div>
        <div class="contract-detail-meta"><span><small>合同状态</small><strong>${contract.status === 'signed' || contract.status === 'completed' ? '已签署' : contract.status === 'pending_sign' ? '待签署' : contract.status}</strong></span><span><small>签署时间（墨尔本）</small><strong>${formatMelbourneDateTime(contract.signedAt) || '尚未签署'}</strong></span><span><small>有效期</small><strong>${contract.validFrom || order.startDate} 至 ${contract.validUntil || order.endDate}</strong></span></div>
        <div class="contract-actions" style="margin-bottom: 16px; display: flex; gap: 12px;">
          ${contract.status === 'signed' ? `<a class="button" href="/contract/view/${contract.id}?from=order" target="_blank">查看/下载合同</a>` : contract.status === 'pending_sign' ? `<a class="button button-primary" href="/contract/sign?token=${encodeURIComponent(contract.signToken || '')}&step=1" target="_blank">打开签约链接</a>` : '<span class="section-note">正式合同将在客户完成签署后开放。</span>'}
          ${contractExpired ? '<span class="badge badge-danger">已过期</span>' : contract.status === 'signed' ? `<span class="badge badge-success">已签署</span>` : `<span class="badge badge-warning">${contract.status === 'pending_sign' ? '待签署' : '草稿'}</span>`}
        </div>
      ` : '<p style="margin-top: 24px;">暂无相关租赁合同。</p>'}

      ${order.status === 'pending_payment' ? `
        <div class="section-title" style="margin-top: 24px;"><h3>支付信息</h3></div>
        <div class="payment-options" style="display: flex; gap: 20px; margin-top: 16px;">
          ${order.paymentMethod === 'bank_transfer' ? `<div class="payment-card">
            <h4>银行转账</h4>
            <p><strong>银行名称:</strong> ${systemSettings.bankDetails.bankName || '—'}</p>
            <p><strong>BSB:</strong> ${systemSettings.bankDetails.bsb}</p>
            <p><strong>账号:</strong> ${systemSettings.bankDetails.account}</p>
            <p>客户需转账 ${formatCurrency(order.totalAmount)} 到以上账户。</p>
          </div>` : ''}
          ${['alipay', 'wechat'].includes(String(order.paymentMethod)) ? `<div class="payment-card"><h4>${order.paymentMethod === 'alipay' ? '支付宝' : '微信'}（人民币）</h4><p>客户需扫码支付并提交付款凭证等待审核。</p></div>` : ''}
          ${String(order.paymentProvider || (order as any).payment_provider || '') === 'square' ? (systemSettings.paymentMethods.square ? `<div class="payment-card"><h4>Square 礼品卡支付</h4><p>客户通过 Square 礼品卡付款。</p></div>` : '') : order.paymentMethod === 'card' || !order.paymentMethod ? (systemSettings.paymentMethods.stripe ? `<div class="payment-card"><h4>信用卡支付（Stripe）</h4><p>客户将通过 Stripe 托管结账页付款。</p></div>` : '') : ''}
        </div>
      ` : ''}
    </div>
    <script>(()=>{const form=document.querySelector('.order-approval-form'),method=form?.querySelector('[name="deliveryMethod"]'),fee=form?.querySelector('[name="deliveryFee"]'),field=document.getElementById('order-delivery-fee-field');if(!method||!fee||!field)return;const sync=()=>{const delivery=method.value==='Delivery';field.hidden=!delivery;fee.required=delivery;fee.disabled=!delivery};method.addEventListener('change',sync);sync()})();</script>
  `
  return buildLayout('订单详情 - 电脑租赁管理系统', body + await renderOrderOperations(c,order.id), user)
}
