/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

export const AU_STATES=['VIC','NSW','QLD','SA','WA','TAS','ACT','NT'] as const
export const SHIPPING_FIELDS=[
  {key:'recipient',label:'收件人 / 单位',max:80},
  {key:'line1',label:'Address line 1',max:100},
  {key:'line2',label:'Address line 2（选填）',max:100},
  {key:'line3',label:'Address line 3（选填）',max:100},
  {key:'city',label:'城市 / 城区',max:80},
  {key:'state',label:'州 / 领地',max:3},
  {key:'postcode',label:'邮编',max:4},
  {key:'country',label:'国家',max:20},
  {key:'phone',label:'联系电话（选填）',max:30},
] as const
export type ShippingAddress=Partial<Record<typeof SHIPPING_FIELDS[number]['key'],string>>

export function parseShippingAddress(raw: unknown): ShippingAddress {
  try {
    const parsed=JSON.parse(String(raw || '{}')),address: ShippingAddress={}
    for (const {key,max} of SHIPPING_FIELDS) if(typeof parsed?.[key]==='string') address[key]=parsed[key].slice(0,max)
    return address
  } catch { return {} }
}
export function shippingAddressFromForm(form: Record<string,unknown>,prefix='shipping'): ShippingAddress {
  const address: ShippingAddress={}
  for (const {key,max} of SHIPPING_FIELDS) {
    const value=String(form[`${prefix}_${key}`] || '').trim()
    if (value.length>max || /[<>\u0000-\u001f\u007f]/.test(value)) throw new Error(prefix==='pickup'?'请填写有效的取件地址':'请填写有效的托管寄件地址')
    address[key]=value
  }
  if (!SHIPPING_FIELDS.some(({key})=>key!=='country' && address[key])) return {}
  if (!address.line1 || !address.city || !AU_STATES.includes(address.state as typeof AU_STATES[number]) || !/^\d{4}$/.test(address.postcode || '') || (address.country && address.country!=='Australia')) throw new Error('请填写地址第一行、城市、州和四位邮编')
  address.country='Australia'
  return address
}
export function formatShippingAddress(address: ShippingAddress): string {
  return [address.recipient,address.line1,address.line2,address.line3,[address.city,address.state,address.postcode].filter(Boolean).join(' '),address.country,address.phone].filter(Boolean).join('\n')
}
