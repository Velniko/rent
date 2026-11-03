-- Copyright (c) 2026 jiongjiong123441. All rights reserved.
-- Licensed under PolyForm Noncommercial 1.0.0.
-- Noncommercial use, modification, and distribution are permitted.
-- Keep this notice and the LICENSE file with all copies and modified versions.

-- Publish the 2026-11-04 legal revision for current rental and payment features.
-- Intentionally replaces the ten published documents in both languages and the
-- default template. Never rewrites existing contracts or signed snapshots.
-- No customer notification is queued by this migration.
-- Legal reference: ACCC consumer guarantees, remedies and card surcharges;
-- OAIC cross-border disclosure guidance (reviewed 2026-11-04).

INSERT INTO systemSettings (key, value) VALUES ('userTerms',
'<h1>用户协议</h1>
<p><strong>版本：</strong>{user_terms_version}　<strong>最后更新：</strong>{user_terms_last_updated_date}</p>
<p>本协议适用于您使用 {company_name} 的网站、账户及设备租赁服务。请在注册或确认订单前阅读本协议、<a href="/service-terms">《服务条款》</a>、<a href="/rental-agreement">《设备租赁协议》</a>、<a href="/refund-policy">《退款政策》</a>和<a href="/privacy">《隐私政策》</a>。具体订单经确认的费用及约定适用于该次租赁；任何约定均不限制不可排除的法定权利。</p>
<h2>一、账户与资料</h2>
<p>注册及订立租赁合同时，您须年满 18 周岁，具备订约能力；代表机构办理时应取得授权。您应提供真实、准确的身份、联系及交付资料，妥善保管密码、签约链接和取货二维码，发现冒用应及时联系我们。访客账户可用于单次租赁，设置密码后可升级为正式账户；访客账户失效或账户注销不免除未完成的付款、归还或争议处理义务。</p>
<h2>二、申请与确认</h2>
<p>设备展示、报价或自助租赁链接本身不保证预留成功。提交申请后仍可能因设备不可用、日期冲突或必要核验未完成而不获接受。订单确认以订单页面显示为准；需要签约、付款或付款审核的，应先完成相应步骤。管理员与您另行确认的手动订单以双方确认的订单记录为准。</p>
<h2>三、付款、押金与取消</h2>
<p>请核对租期、折扣、付款计划、押金及各项费用后再确认。满 60 天的订单在提供月付选项时可选择 Stripe 月付或一次性付清；一次性付清的押金减免受租期和风险评估条件限制。确认前取消不收取消手续费；确认后、实际取货或交付前，因个人原因申请取消退款的手续费为订单总额的 5%，详见《退款政策》。支付渠道手续费与取消手续费分别列示。</p>
<h2>四、风险评估与复核</h2>
<p>我们会参考身份核验、历史履约、付款、退款、逾期、损坏及风险标记评估租赁风险，可能调整新订单的押金或限制自助下单。风险标记不等于您已被认定违法；如资料有误或您对结果有异议，可联系我们要求更正及人工复核。已确认订单的押金不因后续评分变化而自动上调。</p>
<h2>五、优惠、推荐与反馈奖励</h2>
<p>设备折扣、优惠券、推荐分成及自愿反馈奖励以参与时公布的资格、金额、有效期和适用范围为准，不保证适用于所有设备或订单。推荐奖励按符合条件订单的净租金及适用等级比例计算，不包括押金、配送费、时段服务费或支付手续费；在订单完成、结算等待期届满及必要审核通过后可用。取消、退款、拒付、重复或虚假推荐可能导致奖励调整、暂停或撤销。不得通过自我推荐、虚假身份或重复账户获取奖励。奖励余额、佣金余额与租赁押金分别记账，其使用或提现以页面提供的选项为准。</p>
<h2>六、使用规范与知识产权</h2>
<p>您应遵守<a href="/acceptable-use">《可接受使用政策》</a>，不得干扰网站、绕过安全措施、伪造凭证或侵害他人权益。网站及软件内容的知识产权归我们或相应权利人所有，法律允许的使用除外。</p>
<h2>七、服务与账户变更</h2>
<p>因安全、维护、法律要求或严重违约，我们可采取必要、适度的功能限制或暂停措施，并在合理可行时告知原因及补救办法。您可申请注销账户；未结订单及依法应留存的记录按《隐私政策》处理。暂停账户不剥夺您获取合同、申请法定退款或提出争议的权利。</p>
<h2>八、语言、通知与更新</h2>
<p>网站提供中英文内容；部分公开内容可能通过第三方机器翻译。英文协议供参考，中文为约定文本，但不得据此限制法定权利或忽略已向您作出的明确承诺。订单、付款、合同、安全和归还通知可通过站内或邮件发送，请保持联系方式有效。重要协议更新会公布版本及日期，并在适当情况下另行通知；新增费用或实质改变已确认订单的义务须另行取得您的同意，不追溯改写已签合同。</p>
<h2>九、消费者保障与争议</h2>
<p>本协议不排除《澳大利亚消费者法》或其他法律不可排除的保障与责任。适用维多利亚州法律及法院非专属管辖，但不剥夺您依法可选择的争议渠道。投诉按<a href="/complaints">《投诉与争议解决政策》</a>处理。</p>
<h2>联系我们</h2>
<p>{company_name}（ABN {company_abn}）<br>地址：{company_address}<br>电话：{company_phone}<br>邮箱：{company_email}</p>')
ON CONFLICT(key) DO UPDATE SET value = excluded.value, deleted_at = NULL, updatedAt = CURRENT_TIMESTAMP;

INSERT INTO systemSettings (key, value) VALUES ('userTermsEn',
'<h1>User Terms</h1>
<p><strong>Version:</strong> {user_terms_version}　<strong>Last updated:</strong> {user_terms_last_updated_date}</p>
<p>These terms apply to your use of the website, accounts and equipment rental services of {company_name}. Before registering or confirming an order, read these terms, the <a href="/service-terms">Terms of Service</a>, <a href="/rental-agreement">Rental Agreement</a>, <a href="/refund-policy">Refund Policy</a> and <a href="/privacy">Privacy Policy</a>. Confirmed order charges and arrangements apply to that rental. No provision limits non-excludable statutory rights.</p>
<h2>1. Accounts and information</h2>
<p>You must be at least 18 and have capacity to contract, with authority if acting for an organisation. Provide accurate identity, contact and delivery information. Protect passwords, signing links and pickup QR codes, and report misuse promptly. A guest account may be used for a single rental and upgraded by setting a password. Expiry or closure of an account does not remove outstanding payment, return or dispute obligations.</p>
<h2>2. Applications and confirmation</h2>
<p>A listing, quote or self-service rental link does not guarantee a reservation. Applications may be declined for unavailability, conflicting dates or incomplete necessary checks. Confirmation is shown on the order page after any required signing, payment or payment review. Manually arranged orders are governed by the order record agreed with you.</p>
<h2>3. Payment, deposits and cancellation</h2>
<p>Check dates, discounts, payment plans, deposits and charges before confirmation. Where offered, rentals of at least 60 days may be paid through Stripe instalments or upfront; deposit waivers depend on duration and risk assessment. Cancellation before order confirmation has no cancellation fee. After confirmation and before actual pickup or delivery, a change-of-mind cancellation refund carries a fee of 5% of the order total, subject to the Refund Policy. Payment processing fees and cancellation fees are listed separately.</p>
<h2>4. Risk assessment and review</h2>
<p>Identity checks, rental history, payments, refunds, overdue returns, damage and risk flags may affect deposits for new orders or access to self-service ordering. A flag is not a finding of unlawful conduct. Contact us to correct inaccurate information or request human review. Later score changes do not automatically increase a confirmed order deposit.</p>
<h2>5. Discounts, referrals and feedback rewards</h2>
<p>Device discounts, coupons, referral commissions and voluntary feedback rewards are subject to the eligibility, amounts, expiry and scope published when participating. They may not apply to every device or order. Referral rewards use the qualifying order net rent and applicable tier rate, excluding deposits, delivery, time-slot service fees and payment processing fees. Rewards become available after completion, the settlement waiting period and required review. Cancellations, refunds, chargebacks, duplicate or false referrals may lead to adjustment, suspension or reversal. Self-referrals, false identities and duplicate accounts are prohibited. Reward balances, commission balances and rental deposits are separate; use or withdrawal is subject to the options offered.</p>
<h2>6. Acceptable use and intellectual property</h2>
<p>Comply with the <a href="/acceptable-use">Acceptable Use Policy</a>. Do not disrupt the website, bypass security, falsify evidence or infringe rights. Website and software intellectual property belongs to us or the relevant rights holders, subject to uses permitted by law.</p>
<h2>7. Service and account changes</h2>
<p>We may take necessary and proportionate restrictions or suspension measures for security, maintenance, legal requirements or serious breaches, explaining reasons and remedies where reasonably practicable. You may request account closure. Outstanding orders and required records are handled under the Privacy Policy. Suspension does not remove access to contracts, statutory refunds or dispute channels.</p>
<h2>8. Languages, notices and updates</h2>
<p>The website offers Chinese and English content. Some public content may use third-party machine translation. English agreements are for reference and Chinese is the agreed text, without limiting statutory rights or express representations made to you. Service notices may be sent through the website or email; keep contact details current. Important updates will state a version and date and may be separately notified. New charges or material changes to confirmed order obligations require your further agreement and do not retrospectively rewrite signed contracts.</p>
<h2>9. Consumer protection and disputes</h2>
<p>Nothing excludes non-excludable rights or liabilities under the Australian Consumer Law or other laws. Victorian law and non-exclusive court jurisdiction apply without removing other legally available dispute channels. See the <a href="/complaints">Complaints Policy</a>.</p>
<h2>Contact us</h2>
<p>{company_name} (ABN {company_abn})<br>Address: {company_address}<br>Telephone: {company_phone}<br>Email: {company_email}</p>')
ON CONFLICT(key) DO UPDATE SET value = excluded.value, deleted_at = NULL, updatedAt = CURRENT_TIMESTAMP;

INSERT INTO systemSettings (key, value) VALUES ('serviceTerms',
'<h1>服务条款</h1>
<p><strong>版本：</strong>{service_terms_version}　<strong>最后更新：</strong>{service_terms_last_updated_date}</p>
<p>{company_name} 提供设备浏览、租赁申请、自助租赁链接、签约、付款、配送预约、取还登记、验机及售后服务。本条款与《用户协议》、具体订单和《设备租赁协议》一并适用。</p>
<h2>一、申请、预留与交付</h2>
<p>可租日期、最短租期和取还时段以页面显示为准；展示或提交申请不代表订单已确认。设备预留取决于申请处理、签约及必要付款。演示或预览信息不作为真实库存承诺。自提、配送及配送范围以订单确认为准；配送服务可能由合作服务商履行。取货二维码或链接仅供本人或经授权领取人使用，实际交付以交接记录为准。</p>
<h2>二、租金与折扣</h2>
<p>租期不足 30 天时，完整的 7 天按周租价、余下天数按日租价计算。满 30 天后，完整的 30 天按月租价；不足整月的余期少于 21 天时按周租日价折算，满 21 天时按月租日价折算，不向上取整为整月。设备单独设置的折扣优先于全站折扣；优惠券按其适用项目及条件计算。报价和确认后的定价记录为该订单依据，后续调价不自动追溯已确认订单。</p>
<h2>三、付款计划</h2>
<p>不足 60 天的订单一次性付清；满 60 天且提供月付选项时，可选择 Stripe 月付或一次性付清。月付每 30 天一期，末期按实际剩余天数结算；首期包含适用押金、配送费及时段服务费，各期另列适用支付手续费。选择月付并完成首次付款时，您授权 Stripe 保存支付方式，并按订单列明的到期日期和金额收取后续期款；扣款失败或需额外验证时，您须按通知完成付款。月付不自动续租；订单取消或设备归还后，停止收取未发生的后续期款，已到期欠款及应结费用仍须结清。付款计划仅在未付款且订单允许时可调整。</p>
<h2>四、押金与支付渠道</h2>
<p>押金可能根据风险评估调整；满 60 天一次性付清且押金风险倍数不高于 1 的订单可免押金，风险加收押金的订单不享受该项减免。月付押金在首期实际收取；其他订单可按提供的选项实际支付押金、使用信用卡预授权或保存后续扣款授权。预授权不是实收付款，保存卡片也不是押金冻结。</p>
<p>可选支付渠道以结算页为准，包括启用的 Stripe、Square、银行转账、账户余额、支付宝或微信。所有订单以澳元（AUD）记账；人民币付款按确认页披露的汇率和金额核验，退款涉及兑换时应另行明确汇率及币种。转账截图不等于到账确认。本网站不保存完整卡号或安全码。</p>
<h2>五、税费与其他费用</h2>
<p>适用 GST 计入展示总价，发票按适用税法开具。配送费、特殊取还时段服务费、押金及支付手续费在确认或付款前单独列示。自 2026 年 10 月 1 日起，Visa、Mastercard、American Express 和 eftpos 支付不得另收银行卡支付附加费，不得改称服务费以规避；其他费用仍须依法清楚披露。取消手续费、未取货费用及逾期归还费用见《退款政策》和《设备租赁协议》，同一损失不重复收费。</p>
<h2>六、取消与服务问题</h2>
<p>订单确认前取消不收取消手续费；确认后、实际取货或交付前，个人原因取消按订单总额的 5% 收取取消手续费。设备不可用、由我们取消、设备故障或依法享有退款权的，不适用该个人原因取消收费规则。退款、未取货、提前归还和押金结算详见<a href="/refund-policy">《退款政策》</a>。</p>
<h2>七、第三方服务、翻译与中断</h2>
<p>付款、邮件、图片托管、配送、在线客服、反馈问卷或翻译可能使用第三方服务，信息处理见《隐私政策》。机器翻译可能有误；涉及费用、授权或条款理解时可联系我们核对。维护、安全事件或网络故障可能影响网站，我们会采取合理措施恢复服务并处理受影响订单，不因此排除法定责任。</p>
<h2>八、法律、争议与更新</h2>
<p>不得违法使用或干扰服务。我们不排除不可排除的消费者保障、合理可预见损失的法定赔偿或依法应承担的责任。条款更新不单方改变已确认订单的实质权利义务；适用维多利亚州法律及法院非专属管辖。争议可按<a href="/complaints">《投诉与争议解决政策》</a>处理。</p>
<h2>联系我们</h2>
<p>{company_name}（ABN {company_abn}）<br>地址：{company_address}<br>电话：{company_phone}<br>邮箱：{company_email}</p>')
ON CONFLICT(key) DO UPDATE SET value = excluded.value, deleted_at = NULL, updatedAt = CURRENT_TIMESTAMP;

INSERT INTO systemSettings (key, value) VALUES ('serviceTermsEn',
'<h1>Terms of Service</h1>
<p><strong>Version:</strong> {service_terms_version}　<strong>Last updated:</strong> {service_terms_last_updated_date}</p>
<p>{company_name} provides device browsing, rental applications, self-service links, signing, payments, delivery bookings, handover and return records, inspections and support. These terms apply with the User Terms, confirmed order and Rental Agreement.</p>
<h2>1. Applications, reservations and handover</h2>
<p>Available dates, minimum duration and collection or return slots are shown on the page. A listing or application is not confirmation. Reservation depends on processing, signing and required payment. Demo or preview information is not a real stock commitment. Pickup, delivery and service areas require order confirmation; partners may fulfil delivery. Protect pickup QR codes and links for yourself or an authorised collector. Handover is recorded when it occurs.</p>
<h2>2. Rent and discounts</h2>
<p>Below 30 days, complete 7-day blocks use the weekly price and remaining days use the daily price. From 30 days, complete 30-day blocks use the monthly price. A remainder below 21 days uses the prorated weekly daily price; a remainder of at least 21 days uses the prorated monthly daily price, without rounding up to a full month. Device-specific discounts override site defaults. Coupons apply only to eligible components and conditions. The confirmed pricing record governs that order; later price changes do not automatically apply retrospectively.</p>
<h2>3. Payment plans</h2>
<p>Rentals below 60 days are paid upfront. Where offered, rentals of at least 60 days may use Stripe instalments or upfront payment. Instalments cover 30-day periods with the final period based on remaining days. The first includes applicable deposit, delivery and time-slot service fees; applicable processing fees are separately shown for each payment. By choosing instalments and completing the first payment, you authorise Stripe to save the payment method and charge later amounts on the order schedule. Complete payment when notified of failure or additional authentication. Instalments do not renew the rental automatically. Cancellation or return stops future unearned instalments, while accrued debts and settlement charges remain payable. Plans may be changed only before payment while the order permits it.</p>
<h2>4. Deposits and payment methods</h2>
<p>Risk assessment may adjust the deposit. An upfront rental of at least 60 days may waive the deposit if its risk multiplier is no greater than 1; increased risk deposits are not waived. Monthly plans collect the deposit with the first payment. Other orders may offer a paid deposit, card authorisation hold or saved authority for later charges. A hold is not a captured payment and saving a card does not freeze a deposit.</p>
<p>Checkout shows available channels, which may include enabled Stripe, Square, bank transfer, account balance, Alipay or WeChat options. Orders are recorded in AUD. RMB payments are checked against the disclosed rate and amount; any refund conversion requires the currency and rate to be made clear. A transfer image does not establish receipt of funds. We do not store full card numbers or security codes.</p>
<h2>5. Tax and other charges</h2>
<p>Applicable GST is included in displayed totals and invoices comply with applicable tax law. Delivery, special time-slot fees, deposits and processing fees are disclosed before confirmation or payment. From 1 October 2026, Visa, Mastercard, American Express and eftpos payments must not attract a separate card payment surcharge, including one relabelled as a service fee. Other charges must still be clearly disclosed as required by law. Cancellation, missed pickup and overdue return charges are addressed in the Refund Policy and Rental Agreement. The same loss is not charged twice.</p>
<h2>6. Cancellations and service problems</h2>
<p>There is no cancellation fee before order confirmation. A change-of-mind cancellation after confirmation and before actual pickup or delivery carries a fee of 5% of the order total. That rule does not apply to our cancellation, unavailable equipment, faults or statutory refund rights. See the <a href="/refund-policy">Refund Policy</a> for refunds, missed pickup, early returns and deposit settlement.</p>
<h2>7. Third parties, translation and interruptions</h2>
<p>Payments, email, image hosting, delivery, chat, surveys and translation may use third parties under the Privacy Policy. Machine translations may be inaccurate; contact us to clarify charges, authorisations or terms. Maintenance, security events and network faults may interrupt the website. We will take reasonable recovery steps and address affected orders without excluding statutory liability.</p>
<h2>8. Law, disputes and updates</h2>
<p>Do not misuse or disrupt services. Non-excludable guarantees, statutory compensation for reasonably foreseeable loss and mandatory liabilities remain. Updates do not unilaterally alter material confirmed order rights or obligations. Victorian law and non-exclusive court jurisdiction apply. See the <a href="/complaints">Complaints Policy</a>.</p>
<h2>Contact us</h2>
<p>{company_name} (ABN {company_abn})<br>Address: {company_address}<br>Telephone: {company_phone}<br>Email: {company_email}</p>')
ON CONFLICT(key) DO UPDATE SET value = excluded.value, deleted_at = NULL, updatedAt = CURRENT_TIMESTAMP;

INSERT INTO systemSettings (key, value) VALUES ('rentalTerms',
'<h1>设备租赁协议</h1>
<p><strong>版本：</strong>{rental_agreement_version}　<strong>最后更新：</strong>{rental_agreement_last_updated_date}</p>
<p>本协议由 {company_name}（ABN {company_abn}，出租方）与 {signer_name}（承租方）就下列设备订立。具体订单、双方确认的付款计划及交接记录为本协议的组成部分。</p>
<h2>一、设备、租期与交付</h2>
<ul><li>设备：{device_name}（{device_model}）；序列号：{device_sn}。</li><li>租期：{start_date} 至 {end_date}，共 {rental_days} 天。</li><li>日租金：AUD {daily_rate}；租金总额：AUD {total_rent}；GST：{gst_included}。</li><li>押金：AUD {deposit_amount}。配送费、时段服务费、优惠及支付手续费以订单分别列示的金额为准。</li></ul>
<p>承租方应在交付时检查设备及配件，发现问题及时提出；签约本身不视为已经收到或验收设备。取还时间按墨尔本当地时间。取货二维码仅供领取核验，实际交付以交接记录为准。需要续租或变更取还安排的，应取得出租方确认。</p>
<h2>二、租金与付款计划</h2>
<p>不足 30 天按完整周及剩余日计算；满 30 天按完整的 30 天月租计算，余期少于 21 天按周租日价折算，满 21 天按月租日价折算。折扣及优惠以确认报价为准。不足 60 天一次性付清；满 60 天且提供月付选项时可选 Stripe 月付或一次性付清。月付为每 30 天一期，末期按剩余天数结算，首期包含适用押金及订单列明的一次性费用，各期支付手续费另列。</p>
<p>选择月付并完成首次付款时，承租方授权 Stripe 保存支付方式，按订单付款计划收取到期款项；失败或需验证时应按通知补付。月付不自动续租，也不免除已到期款项。取消或归还设备后停止未发生的后续期款，退款按《退款政策》办理。确认后的租金和押金不因后续定价或风险评分变化而自动上调。</p>
<h2>三、押金金额与担保方式</h2>
<p>押金用于担保履约，不是租金、保险或罚金。新订单根据身份核验、履约、付款、退款、逾期、损坏及有效风险标记评估，六档押金倍数为设备基础押金的 0、0.5、1、1.25、1.5 或 2 倍；具体金额应在确认前列明，可申请人工复核。满 60 天一次性付清且风险倍数不高于 1 时可免押金；风险加收的押金不因一次性付清而免除。</p>
<p>月付押金在首期实际收取。其他订单按已选方式收取押金、办理信用卡预授权或通过 SetupIntent 保存后续扣款授权。预授权期限受卡组织及银行限制，通常 Visa、Mastercard 最长 30 天，其他卡最长 7 天；以支付服务商实际期限为准。保存卡片并不表示已冻结或支付押金。出租方仅可就本订单有依据、已披露的应付金额进行授权范围内的扣款；在合理可行时先提供说明及提出异议的机会，不得无限额或重复扣款。</p>
<h2>四、归还、验机与押金结算</h2>
<p>承租方应按约定归还设备及全部配件，并在归还前备份和移除个人数据。出租方记录实际接收时间并进行验机；归还后的验机或退款等待不继续产生占用租金。完成验机后 10 个营业日内安排退还可退押金、释放预授权或结清后续扣款，银行实际到账或解除冻结时间由支付机构决定。正常损耗不扣款，扣款应逐项列明并提供照片、报价或发票等依据；已收费用不得再次从押金扣除。承租方可对验机及扣款提出异议。</p>
<h2>五、取消、未取货与提前归还</h2>
<p>订单确认前取消不收取消手续费；确认后、实际取货或交付前，承租方个人原因取消按订单总额的 5% 收费。门店自提超过预约取货开始时间 2 小时仍未领取的，订单可被取消并释放设备，收取 AUD 25 未取货操作费，剩余款项退还；该费用不与同一次取消的 5% 手续费叠加。配送订单不适用门店未取货规则。提前归还的未使用租金及押金分别结算，详见<a href="/refund-policy">《退款政策》</a>。上述个人原因收费不适用于出租方原因或法定退款。</p>
<h2>六、逾期归还</h2>
<p>超过约定归还时间 2 小时仍未归还的，收取一次 AUD 25 操作费；跨过约定归还日后，按逾期日数及订单日租金补收占用租金。已结算金额和押金已抵扣金额从应付中扣除。费用在实际接收设备时停止累计，不因验机或退款处理而增加。收费受适用法律限制，仅用于补偿合理损失及成本，不得重复赔偿。</p>
<h2>七、所有权、使用与损坏</h2>
<p>设备所有权不转移，不含购买权或购买义务，租期以订单为准；依法适用的消费者租赁、信贷及其他强制性规定仍然适用。不得擅自转租、转借、出售、抵押、拆解、改装或移出澳大利亚，详细限制见《可接受使用政策》。因承租方或其授权使用人的过错造成丢失或超出正常损耗的损坏，应承担有凭证的合理损失；以合理维修费用或扣除折旧后的重置价值中适用且较低者为限，不包括出租方过错造成的损失。不足押金的合理欠款仍可依法追偿，免押金不等于免除赔偿责任。</p>
<h2>八、设备软件与数据</h2>
<p>管理软件可能上报设备状态、硬件、租期及安全信息。远程锁定、重启、注销或清除仅在《软件使用协议》所列必要情形依法实施；合理可行时先通知并给予补救及备份机会。数据清除会删除设备上的用户数据；出租方不以本条排除依法应承担的数据安全责任。信息处理见《隐私政策》。</p>
<h2>九、违约与合法取回</h2>
<p>未付到期款、严重违反使用限制或存在有依据的欺诈风险时，出租方可在合理通知及补救期后采取相称措施或终止租赁；紧急安全或法律要求的情形除外。取回设备须采用合法方式，不得擅闯住宅、胁迫或不当骚扰。合法提出退款、扣款异议或行使消费者权利本身不构成违约。</p>
<h2>十、消费者保障、争议与一般条款</h2>
<p>设备应质量可接受、符合描述及已告知用途；服务应以合理谨慎和技能提供。重大问题及未在合理时间解决的其他问题，按《澳大利亚消费者法》提供适用退款、修理、更换或赔偿，包括可合理预见的损失。任何条款不排除不可排除的权利与责任。</p>
<p>双方同意采用电子确认或签署，保存时间、IP 地址和设备信息作为证据。条款或费用的实质变更须另行同意，不追溯修改已签内容。不可抗力应及时通知并合理减损，不排除依法适用的退款。适用澳大利亚 {jurisdiction} 法律及法院非专属管辖，不影响其他法定争议途径。请按《投诉与争议解决政策》联系出租方。</p>
<p>收款账户：BSB {bank_bsb}；账号 {bank_account}；账户名 {account_name}。</p>
<p>承租方：{signer_name}　确认／签署时间：{sign_time}</p>
<h2>联系我们</h2>
<p>{company_name}（ABN {company_abn}）<br>地址：{company_address}<br>电话：{company_phone}<br>邮箱：{company_email}</p>')
ON CONFLICT(key) DO UPDATE SET value = excluded.value, deleted_at = NULL, updatedAt = CURRENT_TIMESTAMP;

INSERT INTO systemSettings (key, value) VALUES ('rentalTermsEn',
'<h1>Device Rental Agreement</h1>
<p><strong>Version:</strong> {rental_agreement_version}　<strong>Last updated:</strong> {rental_agreement_last_updated_date}</p>
<p>This agreement is between {company_name} (ABN {company_abn}, the lessor) and {signer_name} (the renter). The confirmed order, agreed payment schedule and handover records form part of it.</p>
<h2>1. Equipment, term and handover</h2>
<ul><li>Equipment: {device_name} ({device_model}); serial: {device_sn}.</li><li>Term: {start_date} to {end_date}, {rental_days} days.</li><li>Daily rent: AUD {daily_rate}; total rent: AUD {total_rent}; GST: {gst_included}.</li><li>Deposit: AUD {deposit_amount}. Delivery, time-slot fees, discounts and processing fees are separately shown in the order.</li></ul>
<p>Inspect equipment and accessories on handover and report problems promptly. Signing alone does not establish delivery or acceptance of equipment condition. Times are local Melbourne time. QR codes assist collection verification; handover records establish delivery. Extensions and collection or return changes require confirmation.</p>
<h2>2. Rent and payment plans</h2>
<p>Below 30 days, complete weeks and remaining days are charged. From 30 days, complete 30-day months use monthly rent. A remainder below 21 days uses the prorated weekly daily rate; at least 21 days uses the prorated monthly daily rate. Confirmed discounts apply. Below 60 days, payment is upfront. Where offered, at least 60 days may use Stripe instalments or upfront payment. Instalments cover 30 days with a final remainder; the first includes applicable deposit and listed one-off charges, with processing fees shown separately.</p>
<p>By selecting instalments and completing the first payment, the renter authorises Stripe to save the method and charge amounts when scheduled. Failed charges or authentication requests require follow-up payment. Instalments do not renew the term or forgive accrued debts. Cancellation or return stops future unearned instalments; refunds follow the Refund Policy. Later pricing or risk score changes do not automatically increase confirmed rent or deposits.</p>
<h2>3. Deposit amount and security methods</h2>
<p>The deposit secures performance and is not rent, insurance or a penalty. New orders are assessed using identity checks, rental, payment, refund, overdue and damage history and active risk flags. Six deposit multipliers are 0, 0.5, 1, 1.25, 1.5 or 2 times the base device deposit. The amount must be disclosed before confirmation and human review is available. Upfront rentals of at least 60 days may waive the deposit when the multiplier is no greater than 1; increased risk deposits remain payable.</p>
<p>Monthly deposits are collected in the first payment. Other orders may use a paid deposit, card hold or SetupIntent authority for later charges, as selected. Hold periods depend on banks and card rules, usually up to 30 days for Visa or Mastercard and 7 days for others, subject to actual provider limits. Saving a card does not freeze or pay a deposit. Only evidenced, disclosed amounts due for this order may be charged within the agreed authority, with explanation and an opportunity to dispute where reasonably practicable. No unlimited or duplicate charges are authorised.</p>
<h2>4. Return, inspection and deposit settlement</h2>
<p>Return all equipment and accessories as agreed, backing up and removing personal data first. We record actual receipt and inspect the equipment. Waiting for inspection or refunds after receipt does not extend occupancy rent. Within 10 business days after inspection we arrange any deposit refund, hold release or authorised settlement; bank processing times may differ. Fair wear and tear is not chargeable. Itemised deductions require photos, quotes or invoices. Amounts already collected are not deducted again. You may dispute inspection findings and deductions.</p>
<h2>5. Cancellation, missed pickup and early return</h2>
<p>Before order confirmation there is no cancellation fee. After confirmation but before actual pickup or delivery, a change-of-mind cancellation carries a 5% fee on the order total. A store pickup still uncollected 2 hours after the appointment start may be cancelled and the device released, with an AUD 25 missed-pickup handling fee and the remainder refunded. That fee is not added to a 5% fee for the same cancellation. The store rule does not apply to delivery orders. Unused rent and deposits are settled separately on early return under the <a href="/refund-policy">Refund Policy</a>. Change-of-mind charges do not apply to lessor-caused cancellations or statutory refunds.</p>
<h2>6. Overdue returns</h2>
<p>A return more than 2 hours after the agreed time incurs a one-off AUD 25 handling fee. After the scheduled return date, additional occupancy rent uses overdue calendar days and the order daily rate. Amounts collected or applied from the deposit reduce the balance. Accrual stops when equipment is received, not when inspection or refunds finish. Charges are subject to law, compensate reasonable losses and costs, and must not duplicate recovery.</p>
<h2>7. Ownership, use and damage</h2>
<p>Ownership does not transfer and there is no purchase right or obligation. The order sets the term; any mandatory consumer lease, credit or other laws still apply. Unauthorised subletting, lending, sale, security interests, disassembly, modification or removal from Australia is prohibited; see the Acceptable Use Policy. Loss or damage beyond fair wear and tear caused by the renter or authorised users requires evidenced reasonable compensation, limited to the applicable lower reasonable repair cost or depreciated replacement value and excluding losses caused by the lessor. Reasonable debts beyond the deposit remain recoverable by law; a waiver is not a waiver of liability.</p>
<h2>8. Management software and data</h2>
<p>Software may report device status, hardware, rental and security information. Remote locking, restart, sign-out or erasure is limited to necessary lawful circumstances in the Software Terms, with notice and time to remedy and back up where reasonably practicable. Erasure deletes device user data. Mandatory data-security liabilities remain. See the Privacy Policy.</p>
<h2>9. Breach and lawful recovery</h2>
<p>Unpaid due amounts, serious misuse or evidenced fraud risk may lead to proportionate measures or termination after reasonable notice and a remedy period, except for urgent safety or legal requirements. Recovery must be lawful, without unauthorised entry, coercion or improper harassment. A lawful refund request, deduction dispute or exercise of consumer rights is not itself a breach.</p>
<h2>10. Consumer protection, disputes and general terms</h2>
<p>Equipment must be of acceptable quality, match description and meet disclosed purposes; services must use due care and skill. Major failures and other failures not remedied in reasonable time attract applicable refunds, repair, replacement or compensation under the Australian Consumer Law, including reasonably foreseeable loss. Non-excludable rights and liabilities remain.</p>
<p>The parties agree to electronic confirmation or signing, with time, IP and device information recorded as evidence. Material changes require further agreement and do not rewrite signed content. Force majeure requires prompt notice and reasonable mitigation and does not remove statutory refunds. Australian {jurisdiction} law and non-exclusive court jurisdiction apply without excluding other lawful dispute channels. See the Complaints Policy.</p>
<p>Payment account: BSB {bank_bsb}; account {bank_account}; name {account_name}.</p>
<p>Renter: {signer_name}　Confirmation/signing time: {sign_time}</p>
<h2>Contact us</h2>
<p>{company_name} (ABN {company_abn})<br>Address: {company_address}<br>Telephone: {company_phone}<br>Email: {company_email}</p>')
ON CONFLICT(key) DO UPDATE SET value = excluded.value, deleted_at = NULL, updatedAt = CURRENT_TIMESTAMP;

INSERT INTO systemSettings (key, value) VALUES ('copyrightNotice',
'<h1>取消与退款政策</h1>
<p><strong>版本：</strong>{refund_policy_version}　<strong>最后更新：</strong>{refund_policy_last_updated_date}</p>
<p>本政策适用于 {company_name} 的订单取消、提前归还、押金及付款退款。取消手续费与支付渠道手续费不同；下列个人原因取消规则不适用于设备故障、我们无法履约或依法应退款的情况。</p>
<h2>一、订单确认前取消</h2>
<p>订单确认前取消不收取消手续费。未付款的订单没有退款；已收款的退还已收款，未扣取的信用卡预授权予以释放，不因申请取消而另收手续费。订单是否已确认以订单页面的“已确认”或“待取货”状态及确认记录为准，不以申请提交时间或是否点击退款申请确认框为准。</p>
<h2>二、确认后、实际取货或交付前取消</h2>
<p>因个人原因取消，收取订单总额的 5% 作为取消退款手续费。订单总额包含订单中的租金、押金、配送费及时段服务费，并计入已适用优惠，不包含另列的支付渠道手续费；月付订单按整笔订单总额计算，不仅按已付首期计算。申请页列示已付款、预授权、手续费、预计退款和预计释放金额，由您确认后提交审核。已付款或可用预授权不足以结算手续费时，请联系我们核对，不会承诺负数退款。</p>
<p>退款审核通过后取消订单并处理退款；提交申请不表示退款已完成。预授权部分可能只扣取应付的取消手续费并释放其余冻结额，该释放不是现金退款。同一取消不再叠加未取货操作费或重复收取同类损失。</p>
<h2>三、未按时取货</h2>
<p>门店自提订单在预约取货开始时间后 2 小时仍未领取的，可取消订单并释放设备，扣除 AUD 25 未取货操作费后退还剩余款项，不另叠加本次取消的 5% 手续费。配送订单不适用门店未取货规则。因我们原因未能交付或依法应全退的，不扣该操作费。</p>
<h2>四、取货后提前归还</h2>
<p>实际取货或交付后，应办理归还和验机，不再适用取货前 5% 取消手续费。未使用租金与押金分别结算：一次性付清订单按未使用天数及订单记录的日租金核算；月付订单停止后续未发生期款，并按已付适用期次中未使用天数占该期天数的比例核算可退净租金，首期配送费及时段服务费不计入比例租金。已提供的服务、未清欠款及依法可收取的合理费用应逐项说明，可退金额不超过相应实际付款。设备故障或其他法定救济不受本段商业计算方式限制。</p>
<h2>五、押金、预授权与验机</h2>
<p>完成归还验机后 10 个营业日内安排退还可退押金或释放预授权。正常损耗不扣款；损坏、缺件、必要清洁或逾期费用应提供逐项金额及照片、报价或发票等依据，并扣除已收款或已抵扣金额。免押金不产生押金退款；SetupIntent 保存卡片本身没有押金款项可退或冻结额可释放。对验机或扣款有异议，可在订单提供的异议入口或通过邮件申请复核。</p>
<h2>六、设备或服务问题</h2>
<p>不可排除的消费者保障优先适用。重大问题或依法允许取消的其他情形，应提供适用退款、替换、修理或赔偿，不收个人原因取消手续费，不因超过商业申请时限或拒绝账户余额而拒绝法定退款。我们不能供货或因自身原因取消的，应退还相应已收款并释放未扣预授权。</p>
<h2>七、渠道、币种与时间</h2>
<p>退款原则上沿实际付款渠道处理；只有在您同意或依法允许时，才使用账户余额或其他替代方式。Stripe 信用卡退款需支付服务商确认；银行转账、支付宝及微信退款可能需人工核对收款账户并登记完成。余额退款记入账户；渠道不可直接退款的，请联系我们安排，不以技术限制剥夺法定退款。订单以 AUD 记账；人民币退款的币种及兑换汇率应明确告知，不保证退还时汇率与付款时一致。</p>
<p>我们通常在收到完整申请后 5 个营业日内回复；支付机构实际到账及预授权解除时间以其处理为准，信用卡退款通常另需 5 至 10 个营业日。存在未解决拒付时须先核对款项，避免同一付款重复退款；此安排不限制您的法定争议权。</p>
<h2>八、申请与争议</h2>
<p>请从订单页申请或联系 {company_email}，提供订单编号、退款原因及所需收款资料。请勿提交完整卡号、安全码或银行密码。退款结果应说明金额、扣款和渠道；如不认可，可依<a href="/complaints">《投诉与争议解决政策》</a>申请复核及外部协助。</p>
<h2>联系我们</h2>
<p>{company_name}（ABN {company_abn}）<br>地址：{company_address}<br>电话：{company_phone}<br>邮箱：{company_email}</p>')
ON CONFLICT(key) DO UPDATE SET value = excluded.value, deleted_at = NULL, updatedAt = CURRENT_TIMESTAMP;

INSERT INTO systemSettings (key, value) VALUES ('copyrightNoticeEn',
'<h1>Cancellation and Refund Policy</h1>
<p><strong>Version:</strong> {refund_policy_version}　<strong>Last updated:</strong> {refund_policy_last_updated_date}</p>
<p>This policy covers {company_name} cancellations, early returns, deposits and refunds. Cancellation fees differ from payment processing fees. Change-of-mind rules below do not apply to equipment faults, our inability to fulfil an order or statutory refund rights.</p>
<h2>1. Before order confirmation</h2>
<p>No cancellation fee applies before order confirmation. Unpaid orders have nothing to refund. Payments received are returned and uncaptured card holds are released without an additional cancellation fee. Confirmation means the order page and confirmation record show Confirmed or Awaiting pickup; it does not mean application submission or checking the refund request confirmation box.</p>
<h2>2. After confirmation and before actual pickup or delivery</h2>
<p>Change-of-mind cancellation carries a fee of 5% of the order total. The total includes rent, deposit, delivery and time-slot service fees after applicable discounts, excluding separately listed payment processing fees. For monthly plans the base is the whole order, not only the first instalment. The request page shows payments, holds, fees, expected refund and expected release for confirmation before review. Contact us if payments or available holds are insufficient to cover the fee; a negative refund is not promised.</p>
<p>Approval cancels the order and starts refund processing; submission does not mean completion. A hold may be captured only for the cancellation amount due with the rest released; releasing a hold is not a cash refund. A missed-pickup fee or another recovery of the same loss is not added to that cancellation.</p>
<h2>3. Missed pickup</h2>
<p>A store pickup not collected within 2 hours after the appointment start may be cancelled and the equipment released. An AUD 25 missed-pickup handling fee is deducted and the remainder refunded, without also charging the 5% cancellation fee. The store rule does not apply to delivery. Our failure to deliver or a statutory full refund does not attract that handling fee.</p>
<h2>4. Early return after handover</h2>
<p>After actual pickup or delivery, arrange return and inspection; the pre-handover 5% cancellation fee no longer applies. Unused rent and deposits are settled separately. Upfront orders use unused days and the recorded order daily rent. Monthly orders stop future unearned instalments and prorate refundable net rent for unused days in the applicable paid period, excluding first-period delivery and time-slot service fees from rent. Services supplied, outstanding debts and legally recoverable reasonable costs must be itemised. Refunds cannot exceed the relevant payments received. Statutory remedies for faults or other failures are not limited by these commercial calculations.</p>
<h2>5. Deposits, holds and inspection</h2>
<p>We arrange refundable deposit returns or hold releases within 10 business days after return inspection. Fair wear and tear is not charged. Damage, missing items, necessary cleaning or overdue charges require itemised evidence such as photos, quotes or invoices, less amounts already paid or applied. A waived deposit creates no deposit refund. A saved SetupIntent alone creates neither paid deposit nor hold to release. Request review of inspection findings or deductions through the available order dispute option or email.</p>
<h2>6. Equipment or service failures</h2>
<p>Non-excludable guarantees take priority. Major failures and other legally cancellable cases receive applicable refunds, replacement, repair or compensation without change-of-mind fees. Commercial time limits or refusal of account credit cannot remove statutory refunds. If we cannot supply or cancel for our own reasons, we return relevant payments and release uncaptured holds.</p>
<h2>7. Methods, currency and timing</h2>
<p>Refunds generally follow the actual payment channel. Account credit or another alternative requires your agreement or legal permission. Stripe refunds need provider confirmation; bank, Alipay and WeChat refunds may require manual account verification and completion. Balance refunds credit the account. Contact us if a channel cannot refund directly; technical limits do not remove statutory rights. Orders are recorded in AUD. The currency and conversion rate for an RMB refund must be disclosed; exchange rates may differ from payment.</p>
<p>We normally respond within 5 business days of a complete request. Actual settlement and hold release depend on the payment provider; card refunds commonly take another 5 to 10 business days. Open chargebacks require reconciliation to avoid duplicate recovery without restricting lawful dispute rights.</p>
<h2>8. Requests and disputes</h2>
<p>Apply on the order page or email {company_email} with the order number, reason and necessary refund account details. Never provide full card numbers, security codes or banking passwords. Outcomes should explain amounts, deductions and channels. See the <a href="/complaints">Complaints Policy</a> for review and external assistance.</p>
<h2>Contact us</h2>
<p>{company_name} (ABN {company_abn})<br>Address: {company_address}<br>Telephone: {company_phone}<br>Email: {company_email}</p>')
ON CONFLICT(key) DO UPDATE SET value = excluded.value, deleted_at = NULL, updatedAt = CURRENT_TIMESTAMP;

INSERT INTO systemSettings (key, value) VALUES ('privacyPolicy',
'<h1>隐私政策</h1>
<p><strong>版本：</strong>{privacy_policy_version}　<strong>最后更新：</strong>{privacy_policy_last_updated_date}</p>
<p>本政策说明 {company_name}（ABN {company_abn}）在提供网站、设备租赁、付款、设备管理、配送、客服、推荐及反馈服务时如何处理个人信息。我们按适用的澳大利亚隐私法律处理信息。</p>
<h2>一、收集的信息及来源</h2>
<ul>
<li>账户及联系资料：姓名、邮箱、电话、地址、账户凭据、账户类型及您主动提供的紧急联系人资料。提供他人资料前应获得适当授权。</li>
<li>身份核验资料：为核验所需的出生日期、证件类型、识别信息、核验状态和结果，仅在必要并向您说明的范围收集。</li>
<li>订单及财务记录：设备、租期、报价和折扣、付款计划、分期到期及扣款结果、押金及风险倍数、银行转账凭证、退款申请和账户资料、余额与佣金流水、发票及收据。</li>
<li>合同与交接记录：签约确认、电子签署时间、IP 和浏览器信息、合同快照与核验标识、取货二维码、实际交付和归还时间、验机结果、损坏照片、扣款证据及异议。</li>
<li>风险与推荐资料：历史付款失败、退款比例、逾期、未归还、损坏、扣款、身份核验及人工风险标记、评估分数和原因，推荐关系、资格、分成及奖励审核记录。</li>
<li>网站和安全信息：IP、浏览器、登录及操作日志、Cookie、语言偏好、Cloudflare Turnstile 验证及反欺诈信息。</li>
<li>设备管理信息（适用时）：设备在线、电源、硬件及系统清单、软件版本、电池、网络、粗略位置、租期事件及远程指令与结果。</li>
<li>客服及反馈：邮件、聊天、附件、投诉、反馈回答、Tally 回复标识及奖励处理记录；营销同意、退订、抑制名单、发送及退信记录。目前不通过本系统记录营销邮件打开或点击。</li>
</ul>
<p>上述信息来自您或授权人员的提交、网站和设备自动记录，以及支付、核验、配送、推荐或其他必要合作服务商。无法提供履约必需信息时，我们可能无法完成核验、租赁、交付或退款；自愿反馈及营销选择不影响基本租赁服务。</p>
<h2>二、使用目的与风险评估</h2>
<p>我们使用信息管理账户、核验身份、确认申请、订立合同、交付及回收设备、安排付款分期和退款、验机及押金结算、管理推荐及反馈奖励、提供支持、保障安全，以及履行税务、会计、监管或合法争议处理义务。</p>
<p>风险评估结合身份核验、履约及付款等记录，可能自动影响新订单押金、一次性付清的免押金资格、推荐奖励审核或自助下单权限，不属于向您提供外部信用报告。合法退款或争议本身不是违法认定；因历史记录或风险标记导致的错误、争议或不当影响，可通过 {company_email} 请求说明、资料更正和人工复核。后续风险评分变化不自动上调已确认订单押金。</p>
<h2>三、支付信息与第三方披露</h2>
<p>支付卡资料由 Stripe、Square 等相应支付服务商处理，本网站不保存完整卡号、有效期或安全码，但会保存处理付款所需的客户、支付方式、预授权、SetupIntent、交易及退款标识，以及结果和金额。银行退款会使用您提供的 BSB、账号及账户名；人民币付款会使用相应凭证、金额和核验记录。</p>
<p>在服务所需范围内，接收方包括 Cloudflare 托管和安全服务、支付和银行服务、Resend、Brevo、SendGrid 或配置的 SMTP 邮件服务、Cloudinary 图片托管、配送及地址或地图服务、维修与设备管理服务、tawk.to 客服、Tally 问卷，以及下述翻译服务。专业顾问、保险人或依法有权机关也可能在必要范围接收信息。我们不出售个人信息供第三方自行营销。</p>
<h2>四、图片、扫码与交付资料</h2>
<p>付款凭证、损坏及验机照片可提交外部 HTTPS 链接，或在启用图片上传时由 Cloudinary 托管，图片可能添加上传日期和标识水印。持有链接的人员及托管服务商可能访问信息，请遮盖不必要的证件号、卡号和他人资料。员工扫码在主动点击并授予浏览器相机权限后启动，扫码内容用于查找和核验订单；当前扫码流程不向本网站上传或保存相机视频。设备交付和回收合作方仅接收完成预约及交接所需资料。</p>
<h2>五、翻译与缓存</h2>
<p>当启用翻译并在英文模式加载标记为可翻译的公开内容时，待翻译文本及源语言、目标语言可能发送至配置的 DeepL 或 Google 翻译 API。本网站会保存原文、译文、服务商、语言、字节用量及时间作为共享翻译缓存和用量记录。当前自动翻译仅针对明确标记的公开内容，不自动扫描账户表单、合同、付款资料或整页私人信息。原文及译文不应包含不必要的个人或敏感资料；如发现误收集，可联系我们处理。协议英文版本单独维护，机器翻译不代替正式确认。</p>
<h2>六、在线客服与问卷</h2>
<p>tawk.to 组件加载后，可能处理聊天内容、您填写的姓名或邮箱、页面、IP、浏览器、设备及其 Cookie 或浏览器存储信息，并可能在美国或其他境外地点处理。具体见其<a href="https://www.tawk.to/privacy-policy/">隐私政策</a>和<a href="https://help.tawk.to/article/what-are-tawkto-cookies-and-what-do-they-do">Cookie 说明</a>。聊天记录按账户设置及服务政策保留；不想使用在线客服时可邮件联系。</p>
<p>Tally 问卷在您打开或填写时按其隐私政策处理回答和技术信息；活动奖励按适用规则处理。请勿在聊天、问卷、图片或翻译请求中提交密码、完整支付卡或无必要的身份证件。</p>
<h2>七、境外处理</h2>
<p>上述服务商及分包商可能在澳大利亚境外处理信息，包括美国、欧洲及其服务所在的其他国家或地区，具体地点取决于实际服务商和配置。我们会在适用法律要求范围内采取合理措施，包括核查处理地点、安全安排及合同保障；您可联系我们了解当前接收方及已知处理国家。使用网站不等于放弃适用的跨境隐私保护。</p>
<h2>八、营销与服务通知</h2>
<p>营销信息只在取得适用同意或法律允许时发送，注明发件人并提供退订。退订营销不停止订单、付款失败、取还提醒、退款、协议更新及安全等必要服务通知。自愿问卷和奖励不以接受无关营销为条件。</p>
<h2>九、保留、删除与安全</h2>
<p>仅在业务目的或法律、争议、安全所需期限内保存信息。当前典型设置为合同及财务记录 7 年、核验记录 365 天、设备日志 18 个月、推荐及优惠记录 3 年、客服记录 2 年、长期未活跃客户资料 3 年、审计记录 7 年，具体受法律及实际配置影响。后台删除可能先隐藏或软删除，未必立即从备份、财务记录或第三方系统删除。翻译缓存目前没有固定自动到期日，按使用需要和删除请求管理；第三方记录按其政策及我们的配置保留。</p>
<p>我们采取访问控制、加密传输、必要凭据加密及审计等合理措施。合同快照和付款证据可能因法定义务或争议继续保留；不再需要时应删除或去标识化。不存在绝对安全保证；发生适用的可通报泄露时，按法律要求评估、补救和通知。</p>
<h2>十、访问、更正与投诉</h2>
<p>您可通过 {company_email} 请求查阅、更正或在适用时删除资料，询问信息用途、风险评估和境外接收方。我们可能为核实身份索取必要资料，通常在 30 天内回复访问或更正请求；不能删除或提供时会说明理由及投诉渠道。隐私投诉可先要求管理层复核；仍有异议可向<a href="https://www.oaic.gov.au/">澳大利亚信息专员办公室（OAIC）</a>投诉。政策更新会公布版本和日期，重大变化在适当情况下另行通知。Cookie 详情见<a href="/cookies">《Cookie 政策》</a>。</p>
<h2>联系我们</h2>
<p>{company_name}（ABN {company_abn}）<br>地址：{company_address}<br>电话：{company_phone}<br>邮箱：{company_email}</p>')
ON CONFLICT(key) DO UPDATE SET value = excluded.value, deleted_at = NULL, updatedAt = CURRENT_TIMESTAMP;

INSERT INTO systemSettings (key, value) VALUES ('privacyPolicyEn',
'<h1>Privacy Policy</h1>
<p><strong>Version:</strong> {privacy_policy_version}　<strong>Last updated:</strong> {privacy_policy_last_updated_date}</p>
<p>This policy explains how {company_name} (ABN {company_abn}) handles personal information for the website, rentals, payments, device management, delivery, support, referrals and feedback under applicable Australian privacy law.</p>
<h2>1. Information and sources</h2>
<ul>
<li>Account and contact details: name, email, phone, address, credentials, account type and emergency contact information you supply with appropriate authority.</li>
<li>Identity checks: necessary birth date, document type, identifying information, verification status and results, collected only as necessary and explained.</li>
<li>Orders and finances: devices, dates, quotes and discounts, payment plans, due dates and charge results, deposits and risk multipliers, transfer evidence, refund applications and accounts, balances, commissions, invoices and receipts.</li>
<li>Contracts and handovers: confirmations, electronic signing time, IP and browser, snapshots and verification identifiers, pickup QR codes, actual handover and return times, inspections, damage images, deduction evidence and disputes.</li>
<li>Risk and referrals: failed payments, refund ratios, overdue or missing returns, damage, deductions, verification, manual risk flags, scores and reasons, referral links, eligibility, commissions and reward reviews.</li>
<li>Website security: IP, browser, login and activity logs, cookies, language preferences, Cloudflare Turnstile and anti-fraud information.</li>
<li>Device management where applicable: online and power status, hardware and system inventory, software versions, battery, network, approximate location, rental events, remote commands and results.</li>
<li>Support and feedback: emails, chats, attachments, complaints, survey answers, Tally response identifiers and reward records; marketing consent, opt-outs, suppression, delivery and bounce records. This system does not currently track marketing email opens or clicks.</li>
</ul>
<p>Sources include you or authorised people, website and device logs and necessary payment, verification, delivery, referral or other partners. Missing essential information may prevent verification, rental, delivery or refunds. Voluntary feedback and marketing choices do not affect basic rental services.</p>
<h2>2. Purposes and risk assessment</h2>
<p>We use information for accounts, identity checks, applications, contracts, delivery and recovery, instalments and refunds, inspections and deposit settlement, referrals and feedback rewards, support, security and legal, tax, accounting, regulatory or legitimate dispute obligations.</p>
<p>Risk assessments combine identity, performance and payment records and may automatically affect new deposits, upfront deposit waivers, reward reviews or self-service access. They are not external credit reports. Lawful refunds or disputes are not findings of misconduct. Contact {company_email} for explanation, correction and human review of errors, disputes or inappropriate effects. Later risk scores do not automatically increase confirmed deposits.</p>
<h2>3. Payments and third-party disclosures</h2>
<p>Stripe, Square or the relevant provider handles card data. We do not store full card numbers, expiry dates or security codes. We store necessary customer, method, hold, SetupIntent, payment and refund identifiers, results and amounts. Bank refunds use supplied BSB, account number and name. RMB payments use evidence, amounts and verification records.</p>
<p>Necessary recipients may include Cloudflare hosting and security, payment and bank services, Resend, Brevo, SendGrid or configured SMTP email, Cloudinary image hosting, delivery and address or map services, repair and device management, tawk.to chat, Tally surveys and translation providers described below. Advisers, insurers and legally authorised bodies may receive necessary information. We do not sell personal information for independent third-party marketing.</p>
<h2>4. Images, scanning and delivery</h2>
<p>Payment, damage and inspection images may use external HTTPS links or enabled Cloudinary uploads, with date and identifier watermarks. Link holders and hosting providers may access images. Redact unnecessary identity, card and third-party information. Staff scanning starts after an active click and camera permission; decoded content locates and verifies orders. The current flow does not upload or store camera video on this website. Delivery and recovery partners receive only necessary booking and handover information.</p>
<h2>5. Translation and caching</h2>
<p>When translation is enabled and marked public content loads in English mode, text and source and target languages may be sent to configured DeepL or Google translation APIs. We store source text, translations, provider, languages, byte usage and timestamps in a shared cache and usage records. Automatic translation targets only explicitly marked public content; it does not scan account forms, contracts, payment details or entire private pages. Avoid unnecessary personal or sensitive information in source or translated content and contact us about accidental collection. English agreements are maintained separately; machine translation does not replace formal confirmation.</p>
<h2>6. Chat and surveys</h2>
<p>Loaded tawk.to components may process chats, supplied names or email, pages, IP, browser, device and cookies or browser storage, including in the United States or other overseas locations. See its <a href="https://www.tawk.to/privacy-policy/">Privacy Policy</a> and <a href="https://help.tawk.to/article/what-are-tawkto-cookies-and-what-do-they-do">cookie information</a>. Retention follows account settings and service policies. Email us instead if you prefer.</p>
<p>Tally processes survey answers and technical information under its policies when you open or complete forms. Rewards follow applicable campaign rules. Do not provide passwords, complete card details or unnecessary identity documents through chats, surveys, images or translation requests.</p>
<h2>7. Overseas processing</h2>
<p>Providers and subprocessors may process information outside Australia, including the United States, Europe and other service locations depending on provider and configuration. We take reasonable steps required by applicable law, including checking locations, security and contractual safeguards. Ask us about current recipients and known countries. Website use does not waive applicable cross-border privacy protections.</p>
<h2>8. Marketing and service notices</h2>
<p>Marketing requires applicable consent or legal permission, identifies the sender and provides unsubscribe options. Opting out does not stop necessary order, payment failure, pickup or return, refund, agreement update and security notices. Voluntary surveys and rewards do not require unrelated marketing consent.</p>
<h2>9. Retention, deletion and security</h2>
<p>We retain information only for necessary business, legal, dispute or security purposes. Typical current settings are 7 years for contract and financial records, 365 days for verification, 18 months for device logs, 3 years for referrals and coupons, 2 years for support, 3 years for inactive customer profiles and 7 years for audits, subject to law and actual settings. Administrative deletion may initially hide or soft-delete records without immediately removing backups, finance records or third-party copies. Translation caches currently have no fixed automatic expiry and are managed according to need and deletion requests. Third-party retention follows their policies and our settings.</p>
<p>Reasonable measures include access controls, encrypted transmission, necessary credential encryption and audit records. Snapshots and evidence may remain for legal obligations or disputes; unnecessary records should be deleted or de-identified. Security is not absolute. Applicable notifiable breaches are assessed, remedied and notified as legally required.</p>
<h2>10. Access, correction and complaints</h2>
<p>Email {company_email} to request access, correction, applicable deletion or information about uses, assessments and overseas recipients. Necessary identity checks may apply. We normally respond to access or correction requests within 30 days and explain refusals and complaint options. Seek management review or complain to the <a href="https://www.oaic.gov.au/">OAIC</a> if unresolved. Updates state a version and date, with separate notice for material changes where appropriate. See the <a href="/cookies">Cookie Policy</a>.</p>
<h2>Contact us</h2>
<p>{company_name} (ABN {company_abn})<br>Address: {company_address}<br>Telephone: {company_phone}<br>Email: {company_email}</p>')
ON CONFLICT(key) DO UPDATE SET value = excluded.value, deleted_at = NULL, updatedAt = CURRENT_TIMESTAMP;

INSERT INTO systemSettings (key, value) VALUES ('cookiePolicy',
'<h1>Cookie 政策</h1>
<p><strong>版本：</strong>{cookie_policy_version}　<strong>最后更新：</strong>{cookie_policy_last_updated_date}</p>
<p>{company_name} 使用 Cookie 和 localStorage、sessionStorage 等浏览器技术维持登录、安全及界面功能，信息处理应与《隐私政策》一并阅读。</p>
<h2>一、登录与安全</h2>
<p><code>session</code> Cookie 通常在 12 小时后失效，选择“记住我”时最长 30 天，使用 HttpOnly 并在 HTTPS 下使用 Secure 属性。Cloudflare 和 Turnstile 可能使用临时令牌、Cookie 或浏览器信息进行安全验证、防止欺诈及滥用。阻止必要存储可能导致无法登录、签约或付款。</p>
<h2>二、推荐与界面偏好</h2>
<p><code>referral_code</code> 最长保存 30 天，用于推荐归属。浏览器本地或会话存储还可能保存中英文语言选择、通知已读和界面偏好；本地存储可能保留到您清除为止，会话存储通常在会话结束时清除。切换英文可能触发公开内容翻译请求，服务端另行保存原文及译文缓存，不属于浏览器 Cookie；处理详情见《隐私政策》。</p>
<h2>三、在线客服、问卷与支付</h2>
<p>tawk.to 加载后可能使用 <code>tawk_uuid_*</code>、<code>twk_idm_key</code>、<code>twk_token_*</code>、<code>TawkConnectionTime</code> 等 Cookie 或存储以识别访客和保持连接，部分访客标识最长可达 6 个月，实际名称及期限依版本和配置而定。其说明见<a href="https://help.tawk.to/article/what-are-tawkto-cookies-and-what-do-they-do">官方 Cookie 文档</a>；若启用了客服同意选项，以页面所显示选项为准，未启用时组件加载可能设置存储。</p>
<p>打开 Tally 问卷、Stripe 或其他支付组件时，相应服务商可能使用自己的 Cookie 或存储完成问卷、支付、身份验证和反欺诈，受其政策及配置约束。不使用问卷或客服不影响基本租赁权利。</p>
<h2>四、扫码、图片与跟踪</h2>
<p>浏览器相机授权用于员工主动扫码，与 Cookie 权限不同，可在浏览器设置撤回。外部图片、扫码脚本或组件加载可能向托管服务商发送 IP、浏览器和请求信息。目前未主动部署独立广告像素或通过本系统记录营销邮件打开和点击；第三方功能仍可能产生其自己的技术标识和日志。</p>
<h2>五、管理与更新</h2>
<p>您可在浏览器查看、阻止或清除 Cookie 及本地存储，使用可用的第三方同意选项。删除推荐 Cookie 可能影响推荐归属；删除浏览器存储不等于删除账户、付款或客服记录。访问、更正或删除请求请联系 {company_email}。政策变化会公布版本和日期。</p>
<h2>联系我们</h2>
<p>{company_name}（ABN {company_abn}）<br>地址：{company_address}<br>电话：{company_phone}<br>邮箱：{company_email}</p>')
ON CONFLICT(key) DO UPDATE SET value = excluded.value, deleted_at = NULL, updatedAt = CURRENT_TIMESTAMP;

INSERT INTO systemSettings (key, value) VALUES ('cookiePolicyEn',
'<h1>Cookie Policy</h1>
<p><strong>Version:</strong> {cookie_policy_version}　<strong>Last updated:</strong> {cookie_policy_last_updated_date}</p>
<p>{company_name} uses cookies, localStorage, sessionStorage and similar technologies for login, security and interface functions. Read this with the Privacy Policy.</p>
<h2>1. Login and security</h2>
<p>The <code>session</code> cookie usually expires after 12 hours, or up to 30 days with Remember me. It uses HttpOnly and Secure on HTTPS. Cloudflare and Turnstile may use temporary tokens, cookies or browser information for verification, fraud prevention and abuse protection. Blocking necessary storage may prevent login, signing or payment.</p>
<h2>2. Referrals and preferences</h2>
<p><code>referral_code</code> lasts up to 30 days for attribution. Local or session storage may remember Chinese or English, read notices and interface preferences. Local storage may remain until cleared; session storage normally ends with the session. English mode may trigger public-content translation requests. Server-side source and translation caches are separate from browser cookies; see the Privacy Policy.</p>
<h2>3. Chat, surveys and payments</h2>
<p>Loaded tawk.to may use <code>tawk_uuid_*</code>, <code>twk_idm_key</code>, <code>twk_token_*</code>, <code>TawkConnectionTime</code> and similar storage for visitor identification and connections. Some visitor identifiers may last up to 6 months; names and periods depend on versions and settings. See the <a href="https://help.tawk.to/article/what-are-tawkto-cookies-and-what-do-they-do">official cookie information</a>. Use displayed consent options where configured; otherwise loading may set storage.</p>
<p>Tally, Stripe and other payment components may use their own storage for surveys, payments, verification and fraud prevention under their policies and settings. Declining surveys or chat does not affect basic rental rights.</p>
<h2>4. Scanning, images and tracking</h2>
<p>Staff camera permission for active scanning is separate from cookies and can be revoked in browser settings. External images, scanner scripts or components may send IP, browser and request information to hosts. We currently do not actively deploy standalone advertising pixels or use this system to track marketing email opens and clicks. Third-party functions may still create their own identifiers and logs.</p>
<h2>5. Controls and updates</h2>
<p>Review, block or clear cookies and local storage through your browser and use available provider consent settings. Deleting referral cookies may affect attribution. Clearing storage does not delete account, payment or chat records. Email {company_email} for access, correction or deletion. Updates state a version and date.</p>
<h2>Contact us</h2>
<p>{company_name} (ABN {company_abn})<br>Address: {company_address}<br>Telephone: {company_phone}<br>Email: {company_email}</p>')
ON CONFLICT(key) DO UPDATE SET value = excluded.value, deleted_at = NULL, updatedAt = CURRENT_TIMESTAMP;

INSERT INTO systemSettings (key, value) VALUES ('softwareTerms',
'<h1>软件使用协议</h1>
<p><strong>版本：</strong>{software_terms_version}　<strong>最后更新：</strong>{software_terms_last_updated_date}</p>
<p>本协议适用于 {company_name} 随出租设备提供的管理软件及设备连接服务，并与设备租赁协议和《隐私政策》一并适用。</p>
<h2>一、许可及限制</h2>
<p>您在租期内获有限、非独占、不可转让的授权，在所租设备使用本软件。不得擅自复制、分发、再许可、绕过管理或安全机制，亦不得非法反向工程；法律明确允许的互操作性、研究或其他例外不受本条排除。设备归还或租赁终止后，应停止使用租赁授权并配合合法解除账户或软件连接。</p>
<h2>二、设备与账户资料</h2>
<p>软件可能上报在线和开机状态、硬件及系统清单、版本、电池、网络、粗略位置、租期与安全事件，记录管理指令和执行结果，用于交付、支持、租期管理和资产安全。设备账户配置可能使用您提供的设备用户名及必要凭据；相关凭据只在授权的配置或支持范围使用，并按《隐私政策》保护。网站月付计划、风险评估和翻译不授予对个人文件、聊天或输入内容进行无差别监控的权利。</p>
<h2>三、远程操作与数据清除</h2>
<p>在经通知仍逾期未归还、存在有依据的盗用或欺诈风险、重大设备安全事件或法律要求时，可依法执行必要且相称的锁定、重启、注销或重置操作。合理可行时应先说明原因，给予补救、提出异议和备份机会；紧急安全或法律要求除外。付款失败、风险评分或退款争议本身不授予无限制清除数据的权利。</p>
<p><strong>重置或数据清除会删除设备上的用户数据。</strong>请定期备份，并在归还前退出个人账户及移除个人资料。归还后为重新出租进行的重置不等于网站账户和合同记录同步删除。我们不排除因自身过错或法律规定应承担的数据保护责任。</p>
<h2>四、更新、连接与租期</h2>
<p>软件可能检查并安装安全或功能更新。请勿故意断开必要管理连接、篡改设备时间或绕过锁定。故障或合理离线应及时联系支持，不直接视为违约。设备管理显示不代替订单确认、付款计划或续租同意；月付款项支付成功不自动延长租期。</p>
<h2>五、消费者保障及争议</h2>
<p>软件及相关服务的不可排除消费者保障仍然适用，包括合理谨慎与技能以及法定修理、更换、退款或赔偿。不得通过本协议免除依法不可免除的责任。您可对远程操作、数据处理或错误租期提出复核，联系 {company_email} 或按《投诉与争议解决政策》处理。</p>
<h2>六、法律与更新</h2>
<p>适用维多利亚州法律及法院非专属管辖，不影响其他法定争议渠道。更新会注明版本及日期，重大权限或信息用途变化应依法通知并在需要时另行取得同意，不追溯扩大已签订单授权。</p>
<h2>联系我们</h2>
<p>{company_name}（ABN {company_abn}）<br>地址：{company_address}<br>电话：{company_phone}<br>邮箱：{company_email}</p>')
ON CONFLICT(key) DO UPDATE SET value = excluded.value, deleted_at = NULL, updatedAt = CURRENT_TIMESTAMP;

INSERT INTO systemSettings (key, value) VALUES ('softwareTermsEn',
'<h1>Software Terms</h1>
<p><strong>Version:</strong> {software_terms_version}　<strong>Last updated:</strong> {software_terms_last_updated_date}</p>
<p>These terms cover management software and device connections supplied with equipment by {company_name}, together with the Rental Agreement and Privacy Policy.</p>
<h2>1. Licence and restrictions</h2>
<p>You receive a limited, non-exclusive, non-transferable licence on the rented device during the term. Unauthorised copying, distribution, sublicensing, bypassing management or security and unlawful reverse engineering are prohibited. Statutory interoperability, research or other exceptions remain. After return or termination, stop using rental authorisations and cooperate with lawful account or software disconnection.</p>
<h2>2. Device and account information</h2>
<p>The software may report online and power status, hardware and system inventory, versions, battery, network, approximate location, rental and security events, commands and results for handover, support, rental administration and asset security. Device account setup may use supplied device usernames and necessary credentials only within authorised setup or support and with Privacy Policy safeguards. Website instalments, risk assessment and translation do not grant indiscriminate monitoring rights over personal files, chats or typing.</p>
<h2>3. Remote operations and erasure</h2>
<p>Necessary and proportionate lawful locking, restart, sign-out or reset may occur for non-return after notice, evidenced theft or fraud risk, serious device security events or legal requirements. Where reasonably practicable, explain the reason and allow remedy, dispute and backup first, except for urgent safety or legal requirements. A failed payment, risk score or refund dispute alone does not grant unlimited data-erasure rights.</p>
<p><strong>Resetting or erasure deletes device user data.</strong> Back up regularly and sign out and remove personal information before return. A reset for re-rental does not delete website accounts or contract records. Liability for our own fault or mandatory data protection obligations is not excluded.</p>
<h2>4. Updates, connections and term</h2>
<p>Software may check and install security or functional updates. Do not deliberately disable necessary management connections, alter the clock to evade controls or bypass locks. Report faults or reasonable offline periods; they are not automatically breaches. Device displays do not replace order confirmation, payment schedules or extension agreement. A successful instalment does not automatically extend the rental.</p>
<h2>5. Guarantees and disputes</h2>
<p>Non-excludable guarantees remain, including due care and skill and applicable repair, replacement, refund or compensation. Mandatory liabilities cannot be excluded. Ask for review of remote operations, data handling or incorrect rental dates at {company_email} or under the Complaints Policy.</p>
<h2>6. Law and updates</h2>
<p>Victorian law and non-exclusive court jurisdiction apply without removing other lawful channels. Updates state a version and date. Material changes to permissions or information uses require notice and further consent where legally required, without retrospectively expanding signed order authorisations.</p>
<h2>Contact us</h2>
<p>{company_name} (ABN {company_abn})<br>Address: {company_address}<br>Telephone: {company_phone}<br>Email: {company_email}</p>')
ON CONFLICT(key) DO UPDATE SET value = excluded.value, deleted_at = NULL, updatedAt = CURRENT_TIMESTAMP;

INSERT INTO systemSettings (key, value) VALUES ('complaintsPolicy',
'<h1>投诉与争议解决政策</h1>
<p><strong>版本：</strong>{complaints_policy_version}　<strong>最后更新：</strong>{complaints_policy_last_updated_date}</p>
<p>{company_name} 接受有关申请、付款、月付扣款、押金、验机、归还、推荐奖励、设备管理、翻译和隐私的投诉。本政策不限制法定权利。</p>
<h2>一、提出投诉</h2>
<p>请联系 {company_email} 或 {company_phone}，提供订单或交易编号、事情经过、争议金额、相关证据及期望结果。订单提供验机或扣款异议入口时也可直接提交。不要提供完整支付卡、安全码、密码或不必要的身份证件。</p>
<h2>二、处理与时限</h2>
<p>我们在收到投诉后 3 个工作日内确认，通常在 15 个工作日内书面说明结论、依据和补救；复杂事项会告知预计时间和进度。访问或更正个人信息的请求通常在 30 天内回复。您可要求管理层或适当人员复核，特别是风险资料错误、押金倍数、推荐奖励审核或自动扣款争议。</p>
<h2>三、费用和记录核对</h2>
<p>我们会核对订单是否已确认、实际交付和归还时间、付款计划、预授权或实收、已退金额和验机证据。订单确认前取消不收取消手续费；确认后、取货前个人原因取消的 5% 手续费应列明计算基数。未取货 AUD 25 操作费不得与同一次取消的 5% 重复收取；同一逾期或损坏费用不重复从押金及其他付款收取。涉及错误或未经授权的扣款，应及时核查和纠正。正常行使退款、隐私或消费者权利本身不构成欺诈或违约。</p>
<h2>四、付款争议与服务</h2>
<p>请及时指出争议部分并保留订单、凭证和通信记录。提出争议不表示无争议且已到期款项自动免除，但我们不会以无限额扣款、惩罚性收费或任意数据清除替代争议处理。存在银行拒付时，会核对相关款项以避免重复退款；不妨碍您联系银行或行使法定救济。</p>
<h2>五、外部协助</h2>
<p>如无法解决，您可向所在州或领地的消费者机构求助，例如<a href="https://www.consumer.vic.gov.au/">维多利亚州消费者事务局</a>；依法可向<a href="https://www.vcat.vic.gov.au/">维多利亚州民事和行政仲裁庭（VCAT）</a>或有管辖权法院提出申请。隐私问题可向<a href="https://www.oaic.gov.au/">OAIC</a>投诉；系统性消费者问题可向<a href="https://www.accc.gov.au/">ACCC</a>报告，ACCC 不代为解决个别合同纠纷。以上不要求您必须完成内部流程后才行使依法可立即主张的权利。</p>
<h2>联系我们</h2>
<p>{company_name}（ABN {company_abn}）<br>地址：{company_address}<br>电话：{company_phone}<br>邮箱：{company_email}</p>')
ON CONFLICT(key) DO UPDATE SET value = excluded.value, deleted_at = NULL, updatedAt = CURRENT_TIMESTAMP;

INSERT INTO systemSettings (key, value) VALUES ('complaintsPolicyEn',
'<h1>Complaints and Dispute Resolution Policy</h1>
<p><strong>Version:</strong> {complaints_policy_version}　<strong>Last updated:</strong> {complaints_policy_last_updated_date}</p>
<p>{company_name} accepts complaints about applications, payments, instalments, deposits, inspections, returns, referrals, device management, translation and privacy. Statutory rights remain.</p>
<h2>1. Making a complaint</h2>
<p>Contact {company_email} or {company_phone} with the order or transaction number, events, disputed amount, evidence and desired result. Use the order inspection or deduction dispute option where available. Do not supply full card details, security codes, passwords or unnecessary identity documents.</p>
<h2>2. Handling and timing</h2>
<p>We acknowledge within 3 business days and normally give a written outcome, reasons and remedies within 15 business days. Complex matters receive timing and progress updates. Access or correction requests normally receive a response within 30 days. Request management or appropriate human review, including for incorrect risk data, deposit multipliers, referral reviews or automatic charges.</p>
<h2>3. Checking charges and records</h2>
<p>We check confirmation, actual handover and return times, schedules, holds versus captured funds, refunds and inspection evidence. Pre-confirmation cancellation has no cancellation fee. A post-confirmation, pre-pickup change-of-mind 5% fee must disclose its base. An AUD 25 missed-pickup fee is not combined with that 5% fee for the same cancellation. The same overdue or damage amount cannot be recovered from both deposits and other payments. Incorrect or unauthorised charges require prompt investigation and correction. Exercising refund, privacy or consumer rights is not itself fraud or breach.</p>
<h2>4. Payment disputes and service</h2>
<p>Identify disputed amounts promptly and keep orders, evidence and communications. A dispute does not automatically forgive undisputed due debts. Unlimited charging, punitive fees or arbitrary erasure cannot replace dispute handling. Chargebacks require reconciliation to avoid duplicate refunds without preventing bank contact or statutory remedies.</p>
<h2>5. External assistance</h2>
<p>Contact your state or territory consumer body, such as <a href="https://www.consumer.vic.gov.au/">Consumer Affairs Victoria</a>. Where available, apply to <a href="https://www.vcat.vic.gov.au/">VCAT</a> or a competent court. Complain to the <a href="https://www.oaic.gov.au/">OAIC</a> about privacy or report systemic consumer issues to the <a href="https://www.accc.gov.au/">ACCC</a>, which does not resolve individual contract disputes. Internal review is not a prerequisite to rights that may legally be exercised immediately.</p>
<h2>Contact us</h2>
<p>{company_name} (ABN {company_abn})<br>Address: {company_address}<br>Telephone: {company_phone}<br>Email: {company_email}</p>')
ON CONFLICT(key) DO UPDATE SET value = excluded.value, deleted_at = NULL, updatedAt = CURRENT_TIMESTAMP;

INSERT INTO systemSettings (key, value) VALUES ('acceptableUsePolicy',
'<h1>可接受使用政策</h1>
<p><strong>版本：</strong>{acceptable_use_policy_version}　<strong>最后更新：</strong>{acceptable_use_policy_last_updated_date}</p>
<p>本政策适用于 {company_name} 的网站、租赁设备、管理软件、自助链接、二维码、优惠及奖励功能。</p>
<h2>一、允许用途与保管</h2>
<p>设备可在约定租期内作合法个人或商业用途。请妥善保管设备、配件和账户，及时更新安全补丁；未经书面同意不得转租、转借、出售、抵押或将设备带离澳大利亚。取货二维码、签约及退款链接只供本人或适当授权人员使用。</p>
<h2>二、禁止行为</h2>
<ul><li>违法活动、侵权、欺诈、传播非法内容、垃圾邮件、网络攻击、恶意程序或勒索。</li><li>加密货币挖矿或造成异常损耗、供电和散热风险的作业；正常且符合设备约定用途的工作不因此受限。</li><li>擅自拆改硬件，移除资产标识，绕过设备管理、安全限制、付款或身份核验。</li><li>伪造转账、退款、验机或损坏证据，冒用支付方式或提交无权使用的收款账户。</li><li>通过虚假身份、重复账户、自我推荐、循环推荐或虚假反馈获取优惠、分成或奖励。</li><li>探测他人订单、分享未授权合同核验数据、滥用扫码、批量抓取、翻译 API 或其他接口，绕过限流或访问控制。</li></ul>
<h2>三、信息与备份</h2>
<p>上传图片或提交文本前应删除不必要个人资料，确保有权提交第三方信息。不要把密码、完整卡号、安全码或无必要身份证件放入聊天、问卷、图片及翻译请求。请备份个人文件，归还前退出账户并清除资料；设备归还后可能重置，数据处理仍受《隐私政策》及不可排除法律责任约束。</p>
<h2>四、处置与复核</h2>
<p>有依据的滥用可导致必要且适度的访问限制、人工审核、奖励暂停或撤销、租赁终止及依法追偿合理损失。远程操作须符合《软件使用协议》，不得将一项风险评分视为任意清除数据的许可。合理可行时应通知原因及补救机会；紧急安全或法律要求除外。可联系我们要求复核；正常退款、投诉或行使法定权利不构成违反本政策。</p>
<h2>五、举报与权利</h2>
<p>发现设备遗失、账户或链接泄露、凭证冒用或其他滥用，请及时联系 {company_email}。本政策不限制依法允许的软件例外、消费者保障及其他不可排除权利。重大变更应依法通知，涉及既有订单实质义务的另行取得同意。</p>
<h2>联系我们</h2>
<p>{company_name}（ABN {company_abn}）<br>地址：{company_address}<br>电话：{company_phone}<br>邮箱：{company_email}</p>')
ON CONFLICT(key) DO UPDATE SET value = excluded.value, deleted_at = NULL, updatedAt = CURRENT_TIMESTAMP;

INSERT INTO systemSettings (key, value) VALUES ('acceptableUsePolicyEn',
'<h1>Acceptable Use Policy</h1>
<p><strong>Version:</strong> {acceptable_use_policy_version}　<strong>Last updated:</strong> {acceptable_use_policy_last_updated_date}</p>
<p>This policy applies to the {company_name} website, rented equipment, software, self-service links, QR codes, discounts and rewards.</p>
<h2>1. Permitted use and care</h2>
<p>Use equipment for lawful personal or business purposes during the agreed term. Protect equipment, accessories and accounts and maintain security updates. No subletting, lending, sale, security interest or removal from Australia without written consent. Pickup QR codes, signing and refund links are for you or appropriately authorised people only.</p>
<h2>2. Prohibited conduct</h2>
<ul><li>Unlawful activity, infringement, fraud, illegal content, spam, network attacks, malware or extortion.</li><li>Cryptocurrency mining or work causing abnormal wear, power or thermal risks; normal agreed equipment use is not restricted merely by this rule.</li><li>Unauthorised hardware changes, removing asset labels or bypassing management, security, payments or verification.</li><li>Falsifying payment, refund, inspection or damage evidence, using unauthorised payment methods or refund accounts.</li><li>False identities, duplicate accounts, self-referrals, circular referrals or false feedback to obtain discounts, commissions or rewards.</li><li>Probing other orders, sharing unauthorised verification data, abusing scanning, scraping, translation APIs or other endpoints, or bypassing rate limits or access controls.</li></ul>
<h2>3. Information and backups</h2>
<p>Remove unnecessary personal information from images and text and ensure authority to submit third-party data. Do not include passwords, full card numbers, security codes or unnecessary identity documents in chats, surveys, images or translation requests. Back up files, sign out and remove personal data before return. Returned equipment may be reset, subject to the Privacy Policy and mandatory liabilities.</p>
<h2>4. Measures and review</h2>
<p>Evidenced abuse may result in necessary, proportionate access limits, human review, reward suspension or reversal, termination and lawful recovery of reasonable losses. Remote operations must comply with Software Terms; a score does not authorise arbitrary erasure. Explain reasons and remedy options where reasonably practicable, except for urgent safety or legal requirements. Request review by contacting us. Lawful refunds, complaints and statutory rights are not policy breaches.</p>
<h2>5. Reporting and rights</h2>
<p>Promptly report loss, compromised accounts or links, evidence misuse or other abuse to {company_email}. Statutory software exceptions, guarantees and other non-excludable rights remain. Material changes require legal notice and further agreement for material existing order obligations.</p>
<h2>Contact us</h2>
<p>{company_name} (ABN {company_abn})<br>Address: {company_address}<br>Telephone: {company_phone}<br>Email: {company_email}</p>')
ON CONFLICT(key) DO UPDATE SET value = excluded.value, deleted_at = NULL, updatedAt = CURRENT_TIMESTAMP;

INSERT INTO systemSettings (key, value) VALUES ('consumerRights',
'<h1>澳大利亚消费者法下的权利</h1>
<p><strong>版本：</strong>{consumer_rights_version}　<strong>最后更新：</strong>{consumer_rights_last_updated_date}</p>
<p>本页概述您向 {company_name} 租赁设备及使用相关服务时的消费者保障。法律规定优先于任何协议、付款计划、优惠或退款页面；本页不取代法律条文。</p>
<h2>一、租赁设备与服务的保障</h2>
<p>在《澳大利亚消费者法》适用时，设备应质量可接受、符合描述及已告知的特定用途；服务应以合理谨慎和技能提供，并在未约定期限时于合理时间完成。租期内享有安宁占有的适用保障。租赁不转移所有权，因此商品所有权及无未披露产权负担的购买保障不以相同方式适用。</p>
<h2>二、问题与补救</h2>
<p>重大问题可产生取消、退款或价值减损赔偿的权利；非重大问题应在合理时间补救，未能补救时仍可能产生进一步权利。您亦可依法要求赔偿可合理预见的损失。维修、更换或退款须按具体问题及法律处理，不以“仅余额退款”、合同免责、商业申请期限或必须先付款争议费用为由拒绝不可排除的救济。</p>
<h2>三、费用、月付与取消</h2>
<p>租金、折扣、GST、押金、配送、时段及支付手续费应在确认或付款前清楚披露。满 60 天的月付选项不自动构成续租；后续扣款须在所同意的付款计划及授权范围内。订单确认前取消没有取消手续费；确认后取货前个人原因取消的 5% 及未取货 AUD 25 规则属于商业取消安排，不能适用于依法应全退的情况，也不得重复收费。自 2026 年 10 月 1 日起，Visa、Mastercard、American Express 及 eftpos 不得另收银行卡支付附加费。</p>
<h2>四、押金、风险与验机</h2>
<p>风险押金及免押金条件应在确认前告知。已确认订单不因后续评分变化自动增加押金，您可要求资料更正和人工复核。预授权、实收押金和保存支付方式应区分说明；正常损耗不扣款，损坏或逾期等应逐项举证并计入已收款。归还时间与后续验机、退款处理应分开，不应因后台等待继续收占用租金。</p>
<h2>五、不公平条款与法定制度</h2>
<p>适用的不公平合同条款制度及消费者租赁、信贷等强制性规定不因使用“短租”“月付”或其他名称而被排除。标准条款不得不当地单方改变费用、免除法定责任或无限制扣款；无效或不可执行条款不影响其余可独立履行部分。中文约定或英文参考说明也不能减少消费者依法享有的权利。</p>
<h2>六、主张权利</h2>
<p>请联系 {company_email} 或 {company_phone}，说明订单及问题，可按《投诉与争议解决政策》申请复核、联系所在州消费者机构、VCAT 或有管辖权法院。可向<a href="https://www.accc.gov.au/consumers/buying-products-and-services/consumer-rights-and-guarantees">ACCC 查询消费者保障</a>或报告系统性问题；ACCC 不直接处理个别纠纷。</p>
<h2>联系我们</h2>
<p>{company_name}（ABN {company_abn}）<br>地址：{company_address}<br>电话：{company_phone}<br>邮箱：{company_email}</p>')
ON CONFLICT(key) DO UPDATE SET value = excluded.value, deleted_at = NULL, updatedAt = CURRENT_TIMESTAMP;

INSERT INTO systemSettings (key, value) VALUES ('consumerRightsEn',
'<h1>Rights under the Australian Consumer Law</h1>
<p><strong>Version:</strong> {consumer_rights_version}　<strong>Last updated:</strong> {consumer_rights_last_updated_date}</p>
<p>This page outlines protections when renting from {company_name} or using related services. Law takes priority over agreements, schedules, discounts and refund pages. This summary does not replace legislation.</p>
<h2>1. Equipment and service guarantees</h2>
<p>Where the Australian Consumer Law applies, equipment must be of acceptable quality, match description and meet disclosed purposes. Services require due care and skill and, without an agreed timeframe, completion within a reasonable time. Applicable undisturbed-possession guarantees apply during the rental. Renting does not transfer ownership, so purchase guarantees of title and no undisclosed securities do not apply in the same way.</p>
<h2>2. Problems and remedies</h2>
<p>Major failures may entitle cancellation, refunds or compensation for reduced value. Non-major failures require remedy within a reasonable time, with further rights where not remedied. Reasonably foreseeable losses may also be compensable. Repair, replacement and refunds depend on the problem and law. Mandatory remedies cannot be refused through account-credit-only rules, exclusions, commercial deadlines or requiring disputed charges to be paid first.</p>
<h2>3. Charges, instalments and cancellation</h2>
<p>Rent, discounts, GST, deposits, delivery, time-slot and processing fees must be clear before confirmation or payment. Instalments for rentals of at least 60 days do not automatically renew a term. Later charges require the agreed schedule and authority. Cancellation before confirmation has no cancellation fee. The 5% post-confirmation, pre-pickup fee and AUD 25 missed-pickup rule are commercial change-of-mind arrangements, not limits on statutory full refunds, and cannot duplicate recovery. From 1 October 2026, separate card payment surcharges are prohibited for Visa, Mastercard, American Express and eftpos payments.</p>
<h2>4. Deposits, risk and inspection</h2>
<p>Risk deposits and waiver conditions must be disclosed before confirmation. Later scores do not automatically increase confirmed deposits; request correction and human review. Holds, captured deposits and saved methods must be distinguished. Fair wear and tear is not chargeable. Damage and overdue deductions require itemised evidence and allowance for amounts already collected. Return time is separate from inspection and refund processing; administrative waiting must not extend occupancy rent.</p>
<h2>5. Unfair terms and mandatory regimes</h2>
<p>Applicable unfair terms, consumer lease, credit and other mandatory laws cannot be excluded by labels such as short-term or monthly. Standard terms must not improperly permit unilateral charges, exclude mandatory liability or authorise unlimited debits. Invalid terms do not affect independently workable provisions. Chinese governing text or English reference notices cannot reduce statutory rights.</p>
<h2>6. Exercising rights</h2>
<p>Contact {company_email} or {company_phone} with the order and problem. Seek review under the Complaints Policy or assistance from state consumer bodies, VCAT or a competent court. See <a href="https://www.accc.gov.au/consumers/buying-products-and-services/consumer-rights-and-guarantees">ACCC consumer guarantee information</a> or report systemic issues; the ACCC does not resolve individual disputes.</p>
<h2>Contact us</h2>
<p>{company_name} (ABN {company_abn})<br>Address: {company_address}<br>Telephone: {company_phone}<br>Email: {company_email}</p>')
ON CONFLICT(key) DO UPDATE SET value = excluded.value, deleted_at = NULL, updatedAt = CURRENT_TIMESTAMP;

INSERT INTO systemSettings (key, value) VALUES ('legalMetadata', '{}') ON CONFLICT(key) DO NOTHING;
UPDATE systemSettings
SET value = json_patch(CASE WHEN json_valid(value) = 1 AND json_type(value) = 'object' THEN value ELSE '{}' END,
'{"user":{"version":"2.0","lastUpdatedDate":"2026-11-04"},"service":{"version":"2.0","lastUpdatedDate":"2026-11-04"},"rental":{"version":"2.0","lastUpdatedDate":"2026-11-04"},"copyright":{"version":"2.0","lastUpdatedDate":"2026-11-04"},"privacy":{"version":"2.0","lastUpdatedDate":"2026-11-04"},"cookie":{"version":"2.0","lastUpdatedDate":"2026-11-04"},"software":{"version":"2.0","lastUpdatedDate":"2026-11-04"},"complaints":{"version":"2.0","lastUpdatedDate":"2026-11-04"},"aup":{"version":"2.0","lastUpdatedDate":"2026-11-04"},"consumer":{"version":"2.0","lastUpdatedDate":"2026-11-04"},"contract":{"version":"2.0","lastUpdatedDate":"2026-11-04"}}'), deleted_at = NULL, updatedAt = CURRENT_TIMESTAMP
WHERE key = 'legalMetadata';

INSERT INTO contract_templates (id, name, content) VALUES ('default', '标准租赁合同模板',
'<h1>设备租赁合同</h1>
<p>合同编号：<strong>{contract_number}</strong>　合同版本：{contract_version}　最后更新：{contract_last_updated_date}</p>
<p>生成时间：{created_time}　签署时间：<strong>{sign_time}</strong>　管辖地：{jurisdiction}</p>
<p>本设备租赁合同（下称「本合同」）由下列双方签署，构成具有法律约束力的租赁（bailment）合同。承租方以电子方式签署，即表示已阅读、理解并接受本合同全部条款。</p>

<h2>一、双方当事人</h2>
<table style="width:100%;border-collapse:collapse;margin:12px 0;">
  <tr style="background:#f3f4f6;"><th style="border:1px solid #e5e7eb;padding:8px;text-align:left;width:22%;">出租方（甲方）</th><td style="border:1px solid #e5e7eb;padding:8px;">{company_name}（ABN {company_abn}）</td></tr>
  <tr><td style="border:1px solid #e5e7eb;padding:8px;">地址</td><td style="border:1px solid #e5e7eb;padding:8px;">{company_address}</td></tr>
  <tr><td style="border:1px solid #e5e7eb;padding:8px;">联系方式</td><td style="border:1px solid #e5e7eb;padding:8px;">电话 {company_phone}　邮箱 {company_email}</td></tr>
  <tr style="background:#f3f4f6;"><th style="border:1px solid #e5e7eb;padding:8px;text-align:left;">承租方（乙方）</th><td style="border:1px solid #e5e7eb;padding:8px;">{customer_name}</td></tr>
  <tr><td style="border:1px solid #e5e7eb;padding:8px;">证件</td><td style="border:1px solid #e5e7eb;padding:8px;">{customer_id_type} {customer_id_number}　出生日期 {customer_dob}</td></tr>
  <tr><td style="border:1px solid #e5e7eb;padding:8px;">联系方式</td><td style="border:1px solid #e5e7eb;padding:8px;">电话 {customer_phone}　邮箱 {customer_email}</td></tr>
  <tr><td style="border:1px solid #e5e7eb;padding:8px;">联系地址</td><td style="border:1px solid #e5e7eb;padding:8px;">{customer_address}</td></tr>
  <tr><td style="border:1px solid #e5e7eb;padding:8px;">紧急联系人</td><td style="border:1px solid #e5e7eb;padding:8px;">{emergency_contact}　{emergency_phone}</td></tr>
</table>

<h2>二、租赁设备</h2>
<table style="width:100%;border-collapse:collapse;margin:12px 0;">
  <tr style="background:#f3f4f6;"><th style="border:1px solid #e5e7eb;padding:8px;text-align:left;width:22%;">设备名称</th><td style="border:1px solid #e5e7eb;padding:8px;">{device_name}</td></tr>
  <tr><td style="border:1px solid #e5e7eb;padding:8px;">品牌 / 型号</td><td style="border:1px solid #e5e7eb;padding:8px;">{device_brand} / {device_model}</td></tr>
  <tr><td style="border:1px solid #e5e7eb;padding:8px;">序列号 / 资产编号</td><td style="border:1px solid #e5e7eb;padding:8px;">{device_sn} / {asset_tag}</td></tr>
  <tr><td style="border:1px solid #e5e7eb;padding:8px;">配置</td><td style="border:1px solid #e5e7eb;padding:8px;">{device_cpu}　{device_ram}　{device_storage}　{device_gpu}　{device_os}</td></tr>
  <tr><td style="border:1px solid #e5e7eb;padding:8px;">电池健康</td><td style="border:1px solid #e5e7eb;padding:8px;">{battery_health}</td></tr>
  <tr><td style="border:1px solid #e5e7eb;padding:8px;">交付状况</td><td style="border:1px solid #e5e7eb;padding:8px;">{device_condition}</td></tr>
  <tr><td style="border:1px solid #e5e7eb;padding:8px;">随附配件</td><td style="border:1px solid #e5e7eb;padding:8px;">{device_accessories}</td></tr>
</table>
<p>设备在交付时应处于可正常使用的状况。承租方应当场检查设备及配件并及时提出问题；签署本合同不视为已收到或验收设备。</p>

<h2>三、租期、交付与归还</h2>
<ul>
<li>租期：<strong>{start_date}</strong> 至 <strong>{end_date}</strong>，共 {rental_days} 天。</li>
<li>交付方式：{delivery_method}（配送费 {currency} {delivery_fee}）　取件地点：{pickup_location}</li>
<li>归还方式：{return_method}　归还地点：{return_location}　约定归还日：{return_date}</li>
<li>承租方应在租期届满时，以交付时的状况（正常损耗除外）连同全部配件归还设备。</li>
</ul>

<h2>四、费用与付款</h2>
<table style="width:100%;border-collapse:collapse;margin:12px 0;">
  <tr style="background:#f3f4f6;"><th style="border:1px solid #e5e7eb;padding:8px;text-align:left;width:40%;">项目</th><th style="border:1px solid #e5e7eb;padding:8px;text-align:left;">金额（{currency}）</th></tr>
  <tr><td style="border:1px solid #e5e7eb;padding:8px;">日租金</td><td style="border:1px solid #e5e7eb;padding:8px;">{daily_rate}</td></tr>
  <tr><td style="border:1px solid #e5e7eb;padding:8px;">租金小计</td><td style="border:1px solid #e5e7eb;padding:8px;">{subtotal}</td></tr>
  <tr><td style="border:1px solid #e5e7eb;padding:8px;">优惠（{coupon_code}）</td><td style="border:1px solid #e5e7eb;padding:8px;">-{discount}</td></tr>
  <tr><td style="border:1px solid #e5e7eb;padding:8px;">保险（{insurance_selected}）</td><td style="border:1px solid #e5e7eb;padding:8px;">{insurance_fee}</td></tr>
  <tr><td style="border:1px solid #e5e7eb;padding:8px;">租金总额（含 GST：{gst_included}，其中 GST {gst_amount}）</td><td style="border:1px solid #e5e7eb;padding:8px;"><strong>{total_rent}</strong></td></tr>
  <tr><td style="border:1px solid #e5e7eb;padding:8px;">押金（security bond）</td><td style="border:1px solid #e5e7eb;padding:8px;"><strong>{deposit_amount}</strong></td></tr>
  <tr><td style="border:1px solid #e5e7eb;padding:8px;">已付租金 / 已付押金</td><td style="border:1px solid #e5e7eb;padding:8px;">{rent_paid} / {deposit_paid}</td></tr>
  <tr><td style="border:1px solid #e5e7eb;padding:8px;">应付余额</td><td style="border:1px solid #e5e7eb;padding:8px;"><strong>{amount_due}</strong></td></tr>
</table>
<p>付款方式：{payment_method}　付款日期：{payment_date}　付款参考号：{payment_reference}　税务发票编号：{invoice_number}</p>
<p>所有价格以澳元（AUD）列示，适用 GST 计入展示总价，发票按适用税法开具。配送费、时段服务费及支付手续费应在确认或付款前单独列示。支付费用须符合适用法律及卡组织规则，不得向适用卡种另收支付附加费。人民币付款及退款的币种和兑换汇率应另行明确。</p>
<p>不足 30 天按完整周及剩余日计算；满 30 天按完整的 30 天月租计算，余期少于 21 天按周租日价折算，满 21 天按月租日价折算。折扣及优惠以确认报价为准。不足 60 天一次性付清；满 60 天且提供月付选项时可选 Stripe 月付或一次性付清。月付为每 30 天一期，末期按剩余天数结算，首期包含适用押金及订单列明的一次性费用，各期支付手续费另列。</p>
<p>选择月付并完成首次付款时，承租方授权 Stripe 保存支付方式，按订单付款计划收取到期款项；失败或需验证时应按通知补付。月付不自动续租，也不免除已到期款项。取消或归还设备后停止未发生的后续期款，退款按《退款政策》办理。确认后的租金和押金不因后续定价或风险评分变化而自动上调。</p>

<h2>五、押金</h2>
<p>押金用于担保履约，不是租金、保险或罚金。新订单根据身份核验、履约、付款、退款、逾期、损坏及有效风险标记评估，六档押金倍数为设备基础押金的 0、0.5、1、1.25、1.5 或 2 倍；具体金额应在确认前列明，可申请人工复核。满 60 天一次性付清且风险倍数不高于 1 时可免押金；风险加收的押金不因一次性付清而免除。</p>
<p>月付押金在首期实际收取。其他订单按已选方式收取押金、办理信用卡预授权或通过 SetupIntent 保存后续扣款授权。预授权期限受卡组织及银行限制，通常 Visa、Mastercard 最长 30 天，其他卡最长 7 天；以支付服务商实际期限为准。保存卡片并不表示已冻结或支付押金。出租方仅可就本订单有依据、已披露的应付金额进行授权范围内的扣款；在合理可行时先提供说明及提出异议的机会，不得无限额或重复扣款。</p>
<p>承租方应按约定归还设备及全部配件，并在归还前备份和移除个人数据。出租方记录实际接收时间并进行验机；归还后的验机或退款等待不继续产生占用租金。完成验机后 10 个营业日内安排退还可退押金、释放预授权或结清后续扣款，银行实际到账或解除冻结时间由支付机构决定。正常损耗不扣款，扣款应逐项列明并提供照片、报价或发票等依据；已收费用不得再次从押金扣除。承租方可对验机及扣款提出异议。</p>

<h2>六、所有权与使用限制</h2>
<ul>
<li>设备所有权始终归甲方所有，不含购买权或购买义务，租期以订单为准；依法适用的消费者租赁、信贷及其他强制性规定仍然适用。</li>
<li>承租方不得转租、转借、出售、质押设备，或将设备移出澳大利亚境外。</li>
<li>设备仅限合法用途；不得拆解、改装，不得移除资产标签或管理软件，不得越权刷写系统。</li>
<li>承租方应保持操作系统与安全更新为最新，妥善保管登录凭据。</li>
</ul>

<h2>七、风险、损坏与赔偿</h2>
<p>因承租方或其授权使用人的过错造成丢失或超出正常损耗的损坏，应承担有凭证的合理损失；以合理维修费用或扣除折旧后的重置价值中适用且较低者为限，不包括甲方过错造成的损失。正常损耗不扣款，免押金不免除依法应承担的赔偿责任。</p>

<h2>八、逾期归还</h2>
<p>超过约定归还时间 2 小时仍未归还的，收取一次 AUD 25 操作费；跨过约定归还日后，按逾期日数及订单日租金补收占用租金。已结算金额和押金已抵扣金额从应付中扣除。费用在实际接收设备时停止累计，不因验机或退款处理而增加。收费受适用法律限制，仅用于补偿合理损失及成本，不得重复赔偿。</p>

<h2>九、设备管理软件</h2>
<p>管理软件可能上报设备状态、硬件、租期及安全信息。远程锁定、重启、注销或清除仅在《软件使用协议》所列必要情形依法实施；合理可行时先通知并给予补救及备份机会。数据清除会删除设备上的用户数据；出租方不以本条排除依法应承担的数据安全责任。信息处理见《隐私政策》。</p>

<h2>十、消费者保障</h2>
<p>本合同项下提供的商品与服务附带《澳大利亚消费者法》规定的消费者保障，包括设备须具有<strong>可接受的质量</strong>、与描述相符、适合告知的特定用途，服务须以合理的谨慎与技能提供。这些保障<strong>不能被排除、限制或修改</strong>。就重大失败，承租方有权解除本合同并要求退还相应款项，或就价值减损获得赔偿；就非重大失败，甲方将在合理时间内修理或更换。</p>

<h2>十一、责任限制</h2>
<p>在法律允许且不影响上述不可排除的消费者保障的前提下，甲方不对承租方的数据丢失、业务中断或其他间接或后果性损失负责；甲方可依法限制的责任，以重新提供服务或支付其合理费用为限，或以本合同项下已付租金总额为限。本合同中的任何内容均不排除或限制依法不能排除的责任。</p>

<h2>十二、违约与取回</h2>
<p>如承租方未支付到期款项、违反使用限制或存在欺诈，甲方可在发出合理书面通知并给予补救期后终止本合同。甲方仅可通过合法方式取回设备，不得进入住宅或采用胁迫手段。终止不影响已产生的付款义务。</p>

<h2>十三、不可抗力</h2>
<p>因超出一方合理控制的事件（如自然灾害、战争、罢工、电信或电力中断、政府行为）导致的履约迟延或不能，该方在受影响范围内不承担违约责任，但应尽快通知对方并努力减轻影响。</p>

<h2>十四、适用法律与争议解决</h2>
<p>本合同受澳大利亚 {jurisdiction} 法律管辖，适用法院非专属管辖，不影响承租方依法可选择的其他争议渠道。请按《投诉与争议解决政策》申请复核或向消费者机构、VCAT 或有管辖权法院寻求协助；ACCC 接收系统性问题报告，不处理个别纠纷。</p>

<h2>十五、电子签名</h2>
<p>双方同意以电子方式订立与签署本合同。依据 1999 年《电子交易法》（Electronic Transactions Act 1999 (Cth)）及《2000 年电子交易（维多利亚）法》，电子签名与手写签名具有同等法律效力。系统记录的签署证据如下：</p>
<ul>
<li>签署时间：{sign_time}</li>
<li>签署 IP：{esign_ip}</li>
<li>签署设备：{esign_device}</li>
<li>浏览器 / 系统：{esign_browser} / {esign_os}</li>
</ul>

<h2>十六、其他条款</h2>
<p>本合同连同其引用的政策构成双方就本次设备租赁的完整约定，取代此前一切口头或书面沟通。新增费用或实质变更须经双方另行书面确认，不追溯改写已签合同。若任何条款被认定无效或不可执行，不影响其余条款的效力。</p>

<h2>十七、银行账户</h2>
<p>开户行：{bank_name}　账户名：{account_name}　BSB：{bank_bsb}　账号：{bank_account}</p>

<h2>十八、取消、未取货与提前归还</h2>
<p>订单确认前取消不收取消手续费；确认后、实际取货或交付前，承租方个人原因取消按订单总额的 5% 收费。门店自提超过预约取货开始时间 2 小时仍未领取的，订单可被取消并释放设备，收取 AUD 25 未取货操作费，剩余款项退还；该费用不与同一次取消的 5% 手续费叠加。配送订单不适用门店未取货规则。提前归还的未使用租金及押金分别结算，详见<a href="/refund-policy">《退款政策》</a>。上述个人原因收费不适用于出租方原因或法定退款。</p>

<h2>十九、双方签署</h2>
<table style="width:100%;border-collapse:collapse;margin:12px 0;">
  <tr style="background:#f3f4f6;"><th style="border:1px solid #e5e7eb;padding:8px;text-align:left;width:50%;">出租方（甲方）</th><th style="border:1px solid #e5e7eb;padding:8px;text-align:left;">承租方（乙方）</th></tr>
  <tr>
    <td style="border:1px solid #e5e7eb;padding:8px;">{company_name}<br>授权代表：{company_representative}<br>签章：{company_signature}<br>日期：{sign_time}</td>
    <td style="border:1px solid #e5e7eb;padding:8px;">{signer_name}<br>姓名首字母确认：{customer_initials}<br>签名：{esign_signature}<br>日期：{sign_time}</td>
  </tr>
</table>
<p>承租方确认：本人已阅读并理解本合同全部条款，确认所填资料真实准确，并同意受本合同约束。</p>')
ON CONFLICT(id) DO UPDATE SET content = excluded.content, updatedAt = CURRENT_TIMESTAMP;
