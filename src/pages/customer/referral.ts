/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

import { buildLayout, getUserById, formatCurrency, formatMelbourneDate } from '../../site';
import { Context } from 'hono';
import { getSystemSettings } from '../../settings/systemSettings';
import { renderReferralProgramLanding } from '../partials/programLanding';
import { escapeHtml } from '../../lib/html';
import { calculateReferralTier, normalizeReferralSettings } from '../../domain/referral';
import { getEffectiveReferralCount } from '../../services/referral';

function desensitizeName(name: string): string {
  const n = name || ''
  if (n.length <= 1) return n
  return `${n[0]}${'*'.repeat(Math.min(2, n.length - 1))}`
}

export async function renderCustomerReferral(c: Context, user: any, message?: string, type?: 'success' | 'error' | 'info') {
  // 使用统一归一化读取，确保 snake_case 数据库字段能被页面正确识别。
  const currentUser = await getUserById(c, user.id);

  if (!currentUser) {
    return buildLayout('我的推荐 - 电脑租赁管理系统', '<div class="panel"><h2>用户未找到</h2><p>无法加载推荐信息。</p></div>', user);
  }

  const referralSettings=normalizeReferralSettings(getSystemSettings().referralSettings)
  const tier = calculateReferralTier(await getEffectiveReferralCount(c, user.id), referralSettings)
  if (!currentUser.referralCode || c.req?.query?.('intro')==='1') {
    const notice=message?`<div data-flash-notice class="page-notification page-notification--${type || 'info'}">${escapeHtml(message)}</div>`:''
    return buildLayout('推荐计划 - 电脑租赁管理系统',notice+renderReferralProgramLanding(tier,referralSettings,Boolean(currentUser.referralCode)),user)
  }

  // referral_rewards 是唯一的推荐奖励账本（customer_id = 推荐人）。
  const rewardRows = await c.env.RENT.prepare(`
    SELECT reward_amount AS amount, status, withdrawn_at
    FROM referral_rewards WHERE customer_id = ?
  `).bind(user.id).all();

  type RewardRow = { amount: number; status: string; withdrawn_at: string | null }
  const records = (rewardRows.results || []) as RewardRow[]
  const commissionBalance = Number(currentUser.commissionBalance || 0)

  const active = records.filter((r) => !['CANCELLED', 'REVERSED'].includes(r.status))
  const totalReward = active.reduce((sum, r) => sum + (r.amount || 0), 0)
  const pendingReward = active
    .filter((r) => r.status === 'PENDING' || r.status === 'PENDING_REVIEW' || r.status === 'APPROVED')
    .reduce((sum, r) => sum + (r.amount || 0), 0)
  const withdrawnReward = active
    .filter((r) => r.withdrawn_at)
    .reduce((sum, r) => sum + (r.amount || 0), 0)

  // 已推荐好友列表：好友贡献的奖励从 referral_rewards 经 referrals 关联被推荐人。
  const referredUsers = await c.env.RENT.prepare(`
    SELECT
      u.name,
      u.created_at AS registeredAt,
      COUNT(DISTINCT o.id) AS orderCount,
      COALESCE(SUM(rw.reward_amount), 0) AS contributedReward
    FROM users u
    LEFT JOIN orders o ON o.userId = u.id
    LEFT JOIN referrals r ON r.referee_customer_id = u.id
    LEFT JOIN referral_rewards rw ON rw.referral_id = r.id AND rw.status NOT IN ('CANCELLED', 'REVERSED')
    WHERE u.referrer_id = ?
    GROUP BY u.id
  `).bind(user.id).all();
  const referralLink = currentUser.referralCode ? new URL(`/register?ref=${encodeURIComponent(currentUser.referralCode)}`, c.req?.url || 'https://example.com/').toString() : ''
  const referralShareText = referralLink ? `邀请你使用 PC Rental 租赁电脑，注册时可通过我的推荐链接加入：\n${referralLink}` : ''

  const body = `
    <div class="panel">
      <div class="section-title"><h2>推荐计划</h2><a class="button button-secondary" href="/customer/referral?intro=1">了解推荐计划</a></div>
      ${message ? `<div data-flash-notice class="page-notification page-notification--${type || 'info'}">${message}</div>` : ''}

        <div style="margin-bottom: 30px;">
          <div class="form-group">
            <label class="form-label">我的推荐码</label>
            <div class="input-group">
              <input type="text" class="form-control" value="${currentUser.referralCode}" readonly id="referrerCodeInput" />
              <button class="button button-secondary" onclick="copyReferrerCode()">复制</button>
            </div>
            <label class="form-label" for="referralLinkInput">我的推荐链接</label>
            <div class="input-group"><input type="text" class="form-control" value="${referralLink}" readonly id="referralLinkInput" /><button class="button button-secondary" onclick="copyReferralLink()">复制分享内容</button></div>
            <textarea class="form-control referral-share-text" id="referralShareText" readonly rows="3" aria-label="推荐分享内容">${referralShareText}</textarea>
          </div>
          
          <form method="POST" action="/customer/referral/leave" data-site-confirm="退出后推荐码将失效，无法再获得佣金。" data-confirm-variant="danger" data-confirm-title="退出推荐计划？" data-confirm-label="退出推荐计划" style="margin-top: 16px;">
            <button type="submit" class="button button-danger">退出推荐计划</button>
          </form>
        </div>



      ${currentUser.referralCode ? `
      <div class="grid grid-3">
        <div class="card text-center"><h3>当前推荐等级</h3><p class="text-large">${tier.level}</p></div>
        <div class="card text-center"><h3>当前租金分成比例</h3><p class="text-large">${tier.rate}%</p></div>
        <div class="card text-center"><h3>有效推荐人数</h3><p class="text-large">${tier.effectiveReferrals}</p>${tier.referralsToNextLevel ? `<p class="form-text">距下一级还需 <strong>${tier.referralsToNextLevel}</strong> 人</p>` : '<p class="form-text">已达最高等级</p>'}</div>
      </div>

      <div class="grid grid-3" style="margin-top: 30px;">
        <div class="card text-center">
          <h3>累计奖励</h3>
          <p class="text-large">${formatCurrency(totalReward)}</p>
        </div>
        <div class="card text-center">
          <h3>待结算奖励</h3>
          <p class="text-large">${formatCurrency(pendingReward)}</p>
        </div>
        <div class="card text-center">
          <h3>已提现</h3>
          <p class="text-large">${formatCurrency(withdrawnReward)}</p>
        </div>
      </div>

      <div style="margin-top: 30px;" aria-label="佣金提现">
        <h3>奖励提现</h3>
        <form method="POST" action="/customer/referral/withdraw" id="withdrawForm" data-site-confirm="提交后按所选方式提现；银行转账需 1-2 个工作日。" data-confirm-variant="danger" data-confirm-title="确认申请提现？" data-confirm-label="申请提现">
          <div class="form-group">
            <label class="form-label" for="withdrawAmount">提现金额</label>
            <input type="number" id="withdrawAmount" name="amount" class="form-control" min="0.01" max="${commissionBalance}" step="0.01" required />
            <p class="form-text">当前可提现余额: ${formatCurrency(commissionBalance)}</p>
          </div>
          
          <div class="form-group">
            <label class="form-label">提现方式</label>
            <div style="display: flex; flex-direction: column; gap: 12px; margin-top: 8px;">
              <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; padding: 12px; border: 1px solid var(--border); border-radius: 8px;">
                <input type="radio" name="withdrawMethod" value="balance" checked onchange="toggleBankDetails()" />
                <div>
                  <strong>划入账户余额</strong>
                  <p style="margin: 4px 0 0 0; color: var(--text-secondary); font-size: 14px;">无最低金额限制，即时到账</p>
                </div>
              </label>
              <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; padding: 12px; border: 1px solid var(--border); border-radius: 8px;">
                <input type="radio" name="withdrawMethod" value="bank_transfer" onchange="toggleBankDetails()" ${commissionBalance >= 100 ? '' : 'disabled'} />
                <div>
                  <strong>银行转账</strong>
                  <p style="margin: 4px 0 0 0; color: var(--text-secondary); font-size: 14px;">最低提现金额100澳元，1-2个工作日到账</p>
                </div>
              </label>
            </div>
          </div>
          
          <div id="bankDetailsSection" style="display: none;">
            <div class="form-group">
              <label class="form-label" for="accountName">银行账户名称</label>
              <input type="text" id="accountName" name="account_name" class="form-control" value="${currentUser.name || ''}" />
            </div>
            <div class="form-group">
              <label class="form-label" for="bsb">BSB (银行代码)</label>
              <input type="text" id="bsb" name="bsb" class="form-control" value="${currentUser.bsb || ''}" />
            </div>
            <div class="form-group">
              <label class="form-label" for="accountNumber">Account Number (银行账号)</label>
              <input type="text" id="accountNumber" name="account_number" class="form-control" value="${currentUser.account_number || ''}" />
            </div>
          </div>
          
          <button type="submit" class="button button-primary" ${commissionBalance <= 0 ? 'disabled' : ''}>申请提现</button>
        </form>
        <script>
          function toggleBankDetails() {
            const method = document.querySelector('input[name="withdrawMethod"]:checked').value;
            const bankSection = document.getElementById('bankDetailsSection');
            const amountInput = document.getElementById('withdrawAmount');
            const bankInputs = bankSection.querySelectorAll('input');
            
            if (method === 'bank_transfer') {
              bankSection.style.display = 'block';
              amountInput.min = 100;
              amountInput.step = 1;
              amountInput.setAttribute('placeholder', '请输入整数金额');
              bankInputs.forEach(input => input.required = true);
            } else {
              bankSection.style.display = 'none';
              amountInput.min = 0.01;
              amountInput.step = 0.01;
              amountInput.removeAttribute('placeholder');
              bankInputs.forEach(input => input.required = false);
            }
          }

          function validateWithdrawAmount() {
            const method = document.querySelector('input[name="withdrawMethod"]:checked').value;
            const amountInput = document.getElementById('withdrawAmount');
            const amount = Number(amountInput.value);
            const isInteger = Number.isInteger(amount);

            if (method === 'bank_transfer') {
              if (!isInteger || amount < 100) {
                amountInput.setCustomValidity('银行转账提现金额必须为大于 100 的整数');
                return false;
              }
            } else if (!Number.isFinite(amount) || amount <= 0) {
              amountInput.setCustomValidity('余额提现金额必须大于 0');
              return false;
            }

            amountInput.setCustomValidity('');
            return true;
          }

          document.getElementById('withdrawForm').addEventListener('submit', function (event) {
            if (!validateWithdrawAmount()) {
              event.preventDefault();
            }
          });

          document.getElementById('withdrawAmount').addEventListener('input', validateWithdrawAmount);
          document.querySelectorAll('input[name="withdrawMethod"]').forEach((input) => {
            input.addEventListener('change', toggleBankDetails);
          });

          window.addEventListener('load', function () {
            toggleBankDetails();
            validateWithdrawAmount();
          });
        </script>
      </div>

      <div style="margin-top: 30px;">
        <h3>已推荐好友列表</h3>
        ${referredUsers.results && referredUsers.results.length > 0 ? `
          <table class="table">
            <thead>
              <tr>
                <th>好友名称</th>
                <th>注册日期</th>
                <th>订单数量</th>
                <th>推荐奖励</th>
              </tr>
            </thead>
            <tbody>
              ${referredUsers.results.map((referredUser: any) => `
                <tr>
                  <td>${desensitizeName(referredUser.name)}</td>
                  <td>${formatMelbourneDate(referredUser.registeredAt)}</td>
                  <td>${referredUser.orderCount}</td>
                  <td>${formatCurrency(referredUser.contributedReward || 0)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        ` : '<p>您还没有成功推荐任何好友。</p>'}
      </div>
    ` : ''}
    </div>
    <script>
      function copyReferrerCode() {
        const referrerCodeInput = document.getElementById('referrerCodeInput');
        referrerCodeInput.select();
        document.execCommand('copy');
        if (window.siteToast) window.siteToast('推荐码已复制到剪贴板！', 'success'); else alert('推荐码已复制到剪贴板！');
      }
      function copyReferralLink() {
        const input = document.getElementById('referralShareText');
        input.select();
        document.execCommand('copy');
        if (window.siteToast) window.siteToast('推荐语和完整链接已复制到剪贴板！', 'success'); else alert('推荐语和完整链接已复制到剪贴板！');
      }
    </script>
  `;

  return buildLayout('我的推荐 - 电脑租赁管理系统', body, user);
}
