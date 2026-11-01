/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

import { HALF_HOUR_TIME_OPTIONS, pickupRangeYearEnd, type UnavailablePickupRange } from '../../domain/pickupTimeSlots'
import { escapeHtml } from '../../lib/html'

export function renderPickupClosedRanges(ranges: UnavailablePickupRange[]): string {
  const timeOptions = HALF_HOUR_TIME_OPTIONS.map(time => `<option value="${time}">${time}</option>`).join('')
  return `<div class="pickup-closed-ranges" id="pickupClosedRanges">
    <span class="form-text">不营业时间</span><div class="pickup-range-list" data-closed-list></div>
    <input type="hidden" id="unavailablePickupRanges" value="${escapeHtml(JSON.stringify(ranges))}">
    <button type="button" class="button button-secondary button-sm pickup-range-add" data-closed-add>＋ 添加不营业时间</button>
    <dialog class="pickup-closed-dialog" aria-labelledby="closedRangeTitle">
      <div class="section-title"><h3 id="closedRangeTitle">不营业时间</h3><button type="button" class="button button-secondary button-sm" data-closed-cancel aria-label="关闭">×</button></div>
      <div class="grid grid-2 pickup-closed-endpoints"><div><label class="form-label">开始时间</label><button type="button" class="form-control" data-closed-date="start" aria-pressed="true"></button><select class="form-control" data-closed-time="start" aria-label="不营业开始时间">${timeOptions}</select></div><div><label class="form-label">结束时间</label><button type="button" class="form-control" data-closed-date="end" aria-pressed="false"></button><select class="form-control" data-closed-time="end" aria-label="不营业结束时间">${timeOptions}</select></div></div>
      <div class="booking-month-nav"><button type="button" class="button button-secondary button-sm" data-closed-month="-1" aria-label="上个月">←</button><strong data-closed-month-label aria-live="polite"></strong><button type="button" class="button button-secondary button-sm" data-closed-month="1" aria-label="下个月">→</button></div>
      <div class="booking-weekdays" aria-hidden="true"><span>一</span><span>二</span><span>三</span><span>四</span><span>五</span><span>六</span><span>日</span></div><div class="booking-calendar" data-closed-calendar role="group" aria-label="选择不营业日期"></div>
      <p class="form-text" data-closed-error role="status">最长一年</p><div class="record-actions"><button type="button" class="button button-secondary" data-closed-cancel>取消</button><button type="button" class="button button-primary" data-closed-confirm>确定</button></div>
    </dialog>
  </div><script>(()=>{
    const root=document.getElementById('pickupClosedRanges');if(!root||root.dataset.ready)return;root.dataset.ready='true';
    const input=root.querySelector('#unavailablePickupRanges'),list=root.querySelector('[data-closed-list]'),dialog=root.querySelector('dialog'),calendar=root.querySelector('[data-closed-calendar]'),error=root.querySelector('[data-closed-error]'),confirm=root.querySelector('[data-closed-confirm]');
    const yearEnd=(${pickupRangeYearEnd.toString()}),ranges=JSON.parse(input.value),dateButtons=Object.fromEntries(['start','end'].map(key=>[key,root.querySelector('[data-closed-date="'+key+'"]')])),timeInputs=Object.fromEntries(['start','end'].map(key=>[key,root.querySelector('[data-closed-time="'+key+'"]')]));
    let editing=-1,target='start',start='',end='',month;
    const iso=date=>date.toISOString().slice(0,10),stamp=key=>(key==='start'?start:end)+'T'+timeInputs[key].value;
    function renderList(){
      input.value=JSON.stringify(ranges);list.replaceChildren();
      ranges.forEach((range,index)=>{const row=document.createElement('div');row.className='pickup-closed-row';const edit=document.createElement('button');edit.type='button';edit.className='button button-secondary button-sm';edit.textContent=range.start.replace('T',' ')+' 至 '+range.end.replace('T',' ');edit.addEventListener('click',()=>open(index));const remove=document.createElement('button');remove.type='button';remove.className='button button-secondary button-sm';remove.textContent='×';remove.setAttribute('aria-label','删除不营业时间');remove.addEventListener('click',()=>{ranges.splice(index,1);renderList()});row.append(edit,remove);list.appendChild(row)});
    }
    function render(){
      ['start','end'].forEach(key=>{dateButtons[key].textContent=key==='start'?start:end;dateButtons[key].setAttribute('aria-pressed',String(target===key))});
      const message=stamp('end')<=stamp('start')?'不营业结束时间必须晚于开始时间':stamp('end')>yearEnd(stamp('start'))?'每段不营业时间最长一年':'';
      error.textContent=message||'最长一年';error.classList.toggle('text-danger',!!message);confirm.disabled=!!message;
      calendar.replaceChildren();root.querySelector('[data-closed-month-label]').textContent=month.toLocaleDateString('zh-CN',{year:'numeric',month:'long',timeZone:'UTC'});
      const first=new Date(month);first.setUTCDate(1-(first.getUTCDay()+6)%7);
      for(let offset=0;offset<42;offset++){const day=new Date(first);day.setUTCDate(first.getUTCDate()+offset);const value=iso(day),button=document.createElement('button');button.type='button';button.textContent=String(day.getUTCDate());button.setAttribute('aria-label',value);button.setAttribute('aria-pressed',String(value===start||value===end));button.className='booking-day'+(day.getUTCMonth()!==month.getUTCMonth()?' is-outside':'')+(start<value&&value<end?' is-selected-range':'')+(value===start?' is-range-start':'')+(value===end?' is-range-end':'');button.disabled=target==='end'&&(value<start||value>yearEnd(stamp('start')).slice(0,10));button.addEventListener('click',()=>{if(target==='start'){start=value;if(end<start||end>yearEnd(stamp('start')).slice(0,10))end=start;target='end'}else end=value;month=new Date(value.slice(0,7)+'-01T00:00:00Z');render()});calendar.appendChild(button)}
      const previous=new Date(month);previous.setUTCMonth(previous.getUTCMonth()-1);const next=new Date(month);next.setUTCMonth(next.getUTCMonth()+1);
      root.querySelector('[data-closed-month="-1"]').disabled=target==='end'&&iso(previous).slice(0,7)<start.slice(0,7);root.querySelector('[data-closed-month="1"]').disabled=target==='end'&&iso(next).slice(0,7)>yearEnd(stamp('start')).slice(0,7);
    }
    function open(index){
      editing=index;target='start';const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Australia/Melbourne',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()),range=ranges[index]||{start:today+'T09:00',end:today+'T20:00'};start=range.start.slice(0,10);end=range.end.slice(0,10);timeInputs.start.value=range.start.slice(11);timeInputs.end.value=range.end.slice(11);month=new Date(start.slice(0,7)+'-01T00:00:00Z');render();dialog.showModal();
    }
    root.querySelector('[data-closed-add]').addEventListener('click',()=>open(-1));
    root.querySelectorAll('[data-closed-cancel]').forEach(button=>button.addEventListener('click',()=>dialog.close()));
    ['start','end'].forEach(key=>{dateButtons[key].addEventListener('click',()=>{target=key;month=new Date((key==='start'?start:end).slice(0,7)+'-01T00:00:00Z');render()});timeInputs[key].addEventListener('change',render)});
    root.querySelectorAll('[data-closed-month]').forEach(button=>button.addEventListener('click',()=>{month.setUTCMonth(month.getUTCMonth()+Number(button.dataset.closedMonth));render()}));
    confirm.addEventListener('click',()=>{render();if(confirm.disabled)return;if(editing<0&&ranges.length>=50){error.textContent='不营业时间最多可添加 50 段';return}const range={start:stamp('start'),end:stamp('end')};if(editing<0)ranges.push(range);else ranges[editing]=range;renderList();dialog.close()});
    renderList();
  })();</script>`
}
