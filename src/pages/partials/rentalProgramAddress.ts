/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

import { escapeHtml as esc } from '../../lib/html'
import { AU_STATES, SHIPPING_FIELDS, parseShippingAddress } from '../../domain/rentalProgramAddress'

export function renderShippingAddressFields(raw: unknown,legacy='',prefix='shipping',legend='托管寄件地址'): string {
  const address=parseShippingAddress(raw)
  if (!address.line1 && legacy) address.line1=legacy
  return `<fieldset class="rental-shipping-fields"><legend>${esc(legend)}</legend><div class="grid grid-2">${SHIPPING_FIELDS.map(({key,label,max})=>`<div class="form-group"><label class="form-label" for="${prefix}-${key}">${key==='recipient'&&prefix==='pickup'?'联系人 / 单位':label}</label>${key==='state'?`<select class="form-control" id="${prefix}-state" name="${prefix}_state" ${prefix==='pickup'?'required':''}><option value="">选择州 / 领地</option>${AU_STATES.map(state=>`<option value="${state}" ${address.state===state?'selected':''}>${state}</option>`).join('')}</select>`:`<input class="form-control" id="${prefix}-${key}" name="${prefix}_${key}" value="${esc(address[key] || (key==='country'?'Australia':''))}" maxlength="${max}" ${prefix==='pickup'&&['line1','city','postcode'].includes(key)?'required':''} ${key==='country'?'readonly':key==='postcode'?'inputmode="numeric" pattern="[0-9]{4}"':''}>`}</div>`).join('')}</div></fieldset>`
}
export function renderShippingAddress(raw: unknown,legacy: string,prefix='shipping'): string {
  const address=parseShippingAddress(raw)
  if (!address.line1) return `<address class="rental-postal-legacy">${esc(legacy)}</address>`
  return `<dl class="rental-postal-address">${SHIPPING_FIELDS.filter(({key})=>address[key]).map(({key,label})=>`<div class="${key.startsWith('line')?'rental-postal-address__line':''}"><dt>${key==='recipient'&&prefix==='pickup'?'联系人 / 单位':label.replace('（选填）','')}</dt><dd>${esc(address[key])}</dd></div>`).join('')}</dl>`
}
