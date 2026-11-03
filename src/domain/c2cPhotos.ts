/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

import { validateHostedImageUrls } from '../lib/hostedImages'

export const C2C_PHOTO_SLOTS = [
  {key:'a',label:'A 面（顶盖）',required:true},
  {key:'b',label:'B 面（屏幕）',required:true},
  {key:'c',label:'C 面（键盘）',required:true},
  {key:'d',label:'D 面（底盖）',required:true},
  {key:'power',label:'屏幕开机画面',required:true},
  {key:'extra',label:'配件与接口（选填）',required:false},
] as const
export type C2CPhotoSlot = typeof C2C_PHOTO_SLOTS[number]['key']
export interface C2CPhoto {id:string;url:string}
export type C2CPhotos = Partial<Record<C2CPhotoSlot,C2CPhoto>>

export function parseC2CPhotos(raw: unknown): C2CPhotos {
  const photos: C2CPhotos={}
  try {
    const data=JSON.parse(String(raw || '{}'))
    for (const {key} of C2C_PHOTO_SLOTS) {
      const photo=data?.[key]
      if (!photo || typeof photo.id!=='string' || !/^c2cp-[A-Za-z0-9_-]{16}$/.test(photo.id) || typeof photo.url!=='string') continue
      try { photos[key]={id:photo.id,url:validateHostedImageUrls(photo.url,1)[0]} } catch { }
    }
  } catch { }
  return photos
}
export function hasRequiredC2CPhotos(raw: unknown): boolean {
  const photos=parseC2CPhotos(raw)
  return C2C_PHOTO_SLOTS.every(slot=>!slot.required || Boolean(photos[slot.key]))
}
