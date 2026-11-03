/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

import { escapeHtml } from '../../lib/html'
import { C2C_PHOTO_SLOTS, parseC2CPhotos } from '../../domain/c2cPhotos'

export function renderC2CPhotoGallery(raw: unknown): string {
  const photos=parseC2CPhotos(raw)
  const cards=C2C_PHOTO_SLOTS.flatMap(slot=>{
    const photo=photos[slot.key]
    return photo?[`<figure style="margin:0"><a href="${escapeHtml(photo.url)}" target="_blank" rel="noopener noreferrer"><img src="${escapeHtml(photo.url)}" alt="${slot.label}" loading="lazy" style="width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:8px"></a><figcaption>${slot.label}</figcaption></figure>`]:[]
  })
  return cards.length?`<div class="grid grid-3" aria-label="设备照片">${cards.join('')}</div>`:''
}
export function renderC2CPhotoFields(raw?: unknown): string {
  const photos=parseC2CPhotos(raw)
  return `<fieldset style="border:0;padding:0;margin:20px 0"><legend>设备照片</legend><p class="form-text">JPG、PNG、WebP，单张不超过 5MB</p><div class="grid grid-3">${C2C_PHOTO_SLOTS.map(slot=>{
    const photo=photos[slot.key]
    return `<div class="card" data-c2c-photo="${slot.key}"><label class="form-label" for="c2c-photo-${slot.key}">${slot.label}</label><input id="c2c-photo-${slot.key}" class="form-control" type="file" accept="image/jpeg,image/png,image/webp" ${slot.required && !photo?'required':''}><input type="hidden" name="photo_${slot.key}" value="${escapeHtml(photo?.id || '')}"><div data-c2c-photo-preview>${photo?`<img src="${escapeHtml(photo.url)}" alt="${slot.label}" style="width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:8px">`:''}</div><span data-c2c-photo-status role="status">${photo?'已上传':''}</span></div>`
  }).join('')}</div></fieldset>`
}
export const c2cPhotoUploadScript = `<script>(()=>{
  const form=document.getElementById('c2c-listing-form');if(!form||form.dataset.photosReady)return;form.dataset.photosReady='1';
  const submit=form.querySelector('button[type="submit"]');let pending=0;
  form.querySelectorAll('[data-c2c-photo]').forEach(card=>{
    const input=card.querySelector('input[type="file"]'),hidden=card.querySelector('input[type="hidden"]'),status=card.querySelector('[data-c2c-photo-status]'),preview=card.querySelector('[data-c2c-photo-preview]');
    input.addEventListener('change',async()=>{
      const file=input.files[0];if(!file)return;
      const previous=hidden.value;pending++;submit.disabled=true;input.disabled=true;status.textContent='正在上传…';
      try{
        if(!['image/jpeg','image/png','image/webp'].includes(file.type))throw new Error('只支持 JPG、PNG 或 WebP 图片');
        if(file.size>5*1024*1024)throw new Error('单张图片不能超过 5MB');
        const body=new FormData();body.append('file',file);body.append('slot',card.dataset.c2cPhoto);
        const response=await fetch('/customer/rental-program/photos',{method:'POST',credentials:'same-origin',body});
        const data=await response.json().catch(()=>null);if(!response.ok||!data||!data.id||!data.url)throw new Error(data&&data.error||'图片上传失败，请稍后重试');
        hidden.value=data.id;input.required=false;preview.replaceChildren();const image=document.createElement('img');image.src=data.url;image.alt=card.querySelector('label').textContent;image.style.cssText='width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:8px';preview.append(image);status.textContent='已上传';
      }catch(error){hidden.value=previous;input.value='';status.textContent=error.message||'图片上传失败，请稍后重试'}
      finally{input.disabled=false;pending--;submit.disabled=pending>0}
    });
  });
  form.addEventListener('submit',event=>{if(pending)event.preventDefault()});
})();</script>`
