/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

import { Context } from 'hono';
import { User, getDeviceById, getDeviceRentalRules, getContractTemplate, getSystemSettings, loadSystemSettingsFromDB, hasDeviceBookingConflict, Order, Contract, buildLayout, insertOrder, insertContract, generateContractNumber, generateReferenceNumber } from '../../site';
import { findEligibleCoupon, calculateCouponDiscount } from '../coupons';
import { nanoid } from 'nanoid';
import { calculateRentalFee } from '../../domain/rentalPricing';
import { depositPaymentModeForRental } from '../../domain/paymentPlan';
import { isPickupPeriodClosed, pickupClosureConfig } from '../../domain/pickupTimeSlots';

export async function handleCreateContractAction(c: Context, user: User, body: Record<string, string>, options: { errorPath?: string; rentalLinkId?: string; directSigning?: boolean } = {}): Promise<Response> {
  const errorPath = options.errorPath || '/staff/contracts/new'
  // 提交失败回到表单时回填已填内容（白名单字段，避免把任意键塞进 URL）。
  const PREFILL_KEYS = ['deviceId', 'startDate', 'endDate', 'startPeriod', 'endPeriod', 'deliveryMethod', 'returnMethod', 'pickupLocation', 'returnLocation', 'deviceCondition', 'deviceAccessories', 'lateFeePerDay', 'repairCost', 'deliveryFee', 'deliveryStreet', 'deliverySuburb', 'deliveryState', 'deliveryPostcode', 'expiryDuration']
  const failRedirect = (message: string) => {
    const query = new URLSearchParams({ error: message })
    for (const key of PREFILL_KEYS) { const value = String(body[key] ?? '').trim(); if (value) query.set(key, value.slice(0, 500)) }
    return c.redirect(`${errorPath}?${query.toString()}`)
  }
  const { deviceId, startDate, endDate, validFrom, validUntil, expiryDuration, deviceCondition, deviceAccessories, returnLocation } = body;
  const startPeriod = body.startPeriod === 'PM' ? 'PM' : 'AM'
  const endPeriod = body.endPeriod === 'PM' ? 'PM' : 'AM'
  const deliveryMethod = body.deliveryMethod === 'Delivery' ? 'Delivery' : 'Pickup'
  const deliveryFeeText = String(body.deliveryFee || '').trim()
  const deliveryFee = deliveryMethod === 'Delivery' ? Number(deliveryFeeText) : 0
  const returnMethod = deliveryMethod === 'Delivery' && body.returnMethod === 'CourierPickup' ? 'CourierPickup' : 'StoreReturn'
  await loadSystemSettingsFromDB(c)
  const allowedLocations = getSystemSettings().companyDetails.pickupLocations
  let returnLocationValue = String(returnLocation || '').trim()
  let pickupLocationValue = String(body.pickupLocation || '').trim()
  let deliveryAddressData: Record<string, string> = {}
  if (deliveryMethod === 'Pickup') {
    if (!pickupLocationValue) return failRedirect('请选择自取地点')
    if (user.role !== 'ADMIN' && !allowedLocations.includes(pickupLocationValue)) return failRedirect('员工只能选择管理员配置的自取地点')
  } else {
    const street = String(body.deliveryStreet || '').trim()
    const suburb = String(body.deliverySuburb || '').trim()
    const state = String(body.deliveryState || '').trim().toUpperCase()
    const postcode = String(body.deliveryPostcode || '').trim()
    if (!street || !suburb || !['VIC', 'NSW', 'QLD', 'SA', 'WA', 'TAS', 'NT', 'ACT'].includes(state) || !/^\d{4}$/.test(postcode)) return failRedirect('请填写完整有效的澳洲送货地址')
    pickupLocationValue = `${street}, ${suburb} ${state} ${postcode}, Australia`
    deliveryAddressData = { delivery_address: pickupLocationValue, delivery_street: street, delivery_suburb: suburb, delivery_state: state, delivery_postcode: postcode, delivery_place_id: String(body.deliveryPlaceId || '').trim().slice(0, 300) }
  }
  if (returnMethod === 'CourierPickup') {
    returnLocationValue = pickupLocationValue
  } else if (!returnLocationValue || (user.role !== 'ADMIN' && !allowedLocations.includes(returnLocationValue))) {
    return failRedirect('请选择管理员配置的归还店铺')
  }

  if (!deviceId || !startDate || !endDate) {
    return failRedirect('设备、开始日期和结束日期均为必填项');
  }
  const lateFeePerDay = Number(body.lateFeePerDay)
  const repairCost = body.repairCost === '' ? null : Number(body.repairCost)
  if (!deviceCondition?.trim() || !Number.isFinite(lateFeePerDay) || lateFeePerDay < 0 || (deliveryMethod === 'Delivery' && !deliveryFeeText) || !Number.isFinite(deliveryFee) || deliveryFee < 0 || (repairCost !== null && (!Number.isFinite(repairCost) || repairCost < 0))) {
    return failRedirect('请填写设备状况、取还地点及有效的非负费用');
  }

  const device = await getDeviceById(c, deviceId);

  const normalizedStatus = String(device?.status || '').toLowerCase();
  if (!device || ['maintenance', 'retired'].includes(normalizedStatus)) return failRedirect('维修或退役设备不能新建合同')
  const rentalRules = await getDeviceRentalRules(c, deviceId)
  const closure = pickupClosureConfig(rentalRules)
  if (isPickupPeriodClosed(startDate, startPeriod, closure) || isPickupPeriodClosed(endDate, endPeriod, closure)) return failRedirect('所选时间不营业，请重新选择取还时间')
  const start = new Date(startDate);
  const end = new Date(endDate);
  const todayValue = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Melbourne', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  if (startDate < todayValue || endDate < todayValue) {
    return failRedirect('开始日期和结束日期必须是今天或之后的日期');
  }
  if (start > end) {
    return failRedirect('租赁结束日期必须晚于开始日期');
  }
  const melbourneNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'Australia/Melbourne' }))
  const melbourneMinutes = melbourneNow.getHours() * 60 + melbourneNow.getMinutes()
  const periodPassed = (date: string, period: string) => date === todayValue && melbourneMinutes >= (period === 'AM' ? 12 * 60 : 23 * 60)
  const halfDays = Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) * 2 + (endPeriod === 'PM' ? 1 : 0) - (startPeriod === 'PM' ? 1 : 0)
  if (halfDays <= 0) return failRedirect('归还时段必须晚于取货时段')
  const rentalPeriod = Math.ceil(halfDays / 2);
  if (rentalPeriod < rentalRules.minimumRentalDays) return failRedirect(`最短租赁时间为 ${rentalRules.minimumRentalDays} 天`)
  const unavailable = new Set(rentalRules.unavailableDates)
  for (let day = new Date(startDate); day <= new Date(endDate); day.setDate(day.getDate() + 1)) if (unavailable.has(day.toISOString().slice(0, 10))) return failRedirect('该设备包含管理员设置的不可用日期')
  const periodSlots = (period: string) => period === 'AM' ? ['morning_service', 'morning'] : ['afternoon', 'evening_service']
  const periodBlocked = (date: string, period: string) => periodSlots(period).every(slot => (rentalRules.unavailableTimeSlots?.[date] || []).includes(slot))
  for (let day = new Date(startDate); day <= new Date(endDate); day.setDate(day.getDate() + 1)) {
    const date = day.toISOString().slice(0, 10)
    for (const period of ['AM', 'PM']) {
      const index = Math.round(Date.parse(`${date}T00:00:00Z`) / 86400000) * 2 + (period === 'PM' ? 1 : 0)
      const requestStart = Math.round(Date.parse(`${startDate}T00:00:00Z`) / 86400000) * 2 + (startPeriod === 'PM' ? 1 : 0)
      const requestEnd = Math.round(Date.parse(`${endDate}T00:00:00Z`) / 86400000) * 2 + (endPeriod === 'PM' ? 1 : 0)
      if (requestStart <= index && index < requestEnd && (periodBlocked(date, period) || periodPassed(date, period))) return failRedirect('所选上午/下午时段已过或不可用')
    }
  }
  if (await hasDeviceBookingConflict(c, deviceId, startDate, endDate, undefined, rentalRules.bufferDays, startPeriod, endPeriod)) return failRedirect('该设备在所选日期或缓冲时间内已有订单')
  const sameDayBookings = ((await c.env.RENT.prepare(`SELECT startDate, endDate, startPeriod, endPeriod FROM orders WHERE deviceId = ? AND status NOT IN ('completed', 'cancelled') AND (startDate = ? OR endDate = ? OR startDate = ? OR endDate = ?)`)
    .bind(deviceId, startDate, startDate, endDate, endDate).all()).results || []) as any[]
  if (sameDayBookings.some(item => (item.startDate === startDate && item.startPeriod === startPeriod) || (item.endDate === startDate && item.endPeriod === startPeriod))) return failRedirect('该设备的取货时段已被出租')
  if (sameDayBookings.some(item => (item.startDate === endDate && item.startPeriod === endPeriod) || (item.endDate === endDate && item.endPeriod === endPeriod))) return failRedirect('该设备的归还时段已被出租')

  const dailyRate = device.pricePerDay;
  const depositAmount = device.depositAmount;
  const couponCode = String(body.couponCode || '').trim().toUpperCase().slice(0, 40)
  const rentAmount = calculateRentalFee(device, rentalPeriod)
  const couponFeeParts = { rentalFee: rentAmount, deliveryFee, depositFee: depositAmount }
  let discountAmount = 0
  let appliedCouponCode: string | null = null
  if (couponCode) {
    // The order's userId is only a staff placeholder until the customer signs, so
    // customer-specific eligibility (max_uses_per_customer / new_customer_only) can't
    // be checked yet. This only previews the discount for the sign link; the coupon
    // is not reserved (used_count untouched, no coupon_redemptions row) until the real
    // customer is known — see signContract.ts step 4.
    let coupon: any
    try {
      coupon = await findEligibleCoupon(c, couponCode, device, couponFeeParts)
    } catch (error: any) {
      return failRedirect(error?.message || '优惠码无效')
    }
    discountAmount = calculateCouponDiscount(coupon, couponFeeParts)
    appliedCouponCode = String(coupon.code).toUpperCase()
  }
  const totalAmount = rentAmount + depositAmount + deliveryFee - discountAmount;

  const orderId = `o-${nanoid(8)}`;
  const contractId = `ct-${nanoid(10)}`;
  const signToken = nanoid(32);

  const newOrder: Order = {
    id: orderId,
    orderNo: generateReferenceNumber('OD'),
    userId: user.id, // 临时用户ID，将在客户签署时更新
    deviceId: deviceId,
    startDate: startDate,
    endDate: endDate,
    startPeriod, endPeriod,
    pickupTimeSlot: null,
    returnTimeSlot: null,
    pickupLocation: pickupLocationValue,
    returnLocation: returnLocationValue,
    deliveryMethod: deliveryMethod as any,
    deliveryFee: deliveryFee as any,
    rentalNote: String(body.rentalNote || '').trim().slice(0, 500) as any,
    rentalPeriod: rentalPeriod, // 添加 rentalPeriod
    status: 'draft',
    rental_link_id: options.rentalLinkId || null, booking_buffer_days: options.rentalLinkId ? rentalRules.bufferDays : 0,
    paymentMethod: 'card',
    totalAmount: totalAmount,
    depositAmount: depositAmount,
    dailyRate: dailyRate,
    // The orders table may enforce contractId -> contracts(id). The contract
    // must exist before this field can be populated.
    contractId: null,
    signedAt: null,
    createdAt: new Date().toISOString(), couponCode: appliedCouponCode, discountAmount
    // created_by 在部分旧代码/表结构中存在，这里与 Order 类型对齐使用 createdAt
    // createdAtBy: user.id,
  } as any;

  // 设置签约链接过期时间，使用用户选择的天数
  const signExpiresDate = new Date();
  const expiryDays = parseInt(expiryDuration) || 7;
  signExpiresDate.setDate(signExpiresDate.getDate() + expiryDays);

  // 签署前先生成符合正式格式的可读编号；完成签署时会用签署时间重新生成一次。
  const contractNumber = generateContractNumber();

  const template = await getContractTemplate(c)
  const newContract: Contract = {
    id: contractId,
    rentalId: orderId,
    contractNumber: contractNumber,
    content: template.content,
    status: 'pending_sign',
    signedAt: null,
    signToken: signToken,
    createdAt: new Date().toISOString(),
    signExpiresAt: options.rentalLinkId ? new Date(Date.now() + 30 * 60000).toISOString() : signExpiresDate.toISOString(), // 设置过期时间
    validFrom: validFrom || null, // Add validFrom
    validUntil: validUntil || null, // Add validUntil
    createdBy: user.id, // 记录合同创建人，用于权限控制
    device_condition: deviceCondition.trim(),
    device_accessories: deviceAccessories?.trim() || null,
    late_fee_per_day: lateFeePerDay,
    repair_cost: repairCost,
    pickup_location: pickupLocationValue,
    return_location: returnLocationValue,
    contract_data: { invoice_number: '', delivery_method: deliveryMethod, delivery_fee: deliveryFee.toFixed(2), return_method: returnMethod, pickup_location: pickupLocationValue, return_location: returnLocationValue, ...deliveryAddressData, agreement_version: '1.0' },
  };

  const latestInspection = await c.env.RENT.prepare("SELECT snapshot_json FROM device_inspections WHERE deleted_at IS NULL AND device_id = ? ORDER BY created_at DESC LIMIT 1").bind(deviceId).first() as any
  let inspectionSnapshot: Record<string, any> = {}
  try { inspectionSnapshot = JSON.parse(latestInspection?.snapshot_json || '{}') } catch (_) {}
  if (String(device.agent_status || '').toLowerCase() === 'online') {
    Object.assign(inspectionSnapshot, {
      hostname: device.agent_hostname,
      osVersion: device.agent_os_version,
      cpu: device.agent_cpu,
      memoryMb: device.agent_memory_mb,
      storageFreeBytes: device.agent_storage_free_bytes,
      agentVersion: device.agent_version,
      detectedSerialNumber: device.agent_detected_serial,
    })
  }
  Object.assign(inspectionSnapshot, {
    deviceName: device.name,
    deviceId,
    inspectionDate: new Date().toISOString().slice(0, 10),
    inspectionBy: user.name || user.id,
    source: 'contract_creation',
  })
  try { await insertOrder(c, newOrder) } catch (error) {
    if (options.rentalLinkId && /RENTAL_LINK_/.test(String(error))) return failRedirect('所选租期已被预订，或租赁链接已停用，请重新选择。')
    throw error
  }
  await c.env.RENT.prepare('UPDATE orders SET deposit_method = ?, deposit_payment_mode = ? WHERE id = ?')
    .bind('bank_transfer', depositPaymentModeForRental(rentalPeriod, false), orderId).run()
  await insertContract(c, newContract);
  await c.env.RENT.prepare('UPDATE orders SET contractId = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?').bind(contractId, orderId).run();
  await c.env.RENT.prepare('INSERT INTO device_inspections (id, device_id, rental_id, inspection_type, snapshot_json, differences_json, performed_by) VALUES (?, ?, ?, \'before_rental\', ?, ?, ?)').bind(`inspection-${nanoid(12)}`, deviceId, orderId, JSON.stringify(inspectionSnapshot), JSON.stringify({}), user.id).run();
  await c.env.RENT.prepare('UPDATE devices SET inspection_requested_at = CURRENT_TIMESTAMP WHERE id = ?').bind(deviceId).run();

  const fullSignUrl = `${new URL(c.req.url).origin}/contract/sign?token=${newContract.signToken}&step=1`;
  if (options.directSigning) return c.redirect(fullSignUrl, 303)
  const successPage = `
    <div class="panel">
      <h2>签约链接已生成</h2>
      <p>请将以下链接发送给客户进行签署：</p>
      <div class="alert" style="background:#e0f2fe;border-color:#bae6fd; padding: 16px; border-radius: 8px;">
        <div style="word-break: break-all; margin-bottom: 16px; font-size: 14px; line-height: 1.5;">${fullSignUrl}</div>
        <button id="copy-button" class="button button-primary">复制链接</button>
      </div>
      <div style="margin-top: 24px;">
        <a href="/staff/contracts" class="button">返回合同列表</a>
      </div>
    </div>
    <script>
      document.getElementById('copy-button').addEventListener('click', function() {
        navigator.clipboard.writeText("${fullSignUrl}").then(function() {
          const button = document.getElementById('copy-button');
          button.innerText = '已复制!';
          button.disabled = true;
          setTimeout(function() {
            button.innerText = '复制链接';
            button.disabled = false;
          }, 2000);
        }, function(err) {
          console.error('无法复制链接: ', err);
          if (window.siteToast) window.siteToast('复制失败，请手动复制链接', 'error'); else alert('复制失败，请手动复制链接');
        });
      });
    </script>`;

  return new Response(buildLayout('签约链接 - 电脑租赁管理系统', successPage, user), {
    headers: { 'Content-Type': 'text/html; charset=utf-8' }
  });
}
