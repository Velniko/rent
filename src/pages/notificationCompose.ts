/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

import { buildLayout } from '../site'
import { escapeHtml } from '../lib/html'
import { renderAnnouncementEditor } from './partials/announcementEditor'

interface ComposeOptions {
  recipients: Array<{ id: string; name?: string; email: string }>
  templates: Array<{ id: string; name: string }>
  defaultDelivery: string
  announcement: boolean
  published: boolean
  result?: { sent: number; emailSent: number; emailFailed: number; delivery: string }
}

export function renderNotificationCompose(user: any, options: ComposeOptions): string {
  const admin = user.role === 'ADMIN'
  const announcement = admin && options.announcement
  const result = options.result
  const notice = result ? `<div role="status" data-flash-notice class="page-notification page-notification--${result.emailFailed ? 'error' : 'success'}">${result.delivery !== 'email_only' ? `<span>站内通知已发送：</span> ${result.sent}` : ''}${result.delivery !== 'in_app_only' ? `${result.delivery !== 'email_only' ? ' · ' : ''}<span>邮件已提交：</span> ${result.emailSent} · <span>邮件失败：</span> ${result.emailFailed}` : ''}${admin ? ' · <a href="/manager/email-events">查看邮件发送记录</a>' : ''}</div>` : options.published && announcement ? '<div role="status" data-flash-notice class="page-notification page-notification--success">通告已发布</div>' : ''
  const tabs = admin ? `<nav class="inner-tabs" aria-label="发布通知"><a href="/notifications/compose" ${!announcement ? 'class="active" aria-current="page"' : ''}>发送通知</a><a href="/notifications/compose?mode=announcement" ${announcement ? 'class="active" aria-current="page"' : ''}>发布通告</a></nav>` : ''
  const announcementForm = `<form method="post" action="/notifications/announcement" class="panel notification-compose"><div class="section-title"><h3>发布通告</h3><a class="button button-secondary" href="/admin/announcements">历史通告</a></div>${renderAnnouncementEditor()}<div class="form-group"><label class="form-label" for="announcementExpiresAt">下架日期和时间（选填）</label><input class="form-control" id="announcementExpiresAt" name="expiresAt" type="datetime-local"></div><button class="button button-primary" type="submit">发布通告</button></form>`
  const recipientOptions = options.recipients.map(account => `<option value="${escapeHtml(account.id)}">${escapeHtml(account.name || account.email)} · ${escapeHtml(account.email)}</option>`).join('')
  const templateOptions = `<option value="custom">自定义通知</option>${options.templates.map(item => `<option value="${escapeHtml(item.id)}">使用模板：${escapeHtml(item.name)}</option>`).join('')}`
  const manualForm = `<form id="send-notification" method="post" action="/notifications/send" class="panel notification-compose"><h3>发送通知</h3>
    <div class="form-group"><label class="form-label" for="notificationDelivery">发送方式</label><select class="form-control" id="notificationDelivery" name="delivery"><option value="in_app_email" ${options.defaultDelivery === 'in_app_email' ? 'selected' : ''}>站内通知 + 邮件</option><option value="in_app_only" ${options.defaultDelivery === 'in_app_only' ? 'selected' : ''}>仅站内通知</option><option value="email_only" ${options.defaultDelivery === 'email_only' ? 'selected' : ''}>仅邮件</option></select></div>
    <div class="form-group"><label class="form-label" for="notificationRecipient">收件人（可多选）</label><input class="form-control recipient-search" id="notificationRecipientSearch" type="search" placeholder="搜索姓名或邮箱…" autocomplete="off"><div class="recipient-picker-actions"><button type="button" class="button button-sm button-secondary" id="selectVisibleRecipients">全选当前结果</button><button type="button" class="button button-sm button-secondary" id="clearRecipients">清空选择</button><span id="recipientCount" class="section-note">已选 0 人</span></div><select class="form-control recipient-select" id="notificationRecipient" name="recipientId" multiple size="7" required>${recipientOptions}</select></div>
    <div class="form-group"><label class="form-label" for="notificationTemplate">发送内容</label><select class="form-control" id="notificationTemplate" name="templateId">${templateOptions}</select>${admin ? '<a class="form-text" href="/admin/in-app-notification-templates">站内通知模板</a>' : ''}</div>
    <div class="form-group"><label class="form-label" for="notificationTitle">标题（自定义通知时必填）</label><input class="form-control" id="notificationTitle" name="title" maxlength="120" required></div>
    <div class="form-group"><label class="form-label" for="notificationMessage">内容（支持 HTML，自定义通知时必填）</label><textarea class="form-control html-editor" id="notificationMessage" name="message" maxlength="1000" rows="8" required></textarea></div><button class="button button-primary" type="submit">发送通知</button></form>`
  const script = announcement ? '' : `<script>(()=>{
    const search=document.getElementById('notificationRecipientSearch'),select=document.getElementById('notificationRecipient'),count=document.getElementById('recipientCount'),template=document.getElementById('notificationTemplate'),title=document.getElementById('notificationTitle'),message=document.getElementById('notificationMessage');if(!search||!select)return;
    const update=()=>{const query=search.value.trim().toLowerCase();Array.from(select.options).forEach(option=>{option.hidden=Boolean(query&&!option.textContent.toLowerCase().includes(query));});count.textContent='已选 '+Array.from(select.selectedOptions).length+' 人';};
    const sync=()=>{const custom=template.value==='custom';[title,message].forEach(field=>{field.required=custom;field.setAttribute('aria-required',String(custom));});};
    search.addEventListener('input',update);select.addEventListener('change',update);template.addEventListener('change',sync);
    document.getElementById('selectVisibleRecipients').addEventListener('click',()=>{Array.from(select.options).forEach(option=>{if(!option.hidden)option.selected=true;});update();});
    document.getElementById('clearRecipients').addEventListener('click',()=>{Array.from(select.options).forEach(option=>option.selected=false);update();});update();sync();
  })();</script>`
  return buildLayout('发布通知', `<div class="page-header"><h2>发布通知</h2><a class="button button-secondary" href="/notifications">返回通知中心</a></div>${tabs}${notice}${announcement ? announcementForm : manualForm}${script}`, user)
}
