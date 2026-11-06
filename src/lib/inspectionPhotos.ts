/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */
import type { Context } from 'hono'
import { uploadSiteImage, imageFiles, validateImageFile } from '../services/objectStorage'
export const INSPECTION_PHOTOS=[['a','A 面 · 顶盖'],['b','B 面 · 屏幕'],['c','C 面 · 键盘'],['d','D 面 · 底盖'],['power','开机照片']] as const
export function renderInspectionPhotos() {
 return `<section class="inspection-photo-section"><h3>验机照片</h3><div class="inspection-photo-grid">${INSPECTION_PHOTOS.map(([key,label])=>`<label class="inspection-photo-drop"><strong>${label}</strong><input type="file" name="inspectionPhoto_${key}" accept="image/jpeg,image/png,image/webp" required data-inspection-photo><span>上传照片</span><img alt="${label}" hidden></label>`).join('')}</div></section>`
}
export async function readInspectionPhotos(c:Context,user:any,form:Record<string,unknown>):Promise<Record<string,string>> {
 const files=INSPECTION_PHOTOS.map(([key,label])=>{const selected=imageFiles(form['inspectionPhoto_'+key]);if(selected.length!==1)throw new Error('请上传'+label);return {key,file:selected[0]}})
 for(const item of files)await validateImageFile(item.file)
 if(files.reduce((n,item)=>n+item.file.size,0)>5*1024*1024)throw new Error('验机照片总大小不能超过 5MB')
 const result:Record<string,string>={}
 for(const {key,file} of files)result[key]=await uploadSiteImage(file,c,'rent/inspection-photos',{watermark:true})
 return result
}
