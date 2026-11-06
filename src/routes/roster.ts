/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

import type { WorkspaceApp } from './types'
import { renderForbidden } from '../pages/public/notFound'
import { renderRoster } from '../pages/staff/roster'
import { loadRoster, mutateRoster, rosterClientData, rosterPermission, RosterError } from '../services/roster'
import { enforceRateLimit } from '../site'
import { createAuditLog } from '../services/audit'

export function registerRosterRoutes(app: WorkspaceApp) {
// Roster enforcement applies to every staff mutation, including direct HTTP calls.
app.use('*', async (c,next) => {
 const user=c.get('user');if(user?.role!=='STAFF')return next()
 const path=c.req.path;if(!/^\/(?:staff|admin|manager)(?:\/|$)/.test(path))return next()
 if(/\/(?:approve|reject|mark-paid|identity-status)$/.test(path)){await createAuditLog(c,{actor:user,action:'STAFF_OPERATION_BLOCKED',targetType:'ROSTER',targetId:path,reason:'员工没有审核权限'});return c.json({ok:false,error:'员工没有审核权限'},403)}
 const task=path.match(/^\/staff\/orders\/([^/]+)\/(handover|pickup|inspection|receive-return)$/)
 const writing=!['GET','HEAD','OPTIONS'].includes(c.req.method)
 if(!task&&!writing||/^\/staff\/(?:roster(?:\/.*)?|profile(?:\/.*)?)$/.test(path))return next()
 const permission=await rosterPermission(c,user,task?.[1],task?(['handover','pickup'].includes(task[2])?'pickup':'return'):undefined)
 if(!permission.allowed){await createAuditLog(c,{actor:user,action:'STAFF_OPERATION_BLOCKED',targetType:'ROSTER',targetId:task?.[1]||path,reason:permission.reason});if(task)await createAuditLog(c,{actor:user,action:'ORDER_SCAN_OPERATION_BLOCKED',targetType:'ORDER',targetId:task[1],reason:permission.reason});return c.json({ok:false,error:permission.reason},403)}
 if(writing)await createAuditLog(c,{actor:user,action:'STAFF_OPERATION_ATTEMPT',targetType:'ROSTER',targetId:task?.[1]||path,after:{via:permission.via,grantId:permission.grantId||null},reason:path})
 await next()
 if(writing)await createAuditLog(c,{actor:user,action:c.res.status<400?'STAFF_OPERATION_COMPLETED':'STAFF_OPERATION_FAILED',targetType:'ROSTER',targetId:task?.[1]||path,after:{via:permission.via,grantId:permission.grantId||null,httpStatus:c.res.status},reason:path})
})
for(const prefix of ['/admin','/staff']){
 app.get(prefix+'/roster',async c=>{const user=c.get('user');if(!user||(prefix==='/admin'?user.role!=='ADMIN':!['STAFF','ADMIN'].includes(user.role)))return c.html(renderForbidden(),403);return c.html(await renderRoster(c,user,user.role==='ADMIN'?'calendar':'mine'))})
 app.get(prefix+'/roster/data',async c=>{const user=c.get('user');if(!user||(prefix==='/admin'?user.role!=='ADMIN':!['STAFF','ADMIN'].includes(user.role)))return c.json({error:'无权操作'},403);try{c.header('Cache-Control','no-store');return c.json({data:rosterClientData(await loadRoster(c,user,c.req.query('start')),user)})}catch(error){if(error instanceof SyntaxError)return c.json({error:'操作无效'},400);if(error instanceof RosterError)return c.json({error:error.message},error.status);throw error}})
 app.post(prefix+'/roster/action',async c=>{const user=c.get('user');if(!user||(prefix==='/admin'?user.role!=='ADMIN':!['STAFF','ADMIN'].includes(user.role)))return c.json({error:'无权操作'},403);if(c.req.header('Origin')!==new URL(c.req.url).origin)return c.json({error:'Invalid request origin'},403);if(!await enforceRateLimit(c,'roster-action',user.id,30,60))return c.json({error:'请求过于频繁，请稍后再试'},429);try{const input=await c.req.json();c.header('Cache-Control','no-store');return c.json({data:rosterClientData(await mutateRoster(c,user,input),user)})}catch(error){if(error instanceof SyntaxError)return c.json({error:'操作无效'},400);if(error instanceof RosterError)return c.json({error:error.message},error.status);throw error}})
}
for(const view of ['requests','logs'])app.get('/admin/roster/'+view,async c=>{const user=c.get('user');if(user?.role!=='ADMIN')return c.html(renderForbidden(),403);return c.html(await renderRoster(c,user,view))})
}
