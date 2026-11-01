/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

// 站内 Stripe Payment Element 收款组件（自助结账订单详情页 / 签约付款步骤 / 余额充值共用）。
//
// - stripeJsTag(): Stripe.js 脚本标签，每个页面引一次。
// - stripePaymentHelperScript(): 定义全局 window.__mountStripePayment(container, opts)，
//   拉起 Payment Element 并返回 { confirm } —— confirm() 走 stripe.confirmPayment，
//   卡不需要 3DS 时原地成功（redirect:'if_required'），需要时由 Stripe 跳转 return_url。
// - renderStripePaymentBox(): 一个即拉即用的收款盒子（拉 intentUrl → 挂载 → 按钮付款），
//   给订单详情页 / 余额充值页直接嵌。

export function stripeJsTag(): string {
  return '<script src="https://js.stripe.com/endive/stripe.js"></script>'
}

export function stripePaymentHelperScript(): string {
  return `<script>
(function(){
  if (window.__mountStripePayment && window.__mountStripeSetup) return;
  var APPEARANCE = { theme: 'stripe', variables: { colorPrimary: '#2563eb', fontfamily: 'inherit', borderRadius: '10px' } };
  window.__mountStripePayment = function(container, opts){
    var node = typeof container === 'string' ? document.querySelector(container) : container;
    if (!node) throw new Error('缺少 Payment Element 容器');
    if (!window.Stripe) throw new Error('Stripe.js 未能加载');
    if (!opts || !opts.clientSecret || !opts.publishableKey) throw new Error('缺少支付凭据');
    if (opts.clientSecret.indexOf('cs_') === 0) {
      if (opts.deferred) opts.deferred.paymentElement.destroy();
      var checkoutStripe = window.Stripe(opts.publishableKey);
      var checkout = checkoutStripe.initCheckoutElementsSdk({ clientSecret: opts.clientSecret, elementsOptions: { appearance: APPEARANCE }, adaptivePricing: { allowed: false } });
      var billingNode = document.createElement('div');
      var paymentNode = document.createElement('div');
      billingNode.style.marginBottom = '16px';
      node.appendChild(billingNode);
      node.appendChild(paymentNode);
      var billingElement = checkout.createBillingAddressElement();
      var checkoutPaymentElement = checkout.createPaymentElement({ layout: 'tabs' });
      var checkoutActions = checkout.loadActions().then(function(result){
        if (result.type === 'error') throw new Error(result.error.message);
        return result.actions;
      });
      var checkoutReady = new Promise(function(resolve, reject){
        checkoutPaymentElement.on('ready', resolve);
        checkoutPaymentElement.on('loaderror', function(event){ reject(new Error(event.error.message)); });
      });
      billingElement.mount(billingNode);
      checkoutPaymentElement.mount(paymentNode);
      return {
        ready: Promise.all([checkoutActions, checkoutReady]),
        destroy: function(){ billingElement.destroy(); checkoutPaymentElement.destroy(); },
        confirm: function(){
          return checkoutActions.then(function(actions){
            return actions.confirm({ returnUrl: new URL(opts.returnUrl, window.location.href).href, redirect: 'if_required' });
          }).then(function(result){
            if (result.type === 'error') return { ok: false, error: result.error.message };
            return { ok: true, status: 'processing' };
          }).catch(function(err){ return { ok: false, error: (err && err.message) || '支付请求失败，请稍后重试。' }; });
        }
      };
    }
    var stripe = opts.deferred ? opts.deferred.stripe : window.Stripe(opts.publishableKey);
    var elements = opts.deferred ? opts.deferred.elements : stripe.elements({ clientSecret: opts.clientSecret, appearance: APPEARANCE });
    var paymentElement = opts.deferred ? opts.deferred.paymentElement : elements.create('payment', { layout: 'tabs' });
    if (opts.deferred) paymentElement.unmount();
    var ready = new Promise(function(resolve){ paymentElement.on('ready', resolve); });
    paymentElement.mount(node);
    return {
      ready: ready,
      elements: elements,
      destroy: function(){ paymentElement.destroy(); },
      confirm: function(){
        var absoluteReturnUrl = opts.returnUrl ? new URL(opts.returnUrl, window.location.href).href : '';
        return stripe.confirmPayment({
          elements: elements,
          ...(opts.deferred ? { clientSecret: opts.clientSecret } : {}),
          confirmParams: absoluteReturnUrl ? { return_url: absoluteReturnUrl } : {},
          redirect: 'if_required'
        }).then(function(res){
          if (res.error) return { ok: false, error: res.error.message || '支付未完成，请检查卡信息后重试。' };
          var pi = res.paymentIntent || {};
          if (pi.status === 'succeeded' || pi.status === 'processing' || pi.status === 'requires_capture') return { ok: true, status: pi.status };
          return { ok: false, error: '支付未完成（' + (pi.status || '未知状态') + '）。' };
        }).catch(function(err){ return { ok: false, error: (err && err.message) || '支付请求失败，请稍后重试。' }; });
      }
    };
  };
  window.__mountStripeSetup = function(container, opts){
    var node = typeof container === 'string' ? document.querySelector(container) : container;
    if (!node) throw new Error('缺少 Setup Element 容器');
    if (!window.Stripe) throw new Error('Stripe.js 未能加载');
    if (!opts || !opts.clientSecret || !opts.publishableKey) throw new Error('缺少卡片验证凭据');
    var stripe = opts.deferred ? opts.deferred.stripe : window.Stripe(opts.publishableKey);
    var elements = opts.deferred ? opts.deferred.elements : stripe.elements({ clientSecret: opts.clientSecret, appearance: APPEARANCE });
    var paymentElement = opts.deferred ? opts.deferred.paymentElement : elements.create('payment', { layout: 'tabs' });
    if (opts.deferred) paymentElement.unmount();
    var ready = new Promise(function(resolve){ paymentElement.on('ready', resolve); });
    paymentElement.mount(node);
    return {
      ready: ready,
      confirm: function(){
        var absoluteReturnUrl = opts.returnUrl ? new URL(opts.returnUrl, window.location.href).href : '';
        return stripe.confirmSetup({
          elements: elements,
          ...(opts.deferred ? { clientSecret: opts.clientSecret } : {}),
          confirmParams: absoluteReturnUrl ? { return_url: absoluteReturnUrl } : {},
          redirect: 'if_required'
        }).then(function(res){
          if (res.error) return { ok: false, error: res.error.message || '卡片验证未完成，请检查卡信息后重试。' };
          var si = res.setupIntent || {};
          if (si.status === 'succeeded') return { ok: true, setupIntentId: si.id };
          return { ok: false, error: '卡片验证未完成（' + (si.status || '未知状态') + '）。' };
        }).catch(function(err){ return { ok: false, error: (err && err.message) || '卡片验证请求失败，请稍后重试。' }; });
      }
    };
  };
})();
</script>`
}

// 独立收款盒子：拉 intentUrl（POST，返回 { clientSecret, publishableKey } 或 { alreadyPaid:true }），
// 挂载 Payment Element，点按钮 confirm，成功后跳 returnUrl。
export function renderStripePaymentBox(opts: {
  intentUrl: string
  returnUrl: string
  buttonLabel: string
  domId?: string
}): string {
  const id = opts.domId || 'stripe-pay'
  const j = (value: string) => JSON.stringify(value)
  return `
    <div class="stripe-pay-box" id="${id}">
      <div data-role="element" style="margin:12px 0;min-height:44px"></div>
      <p data-role="error" class="form-text" role="alert" style="color:#b42318;display:none;margin:8px 0"></p>
      <button type="button" class="button button-primary" data-role="submit" disabled>${opts.buttonLabel}</button>
    </div>
    ${stripeJsTag()}
    ${stripePaymentHelperScript()}
    <script>
      (function(){
        var root = document.getElementById(${j(id)});
        if (!root) return;
        var elementNode = root.querySelector('[data-role="element"]');
        var errorNode = root.querySelector('[data-role="error"]');
        var submitBtn = root.querySelector('[data-role="submit"]');
        var idleLabel = submitBtn.textContent;
        var handle = null;
        var showError = function(msg){ errorNode.textContent = msg || ''; errorNode.style.display = msg ? 'block' : 'none'; };
        var boot = function(){
          fetch(${j(opts.intentUrl)}, { method: 'POST', credentials: 'same-origin', headers: { Accept: 'application/json' } })
            .then(function(r){ return r.json().then(function(d){ return { ok: r.ok, d: d }; }); })
            .then(function(res){
              if (res.d && res.d.alreadyPaid) { window.location.href = ${j(opts.returnUrl)}; return; }
              if (!res.ok || !res.d || res.d.error) { showError((res.d && res.d.error) || '无法加载支付，请刷新重试。'); return; }
              handle = window.__mountStripePayment(elementNode, {
                clientSecret: res.d.clientSecret,
                publishableKey: res.d.publishableKey,
                returnUrl: ${j(opts.returnUrl)}
              });
              handle.ready.then(function(){ submitBtn.disabled = false; }).catch(function(error){ showError(error.message); });
            })
            .catch(function(){ showError('无法加载支付，请检查网络后刷新重试。'); });
        };
        submitBtn.addEventListener('click', function(){
          if (!handle) return;
          showError('');
          submitBtn.disabled = true;
          submitBtn.textContent = '处理中…';
          handle.confirm().then(function(out){
            if (out.ok) { window.location.href = ${j(opts.returnUrl)}; return; }
            showError(out.error);
            submitBtn.disabled = false;
            submitBtn.textContent = idleLabel;
          });
        });
        window.addEventListener('square-payment-updated', function(){
          if (handle) {
            if (handle.destroy) handle.destroy();
            elementNode.innerHTML = '';
            handle = null;
            submitBtn.disabled = true;
            submitBtn.textContent = idleLabel;
            boot();
          }
        });
        boot();
      })();
    </script>
  `
}
