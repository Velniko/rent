/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

import { buildLayout, getSystemSettings } from '../../site';

export function renderAdminSettings(user: any) {
  const settings = getSystemSettings(); // 获取当前系统设置
  const feedbackRewards = settings.feedbackRewards || { enabled: false, rewardType: 'BALANCE', balanceAmount: 5, balanceAmountMin: 5, balanceAmountMax: 5, couponDiscountType: 'fixed', couponDiscountValue: 5, couponDiscountValueMin: 5, couponDiscountValueMax: 5, couponMinimumOrderAmount: 0, couponExpiresDays: 30 };
  const escAttr = (value: unknown) => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
  const body = `
    <div class="panel"><div class="section-title"><h3>客户端功能</h3><a class="button button-secondary" href="/admin/settings/client-features">管理客户端功能</a></div></div><div class="panel">
      <div class="section-title"><h2>系统设置</h2><span class="section-note">配置邮件、公司资料、支付方式和推荐分成。</span></div>

      <form id="systemSettingsForm" class="asset-editor" novalidate>
        <section class="form-section">
          <div class="form-section-title"><span class="mono">COMPANY</span><div><h3>公司资料</h3><p>用于网站、合同和通知中的公司信息。<a href="/admin/email-templates">完整邮件变量索引</a>。</p></div></div>
          <div class="grid grid-2">
            <div><label class="form-label" for="companyName">公司名称</label><input id="companyName" name="companyName" class="form-control" value="${settings.companyDetails.name}"></div>
            <div><label class="form-label" for="companyAbn">公司 ABN</label><input id="companyAbn" name="companyAbn" class="form-control" value="${settings.companyDetails.abn}" placeholder="11 位 ABN"></div>
            <div><label class="form-label" for="gstIncluded">GST 设置</label><select id="gstIncluded" name="gstIncluded" class="form-control"><option value="true" ${settings.companyDetails.gstIncluded ? 'selected' : ''}>价格包含 GST</option><option value="false" ${!settings.companyDetails.gstIncluded ? 'selected' : ''}>价格不含 GST</option></select></div>
            <div><label class="form-label" for="companyAddress">公司地址</label><input id="companyAddress" name="companyAddress" class="form-control" value="${settings.companyDetails.address}"></div>
            <div><label class="form-label" for="companyContact">公司联系人</label><input id="companyContact" name="companyContact" class="form-control" value="${settings.companyDetails.contact}"></div>
            <div><label class="form-label" for="companyPhone">公司电话</label><input id="companyPhone" name="companyPhone" class="form-control" value="${settings.companyDetails.phone}"></div>
            <div><label class="form-label" for="companyEmail">公司邮箱</label><input type="email" id="companyEmail" name="companyEmail" class="form-control" value="${settings.companyDetails.email}"></div>
            <div><label class="form-label" for="companyWebsite">公司网站</label><input type="url" id="companyWebsite" name="companyWebsite" class="form-control" value="${settings.companyDetails.website}" placeholder="https://"></div>
            <div><label class="form-label" for="companyLogo">公司 Logo URL</label><input type="url" id="companyLogo" name="companyLogo" class="form-control" value="${settings.companyDetails.logo}" placeholder="https://"></div>
            <div class="form-group"><label class="form-label" for="loginImageFile">登录页左侧配图</label><input class="form-control" id="loginImageFile" type="file" accept="image/jpeg,image/png,image/webp"><label class="form-label" for="loginImage">配图 URL（上传后自动回填）</label><input class="form-control" id="loginImage" name="loginImage" type="url" value="${escAttr(settings.companyDetails.loginImage || '')}" placeholder="https://.../login.jpg"><small class="form-text">建议 4:3 或 3:4 竖图；留空则显示公司信息文案。</small></div>
            <div class="form-group"><label class="form-label" for="companyWechatUrl">微信主页链接</label><input class="form-control" type="url" id="companyWechatUrl" name="companyWechatUrl" value="${escAttr(settings.companyDetails.wechatUrl || '')}" placeholder="https://"></div>
            <div class="form-group"><label class="form-label" for="companyWechatQrUrl">微信二维码 URL</label><input class="form-control" type="url" id="companyWechatQrUrl" name="companyWechatQrUrl" value="${escAttr(settings.companyDetails.wechatQrUrl || '')}" placeholder="https://"></div>
            <div class="form-group"><label class="form-label" for="companyXiaohongshuUrl">小红书主页链接</label><input class="form-control" type="url" id="companyXiaohongshuUrl" name="companyXiaohongshuUrl" value="${escAttr(settings.companyDetails.xiaohongshuUrl || '')}" placeholder="https://"></div>
            <div class="form-group"><label class="form-label" for="companyXiaohongshuQrUrl">小红书二维码 URL</label><input class="form-control" type="url" id="companyXiaohongshuQrUrl" name="companyXiaohongshuQrUrl" value="${escAttr(settings.companyDetails.xiaohongshuQrUrl || '')}" placeholder="https://"></div>
            <div class="form-group"><label class="form-label" for="companyDouyinUrl">抖音主页链接</label><input class="form-control" type="url" id="companyDouyinUrl" name="companyDouyinUrl" value="${escAttr(settings.companyDetails.douyinUrl || '')}" placeholder="https://"></div>
            <div class="form-group"><label class="form-label" for="companyDouyinQrUrl">抖音二维码 URL</label><input class="form-control" type="url" id="companyDouyinQrUrl" name="companyDouyinQrUrl" value="${escAttr(settings.companyDetails.douyinQrUrl || '')}" placeholder="https://"></div>
            <div class="form-group"><label class="form-label" for="pickupLocations">自取/归还地点</label><textarea id="pickupLocations" name="pickupLocations" class="form-control" rows="4" placeholder="每行一个地点">${settings.companyDetails.pickupLocations.join('\n')}</textarea><small class="form-text">员工新建合同时只能从这些地点中选择；管理员仍可临时编辑。</small></div>
              <div class="form-group"><label class="form-label" for="deliveryAreas">配送区域</label><textarea id="deliveryAreas" name="deliveryAreas" class="form-control" rows="4" placeholder="每行一个区域">${(settings.companyDetails.deliveryAreas || []).join('\n')}</textarea><small class="form-text">官网会显示这些区域；每行一个 suburb 或区域名称。</small></div>
              <div class="form-group"><label class="form-label" for="deliveryNote">配送说明</label><input id="deliveryNote" name="deliveryNote" class="form-control" value="${settings.companyDetails.deliveryNote || ''}" placeholder="例如：配送范围和运费以审核确认为准"><small class="form-text">官网申请页、租赁指南和设备详情会读取这段说明。</small></div>
          </div>

        </section>

        <section class="form-section">
          <div class="form-section-title"><span class="mono">AUTH</span><div><h3>注册安全设置</h3><p>关闭时仍可发送验证邮件，但注册后不会阻止用户直接进入系统。</p></div></div>
          <div class="checkbox-group"><input type="checkbox" id="requireEmailVerification" ${settings.registrationSettings?.requireEmailVerification ? 'checked' : ''}><label for="requireEmailVerification">强制新注册用户验证邮箱</label></div>
        </section>

        <section class="form-section">
          <div class="form-section-title"><span class="mono">TALLY</span><div><h3>Tally 客户反馈与奖励</h3><p>请在 Tally 的 Share → Embed 中复制 <code>https://tally.so/embed/...</code> 地址。反馈表单必须添加名为 <code>feedbackToken</code> 的 Hidden field，并在 Tally 后台的 Webhook 设置中把地址指向 <code>/webhooks/tally</code>。Webhook 密钥由 Cloudflare Worker 环境变量 <code>TALLY_WEBHOOK_SECRET</code> 管理。</p></div></div>
          <div class="form-group"><label class="form-label" for="tallyFormUrl">Tally Embed URL</label><input class="form-control" type="url" id="tallyFormUrl" name="tallyFormUrl" value="${escAttr(settings.tallyFormUrl)}" placeholder="https://tally.so/embed/xxxxxxxx"><small class="form-text">保存后访问 <a href="/feedback" target="_blank" rel="noopener">/feedback</a> 预览（需已登录正式客户账号）。</small></div>
          <div class="checkbox-group"><input type="checkbox" id="feedbackRewardEnabled" ${feedbackRewards.enabled ? 'checked' : ''}><label for="feedbackRewardEnabled">提交反馈后自动发放奖励</label></div>
          <div class="grid grid-2">
            <div class="form-group"><label class="form-label" for="feedbackRewardType">奖励类型</label><select class="form-control" id="feedbackRewardType"><option value="BALANCE" ${feedbackRewards.rewardType === 'BALANCE' ? 'selected' : ''}>账户余额</option><option value="COUPON" ${feedbackRewards.rewardType === 'COUPON' ? 'selected' : ''}>一次性优惠码</option><option value="GIFT_CARD" ${feedbackRewards.rewardType === 'GIFT_CARD' ? 'selected' : ''}>外部礼品卡兑换码</option></select></div>
            <div class="form-group"><label class="form-label" for="feedbackBalanceAmountMin">余额奖励范围（AUD）</label><div class="grid grid-2"><input class="form-control" id="feedbackBalanceAmountMin" type="number" min="0.01" max="10000" step="0.01" value="${feedbackRewards.balanceAmountMin ?? feedbackRewards.balanceAmount}" placeholder="最低金额"><input class="form-control" id="feedbackBalanceAmountMax" type="number" min="0.01" max="10000" step="0.01" value="${feedbackRewards.balanceAmountMax ?? feedbackRewards.balanceAmount}" placeholder="最高金额"></div></div>
            <div class="form-group"><label class="form-label" for="feedbackCouponDiscountType">优惠码类型</label><select class="form-control" id="feedbackCouponDiscountType"><option value="fixed" ${feedbackRewards.couponDiscountType === 'fixed' ? 'selected' : ''}>固定金额</option><option value="percent" ${feedbackRewards.couponDiscountType === 'percent' ? 'selected' : ''}>百分比</option></select></div>
            <div class="form-group"><label class="form-label" for="feedbackCouponDiscountValueMin">优惠值范围</label><div class="grid grid-2"><input class="form-control" id="feedbackCouponDiscountValueMin" type="number" min="0.01" max="10000" step="0.01" value="${feedbackRewards.couponDiscountValueMin ?? feedbackRewards.couponDiscountValue}" placeholder="最低优惠"><input class="form-control" id="feedbackCouponDiscountValueMax" type="number" min="0.01" max="10000" step="0.01" value="${feedbackRewards.couponDiscountValueMax ?? feedbackRewards.couponDiscountValue}" placeholder="最高优惠"></div></div>
            <div class="form-group"><label class="form-label" for="feedbackCouponMinimumOrderAmount">最低使用金额（AUD）</label><input class="form-control" id="feedbackCouponMinimumOrderAmount" type="number" min="0" max="1000000" step="0.01" value="${feedbackRewards.couponMinimumOrderAmount || 0}"><small class="form-text">填 0 表示不限制最低订单金额。</small></div>
            <div class="form-group"><label class="form-label" for="feedbackCouponExpiresDays">优惠码有效期（天）</label><input class="form-control" id="feedbackCouponExpiresDays" type="number" min="1" max="365" step="1" value="${feedbackRewards.couponExpiresDays}"></div>
          </div>
          <p class="form-text">礼品卡奖励不会调用 Square 发卡 API；请先在 <a href="/admin/feedback-gift-cards">礼品卡库存</a> 录入外部兑换码，系统按先进先出发放。发放记录（含失败原因和重试）请查看 <a href="/admin/feedback-rewards">反馈奖励记录</a>。</p>
        </section>

        <section class="form-section">
          <div class="form-section-title"><span class="mono">PAY</span><div><h3>支付方式配置</h3><p>启用或停用支付渠道。</p></div></div>
          <div class="form-group">
            <label class="form-label" for="squareProcessingFeeRate">Square 礼品卡手续费比例（%）</label>
            <input class="form-control" id="squareProcessingFeeRate" name="squareProcessingFeeRate" type="number" min="0" max="100" step="0.01" value="${(Number(settings.paymentMethods.squareProcessingFeeRate ?? 0.022) * 100).toFixed(2)}">
            <small class="form-text">Square 礼品卡手续费按租金及服务费（不含押金）计算；审核通过后实际提交 Square 时按此比例收取。</small>
          </div>
          <div class="checkbox-group"><input type="checkbox" id="enableStripe" name="enableStripe" ${settings.paymentMethods.stripe ? 'checked' : ''}><label for="enableStripe">启用 Stripe 信用卡支付</label></div>
          <div class="checkbox-group"><input type="checkbox" id="enableSquare" name="enableSquare" ${settings.paymentMethods.square ? 'checked' : ''}><label for="enableSquare">启用 Square 礼品卡支付</label></div>
          <div class="checkbox-group"><input type="checkbox" id="enableBankTransfer" name="enableBankTransfer" ${settings.paymentMethods.bankTransfer ? 'checked' : ''}><label for="enableBankTransfer">启用银行转账</label></div>
          <div class="checkbox-group"><input type="checkbox" id="enableBalancePayment" name="enableBalancePayment" ${settings.paymentMethods.balancePayment ? 'checked' : ''}><label for="enableBalancePayment">启用余额支付</label></div>
          <div class="checkbox-group"><input type="checkbox" id="enableAlipay" name="enableAlipay" ${settings.paymentMethods.alipay ? 'checked' : ''}><label for="enableAlipay">启用支付宝人民币付款</label></div>
          <div class="checkbox-group"><input type="checkbox" id="enableWechat" name="enableWechat" ${settings.paymentMethods.wechat ? 'checked' : ''}><label for="enableWechat">启用微信支付人民币付款</label></div>
        </section>

        <section class="form-section">
          <div class="form-section-title"><span class="mono">BANK</span><div><h3>银行转账账户信息</h3><p>客户选择银行转账时会看到这些账户信息，供其转账使用。</p></div></div>
          <div class="grid grid-2">
            <div class="form-group"><label for="bankName" class="form-label">银行名称</label><input type="text" id="bankName" name="bankName" class="form-control" value="${settings.bankDetails.bankName}" placeholder="例如: Commonwealth Bank"></div>
            <div class="form-group"><label for="bankAccountName" class="form-label">账户名称</label><input type="text" id="bankAccountName" name="bankAccountName" class="form-control" value="${settings.bankDetails.accountName}" placeholder="请输入账户名称"></div>
            <div class="form-group"><label for="bankBSB" class="form-label">BSB</label><input type="text" id="bankBSB" name="bankBSB" class="form-control" value="${settings.bankDetails.bsb}" placeholder="例如: 062-001"></div>
            <div class="form-group"><label for="bankAccount" class="form-label">银行账号</label><input type="text" id="bankAccount" name="bankAccount" class="form-control" value="${settings.bankDetails.account}" placeholder="请输入银行账号"></div>
          </div>
        </section>

        <section class="form-section">
          <div class="form-section-title"><span class="mono">RMB</span><div><h3>人民币收款码</h3><p>可直接选择图片上传；也可以继续填写公开 HTTPS 图片地址。客户付款后提交 Reference 和付款截图，管理员审核后订单才会变为已付款。</p></div></div>
          <div class="grid grid-2">
            <div class="form-group"><label class="form-label" for="alipayQrFile">支付宝收款码图片</label><input class="form-control" id="alipayQrFile" type="file" accept="image/jpeg,image/png,image/webp"><label class="form-label" for="alipayQrUrl">支付宝收款码 URL（自动回填）</label><input class="form-control" id="alipayQrUrl" name="alipayQrUrl" type="url" value="${escAttr(settings.rmbPayment.alipayQrUrl)}" placeholder="https://.../alipay-qr.png"><small class="form-text">支持 JPG、PNG、WebP，单张不超过 5MB。</small></div>
            <div class="form-group"><label class="form-label" for="wechatQrFile">微信收款码图片</label><input class="form-control" id="wechatQrFile" type="file" accept="image/jpeg,image/png,image/webp"><label class="form-label" for="wechatQrUrl">微信收款码 URL（自动回填）</label><input class="form-control" id="wechatQrUrl" name="wechatQrUrl" type="url" value="${escAttr(settings.rmbPayment.wechatQrUrl)}" placeholder="https://.../wechat-qr.png"><small class="form-text">支持 JPG、PNG、WebP，单张不超过 5MB。</small></div>
          </div>
        </section>

        <section class="form-section">
          <div class="form-section-title"><span class="mono">REF</span><div><h3>推荐分成规则</h3><p>分成基数：租金</p></div></div>
          <div class="grid grid-3">
            <div class="form-group"><label class="form-label" for="defaultReferralRate">基础分成比例（1级，%）</label><input type="number" id="defaultReferralRate" name="defaultReferralRate" class="form-control" value="${settings.referralSettings.defaultRate}" min="0" max="100" step="0.01" required></div>
            <div class="form-group"><label class="form-label" for="referralLevelLimit">最高推荐等级</label><input type="number" id="referralLevelLimit" name="referralLevelLimit" class="form-control" value="${settings.referralSettings.levelLimit}" min="1" step="1" required></div>
            <div class="form-group"><label class="form-label" for="referralsPerLevel">每级所需有效推荐人数</label><input type="number" id="referralsPerLevel" name="referralsPerLevel" class="form-control" value="${settings.referralSettings.referralsPerLevel}" min="1" step="1" required></div>
            <div class="form-group"><label class="form-label" for="referralRateIncrease">每级累计增加（百分点）</label><input type="number" id="referralRateIncrease" name="referralRateIncrease" class="form-control" value="${settings.referralSettings.rateIncreasePerLevel}" min="0" max="100" step="0.01" required></div>
            <div class="form-group"><label class="form-label" for="referralSettlementPeriod">分成结算周期 (天)</label><input type="number" id="referralSettlementPeriod" name="referralSettlementPeriod" class="form-control" value="${settings.referralSettings.settlementPeriod}" min="1" step="1" required></div>
          </div>
          <small class="form-text">有效推荐：已付款并完成租赁；分成最高 100%。</small>
        </section>

        <div class="form-actions form-actions-right">
          <button type="submit" class="button button-primary">保存设置</button>
        </div>
      </form>
    </div>

    <script>
      (function() {
        const form = document.getElementById('systemSettingsForm');
        if (!form || form.dataset.settingsReady === 'true') return;
        form.dataset.settingsReady = 'true';
        form.addEventListener('submit', async function(event) {
        event.preventDefault();

        const uploadQrImage = async (fileId, kind, urlId) => {
          const fileInput = document.getElementById(fileId);
          const file = fileInput?.files?.[0];
          if (!file) return;
          const uploadData = new FormData();
          uploadData.append('imageFile', file);
          uploadData.append('kind', kind);
          const response = await fetch('/admin/settings/upload-image', { method: 'POST', body: uploadData });
          const rawText = await response.text();
          let data = {};
          try { data = rawText ? JSON.parse(rawText) : {}; } catch { data = { error: rawText || '图片上传失败' }; }
          if (!response.ok || !data.success || !data.url) throw new Error(data.error || '图片上传失败');
          document.getElementById(urlId).value = data.url;
        };
        try {
          await Promise.all([
            uploadQrImage('alipayQrFile', 'alipay', 'alipayQrUrl'),
            uploadQrImage('wechatQrFile', 'wechat', 'wechatQrUrl'),
            uploadQrImage('loginImageFile', 'login', 'loginImage'),
          ]);
        } catch (error) {
          const message = '收款码上传失败: ' + (error instanceof Error ? error.message : '请稍后重试');
          if (window.siteToast) window.siteToast(message, 'error'); else alert(message);
          return;
        }

        const formData = new FormData(this);
        const referralInputs = ['defaultReferralRate', 'referralLevelLimit', 'referralsPerLevel', 'referralRateIncrease', 'referralSettlementPeriod'];
        for (const id of referralInputs) {
          if (!document.getElementById(id).reportValidity()) return;
        }
        const inputValue = (id) => document.getElementById(id)?.value || '';
        const newSettings = {
          paymentMethods: {
            stripe: formData.has('enableStripe'),
            square: formData.has('enableSquare'),
            bankTransfer: formData.has('enableBankTransfer'),
            balancePayment: formData.has('enableBalancePayment'),
            alipay: formData.has('enableAlipay'),
            wechat: formData.has('enableWechat'),
            squareProcessingFeeRate: Number(formData.get('squareProcessingFeeRate') || 0) / 100,
          },
          registrationSettings: {
            requireEmailVerification: document.getElementById('requireEmailVerification').checked,
          },
          tallyFormUrl: inputValue('tallyFormUrl'),
          feedbackRewards: {
            enabled: document.getElementById('feedbackRewardEnabled').checked,
            rewardType: inputValue('feedbackRewardType'),
            balanceAmountMin: Number(inputValue('feedbackBalanceAmountMin') || 0),
            balanceAmountMax: Number(inputValue('feedbackBalanceAmountMax') || 0),
            couponDiscountType: inputValue('feedbackCouponDiscountType'),
            couponDiscountValueMin: Number(inputValue('feedbackCouponDiscountValueMin') || 0),
            couponDiscountValueMax: Number(inputValue('feedbackCouponDiscountValueMax') || 0),
            couponMinimumOrderAmount: Number(inputValue('feedbackCouponMinimumOrderAmount') || 0),
            couponExpiresDays: Number(inputValue('feedbackCouponExpiresDays') || 30),
          },
          bankDetails: {
            bankName: formData.get('bankName'),
            accountName: formData.get('bankAccountName'),
            bsb: formData.get('bankBSB'),
            account: formData.get('bankAccount'),
          },
          rmbPayment: {
            alipayQrUrl: formData.get('alipayQrUrl'),
            wechatQrUrl: formData.get('wechatQrUrl'),
          },
          companyDetails: {
            name: formData.get('companyName'),
            abn: formData.get('companyAbn'),
            gstIncluded: formData.get('gstIncluded') === 'true',
            address: formData.get('companyAddress'),
            contact: formData.get('companyContact'),
            phone: formData.get('companyPhone'),
            email: formData.get('companyEmail'),
            website: formData.get('companyWebsite'),
            logo: formData.get('companyLogo'),
            loginImage: formData.get('loginImage'),
            wechatUrl: formData.get('companyWechatUrl'),
            wechatQrUrl: formData.get('companyWechatQrUrl'),
            xiaohongshuUrl: formData.get('companyXiaohongshuUrl'),
            xiaohongshuQrUrl: formData.get('companyXiaohongshuQrUrl'),
            douyinUrl: formData.get('companyDouyinUrl'),
            douyinQrUrl: formData.get('companyDouyinQrUrl'),
            pickupLocations: String(formData.get('pickupLocations') || '').split(/\\n+/).map(value => value.trim()).filter(Boolean),
                      deliveryAreas: String(formData.get('deliveryAreas') || '').split(/\\n+/).map(value => value.trim()).filter(Boolean),
                      deliveryNote: String(formData.get('deliveryNote') || '').trim(),
          },
          referralSettings: {
            defaultRate: Number(formData.get('defaultReferralRate')),
            levelLimit: Number(formData.get('referralLevelLimit')),
            referralsPerLevel: Number(formData.get('referralsPerLevel')),
            rateIncreasePerLevel: Number(formData.get('referralRateIncrease')),
            settlementPeriod: Number(formData.get('referralSettlementPeriod')),
          },
        };
        
        // 发送到后端API保存
        fetch('/admin/settings/save', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(newSettings)
        })
        .then(async response => {
          const rawText = await response.text();
          let data = {};
          try {
            data = rawText ? JSON.parse(rawText) : {};
          } catch {
            data = { error: rawText || '保存失败' };
          }
          if (!response.ok) throw new Error(data.error || '保存失败');
          return data;
        })
        .then(data => {
          if (data.success) {
            if (window.siteToast) window.siteToast('系统设置已保存成功！', 'success'); else alert('系统设置已保存成功！');
            // Reload from D1 so the form always displays the persisted values,
            // rather than the browser's pre-submit values.
            setTimeout(() => window.location.reload(), 800);
          } else {
            const message = '保存失败: ' + data.error;
            if (window.siteToast) window.siteToast(message, 'error'); else alert(message);
          }
        })
        .catch(error => {
          console.error('Error saving settings:', error);
          const message = '保存失败: ' + (error instanceof Error ? error.message : '请查看控制台获取详情。');
          if (window.siteToast) window.siteToast(message, 'error'); else alert(message);
        });
        });
      })();
    </script>
  `;

  return buildLayout('系统设置 - 电脑租赁管理系统', body, user);
}
