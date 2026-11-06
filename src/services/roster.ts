/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */
import type { Context } from 'hono'
import { getDB } from '../db/client'
import { getSystemSettings, loadSystemSettingsFromDB, createNotification } from '../site'
import { createAuditLog } from './audit'
import { pickupTimeSettings } from '../domain/pickupTimeSlots'
import { rosterDays, rosterAddDays, rosterMinutes, rosterTime, rosterValidateShift, rosterShiftMinutes, rosterServiceWindows, rosterOpenWindows, rosterCanOperate, rosterPublishEmployees, generateRoster, assignRosterTasks } from '../domain/roster.mjs'
import type { RosterEmployee, RosterTask, RosterShift, RosterGrant, RosterSettings, RosterWarning, RosterBusiness } from '../domain/roster.mjs'

export type RosterDraft = {start:string;shifts:RosterShift[];warnings:RosterWarning[];settings?:RosterSettings;employees?:RosterEmployee[];preferenceBaseline?:RosterEmployee[]}
export type RosterState = {settings:RosterSettings;employees:RosterEmployee[];published:RosterShift[];drafts:Record<string,RosterDraft>;requests:RosterGrant[];overrides:Record<string,string>;assignments:Record<string,string|null>}
export type RosterData = RosterState & {revision:number;now:string;today:string;instant:string;selectedStart:string;currentEmployeeId:string;actorName:string;business:RosterBusiness;tasks:RosterTask[];logs:any[];preferencePolicy:'rolling30';_previousAssignments?:Record<string,string|null>}
export class RosterError extends Error { constructor(message:string,public status:400|403|409=400){super(message)} }
export function rosterClock(date=new Date()) {
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Australia/Melbourne',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date)
  const get=(type:string)=>parts.find(p=>p.type===type)!.value
  const today=`${get('year')}-${get('month')}-${get('day')}`
  return {today,now:`${today}T${get('hour')}:${get('minute')}`,instant:date.toISOString()}
}
export function validateRosterStart(start:string,today:string) {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(start)||!Number.isFinite(Date.parse(start+'T12:00Z'))||new Date(start+'T12:00Z').toISOString().slice(0,10)!==start||start<rosterAddDays(today,-90)||start>rosterAddDays(today,180))throw new RosterError('请选择有效的排班日期')
  return start
}
const slotStart=(slot:string,period:string,business:RosterBusiness)=>/^([01]\d|2[0-3]):[03]0$/.test(slot)?slot:({morning:business.businessHours.start,afternoon:'13:00',morning_service:business.serviceFeeHours[0]?.start,evening_service:business.serviceFeeHours[1]?.start,delivery_morning:business.businessHours.start,delivery_afternoon:'13:00'}[slot]||(period==='PM'?'13:00':business.businessHours.start))
export async function loadRoster(c:Context,user:any,start?:string):Promise<RosterData> {
  await loadSystemSettingsFromDB(c)
  const db=getDB(c),clock=rosterClock(),selectedStart=validateRosterStart(start||clock.today,clock.today)
  const row=await db.prepare('SELECT revision, state_json FROM staff_roster WHERE id = 1').first()
  if(!row)throw new RosterError('排班尚未初始化',409)
  const state:RosterState=JSON.parse(row.state_json),business=pickupTimeSettings(getSystemSettings().rentalRules)
  const staff=await db.prepare("SELECT id,name,role FROM users WHERE role IN ('STAFF','ADMIN') AND status = 'active' AND deleted_at IS NULL ORDER BY name,id").all()
  state.employees=(staff.results||[]).map((u:any)=>({...{dailyHours:null,enabled:true,preferredStart:'',preferredEnd:'',unavailableDates:[]},...state.employees.find(e=>e.id===u.id),id:u.id,name:u.name,role:u.role}))
  const enabledIds=new Set(state.employees.map(e=>e.id));state.published=state.published.filter(s=>enabledIds.has(s.employeeId))
  const from=[clock.today,rosterAddDays(selectedStart,-6)].sort()[0],until=[rosterAddDays(clock.today,6),rosterAddDays(selectedStart,6)].sort().at(-1)!
  const result=await db.prepare(`SELECT o.id,o.orderNo,o.status,o.startDate,o.endDate,o.startPeriod,o.endPeriod,o.pickupTimeSlot,o.returnTimeSlot,o.return_received_at,o.overdue_outstanding_amount,d.name AS deviceName,u.name AS customer
    FROM orders o JOIN users u ON u.id=o.userId JOIN devices d ON d.id=o.deviceId WHERE o.deleted_at IS NULL AND (o.status <> 'completed' OR o.overdue_outstanding_amount > 0) AND (date(o.startDate) BETWEEN ? AND ? OR date(o.endDate) BETWEEN ? AND ? OR (date(o.endDate) < ? AND o.status IN ('active','extended','overdue','suspended','pending_return')) OR (o.return_received_at IS NOT NULL AND (o.status='pending_return' OR (o.status='completed' AND o.overdue_outstanding_amount>0)))) AND o.status IN ('approved','paid','pending_pickup','active','extended','overdue','suspended','pending_return','completed') ORDER BY o.id`).bind(from,until,from,until,clock.today).all()
  const tasks:RosterTask[]=[]
  for(const order of result.results||[])for(const kind of ['pickup','return'] as const){
    if(kind==='pickup'&&!['approved','paid','pending_pickup'].includes(order.status)||kind==='return'&&!['active','extended','overdue','suspended','pending_return','completed'].includes(order.status))continue
    const day=String(kind==='pickup'?order.startDate:order.return_received_at||String(order.endDate).slice(0,10)<clock.today?clock.today:order.endDate).slice(0,10)
    if(day<from||day>until)continue
    const slot=String(kind==='pickup'?order.pickupTimeSlot||'':order.returnTimeSlot||''),period=String(kind==='pickup'?order.startPeriod:order.endPeriod),time=slotStart(slot,period,business)
    // Legacy broad slots are visible, but an administrator must choose an exact appointment before assigning off-hours coverage.
    tasks.push({id:`${order.id}:${kind}`,orderId:order.id,orderNo:order.orderNo||order.id,deviceName:order.deviceName,customer:order.customer,kind,day,start:time,end:rosterTime(Math.min(rosterMinutes(time)+30,1439)),received:!!order.return_received_at,collection:order.status==='completed',ambiguous:/service/.test(slot)&&(!/^\d\d:\d\d$/.test(slot)||String(order.endDate).slice(0,10)<clock.today)})
  }
  const assigned=assignRosterTasks(tasks.filter(t=>!t.ambiguous),state.published,business,{...Object.fromEntries(Object.entries(state.assignments).filter((entry):entry is [string,string]=>!!entry[1])),...state.overrides})
  const byId=new Map(assigned.map(t=>[t.id,t]));const visibleTasks=tasks.map(t=>byId.get(t.id)||{...t,employeeId:null,assignmentReason:'请确认预约时间'})
  let logs:any[]=[]
  if(user.role==='ADMIN'){
    const result=await db.prepare("SELECT a.id,a.action,a.target_id,a.reason,a.after_json,a.created_at,u.name AS actor FROM audit_logs a LEFT JOIN users u ON u.id=a.actor_id WHERE a.target_type='ROSTER' ORDER BY a.created_at DESC,a.rowid DESC LIMIT 300").all()
    logs=(result.results||[]).reverse().map((l:any)=>({id:l.id,at:l.created_at,actor:l.actor||'系统',action:l.action,target:l.target_id,detail:l.reason||''}))
  }
  return {...state,...clock,revision:Number(row.revision),selectedStart,currentEmployeeId:user.id,actorName:user.name,business,tasks:visibleTasks,logs,preferencePolicy:'rolling30'}
}
function storedState(data:RosterData):RosterState { const {settings,employees,published,drafts,requests,overrides,assignments}=data;return {settings,employees,published,drafts,requests,overrides,assignments} }
export function rosterTaskVisibleTo(data:RosterData,user:any,task:RosterTask):boolean {
  return user.role==='ADMIN'||task.employeeId===user.id||data.requests.some(request=>request.employeeId===user.id&&request.taskId===task.id&&request.status==='APPROVED'&&request.day===data.today&&`${request.day}T${request.end}`>data.now)
}
export function rosterClientData(data:RosterData,user:any) {
  if(user.role==='ADMIN')return data
  const taskIds=new Set(data.tasks.filter(t=>t.day===data.today).map(t=>t.id))
  return {...data,drafts:{},logs:[],overrides:{},assignments:{},published:data.published.filter(s=>s.employeeId===user.id),requests:data.requests.filter(r=>r.employeeId===user.id&&taskIds.has(r.taskId)),employees:data.employees.map(e=>e.id===user.id?e:{id:e.id,name:e.name}),tasks:data.tasks.filter(t=>t.day===data.today),instant:data.instant}
}
export async function persistRoster(c:Context,user:any,data:RosterData,action:string,target:string,reason:string,before:unknown) {
  const db=getDB(c),mutation=crypto.randomUUID(),state=storedState(data)
  const assignments=assignRosterTasks(data.tasks.filter(t=>!t.ambiguous),data.published,data.business,{...Object.fromEntries(Object.entries(data.assignments).filter((entry):entry is [string,string]=>!!entry[1])),...data.overrides})
  for(const task of assignments)state.assignments[task.id]=task.employeeId||null
  const changes=Object.entries(state.assignments).filter(([id,value])=>data._previousAssignments?.[id]!==value)
  const result=await db.batch([
    db.prepare('UPDATE staff_roster SET revision=revision+1,state_json=?,mutation_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=1 AND revision=?').bind(JSON.stringify(state),mutation,data.revision),
    db.prepare("INSERT INTO audit_logs (id,actor_id,actor_role,action,target_type,target_id,before_json,after_json,reason,ip_address,user_agent) SELECT ?,?,?,?,'ROSTER',?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM staff_roster WHERE id=1 AND mutation_id=?)").bind('audit-'+crypto.randomUUID(),user.id,user.role,action,target,JSON.stringify(before??null),JSON.stringify({revision:data.revision+1,assignments:changes}),reason,c.req.header('CF-Connecting-IP')||null,String(c.req.header('User-Agent')||'').slice(0,500),mutation)
  ])
  if(Number(result[0].meta.changes)!==1)throw new RosterError('排班已被更新，请刷新后重试',409)
}
const timeValid=(time:unknown)=>typeof time==='string'&&/^([01]\d|2[0-3]):(00|30)$/.test(time)
export function validateRosterSettings(input:any):RosterSettings {
  const settings={dailyHours:Number(input.dailyHours),maxDays:Number(input.maxDays),maxConsecutive:Number(input.maxConsecutive),minStaff:Number(input.minStaff)}
  if(!Number.isFinite(settings.dailyHours)||settings.dailyHours<1||settings.dailyHours>12||settings.dailyHours*2%1||![settings.maxDays,settings.maxConsecutive].every(v=>Number.isInteger(v)&&v>=1&&v<=7)||!Number.isInteger(settings.minStaff)||settings.minStaff<1||settings.minStaff>20)throw new RosterError('排班工时或人数无效')
  return settings
}
function preferenceTimes(start:unknown,end:unknown) {if(Boolean(start)!==Boolean(end)||(start&&(!timeValid(start)||!timeValid(end)||String(end)<=String(start))))throw new RosterError('请填写完整且有效的偏好时段')}
export function validateRosterDraft(draft:RosterDraft,data:RosterData) {
  const days=rosterDays(draft.start),employees=draft.employees||data.employees,settings=draft.settings||data.settings
  if(draft.start<data.today)throw new RosterError('过去的班次不可修改')
  const active=new Set(data.employees.map(e=>e.id)),participating=new Set(employees.filter(e=>e.enabled!==false).map(e=>e.id))
  for(const shift of draft.shifts){if(!days.includes(shift.day)||(!active.has(shift.employeeId)||!participating.has(shift.employeeId)))throw new RosterError('班次日期或员工已失效');const error=rosterValidateShift(shift,data.business,data.tasks.filter(t=>!t.ambiguous));if(error)throw new RosterError(error)}
  for(const employee of employees){
    const own=draft.shifts.filter(s=>s.employeeId===employee.id),history=data.published.filter(s=>s.employeeId===employee.id&&!days.includes(s.day)),dates=new Set(own.concat(history).map(s=>s.day))
    if(new Set(own.map(s=>s.day)).size>settings.maxDays)throw new RosterError('超出员工工作天数上限')
    if(own.reduce((n,s)=>n+rosterShiftMinutes(s),0)>Number(employee.dailyHours??settings.dailyHours)*settings.maxDays*60)throw new RosterError('超出员工七日工时上限')
    for(const day of days){const daily=own.filter(s=>s.day===day);if(daily.reduce((n,s)=>n+rosterShiftMinutes(s),0)>Number(employee.dailyHours??settings.dailyHours)*60)throw new RosterError('超出员工每日工时上限');if(daily.some((s,i)=>daily.slice(i+1).some(o=>s.start<o.end&&s.end>o.start)))throw new RosterError('员工班次时间重叠')}
    for(const day of dates){let count=1;for(let i=1;dates.has(rosterAddDays(day,-i));i++)count++;if(count>settings.maxConsecutive&&days.some(d=>d<=day&&d>=rosterAddDays(day,-count+1)))throw new RosterError('超出员工连续工作天数上限')}
  }
}
export async function mutateRoster(c:Context,user:any,input:any) {
  if(!user||!['ADMIN','STAFF'].includes(user.role))throw new RosterError('无权操作',403)
  if(!input||typeof input!=='object'||Array.isArray(input))throw new RosterError('操作无效')
  const operation=String(input.operation||''),admin=user.role==='ADMIN'
  if(!['preference','request'].includes(operation)&&!admin)throw new RosterError('仅管理员可操作',403)
  const data=await loadRoster(c,user,input.startDate),before=storedState(structuredClone(data))
  if(Number(input.revision)!==data.revision)throw new RosterError('排班已被更新，请刷新后重试',409)
  data._previousAssignments={...data.assignments}
  let action='',target=data.selectedStart,reason=''
  if(operation==='preference'){
    const employee=data.employees.find(e=>e.id===String(input.employeeId));if(!employee||(!admin&&employee.id!==user.id))throw new RosterError('只能修改自己的偏好',403)
    const start=String(input.start||''),end=String(input.end||'');preferenceTimes(start,end)
    if(!admin&&employee.lastSelfPreferenceChange&&Date.parse(data.instant)<Date.parse(employee.lastSelfPreferenceChange)+30*86400000)throw new RosterError('尚未到下次修改日期',409)
    if(start===employee.preferredStart&&end===employee.preferredEnd)throw new RosterError('偏好时段没有变化')
    reason=`${employee.preferredStart||'不限时段'}–${employee.preferredEnd||''} → ${start||'不限时段'}–${end}`
    Object.assign(employee,{preferredStart:start,preferredEnd:end,preferenceUpdatedBy:user.name,preferenceUpdatedAt:data.instant});if(!admin)employee.lastSelfPreferenceChange=data.instant
    action=admin?'管理员修改员工偏好':'员工修改个人偏好';target=employee.name
  } else if(operation==='auto'){
    const start=validateRosterStart(String(input.start),data.today);if(start<data.today)throw new RosterError('请选择今天或之后的日期')
    const settings=validateRosterSettings(input),employeeInputs=input.employees
    if(!Array.isArray(employeeInputs)||employeeInputs.length!==data.employees.length)throw new RosterError('员工列表已变化，请刷新')
    const employees=data.employees.map(e=>{const value=employeeInputs.find((x:any)=>x.id===e.id);if(!value)throw new RosterError('员工列表无效');preferenceTimes(value.preferredStart,value.preferredEnd);const hours=value.dailyHours===null||value.dailyHours===''?null:Number(value.dailyHours);if(hours!==null&&(!Number.isFinite(hours)||hours<1||hours>12||hours*2%1))throw new RosterError('员工每日工时无效');return {...e,enabled:value.enabled===true,dailyHours:hours,preferredStart:String(value.preferredStart||''),preferredEnd:String(value.preferredEnd||'')}})
    if(!employees.some(e=>e.enabled))throw new RosterError('请至少选择一位员工')
    const planning=await loadRoster(c,user,start),days=rosterDays(start),locked=input.keepLocked?data.published.filter(s=>s.locked&&days.includes(s.day)&&employees.some(e=>e.id===s.employeeId&&e.enabled)):[]
    const result=generateRoster({...settings,start,employees,business:data.business,tasks:planning.tasks.filter(t=>!t.ambiguous),locked,history:data.published.filter(s=>s.day<start&&s.day>=rosterAddDays(start,-6))})
    data.drafts[start]={start,...result,settings,employees,preferenceBaseline:data.employees};data.selectedStart=start;data.tasks=planning.tasks
    action='自动生成排班草案';target=start;reason=`${result.shifts.length} 个班次；${result.warnings.length} 处缺口`
  } else if(operation==='shift'||operation==='removeShift'){
    const draft=data.drafts[data.selectedStart]||{start:data.selectedStart,shifts:data.published.filter(s=>rosterDays(data.selectedStart).includes(s.day)).map(s=>({...s})),warnings:[]}
    const old=draft.shifts.find(s=>s.id===String(input.shiftId));if(operation==='removeShift'){if(!old)throw new RosterError('班次不存在');draft.shifts=draft.shifts.filter(s=>s.id!==old.id);action='删除班次草案';reason=`${old.day} ${old.start}–${old.end}`}
    else {const shift:RosterShift={id:old?.id||crypto.randomUUID(),employeeId:String(input.employeeId),day:String(input.day),start:String(input.start),end:String(input.end),locked:input.locked===true};shift.service=rosterServiceWindows(shift.day,data.business).some(w=>rosterMinutes(shift.start)>=w.start&&rosterMinutes(shift.end)<=w.end);draft.shifts=draft.shifts.filter(s=>s.id!==shift.id).concat(shift);action=old?'修改班次草案':'新增班次草案';reason=`${old?old.start+'–'+old.end+' → ':''}${shift.day} ${shift.start}–${shift.end}；${String(input.reason||'').slice(0,200)}`}
    validateRosterDraft(draft,data);data.drafts[draft.start]=draft
  } else if(operation==='publish'){
    const draft=data.drafts[data.selectedStart];if(!draft)throw new RosterError('没有待发布排班',409)
    validateRosterDraft(draft,data);const days=rosterDays(draft.start)
    const assigned=assignRosterTasks(data.tasks.filter(t=>days.includes(t.day)&&!t.ambiguous),draft.shifts,data.business,data.overrides)
    if(assigned.some(t=>!t.employeeId)||data.tasks.some(t=>days.includes(t.day)&&t.ambiguous))throw new RosterError('还有未分配任务，请补齐班次或确认预约时间')
    const settings=draft.settings||data.settings
    for(const day of days)for(const w of rosterOpenWindows(day,data.business))for(let time=w.start;time<w.end;time+=30)if(draft.shifts.filter(s=>s.day===day&&rosterMinutes(s.start)<=time&&rosterMinutes(s.end)>=time+30).length<settings.minStaff)throw new RosterError('营业时段仍缺少在岗员工')
    data.published=data.published.filter(s=>!days.includes(s.day)).concat(draft.shifts);data.settings=settings
    if(draft.employees)data.employees=rosterPublishEmployees(data.employees,draft.employees,draft.preferenceBaseline)
    delete data.drafts[draft.start];action='发布排班';reason=`${draft.shifts.length} 个班次；${assigned.length} 项任务`
  } else if(operation==='reassign'){
    const task=data.tasks.find(t=>t.id===String(input.taskId)),employeeId=String(input.employeeId)
    if(!task||!data.employees.some(e=>e.id===employeeId)||!data.published.some(s=>s.employeeId===employeeId&&s.day===task.day&&s.start<=task.start&&s.end>=task.end)||data.tasks.some(t=>t.id!==task.id&&t.employeeId===employeeId&&t.day===task.day&&t.start<task.end&&t.end>task.start))throw new RosterError('该员工无法接手此任务')
    data.overrides[task.id]=employeeId;action='改派取还任务';target=task.orderNo;reason=`${task.employeeId||'未分配'} → ${employeeId}`
  } else if(operation==='request'){
    if(admin)throw new RosterError('管理员无需申请临时操作')
    const task=data.tasks.find(t=>t.id===String(input.taskId)&&t.day===data.today);reason=String(input.reason||'').trim().slice(0,300)
    const start=String(input.start),end=String(input.end);if(!task||!reason)throw new RosterError('请选择当天任务并填写申请原因')
    const error=rosterValidateShift({id:'',employeeId:user.id,day:data.today,start,end},data.business,[task]);if(error)throw new RosterError(error)
    if(end<=data.now.slice(11,16))throw new RosterError('申请结束时间已过')
    if(data.requests.some(r=>r.employeeId===user.id&&r.taskId===task.id&&r.status==='PENDING'))throw new RosterError('该任务已有待审批申请',409)
    data.requests.push({id:crypto.randomUUID(),employeeId:user.id,day:data.today,start,end,scope:'task',taskId:task.id,reason,status:'PENDING',requestedAt:data.now});action='申请临时操作';target=task.orderNo
  } else if(operation==='decision'||operation==='revoke'){
    const request=data.requests.find(r=>r.id===String(input.requestId));if(!request)throw new RosterError('申请不存在')
    if(operation==='revoke'){if(request.status!=='APPROVED')throw new RosterError('授权已失效',409);request.status='REVOKED';action='撤销临时授权'}
    else {if(request.status!=='PENDING')throw new RosterError('申请已处理',409);const decision=String(input.decision);reason=String(input.reason||'').trim().slice(0,300);if(!['APPROVED','REJECTED'].includes(decision)||decision==='REJECTED'&&!reason)throw new RosterError('请填写有效的审批结果与原因');if(decision==='APPROVED'){const start=String(input.start),end=String(input.end),task=data.tasks.find(t=>t.id===request.taskId);if(!task||request.day!==data.today||`${request.day}T${end}`<=data.now)throw new RosterError('授权时间或任务已失效');const error=rosterValidateShift({id:'',employeeId:request.employeeId,day:request.day,start,end},data.business,[task]);if(error)throw new RosterError(error);request.start=start;request.end=end}request.status=decision as RosterGrant['status'];action=decision==='APPROVED'?'批准临时操作':'拒绝临时操作'}
    request.reviewedBy=user.name;request.reviewedAt=data.now;request.reviewReason=reason;target=request.employeeId
  } else throw new RosterError('操作无效')
  await persistRoster(c,user,data,action,target,reason,before)
  if(operation==='request'){
    const admins=await getDB(c).prepare("SELECT id FROM users WHERE role='ADMIN' AND status='active' AND deleted_at IS NULL").all()
    for(const admin of admins.results||[])await createNotification(c,{recipientId:admin.id,senderId:user.id,type:'staff_roster_request',title:'临时操作申请',message:`${user.name} · ${target}`,delivery:'in_app_only'})
  }
  if(operation==='decision'||operation==='revoke'){const r=data.requests.find(r=>r.id===String(input.requestId))!;await createNotification(c,{recipientId:r.employeeId,senderId:user.id,type:'staff_roster_decision',title:action,message:r.reviewReason||action,delivery:'in_app_only'})}
  return loadRoster(c,user,data.selectedStart)
}
export async function rosterPermission(c:Context,user:any,orderId?:string,kind?:'pickup'|'return') {
  if(user.role==='ADMIN')return {allowed:true,via:'管理员'}
  const data=await loadRoster(c,user),time=data.now.slice(11,16)
  if(!orderId)return {allowed:data.published.some(s=>s.employeeId===user.id&&s.day===data.today&&s.start<=time&&s.end>time)&&(rosterOpenWindows(data.today,data.business).some(w=>rosterMinutes(time)>=w.start&&rosterMinutes(time)<w.end)),reason:'当前未排班'}
  const task=data.tasks.find(t=>t.orderId===orderId&&t.kind===kind)
  return rosterCanOperate({employeeId:user.id,task,shifts:data.published,grants:data.requests,business:data.business,now:data.now})
}
export async function canStaffReadRosterOrder(c:Context,user:any,orderId:string) {
  const data=await loadRoster(c,user)
  return data.tasks.some(t=>t.orderId===orderId&&(t.employeeId===user.id||data.requests.some(r=>r.employeeId===user.id&&r.taskId===t.id&&r.status==='APPROVED'&&r.day===data.today&&`${r.day}T${r.end}`>data.now)))
}

export async function syncRosterAssignments(c:Context) {
 const actor={id:null,role:'SYSTEM',name:'系统'},data=await loadRoster(c,actor)
 const changes=data.tasks.filter(task=>(data.assignments[task.id]||null)!==(task.employeeId||null))
 if(!changes.length)return 0
 data._previousAssignments={...data.assignments}
 for(const task of changes)data.assignments[task.id]=task.employeeId||null
 try{await persistRoster(c,actor,data,'自动分配取还任务',data.today,changes.map(t=>`${t.orderNo} → ${data.employees.find(e=>e.id===t.employeeId)?.name||'未分配'}`).join('；'),null)}catch(error){if(error instanceof RosterError&&error.status===409)return 0;throw error}
 return changes.length
}
