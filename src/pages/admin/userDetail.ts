/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

import { buildLayout, getAccessLevel, getUserById, splitPersonName, formatMelbourneDateTime, findBlockingRiskFlag } from '../../site';
import { Context } from 'hono';
import { escapeHtml } from '../../lib/html';

export async function renderAdminUserDetail(c: Context, user: any, targetUserId: string) {
  const targetUser = await getUserById(c, targetUserId);

  if (!targetUser) {
    return buildLayout('用户未找到 - 电脑租赁管理系统', '<div class="panel"><h2>用户未找到</h2><p>您请求的用户不存在。</p><a href="/admin/users" class="button">返回用户列表</a></div>', user);
  }

  const roleMap: Record<string, string> = {
    'ADMIN': '管理员',
    'STAFF': '员工',
    'CUSTOMER': '客户'
  };

  const statusMap: Record<string, string> = {
    'active': '正常',
    'banned': '已封禁',
    'inactive': '已停用',
    'departed': '已离职'
  };
  const managementStatus = targetUser.accountStatus ?? targetUser.account_status ?? (targetUser.status === 'active' ? 'active' : 'inactive')
  const accessLevel = getAccessLevel(targetUser)
  const personName = splitPersonName(targetUser.name)
  const [assignedStaff, referrer] = await Promise.all([
    targetUser.staffId ? getUserById(c, targetUser.staffId) : Promise.resolve(null),
    targetUser.referrerId ? getUserById(c, targetUser.referrerId) : Promise.resolve(null),
  ])
  const pendingTopups = targetUser.role === 'CUSTOMER' ? ((await c.env.RENT.prepare("SELECT * FROM balance_topups WHERE user_id = ? AND status = 'submitted' ORDER BY created_at DESC").bind(targetUser.id).all()).results as any[]) : []
  const agreementAcceptance: any = targetUser.role === 'CUSTOMER' ? targetUser : {}
  const activeRiskFlags = targetUser.role === 'CUSTOMER' ? ((await c.env.RENT.prepare("SELECT flag_type, severity, reason FROM risk_flags WHERE customer_id = ? AND status = 'ACTIVE' ORDER BY CASE severity WHEN 'HIGH' THEN 0 WHEN 'MEDIUM' THEN 1 ELSE 2 END, created_at DESC").bind(targetUser.id).all()).results as any[]) : []

  const accountNotice = targetUser.accountType === 'guest' ? `<div class="page-notification page-notification--info"><strong>访客/临时账户</strong> · 关联订单 ${targetUser.guestOrderId || '-'} · 计划删除日期 ${targetUser.guestExpiresAt || '租期结束'}</div>` : targetUser.accountType === 'deleted_guest' ? '<div class="page-notification page-notification--error"><strong>已删除访客账户</strong> · 登录权限和个人联系方式已清除。</div>' : ''
  const blockingRisk = findBlockingRiskFlag(activeRiskFlags.map((flag: any) => ({ ...flag, status: 'ACTIVE' })))
  const riskNotice = activeRiskFlags.length ? `<div class="page-notification page-notification--${blockingRisk ? 'error' : 'warning'}"${blockingRisk ? ' data-notice-priority="critical" role="alert"' : ' role="status"'}><strong>${blockingRisk ? '高风险：该客户已被限制新增租赁' : '客户风险提醒'}（${activeRiskFlags.length}）</strong>${activeRiskFlags.map((flag: any) => `<p>${escapeHtml(flag.flag_type)} · ${escapeHtml(flag.severity)} · ${escapeHtml(flag.reason)}</p>`).join('')}<p><a href="/admin/users/${encodeURIComponent(targetUser.id)}/risk">查看风险详情与处理标记 →</a></p></div>` : ''
  roleMap.MANAGER = '经理'
  const body = `
    ${accountNotice}
    ${riskNotice}
    <div class="entity-header"><div class="identity-strip mono"><span>USER / ${targetUser.id}</span><span>${escapeHtml(targetUser.role)}</span></div><div class="entity-heading"><div><p class="section-code">IDENTITY RECORD</p><h2>${escapeHtml(targetUser.name)}</h2><p>${escapeHtml(targetUser.email)}</p></div><div class="entity-heading-actions"><a href="/admin/users" class="button button-secondary">返回列表</a><a href="/admin/users/${targetUser.id}/edit" class="button">编辑用户</a></div></div></div>
    <div class="panel record-panel single-column"><div class="record-grid">
        <section class="record-section"><p class="section-code">ACCOUNT</p><h3>基本信息</h3><dl class="data-list">
          <div><dt>用户 ID</dt><dd class="mono">${targetUser.id}</dd></div><div><dt>名 / Given name</dt><dd>${escapeHtml(personName.firstName) || '未填写'}</dd></div><div><dt>姓 / Family name</dt><dd>${escapeHtml(personName.lastName) || '未填写'}</dd></div><div><dt>邮箱</dt><dd>${escapeHtml(targetUser.email)}</dd></div><div><dt>电话</dt><dd>${escapeHtml(targetUser.phone) || '未填写'}</dd></div>${targetUser.role === 'CUSTOMER' ? `<div><dt>绑定员工</dt><dd>${assignedStaff ? `${escapeHtml(assignedStaff.name)} · ${escapeHtml(assignedStaff.email)}` : '未分配'}</dd></div><div><dt>推荐人</dt><dd>${referrer ? `${escapeHtml(referrer.name)} · ${escapeHtml(referrer.email)}` : '无'}</dd></div>` : ''}<div><dt>角色</dt><dd><span class="badge ${accessLevel === 'ADMIN' ? 'badge-danger' : accessLevel === 'MANAGER' ? 'badge-primary' : accessLevel === 'STAFF' ? 'badge-warning' : 'badge-info'}">${escapeHtml(roleMap[accessLevel] || accessLevel)}</span></dd></div><div><dt>状态</dt><dd><span class="badge ${managementStatus === 'active' ? 'badge-success' : managementStatus === 'departed' ? 'badge-warning' : 'badge-danger'}">${escapeHtml(statusMap[managementStatus] || managementStatus)}</span></dd></div><div><dt>注册时间（墨尔本）</dt><dd>${targetUser.createdAt ? formatMelbourneDateTime(targetUser.createdAt) : '-'}</dd></div>
        </dl></section>
        <section class="record-section"><p class="section-code">FINANCE</p><h3>账户信息</h3><dl class="data-list"><div><dt>账户余额</dt><dd class="mono">AUD$${(targetUser.balance || 0).toFixed(2)}</dd></div><div><dt>佣金余额</dt><dd class="mono">AUD$${(targetUser.commissionBalance || 0).toFixed(2)}</dd></div>${targetUser.role === 'CUSTOMER' ? `<div><dt>BSB</dt><dd class="mono">${escapeHtml(targetUser.bsb) || '未填写'}</dd></div><div><dt>银行账号</dt><dd class="mono">${escapeHtml(targetUser.accountNumber || targetUser.account_number || targetUser.account) || '未填写'}</dd></div>` : ''}</dl>${targetUser.role === 'CUSTOMER' ? `<details class="privacy-audit"><summary>协议确认记录</summary><dl class="data-list">${[['用户协议', 'user_agreement'], ['服务条款', 'service_terms'], ['隐私政策', 'privacy_policy'], ['退款政策', 'refund_policy']].map(([label, key]) => `<div><dt>${label}</dt><dd>${agreementAcceptance[`${key}_accepted`] ? `已确认 · 版本 ${escapeHtml(agreementAcceptance[`${key}_version`]) || '-'} · ${escapeHtml(agreementAcceptance[`${key}_accepted_at`]) || '-'} · IP ${escapeHtml(agreementAcceptance[`${key}_accepted_ip`]) || '-'}` : '暂无确认记录'}</dd></div>`).join('')}</dl></details>` : ''}${pendingTopups.length ? `<div class="page-notification page-notification--info"><strong>待审核充值</strong>${pendingTopups.map((topup: any) => `<p>${escapeHtml(topup.amount)} AUD · Reference ${escapeHtml(topup.reference) || '-'} <form method="post" action="/admin/balance-topups/${topup.id}/approve" style="display:inline" data-site-confirm="通过后这笔充值会立即记入该用户余额。请先核对 Reference 与到账金额。" data-confirm-variant="danger" data-confirm-title="确认充值入账？" data-confirm-label="通过并入账"><button class="button button-sm button-primary" type="submit">审核到账</button></form></p>`).join('')}</div>` : ''}${targetUser.role === 'CUSTOMER' ? `<form method="post" action="/admin/users/${targetUser.id}/balance-adjust" class="balance-adjust-form" data-site-confirm="将直接修改该用户的账户余额，并写入审计记录。请核对变动金额与原因。" data-confirm-variant="danger" data-confirm-title="调整账户余额？" data-confirm-label="保存余额调整"><h4>调整账户余额</h4><label class="form-label" for="balanceAmount">变动金额（正数增加，负数减少）</label><input class="form-control" id="balanceAmount" name="amount" type="number" step="0.01" required><label class="form-label" for="balanceReason">调整原因（必填）</label><textarea class="form-control" id="balanceReason" name="reason" maxlength="300" required></textarea><button class="button button-primary" type="submit">保存余额调整</button></form>` : ''}</section>
      </div>
      <div class="record-actions"><a href="/admin/orders?userId=${targetUser.id}" class="button button-secondary">查看关联订单</a>${targetUser.role === 'CUSTOMER' ? `<a href="/admin/users/${targetUser.id}/identity" class="button button-secondary">身份认证</a><a href="/admin/users/${targetUser.id}/risk" class="button button-secondary">风险标记${activeRiskFlags.length ? `（${activeRiskFlags.length}）` : ''}</a>` : ''}${targetUser.role !== 'ADMIN' ? `<form method="post" action="/admin/users/${targetUser.id}/clear-login-lock" style="display:inline"><button class="button button-secondary" type="submit">解除登录限制</button></form>` : ''}</div>
    </div>
  `;

  return buildLayout('用户详情 - 电脑租赁管理系统', body, user);
}
