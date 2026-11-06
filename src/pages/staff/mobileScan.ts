/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

import { escapeHtml } from '../../lib/html'

export const MOBILE_SCAN_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5M3 12h18"/></svg>'

export function renderMobileOrderScanner(stage = '', error = ''): string {
  const safeStage = ['pickup', 'return'].includes(stage) ? stage : ''
  const scanPrefix = '/staff/mobile/scan?' + (safeStage ? 'stage=' + safeStage + '&' : '') + 'code='
  return `<dialog class="workspace-dialog mobile-order-scan-dialog" id="mobile-order-scanner" aria-labelledby="mobile-scan-title">
    <div class="mobile-order-scan-dialog__head"><div><p class="section-code">SCAN / ORDER</p><h2 id="mobile-scan-title">扫码查单</h2></div><button class="dialog-icon-close" type="button" data-close-dialog aria-label="关闭扫码">×</button></div>
    <div class="mobile-order-scan-dialog__body">${error ? `<p class="workspace-form-error" role="alert">${escapeHtml(error)}</p>` : ''}
      <div id="qr-reader" class="mobile-qr-reader"><div class="mobile-qr-reader__placeholder">${MOBILE_SCAN_ICON}<span>将客户二维码放入框内</span></div></div>
      <p id="scan-status" class="mobile-scan-status" role="status" aria-live="polite">点击打开相机</p>
      <div class="mobile-scan-actions"><button class="button button-primary" type="button" id="start-camera">${error ? '继续扫码' : '打开相机'}</button><button class="button button-secondary" type="button" id="stop-camera" hidden>停止相机</button></div>
      <form method="get" action="/staff/mobile/scan" class="mobile-scan-manual">${safeStage ? `<input type="hidden" name="stage" value="${safeStage}">` : ''}<label class="form-label" for="scan-code">输入订单号或后 6 位</label><div class="mobile-scan-manual__row"><input class="form-control" id="scan-code" name="code" placeholder="完整订单号、后 6 位或扫码内容" autocomplete="off" inputmode="search" enterkeyhint="search" required><button class="button button-secondary" type="submit">查找</button></div></form>
    </div>
  </dialog>
  <script>(()=>{
    const reader=document.getElementById('qr-reader'),start=document.getElementById('start-camera'),stop=document.getElementById('stop-camera'),status=document.getElementById('scan-status'),dialog=document.getElementById('mobile-order-scanner'),open=document.getElementById('open-mobile-scanner');
    if(!reader||!start||!stop||!status)return;
    let scanner=null,stream=null,frame=0,stopped=true,navigating=false,starting=false,attempt=0;
    const setStatus=value=>{status.textContent=value};
    const releaseScanner=async active=>{try{await active.stop()}catch(_){}try{active.clear()}catch(_){}};
    const stopCamera=async()=>{stopped=true;attempt++;if(frame)cancelAnimationFrame(frame);frame=0;const activeScanner=scanner;scanner=null;if(stream){stream.getTracks().forEach(track=>track.stop());stream=null}if(activeScanner)await releaseScanner(activeScanner);start.hidden=false;stop.hidden=true};
    const go=async value=>{const code=String(value||'').trim();if(!code||navigating)return;navigating=true;await stopCamera();location.href=${JSON.stringify(scanPrefix)}+encodeURIComponent(code)};
    const nativeScan=async()=>{if(stopped||!stream)return;try{const detector=new BarcodeDetector({formats:['qr_code']});const video=reader.querySelector('video');if(video?.readyState>=2){const found=await detector.detect(video);if(stopped||!stream)return;if(found?.[0]?.rawValue){await go(found[0].rawValue);return}}}catch(_){await stopCamera();setStatus('当前浏览器无法识别二维码，请使用下方输入框或刷新后重试。');return}if(!stopped)frame=requestAnimationFrame(nativeScan)};
    const loadLibrary=()=>new Promise((resolve,reject)=>{if(window.Html5Qrcode)return resolve();const script=document.createElement('script');script.src='https://cdn.jsdelivr.net/npm/html5-qrcode@2.3.8/html5-qrcode.min.js';script.onload=resolve;script.onerror=reject;document.head.appendChild(script)});
    const startCamera=async()=>{if(starting||scanner||stream)return;starting=true;stopped=false;const current=++attempt;start.hidden=true;stop.hidden=false;setStatus('正在请求相机权限…');try{
      if(!window.Html5Qrcode&&!window.BarcodeDetector)await loadLibrary();if(current!==attempt||stopped)return;
      if(window.Html5Qrcode){const active=new window.Html5Qrcode('qr-reader');await active.start({facingMode:'environment'},{fps:10,qrbox:{width:240,height:240}},go,()=>{});if(current!==attempt||stopped){await releaseScanner(active);return}scanner=active;setStatus('请将取货二维码放入框内。');return}
      if(!navigator.mediaDevices?.getUserMedia||!window.BarcodeDetector)throw new Error('unsupported');
      const active=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'}}});if(current!==attempt||stopped){active.getTracks().forEach(track=>track.stop());return}stream=active;reader.replaceChildren();const video=document.createElement('video');video.autoplay=true;video.playsInline=true;video.muted=true;video.srcObject=stream;reader.appendChild(video);setStatus('请将取货二维码放入框内。');nativeScan();
    }catch(_){if(current===attempt){await stopCamera();setStatus('无法打开相机。请确认已允许相机权限，并使用 HTTPS 访问；也可以手动输入订单号。')}}finally{starting=false}};
    const show=()=>{if(window.WorkspaceMotion)window.WorkspaceMotion.open(dialog);else dialog.showModal()};
    if(open&&dialog){open.addEventListener('click',show);dialog.addEventListener('close',stopCamera);dialog.addEventListener('cancel',stopCamera);if(${JSON.stringify(Boolean(error))}||location.hash==='#scan')window.addEventListener('DOMContentLoaded',show,{once:true})}
    start.addEventListener('click',startCamera);stop.addEventListener('click',stopCamera);window.addEventListener('pagehide',stopCamera);
  })();</script>`
}
