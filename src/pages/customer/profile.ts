/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

import { clientPathEnabled, normalizeClientAccess } from '../../clientAccess'
import { buildLayout, getUserById, formatCurrency } from '../../site';
import { Context } from 'hono';

export async function renderCustomerProfile(c: Context, user: any, message?: string, type: 'success' | 'error' = 'error') {
  const esc = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] || char))
  // 从数据库获取最新的用户信息
  const currentUser = await getUserById(c, user.id);
  const userToUse = currentUser || user;
  const deletionScheduledAt = userToUse.deletionScheduledAt || userToUse.deletion_scheduled_at;
  const marketingOptedOut = Number(userToUse.marketing_email_opt_out ?? userToUse.marketingEmailOptOut) === 1;

  const countryCodes = [
    { code: '+61', name: 'AU' },
    { code: '+86', name: 'CN' },
    { code: '+852', name: 'HK' },
    { code: '+853', name: 'MO' },
    { code: '+886', name: 'TW' }
  ];

  const fullPhone = userToUse.phone ?? '';
  let selectedCountryCode = '';
  let localPhoneNumber = fullPhone;

  // 检查并设置默认区号
  if (!countryCodes.some(country => fullPhone.startsWith(country.code))) {
    // 如果号码不以任何已知区号开头，则默认+61，并将整个号码视为本地号码
    selectedCountryCode = '+61';
    localPhoneNumber = fullPhone;
  } else {
    for (const country of countryCodes) {
      if (fullPhone.startsWith(country.code)) {
        selectedCountryCode = country.code;
        localPhoneNumber = fullPhone.substring(country.code.length);
        break;
      }
    }
  }

  const countryCodeOptions = countryCodes.map(country =>
    `<option value="${country.code}" ${country.code === selectedCountryCode ? 'selected' : ''}>${country.name} (${country.code})</option>`
  ).join('');

  const alertMessage = message ? `<div data-flash-notice class="page-notification page-notification--${type}">${esc(message)}</div>` : ''
  const body = `
    <div class="panel">
      <div class="section-title"><h2>个人信息管理</h2></div>
      ${alertMessage}
      <form method="POST" action="/customer/profile">
        <div class="grid grid-2">
          <div>
            <label class="form-label">姓名</label>
            <input class="form-control" name="name" value="${esc(userToUse.name)}" />
          </div>
          <div>
            <label class="form-label">邮箱</label>
            <input class="form-control" name="email" value="${esc(userToUse.email)}" readonly />
          </div>
        </div>
        <div class="grid grid-2">
          <div>
            <label class="form-label">手机</label>
            <div class="input-group">
              <select name="countryCode" class="form-control" style="flex: 0 0 auto; width: auto; border-right: 0; border-top-right-radius: 0; border-bottom-right-radius: 0;">
                ${countryCodeOptions}
              </select>
              <input class="form-control" name="phone" value="${esc(localPhoneNumber)}" />
            </div>
          </div>
          <div>
            <label class="form-label">BSB</label>
            <input class="form-control" name="bsb" id="bsbInput" value="${esc(userToUse.bsb)}" maxlength="7" inputmode="numeric" pattern="[0-9]{3}-?[0-9]{3}" />
          </div>
        </div>
        <div class="grid grid-2">
          <div>
            <label class="form-label">Account</label>
            <input class="form-control" name="account" value="${esc(userToUse.account)}" />
          </div>
          <div>
            <label class="form-label">推荐人</label>
            <input class="form-control" name="referrerId" value="${esc(userToUse.referrerId)}" ${userToUse.referrerId ? 'readonly' : ''} />
            <p class="form-text" style="font-size: 12px; color: #6b7280; margin-top: 4px;">绑定后禁止修改推荐人</p>
          </div>
        </div>
        <div style="margin-top:20px; display:flex; gap:12px; flex-wrap:wrap; align-items:center;">
          <button class="button" type="submit">保存修改</button>
        </div>
      </form>
      <section class="panel" style="margin-top:24px;">
        <div class="section-title"><h3>营销邮件</h3></div>
        ${marketingOptedOut
      ? `<p class="form-text">当前未订阅营销邮件。</p>${clientPathEnabled(user.clientAccess || normalizeClientAccess(null),'/customer/profile/marketing-subscription','console') ? `<form method="POST" action="/customer/profile/marketing-subscription"><input type="hidden" name="action" value="subscribe"><button class="button button-primary" type="submit">重新订阅营销邮件</button></form>` : ''}`
      : `<p class="form-text">当前已订阅营销邮件。订单、合同和付款通知不受影响。</p>`}
      </section>
      <section class="danger-zone" style="margin-top:32px;">
        <h3>删除账户</h3>
        ${deletionScheduledAt
      ? `<p class="form-text">账户已进入冷静期，将于 <strong>${String(deletionScheduledAt).replace('T', ' ').slice(0, 19)}</strong> 后删除。7 天内重新登录即可取消。</p>`
      : `<p class="form-text">申请后进入 7 天冷静期，期间重新登录可取消。冷静期结束后余额与佣金清零且不退还。</p><form method="POST" action="/customer/profile/delete-account" data-site-confirm="账户：${esc(userToUse.email)}&#10;申请后将立即退出登录，并进入 7 天冷静期；期间重新登录可取消删除。&#10;冷静期结束后账户将永久删除，账户余额 ${esc(formatCurrency(Number(userToUse.balance) || 0))} 与佣金余额 ${esc(formatCurrency(Number(userToUse.commissionBalance ?? userToUse.commission_balance) || 0))} 会清零且不退还，合同、订单和支付记录将匿名保留。" data-confirm-variant="danger" data-confirm-title="申请删除账户？" data-confirm-label="申请删除账户" data-confirm-text="删除账户"><label class="form-check" style="display:flex;gap:8px;align-items:flex-start;margin:16px 0"><input type="checkbox" name="confirmDelete" required><span>我已了解账户进入冷静期，余额及佣金余额不会退还，合同和订单只保留匿名记录。</span></label><button class="button button-danger" type="submit">申请删除账户</button></form>`}
      </section>
    </div>
    <script>
      document.addEventListener('DOMContentLoaded', function() {
        const bsbInput = document.getElementById('bsbInput');
        if (bsbInput) {
          bsbInput.addEventListener('input', function(e) {
            let value = e.target.value.replace(/\D/g, ''); // Remove non-digits
            let formattedValue = '';

            if (value.length > 3) {
              formattedValue = value.substring(0, 3) + '-' + value.substring(3, 6);
            } else {
              formattedValue = value;
            }
            e.target.value = formattedValue;
          });
        }
      });
    </script>
  `
  return buildLayout('个人信息 - 电脑租赁管理系统', body, userToUse)
}
