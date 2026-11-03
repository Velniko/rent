/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

import { buildLayout, getDevices } from '../../site'
import { calculateRentalFee } from '../../domain/rentalPricing'
import { hasRequiredC2CPhotos, parseC2CPhotos } from '../../domain/c2cPhotos'
import { escapeHtml as esc } from '../../lib/html'
import { c2cModeLabels } from '../../services/c2c'
import type { Context } from 'hono'

const currency=new Intl.NumberFormat('en-AU',{style:'currency',currency:'AUD',currencyDisplay:'narrowSymbol',maximumFractionDigits:2})
const normalize=(value: unknown)=>String(value || '').normalize('NFKD').toLowerCase().replace(/\s+/g,' ').trim()

export async function renderCustomerDevices(c: Context,user: any) {
  const rows=(await c.env.RENT.prepare(`SELECT l.device_id,l.owner_id,l.status,l.listing_mode,l.pickup_address,l.custody_received_at,m.mode AS member_mode,s.managed_commission_bps,u.status AS owner_status,u.deleted_at,l.photos_json,m.user_id AS member_id
    FROM c2c_listings l JOIN users u ON u.id=l.owner_id LEFT JOIN c2c_memberships m ON m.user_id=l.owner_id CROSS JOIN c2c_settings s`).all()).results || []
  const listings=new Map<string,any>(rows.map((l: any)=>[l.device_id,l]))
  const source=c.req.query('mode')==='c2c'?'owner':c.req.query('mode')
  const mode=['owner','platform'].includes(source || '')?source!:''
  const devices=(await getDevices(c)).filter(device=>{
    const l=listings.get(device.id)
    return device.status==='available' && (!l || (l.status==='approved' && l.owner_id!==user.id && l.owner_status==='active' && !l.deleted_at && l.member_id && l.pickup_address.trim() && l.listing_mode===l.member_mode && (l.listing_mode!=='managed' || (l.custody_received_at && l.managed_commission_bps!=null)) && hasRequiredC2CPhotos(l.photos_json)))
      && (mode==='owner'?Boolean(l):mode==='platform'?!l:true)
  })
  const categoryOrder=['游戏笔记本','轻薄商务本','台式工作站','普通笔记本','其他']
  const categories=[...new Set(devices.map(d=>d.category || '其他'))].sort((a,b)=>{
    const rank=(value: string)=>categoryOrder.includes(value)?categoryOrder.indexOf(value):categoryOrder.length
    return rank(a)-rank(b) || a.localeCompare(b,'zh-CN')
  })
  const query=String(c.req.query('q') || '').trim().slice(0,160)
  const category=categories.includes(c.req.query('category') || '')?c.req.query('category')!:''
  const sort=['price','price-desc','name'].includes(c.req.query('sort') || '')?c.req.query('sort')!:'default'
  const href=(values: Record<string,string>)=>{
    const params=new URLSearchParams({mode,q:query,category,sort:sort==='default'?'':sort,...values})
    for (const [key,value] of [...params]) if (!value) params.delete(key)
    return '/customer/devices'+(params.size?'?'+params.toString():'')
  }
  const defaultOrder=new Map(devices.map((device,index)=>[device.id,index]))
  if (sort!=='default') devices.sort((a,b)=>sort==='name'?a.name.localeCompare(b.name,'zh-CN'):(Number(a.pricePerDay ?? a.dailyRate ?? 0)-Number(b.pricePerDay ?? b.dailyRate ?? 0))*(sort==='price-desc'?-1:1))
  let shown=0
  const cards=devices.map(device=>{
    const personal=listings.get(device.id)
    const photo=personal?parseC2CPhotos(personal.photos_json).a?.url:''
    const daily=Number(device.pricePerDay ?? device.dailyRate ?? 0)
    const weekly=calculateRentalFee(device,7),monthly=calculateRentalFee(device,30)
    const specs=[device.cpu,device.gpu,device.ram,device.storage,device.os].filter(Boolean)
    const search=[device.name,device.brand,device.model,device.category,device.description,...specs].join(' ')
    const visible=(!category || device.category===category || (!device.category && category==='其他')) && normalize(query).split(' ').every(word=>normalize(search).includes(word))
    if (visible) shown++
    const price=(label: string,amount: number,original=amount)=>`<div><span>${label}</span><strong>${currency.format(amount)}</strong>${original-amount>0.005?`<del>${currency.format(original)}</del>`:''}</div>`
    const workstation=device.category==='台式工作站'
    return `<article class="customer-catalog__card" data-catalog-device data-category="${esc(device.category || '其他')}" data-search="${esc(search)}" data-price="${daily}" data-name="${esc(device.name)}" data-order="${defaultOrder.get(device.id)}" ${visible?'':'hidden'}>
      <div class="customer-catalog__visual ${workstation?'customer-catalog__visual--workstation':''}">${photo?`<img src="${esc(photo)}" alt="${esc(device.name)}" loading="lazy">`:`<span class="customer-catalog__screen" aria-hidden="true"><i></i></span><span class="customer-catalog__base" aria-hidden="true"></span><span class="customer-catalog__visual-code" aria-hidden="true">${workstation?'WORKSTATION':device.category==='游戏笔记本'?'GAMING':'LAPTOP'}</span>`}</div>
      <div class="customer-catalog__body"><div class="customer-catalog__top"><span class="customer-catalog__availability"><i aria-hidden="true"></i>可租</span><span class="customer-catalog__source">${personal?c2cModeLabels[personal.listing_mode as 'self'|'managed']:'平台自营'}</span></div>
      <h3><a href="/customer/rent/${encodeURIComponent(device.id)}">${esc(device.name)}</a></h3><p class="customer-catalog__model">${esc(device.category || '其他')}${device.model?` · ${esc(device.model)}`:''}</p>
      <div class="customer-catalog__specs">${specs.length?specs.map(spec=>`<span>${esc(spec)}</span>`).join(''):'<span>配置待更新</span>'}</div>
      <div class="customer-catalog__prices">${price('日租',daily)}${price('周租',weekly,daily*7)}${price('月租',monthly,daily*30)}</div>
      ${personal?`<div class="customer-catalog__pickup"><span>取件地址</span><address>${esc(personal.pickup_address)}</address></div>`:''}<div class="customer-catalog__deposit"><span>押金</span><strong>${currency.format(Number(device.depositAmount || 0))}</strong></div>
      <a class="button button-primary customer-catalog__book" href="/customer/rent/${encodeURIComponent(device.id)}"><span>选择租期</span><span aria-hidden="true">→</span></a></div></article>`
  }).join('')
  const body=`<section class="panel customer-catalog" id="customer-device-catalog"><header class="customer-catalog__header"><div><p class="section-code">DEVICE CATALOG</p><h2>可租设备</h2></div><a class="button button-secondary" href="/customer/rental-program">发布我的设备</a></header>
    <nav class="customer-catalog__sources" aria-label="设备来源">${[['','全部设备'],['platform','平台自营'],['owner','个人设备']].map(([value,label])=>`<a data-catalog-source="${value}" href="${esc(href({mode:value}))}" ${mode===value?'aria-current="page"':''}>${label}</a>`).join('')}</nav>
    <form class="customer-catalog__tools" method="get" action="/customer/devices" role="search" aria-label="搜索和筛选租赁设备"><input type="hidden" name="mode" value="${mode}"><input type="hidden" name="category" value="${esc(category)}" id="catalog-category">
      <label class="customer-catalog__search" for="catalog-search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"></circle><path d="m16 16 4.5 4.5"></path></svg><input id="catalog-search" name="q" type="search" value="${esc(query)}" placeholder="搜索型号、CPU、显卡、操作系统…" aria-label="搜索租赁设备" aria-controls="customer-device-grid" maxlength="160" autocomplete="off"></label>
      <select class="form-control customer-catalog__sort" id="catalog-sort" name="sort" aria-label="排序方式">${[['default','默认排序'],['price','价格从低到高'],['price-desc','价格从高到低'],['name','名称排序']].map(([value,label])=>`<option value="${value}" ${sort===value?'selected':''}>${label}</option>`).join('')}</select>
      <nav class="customer-catalog__categories" aria-label="设备分类">${[['', '全部', devices.length],...categories.map(value=>[value,value,devices.filter(d=>(d.category || '其他')===value).length])].map(([value,label,count])=>`<a data-catalog-category="${esc(value)}" href="${esc(href({category:String(value)}))}" ${category===value?'aria-current="true"':''}>${esc(label)}<span>${count}</span></a>`).join('')}</nav><noscript><button class="button button-secondary" type="submit">应用筛选</button></noscript></form>
    <div class="customer-catalog__meta"><span><strong id="catalog-result-count" aria-live="polite">${shown}</strong> 台设备</span><span>AUD</span></div>
    <div class="customer-catalog__grid" id="customer-device-grid">${cards}</div>
    <div class="customer-catalog__empty" id="catalog-empty" ${shown?'hidden':''}><span aria-hidden="true">⌕</span><h3>${devices.length?'没有匹配的设备':'暂无可用设备。'}</h3><a class="button button-secondary" id="catalog-clear" href="/customer/devices">清除筛选</a></div></section>${customerCatalogScript}`
  return buildLayout('可租设备 - 电脑租赁管理系统',body,user)
}

const customerCatalogScript=`<script>(()=>{
  const root=document.getElementById('customer-device-catalog');if(!root)return;
  const grid=root.querySelector('#customer-device-grid'),cards=Array.from(grid.querySelectorAll('[data-catalog-device]')),search=root.querySelector('#catalog-search'),category=root.querySelector('#catalog-category'),sort=root.querySelector('#catalog-sort');
  const normal=value=>String(value||'').normalize('NFKD').toLowerCase().replace(/\\s+/g,' ').trim();
  function apply(updateUrl=true){
    const terms=normal(search.value).split(' ');let shown=0;
    cards.forEach(card=>{const visible=(!category.value||card.dataset.category===category.value)&&terms.every(term=>normal(card.dataset.search).includes(term));card.hidden=!visible;if(visible)shown++});
    cards.slice().sort((a,b)=>sort.value==='price'?Number(a.dataset.price)-Number(b.dataset.price):sort.value==='price-desc'?Number(b.dataset.price)-Number(a.dataset.price):sort.value==='name'?a.dataset.name.localeCompare(b.dataset.name,'zh-CN'):Number(a.dataset.order)-Number(b.dataset.order)).forEach(card=>grid.append(card));
    root.querySelector('#catalog-result-count').textContent=String(shown);root.querySelector('#catalog-empty').hidden=shown>0;
    const url=new URL('/customer/devices',location.origin);const mode=root.querySelector('input[name="mode"]').value;if(mode)url.searchParams.set('mode',mode);if(search.value.trim())url.searchParams.set('q',search.value.trim());else url.searchParams.delete('q');if(category.value)url.searchParams.set('category',category.value);else url.searchParams.delete('category');if(sort.value!=='default')url.searchParams.set('sort',sort.value);else url.searchParams.delete('sort');if(updateUrl)history.replaceState(history.state,'',url.pathname+url.search);
    root.querySelectorAll('[data-catalog-category]').forEach(link=>{if(link.dataset.catalogCategory===category.value)link.setAttribute('aria-current','true');else link.removeAttribute('aria-current');const next=new URL(url);if(link.dataset.catalogCategory)next.searchParams.set('category',link.dataset.catalogCategory);else next.searchParams.delete('category');link.href=next.pathname+next.search});
    root.querySelectorAll('[data-catalog-source]').forEach(link=>{const next=new URL(url);if(link.dataset.catalogSource)next.searchParams.set('mode',link.dataset.catalogSource);else next.searchParams.delete('mode');link.href=next.pathname+next.search});
  }
  search.addEventListener('input',()=>apply());sort.addEventListener('change',()=>apply());
  root.querySelector('form').addEventListener('submit',event=>{event.preventDefault();apply()});
  root.querySelectorAll('[data-catalog-category]').forEach(link=>link.addEventListener('click',event=>{event.preventDefault();category.value=link.dataset.catalogCategory;apply()}));
  root.querySelector('#catalog-clear').addEventListener('click',event=>{if(!cards.length)return;event.preventDefault();search.value='';category.value='';sort.value='default';apply();search.focus()});apply(false);
})();</script>`
