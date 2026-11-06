/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

import { createHash, randomBytes } from 'node:crypto'

// 用一个非正则的扫描器提取内联 <script> 体 —— 输入是我们自己渲染的可信 HTML，
// 只是想确认脚本能解析。刻意不用「过滤 HTML 标签的正则」，避开 CodeQL 的
// js/bad-tag-filter（那类正则要完全覆盖 </script > / 大小写 / 带属性等边角很难写对）。
export function extractInlineScripts(html: string): string[] {
  const bodies: string[] = []
  const hay = html.toLowerCase()
  let cursor = 0
  for (;;) {
    const tagStart = hay.indexOf('<script', cursor)
    if (tagStart === -1) break
    const openEnd = html.indexOf('>', tagStart)
    if (openEnd === -1) break
    const closeStart = hay.indexOf('</script', openEnd)
    if (closeStart === -1) break
    bodies.push(html.slice(openEnd + 1, closeStart))
    cursor = closeStart + '</script'.length
  }
  return bodies
}

/** Existing workflow fixtures explicitly opt staff into a published shift. */
export function seedTestRoster(sqlite: import('node:sqlite').DatabaseSync, employeeId: string, now = new Date()) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Melbourne', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
  const row = sqlite.prepare('SELECT state_json FROM staff_roster WHERE id=1').get()!
  const state = JSON.parse(String(row.state_json))
  state.published = []
  for (let i=-7;i<=14;i++) { const day=new Date(Date.parse(today+'T12:00Z')+i*86400000).toISOString().slice(0,10);state.published.push({id:'test-'+day,employeeId,day,start:'07:00',end:'20:00'}) }
  sqlite.prepare('UPDATE staff_roster SET state_json=? WHERE id=1').run(JSON.stringify(state))
}
export function testInspectionFiles(): Record<string,File> {
 const png=new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,0,0,0,0,0])
 return Object.fromEntries(['a','b','c','d','power'].map(key=>['inspectionPhoto_'+key,new File([png],key+'.png',{type:'image/png'})]))
}

/** Workflow fixtures start after camera verification and staff confirmation. */
export async function testOrderScanCookie(sqlite:any, actorId:string, path:string, form:any = {}):Promise<string> {
  const first=async(sql:string,...values:any[])=>{const query=sqlite.prepare(sql);return query.get?query.get(...values):query.bind(...values).first()}
  const run=async(sql:string,...values:any[])=>{const query=sqlite.prepare(sql);return query.bind?query.bind(...values).run():query.run(...values)}
  const match=path.match(/^\/(staff|admin)\/orders\/([^/?]+)\/(handover|pickup|receive-return|inspection|update)(?:\?|$)/)
  if(!match||match[3]==='update'&&form?.status!=='completed')return ''
  const order=await first('SELECT * FROM orders WHERE id=?',match[2]) as any
  if(!order||!await first('SELECT id FROM users WHERE id=?',actorId))return ''
  const stage=['handover','pickup'].includes(match[3])?'pickup':'return',completed=['inspection','update'].includes(match[3]),now=Date.now()
  const token=randomBytes(32).toString('hex'),hash=createHash('sha256').update(token).digest('hex')
  await run('INSERT INTO order_scan_sessions(token_hash,actor_id,order_id,stage,device_id,customer_id,status_snapshot,scanned_at,expires_at,confirmed_at,claimed_at,completed_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',hash,actorId,order.id,stage,order.deviceId,String(order.userId||''),order.status,now,now+1800000,now,completed?now:null,completed?now:null)
  if(match[3]==='update')await run('UPDATE orders SET return_received_at=COALESCE(return_received_at,?),return_received_by=COALESCE(return_received_by,?) WHERE id=?',new Date(now).toISOString(),actorId,order.id)
  return '; rent_order_scan='+token
}
