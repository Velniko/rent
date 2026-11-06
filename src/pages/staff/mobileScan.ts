/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

import { escapeHtml } from '../../lib/html'

export const MOBILE_SCAN_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5M3 12h18"/></svg>'

export function renderMobileOrderScanner(stage = '', error = '', orderId = ''): string {
  const safeStage = ['pickup', 'return'].includes(stage) ? stage : ''
  return `<dialog class="workspace-dialog mobile-order-scan-dialog" id="mobile-order-scanner" aria-labelledby="mobile-scan-title">
    <div class="mobile-order-scan-dialog__head"><div><p class="section-code">SCAN / ORDER</p><h2 id="mobile-scan-title">扫码查单</h2></div><button class="dialog-icon-close" type="button" data-close-dialog aria-label="关闭扫码">×</button></div>
    <div class="mobile-order-scan-dialog__body">${error ? `<p class="workspace-form-error" role="alert">${escapeHtml(error)}</p>` : ''}
      <div id="qr-reader" class="mobile-qr-reader"><div class="mobile-qr-reader__placeholder">${MOBILE_SCAN_ICON}<span>将客户二维码放入框内</span></div></div>
      <p id="scan-status" class="mobile-scan-status" role="status" aria-live="polite">点击打开相机</p>
      <div class="mobile-scan-actions"><button class="button button-primary" type="button" id="start-camera">${error ? '继续扫码' : '打开相机'}</button><button class="button button-secondary" type="button" id="stop-camera" hidden>停止相机</button></div>
      <form id="order-code-form" class="mobile-scan-manual"><label class="form-label" for="order-verification-code">6 位取还校验码</label><div class="mobile-scan-manual__row"><input class="form-control" id="order-verification-code" name="verificationCode" pattern="[A-Za-z0-9]{6}" maxlength="6" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="例如 A7K2P9" required><button class="button button-secondary" type="submit">核验订单</button></div></form>
      <section id="scan-result" class="mobile-scan-result" hidden><h3>确认本次操作</h3><dl><dt>订单号</dt><dd id="scan-result-order"></dd><dt>客户</dt><dd id="scan-result-customer"></dd><dt>设备</dt><dd id="scan-result-device"></dd></dl><div class="record-actions"><button class="button button-secondary" type="button" id="rescan-order">重新扫码</button><button class="button button-primary" type="button" id="confirm-order-scan"></button></div></section>
    </div>
  </dialog>
  <script>(()=>{
    const reader=document.getElementById('qr-reader'),start=document.getElementById('start-camera'),stop=document.getElementById('stop-camera'),status=document.getElementById('scan-status'),dialog=document.getElementById('mobile-order-scanner'),open=document.getElementById('open-mobile-scanner');
    if(!reader||!start||!stop||!status)return;
    const result=document.getElementById('scan-result'),confirm=document.getElementById('confirm-order-scan'),rescan=document.getElementById('rescan-order'),codeForm=document.getElementById('order-code-form'),codeInput=document.getElementById('order-verification-code');
    let scanner=null,stream=null,frame=0,stopped=true,navigating=false,starting=false,attempt=0,confirming=false,scannedOrder=null;
    const setStatus=value=>{status.textContent=value};
    const releaseScanner=async active=>{try{await active.stop()}catch(_){}try{active.clear()}catch(_){}};
    const stopCamera=async()=>{stopped=true;attempt++;if(frame)cancelAnimationFrame(frame);frame=0;const activeScanner=scanner;scanner=null;if(stream){stream.getTracks().forEach(track=>track.stop());stream=null}if(activeScanner)await releaseScanner(activeScanner);start.hidden=false;stop.hidden=true};
    const request=async(path,body)=>{const response=await fetch(path,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify(body)});const data=await response.json();if(!response.ok)throw new Error(data.error||'扫码失败，请重新扫码');return data};
    const identify=async(value,source)=>{const code=String(value||'').trim();if(!code||navigating)return;navigating=true;await stopCamera();setStatus('正在核对订单…');try{const data=await request('/staff/mobile/scan/verify',{code,source,stage:${JSON.stringify(safeStage)},orderId:${JSON.stringify(orderId)}});scannedOrder=data;document.getElementById('scan-result-order').textContent=data.orderNo;document.getElementById('scan-result-customer').textContent=data.customer;document.getElementById('scan-result-device').textContent=data.device;confirm.textContent=data.stage==='pickup'?'确认取货':'确认归还';reader.hidden=true;start.hidden=true;codeForm.hidden=true;result.hidden=false;setStatus(data.stage==='pickup'?'请确认客户与设备后取货':'请确认已收到客户归还的设备');window.WorkspaceMotion?.reveal(result)}catch(error){navigating=false;setStatus(error.message);start.hidden=false}};
    const go=value=>identify(value,'camera');
    codeInput.addEventListener('input',()=>{codeInput.value=codeInput.value.toUpperCase()});
    codeForm.addEventListener('submit',async event=>{event.preventDefault();if(codeForm.reportValidity())await identify(codeInput.value.trim().toUpperCase(),'code')});
    confirm.addEventListener('click',async()=>{if(confirming)return;confirming=true;confirm.disabled=true;try{const data=await request('/staff/mobile/scan/confirm',{orderId:scannedOrder.orderId,stage:scannedOrder.stage});location.href=data.next}catch(error){setStatus(error.message);confirm.disabled=false;confirming=false}});
    rescan.addEventListener('click',()=>{result.hidden=true;reader.hidden=false;codeForm.hidden=false;codeInput.value='';start.hidden=false;confirm.disabled=false;confirming=false;navigating=false;setStatus('点击打开相机')});
    const nativeScan=async()=>{if(stopped||!stream)return;try{const detector=new BarcodeDetector({formats:['qr_code']});const video=reader.querySelector('video');if(video?.readyState>=2){const found=await detector.detect(video);if(stopped||!stream)return;if(found?.[0]?.rawValue){await go(found[0].rawValue);return}}}catch(_){await stopCamera();setStatus('当前浏览器无法扫码，请更换浏览器后重试。');return}if(!stopped)frame=requestAnimationFrame(nativeScan)};
    const loadLibrary=()=>new Promise((resolve,reject)=>{if(window.Html5Qrcode)return resolve();const script=document.createElement('script');script.src='https://cdn.jsdelivr.net/npm/html5-qrcode@2.3.8/html5-qrcode.min.js';script.onload=resolve;script.onerror=reject;document.head.appendChild(script)});
    const startCamera=async()=>{if(starting||scanner||stream)return;starting=true;stopped=false;const current=++attempt;start.hidden=true;stop.hidden=false;setStatus('正在请求相机权限…');try{
      if(!window.Html5Qrcode&&!window.BarcodeDetector)await loadLibrary();if(current!==attempt||stopped)return;
      if(window.Html5Qrcode){const active=new window.Html5Qrcode('qr-reader');await active.start({facingMode:'environment'},{fps:10,qrbox:{width:240,height:240}},go,()=>{});if(current!==attempt||stopped){await releaseScanner(active);return}scanner=active;setStatus('请将取货二维码放入框内。');return}
      if(!navigator.mediaDevices?.getUserMedia||!window.BarcodeDetector)throw new Error('unsupported');
      const active=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'}}});if(current!==attempt||stopped){active.getTracks().forEach(track=>track.stop());return}stream=active;reader.replaceChildren();const video=document.createElement('video');video.autoplay=true;video.playsInline=true;video.muted=true;video.srcObject=stream;reader.appendChild(video);setStatus('请将取货二维码放入框内。');nativeScan();
    }catch(_){if(current===attempt){await stopCamera();setStatus('无法打开相机，请允许相机权限后重新扫码。')}}finally{starting=false}};
    const show=()=>{if(window.WorkspaceMotion)window.WorkspaceMotion.open(dialog);else dialog.showModal()};
    if(open&&dialog){open.addEventListener('click',show);dialog.addEventListener('close',stopCamera);dialog.addEventListener('cancel',stopCamera);if(${JSON.stringify(Boolean(error))}||location.hash==='#scan')window.addEventListener('DOMContentLoaded',show,{once:true})}
    start.addEventListener('click',startCamera);stop.addEventListener('click',stopCamera);window.addEventListener('pagehide',stopCamera);
  })();</script>`
}
