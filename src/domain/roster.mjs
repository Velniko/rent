/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

export const rosterMinutes=time=>Number(time.slice(0,2))*60+Number(time.slice(3,5));
export const rosterTime=minutes=>`${String(Math.floor(minutes/60)).padStart(2,'0')}:${String(minutes%60).padStart(2,'0')}`;
export const rosterAddDays=(day,amount)=>new Date(Date.parse(day+'T12:00:00Z')+amount*86400000).toISOString().slice(0,10);
export const rosterDays=start=>Array.from({length:7},(_,i)=>rosterAddDays(start,i));
const rosterOverlap=(a,b)=>a.start<b.end&&b.start<a.end;
const rosterDateValid=day=>/^\d{4}-\d{2}-\d{2}$/.test(day)&&!Number.isNaN(Date.parse(day+'T12:00:00Z'))&&new Date(day+'T12:00:00Z').toISOString().slice(0,10)===day;

function rosterAllowedWindows(day,ranges,business){
  if(!rosterDateValid(day))return [];
  let windows=ranges.map(r=>({start:rosterMinutes(r.start),end:rosterMinutes(r.end)})).filter(w=>w.end>w.start);
  const weekday=new Date(day+'T12:00:00Z').getUTCDay();
  const closed=(business.unavailablePickupHours||[]).filter(r=>Number(r.weekday)===weekday).map(r=>({start:rosterMinutes(r.start),end:rosterMinutes(r.end)}));
  for(const range of business.unavailablePickupRanges||[]){
    if(range.start.slice(0,10)>day||range.end.slice(0,10)<day)continue;
    closed.push({start:range.start.slice(0,10)===day?rosterMinutes(range.start.slice(11,16)):0,end:range.end.slice(0,10)===day?rosterMinutes(range.end.slice(11,16)):1440});
  }
  for(const block of closed)windows=windows.flatMap(w=>!rosterOverlap(w,block)?[w]:[{start:w.start,end:Math.min(w.end,block.start)},{start:Math.max(w.start,block.end),end:w.end}].filter(w=>w.end>w.start));
  return windows.sort((a,b)=>a.start-b.start);
}
export const rosterOpenWindows=(day,business)=>rosterAllowedWindows(day,[business.businessHours],business);
export const rosterServiceWindows=(day,business)=>rosterAllowedWindows(day,business.serviceFeeHours||[],business);
export function rosterTaskMode(task,business){
  const start=rosterMinutes(task.start),end=rosterMinutes(task.end);if(end<=start)return null;
  if(rosterOpenWindows(task.day,business).some(w=>start>=w.start&&end<=w.end))return 'business';
  if(rosterServiceWindows(task.day,business).some(w=>start>=w.start&&end<=w.end))return 'service';
  return null;
}
export function rosterCoverageWindows(day,tasks,business){
  const normal=rosterOpenWindows(day,business).map(w=>({...w,service:false}));
  const booked=tasks.filter(t=>t.day===day&&rosterTaskMode(t,business)==='service').map(t=>({start:rosterMinutes(t.start),end:rosterMinutes(t.end),service:true})).sort((a,b)=>a.start-b.start);
  const merged=[];for(const window of booked){const last=merged.at(-1);if(last&&window.start<=last.end)last.end=Math.max(last.end,window.end);else merged.push({...window})}
  return normal.concat(merged).sort((a,b)=>a.start-b.start);
}
export const rosterShiftMinutes=shift=>rosterMinutes(shift.end)-rosterMinutes(shift.start);
export function rosterValidateShift(shift,business,tasks=[]){
  if(!rosterDateValid(shift.day)||!/^([01]\d|2[0-3]):(00|30)$/.test(shift.start)||!/^([01]\d|2[0-3]):(00|30)$/.test(shift.end))return '请选择有效的日期与半小时时段';
  const start=rosterMinutes(shift.start),end=rosterMinutes(shift.end);if(end<=start)return '结束时间必须晚于开始时间';
  if(!rosterCoverageWindows(shift.day,tasks,business).some(w=>start>=w.start&&end<=w.end))return '营业时段外仅可安排已有预约的取还时间，且不能跨越休业时段';
  return '';
}
function rosterConsecutive(employeeId,day,shifts){
  const dates=new Set(shifts.filter(s=>s.employeeId===employeeId).map(s=>s.day));dates.add(day);
  let count=1;for(let i=1;dates.has(rosterAddDays(day,-i));i++)count++;
  for(let i=1;dates.has(rosterAddDays(day,i));i++)count++;
  return count;
}
export function generateRoster({start,employees,tasks,business,dailyHours=8,maxDays=5,maxConsecutive=5,minStaff=1,locked=[],history=[]}){
  for(const shift of locked){const error=rosterValidateShift(shift,business,tasks);if(error)throw new Error(error)}
  const days=rosterDays(start),shifts=locked.filter(s=>days.includes(s.day)).map(s=>({...s,locked:true})),warnings=[];
  const loads=new Map(employees.map(e=>[e.id,shifts.filter(s=>s.employeeId===e.id).reduce((n,s)=>n+rosterShiftMinutes(s),0)]));
  const deficits=day=>rosterCoverageWindows(day,tasks,business).flatMap(window=>{
    const buckets=[];for(let time=window.start;time<window.end;time+=30){const end=Math.min(time+30,window.end),concurrent=tasks.filter(t=>t.day===day&&rosterMinutes(t.start)<end&&rosterMinutes(t.end)>time).length;
      const count=shifts.filter(s=>s.day===day&&rosterMinutes(s.start)<=time&&rosterMinutes(s.end)>=end).length;
      buckets.push({time,end,need:Math.max(window.service?0:minStaff,concurrent)-count,weight:window.service?100:concurrent?3:1})}return buckets;
  });
  const orderedDays=[...days].sort((a,b)=>{
    const capacity=day=>employees.filter(e=>e.enabled!==false&&!(e.unavailableDates||[]).includes(day)&&(e.weekdays||[0,1,2,3,4,5,6]).includes(new Date(day+'T12:00:00Z').getUTCDay())).reduce((n,e)=>n+Number(e.dailyHours??dailyHours),0);
    return capacity(a)-capacity(b)||tasks.filter(t=>t.day===b).length-tasks.filter(t=>t.day===a).length||a.localeCompare(b);
  });
  for(const day of orderedDays){
    for(let iteration=0;iteration<employees.length*12;iteration++){
      const gaps=deficits(day);if(!gaps.some(g=>g.need>0))break;
      let best=null;
      for(const employee of employees){
        if(employee.enabled===false||(employee.unavailableDates||[]).includes(day)||!(employee.weekdays||[0,1,2,3,4,5,6]).includes(new Date(day+'T12:00:00Z').getUTCDay()))continue;
        const ownDay=shifts.filter(s=>s.day===day&&s.employeeId===employee.id);
        if((!ownDay.length&&new Set(shifts.filter(s=>s.employeeId===employee.id).map(s=>s.day)).size>=Number(employee.maxDays??maxDays))||rosterConsecutive(employee.id,day,shifts.concat(history))>maxConsecutive)continue;
        const daily=Math.min(12,Number(employee.dailyHours??dailyHours))*60,weekly=Number(employee.weeklyHours??((employee.dailyHours??dailyHours)*(employee.maxDays??maxDays)))*60;
        const remaining=Math.min(daily-ownDay.reduce((n,s)=>n+rosterShiftMinutes(s),0),weekly-(loads.get(employee.id)||0));if(remaining<30)continue;
        for(const window of rosterCoverageWindows(day,tasks,business))for(let from=window.start;from<window.end;from+=30){
          if(ownDay.some(s=>from>=rosterMinutes(s.start)&&from<rosterMinutes(s.end)))continue;
          const nextShift=ownDay.filter(s=>rosterMinutes(s.start)>from).sort((a,b)=>a.start.localeCompare(b.start))[0];
          const maximum=Math.min(from+remaining,window.end,nextShift?rosterMinutes(nextShift.start):1440);
          const possible=gaps.filter(g=>g.time>=from&&g.end<=maximum),needed=possible.filter(g=>g.need>0);
          if(!needed.length)continue;
          let firstRun=from;for(const gap of possible){if(gap.time!==firstRun||gap.need<=0)break;firstRun=gap.end}
          for(const until of [...new Set([maximum,needed.at(-1).end,firstRun])]){
            const covered=possible.filter(g=>g.end<=until);if(until-from<30)continue;
            const benefit=covered.reduce((n,g)=>n+(g.need>0?g.weight:0),0);if(!benefit)continue;
            let preference=0;
            if(employee.preferredStart&&employee.preferredEnd){const a=rosterMinutes(employee.preferredStart),b=rosterMinutes(employee.preferredEnd),inside=Math.max(0,Math.min(until,b)-Math.max(from,a));preference=inside/(until-from)*25-Math.max(0,Math.max(a-until,from-b))/60*8}
            const distance=ownDay.length?Math.min(...ownDay.map(s=>Math.max(0,Math.max(rosterMinutes(s.start)-until,from-rosterMinutes(s.end)))))/60:0;
            const score=benefit*100-covered.filter(g=>g.need<=0).length*60-((loads.get(employee.id)||0)/Math.max(weekly,1))*30+preference-distance*8+(ownDay.length?60:0);
            if(!best||score>best.score+.001)best={score,employeeId:employee.id,start:rosterTime(from),end:rosterTime(until),service:window.service};
          }
        }
      }
      if(!best)break;
      const shift={id:`auto-${day}-${best.employeeId}-${best.start.replace(':','')}`,employeeId:best.employeeId,day,start:best.start,end:best.end,service:best.service,locked:false};shifts.push(shift);loads.set(best.employeeId,(loads.get(best.employeeId)||0)+rosterShiftMinutes(shift));
    }
    const missing=deficits(day).filter(g=>g.need>0);if(missing.length)warnings.push({day,start:rosterTime(missing[0].time),end:rosterTime(missing.at(-1).end),message:'预约任务或营业时段人手不足'});
  }
  return {shifts:shifts.sort((a,b)=>a.day.localeCompare(b.day)||a.start.localeCompare(b.start)),warnings};
}
export function assignRosterTasks(tasks,shifts,business,overrides={}){
  const assigned=[];
  for(const task of [...tasks].sort((a,b)=>a.day.localeCompare(b.day)||Number(Boolean(overrides[b.id]))-Number(Boolean(overrides[a.id]))||a.start.localeCompare(b.start)||a.id.localeCompare(b.id))){
    const start=rosterMinutes(task.start),end=rosterMinutes(task.end),mode=rosterTaskMode(task,business);
    if(!mode){assigned.push({...task,employeeId:null,assignmentReason:'不在可预约取还时段'});continue}
    const eligible=[...new Set(shifts.filter(s=>s.day===task.day&&rosterMinutes(s.start)<=start&&rosterMinutes(s.end)>=end).map(s=>s.employeeId))].filter(id=>!assigned.some(t=>t.employeeId===id&&t.day===task.day&&rosterOverlap({start:rosterMinutes(t.start),end:rosterMinutes(t.end)},{start,end})));
    eligible.sort((a,b)=>Number(b===overrides[task.id])-Number(a===overrides[task.id])||assigned.filter(t=>t.employeeId===a&&t.day===task.day).length-assigned.filter(t=>t.employeeId===b&&t.day===task.day).length||a.localeCompare(b));
    assigned.push({...task,service:mode==='service',employeeId:eligible[0]||null,assignmentReason:eligible.length?'':'无可用当班员工'});
  }
  return assigned.sort((a,b)=>a.day.localeCompare(b.day)||a.start.localeCompare(b.start)||a.id.localeCompare(b.id));
}
export function rosterCanOperate({employeeId,task,shifts,grants,business,now=new Date().toISOString().slice(0,16),role='STAFF'}){
  if(role==='ADMIN')return {allowed:true,via:'管理员'};
  if(!task)return {allowed:false,reason:'任务不存在'};
  const day=now.slice(0,10),time=rosterMinutes(now.slice(11,16));if(day!==task.day)return {allowed:false,reason:'只可办理当天任务'};
  const inBusiness=rosterOpenWindows(day,business).some(w=>time>=w.start&&time<w.end);
  const inBookedService=rosterTaskMode(task,business)==='service'&&time>=rosterMinutes(task.start)&&time<rosterMinutes(task.end);
  if(!inBusiness&&!inBookedService)return {allowed:false,reason:'当前不在营业或预约服务时段'};
  const grant=(grants||[]).find(g=>g.employeeId===employeeId&&g.status==='APPROVED'&&g.day===day&&time>=rosterMinutes(g.start)&&time<rosterMinutes(g.end)&&(g.scope==='all'||g.taskId===task.id));
  if(grant)return {allowed:true,via:'临时授权',grantId:grant.id};
  if(!shifts.some(s=>s.employeeId===employeeId&&s.day===day&&time>=rosterMinutes(s.start)&&time<rosterMinutes(s.end)))return {allowed:false,reason:'当前未排班'};
  if(task.employeeId!==employeeId)return {allowed:false,reason:'任务已分配给其他员工'};
  return {allowed:true,via:'排班'};
}
export function rosterPreferencePermission(employee,{role='STAFF',actorId=employee.id,now=new Date().toISOString().slice(0,16),policy='rolling30'}={}){
  if(role==='ADMIN')return {allowed:true,nextAllowedAt:null};
  if(actorId!==employee.id)return {allowed:false,nextAllowedAt:null,reason:'只能修改自己的偏好'};
  const last=employee.lastSelfPreferenceChange;if(!last)return {allowed:true,nextAllowedAt:null};
  const next=new Date(Date.parse(last)+30*86400000).toISOString();
  return {allowed:Date.parse(now)>=Date.parse(next),nextAllowedAt:next,reason:Date.parse(now)>=Date.parse(next)?'':'尚未到下次修改日期'};
}

export function rosterPublishEmployees(current,proposed,baseline=[]){
  return proposed.map(employee=>{
    const live=current.find(e=>e.id===employee.id),before=baseline.find(e=>e.id===employee.id);
    if(!live)return {...employee};
    const merged={...employee,lastSelfPreferenceChange:live.lastSelfPreferenceChange};
    if(before&&((live.preferredStart||'')!==(before.preferredStart||'')||(live.preferredEnd||'')!==(before.preferredEnd||'')||(live.lastSelfPreferenceChange||'')!==(before.lastSelfPreferenceChange||''))){
      merged.preferredStart=live.preferredStart;merged.preferredEnd=live.preferredEnd;merged.preferenceUpdatedBy=live.preferenceUpdatedBy;merged.preferenceUpdatedAt=live.preferenceUpdatedAt;
    }
    return merged;
  });
}
