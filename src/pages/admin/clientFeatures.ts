/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

import { buildLayout } from '../../site'
import { escapeHtml } from '../../lib/html'
import { CLIENT_FEATURES, DEFAULT_MAINTENANCE_MESSAGE, type ClientAccess } from '../../clientAccess'

export function renderAdminClientFeatures(user: any, settings: ClientAccess, saved = false) {
  const surface = (key: 'console' | 'web', title: string, subtitle: string) => `<section class="panel client-access-surface"><div class="section-title"><div><p class="section-code">${subtitle}</p><h3>${title}</h3></div><label class="client-access-toggle"><input type="checkbox" name="${key}_enabled" ${settings[key].enabled ? 'checked' : ''}><span>开放访问</span></label></div><label class="form-group"><span class="form-label">关闭时的提示文案</span><textarea class="form-control" name="${key}_message" maxlength="500" rows="3" placeholder="${DEFAULT_MAINTENANCE_MESSAGE}">${escapeHtml(settings[key].message)}</textarea></label></section>`
  const body = `<div class="entity-header"><div class="identity-strip mono"><span>SYSTEM / CLIENT ACCESS</span><span>GEEKSLOPE</span></div><div class="entity-heading"><div><p class="section-code">ACCESS &amp; FEATURES</p><h2>客户端功能</h2></div><a class="button button-secondary" href="/admin/settings">系统设置</a></div></div>
  ${saved ? '<div class="page-notification page-notification--success">客户端功能设置已保存。</div>' : ''}
  <form method="post" action="/admin/settings/client-features">
    <div class="grid grid-2">${surface('web','rent-web 官网','PUBLIC WEBSITE')}${surface('console','控制台本体','CUSTOMER CONSOLE')}</div>
    <section class="panel"><div class="section-title"><h3>可选功能</h3><span class="badge badge-info">两站共用</span></div><div class="client-access-features">${CLIENT_FEATURES.map(([key,label])=>`<label class="client-access-feature"><span>${label}</span><input type="checkbox" name="feature_${key}" ${settings.features[key] ? 'checked' : ''}></label>`).join('')}</div></section>
    <section class="panel"><div class="section-title"><h3>必要功能</h3><span class="badge badge-success">始终保留</span></div><p class="form-text">登录、账户安全、已有订单、合同、付款与归还。</p><div class="entity-actions"><a class="button button-secondary" href="/admin/settings#processingFeeRate">支付方式配置</a><a class="button button-secondary" href="/admin/rental-program">出租计划配置</a><a class="button button-secondary" href="/admin/settings#defaultReferralRate">推荐返佣规则</a></div></section>
    <div class="client-access-save"><button class="button button-primary" type="submit">保存客户端功能</button></div>
  </form>`
  return buildLayout('客户端功能',body,user)
}
