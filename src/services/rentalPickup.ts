/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

import type { Context } from 'hono'
import { nanoid } from 'nanoid'
import { HALF_HOUR_TIME_OPTIONS } from '../domain/pickupTimeSlots'
import { parseShippingAddress } from '../domain/rentalProgramAddress'
import { createAuditLog } from './audit'

export interface RentalPickupBlock {id:string;listing_id:string;blocked_date:string;start_time:string|null;end_time:string|null}
export function rentalCity(listing:{public_city?:string;pickup_address_json?:string;listing_mode?:string}):string{
  return listing.listing_mode==='managed'?'墨尔本':listing.public_city?.trim() || parseShippingAddress(listing.pickup_address_json).city || '城市待完善'
}
export function readRentalCity(value:unknown,fallback=''):string {
  const city=String(value || fallback).trim()
  if(!city || city.length>80 || /[<>\u0000-\u001f\u007f]/.test(city))throw new Error('请填写有效的展示城市')
  return city
}
export async function rentalPickupBlocks(c:Context,deviceId:string):Promise<RentalPickupBlock[]>{
  return ((await c.env.RENT.prepare(`SELECT b.* FROM c2c_pickup_blocks b JOIN c2c_listings l ON l.id=b.listing_id WHERE l.device_id=? ORDER BY b.blocked_date,b.start_time,b.id`).bind(deviceId).all()).results || []) as RentalPickupBlock[]
}
export function rentalPickupBlocked(blocks:RentalPickupBlock[],date:string,slot:string):boolean{
  return blocks.some(block=>block.blocked_date===date && (!block.start_time || !/^\d{2}:\d{2}$/.test(slot) || (block.start_time<=slot && slot<block.end_time!)))
}
export async function addRentalPickupBlock(c:Context,ownerId:string,listingId:string,form:Record<string,unknown>){
  const listing=await c.env.RENT.prepare('SELECT id,device_id,public_city FROM c2c_listings WHERE id=? AND owner_id=?').bind(listingId,ownerId).first()
  if(!listing)throw new Error('设备不存在或无权修改')
  const date=String(form.blockedDate || '')
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date+'T00:00:00Z')) || new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date)throw new Error('请选择有效的不可取货日期')
  const start=form.allDay==='1'?null:String(form.startTime || ''),end=form.allDay==='1'?null:String(form.endTime || '')
  if(start!==null && (!HALF_HOUR_TIME_OPTIONS.includes(start) || !(HALF_HOUR_TIME_OPTIONS.includes(end!)||end==='24:00') || start>=end!))throw new Error('请选择有效的不可取货时段')
  const count=await c.env.RENT.prepare('SELECT COUNT(*) AS total FROM c2c_pickup_blocks WHERE listing_id=?').bind(listingId).first() as {total:number}
  if(count.total>=50)throw new Error('每台设备最多设置 50 段不可取货时间')
  try{await c.env.RENT.prepare('INSERT INTO c2c_pickup_blocks (id,listing_id,blocked_date,start_time,end_time) VALUES (?,?,?,?,?)').bind('pb-'+nanoid(16),listingId,date,start,end).run()}
  catch(error){if(String(error).includes('C2C_PICKUP_HAS_APPOINTMENT'))throw new Error('该时段已有取还预约，请选择其他时间');throw error}
  await createAuditLog(c,{action:'RENTAL_PICKUP_BLOCK_ADD',targetType:'c2c_listing',targetId:listingId,after:{date,start,end}})
}
export async function removeRentalPickupBlock(c:Context,ownerId:string,listingId:string,id:string){
  const result=await c.env.RENT.prepare('DELETE FROM c2c_pickup_blocks WHERE id=? AND listing_id=? AND EXISTS(SELECT 1 FROM c2c_listings WHERE id=? AND owner_id=?)').bind(id,listingId,listingId,ownerId).run()
  if(!result.meta.changes)throw new Error('不可取货记录不存在或无权修改')
  await createAuditLog(c,{action:'RENTAL_PICKUP_BLOCK_REMOVE',targetType:'c2c_listing',targetId:listingId,after:{id}})
}
