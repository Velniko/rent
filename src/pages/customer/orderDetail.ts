/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

import { buildLayout, getOrderById, getDeviceById, formatCurrency, formatMelbourneDateTime, getContractByOrderId, ensureContractForOrder, getCustomerRiskAssessment, systemSettings, diffOrderSnapshots, ORDER_CHANGE_TYPE_LABELS } from '../../site';
import { Context } from 'hono';
import { renderRentalPaymentPlan } from '../partials/rentalPaymentPlan';
import { renderRentalDiscounts } from '../partials/rentalDiscounts';
import { renderRentalInstallments } from '../partials/rentalInstallments';
import { renderStripePaymentBox } from '../partials/stripePaymentSection';
import { renderSquareGiftCardPaymentBox } from '../partials/squareGiftCardPayment';
import { depositPaymentModeForOrder, isCardDepositSettled, normalizeSecurityDepositMethod, securityDepositMethodLabel } from '../../domain/paymentPlan';
import { buildMonthlyRentalInstallments, isMonthlyRental } from '../../domain/monthlyRental';
import { getOrderPriceAdjustmentSummary, getStripeProcessingFeeRate } from '../../actions/stripePayments';
import { getDeliveryBookingsForOrder, safeDeliveryTrackingUrl, type DeliveryBookingView } from '../../services/deliveryViews';
import { decryptSecret } from '../../lib/secretBox';
import { pickupTimeSlots } from '../../domain/pickupTimeSlots';
import { renderOrderStatusBadge } from '../partials/orderStatusBadge';
import { canRequestCustomerRefund, getCustomerRefundRequest, CUSTOMER_REFUND_STATUSES } from '../../services/customerRefunds';

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  stripe: '信用卡（Stripe）', card: '信用卡（Stripe）', square: '礼品卡', bank_transfer: '银行转账', alipay: '支付宝', wechat: '微信',
  customer_balance: '账户余额', balance: '账户余额', deposit: '押金', credit: '信用额度 / 调整',
};
const REFUND_TYPE_LABELS: Record<string, string> = { deposit: '押金退还', rent: '租金退款', order: '订单退款', service_fee: '服务费退款', cancellation: '取消订单退款', early_return: '提前归还租金退款' };

export async function renderCustomerOrderDetail(c: Context, user: any, orderId: string, message?: string, type: 'success' | 'error' = 'error') {
  const order = await getOrderById(c, orderId)
  if (!order || order.userId !== user.id) {
    return buildLayout('订单详情 - 电脑租赁管理系统', '<div class="panel"><h2>订单未找到</h2><p>您请求的订单不存在或无权访问。</p></div>', user)
  }
  const customerRefundRequest = await getCustomerRefundRequest(c, order.id)
  const deliveryBookings = await getDeliveryBookingsForOrder(c, order.id)
  const [device, existingContract, transferProof, timeChanges, preInspection, returnInspection, depositRefund, refundStatus, changeHistory, paymentSources, refundRows, priceAdjustmentSummary, priceAdjustmentProof, account] = await Promise.all([getDeviceById(c, order.deviceId), getContractByOrderId(c, order.id), (['bank_transfer', 'alipay', 'wechat'].includes(String(order.paymentMethod)) || String(order.paymentProvider || order.payment_provider || '') === 'square') ? c.env.RENT.prepare("SELECT pp.status, pp.reference_number, pp.rejection_reason, pp.note FROM payment_proofs pp JOIN payments p ON p.id = pp.payment_id WHERE p.rental_id = ? AND p.id NOT IN (SELECT COALESCE(payment_id, '') FROM order_price_adjustments WHERE order_id = ?) ORDER BY pp.uploaded_at DESC LIMIT 1").bind(order.id, order.id).first() : Promise.resolve(null), c.env.RENT.prepare('SELECT * FROM order_time_change_history WHERE order_id = ? ORDER BY created_at DESC LIMIT 10').bind(order.id).all(), c.env.RENT.prepare("SELECT snapshot_json, created_at FROM device_inspections WHERE deleted_at IS NULL AND rental_id = ? AND inspection_type = 'before_rental' ORDER BY created_at DESC LIMIT 1").bind(order.id).first(), c.env.RENT.prepare("SELECT snapshot_json, created_at FROM device_inspections WHERE deleted_at IS NULL AND rental_id = ? AND inspection_type = 'after_return' ORDER BY created_at DESC LIMIT 1").bind(order.id).first(), c.env.RENT.prepare("SELECT deduction_amount, deduction_reason FROM payment_refunds WHERE order_id = ? AND type = 'deposit' AND status = 'succeeded' ORDER BY created_at DESC LIMIT 1").bind(order.id).first(), c.env.RENT.prepare("SELECT status, refundable_amount, refund_amount FROM payment_refunds WHERE order_id = ? ORDER BY created_at DESC LIMIT 1").bind(order.id).first(), c.env.RENT.prepare("SELECT change_type, before_json, after_json, created_at FROM order_change_history WHERE order_id = ? ORDER BY created_at DESC LIMIT 20").bind(order.id).all(), c.env.RENT.prepare("SELECT payment_method, payment_provider, amount, deposit_amount, rental_amount, processing_fee, status, square_paid_amount FROM payments WHERE rental_id = ? AND status IN ('pending','paid','refunded') ORDER BY created_at").bind(order.id).all().then((r: any) => (r.results || []) as any[]), c.env.RENT.prepare("SELECT type, refund_amount, refund_method, status, created_at FROM payment_refunds WHERE order_id = ? AND status = 'succeeded' ORDER BY created_at").bind(order.id).all().then((r: any) => (r.results || []) as any[]), getOrderPriceAdjustmentSummary(c, order), c.env.RENT.prepare("SELECT pp.status, pp.reference_number, pp.rejection_reason FROM payment_proofs pp JOIN payments p ON p.id = pp.payment_id JOIN order_price_adjustments a ON a.payment_id = p.id WHERE a.order_id = ? AND a.direction = 'increase' ORDER BY pp.uploaded_at DESC LIMIT 1").bind(order.id).first(), c.env.RENT.prepare('SELECT balance FROM users WHERE id = ?').bind(user.id).first()]) as any[]
  const shouldEnsureContract = order.is_manual !== 1 && ['approved', 'paid', 'pending_pickup', 'active', 'extended', 'overdue', 'suspended', 'pending_return', 'returned', 'completed'].includes(String(order.status))
  const risk = !existingContract && shouldEnsureContract ? await getCustomerRiskAssessment(c, user.id) : null
  if (risk?.blocked) return buildLayout('订单暂不可继续 - 电脑租赁管理系统', `<div class="panel"><h2>订单暂不可继续</h2><p>当前账户存在风控限制，系统不会为该订单创建新的合同。请联系客服处理。</p></div>`, user)
  const contract = existingContract || (shouldEnsureContract ? await ensureContractForOrder(c, order, user.id) : null)
  const alertMessage = message ? `<div data-flash-notice class="page-notification page-notification--${type}">${message}</div>` : ''
  const depositMode = depositPaymentModeForOrder(order)
  const depositMethod = normalizeSecurityDepositMethod((order as any).deposit_method, depositMode === 'PAID' ? 'bank_transfer' : 'card_hold')
  const squarePaymentSelected = String(order.paymentProvider || order.payment_provider || '') === 'square'
  const deposit = Number(order.depositAmount || 0)
  const serviceFee = Number(order.serviceFee || order.service_fee || 0)
  const immediatelyPaidAmount = Math.max(0, Number(order.totalAmount) - deposit)
  const rentalAmount = Math.max(0, immediatelyPaidAmount - serviceFee)
  const monthlyPayment = isMonthlyRental(order) && order.paymentMethod === 'card'
  const firstMonthly = monthlyPayment ? buildMonthlyRentalInstallments({ ...order, deposit_method: 'card_hold' }, device || {}, getStripeProcessingFeeRate())[0] : null
  const stripeFee = firstMonthly?.processing_fee ?? Math.round(immediatelyPaidAmount * 100 * getStripeProcessingFeeRate()) / 100
  const stripeTotal = firstMonthly?.amount ?? (depositMode === 'PREAUTH' ? Number(order.totalAmount) + stripeFee : Number(order.totalAmount) - deposit + stripeFee)
  const squareFeeRate = Math.min(1, Math.max(0, Number(systemSettings.paymentMethods.squareProcessingFeeRate ?? 0.022)))
  const squareFee = Math.round(immediatelyPaidAmount * 100 * squareFeeRate) / 100
  const squareTotal = Number((immediatelyPaidAmount + squareFee).toFixed(2))
  const squarePaidAmount = Number(paymentSources.filter((payment: any) => payment.payment_provider === 'square').reduce((sum: number, payment: any) => sum + Number(payment.square_paid_amount || 0), 0).toFixed(2))
  const squareRemainingAmount = Math.max(0, Number((squareTotal - squarePaidAmount).toFixed(2)))
  const squareDepositDue = squarePaymentSelected && squarePaidAmount > 0 && String((order as any).deposit_status || '').toUpperCase() === 'PENDING' ? deposit : 0
  const squareResidualTotal = Number((squareRemainingAmount + squareDepositDue).toFixed(2))
  const pendingOrderPayment = paymentSources.find((payment: any) => payment.status === 'pending' && payment.payment_provider === 'internal' && payment.payment_method === order.paymentMethod)
  const orderPaymentDue = squarePaymentSelected && squarePaidAmount > 0 ? squareResidualTotal : Number(pendingOrderPayment?.amount || order.totalAmount)
  const stripeDisplayAmount = squarePaymentSelected && squarePaidAmount > 0 ? squareResidualTotal : stripeTotal
  const squareAdjustmentFee = Math.round(Number(priceAdjustmentSummary.amountDue) * 100 * squareFeeRate) / 100
  const squareAdjustmentTotal = Number((Number(priceAdjustmentSummary.amountDue) + squareAdjustmentFee).toFixed(2))
  const transferPayment = ['bank_transfer', 'alipay', 'wechat'].includes(String(order.paymentMethod))
  const squareDepositStatus = String((order as any).deposit_status || '').toUpperCase()
  const squareDepositPending = false
  const currentBalance = Number(account?.balance ?? user.balance ?? 0)
  let preSnapshot: any = {}; let returnData: any = {}
  try { preSnapshot = JSON.parse(preInspection?.snapshot_json || '{}') } catch (_) {}
  try { returnData = JSON.parse(returnInspection?.snapshot_json || '{}') } catch (_) {}
  const esc = (value: unknown) => String(value ?? '—').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
  const melbourneTime = (value: unknown) => {
    const raw = String(value || '')
    if (!raw) return '—'
    const date = new Date(/(?:Z|[+-]\d{2}:?\d{2})$/.test(raw) ? raw : `${raw.replace(' ', 'T')}Z`)
    return Number.isNaN(date.getTime()) ? raw : new Intl.DateTimeFormat('zh-CN', { timeZone: 'Australia/Melbourne', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(date)
  }
  const report = (data: any, keys: string[]) => `<dl class="data-list">${keys.map(key => `<div><dt>${esc(key)}</dt><dd>${esc(data[key])}</dd></div>`).join('')}</dl>`
  const deducted = Number(depositRefund?.deduction_amount || 0) > 0
  const cardDepositSettled = isCardDepositSettled(order, Boolean(depositRefund))
  const settledDepositRefund = refundRows.find((refund: any) => refund.type === 'deposit')
  const preauthSettled = depositMode === 'PREAUTH' && cardDepositSettled && (settledDepositRefund ? settledDepositRefund.refund_method === 'stripe' && Number(settledDepositRefund.refund_amount) === 0 : order.refundMethod === 'original')
  const releasedDeposit = Math.max(0, deposit - Number(order.deposit_deduction_amount || 0))
  const refundLabel = preauthSettled ? '预授权已结算，剩余押金已释放' : depositMode === 'SETUP_INTENT' && cardDepositSettled ? '押金已结算' : refundStatus?.status === 'pending' ? '退款处理中' : refundStatus?.status === 'succeeded' ? (Number(refundStatus.refund_amount || 0) < Number(refundStatus.refundable_amount || refundStatus.refund_amount || 0) ? '部分退款' : '已退款') : ''
  const windowsData = typeof contract?.contract_data === 'string' ? (() => { try { return JSON.parse(contract.contract_data || '{}') } catch (_) { return {} } })() : (contract?.contract_data || {})
  const windowsPassword = await decryptSecret(c, windowsData.windows_password)
  const deliveryBlock = deliveryBookings.length ? `<section class="panel" style="margin-top:20px"><h3>配送状态</h3>${deliveryBookings.map((booking: any) => { const trackingUrl = safeDeliveryTrackingUrl(booking.trackingUrl); return `<div class="delivery-status-row"><div><strong>${booking.direction === 'return' ? '回收' : '派送'}：${esc(booking.statusLabel)}</strong><p class="form-text">${esc(booking.statusDescription)}</p>${booking.providerReference ? `<small class="form-text">配送编号：${esc(booking.providerReference)}</small>` : ''}${booking.locked ? '<small class="delivery-lock-note">该状态下不能更新或取消配送订单。</small>' : ''}</div>${trackingUrl ? `<a class="button button-secondary" href="${esc(trackingUrl)}" target="_blank" rel="noopener noreferrer">查看追踪链接</a>` : ''}</div>` }).join('')}</section>` : ''
  const renderAdjustmentTransferCard = (method: 'bank_transfer' | 'alipay' | 'wechat') => {
    const label = method === 'bank_transfer' ? '银行转账' : method === 'alipay' ? '支付宝' : '微信'
    const paymentDetails = method === 'bank_transfer'
      ? `<p><strong>银行名称:</strong> ${systemSettings.bankDetails.bankName || '—'}</p><p><strong>BSB:</strong> ${systemSettings.bankDetails.bsb}</p><p><strong>账号:</strong> ${systemSettings.bankDetails.account}</p>`
      : `<img src="${method === 'alipay' ? systemSettings.rmbPayment.alipayQrUrl : systemSettings.rmbPayment.wechatQrUrl}" alt="${label}收款码" loading="lazy" style="max-width:240px;display:block;margin:12px 0">`
    const summaryId = `rmb-adjustment-summary-${method}`
    return `<div class="payment-card"><h4>${label}补差价</h4>${paymentDetails}<p id="${summaryId}">请支付 ${formatCurrency(priceAdjustmentSummary.amountDue)}${method === 'bank_transfer' ? '' : '；提交付款凭证前获取实时汇率。'}</p><form method="POST" enctype="multipart/form-data" action="/customer/orders/${order.id}/bank-transfer-proof"><input type="hidden" name="priceAdjustment" value="1"><input type="hidden" name="paymentMethod" value="${method}"><label class="form-label">付款 Reference</label><input class="form-control" name="referenceNumber" maxlength="100" required><label class="form-label">付款凭证图片</label><input class="form-control" type="file" name="imageFile" accept="image/jpeg,image/png,image/webp" required><label class="form-label">备注（选填）</label><textarea class="form-control" name="note" maxlength="500"></textarea><button class="button button-primary" type="submit" style="margin-top:12px">提交${label}差价凭证</button></form>${method !== 'bank_transfer' ? `<script>(()=>{const s=document.getElementById('${summaryId}');fetch('/api/payment/aud-cny?amount=${encodeURIComponent(String(priceAdjustmentSummary.amountDue))}').then(r=>r.ok?r.json():Promise.reject()).then(d=>{s.innerHTML='请支付 <strong>CNY '+Number(d.cnyAmount).toFixed(2)+'</strong>，1 AUD = '+Number(d.rate).toFixed(6)+' CNY。'}).catch(()=>{s.textContent='暂时无法获取实时人民币汇率，请稍后重试。'})})()</script>` : ''}</div>`
  }
    const renderSquareAdjustmentCard = () => `<div class="payment-card"><h4>礼品卡补差价</h4><p>差价 ${formatCurrency(priceAdjustmentSummary.amountDue)}；礼品卡手续费（${(squareFeeRate * 100).toFixed(2)}%）${formatCurrency(squareAdjustmentFee)}；实际扣款 ${formatCurrency(squareAdjustmentTotal)}。退款时仅退回账户余额。</p>${renderSquareGiftCardPaymentBox({ configUrl: `/customer/orders/${order.id}/price-adjustment/square/config`, paymentUrl: `/customer/orders/${order.id}/price-adjustment/square/payment`, returnUrl: `/payment/result?orderId=${encodeURIComponent(order.id)}`, buttonLabel: `使用礼品卡支付 ${formatCurrency(squareAdjustmentTotal)}`, domId: 'order-price-adjustment-square-pay', stored: Boolean((order as any).square_gift_card_id || (order as any).squareGiftCardId) })}</div>`
  const balanceAlternativePayments = priceAdjustmentProof?.status === 'submitted'
    ? '<div class="payment-waiting-note"><span>差价付款凭证已提交，正在等待管理员审核</span></div>'
    : `${systemSettings.paymentMethods.square ? renderSquareAdjustmentCard() : ''}${systemSettings.paymentMethods.stripe ? `<div class="payment-card"><h4>信用卡支付（Stripe）</h4><p>使用其他支付方式补交差价，卡号由 Stripe 安全处理。</p>${renderStripePaymentBox({ intentUrl: `/customer/orders/${order.id}/price-adjustment/stripe/intent`, returnUrl: `/payment/result?orderId=${encodeURIComponent(order.id)}`, buttonLabel: `支付差价 ${formatCurrency(priceAdjustmentSummary.chargedAmount)}`, domId: 'order-price-adjustment-balance-stripe-pay' })}</div>` : ''}${systemSettings.paymentMethods.bankTransfer ? renderAdjustmentTransferCard('bank_transfer') : ''}${systemSettings.paymentMethods.alipay && systemSettings.rmbPayment.alipayQrUrl ? renderAdjustmentTransferCard('alipay') : ''}${systemSettings.paymentMethods.wechat && systemSettings.rmbPayment.wechatQrUrl ? renderAdjustmentTransferCard('wechat') : ''}`
  const squareAdjustmentPayment = systemSettings.paymentMethods.square && priceAdjustmentProof?.status !== 'submitted' ? renderSquareAdjustmentCard() : ''
  const currentTransferMethod = String(order.paymentMethod) as 'bank_transfer' | 'alipay' | 'wechat'
  const transferAdjustmentPayment = priceAdjustmentProof?.status === 'submitted'
    ? '<div class="payment-waiting-note"><span>差价付款凭证已提交，正在等待管理员审核</span></div>'
    : `${squareAdjustmentPayment}${renderAdjustmentTransferCard(currentTransferMethod)}`
  const cardAdjustmentPayment = `${squareAdjustmentPayment}${systemSettings.paymentMethods.stripe ? `<div class="payment-card"><p>在本页填写卡信息完成差价支付，卡号由 Stripe 处理。</p>${renderStripePaymentBox({ intentUrl: `/customer/orders/${order.id}/price-adjustment/stripe/intent`, returnUrl: `/payment/result?orderId=${encodeURIComponent(order.id)}`, buttonLabel: `支付差价 ${formatCurrency(priceAdjustmentSummary.chargedAmount)}`, domId: 'order-price-adjustment-stripe-pay' })}</div>` : '<p>信用卡支付当前未启用，请联系客服完成差价支付。</p>'}`
  const priceAdjustmentPaymentContent = priceAdjustmentSummary.amountDue <= 0
    ? ''
    : order.paymentMethod === 'balance'
      ? balanceAlternativePayments || '<p>当前没有可用的其他支付方式，请联系客服补交差价。</p>'
      : transferPayment
        ? transferAdjustmentPayment
        : cardAdjustmentPayment

  let chosenBillingMode = ''
  try { chosenBillingMode = JSON.parse(order.rental_pricing_json || '{}').billingMode || '' } catch {}
  const installmentSection = await renderRentalInstallments(c, order, true)
  const body = `
    <div class="panel order-detail-shell customer-order-detail">
      <script>(function(){window.addEventListener('square-payment-updated',function(event){var detail=event.detail||{};if(Number(detail.squarePaidAmountCents||0)>0&&Number(detail.remainingAmountCents||0)>=0){window.setTimeout(function(){window.location.reload()},250)}})})();</script>
      <div class="section-title"><h2>${order.orderNo ? `订单详情 #${order.orderNo}` : '订单详情'}</h2>${order.orderNo ? '' : '<span class="section-note">订单编号将在付款确认后生成。</span>'}<a class="button button-secondary" href="/customer/orders">返回我的订单</a></div>
      ${alertMessage}
      ${customerRefundRequest ? `<section class="panel"><h3>${CUSTOMER_REFUND_STATUSES[customerRefundRequest.status]}</h3><dl class="data-list"><div><dt>退款手续费（订单总额的 5%）</dt><dd>${formatCurrency(customerRefundRequest.fee_amount)}</dd></div><div><dt>申请退款金额</dt><dd>${formatCurrency(customerRefundRequest.refund_amount)}</dd></div></dl>${customerRefundRequest.review_note ? `<p>${esc(customerRefundRequest.review_note)}</p>` : ''}</section>` : ''}
      ${canRequestCustomerRefund(order) && (!customerRefundRequest || customerRefundRequest.status === 'rejected') ? `<p><a class="button button-danger" href="/customer/orders/${encodeURIComponent(order.id)}/refund-request">申请退款</a></p>` : ''}
      <div class="order-detail-grid">
        <div class="order-info-card">
          <h3>订单信息</h3>
          <p><strong>订单状态:</strong> ${renderOrderStatusBadge(order.status)}</p>
          <p><strong>下单时间:</strong> ${esc(formatMelbourneDateTime(order.createdAt || order.orderDate)) || '—'}</p>
          <p><strong>租期:</strong> ${order.startDate} ${order.startPeriod === 'PM' ? '下午' : '上午'} 至 ${order.endDate} ${order.endPeriod === 'PM' ? '下午' : '上午'}（${order.rentalPeriod || 0} 天）</p>
          <p><strong>领取/归还地点:</strong> ${order.pickupLocation || '待确认'} / ${order.returnLocation || '待确认'}</p>
          <p><strong>预约时间:</strong> ${order.pickupTimeSlot || '待确认'} / ${order.returnTimeSlot || '待确认'}</p>
          <p><strong>租金及服务费:</strong> ${formatCurrency(Number(order.totalAmount) - deposit)}</p>
          ${renderRentalDiscounts(order, device || {})}
          <p><strong>押金:</strong> ${formatCurrency(deposit)}（${securityDepositMethodLabel(depositMethod)}；${depositMode === 'PREAUTH' ? '预授权' : depositMode === 'SETUP_INTENT' ? 'SetupIntent 保存卡片，不预扣' : order.billing_mode === 'MONTHLY' ? '随首期收取' : '单独处理'}）</p>
          <p><strong>订单合计:</strong> ${formatCurrency(order.totalAmount)}</p>
          ${['MONTHLY', 'FULL'].includes(chosenBillingMode) ? `<p><strong>付款计划:</strong> ${isMonthlyRental(order) ? '月付' : Number(order.rentalPeriod) >= 60 && deposit === 0 ? '一次性付清（免押金）' : '一次性付清'}</p>` : ''}
          <p id="square-payment-summary"${squarePaidAmount > 0 ? '' : ' hidden'}><strong>礼品卡已扣:</strong> ${formatCurrency(squarePaidAmount)}${squareRemainingAmount > 0 ? `；Stripe 剩余 ${formatCurrency(squareRemainingAmount)}` : ''}</p>
          ${squarePaymentSelected && squarePaidAmount > 0 ? `<p><strong>礼品卡扣减后待支付:</strong> ${formatCurrency(squareRemainingAmount)}</p>` : ''}
          ${refundLabel ? `<p><strong>退款状态:</strong> ${esc(refundLabel)}</p>` : ''}
          ${preauthSettled ? `<p><strong>押金实际扣款:</strong> ${formatCurrency(Number(order.deposit_deduction_amount || 0))}；已释放 ${formatCurrency(releasedDeposit)}</p>` : ''}
        </div>
        <div class="order-info-card">
          <h3>设备信息</h3>
          <p><strong>设备名称:</strong> ${device?.name ?? '未知设备'}</p>
          <p><strong>设备型号:</strong> ${device?.model ?? 'N/A'}</p>
          <p><strong>序列号:</strong> ${device?.serialNumber ?? 'N/A'}</p>
          <p><strong>日租金:</strong> ${formatCurrency(device?.pricePerDay ?? device?.dailyRate ?? 0)}</p>
        </div>
      </div>
      ${renderRentalPaymentPlan(order, device, `/customer/orders/${encodeURIComponent(order.id)}/payment-plan`)}
      ${installmentSection}
      ${deliveryBlock}

      <section class="panel" style="margin-top:20px"><h3>出租前验机报告</h3>${preInspection ? `${report(preSnapshot, ['screen','keyboard','touchpad','body','camera','wifi','power'])}<small class="form-text">记录时间（墨尔本时间）：${esc(melbourneTime(preInspection.created_at))}</small>` : '<p>暂无出租前验机记录。</p>'}</section>
      ${returnInspection ? `<section class="panel" style="margin-top:20px"><h3>归还验机报告${deducted ? '与押金扣除' : ''}</h3>${deducted ? `<p><strong>扣除金额：</strong>${formatCurrency(Number(depositRefund.deduction_amount))}${depositRefund.deduction_reason ? ` · ${esc(depositRefund.deduction_reason)}` : ''}</p>` : ''}${report(returnData, ['screen_condition','keyboard_condition','trackpad_condition','body_condition','camera_condition','wifi_condition','power_test','damageDescription'])}${deducted ? `<form method="post" action="/customer/orders/${order.id}/inspection-dispute" style="margin-top:16px"><label class="form-label">提出异议</label><textarea class="form-control" name="message" required maxlength="2000" placeholder="请说明您对验机结果或押金扣除的异议"></textarea><button class="button button-warning" type="submit" style="margin-top:10px">提交异议</button></form>` : ''}</section>` : ''}

      ${changeHistory?.results?.length ? `<section class="panel" style="margin-top:20px"><h3>订单变更记录</h3>${changeHistory.results.map((item: any) => {
        let before: any = {}; let after: any = {}
        try { before = JSON.parse(item.before_json || '{}') } catch (_) {}
        try { after = JSON.parse(item.after_json || '{}') } catch (_) {}
        const diffs = diffOrderSnapshots(before, after).filter(d => d.field !== 'deviceId')
        const detail = diffs.length ? diffs.map(d => `${esc(d.label)}：${esc(String(d.before ?? '—'))} → ${esc(String(d.after ?? '—'))}`).join('；') : ''
        return `<p><strong>${melbourneTime(item.created_at)}</strong> · ${esc(ORDER_CHANGE_TYPE_LABELS[item.change_type] || item.change_type)}${detail ? `<br><span class="form-text">${detail}</span>` : ''}${item.reason ? `<br><span class="form-text">原因：${esc(item.reason)}</span>` : ''}</p>`
      }).join('')}</section>` : ''}

      ${(paymentSources.length || refundRows.length) ? `<section class="panel" style="margin-top:20px"><h3>付款与退款明细</h3>
        ${paymentSources.length ? `<h4 style="margin:12px 0 6px">付款 / 预授权</h4><dl class="data-list">${paymentSources.map((p: any) => { const displayAmount = p.payment_provider === 'square' && Number(p.square_paid_amount || 0) > 0 ? p.square_paid_amount : p.amount; return `<div><dt>${esc(p.payment_provider === 'square' ? '礼品卡' : PAYMENT_METHOD_LABELS[String(p.payment_method)] || p.payment_method)}${p.payment_provider === 'square' && Number(p.square_paid_amount || 0) > 0 ? '（已扣）' : p.status === 'pending' ? '（待结算）' : ''}</dt><dd>${formatCurrency(displayAmount)}</dd></div>` }).join('')}</dl>` : ''}
        ${refundRows.some((r: any) => Number(r.refund_amount) > 0) ? `<h4 style="margin:16px 0 6px">已退款</h4><dl class="data-list">${refundRows.filter((r: any) => Number(r.refund_amount) > 0).map((r: any) => `<div><dt>${esc(REFUND_TYPE_LABELS[String(r.type)] || r.type)}${r.refund_method ? ` · ${esc(PAYMENT_METHOD_LABELS[String(r.refund_method)] || r.refund_method)}` : ''}<br><span class="form-text">${melbourneTime(r.created_at)}</span></dt><dd>${formatCurrency(r.refund_amount)}</dd></div>`).join('')}</dl>` : ''}
        <p class="form-text" style="margin-top:12px">如对付款或退款金额有疑问，请联系您的专属客服。</p>
      </section>` : ''}

      ${['paid', 'pending_pickup'].includes(String(order.status)) && (!customerRefundRequest || customerRefundRequest.status === 'rejected') ? `<div class="panel" style="margin-top:20px;"><h3>更改预约时间</h3><p class="form-text">已收服务费不退款；更高时段将补收差额。</p><form method="post" action="/customer/orders/${order.id}/time-slots"><div class="grid grid-2"><div class="form-group"><label class="form-label">领取/送货时间</label><select class="form-control" name="pickupTimeSlot" required>${(String(order.deliveryMethod || order.delivery_method || 'Pickup') === 'Delivery' ? [['delivery_morning','9:00–12:00'],['delivery_afternoon','13:00–19:00']] : pickupTimeSlots(systemSettings.rentalRules)).map(([v,l]) => `<option value="${v}" ${v === order.pickupTimeSlot ? 'selected' : ''}>${l}</option>`).join('')}</select></div><div class="form-group"><label class="form-label">归还时间</label><select class="form-control" name="returnTimeSlot" required>${(String(order.deliveryMethod || order.delivery_method || 'Pickup') === 'Delivery' ? [['delivery_morning','9:00–12:00'],['delivery_afternoon','13:00–19:00']] : pickupTimeSlots(systemSettings.rentalRules)).map(([v,l]) => `<option value="${v}" ${v === order.returnTimeSlot ? 'selected' : ''}>${l}</option>`).join('')}</select></div></div><button class="button button-primary" type="submit">保存预约时间</button></form></div>` : ''}
      ${timeChanges?.results?.length ? `<div class="panel" style="margin-top:20px;"><h3>预约时间变更记录</h3>${timeChanges.results.map((change: any) => `<p>${melbourneTime(change.created_at)}：${change.previous_pickup_slot || '未设置'} / ${change.previous_return_slot || '未设置'} → ${change.pickup_slot} / ${change.return_slot}${Number(change.additional_service_fee) > 0 ? `，新增服务费 ${formatCurrency(change.additional_service_fee)}` : ''}</p>`).join('')}</div>` : ''}

      ${['paid', 'active', 'completed'].includes(order.status) || String(order.status) === 'pending_return' ? `<p><a class="button button-secondary" href="/orders/${order.id}/invoice">查看发票 / 收据</a>${order.status === 'active' ? (order.early_return_requested_at ? ' <span class="badge badge-warning">提前归还申请待审批</span>' : `<form method="post" action="/customer/orders/${order.id}/early-return" style="display:inline-block;margin-left:10px" data-site-confirm="确定申请提前归还此设备吗？将通知绑定员工和管理员。"><button class="button button-warning" type="submit">申请提前归还</button></form>`) : String(order.status) === 'pending_return' ? ' <span class="badge badge-warning">提前归还已批准，等待归还验机</span>' : ''}</p>` : ''}
      ${contract ? `
        <div class="section-title order-section-heading" style="margin-top: 24px;"><h3>合同详情 #${contract.contractNumber || '待生成'}</h3></div>
        <div class="contract-detail-meta"><span><small>合同状态</small><strong>${contract.status === 'signed' || contract.status === 'completed' ? '已签署' : contract.status === 'pending_sign' ? '待签署' : contract.status}</strong></span><span><small>签署时间（墨尔本）</small><strong>${formatMelbourneDateTime(contract.signedAt) || '尚未签署'}</strong></span><span><small>有效期</small><strong>${contract.validFrom || order.startDate} 至 ${contract.validUntil || order.endDate}</strong></span></div>
        <div class="contract-actions" style="margin-bottom: 16px; display: flex; gap: 12px;">
          ${contract.status === 'signed' ? `<a class="button" href="/contract/view/${contract.id}?from=order" target="_blank">查看/下载合同</a>` : `<span class="section-note">正式合同将在签署完成后开放下载。</span>`}
          ${contract.status === 'pending_sign' ? `<a class="button button-primary" href="/contract/sign?token=${encodeURIComponent(contract.signToken || '')}&step=1">签署租赁协议</a>` : ''}
        </div>
        ${['signed', 'completed'].includes(String(contract.status)) && (contract as any).verification_token ? `<p class="section-note">公开验证链接（不含个人信息）：<br><a href="/verify?number=${encodeURIComponent(contract.contractNumber || '')}&token=${encodeURIComponent((contract as any).verification_token)}" target="_blank">${new URL(c.req.url).origin}/verify?number=${encodeURIComponent(contract.contractNumber || '')}&token=${encodeURIComponent((contract as any).verification_token)}</a></p>` : ''}
        ${['signed', 'completed'].includes(String(contract.status)) ? `<section class="panel" style="margin-top:16px"><h3>Windows 登录账户</h3><p class="form-text">设备登录密码，不是网站登录密码，不支持修改。</p><div class="form-group"><label class="form-label" for="windowsPassword">Windows 登录密码</label><code id="windowsPassword" class="form-control mono" style="display:block;user-select:all;word-break:break-all;">${esc(windowsPassword || '暂未生成')}</code></div></section>` : ''}
      ` : '<p style="margin-top: 24px;">暂无相关租赁合同。</p>'}

      ${order.status === 'pending_payment' && (!customerRefundRequest || customerRefundRequest.status === 'rejected') ? `
        ${transferProof ? `<div class="payment-review-status payment-review-status--${transferProof.status === 'submitted' ? 'pending' : transferProof.status === 'rejected' ? 'failed' : 'success'}"><span class="payment-review-status__icon" aria-hidden="true"></span><div><strong>${transferProof.status === 'submitted' ? '转账凭证待审核' : transferProof.status === 'rejected' ? '转账审核未通过' : '转账审核已通过'}</strong><p>${transferProof.status === 'submitted' ? '管理员正在核对付款信息，请耐心等待。' : transferProof.status === 'rejected' ? `已驳回（${String(transferProof.rejection_reason || '').replace(/[&<>"']/g, '')}）` : '付款已确认，订单正在继续处理。'}</p></div></div>` : ''}
        <div class="section-title" style="margin-top: 24px;"><h3>支付信息</h3></div>
        <div class="alert"><div><strong>收款明细</strong>${monthlyPayment ? `<p>首期租金及服务费 ${formatCurrency(firstMonthly!.rental_amount)} ＋ 押金 ${formatCurrency(deposit)} ＋ 支付手续费 ${formatCurrency(stripeFee)} ＝ ${formatCurrency(stripeTotal)}。</p><p>继续付款即同意每 30 天自动扣取下一期租金。</p>` : depositMode === 'PREAUTH' ? `
          <p style="margin:8px 0 0">信用卡一次性预授权 ${formatCurrency(stripeTotal)}（租金及服务费 ${formatCurrency(immediatelyPaidAmount)} ＋ 押金 ${formatCurrency(deposit)} ＋ 手续费 ${formatCurrency(stripeFee)}）。</p>
          <p style="margin:6px 0 0">退回余额：捕获全部预授权；原路退回：仅捕获租金、手续费及实际扣款。</p>
        ` : `
          <p style="margin:8px 0 0">租金 ${formatCurrency(rentalAmount)} ＋ 时段服务费 ${formatCurrency(serviceFee)} ＝ ${formatCurrency(immediatelyPaidAmount)}；${depositMode === 'SETUP_INTENT' ? `押金 ${formatCurrency(deposit)} 不预扣` : `押金 ${formatCurrency(deposit)} 按${securityDepositMethodLabel(depositMethod)}单独处理`}。</p>
          <p style="margin:6px 0 0">Stripe 手续费按租金及服务费计算 ${formatCurrency(stripeFee)}，付款合计 ${formatCurrency(stripeTotal)}。</p>
        `}</div></div>
        <div class="payment-options" style="display: flex; gap: 20px; margin-top: 16px;">
          ${order.paymentMethod === 'bank_transfer' ? `<div class="payment-card">
            <h4>银行转账</h4>
            <p><strong>银行名称:</strong> ${systemSettings.bankDetails.bankName || '—'}</p>
            <p><strong>BSB:</strong> ${systemSettings.bankDetails.bsb}</p>
            <p><strong>账号:</strong> ${systemSettings.bankDetails.account}</p>
            <p>请转账 ${formatCurrency(orderPaymentDue)} 到以上账户，并在备注中填写合同编号 ${contract?.contractNumber || order.contractId}。</p>
            ${transferProof?.status === 'submitted' ? '<div class="payment-waiting-note"><span>转账信息已提交，正在等待管理员审核</span></div>' : `<form method="post" enctype="multipart/form-data" action="/customer/orders/${order.id}/bank-transfer-proof">
              <label class="form-label" for="referenceNumber">银行 Reference</label>
              <input class="form-control" id="referenceNumber" name="referenceNumber" maxlength="100" required>
              <label class="form-label" for="proofImageFile">转账凭证图片</label>
              <input class="form-control" type="file" id="proofImageFile" name="imageFile" accept="image/jpeg,image/png,image/webp" required>
              <small class="form-text">支持 JPG、PNG、WebP，单张不超过 5MB。</small>
              <label class="form-label" for="transferNote">备注（选填）</label>
              <textarea class="form-control" id="transferNote" name="note" maxlength="500"></textarea>
              <button class="button" type="submit" style="margin-top:12px">提交转账信息</button>
            </form>`}
          </div>` : ''}
          ${['alipay', 'wechat'].includes(String(order.paymentMethod)) ? `<div class="payment-card"><h4>${order.paymentMethod === 'alipay' ? '支付宝' : '微信'}（人民币）</h4><p id="rmb-order-summary">提交付款凭证前获取实时汇率并计算人民币金额。</p><img src="${order.paymentMethod === 'alipay' ? systemSettings.rmbPayment.alipayQrUrl : systemSettings.rmbPayment.wechatQrUrl}" alt="${order.paymentMethod === 'alipay' ? '支付宝' : '微信'}收款码" loading="lazy" style="max-width:240px;display:block;margin:12px 0"><form method="POST" enctype="multipart/form-data" action="/customer/orders/${order.id}/bank-transfer-proof"><label class="form-label">付款 Reference</label><input class="form-control" name="referenceNumber" maxlength="100" required><label class="form-label">付款凭证图片</label><input class="form-control" type="file" name="imageFile" accept="image/jpeg,image/png,image/webp" required><label class="form-label">备注（选填）</label><textarea class="form-control" name="note" maxlength="500"></textarea><button class="button" type="submit" style="margin-top:12px">提交付款凭证</button></form><script>(()=>{const s=document.getElementById('rmb-order-summary');fetch('/api/payment/aud-cny?amount=${encodeURIComponent(String(orderPaymentDue))}').then(r=>r.ok?r.json():Promise.reject()).then(d=>{s.innerHTML='请支付 <strong>CNY '+Number(d.cnyAmount).toFixed(2)+'</strong>，1 AUD = '+Number(d.rate).toFixed(6)+' CNY。'}).catch(()=>{s.textContent='暂时无法获取实时汇率，请稍后重试。'})})()</script></div>` : ''}
          ${squarePaymentSelected && systemSettings.paymentMethods.square ? `<div class="payment-card">
            <h4>礼品卡支付</h4>
            ${squarePaidAmount > 0 ? `<p>礼品卡已扣除 ${formatCurrency(squarePaidAmount)}（含礼品卡手续费），付款已完成。</p>` : `<p>礼品卡余额不足的部分可用其他方式支付。</p>${renderSquareGiftCardPaymentBox({ configUrl: `/customer/orders/${order.id}/square/config`, paymentUrl: `/customer/orders/${order.id}/square/payment`, returnUrl: `/customer/orders/${order.id}`, buttonLabel: `使用礼品卡支付 ${formatCurrency(squareTotal)}`, domId: 'order-square-gift-card-pay', stored: Boolean((order as any).square_gift_card_id || (order as any).squareGiftCardId), showStripeRemainder: false })}`}
          </div>` : ''}
          ${systemSettings.paymentMethods.stripe && (!squarePaymentSelected || squarePaidAmount > 0) ? `<div class="payment-card">
            <h4>信用卡支付（Stripe）</h4>
            <p>${squarePaymentSelected ? '礼品卡先扣款，实际扣减额会显示在订单金额中；剩余租金及服务费使用 Stripe 支付。' : ''}在本页填写卡信息完成支付，卡号由 Stripe 处理。</p>
            ${monthlyPayment ? `<dl class="data-list"><div><dt>首期租金及服务费</dt><dd>${formatCurrency(firstMonthly!.rental_amount)}</dd></div><div><dt>押金</dt><dd>${formatCurrency(deposit)}</dd></div><div><dt>支付手续费</dt><dd>${formatCurrency(stripeFee)}</dd></div><div><dt>首期合计</dt><dd>${formatCurrency(stripeTotal)}</dd></div></dl>` : depositMode === 'PREAUTH' && !(squarePaymentSelected && squarePaidAmount > 0) ? `<dl class="data-list" style="margin:8px 0"><div><dt><strong>信用卡预授权总额</strong></dt><dd><strong>${formatCurrency(stripeDisplayAmount)}</strong></dd></div></dl><p class="form-text">包含租金及服务费、押金和手续费。</p><p class="form-text" style="margin-top:4px">退回余额：捕获全部预授权；原路退回：仅捕获租金、手续费及实际扣款。</p>` : `<dl class="data-list" style="margin:8px 0"><div><dt>${squarePaymentSelected && squarePaidAmount > 0 ? '礼品卡扣减后 Stripe 剩余（含礼品卡手续费）' : '租金及服务费'}</dt><dd>${formatCurrency(squarePaymentSelected && squarePaidAmount > 0 ? stripeDisplayAmount : Number(order.totalAmount) - deposit)}</dd></div>${squarePaymentSelected && squarePaidAmount > 0 ? '' : `<div><dt>Stripe 租金及服务费支付手续费（2.5%）</dt><dd>${formatCurrency(stripeFee)}</dd></div>`}<div><dt><strong>${squarePaymentSelected && squarePaidAmount > 0 ? 'Stripe 待支付金额' : '信用卡最终扣款'}</strong></dt><dd><strong>${formatCurrency(stripeDisplayAmount)}</strong></dd></div></dl><p class="form-text">${depositMode === 'SETUP_INTENT' ? `押金 ${formatCurrency(deposit)} 使用 SetupIntent 保存卡片，不预扣，仅损坏或逾期时扣款。` : '押金按订单约定处理。'}</p><p class="form-text" style="margin-top:4px">手续费不计入押金。</p>`}
            ${renderStripePaymentBox({ intentUrl: `/customer/orders/${order.id}/stripe/intent`, returnUrl: `/payment/result?orderId=${encodeURIComponent(order.id)}`, buttonLabel: `${depositMode === 'PREAUTH' && !(squarePaymentSelected && squarePaidAmount > 0) ? '预授权' : '支付'} ${formatCurrency(stripeDisplayAmount)}`, domId: 'order-stripe-pay' })}
          </div>` : ''}
        </div>
        ${squarePaymentSelected && squarePaidAmount > 0 ? `<div class="payment-card" style="margin-top:16px"><h4>剩余应付金额</h4><p>礼品卡扣款后，剩余差价 ${formatCurrency(squareRemainingAmount)}${squareDepositDue > 0 ? `＋押金 ${formatCurrency(squareDepositDue)}` : ''}，合计 <strong>${formatCurrency(squareResidualTotal)}</strong>。请选择一种方式完成支付。</p>${systemSettings.paymentMethods.bankTransfer ? `<form method="post" action="/customer/orders/${order.id}/switch-payment-method" style="display:inline-block;margin-right:8px"><input type="hidden" name="paymentMethod" value="bank_transfer"><button class="button button-secondary" type="submit">选择银行转账</button></form>` : ''}<form method="post" action="/customer/orders/${order.id}/switch-payment-method" style="display:inline-block"><input type="hidden" name="paymentMethod" value="balance"><button class="button button-secondary" type="submit">使用账户余额</button></form></div>` : ''}
        ${!squarePaymentSelected && ['card', 'stripe'].includes(String(order.paymentMethod)) ? (() => {
          const alternatives: Array<{ value: string; label: string }> = []
          if (systemSettings.paymentMethods.square && !squarePaymentSelected) alternatives.push({ value: 'square', label: '礼品卡' })
          if (systemSettings.paymentMethods.bankTransfer) alternatives.push({ value: 'bank_transfer', label: '银行转账' })
          if (systemSettings.paymentMethods.alipay && systemSettings.rmbPayment.alipayQrUrl) alternatives.push({ value: 'alipay', label: '支付宝' })
          if (systemSettings.paymentMethods.wechat && systemSettings.rmbPayment.wechatQrUrl) alternatives.push({ value: 'wechat', label: '微信' })
          if (!alternatives.length) return ''
          return `<p class="form-text" style="margin-top:16px">信用卡支付遇到问题？可以改用：${alternatives.map(item => `<form method="post" action="/customer/orders/${order.id}/switch-payment-method" style="display:inline-block;margin-left:8px"><input type="hidden" name="paymentMethod" value="${item.value}"><button class="button button-sm button-secondary" type="submit">${item.label}</button></form>`).join('')}</p>`
        })() : ''}
        <form method="post" action="/customer/orders/${order.id}/cancel" style="margin-top:16px" data-site-confirm="取消后订单终止，已付金额按退款政策处理。" data-confirm-variant="danger" data-confirm-title="取消订单？" data-confirm-label="取消订单"><button class="button button-secondary" type="submit">取消订单</button></form>
      ` : ''}
      ${squareDepositPending ? `<section class="panel" style="margin-top:20px"><h3>押金支付</h3>${systemSettings.paymentMethods.stripe && transferProof?.status !== 'submitted' ? `<div class="payment-card"><h4>Stripe 支付押金</h4>${renderStripePaymentBox({ intentUrl: `/customer/orders/${order.id}/stripe/deposit-intent`, returnUrl: `/customer/orders/${order.id}`, buttonLabel: `使用 Stripe 支付押金 ${formatCurrency(deposit)}`, domId: 'order-square-stripe-deposit-pay' })}</div>` : ''}<div class="payment-card"><h4>银行转账支付押金</h4><p><strong>银行名称:</strong> ${systemSettings.bankDetails.bankName || '—'}<br><strong>BSB:</strong> ${systemSettings.bankDetails.bsb}<br><strong>账号:</strong> ${systemSettings.bankDetails.account}</p>${transferProof?.status === 'submitted' ? '<div class="payment-waiting-note"><span>押金转账凭证已提交，正在等待管理员审核。</span></div>' : transferProof?.status === 'rejected' ? `<div class="alert">押金转账凭证未通过审核：${esc(transferProof.rejection_reason || '请重新提交正确的凭证。')}</div>` : `<form method="POST" enctype="multipart/form-data" action="/customer/orders/${order.id}/bank-transfer-proof"><input type="hidden" name="depositProof" value="1"><label class="form-label" for="squareDepositReference">银行 Reference</label><input class="form-control" id="squareDepositReference" name="referenceNumber" maxlength="100" required><label class="form-label" for="squareDepositProofImage">转账凭证图片链接</label><input class="form-control" type="url" id="squareDepositProofImage" name="imageUrl" placeholder="https://图床域名/凭证图片.jpg" required><small class="form-text">请先上传到图床，再粘贴公开 HTTPS 图片链接。</small><label class="form-label" for="squareDepositNote">备注（选填）</label><textarea class="form-control" id="squareDepositNote" name="note" maxlength="500"></textarea><button class="button button-secondary" type="submit" style="margin-top:12px">提交押金转账凭证</button></form>`}</div></section>` : ''}
      ${(priceAdjustmentSummary.amountDue > 0 || priceAdjustmentSummary.pendingDepositRefund > 0) && !['pending_payment', 'completed', 'cancelled'].includes(String(order.status)) ? `<section class="panel" style="margin-top:20px"><h3>订单差价</h3>${priceAdjustmentSummary.pendingDepositRefund > 0 ? `<div class="alert"><strong>订单已下调，待退差价 ${formatCurrency(priceAdjustmentSummary.pendingDepositRefund)}。</strong>由于您使用${order.paymentMethod === 'bank_transfer' ? '银行转账' : order.paymentMethod === 'alipay' ? '支付宝' : '微信'}付款，差价将在管理员退押金时一并退还。</div>` : ''}${priceAdjustmentSummary.amountDue > 0 ? `<div class="alert"><strong>订单价格已增加，需要补交 ${formatCurrency(priceAdjustmentSummary.amountDue)}。</strong>${order.paymentMethod === 'balance' ? `余额支付后当前余额 ${formatCurrency(currentBalance)}，请使用下方其他支付方式补交差价。` : transferPayment ? '转账类付款请提交差价凭证，管理员审核后生效。' : squarePaymentSelected ? '礼品卡补差价不收 Stripe 手续费；退款时仅退回账户余额。' : `信用卡支付含手续费 ${formatCurrency(priceAdjustmentSummary.processingFee)}，本次实际扣款 ${formatCurrency(priceAdjustmentSummary.chargedAmount)}。`}</div>` : ''}
        ${priceAdjustmentPaymentContent}
      </section>` : (priceAdjustmentSummary.refundedPrincipal > 0 && !['pending_payment', 'completed', 'cancelled'].includes(String(order.status)) ? `<section class="panel" style="margin-top:20px"><h3>订单差价</h3><div class="alert">订单下调差价 ${formatCurrency(priceAdjustmentSummary.refundedPrincipal)} 已自动退回。</div></section>` : '')}
      <script>(function(){window.addEventListener('square-payment-updated',function(event){var detail=event.detail||{};var node=document.getElementById('square-payment-summary');if(!node)return;var paid=Number(detail.squarePaidAmountCents||0)/100;var remaining=Number(detail.remainingAmountCents||0)/100;node.hidden=paid<=0;node.innerHTML='<strong>礼品卡已扣:</strong> AUD$ '+paid.toFixed(2)+(remaining>0?'；Stripe 剩余 AUD$ '+remaining.toFixed(2):'');});})();</script>
    </div>
  `
  return buildLayout('订单详情 - 电脑租赁管理系统', body.replace('礼品卡补差价不收 Stripe 手续费；退款时仅退回账户余额。', `礼品卡补差价含 ${(squareFeeRate * 100).toFixed(2)}% 手续费；退款时仅退回账户余额。`), user)
}
