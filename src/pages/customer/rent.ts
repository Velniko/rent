/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

import { renderC2CPhotoGallery } from '../partials/c2cPhotos';
import { c2cBookingError } from '../../services/c2c';
import { rentalPricingClientScript } from '../../domain/rentalPricing';
import { buildLayout, getDeviceById, formatCurrency, getDeviceRentalRules } from '../../site';
import { HALF_HOUR_TIME_OPTIONS, legacyPickupSlot, pickupTimeSlots, serviceFeeRate, pickupClosureConfig, isPickupPeriodClosed } from '../../domain/pickupTimeSlots';
import { escapeHtml } from '../../lib/html';
import type { Context } from 'hono';

export interface RentFormPrefill {
  startDate?: string
  endDate?: string
  startPeriod?: string
  endPeriod?: string
  deliveryMethod?: string
  pickupTimeSlot?: string
  returnTimeSlot?: string
  deliveryAddress?: string
  rentalNote?: string
  couponCode?: string
}

export async function renderCustomerRent(c: Context, deviceId: string, user: any, errorMessage?: string, prefill: RentFormPrefill = {}) {
  const bookingError = await c2cBookingError(c,deviceId,user.id);
  if (bookingError) return buildLayout('设备租赁', `<div class="panel"><p>${bookingError}</p><a class="button" href="/customer/devices">可租设备</a></div>`,user);
  const device = await getDeviceById(c, deviceId);

  if (!device) {
    return buildLayout('租赁设备 - 电脑租赁管理系统', '<div class="panel"><h2>设备未找到</h2><p>您请求租赁的设备不存在。</p></div>', user);
  }
  const listingPhotos = await c.env.RENT.prepare('SELECT photos_json,pickup_address,listing_mode FROM c2c_listings WHERE device_id=?').bind(deviceId).first() as {photos_json:string;pickup_address:string;listing_mode:string} | null;
  const selfDelivery=listingPhotos?.listing_mode==='self';
  const rentalRules = await getDeviceRentalRules(c, deviceId)
  const pickupSlots = pickupTimeSlots(rentalRules)
  const bookingRanges = ((await c.env.RENT.prepare("SELECT startDate, endDate, startPeriod, endPeriod FROM orders WHERE deviceId = ? AND deleted_at IS NULL AND status NOT IN ('completed', 'cancelled')").bind(deviceId).all()).results || []) as any[]

  // Do not use toISOString() here: UTC can already be tomorrow while the
  // customer is still on the previous local calendar date.
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Melbourne', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

  // 校验失败重新渲染时保留用户已填内容，避免整页重填。
  const attr = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] || ch))
  const prefilledStart = attr(prefill.startDate)
  const prefilledEnd = attr(prefill.endDate)
  const prefilledStartPeriod = prefill.startPeriod === 'PM' ? 'PM' : 'AM'
  const prefilledEndPeriod = prefill.endPeriod === 'PM' ? 'PM' : 'AM'
  const prefilledDelivery = prefill.deliveryMethod === 'Delivery' ? 'Delivery' : 'Pickup'
  const prefilledPickup = String(prefill.pickupTimeSlot ?? '')
  const prefilledReturn = String(prefill.returnTimeSlot ?? '')
  const prefilledAddress = attr(prefill.deliveryAddress)
  const prefilledNote = String(prefill.rentalNote ?? '')
  const prefilledCoupon = attr(prefill.couponCode)

  const body = `
    <div class="panel">
      <div class="section-title"><h2>租赁设备: ${escapeHtml(device.name)}</h2></div>
      ${errorMessage ? `<div data-flash-notice class="page-notification page-notification--error">${errorMessage}</div>` : ''}
      ${renderC2CPhotoGallery(listingPhotos?.photos_json)}${listingPhotos?`<div class="c2c-address-card"><strong>取件地址</strong><p>${escapeHtml(listingPhotos.pickup_address)}</p></div>`:''}<form method="POST" action="/customer/rent/${device.id}">
        <div class="form-group">
          <label class="form-label" for="deviceName">设备名称</label>
          <input type="text" id="deviceName" class="form-control" value="${escapeHtml(device.name)}" readonly />
        </div>
        <div class="form-group">
          <label class="form-label" for="deviceModel">型号</label>
          <input type="text" id="deviceModel" class="form-control" value="${escapeHtml(device.model)}" readonly />
        </div>
        <div class="form-group">
          <label class="form-label" for="dailyRate">日租金</label>
          <input type="text" id="dailyRate" class="form-control" value="${formatCurrency(device.pricePerDay ?? device.dailyRate ?? 0)}" readonly />
        </div>
        <div class="form-group">
          <label class="form-label" for="depositAmount">押金</label>
          <input type="text" id="depositAmount" class="form-control" value="${formatCurrency(device.depositAmount)}" readonly />
        </div>

        <div class="grid grid-2"><div class="form-group">
          <label class="form-label" for="startDate">开始日期</label>
          <input type="date" id="startDate" name="startDate" class="form-control" min="${today}" value="${prefilledStart}" required />
        </div><div class="form-group">
          <label class="form-label" for="startPeriod">开始时段</label>
          <select id="startPeriod" name="startPeriod" class="form-control"><option value="AM"${prefilledStartPeriod === 'AM' ? ' selected' : ''}>上午</option><option value="PM"${prefilledStartPeriod === 'PM' ? ' selected' : ''}>下午</option></select>
        </div></div>
        <div class="grid grid-2"><div class="form-group">
          <label class="form-label" for="endDate">结束日期</label>
          <input type="date" id="endDate" name="endDate" class="form-control" min="${today}" value="${prefilledEnd}" required />
        </div><div class="form-group">
          <label class="form-label" for="endPeriod">结束时段</label>
          <select id="endPeriod" name="endPeriod" class="form-control"><option value="AM"${prefilledEndPeriod === 'AM' ? ' selected' : ''}>上午</option><option value="PM"${prefilledEndPeriod === 'PM' ? ' selected' : ''}>下午</option></select>
        </div></div>
        <div class="form-group"><label class="form-label" for="deliveryMethod">设备交付方式</label><select id="deliveryMethod" name="deliveryMethod" class="form-control"><option value="Pickup"${prefilledDelivery === 'Pickup' ? ' selected' : ''}>${selfDelivery?'到址自取':'到店自取'}</option>${selfDelivery?'':`<option value="Delivery"${prefilledDelivery === 'Delivery' ? ' selected' : ''}>送货上门（运费由管理员/员工确认）</option>`}</select></div>
        <div class="grid grid-2" id="pickupTimeGroup"><div class="form-group"><label class="form-label" for="pickupTimeSlot">取货时间</label><select id="pickupTimeSlot" name="pickupTimeSlot" class="form-control">${pickupSlots.map(([value, label]) => `<option value="${value}"${value === (prefilledPickup || 'morning') ? ' selected' : ''}>${label}</option>`).join('')}</select></div><div class="form-group"><label class="form-label" for="returnTimeSlot">归还时间</label><select id="returnTimeSlot" name="returnTimeSlot" class="form-control">${pickupSlots.map(([value, label]) => `<option value="${value}"${value === (prefilledReturn || 'morning') ? ' selected' : ''}>${label}</option>`).join('')}</select></div></div>
        <div class="form-group" id="deliveryAddressGroup" hidden><label class="form-label" for="deliveryAddress">送货地址</label><textarea id="deliveryAddress" name="deliveryAddress" class="form-control" rows="3" placeholder="请填写完整的街道、Suburb、州和邮编">${prefilledAddress}</textarea><small class="form-text">运费由工作人员确认后另行通知。</small></div>
        <div class="form-group"><label class="form-label" for="rentalNote">申请备注（选填）</label><textarea id="rentalNote" name="rentalNote" class="form-control" rows="2" maxlength="500" placeholder="例如配送时间、设备使用要求等">${prefilledNote}</textarea></div>
        <div class="form-group"><label class="form-label" for="couponCode">优惠码（选填）</label><input id="couponCode" name="couponCode" class="form-control" maxlength="40" placeholder="输入优惠码" value="${prefilledCoupon}"><small class="form-text" id="couponQuotePreview" aria-live="polite"></small></div>
        <div class="alert" id="rentalRuleMessage">最短租赁时间：${rentalRules.minimumRentalDays} 天。不可用日期：${rentalRules.unavailableDates.length ? rentalRules.unavailableDates.join('、') : '无'}。</div>
        <div class="card" id="quotePreview"><strong>租赁报价</strong><p>请选择租期后查看租金、押金和配送费用。</p></div>

        <script>
          (() => {
            const code = document.getElementById('couponCode');
            const start = document.getElementById('startDate');
            const end = document.getElementById('endDate');
            const quote = document.getElementById('quotePreview');
            const message = document.getElementById('couponQuotePreview');
            const rate = ${Number(device.pricePerDay || device.dailyRate || 0)}, weeklyDiscount = ${Number(device.weeklyDiscountPercent || device.weekly_discount_percent || 0)}, monthlyDiscount = ${Number(device.monthlyDiscountPercent || device.monthly_discount_percent || 0)};
            const priceBreakdown = ${rentalPricingClientScript()}; const rentalPrice = days => priceBreakdown({pricePerDay:rate,weeklyDiscountPercent:weeklyDiscount,monthlyDiscountPercent:monthlyDiscount},days); const rentalFee = days => rentalPrice(days).total; const rentalDiscountPreview = days => { const price = rentalPrice(days); return (price.monthlyDiscountAmount ? '<p>月租优惠 −AUD$ ' + price.monthlyDiscountAmount.toFixed(2) + '</p>' : '') + (price.weeklyDiscountAmount ? '<p>周租优惠 −AUD$ ' + price.weeklyDiscountAmount.toFixed(2) + '</p>' : ''); };
            let timer;
            const preview = () => {
              clearTimeout(timer);
              const value = code.value.trim();
              const days = Math.ceil((new Date(end.value + 'T00:00:00Z') - new Date(start.value + 'T00:00:00Z')) / 86400000);
              if (!value || !start.value || !end.value || !Number.isInteger(days) || days < 1) { message.textContent = ''; return; }
              timer = setTimeout(async () => {
                try {
                  const response = await fetch('/api/coupons/rental-preview?deviceId=${encodeURIComponent(device.id)}&days=' + days + '&code=' + encodeURIComponent(value));
                  const data = await response.json();
                  message.textContent = data.message || '';
                  message.style.color = data.ok ? '#16794f' : '#b42318';
                  if (data.ok) quote.innerHTML = '<strong>优惠后报价</strong><p>原租金：AUD$ ' + Number(data.rent).toFixed(2) + '；优惠：-AUD$ ' + Number(data.discount).toFixed(2) + '；押金：AUD$ ' + Number(data.deposit).toFixed(2) + '；<strong>最终应付：AUD$ ' + Number(data.total).toFixed(2) + '</strong>。</p>' + rentalDiscountPreview(days);
                  else { const rent = rentalFee(days).toFixed(2); const deposit = Number(${Number(device.depositAmount || 0)}).toFixed(2); quote.innerHTML = '<strong>租赁报价</strong><p>租金：AUD$ ' + rent + '；押金：AUD$ ' + deposit + '；<strong>最终应付：AUD$ ' + Number(Number(rent) + Number(deposit)).toFixed(2) + '</strong>。</p>' + rentalDiscountPreview(days); }
                } catch { message.textContent = '暂时无法验证优惠码，请稍后重试。'; message.style.color = '#b42318'; }
              }, 250);
            };
            code.addEventListener('input', preview);
            start.addEventListener('change', preview);
            end.addEventListener('change', preview);
          })();
        </script>

        <script>
          (() => {
            const delivery = document.getElementById('deliveryMethod'), group = document.getElementById('pickupTimeGroup'), pickup = document.getElementById('pickupTimeSlot'), returned = document.getElementById('returnTimeSlot'), startPeriod = document.getElementById('startPeriod'), endPeriod = document.getElementById('endPeriod'), start = document.getElementById('startDate'), end = document.getElementById('endDate'), quote = document.getElementById('quotePreview');
            const rate = ${Number(device.pricePerDay || device.dailyRate || 0)}, weeklyDiscount = ${Number(device.weeklyDiscountPercent || device.weekly_discount_percent || 0)}, monthlyDiscount = ${Number(device.monthlyDiscountPercent || device.monthly_discount_percent || 0)}, deposit = ${Number(device.depositAmount || 0)}, serviceFeeRate = ${serviceFeeRate(rentalRules)};
            const slotPeriod = slot => ['afternoon', 'evening_service'].includes(slot) ? 'PM' : 'AM';
            const priceBreakdown = ${rentalPricingClientScript()}; const rentalPrice = days => priceBreakdown({pricePerDay:rate,weeklyDiscountPercent:weeklyDiscount,monthlyDiscountPercent:monthlyDiscount},days); const rentalFee = days => rentalPrice(days).total; const rentalDiscountPreview = days => { const price = rentalPrice(days); return (price.monthlyDiscountAmount ? '<p>月租优惠 −AUD$ ' + price.monthlyDiscountAmount.toFixed(2) + '</p>' : '') + (price.weeklyDiscountAmount ? '<p>周租优惠 −AUD$ ' + price.weeklyDiscountAmount.toFixed(2) + '</p>' : ''); };
            const update = () => {
              const selfPickup = delivery.value === 'Pickup'; group.hidden = !selfPickup; pickup.disabled = !selfPickup; returned.disabled = !selfPickup;
              if (!selfPickup) return;
              startPeriod.value = slotPeriod(pickup.value); endPeriod.value = slotPeriod(returned.value);
              if (!start.value || !end.value) return;
              const halfDays = Math.round((Date.parse(end.value + 'T00:00:00Z') - Date.parse(start.value + 'T00:00:00Z')) / 86400000) * 2 + (endPeriod.value === 'PM' ? 1 : 0) - (startPeriod.value === 'PM' ? 1 : 0);
              const days = Math.ceil(halfDays / 2); if (days < 1) return;
              const rent = rentalFee(days), serviceFee = Math.round(rent * serviceFeeRate * [pickup.value, returned.value].filter(slot => ['morning_service', 'evening_service'].includes(slot)).length * 100) / 100;
              quote.innerHTML = '<strong>租赁报价</strong><p>' + days + ' 天租金：AUD$ ' + rent.toFixed(2) + (serviceFee ? '；时段服务费：AUD$ ' + serviceFee.toFixed(2) : '') + '；押金：AUD$ ' + deposit.toFixed(2) + '；<strong>预计总额：AUD$ ' + (rent + serviceFee + deposit).toFixed(2) + '</strong>。</p>' + rentalDiscountPreview(days);
            };
            [delivery, pickup, returned, start, end].forEach(input => input.addEventListener('change', update)); update();
          })();
        </script>

        <button type="submit" class="button button-primary" style="margin-top: 20px;">确认租赁</button>
      </form>
    </div><script>(()=>{const start=document.getElementById('startDate'),end=document.getElementById('endDate'),startPeriod=document.getElementById('startPeriod'),endPeriod=document.getElementById('endPeriod'),message=document.getElementById('rentalRuleMessage'),quote=document.getElementById('quotePreview'),delivery=document.getElementById('deliveryMethod'),addressGroup=document.getElementById('deliveryAddressGroup'),address=document.getElementById('deliveryAddress');const closure=${JSON.stringify(pickupClosureConfig(rentalRules))},isClosed=(${isPickupPeriodClosed.toString()}),slotTimes=${JSON.stringify(Object.fromEntries(pickupSlots.map(([slot])=>[slot,HALF_HOUR_TIME_OPTIONS.filter(time=>legacyPickupSlot(time,rentalRules)===slot)])))},slotClosed=(date,slot)=>!!date&&(slotTimes[slot]||[]).every(time=>closure.ranges.some(range=>range.start<=date+'T'+time&&date+'T'+time<range.end)||closure.weekly.some(range=>range.weekday===new Date(date+'T00:00:00Z').getUTCDay()&&range.start<=time&&time<range.end));const unavailable=${JSON.stringify(rentalRules.unavailableDates)},unavailableTimeSlots=${JSON.stringify(rentalRules.unavailableTimeSlots||{})},bookings=${JSON.stringify(bookingRanges)},minDays=${rentalRules.minimumRentalDays},rate=${Number(device.pricePerDay||device.dailyRate||0)},weeklyDiscount=${Number(device.weeklyDiscountPercent||device.weekly_discount_percent||0)},monthlyDiscount=${Number(device.monthlyDiscountPercent||device.monthly_discount_percent||0)},deposit=${Number(device.depositAmount||0)};const priceBreakdown = ${rentalPricingClientScript()}; const rentalPrice = days => priceBreakdown({pricePerDay:rate,weeklyDiscountPercent:weeklyDiscount,monthlyDiscountPercent:monthlyDiscount},days); const rentalFee = days => rentalPrice(days).total; const rentalDiscountPreview = days => { const price = rentalPrice(days); return (price.monthlyDiscountAmount ? '<p>月租优惠 −AUD$ ' + price.monthlyDiscountAmount.toFixed(2) + '</p>' : '') + (price.weeklyDiscountAmount ? '<p>周租优惠 −AUD$ ' + price.weeklyDiscountAmount.toFixed(2) + '</p>' : ''); };const localToday=()=>{const d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')};const melbourneMinutes=()=>{const parts=new Intl.DateTimeFormat('en-AU',{timeZone:'Australia/Melbourne',hour:'2-digit',minute:'2-digit',hour12:false}).formatToParts(new Date());const hour=Number(parts.find(part=>part.type==='hour')?.value||0);return(hour===24?0:hour)*60+Number(parts.find(part=>part.type==='minute')?.value||0)};const periodIndex=(date,period)=>Math.round(Date.parse(date+'T00:00:00Z')/86400000)*2+(period==='PM'?1:0);const today=localToday();const periodPassed=(date,period)=>date===today&&melbourneMinutes()>=(period==='AM'?12*60:23*60);const periodBlocked=(date,period)=>{const slots=unavailableTimeSlots[date]||[],group=period==='AM'?['morning_service','morning']:['afternoon','evening_service'];return group.every(slot=>slots.includes(slot))};const bookingBlocked=(date,period)=>bookings.some(item=>periodIndex(item.startDate,item.startPeriod||'AM')<=periodIndex(date,period)&&periodIndex(date,period)<periodIndex(item.endDate,item.endPeriod||'AM'));const updatePeriods=()=>{[['pickupTimeSlot',start],['returnTimeSlot',end]].forEach(([id,input])=>{const select=document.getElementById(id);Array.from(select.options).forEach(option=>option.disabled=delivery.value==='Pickup'&&slotClosed(input.value,option.value));if(select.selectedOptions[0]?.disabled)select.value=Array.from(select.options).find(option=>!option.disabled)?.value||''});[[startPeriod,start],[endPeriod,end]].forEach(([select,input])=>{Array.from(select.options).forEach(option=>{option.disabled=periodPassed(input.value,option.value)||(delivery.value==='Pickup'&&!!input.value&&isClosed(input.value,option.value,closure))||periodBlocked(input.value,option.value)||bookingBlocked(input.value,option.value)});if(select.selectedOptions[0]?.disabled)select.value=Array.from(select.options).find(option=>!option.disabled)?.value||''})};start.min=today;end.min=today;const update=()=>{updatePeriods();const s=start.value,e=end.value;if(!s||!e)return;const startIndex=periodIndex(s,startPeriod.value),endIndex=periodIndex(e,endPeriod.value),halfDays=endIndex-startIndex,days=Math.ceil(halfDays/2),blocked=unavailable.find(d=>d>=s&&d<=e),error=delivery.value==='Pickup'&&(slotClosed(s,document.getElementById('pickupTimeSlot').value)||slotClosed(e,document.getElementById('returnTimeSlot').value))?'所选时间不营业，请重新选择取还时间':e<s||halfDays<=0?'归还时段必须晚于开始时段。':days<minDays?'最短租赁时间为 '+minDays+' 天。':blocked?'租期包含不可用日期：'+blocked:periodPassed(s,startPeriod.value)||periodPassed(e,endPeriod.value)?'所选时段已过，请重新选择。':bookingBlocked(s,startPeriod.value)||bookingBlocked(e,endPeriod.value)?'所选上午/下午时段已有租期，请重新选择。':'';start.setCustomValidity(error);end.setCustomValidity(error);startPeriod.setCustomValidity(error);endPeriod.setCustomValidity(error);message.textContent=error||'日期和时段可用。';message.className='alert '+(error?'alert-error':'alert-success');if(!error)quote.innerHTML='<strong>租赁报价</strong><p>'+days+' 天租金：AUD$ '+rentalFee(days).toFixed(2)+'；押金：AUD$ '+deposit.toFixed(2)+'；运费（如需配送）由管理员/员工审核后另行通知。</p>' + rentalDiscountPreview(days);};const updateDelivery=()=>{const deliveryNeeded=delivery.value==='Delivery';addressGroup.hidden=!deliveryNeeded;address.required=deliveryNeeded;};start.addEventListener('change',update);end.addEventListener('change',update);startPeriod.addEventListener('change',update);endPeriod.addEventListener('change',update);delivery.addEventListener('change',()=>{updateDelivery();update()});document.getElementById('pickupTimeSlot').addEventListener('change',update);document.getElementById('returnTimeSlot').addEventListener('change',update);window.setInterval(update,30000);updateDelivery();})();</script>
    </div>
  `;

  return buildLayout(`租赁 ${escapeHtml(device.name)} - 电脑租赁管理系统`, body, user);
}
