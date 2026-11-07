/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */
import { renderOrderOperations } from '../../services/returnOperations'


import { buildLayout, getOrderById, getUserById, getDeviceById, getContractByOrderId, ensureContractForOrder, getCustomerRiskAssessment, formatCurrency, formatMelbourneDateTime, validateHostedImageUrls, isContractFinalized, diffOrderSnapshots, ORDER_CHANGE_TYPE_LABELS, formatOrderChangeActor, reconcileOrderPayments } from '../../site';
import { Context } from 'hono'
import { renderRentalDiscounts } from '../partials/rentalDiscounts';
import { renderRentalInstallments } from '../partials/rentalInstallments';
import { renderOrderStatusFeedback } from './orderStatusFeedback';
import { renderReconciliationPanel } from '../partials/reconciliationPanel';
import { isCardDepositSettled, normalizeSecurityDepositMethod, securityDepositMethodLabel } from '../../domain/paymentPlan';
import { getDeliveryBookingsForOrder, safeDeliveryTrackingUrl } from '../../services/deliveryViews'
import { deliveryStatusInfo } from '../../deliveryStatus'
import { renderOrderPickupAction, renderOrderReturnAction } from '../partials/orderFulfillmentActions'

import { renderPickupPreparation } from '../partials/pickupPreparation'
import { isPreInspectionComplete } from '../../lib/inspection'
import { pickupAwareOrderStatusBadge } from '../partials/orderStatusBadge'

function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character] || character))
}

export async function renderAdminOrderDetail(c: Context, user: any, orderId: string) {
  const order = await getOrderById(c, orderId);

  if (!order) {
    return buildLayout('订单详情 - 电脑租赁管理系统', '<div class="panel"><h2>订单未找到</h2><p>您请求的订单不存在。</p></div>', user);
  }
  const deliveryBookings = await getDeliveryBookingsForOrder(c, order.id)

  const [customer, device, existingContract, completedRefund, depositRefundSummary, pendingPriceRefundSummary, transferProof, statusHistory, depositSettlement, changeHistory, swapDevices] = await Promise.all([
    getUserById(c, order.userId), getDeviceById(c, order.deviceId), getContractByOrderId(c, order.id),
    c.env.RENT.prepare("SELECT type, status, refundable_amount, refund_amount, refunded_processing_fee, deduction_amount, deduction_reason, refund_method, refund_bsb, refund_account_number, refund_account_name FROM payment_refunds WHERE order_id = ? ORDER BY created_at DESC LIMIT 1").bind(order.id).first(),
    c.env.RENT.prepare("SELECT COALESCE(SUM(refund_amount), 0) AS refunded_amount FROM payment_refunds WHERE order_id = ? AND type = 'deposit' AND status = 'succeeded'").bind(order.id).first(),
    c.env.RENT.prepare("SELECT COALESCE(SUM(amount), 0) AS amount FROM order_price_adjustments WHERE order_id = ? AND direction = 'decrease' AND status = 'succeeded' AND refund_method = 'pending_deposit' AND deposit_refunded = 0").bind(order.id).first(),
    c.env.RENT.prepare("SELECT pp.*, r.code AS transfer_code, p.payment_method AS proof_payment_method, a.id AS adjustment_id FROM payment_proofs pp JOIN payments p ON p.id = pp.payment_id LEFT JOIN bank_transfer_references r ON r.scope = 'order' AND r.source_id = p.rental_id LEFT JOIN order_price_adjustments a ON a.payment_id = p.id AND a.direction = 'increase' WHERE p.rental_id = ? ORDER BY pp.uploaded_at DESC LIMIT 1").bind(order.id).first(),
    c.env.RENT.prepare('SELECT old_status, new_status, trigger_type, triggered_by, reason, created_at FROM rental_status_history WHERE rental_id = ? ORDER BY created_at DESC LIMIT 20').bind(order.id).all(),
    c.env.RENT.prepare('SELECT * FROM deposit_settlements WHERE order_id = ? ORDER BY requested_at DESC LIMIT 1').bind(order.id).first(),
    c.env.RENT.prepare('SELECT h.change_type, h.before_json, h.after_json, h.reason, h.changed_by, h.created_at, u.name AS changed_by_name FROM order_change_history h LEFT JOIN users u ON u.id = h.changed_by WHERE h.order_id = ? ORDER BY h.created_at DESC LIMIT 20').bind(order.id).all(),
    c.env.RENT.prepare("SELECT id, name, status FROM devices WHERE id != ? AND status NOT IN ('retired') ORDER BY name LIMIT 200").bind(order.deviceId).all()
  ]) as any[];
  const risk = !existingContract && order.status === 'approved' && customer?.role === 'CUSTOMER' ? await getCustomerRiskAssessment(c, customer.id) : null
  if (risk?.blocked) return buildLayout('订单风控限制 - 电脑租赁管理系统', `<div class="panel"><h2>订单存在风控限制</h2><p>客户风险分 ${risk.score}/100，当前不能创建合同。请先完成风控处理后再继续。</p></div>`, user)
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
  ]);
  const canModifyOrder = !['completed', 'cancelled'].includes(String(order.status));
  const paymentMethodLabels: Record<string, string> = {
    card: '信用卡（Stripe）', stripe: '信用卡（Stripe）', cash: '现金', bank_transfer: '银行转账',
    alipay: '支付宝', wechat: '微信', balance: '账户余额',
  };
  const paymentMethod = String(order.paymentMethod || (order as any).payment_method || 'card');
  const paymentMethodLabel = paymentMethodLabels[paymentMethod] || paymentMethod;
  const isCardPayment = ['card', 'stripe'].includes(paymentMethod)
  const isTransferPayment = ['bank_transfer', 'alipay', 'wechat'].includes(paymentMethod)
  const transferProofPaymentMethod = String(transferProof?.proof_payment_method || '')
  const isAdjustmentTransferProof = Boolean(transferProof?.adjustment_id && ['bank_transfer', 'alipay', 'wechat'].includes(transferProofPaymentMethod))
  const contractFinalized = Boolean(contract && isContractFinalized(contract));
  const rentalPaid = ['paid', 'pending_pickup', 'active', 'extended', 'overdue', 'suspended', 'pending_return', 'returned', 'completed'].includes(String(order.status));
  const signingStep = !contract
    ? (order.status === 'pending_approval' ? 1 : 2)
    : contractFinalized
      ? (rentalPaid ? 6 : 5)
      : 2;
  const contractWorkflow = [
    ['订单审核', '管理员确认租期、设备和档期'],
    ['阅读并同意协议', '客户打开签署链接阅读完整合同'],
    ['填写客户资料', '客户确认身份与联系方式'],
    ['电子签名', '客户输入姓名完成电子签署'],
    ['Stripe 支付', '客户通过 Stripe 支付租金及服务费'],
  ];
  const renderWorkflow = () => `<ol class="signing-steps admin-order-signing-steps" style="grid-template-columns: repeat(5, minmax(0, 1fr)); margin: 0;">${contractWorkflow.map(([title, description], index) => {
    const itemStep = index + 1;
    const state = itemStep < signingStep ? 'complete' : itemStep === signingStep ? 'current' : 'upcoming';
    const stateLabel = state === 'complete' ? '已完成' : state === 'current' ? '当前步骤' : '尚未开始';
    return `<li class="signing-step signing-step--${state}"${state === 'current' ? ' aria-current="step"' : ''}><span class="signing-step__number" aria-hidden="true">${String(itemStep).padStart(2, '0')}</span><span class="signing-step__copy"><span class="signing-step__title">${escapeHtml(title)}</span><span class="signing-step__state">${stateLabel}</span><small>${escapeHtml(description)}</small></span></li>`;
  }).join('')}</ol>`;
  const depositAmount = Number(order.depositAmount || order.deposit_amount || 0)
  const refundedDepositAmount = Number(depositRefundSummary?.refunded_amount || 0)
  const remainingDepositRefund = Math.max(0, Number((depositAmount - refundedDepositAmount).toFixed(2)))
  const pendingPriceRefund = Math.max(0, Number(Number(pendingPriceRefundSummary?.amount || 0).toFixed(2)))
  const remainingRefundTotal = Number((remainingDepositRefund + pendingPriceRefund).toFixed(2))
  const hasTransferPriceRefund = pendingPriceRefund > 0 && isTransferPayment
  const hasStripeRefundSource = isCardPayment && paymentSources.some((payment: any) => payment.payment_method === 'card' && payment.stripe_payment_intent_id)
  const defaultPriceRefundMethod = hasStripeRefundSource ? 'original' : isTransferPayment ? 'pending_deposit' : 'balance'
  const isSetupIntentDeposit = String((order as any).deposit_payment_mode || '') === 'SETUP_INTENT'
  const canModifyRefundMethod = String(order.status) === 'completed' && !isSetupIntentDeposit && !completedRefund;
  const isPreauthDeposit = String((order as any).deposit_payment_mode || '') === 'PREAUTH'
  const settledDepositRefund = refundRows.find((refund: any) => refund.type === 'deposit' && refund.status === 'succeeded')
  const cardDepositSettled = isCardDepositSettled(order, Boolean(settledDepositRefund))
  const preauthReleased = isPreauthDeposit && cardDepositSettled && (settledDepositRefund ? settledDepositRefund.refund_method === 'stripe' && Number(settledDepositRefund.refund_amount) === 0 : order.refundMethod === 'original')
  const preauthFee = Number(paymentSources.find((payment: any) => payment.stripe_payment_intent_id === order.stripe_deposit_payment_intent_id)?.processing_fee || 0)
  const depositMethod = normalizeSecurityDepositMethod((order as any).deposit_method, isSetupIntentDeposit ? 'card_hold' : 'bank_transfer')
  let proofImage = ''
  try { proofImage = transferProof?.image_url ? validateHostedImageUrls(transferProof.image_url, 1)[0] : '' } catch { }
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Australia/Melbourne' });
  const canSettleDeposit = order.status === 'completed' && !cardDepositSettled && (isSetupIntentDeposit || remainingRefundTotal > 0) && (!depositSettlement || depositSettlement.status === 'REJECTED' || depositSettlement.status === 'APPROVED')
  const showRefundCard = order.status === 'completed' || (order.status === 'paid' && order.startDate > today && !completedRefund)

  const currentStatus = pickupAwareOrderStatusBadge(order, contract);
  // 订单“已完成”只代表设备已归还，跟押金是否真正结清（deposit_status）是两回事，
  // 单独一个徽章显示，不能让“已完成”看起来什么都办完了（对应 o-af1VCjmW 那次事故）。
  const settlementPending = order.status === 'completed' && order.settlement_status === 'PENDING';
  const refundStatusLabel = preauthReleased ? '预授权已结算，剩余押金已释放' : isSetupIntentDeposit && cardDepositSettled ? '押金已结算' : completedRefund?.status === 'pending' ? 'REFUND_PENDING: 退款处理中' : completedRefund?.status === 'succeeded' ? (Number(completedRefund.refund_amount || 0) < Number(completedRefund.refundable_amount || completedRefund.refund_amount || 0) ? 'PARTIALLY_REFUNDED: 部分退款' : 'REFUNDED: 已退款') : '';
  const deliveryBlock = deliveryBookings.length ? `<div class="panel" style="margin-bottom:24px"><div class="section-title"><div><h3>配送状态</h3></div></div>${deliveryBookings.map((booking: any) => { const info = deliveryStatusInfo(booking.status); const trackingUrl = safeDeliveryTrackingUrl(booking.trackingUrl); return `<div class="delivery-status-row"><div><strong>${booking.direction === 'return' ? '回收' : '派送'}：${escapeHtml(info.label)}</strong><p class="section-note">${escapeHtml(info.description)}</p>${booking.providerReference ? `<small class="section-note">配送编号：${escapeHtml(booking.providerReference)}</small>` : ''}${info.special ? '<small class="delivery-lock-note">该状态下不能更新或取消配送订单。</small>' : ''}</div>${trackingUrl ? `<a class="button button-secondary" href="${escapeHtml(trackingUrl)}" target="_blank" rel="noopener noreferrer">查看追踪链接</a>` : ''}</div>` }).join('')}</div>` : '';

  const installmentSection = await renderRentalInstallments(c, order, false)
  const body = `
    <div class="order-detail-hero">
      <div class="order-detail-hero__row">
        <div>
          <h2>订单详情 #${escapeHtml(order.orderNo || order.id)}</h2>
          <p class="order-detail-hero__meta">${escapeHtml(customer?.name || '未知客户')} · ${escapeHtml(device?.name || '未知设备')}</p>
        </div>
        <div class="order-detail-hero__status">
          <span class="badge badge-lg ${currentStatus.badgeClass}">${escapeHtml(currentStatus.label)}</span>
          ${settlementPending ? `<span class="badge badge-lg badge-warning" title="押金尚未结清，不能视为完全办结">押金待结算</span>` : ''}
        </div>
      </div>
    </div>

    ${renderPickupPreparation(order, contract, c.req?.query?.('pickupReady'))}
    <div class="order-detail-actions">
      ${['paid', 'active', 'completed', 'pending_return'].includes(String(order.status)) ? `<a class="button button-secondary" href="/orders/${order.id}/invoice">查看发票 / 收据</a>` : ''}
      ${preInspectionAction}
      ${returnInspectionAction}
      ${['paid', 'pending_pickup'].includes(String(order.status)) ? renderOrderPickupAction(order, preInspectionDone) : ''}
      ${order.is_manual === 1 && canModifyOrder ? `<a class="button button-secondary" href="/admin/orders/${encodeURIComponent(order.id)}/edit">修改订单</a>` : ''}
      ${contract && isContractFinalized(contract) ? `<a class="button button-secondary" href="/contract/view/${contract.id}?from=order">查看合同</a>` : ''}
      ${contract && contract.status === 'pending_sign' ? `<a class="button button-primary" href="/staff/contracts/${encodeURIComponent(contract.id)}/progress">查看合同签署进度</a>` : ''}
    </div>
    ${deliveryBlock}
    ${order.is_manual === 1 && !contract ? '' : `<section class="panel" style="margin: 0 0 24px;"><div class="section-title"><h3>合同签署流程</h3><span class="section-note">${contract ? (contractFinalized ? '合同已签署' : '等待客户完成电子签名') : '合同尚未生成'}</span></div>${renderWorkflow()}${contract && contract.status === 'pending_sign' ? `<div class="record-actions" style="margin-top: 16px;"><a class="button button-secondary" href="/staff/contracts/${encodeURIComponent(contract.id)}/progress">打开签署链接管理</a></div>` : ''}</section>`}
    ${statusHistory?.results?.length ? `<section class="panel" style="margin: 0 0 24px;"><div class="section-title"><h3>租赁状态历史</h3><span class="section-note">最近 ${statusHistory.results.length} 条</span></div><div class="table-wrapper"><table><thead><tr><th>时间</th><th>状态变化</th><th>触发方式</th><th>原因</th></tr></thead><tbody>${statusHistory.results.map((item: any) => `<tr><td class="mono">${escapeHtml(formatMelbourneDateTime(item.created_at))}</td><td>${escapeHtml(item.old_status || '—')} → <strong>${escapeHtml(item.new_status)}</strong></td><td>${escapeHtml(item.trigger_type)}${item.triggered_by ? ` · ${escapeHtml(item.triggered_by)}` : ''}</td><td>${escapeHtml(item.reason || '—')}</td></tr>`).join('')}</tbody></table></div></section>` : ''}
    ${changeHistory?.results?.length ? `<section class="panel" style="margin: 0 0 24px;"><div class="section-title"><h3>订单修改历史</h3><span class="section-note">最近 ${changeHistory.results.length} 条</span></div><div class="table-wrapper"><table><thead><tr><th>时间</th><th>类型</th><th>变更内容</th><th>原因</th><th>操作人</th></tr></thead><tbody>${changeHistory.results.map((item: any) => {
    let before: any = {}; let after: any = {};
    try { before = JSON.parse(item.before_json || '{}') } catch { }
    try { after = JSON.parse(item.after_json || '{}') } catch { }
    const diffs = diffOrderSnapshots(before, after);
    const detail = diffs.length ? diffs.map(d => `<div>${escapeHtml(d.label)}：<span class="mono">${escapeHtml(String(d.before ?? '—'))}</span> → <strong class="mono">${escapeHtml(String(d.after ?? '—'))}</strong></div>`).join('') : '—';
    return `<tr><td class="mono">${escapeHtml(formatMelbourneDateTime(item.created_at))}</td><td>${escapeHtml(ORDER_CHANGE_TYPE_LABELS[item.change_type] || item.change_type)}</td><td>${detail}</td><td>${escapeHtml(item.reason || '—')}</td><td>${escapeHtml(formatOrderChangeActor(item.changed_by_name, item.changed_by))}</td></tr>`;
  }).join('')}</tbody></table></div></section>` : ''}
    ${installmentSection}
    ${renderReconciliationPanel({ reconciliation, paymentSources, refundRows })}
    <div class="grid grid-2" style="gap: 24px; margin-bottom: 24px;">
      <div class="panel">
        <div style="padding-bottom: 16px; border-bottom: 1px solid #e5e7eb; margin-bottom: 20px;">
          <h3 style="margin: 0; display: flex; align-items: center; gap: 8px;">订单基本信息</h3>
        </div>
        <div style="display: grid; gap: 16px;">
          <div style="display: flex; justify-content: space-between; align-items: center; padding: 12px; background: #f9fafb; border-radius: 8px;">
            <span style="color: #6b7280;">订单号</span>
            <span style="font-family: monospace; font-weight: 600;">${order.orderNo}</span>
          </div>
          <div style="display: flex; justify-content: space-between; align-items: center; padding: 12px; background: #f9fafb; border-radius: 8px;">
            <span style="color: #6b7280;">租期</span>
            <span style="font-weight: 500;">${order.startDate} ~ ${order.endDate}</span>
          </div>
          ${renderRentalDiscounts(order, device || {})}
          ${isPreauthDeposit ? `<div style="display: flex; justify-content: space-between; align-items: center; padding: 12px; background: #f9fafb; border-radius: 8px;"><span style="color: #6b7280;">信用卡预授权总额</span><span style="font-weight: 700; font-size: 1.1rem; color: #2563eb;">${formatCurrency(Number(order.totalAmount) + preauthFee)}</span></div>` : `<div style="display: flex; justify-content: space-between; align-items: center; padding: 12px; background: #f9fafb; border-radius: 8px;"><span style="color: #6b7280;">租金（含服务费）</span><span style="font-weight: 700; font-size: 1.1rem; color: #059669;">${formatCurrency(Number(order.totalAmount) - depositAmount)}</span></div><div style="display: flex; justify-content: space-between; align-items: center; padding: 12px; background: #f9fafb; border-radius: 8px;"><span style="color: #6b7280;">押金${isSetupIntentDeposit ? '（SetupIntent，不预扣）' : order.billing_mode === 'MONTHLY' ? '（随首期收取）' : ' 预授权'}</span><span style="font-weight: 700; font-size: 1.1rem; color: #2563eb;">${formatCurrency(depositAmount)}</span></div>`}
          <div style="display: flex; justify-content: space-between; align-items: center; padding: 12px; background: #f9fafb; border-radius: 8px;">
            <span style="color: #6b7280;">支付方式</span>
            <span style="font-weight: 500;">${escapeHtml(paymentMethodLabel)}</span>
          </div>
          ${refundStatusLabel ? `<div style="display: flex; justify-content: space-between; align-items: center; padding: 12px; background: #fff7ed; border-radius: 8px;"><span style="color: #6b7280;">退款状态</span><strong>${escapeHtml(refundStatusLabel)}</strong></div>` : ''}
          <div style="display: flex; justify-content: space-between; align-items: center; padding: 12px; background: #f9fafb; border-radius: 8px;">
            <span style="color: #6b7280;">下单日期</span>
            <span style="font-weight: 500;">${formatMelbourneDateTime(order.createdAt)}</span>
          </div>
        </div>
      </div>

      <div class="panel">
        <div style="padding-bottom: 16px; border-bottom: 1px solid #e5e7eb; margin-bottom: 20px;">
          <h3 style="margin: 0; display: flex; align-items: center; gap: 8px;">关联信息</h3>
        </div>
        <div style="display: grid; gap: 16px;">
          <div style="padding: 16px; background: linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%); border-radius: 12px;">
            <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 8px;">
              <div>
                <div style="font-size: 0.85rem; color: #3b82f6; font-weight: 500;">客户信息</div>
                <div style="font-weight: 600;">${customer?.name || 'N/A'}</div>
              </div>
            </div>
            <a href="/admin/users/${customer?.id}" class="link-button" style="width: 100%; text-align: center; margin-top: 8px;">查看客户详情 →</a>
          </div>
          <div style="padding: 16px; background: linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%); border-radius: 12px;">
            <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 8px;">
              <div>
                <div style="font-size: 0.85rem; color: #16a34a; font-weight: 500;">租赁设备</div>
                <div style="font-weight: 600;">${device?.name || 'N/A'}</div>
              </div>
            </div>
            <a href="/admin/devices/${device?.id}/edit" class="link-button" style="width: 100%; text-align: center; margin-top: 8px;">查看/编辑设备 →</a>
          </div>
        </div>
      </div>
    </div>

    <div class="panel">
      <div style="padding-bottom: 16px; border-bottom: 1px solid #e5e7eb; margin-bottom: 24px;">
        <h3 style="margin: 0; display: flex; align-items: center; gap: 8px;">订单管理操作</h3>
      </div>
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 24px;">
        ${canModifyOrder ? `<div style="padding:24px;background:linear-gradient(135deg,#eef2ff 0%,#e0e7ff 100%);border-radius:16px">
          <h4 style="margin:0 0 12px 0;color:#4338ca;display:flex;align-items:center;gap:8px">订单修改</h4>
          <p class="section-note">调整会记录修改历史；换机与改期会检查库存冲突。</p>
          <form method="POST" action="/admin/orders/${order.id}/changes" class="js-order-change-form" style="display:flex;flex-direction:column;gap:12px">
            <div>
              <label class="form-label" for="changeType">修改类型</label>
              <select class="form-control" id="changeType" name="changeType" required>
                <option value="">请选择…</option>
                <option value="EXTENSION">调整租期</option>
                <option value="DEVICE_SWAP">更换设备</option>
                <option value="PRICE_ADJUSTMENT">调整价格 / 押金</option>
                <option value="LOCATION_CHANGE">修改取还地点</option>
                <option value="REFUND_METHOD">修改押金退款方式</option>
              </select>
            </div>
            <div class="order-change-fields" data-for="EXTENSION" hidden>
              <label class="form-label">起租日期</label>
              <input class="form-control" type="date" name="startDate" value="${escapeHtml(order.startDate)}">
              <label class="form-label">归还日期</label>
              <input class="form-control" type="date" name="endDate" value="${escapeHtml(order.endDate)}">
            </div>
            <div class="order-change-fields" data-for="DEVICE_SWAP" hidden>
              <label class="form-label">替换设备</label>
              <select class="form-control" name="deviceId">
                <option value="">请选择设备…</option>
                ${(swapDevices?.results || []).map((d: any) => `<option value="${escapeHtml(d.id)}">${escapeHtml(d.name || d.id)}（${escapeHtml(d.status)}）</option>`).join('')}
              </select>
            </div>
            <div class="order-change-fields" data-for="PRICE_ADJUSTMENT" hidden>
              <label class="form-label">订单总额</label>
              <input class="form-control" type="number" min="0" step="0.01" name="totalAmount" value="${Number(order.totalAmount || 0)}">
              <label class="form-label">押金</label>
              <input class="form-control" type="number" min="0" step="0.01" name="depositAmount" value="${Number(order.depositAmount || 0)}">
              <label class="form-label">优惠金额</label>
              <input class="form-control" type="number" min="0" step="0.01" name="discountAmount" value="${Number((order as any).discount_amount || 0)}">
              <div style="margin-top:12px;padding:16px;background:linear-gradient(135deg,#fff7ed 0%,#ffedd5 100%);border-radius:12px">
                <strong style="display:block;color:#c2410c;margin-bottom:6px">退款处理</strong>
                <label class="form-label" for="priceRefundMethod">降价退款方式</label>
                <select class="form-control" id="priceRefundMethod" name="priceRefundMethod">
                  <option value="balance" ${defaultPriceRefundMethod === 'balance' ? 'selected' : ''}>退回账户余额</option>
                  ${hasStripeRefundSource ? `<option value="original" ${defaultPriceRefundMethod === 'original' ? 'selected' : ''}>原路退回（Stripe 信用卡）</option>` : ''}
                  ${isTransferPayment ? `<option value="pending_deposit" ${defaultPriceRefundMethod === 'pending_deposit' ? 'selected' : ''}>并入后续押金退款</option>` : ''}
                </select>
              </div>
            </div>
            <div class="order-change-fields" data-for="LOCATION_CHANGE" hidden>
              <label class="form-label">配送方式</label>
              <select class="form-control" name="deliveryMethod">
                <option value="Pickup" ${String(order.deliveryMethod || 'Pickup') === 'Delivery' ? '' : 'selected'}>自取 Pickup</option>
                <option value="Delivery" ${String(order.deliveryMethod || 'Pickup') === 'Delivery' ? 'selected' : ''}>配送 Delivery</option>
              </select>
              <label class="form-label">取货地点</label>
              <input class="form-control" name="pickupLocation" maxlength="200" value="${escapeHtml(order.pickupLocation || '')}">
              <label class="form-label">归还地点</label>
              <input class="form-control" name="returnLocation" maxlength="200" value="${escapeHtml(order.returnLocation || '')}">
            </div>
            <div class="order-change-fields" data-for="REFUND_METHOD" hidden>
              <p class="section-note" style="margin:0 0 10px">押金方式：${escapeHtml(securityDepositMethodLabel(depositMethod))}</p>
              <label class="form-label" for="orderRefundMethod">退款方式</label>
              <select class="form-control" id="orderRefundMethod" name="refundMethod">
                <option value="balance" ${order.refundMethod !== 'original' ? 'selected' : ''}>退回账户余额</option>
                <option value="original" ${order.refundMethod === 'original' ? 'selected' : ''}>原路退回${order.paymentMethod === 'bank_transfer' ? '（银行转账）' : ''}</option>
              </select>
              ${order.paymentMethod === 'bank_transfer' ? `<div id="orderRefundBankFields" class="grid grid-3" style="margin-top:12px;" ${order.refundMethod === 'original' ? '' : 'hidden'}><div><label class="form-label">BSB</label><input class="form-control" name="refundBsb" value="${escapeHtml(order.refundBsb || '')}" placeholder="000-000"></div><div><label class="form-label">账号</label><input class="form-control" name="refundAccountNumber" value="${escapeHtml(order.refundAccountNumber || '')}"></div><div><label class="form-label">账户名</label><input class="form-control" name="refundAccountName" value="${escapeHtml(order.refundAccountName || '')}"></div></div>
              <script>document.getElementById('orderRefundMethod')?.addEventListener('change',e=>{document.getElementById('orderRefundBankFields').hidden=e.target.value!=='original'})</script>` : ''}
            </div>
            <div>
              <label class="form-label" for="orderChangeReason">修改原因（必填）</label>
              <textarea class="form-control" id="orderChangeReason" name="reason" maxlength="500" rows="2" required placeholder="例如：客户申请延长租期 3 天"></textarea>
            </div>
            <button type="submit" class="button button-primary">保存修改</button>
          </form>
          <script>(function(){var sel=document.getElementById('changeType');if(!sel)return;var form=sel.closest('form');function sync(){var groups=form.querySelectorAll('.order-change-fields');for(var i=0;i<groups.length;i++){groups[i].hidden=groups[i].getAttribute('data-for')!==sel.value;}}sel.addEventListener('change',sync);sync();})();</script>
        </div>` : ''}
        ${canModifyRefundMethod ? `<div style="padding:24px;background:linear-gradient(135deg,#eef2ff 0%,#e0e7ff 100%);border-radius:16px">
          <h4 style="margin:0 0 12px 0;color:#4338ca;display:flex;align-items:center;gap:8px">订单修改</h4>
          <p class="section-note">已完成订单仅退款方式可改。</p>
          <form method="POST" action="/admin/orders/${order.id}/changes" style="display:flex;flex-direction:column;gap:12px" data-site-confirm="将修改该订单的退款方式。请核对退款账户信息与修改原因。" data-confirm-variant="danger" data-confirm-title="修改退款方式？" data-confirm-label="保存退款方式">
            <input type="hidden" name="changeType" value="REFUND_METHOD">
            <label class="form-label" for="completedOrderRefundMethod">退款方式</label>
            <select class="form-control" id="completedOrderRefundMethod" name="refundMethod" required>
              <option value="balance" ${order.refundMethod !== 'original' ? 'selected' : ''}>退回账户余额</option>
              <option value="original" ${order.refundMethod === 'original' ? 'selected' : ''}>原路退回${order.paymentMethod === 'bank_transfer' ? '（银行转账）' : ''}</option>
            </select>
            ${order.paymentMethod === 'bank_transfer' ? `<div id="completedOrderRefundBankFields" class="grid grid-3" style="margin-top:12px;" ${order.refundMethod === 'original' ? '' : 'hidden'}><div><label class="form-label">BSB</label><input class="form-control" name="refundBsb" value="${escapeHtml(order.refundBsb || '')}" placeholder="000-000"></div><div><label class="form-label">账号</label><input class="form-control" name="refundAccountNumber" value="${escapeHtml(order.refundAccountNumber || '')}"></div><div><label class="form-label">账户名</label><input class="form-control" name="refundAccountName" value="${escapeHtml(order.refundAccountName || '')}"></div></div>
            <script>document.getElementById('completedOrderRefundMethod')?.addEventListener('change',e=>{document.getElementById('completedOrderRefundBankFields').hidden=e.target.value!=='original'})</script>` : ''}
            <label class="form-label" for="completedOrderChangeReason">修改原因（必填）</label>
            <textarea class="form-control" id="completedOrderChangeReason" name="reason" maxlength="500" rows="2" required placeholder="例如：客户申请改为银行转账退款"></textarea>
            <button type="submit" class="button button-primary">保存退款方式</button>
          </form>
        </div>` : ''}
        ${['active', 'extended', 'overdue', 'suspended', 'pending_return'].includes(String(order.status)) ? `<div style="padding:24px;background:#eff6ff;border-radius:16px"><h4>设备归还</h4><p>${String(order.status) === 'pending_return' ? '客户已获批提前归还，请完成归还验机。' : order.early_return_requested_at ? '客户已申请提前归还，等待审批。' : '订单租赁中，可申请提前归还并安排验机。'}</p>${String(order.status) === 'active' && order.early_return_requested_at ? `<form method="post" action="/staff/orders/${order.id}/early-return/approve" data-site-confirm="确认批准客户提前归还吗？"><button class="button button-warning" type="submit">批准提前归还</button></form>` : ''}${renderOrderReturnAction(order)}</div>` : ''}
        ${((order.paymentMethod === 'bank_transfer' || (isAdjustmentTransferProof && transferProofPaymentMethod === 'bank_transfer')) && (String(order.status) !== 'active' || transferProof?.status === 'submitted')) ? `<div style="padding:24px;background:#eff6ff;border-radius:16px"><h4>银行转账审核${isAdjustmentTransferProof ? '（差价）' : ''}</h4>${transferProof?.transfer_code ? `<p>转账备注码：<strong class="mono">${escapeHtml(transferProof.transfer_code)}</strong></p>` : ''}${transferProof ? `<p>Reference：<strong>${escapeHtml(transferProof.reference_number)}</strong></p><p>备注：${escapeHtml(transferProof.note || '-')}</p>${proofImage ? `<a href="${escapeHtml(proofImage)}" target="_blank" rel="noopener noreferrer"><img src="${escapeHtml(proofImage)}" alt="转账凭证" loading="lazy" referrerpolicy="no-referrer" style="max-width:100%;max-height:320px;border-radius:8px"></a>` : '<p class="alert">凭证图片链接缺失或无效</p>'}<p>状态：${escapeHtml(transferProof.status)}</p>${transferProof.status === 'submitted' ? `<div style="display:flex;gap:10px"><form method="post" action="/admin/orders/${order.id}/transfer-proof/approve" data-site-confirm="通过后系统会将订单标记为已付款。请先核对凭证图片、Reference 与到账金额。" data-confirm-variant="danger" data-confirm-title="确认付款凭证？" data-confirm-label="审核通过"><button class="button button-primary" type="submit">审核通过</button></form><form method="post" action="/admin/orders/${order.id}/transfer-proof/reject" data-site-confirm="确认驳回这笔付款凭证吗？驳回后客户需要重新提交。" data-confirm-title="驳回付款凭证？" data-confirm-label="驳回凭证"><input class="form-control" name="reason" maxlength="300" placeholder="驳回原因" required><button class="button button-danger" type="submit">驳回</button></form></div>` : ''}` : '<p>客户尚未提交转账 Reference。</p>'}</div>` : ''}
        ${(isAdjustmentTransferProof && ['alipay', 'wechat'].includes(transferProofPaymentMethod) || ['alipay', 'wechat'].includes(String(order.paymentMethod))) ? `<div style="padding:24px;background:#eff6ff;border-radius:16px"><h4>${(isAdjustmentTransferProof ? transferProofPaymentMethod : order.paymentMethod) === 'alipay' ? '支付宝' : '微信'}付款审核${isAdjustmentTransferProof ? '（差价）' : ''}</h4>${transferProof ? `<p>Reference：<strong>${escapeHtml(transferProof.reference_number)}</strong></p>${proofImage ? `<a href="${escapeHtml(proofImage)}" target="_blank" rel="noopener noreferrer"><img src="${escapeHtml(proofImage)}" alt="付款凭证" loading="lazy" referrerpolicy="no-referrer" style="display:block;max-width:100%;max-height:420px;border-radius:8px;margin:12px 0"></a>` : '<p class="alert">凭证图片链接缺失或无效</p>'}<p>状态：${escapeHtml(transferProof.status)}</p>${transferProof.status === 'submitted' ? `<div style="display:flex;gap:10px"><form method="post" action="/admin/orders/${order.id}/transfer-proof/approve" data-site-confirm="通过后系统会将订单标记为已付款。请先核对凭证图片、Reference 与到账金额。" data-confirm-variant="danger" data-confirm-title="确认付款凭证？" data-confirm-label="审核通过"><button class="button button-primary" type="submit">审核通过</button></form><form method="post" action="/admin/orders/${order.id}/transfer-proof/reject" data-site-confirm="确认驳回这笔付款凭证吗？驳回后客户需要重新提交。" data-confirm-title="驳回付款凭证？" data-confirm-label="驳回凭证"><input class="form-control" name="reason" maxlength="300" placeholder="驳回原因" required><button class="button button-danger" type="submit">驳回</button></form></div>` : ''}` : '<p>客户尚未提交付款凭证。</p>'}</div>` : ''}
        ${['card', 'stripe'].includes(paymentMethod) && String(order.status) === 'pending_payment' ? `<div style="padding:24px;background:#eff6ff;border-radius:16px"><h4>Stripe 信用卡支付</h4><p>客户通过 Stripe 支付租金及服务费，卡信息不保存在本站。</p></div>` : ''}
        <div style="padding: 24px; background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%); border-radius: 16px;">
          <h4 style="margin: 0 0 16px 0; color: #1e40af; display: flex; align-items: center; gap: 8px;">更新订单状态</h4>
          <form method="POST" action="/admin/orders/${order.id}/update" class="js-order-status-form" style="display: flex; flex-direction: column; gap: 16px;">
            <div>
              <label for="status" style="display: block; margin-bottom: 8px; font-weight: 500; color: #374151;">选择新状态</label>
              <select id="status" name="status" style="width: 100%; padding: 14px 16px; border: 2px solid #e5e7eb; border-radius: 12px; font-size: 1rem; transition: all 0.2s; outline: none; background: white;" onfocus="this.style.borderColor='#3b82f6';this.style.boxShadow='0 0 0 3px rgba(59,130,246,0.1)'" onblur="this.style.borderColor='#e5e7eb';this.style.boxShadow='none'">
                ${order.status === 'suspended' ? '<option value="active">恢复租赁</option>' : '<option value="suspended">暂停租赁（仅管理员）</option>'}
                <option value="cancelled" ${order.status === 'cancelled' ? 'selected' : ''}>已取消</option>
              </select>
            </div>
            <button type="submit" class="button button-primary" style="padding: 14px; border-radius: 12px; font-weight: 600; background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%); box-shadow: 0 4px 14px 0 rgba(59,130,246,0.4);">更新状态</button>
          </form>
          ${['active', 'pending_return'].includes(String(order.status)) ? `<form method="POST" action="/admin/orders/${order.id}/update" class="js-order-status-form force-complete-form" data-force-confirm="true" style="margin-top: 12px;">
            <input type="hidden" name="status" value="completed">
            <input type="hidden" name="force" value="1"><label class="form-label">操作原因<textarea class="form-control" name="reason" maxlength="300" required></textarea></label><label class="workspace-checkbox"><input type="checkbox" name="deviceConfirmed" value="1" required>已确认设备收回且可正常出租</label>
            <button type="submit" class="button button-warning" style="width: 100%;">强制完成并上架</button>
            <small class="form-text">保存后不可撤销。</small>
          </form>` : ''}
        </div>

        ${showRefundCard ? `<div style="padding: 24px; background: linear-gradient(135deg, #fef7ed 0%, #feedd9 100%); border-radius: 16px;">
          <h4 style="margin: 0 0 16px 0; color: #c2410c;">${order.status === 'completed' ? '押金结算' : '退款处理'}</h4>
          <p class="section-note">押金方式：${escapeHtml(securityDepositMethodLabel(depositMethod))}</p>
          ${hasTransferPriceRefund ? `<div class="alert"><strong>转账类付款待退差价：${formatCurrency(pendingPriceRefund)}</strong><br>该金额将在本次押金退款中一并退还；押金可退 ${formatCurrency(remainingDepositRefund)}，本次最多合计 ${formatCurrency(remainingRefundTotal)}。</div>` : ''}
          ${preauthReleased ? `<div class="alert">信用卡预授权已结算：押金扣款 ${formatCurrency(Number(order.deposit_deduction_amount || 0))}，已释放剩余押金 ${formatCurrency(Math.max(0, depositAmount - Number(order.deposit_deduction_amount || 0)))}。</div>` : isSetupIntentDeposit && cardDepositSettled ? `<div class="alert">押金已结算：实际扣款 ${formatCurrency(Number(order.deposit_deduction_amount || 0))}。</div>` : completedRefund?.status === 'succeeded' ? `<div class="alert">已通过${completedRefund.refund_method === 'stripe' ? 'Stripe' : completedRefund.refund_method === 'bank_transfer' ? '银行转账' : '账户余额'}处理${completedRefund.type === 'deposit' ? '押金' : '全额取消'}退款：${formatCurrency(completedRefund.refund_amount)}${Number(completedRefund.refunded_processing_fee || 0) ? `，另退押金对应手续费 ${formatCurrency(completedRefund.refunded_processing_fee)}` : ''}${completedRefund.deduction_amount ? `，扣除 ${formatCurrency(completedRefund.deduction_amount)}（${escapeHtml(completedRefund.deduction_reason)}）` : ''}</div>` : ''}
          ${depositSettlement && completedRefund?.status !== 'succeeded' ? `<div class="alert">结算单 ${escapeHtml(depositSettlement.settlement_number)}：${escapeHtml(depositSettlement.status)}${depositSettlement.review_note ? ` · ${escapeHtml(depositSettlement.review_note)}` : ''}</div>` : ''}
          ${canSettleDeposit ? `<form method="POST" action="/admin/orders/${order.id}/${depositSettlement?.status === 'APPROVED' ? 'deposit-refund' : 'deposit-settlements'}" data-site-confirm="${depositSettlement?.status === 'APPROVED' ? '将按已批准结算单执行本次押金结算。请核对退款金额、扣款金额和处理方式。' : '将提交本次押金结算供经理审批。请核对结算金额及扣款原因。'}" data-confirm-variant="${depositSettlement?.status === 'APPROVED' ? 'danger' : 'default'}" data-confirm-title="${depositSettlement?.status === 'APPROVED' ? '执行押金结算？' : '提交结算审批？'}" data-confirm-label="${depositSettlement?.status === 'APPROVED' ? '执行押金结算' : '提交审批'}">
            ${isSetupIntentDeposit ? `<input type="hidden" name="refundMethod" value="original"><p class="section-note">押金未预扣；无损坏或逾期填 0。</p>` : `<label class="form-label" for="refundMethod">退款方式</label>
            <select class="form-control" id="refundMethod" name="refundMethod" required>
              <option value="balance" ${(depositSettlement?.refund_method || order.refundMethod) !== 'original' ? 'selected' : ''}>退回账户余额</option>
              <option value="original" ${(depositSettlement?.refund_method || order.refundMethod) === 'original' && (isPreauthDeposit || order.paymentMethod !== 'bank_transfer') ? 'selected' : ''}>原路退回</option>
              ${isPreauthDeposit ? '' : `<option value="bank_transfer" ${order.refundMethod === 'original' && order.paymentMethod === 'bank_transfer' ? 'selected' : ''}>银行转账</option>`}
            </select>
            <div id="refundBankFields" class="grid grid-3" style="margin-top:12px;" ${order.refundMethod === 'original' && order.paymentMethod === 'bank_transfer' ? '' : 'hidden'}><div><label class="form-label">BSB</label><input class="form-control" name="refundBsb" value="${escapeHtml(order.refundBsb || '')}" placeholder="000-000"></div><div><label class="form-label">账号</label><input class="form-control" name="refundAccountNumber" value="${escapeHtml(order.refundAccountNumber || '')}"></div><div><label class="form-label">账户名</label><input class="form-control" name="refundAccountName" value="${escapeHtml(order.refundAccountName || '')}"></div></div>
            <script>document.getElementById('refundMethod')?.addEventListener('change',e=>{document.getElementById('refundBankFields').hidden=e.target.value!=='bank_transfer'})</script>`}
            ${isPreauthDeposit || isSetupIntentDeposit ? '<input type="hidden" name="refundItem" value="deposit">' : `<label class="form-label" for="refundItem">退款项目</label>
            <select class="form-control" id="refundItem" name="refundItem" required onchange="document.getElementById('customRefundItem').hidden=this.value!=='other';document.getElementById('customRefundItem').required=this.value==='other';">
              <option value="deposit">押金退款</option>
              <option value="other">其他退款项目</option>
            </select>
            <input class="form-control" id="customRefundItem" name="customRefundItem" maxlength="100" placeholder="请输入退款项目名称" hidden>`}
            ${isSetupIntentDeposit ? `<label class="form-label" for="deductionAmount">本次实际扣款金额（押金额度 ${formatCurrency(depositAmount)}）</label><input class="form-control" id="deductionAmount" name="deductionAmount" type="number" min="0" max="${depositAmount}" step="0.01" value="${Number(depositSettlement?.deduction_amount || 0)}" required>` : `<label class="form-label" for="refundAmount">${isPreauthDeposit ? '本次退回或释放押金额度' : '本次退款合计（押金 + 差价）'}（最多 ${formatCurrency(remainingRefundTotal)}）</label>
            <input class="form-control" id="refundAmount" name="refundAmount" type="number" min="0" max="${remainingRefundTotal}" step="0.01" value="${Math.min(Number(depositSettlement?.refund_amount ?? remainingRefundTotal), remainingRefundTotal)}" required>`}
            <label class="form-label" for="deductionReason">扣款原因（发生损坏或逾期时必填）</label>
            <select class="form-control" id="deductionCategory" name="deductionCategory">
              <option value="">无扣款</option><option value="DAMAGE" ${depositSettlement?.deduction_category === 'DAMAGE' ? 'selected' : ''}>设备损坏</option><option value="MISSING_ACCESSORY" ${depositSettlement?.deduction_category === 'MISSING_ACCESSORY' ? 'selected' : ''}>配件遗失</option><option value="LATE_FEE" ${depositSettlement?.deduction_category === 'LATE_FEE' ? 'selected' : ''}>逾期费用</option><option value="DEVICE_NOT_RETURNED" ${depositSettlement?.deduction_category === 'DEVICE_NOT_RETURNED' ? 'selected' : ''}>设备未归还</option><option value="OTHER" ${depositSettlement?.deduction_category === 'OTHER' ? 'selected' : ''}>其他</option>
            </select>
            <textarea class="form-control" id="deductionReason" name="deductionReason">${escapeHtml(depositSettlement?.status === 'APPROVED' ? depositSettlement.deduction_reason || '' : '')}</textarea>
            <button type="submit" class="button button-warning" style="margin-top:12px;">${depositSettlement?.status === 'APPROVED' ? '执行已批准结算' : '提交结算审批'}</button>
          </form>` : ''}
          ${order.status === 'paid' && order.startDate > today && !completedRefund ? `<form method="POST" action="/admin/orders/${order.id}/cancel-and-refund" data-site-confirm="将取消订单并全额退还 ${formatCurrency(order.totalAmount)}。请核对退款金额与退款方式；如使用银行转账，请先完成转账。" data-confirm-variant="danger" data-confirm-title="取消订单并退款？" data-confirm-label="确认取消并退款">${order.refundMethod === 'original' && order.paymentMethod === 'bank_transfer' ? '<div class="alert">请先完成银行转账，再确认取消订单。</div>' : ''}<button type="submit" class="button button-danger">${order.refundMethod === 'original' && order.paymentMethod === 'bank_transfer' ? '确认已转账并取消订单' : '取消并全额退款'}</button></form>` : ''}
        </div>` : ''}
      </div>
      <div style="margin-top: 24px; padding-top: 24px; border-top: 1px solid #e5e7eb; display: flex; flex-wrap: wrap; gap: 12px; align-items: center; justify-content: space-between;">
        <a href="/admin/orders" class="button button-secondary" style="padding: 12px 32px; border-radius: 10px; text-decoration: none; display: inline-flex; align-items: center; gap: 8px;">← 返回订单列表</a>
        ${order.status === 'cancelled' && paymentSources.some((payment: any) => payment.status === 'paid') && !refundRows.some((refund: any) => refund.type === 'cancellation') ? `<form method="post" action="/admin/orders/${order.id}/retry-cancellation-refund"><button class="button button-primary" type="submit">重试自动退款</button></form>` : ''}
        <form method="POST" action="/admin/orders/${order.id}/delete" data-site-confirm="订单将从网站隐藏，付款和合同等历史记录会保留。" data-confirm-variant="danger" data-confirm-title="删除订单？" data-confirm-label="删除订单" data-confirm-text="删除订单">
          <button type="submit" class="button button-danger" style="padding: 12px 32px; border-radius: 10px;">删除订单</button>
        </form>
      </div>
    </div>
  `;

  return buildLayout('订单详情 - 电脑租赁管理系统', body + await renderOrderOperations(c,order.id) + renderOrderStatusFeedback(), user);
}
