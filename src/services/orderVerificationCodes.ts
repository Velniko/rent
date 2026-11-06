/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */
import type { Context } from 'hono'

const CODE_ALPHABET='ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
export function generateOrderVerificationCode():string {
  for(;;){let code=''
  while(code.length<6)for(const byte of crypto.getRandomValues(new Uint8Array(12))){if(byte<252)code+=CODE_ALPHABET[byte%36];if(code.length===6)break}
  if(/[A-Z]/.test(code)&&/[0-9]/.test(code))return code
  }
}
export async function getOrderVerificationCode(c:Context,orderId:string):Promise<string> {
  const existing=await c.env.RENT.prepare('SELECT verification_code FROM order_verification_codes WHERE order_id=?').bind(orderId).first() as any
  if(existing)return String(existing.verification_code).toUpperCase()
  for(let attempt=0;attempt<10;attempt++){
    const code=generateOrderVerificationCode()
    try{await c.env.RENT.prepare('INSERT INTO order_verification_codes(order_id,verification_code) VALUES (?,?) ON CONFLICT(order_id) DO NOTHING').bind(orderId,code).run()}
    catch(error){if(!String(error).includes('order_verification_codes.verification_code'))throw error;continue}
    const stored=await c.env.RENT.prepare('SELECT verification_code FROM order_verification_codes WHERE order_id=?').bind(orderId).first() as any
    if(stored)return String(stored.verification_code).toUpperCase()
  }
  throw new Error('无法生成校验码，请重试')
}
