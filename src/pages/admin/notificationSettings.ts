/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

import { buildLayout, sanitizePlainText } from '../../site'

export function renderAdminNotificationSettings(user: any, settings: any, message = '', type: 'success' | 'error' = 'success'): string {
    const delivery = settings?.defaultDelivery === 'in_app_only' ? 'in_app_only' : 'in_app_email'
    const alert = message ? `<div data-flash-notice class="page-notification page-notification--${type}">${sanitizePlainText(message, 300)}</div>` : ''
    const body = `<div class="page-header"><div><p class="section-code">COMMUNICATION / NOTIFICATIONS</p><h2>通知设置</h2><p>订单、合同和付款等重要通知仍会保留在站内通知中心。</p></div><a class="button button-secondary" href="/admin/notifications">返回通知管理</a></div>
    ${alert}
    <section class="panel"><div class="section-title"><h3>默认通知发送方式</h3></div>
      <form method="post" action="/admin/notifications/settings">
        <label class="form-check" style="display:flex;gap:10px;align-items:flex-start;margin:16px 0"><input type="radio" name="defaultDelivery" value="in_app_email" ${delivery === 'in_app_email' ? 'checked' : ''}><span><strong>站内通知 + 邮件</strong><small class="form-text" style="display:block">创建自动业务通知时，同时写入通知中心并发送邮件。</small></span></label>
        <label class="form-check" style="display:flex;gap:10px;align-items:flex-start;margin:16px 0"><input type="radio" name="defaultDelivery" value="in_app_only" ${delivery === 'in_app_only' ? 'checked' : ''}><span><strong>仅站内通知</strong><small class="form-text" style="display:block">创建自动业务通知时只写入通知中心，不发送邮件。</small></span></label>
        <p class="form-text">手动通知可在发送时选择发送方式。</p>
        <button class="button button-primary" type="submit">保存通知设置</button>
      </form>
    </section>`
    return buildLayout('通知设置 - 电脑租赁管理系统', body, user)
}
