/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

import test from 'node:test'
import assert from 'node:assert/strict'
import { runInNewContext } from 'node:vm'
import { renderMobileOrderScanner } from '../src/pages/staff/mobileScan'
import { extractInlineScripts } from './helpers'

function scannerHarness(mode: 'library' | 'native' | 'denied' = 'library', pending = false) {
  const permission = Promise.withResolvers<void>()
  const elements = new Map<string, any>()
  for (const id of ['qr-reader', 'start-camera', 'stop-camera', 'scan-status', 'mobile-order-scanner', 'open-mobile-scanner','scan-result','confirm-order-scan','rescan-order','order-code-form','order-verification-code','scan-result-order','scan-result-customer','scan-result-device']) elements.set(id, {
    hidden: ['stop-camera','scan-result'].includes(id), value:'', reportValidity(){return true}, textContent: '', events: {} as Record<string, () => Promise<void>>,
    addEventListener(name: string, handler: () => Promise<void>) { this.events[name] = handler },
    replaceChildren() {}, appendChild() {}, querySelector() { return { readyState: 2 } },
  })
  let success: ((value: string) => Promise<void>) | undefined
  let running = false, stopCalls = 0, clearCalls = 0, trackStops = 0
  const location = { href: '',hash:'' };const requests:any[]=[]
  class Scanner {
    async start(_camera: unknown, _options: unknown, onSuccess: (value: string) => Promise<void>) {
      if (mode === 'denied') throw new Error('Permission denied')
      if (pending) await permission.promise
      running = true; success = onSuccess
    }
    async stop() { stopCalls++; await Promise.resolve(); running = false }
    // Html5Qrcode 2.3.8 clear() returns void and must run after stop() resolves.
    clear() { assert.equal(running, false, 'must stop the camera before clearing'); clearCalls++ }
  }
  const window = { Html5Qrcode: mode === 'native' ? undefined : Scanner, BarcodeDetector: class {}, addEventListener() {} }
  const context = {
    window, location,fetch:async(path:string,init:any)=>{const body=JSON.parse(init.body);requests.push({path,body});return {ok:true,json:async()=>path.endsWith('/confirm')?{next:'/staff/orders/pickup-order/handover'}:{orderId:'pickup-order',stage:'pickup',orderNo:'OD-TEST',customer:'客户',device:'电脑'}}},
    document: { getElementById: (id: string) => elements.get(id), createElement: () => ({}) },
    navigator: { mediaDevices: { async getUserMedia() { if (pending) await permission.promise; return { getTracks: () => [{ stop() { trackStops++ } }] } } } },
    BarcodeDetector: class { async detect() { return [{ rawValue: 'https://rent.example.test/pickup/pickup-order' }] } },
    requestAnimationFrame() { return 1 }, cancelAnimationFrame() {},
  }
  const html = renderMobileOrderScanner()
  const script = extractInlineScripts(html).find(value => value.includes('const nativeScan='))!
  runInNewContext(script, context)
  return {
    elements, location,requests,confirm:()=>elements.get('confirm-order-scan').events.click(),
    start: () => elements.get('start-camera').events.click(), stop: () => elements.get('stop-camera').events.click(),
    close: () => elements.get('mobile-order-scanner').events.close(), finishPermission: () => permission.resolve(),
    decode: (value: string) => success!(value),
    counts: () => ({ stopCalls, clearCalls, trackStops }),
  }
}

test('library scanner stops and clears before navigating to the decoded pickup order', async () => {
  const h = scannerHarness()
  assert.deepEqual(h.counts(), { stopCalls: 0, clearCalls: 0, trackStops: 0 })
  await h.start()
  await Promise.all([h.decode('https://rent.example.test/pickup/pickup-order'), h.decode('https://rent.example.test/pickup/pickup-order')])
  assert.equal(h.location.href, '')
  assert.equal(h.elements.get('scan-result').hidden,false)
  assert.equal(h.requests.length,1)
  assert.equal(h.requests[0].body.source,'camera')
  await h.confirm()
  assert.equal(h.location.href, '/staff/orders/pickup-order/handover')
  assert.equal(h.counts().stopCalls, 1)
  assert.equal(h.counts().clearCalls, 1)
})

test('library camera can be stopped and restarted, and permission failure permits retry', async () => {
  const h = scannerHarness()
  await h.start(); await h.stop(); await h.start()
  await h.decode('RENT-PICKUP:pickup-order')
  assert.equal(h.counts().clearCalls, 2)
  assert.equal(h.location.href,'')
  assert.equal(h.requests[0].body.code,'RENT-PICKUP:pickup-order')
  await h.confirm()
  assert.match(h.location.href,/handover/)
  const denied = scannerHarness('denied')
  await denied.start()
  assert.equal(denied.location.href, '')
  assert.match(denied.elements.get('scan-status').textContent, /无法打开相机/)
  assert.equal(denied.elements.get('start-camera').hidden, false)
})

test('native scanner fallback releases camera tracks and navigates to the decoded order', async () => {
  const h = scannerHarness('native')
  await h.start()
  // Native detection runs asynchronously after camera startup.
  for(let i=0;i<12;i++)await Promise.resolve()
  assert.equal(h.counts().trackStops, 1)
  assert.equal(h.location.href,'')
  assert.equal(h.elements.get('scan-result').hidden,false)
  await h.confirm()
  assert.match(h.location.href, /pickup-order/)
})

test('closing the integrated scanner releases the camera even if startup is still pending', async () => {
  for (const mode of ['library', 'native'] as const) {
    const h = scannerHarness(mode, true)
    const starting = h.start()
    await h.close()
    h.finishPermission()
    await starting
    assert.equal(h.location.href, '')
    assert.equal(h.elements.get('start-camera').hidden, false)
    assert.equal(h.elements.get('stop-camera').hidden, true)
    assert.deepEqual(h.counts(), mode === 'library' ? { stopCalls: 1, clearCalls: 1, trackStops: 0 } : { stopCalls: 0, clearCalls: 0, trackStops: 1 })
  }
  const active = scannerHarness()
  await active.start()
  await active.close()
  assert.equal(active.counts().stopCalls, 1)
  assert.equal(active.counts().clearCalls, 1)
})

test('fallback verification uppercases input and waits for a separate human confirmation', async () => {
  const h=scannerHarness()
  const input=h.elements.get('order-verification-code')
  input.value='a7k2p9';input.events.input()
  assert.equal(input.value,'A7K2P9')
  await h.elements.get('order-code-form').events.submit({preventDefault(){}})
  assert.equal(h.requests[0].body.source,'code')
  assert.equal(h.requests[0].body.code,'A7K2P9')
  assert.equal(h.location.href,'')
  await Promise.all([h.confirm(),h.confirm()])
  assert.equal(h.requests.filter(request=>request.path.endsWith('/confirm')).length,1)
  assert.equal(h.location.href,'/staff/orders/pickup-order/handover')
})
