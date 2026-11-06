/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */
import test from 'node:test'
const ROSTER_TODAY='2026-11-06',ROSTER_NOW='2026-11-06T10:00';;
import assert from 'node:assert/strict';
import {rosterOpenWindows,rosterValidateShift,generateRoster,assignRosterTasks,rosterCanOperate,rosterDays,rosterShiftMinutes,rosterAddDays,rosterPreferencePermission,rosterPublishEmployees} from '../src/domain/roster.mjs';
const business={businessHours:{start:'09:00',end:'20:00'},serviceFeeHours:[{start:'07:00',end:'08:00'}],unavailablePickupHours:[],unavailablePickupRanges:[]};
const start='2026-11-06';
const staff=[{id:'a',name:'A',dailyHours:8},{id:'b',name:'B',dailyHours:6},{id:'c',name:'C',dailyHours:4}];
test('营业时段排除按星期和跨日期的不营业范围，并忽略加价服务时段',()=>{
  const rules={...business,unavailablePickupHours:[{weekday:5,start:'12:00',end:'13:00'}],unavailablePickupRanges:[{start:'2026-11-06T18:00',end:'2026-11-07T11:00'}]};
  assert.deepEqual(rosterOpenWindows(start,rules),[{start:540,end:720},{start:780,end:1080}]);
  assert.deepEqual(rosterOpenWindows('2026-11-07',rules),[{start:660,end:1200}]);
  assert.ok(rosterValidateShift({day:start,start:'07:00',end:'08:00'},rules));
  assert.ok(rosterValidateShift({day:start,start:'11:00',end:'14:00'},rules));
});
test('休业整天不排班，休业订单明确未分配',()=>{
  const rules={...business,unavailablePickupRanges:[{start:'2026-11-06T00:00',end:'2026-11-07T00:00'}]};
  const task={id:'t',day:start,start:'10:00',end:'10:30'};
  const result=generateRoster({start,employees:staff,tasks:[task],business:rules});
  assert.ok(!result.shifts.some(s=>s.day===start));assert.equal(assignRosterTasks([task],result.shifts,rules)[0].assignmentReason,'不在可预约取还时段');
});
test('员工不足留下明确缺口，不超工时强排',()=>{
  const result=generateRoster({start,employees:[{id:'a',dailyHours:2}],tasks:[],business,maxDays:3});
  assert.ok(result.warnings.length);assert.ok(result.shifts.length<=3);assert.ok(result.shifts.every(s=>rosterShiftMinutes(s)<=120));
});
test('连续工作天数会考虑本周开始前的排班',()=>{
  const history=Array.from({length:3},(_,i)=>({id:String(i),day:rosterAddDays(start,i-3),employeeId:'a',start:'09:00',end:'17:00'}));
  const result=generateRoster({start,employees:[{id:'a',dailyHours:8}],tasks:[],business,maxConsecutive:3,history});
  assert.ok(!result.shifts.some(s=>s.day===start));
  const days=new Set(result.shifts.map(s=>s.day));for(const day of days)assert.ok(![1,2,3].every(i=>days.has(rosterAddDays(day,i))));
});
test('固定班次保留，非法的固定班次不予接受',()=>{
  const locked=[{id:'fixed',day:start,employeeId:'a',start:'10:00',end:'15:00',locked:true}];
  const result=generateRoster({start,employees:staff,tasks:[],business,locked});assert.deepEqual(result.shifts.find(s=>s.id==='fixed'),locked[0]);
  assert.throws(()=>generateRoster({start,employees:staff,tasks:[],business,locked:[{...locked[0],start:'07:00'}]}),/营业时段/);
});
test('同时发生的任务不会交给同一员工，手动改派也不双重占用',()=>{
  const shifts=['a','b'].map(employeeId=>({employeeId,day:start,start:'09:00',end:'17:00'}));
  const tasks=['1','2','3'].map(id=>({id,day:start,start:'10:00',end:'10:30'}));
  const assigned=assignRosterTasks(tasks,shifts,business,{'2':'a'});
  assert.equal(assigned.find(t=>t.id==='2').employeeId,'a');assert.equal(new Set(assigned.filter(t=>t.employeeId).map(t=>t.employeeId)).size,2);assert.equal(assigned.filter(t=>!t.employeeId).length,1);
});
test('未排班员工不可操作；授权只对指定订单与授权时段有效',()=>{
  const task={id:'t',day:start,start:'10:00',end:'10:30',employeeId:'b'};
  const params={employeeId:'a',task,shifts:[],grants:[],business,now:start+'T10:00'};
  assert.equal(rosterCanOperate(params).allowed,false);
  const grant={id:'g',employeeId:'a',day:start,start:'10:00',end:'12:00',status:'APPROVED',scope:'task',taskId:'t'};
  assert.equal(rosterCanOperate({...params,grants:[grant]}).grantId,'g');
  assert.equal(rosterCanOperate({...params,task:{...task,id:'other'},grants:[grant]}).allowed,false);
  assert.equal(rosterCanOperate({...params,grants:[grant],now:start+'T12:00'}).allowed,false);
  for(const status of ['PENDING','REJECTED','REVOKED','EXPIRED'])assert.equal(rosterCanOperate({...params,grants:[{...grant,status}]}).allowed,false);
});
test('当班员工也只能办理分配给自己的当天任务，授权不能越过不营业时间',()=>{
  const shift={employeeId:'a',day:start,start:'09:00',end:'17:00'},task={id:'t',day:start,start:'10:00',end:'10:30',employeeId:'b'};
  const params={employeeId:'a',task,shifts:[shift],grants:[],business,now:start+'T10:00'};
  assert.equal(rosterCanOperate(params).reason,'任务已分配给其他员工');
  assert.equal(rosterCanOperate({...params,task:{...task,employeeId:'a'}}).allowed,true);
  assert.equal(rosterCanOperate({...params,task:{...task,day:'2026-11-07'}}).allowed,false);
  const grant={employeeId:'a',day:start,start:'07:00',end:'08:00',status:'APPROVED',scope:'all'};
  assert.equal(rosterCanOperate({...params,grants:[grant],now:start+'T07:30'}).reason,'当前不在营业或预约服务时段');
});
test('同样的工时和预约生成相同草案',()=>{
  const params={start,employees:staff,tasks:[],business};assert.deepEqual(generateRoster(params),generateRoster(params));
});

test('加价时段没有预约时不排人；有预约时只排任务时间，全天累计不超个人工时',()=>{
  const rules={...business,serviceFeeHours:[{start:'07:00',end:'08:00'},{start:'21:00',end:'23:00'}]};
  const employees=[{id:'a',dailyHours:8},{id:'b',dailyHours:8},{id:'c',dailyHours:4}];
  const empty=generateRoster({start,employees,tasks:[],business:rules});assert.ok(empty.shifts.every(s=>!s.service));
  const tasks=[{id:'early',day:start,start:'07:00',end:'07:30'},{id:'late',day:start,start:'21:00',end:'21:30'}];
  const filled=generateRoster({start,employees,tasks,business:rules});
  assert.equal(assignRosterTasks(tasks,filled.shifts,rules).filter(t=>!t.employeeId).length,0);
  assert.ok(filled.shifts.filter(s=>s.service).every(s=>s.day===start&&tasks.some(t=>s.start>=t.start&&s.end<=t.end)));
  for(const e of employees)for(const day of rosterDays(start))assert.ok(filled.shifts.filter(s=>s.employeeId===e.id&&s.day===day).reduce((n,s)=>n+rosterShiftMinutes(s),0)<=e.dailyHours*60);
});
test('加价预约也不能越过休业日期',()=>{
  const rules={...business,serviceFeeHours:[{start:'21:00',end:'23:00'}],unavailablePickupRanges:[{start:start+'T20:00',end:rosterAddDays(start,1)+'T00:00'}]};
  const task={id:'late',day:start,start:'21:00',end:'21:30'};const result=generateRoster({start,employees:staff,tasks:[task],business:rules});assert.ok(!result.shifts.some(s=>s.day===start&&s.service));assert.equal(assignRosterTasks([task],result.shifts,rules)[0].employeeId,null);
});
test('营业外的操作只在预约任务时段内授权，任务结束后不可继续操作',()=>{
  const rules={...business,serviceFeeHours:[{start:'21:00',end:'23:00'}]};const task={id:'late',day:start,start:'21:00',end:'21:30',employeeId:'a'};const shift={employeeId:'a',day:start,start:'21:00',end:'21:30'};const p={employeeId:'a',task,shifts:[shift],grants:[],business:rules};assert.equal(rosterCanOperate({...p,now:start+'T21:00'}).allowed,true);assert.equal(rosterCanOperate({...p,now:start+'T21:30'}).allowed,false);assert.equal(rosterCanOperate({...p,now:start+'T22:00'}).allowed,false);
});
test('自动安排优先匹配员工偏好，管理员仍可手动调整营业内班次',()=>{
  const rules={...business,businessHours:{start:'09:00',end:'17:00'}};const employees=[{id:'a',dailyHours:4,preferredStart:'09:00',preferredEnd:'13:00'},{id:'b',dailyHours:4,preferredStart:'13:00',preferredEnd:'17:00'}];const result=generateRoster({start,employees,tasks:[],business:rules,maxDays:7,maxConsecutive:7});for(const shift of result.shifts){assert.equal(shift.start,shift.employeeId==='a'?'09:00':'13:00');assert.equal(shift.end,shift.employeeId==='a'?'13:00':'17:00')}assert.equal(rosterValidateShift({day:start,start:'10:00',end:'14:00'},rules),'');
});

test('员工偏好修改冷却期只限制本人，管理员可随时改且不消耗员工次数',()=>{
  const employee={id:'a',lastSelfPreferenceChange:'2026-11-06T10:00'};
  assert.equal(rosterPreferencePermission(employee,{actorId:'a',now:'2026-12-05T10:00'}).allowed,false);
  assert.equal(rosterPreferencePermission(employee,{actorId:'a',now:'2026-12-06T10:00'}).allowed,true);
  assert.equal(rosterPreferencePermission(employee,{role:'ADMIN',now:'2026-11-06T10:01'}).allowed,true);
  assert.equal(rosterPreferencePermission(employee,{actorId:'b',now:'2026-12-06T10:00'}).allowed,false);
  assert.equal(rosterPreferencePermission(employee,{actorId:'a',policy:'calendarMonth',now:'2026-12-01T00:00'}).allowed,false);
});

test('发布旧排班草案不覆盖员工刚改的偏好，也不重置本人修改间隔',()=>{
 const baseline=[{id:'a',preferredStart:'09:00',preferredEnd:'17:00'}];
 const proposed=[{...baseline[0],dailyHours:6}];
 const live=[{...baseline[0],preferredStart:'10:00',preferredEnd:'18:00',lastSelfPreferenceChange:'2026-11-06T10:00',preferenceUpdatedBy:'员工A'}];
 const merged=rosterPublishEmployees(live,proposed,baseline)[0];assert.equal(merged.dailyHours,6);assert.equal(merged.preferredStart,'10:00');assert.equal(merged.lastSelfPreferenceChange,'2026-11-06T10:00');assert.equal(rosterPreferencePermission(merged,{actorId:'a',now:'2026-11-07T10:00'}).allowed,false);
});
