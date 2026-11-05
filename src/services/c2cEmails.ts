/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

import type { Context } from 'hono'
import { resolveEmailCredentials, sendTransactionalEmail } from '../notifyChannels'

// Orders enqueue an immutable, deduplicated owner message in the same database
// transaction. A failed transport remains retryable without failing a booking.
export async function deliverC2CEmails(c: Context,eventId?: string): Promise<number> {
  const credentials=await resolveEmailCredentials(c)
  if (!credentials.from || (credentials.provider!=='smtp' && !credentials.apiKey)) return 0
  await c.env.RENT.prepare(`UPDATE email_events SET status='SKIPPED',error_message='Order cancelled or removed'
    WHERE event_type='C2C_NEW_RENTAL' AND status IN ('PENDING','FAILED') AND EXISTS (
      SELECT 1 FROM orders o WHERE o.id=email_events.order_id AND (o.deleted_at IS NOT NULL OR o.status='cancelled'))`).run()
  const retry="(retry_count<max_attempts AND (status='FAILED' OR (status='PENDING' AND (last_attempt_at IS NULL OR last_attempt_at<=datetime('now','-15 minutes')))))"
  const rows=(await c.env.RENT.prepare(`SELECT id,recipient,subject,text_body,retry_count FROM email_events WHERE event_type='C2C_NEW_RENTAL' AND ${retry} ${eventId?'AND id=?':''} ORDER BY created_at LIMIT 10`).bind(...(eventId?[eventId]:[])).all()).results as {id:string;recipient:string;subject:string;text_body:string;retry_count:number}[]
  let sent=0
  for (const row of rows) {
    const claim=await c.env.RENT.prepare(`UPDATE email_events SET status='PENDING',retry_count=retry_count+1,last_attempt_at=CURRENT_TIMESTAMP WHERE id=? AND retry_count=? AND ${retry}`).bind(row.id,row.retry_count).run()
    if (!claim.meta.changes) continue
    let result: {ok:boolean;id?:string|null;error?:string|null}
    try { result=await sendTransactionalEmail(c,{to:row.recipient,subject:row.subject,text:row.text_body}) }
    catch { result={ok:false,error:'Email delivery failed'} }
    await c.env.RENT.prepare(`UPDATE email_events SET status=?,provider_message_id=?,error_message=?,sent_at=CASE WHEN ? THEN CURRENT_TIMESTAMP END WHERE id=? AND status='PENDING' AND retry_count=?`).bind(result.ok?'SENT':'FAILED',result.id || null,result.error?.slice(0,500) || null,result.ok?1:0,row.id,row.retry_count+1).run()
    if (result.ok) sent++
  }
  return sent
}
