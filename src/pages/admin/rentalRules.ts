/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

import { buildLayout, getSystemSettings } from '../../site'
import { HALF_HOUR_TIME_OPTIONS, pickupTimeSettings } from '../../domain/pickupTimeSlots'
import { renderPickupClosedRanges } from '../partials/pickupClosedRanges'

export function renderAdminRentalRules(user: any) {
  const settings = getSystemSettings()
  const pickupHours = pickupTimeSettings(settings.rentalRules)
  const timeClock = (id: string, label: string, selected: string) => `<div class="time-clock-control" data-time-clock><input${id ? ` id="${id}"` : ''} type="hidden" value="${selected}"><button type="button" class="time-clock-trigger" data-time-clock-trigger aria-label="${label}" aria-haspopup="dialog" aria-expanded="false"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"></circle><path d="M12 7v5l3.5 2"></path></svg><span>${selected}</span><i>⌄</i></button><div class="time-clock-panel" data-time-clock-panel role="dialog" aria-label="${label}" hidden><div class="time-clock-face">${HALF_HOUR_TIME_OPTIONS.map(value => `<button type="button" data-time-clock-option data-time="${value}" class="${value === selected ? 'is-selected' : ''}" aria-pressed="${value === selected}">${value}</button>`).join('')}</div></div></div>`
  const weekdayOptions = (selected = 1) => [['0', '周日'], ['1', '周一'], ['2', '周二'], ['3', '周三'], ['4', '周四'], ['5', '周五'], ['6', '周六']].map(([value, label]) => `<option value="${value}"${Number(value) === selected ? ' selected' : ''}>${label}</option>`).join('')
  const rangeRow = (kind: 'service' | 'unavailable', range: any) => `<div class="pickup-range-row" data-range-row="${kind}">${kind === 'unavailable' ? `<select class="form-control pickup-weekday" aria-label="星期">${weekdayOptions(Number(range.weekday))}</select>` : ''}<div><span>开始</span>${timeClock('', kind === 'service' ? '非营业服务开始时间' : '不可取货开始时间', range.start)}</div><div><span>结束</span>${timeClock('', kind === 'service' ? '非营业服务结束时间' : '不可取货结束时间', range.end)}</div><button class="button button-secondary button-sm pickup-range-remove" type="button" aria-label="删除此时段">×</button></div>`
  const body = `
    <div class="page-header"><div><p class="section-code">RENTAL RULES</p><h2>租赁规则</h2></div><a class="button button-secondary" href="/admin/settings">系统设置</a></div>
    <form id="rentalRulesForm" class="asset-editor">
      <section class="panel form-section"><div class="form-section-title"><span class="mono">TIME</span><h3>取还时间规则</h3></div>
          <div class="form-group pickup-time-settings"><div class="grid grid-3"><div class="pickup-time-settings__range"><span class="form-text">营业时段（免服务费）</span><div class="time-clock-row"><div><span>开始</span>${timeClock('businessHoursStart', '营业开始时间', pickupHours.businessHours.start)}</div><div><span>结束</span>${timeClock('businessHoursEnd', '营业结束时间', pickupHours.businessHours.end)}</div></div></div><div class="pickup-time-settings__range"><span class="form-text">非营业服务时段（收服务费）</span><div class="pickup-range-list" id="serviceRangeList">${pickupHours.serviceFeeHours.map(range => rangeRow('service', range)).join('')}</div><button class="button button-secondary button-sm pickup-range-add" type="button" data-add-range="service">＋ 添加时段</button></div><div class="pickup-time-settings__range"><span class="form-text">按星期不可取货时段</span><div class="pickup-range-list" id="unavailableRangeList">${pickupHours.unavailablePickupHours.map(range => rangeRow('unavailable', range)).join('')}</div><button class="button button-secondary button-sm pickup-range-add" type="button" data-add-range="unavailable">＋ 添加时段</button>${renderPickupClosedRanges(pickupHours.unavailablePickupRanges)}</div></div><div class="pickup-time-settings__rate"><label class="form-label" for="serviceFeeRate">非营业服务费比例（%）</label><input id="serviceFeeRate" class="form-control" type="number" min="0" max="100" step="0.01" value="${(Number(settings.rentalRules.serviceFeeRate ?? 0.1) * 100).toFixed(2)}"></div></div>
      </section>
      <section class="panel form-section"><div class="form-section-title"><span class="mono">RENT</span><h3>租期与折扣</h3></div>
          <div class="grid grid-2"><div><label class="form-label" for="minimumRentalDays">最短租赁天数</label><input id="minimumRentalDays" name="minimumRentalDays" type="number" min="1" step="1" class="form-control" value="${settings.rentalRules.minimumRentalDays}"></div><div><label class="form-label" for="bufferDays">设备周转缓冲天数</label><input id="bufferDays" name="bufferDays" type="number" min="0" step="1" class="form-control" value="${settings.rentalRules.bufferDays}"></div></div>
        <div class="grid grid-2"><div class="form-group"><label class="form-label" for="weeklyDiscountPercent">全局周租折扣（%）</label><input class="form-control" id="weeklyDiscountPercent" type="number" min="0" max="100" step="0.01" required value="${settings.rentalRules.weeklyDiscountPercent}"><small class="form-text">未满30天：整周按周租，零头按日租</small></div><div class="form-group"><label class="form-label" for="monthlyDiscountPercent">全局月租折扣（%）</label><input class="form-control" id="monthlyDiscountPercent" type="number" min="0" max="100" step="0.01" required value="${settings.rentalRules.monthlyDiscountPercent}"><small class="form-text">满30天后：零头不足21天按周租日价，否则按月租日价</small></div></div>
      </section>
      <p id="rentalRulesError" class="field-error" role="alert" hidden></p>
      <div class="form-actions form-actions-right"><button class="button button-primary" type="submit">保存租赁规则</button></div>
    </form>
    <script>(() => {
      const form = document.getElementById('rentalRulesForm');
      if (!form || form.dataset.ready) return;
      form.dataset.ready = 'true';
        const bindTimeClock = control => {
          if (control.dataset.timeClockReady === 'true') return;
          control.dataset.timeClockReady = 'true';
          const input = control.querySelector('input');
          const trigger = control.querySelector('[data-time-clock-trigger]');
          const panel = control.querySelector('[data-time-clock-panel]');
          const sync = () => control.querySelectorAll('[data-time-clock-option]').forEach(button => {
            const selected = button.dataset.time === input.value;
            button.classList.toggle('is-selected', selected);
            button.setAttribute('aria-pressed', String(selected));
          });
          const close = () => { panel.hidden = true; trigger.setAttribute('aria-expanded', 'false'); };
          trigger.addEventListener('click', function() {
            const opening = panel.hidden;
            document.querySelectorAll('[data-time-clock-panel]').forEach(other => { other.hidden = true; });
            document.querySelectorAll('[data-time-clock-trigger]').forEach(other => { other.setAttribute('aria-expanded', 'false'); });
            panel.hidden = !opening; trigger.setAttribute('aria-expanded', String(opening));
          });
          control.addEventListener('click', function(event) {
            const button = event.target.closest('[data-time-clock-option]');
            if (!button) return;
            input.value = button.dataset.time; trigger.querySelector('span').textContent = input.value; sync(); close();
          });
          control.addEventListener('keydown', function(event) { if (event.key === 'Escape') close(); });
          sync();
        };
        const bindTimeClocks = root => root.querySelectorAll('[data-time-clock]').forEach(bindTimeClock);
        bindTimeClocks(document);
        const clockMarkup = (label, value) => {
          const options = Array.from({ length: 48 }, (_, index) => String(Math.floor(index / 2)).padStart(2, '0') + ':' + (index % 2 ? '30' : '00'));
          return '<div class="time-clock-control" data-time-clock><input type="hidden" value="' + value + '"><button type="button" class="time-clock-trigger" data-time-clock-trigger aria-label="' + label + '" aria-haspopup="dialog" aria-expanded="false"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"></circle><path d="M12 7v5l3.5 2"></path></svg><span>' + value + '</span><i>⌄</i></button><div class="time-clock-panel" data-time-clock-panel role="dialog" aria-label="' + label + '" hidden><div class="time-clock-face">' + options.map(time => '<button type="button" data-time-clock-option data-time="' + time + '" class="' + (time === value ? 'is-selected' : '') + '" aria-pressed="' + String(time === value) + '">' + time + '</button>').join('') + '</div></div></div>';
        };
        const rangeMarkup = kind => '<div class="pickup-range-row" data-range-row="' + kind + '">' + (kind === 'unavailable' ? '<select class="form-control pickup-weekday" aria-label="星期"><option value="0">周日</option><option value="1" selected>周一</option><option value="2">周二</option><option value="3">周三</option><option value="4">周四</option><option value="5">周五</option><option value="6">周六</option></select>' : '') + '<div><span>开始</span>' + clockMarkup(kind === 'service' ? '非营业服务开始时间' : '不可取货开始时间', kind === 'service' ? '21:00' : '12:00') + '</div><div><span>结束</span>' + clockMarkup(kind === 'service' ? '非营业服务结束时间' : '不可取货结束时间', kind === 'service' ? '23:00' : '13:00') + '</div><button class="button button-secondary button-sm pickup-range-remove" type="button" aria-label="删除此时段">×</button></div>';
        document.querySelectorAll('[data-add-range]').forEach(button => button.addEventListener('click', function() {
          const kind = button.dataset.addRange;
          const list = document.getElementById(kind === 'service' ? 'serviceRangeList' : 'unavailableRangeList');
          list.insertAdjacentHTML('beforeend', rangeMarkup(kind)); bindTimeClocks(list);
        }));
        document.addEventListener('click', function(event) {
          const remove = event.target.closest('.pickup-range-remove');
          if (remove) remove.closest('[data-range-row]').remove();
        });
        document.addEventListener('click', function(event) {
          if (event.target.closest('[data-time-clock]')) return;
          document.querySelectorAll('[data-time-clock-panel]').forEach(panel => { panel.hidden = true; });
          document.querySelectorAll('[data-time-clock-trigger]').forEach(trigger => { trigger.setAttribute('aria-expanded', 'false'); });
        });

      form.addEventListener('submit', async event => {
        event.preventDefault();
        const button = form.querySelector('[type="submit"]'), error = document.getElementById('rentalRulesError');
        const value = id => document.getElementById(id).value;
        const ranges = kind => Array.from(form.querySelectorAll('[data-range-row="' + kind + '"]')).map(row => {
          const times = Array.from(row.querySelectorAll('input')).map(input => input.value);
          return { start: times[0], end: times[1], ...(kind === 'unavailable' ? { weekday: Number(row.querySelector('.pickup-weekday').value) } : {}) };
        });
        button.disabled = true; error.hidden = true;
        try {
          const rentalRules = { businessHours: {start:value('businessHoursStart'),end:value('businessHoursEnd')}, serviceFeeHours:ranges('service'), unavailablePickupHours:ranges('unavailable'), unavailablePickupRanges:JSON.parse(value('unavailablePickupRanges')), serviceFeeRate:Number(value('serviceFeeRate'))/100, minimumRentalDays:Number(value('minimumRentalDays')), bufferDays:Number(value('bufferDays')), weeklyDiscountPercent:Number(value('weeklyDiscountPercent')), monthlyDiscountPercent:Number(value('monthlyDiscountPercent')) };
          const response = await fetch('/admin/settings/rental-rules/save', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({rentalRules}) });
          const data = await response.json();
          if (!response.ok || !data.success) throw new Error(data.error || '保存失败');
          if (window.siteToast) window.siteToast('租赁规则已保存', 'success');
        } catch (failure) {
          error.textContent = failure instanceof Error ? failure.message : '保存失败'; error.hidden = false;
        } finally { button.disabled = false; }
      });
    })();</script>`
  return buildLayout('租赁规则 - 电脑租赁管理系统', body, user)
}
