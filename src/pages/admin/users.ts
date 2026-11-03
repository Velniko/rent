/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

import { CUSTOMER_RISK_LABELS, type CustomerRiskLevel } from '../../domain/riskFlags';
import { buildLayout, getAccessLevel, getAccountTypeDisplay, splitPersonName, formatMelbourneDate, getCustomerRiskLevels } from '../../site';
import { renderPasswordSetupNotice } from '../partials/passwordSetupNotice';
import { queryAdminUsers } from '../../services/paginatedLists';
import { renderPager } from '../../lib/pagination';

// 用户列表：SQL 分页（默认每页 50）+ 批量风险分级。
// 旧实现在这里对每个客户单独跑一次风险评估（6 条 SQL/人），用户一多就是上千条
// D1 查询；现在整个页面固定 3 条聚合查询（用户页 / 关联人 / 风险分级）。
export async function renderAdminUsers(user: any, c: any) {
  const { rows: allUsers, meta, usersById, searchTerm } = await queryAdminUsers(c, {
    page: c.req.query('page'),
    searchTerm: c.req.query('searchTerm') || '',
  });
  const customerRisks = allUsers.some(account => account.role === 'CUSTOMER')
    ? await getCustomerRiskLevels(c, allUsers.filter(account => account.role === 'CUSTOMER').map(account => account.id))
    : new Map<string, any>()

  const roleMap: Record<string, { text: string; class: string }> = {
    'ADMIN': { text: '管理员', class: 'badge-danger' },
    'STAFF': { text: '员工', class: 'badge-warning' },
    'MANAGER': { text: '经理', class: 'badge-primary' },
    'CUSTOMER': { text: '客户', class: 'badge-info' }
  };

  const statusMap: Record<string, { text: string; class: string }> = {
    'active': { text: '正常', class: 'badge-success' },
    'banned': { text: '已封禁', class: 'badge-danger' },
    'inactive': { text: '已停用', class: 'badge-neutral' },
    'departed': { text: '已离职', class: 'badge-warning' }
  };

  const body = `
    ${renderPasswordSetupNotice(c.req.query('passwordSetup'))}
    <div class="panel">
      <div class="section-title">
        <div>
          <h2>用户管理</h2>
          <p style="color: var(--text-secondary); margin-top: 4px; font-size: 0.9rem;">查看、添加、编辑和管理所有系统用户。</p>
        </div>
        <a href="/admin/users/new" class="button">添加新用户</a>
      </div>
      ${allUsers.length === 0 ? `
        <div class="empty-state">
          <span class="empty-state-code mono">USER / 000</span>
          <h3>${meta.total > 0 ? '这一页没有用户' : searchTerm ? '没有匹配的用户' : '暂无用户'}</h3>
          <p>${meta.total > 0 ? `当前列表共 ${meta.total} 位用户，请返回第一页查看。` : searchTerm ? '请调整搜索关键词后重试。' : '创建首个用户后，身份资料会显示在这里。'}</p>
          ${meta.total > 0 ? '<a href="/admin/users" class="button">回到第一页</a>' : ''}
          <a href="/admin/users/new" class="button">添加新用户</a>
        </div>
      ` : `
      <div class="search-bar" style="margin-bottom: 20px;">
        <form action="/admin/users" method="GET" style="display: flex; gap: 10px; flex-wrap: wrap;">
          <input type="search" name="searchTerm" class="form-control" placeholder="搜索姓名或邮箱..." value="${searchTerm.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')}" style="flex-grow: 1;" />
          <button type="submit" class="button button-primary">搜索</button>
          ${searchTerm ? '<a class="button button-secondary" href="/admin/users">清除搜索</a>' : ''}
        </form>
      </div>
      <div class="table-wrapper"><table>
        <thead>
          <tr>
            <th>ID</th>
            <th>名</th>
            <th>姓</th>
            <th>邮箱</th>
            <th>绑定员工</th>
            <th>推荐人</th>
            <th>角色</th>
            <th>账户类型</th>
            <th>状态</th>
            <th>风险</th>
            <th>余额</th>
            <th>注册时间</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          ${allUsers.map(u => {
            const accessLevel = getAccessLevel(u)
            const role = roleMap[accessLevel] || { text: accessLevel, class: 'badge-info' };
            const managementStatus = u.accountStatus ?? u.account_status ?? (u.status === 'active' ? 'active' : 'inactive')
            const status = statusMap[managementStatus] || { text: managementStatus, class: 'badge-info' };
            const accountType = getAccountTypeDisplay(u)
            const personName = splitPersonName(u.name)
            const risk = u.role === 'CUSTOMER' ? customerRisks.get(u.id) : null
            const riskBadge = risk ? `<span class="badge ${risk.level === 'MEDIUM' ? 'badge-warning' : ['HIGH', 'CRITICAL'].includes(risk.level) ? 'badge-danger' : 'badge-info'}">${CUSTOMER_RISK_LABELS[risk.level as CustomerRiskLevel]} · ${risk.score}</span>` : '-'
            return `
              <tr>
                <td class="mono user-id-cell">${u.id}</td>
                <td><strong>${personName.firstName || '-'}</strong></td>
                <td><strong>${personName.lastName || '-'}</strong></td>
                <td>${u.email}</td>
                <td>${u.role === 'CUSTOMER' ? usersById.get(u.staffId || '')?.name || '未分配' : '-'}</td>
                <td>${u.role === 'CUSTOMER' ? usersById.get(u.referrerId || '')?.name || '无' : '-'}</td>
                <td><span class="badge ${role.class}">${role.text}</span></td>
                <td><span class="badge ${accountType.class}">${accountType.text}</span></td>
                <td><span class="badge ${status.class}">${status.text}</span></td>
                <td>${riskBadge}</td>
                <td>AUD$${parseFloat(String(u.balance || 0)).toFixed(2)}</td>
                <td>${u.createdAt
                  ? formatMelbourneDate(u.createdAt as string)
                  : '-'
                }</td>
                <td>
                  <a class="link-button" href="/admin/users/${u.id}">查看</a>
                  <a class="link-button" href="/admin/users/${u.id}/edit">编辑</a>
                </td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table></div>
      `}
    </div>
  `;

  return buildLayout('用户管理 - 电脑租赁管理系统', body, user);
}
