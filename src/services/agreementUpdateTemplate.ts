/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

export const AGREEMENT_UPDATE_SUBJECT = '协议及服务条款更新通知'

export const AGREEMENT_UPDATE_EMAIL_BODY = `<h2>协议及服务条款更新通知</h2>
<p>尊敬的 {customer_name}：</p>
<p>感谢您一直以来对 <strong>{company_name}</strong> 的信任与支持。</p>
<p>为持续完善我们的服务、明确双方的权利与义务，并确保相关政策与实际运营安排保持一致，我们已于<strong>{update_date}</strong>对以下协议或服务条款进行了更新。</p>
<h3>本次更新内容</h3>
<table style="width:100%; border-collapse:collapse;">
    <tbody>
        <tr>
            <td style="padding:10px 0; color:#666; width:35%;">更新文件</td>
            <td style="padding:10px 0;"><strong>{changed_agreements}</strong></td>
        </tr>
    </tbody>
</table>
<h3>更新后的条款</h3>
<p>上述政策及协议的最新版本已在我们的官方网站相关页面公布。建议您及时查阅更新内容，了解可能涉及的服务安排、使用规则及双方权利义务的变化。</p>
<div style="background-color:#f5f7fa; border-left:4px solid #64748b; padding:15px; margin:20px 0;">
    <p style="margin:0 0 10px;"><strong>重要提示</strong></p>
    <p style="margin:0;">更新后的条款将根据适用法律、相关协议及其生效安排执行。如您在条款生效后继续使用相关服务，可能被视为接受适用的更新内容，但法律规定须另行取得同意的情形除外。</p>
</div>
<h3>如果您不同意更新内容</h3>
<p>如您对更新后的条款存在疑问或不同意相关变更，请在继续使用相关服务前联系我们。我们将根据适用协议及相关法律规定，协助您了解可行的后续处理安排。</p>
<p>对于已生效的租赁订单及现有合同，相关权利义务仍须按照适用的合同约定及法律规定处理。本次通知本身不代表现有合同条款自动发生变更。</p>
<h3>需要协助？</h3>
<p>如需进一步了解本次更新，或对相关协议有任何疑问，请通过以下邮箱联系我们：<a href="mailto:{company_email}">{company_email}</a>。</p>
<p>感谢您的理解与支持！</p>
<p>此致<br><strong>{company_name} 客户服务团队</strong><br><a href="mailto:{company_email}">{company_email}</a></p>`

export const AGREEMENT_UPDATE_SITE_BODY = `<p>尊敬的 {customer_name}：</p>
<p>我们已于 <strong>{update_date}</strong> 更新以下服务政策及协议：</p>
<ul>{changed_agreements_list}</ul>
<p><strong>上述政策及协议的最新版本已在官方网站公布，并自公布之日起生效。</strong> 建议您仔细阅读更新内容，以了解相关服务规则及您的权利与义务。</p>
<p>本次更新不影响您依据澳大利亚消费者法（Australian Consumer Law）享有的法定权利。对于依法需要另行取得同意的变更，我们将按照适用法律处理。</p>
<p>如对更新内容有任何疑问或异议，请联系我们的客服团队。</p>
<p>感谢您对 GeekSlope 的支持与信任。</p>
<p><strong>GeekSlope 团队</strong></p>`
