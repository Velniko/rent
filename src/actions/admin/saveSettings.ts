/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

import { Context } from 'hono'
import { getSystemSettings, loadSystemSettingsFromDB, updateSystemSettings } from '../../site'
import { getStripeConfigSummary, saveStripeConfig } from '../../stripe'
import { getTurnstileConfigSummary, saveTurnstileConfig } from '../../turnstile'
import { getEmailConfigSummary, saveEmailConfig } from '../../emailConfig'
import { getSquareConfigSummary, saveSquareConfig } from '../../square'
import { getNotifyChannelsSummary, saveNotifyChannels } from '../../notifyChannels'
import { getDeliveryConfigSummary, saveDeliveryConfig } from '../../deliveryConfig'
import { saveTranslationConfig } from '../../translationConfig'
import { getCloudinaryConfigSummary, saveCloudinaryConfig } from '../../lib/cloudinary'
import { enqueueAgreementUpdate } from '../../services/notifications'
import { normalizeTallyEmbedUrl } from '../../lib/tally'
import { hasValidPickupTimeSettings, pickupTimeSettings } from '../../domain/pickupTimeSlots'
import { validateReferralSettings } from '../../domain/referral'
import { validateHostedImageUrls } from '../../lib/hostedImages'

/** 保存协议更新记录，实际通知由定时任务统一发送。 */
export async function notifyAgreementUpdate(c: Context, changedAgreements: Array<[string, string]>, _companyDetails?: any, _changedContent = ''): Promise<void> {
  if (!changedAgreements.length) return
  try {
    await enqueueAgreementUpdate(c, changedAgreements, _changedContent)
  } catch (error: any) {
    console.error('enqueueAgreementUpdate failed:', error?.message || error)
  }
}

export async function handleSaveAdminSettings(c: Context): Promise<Response> {
  // index.ts 已经完成 admin 权限校验，这里不再依赖 c.get('user')。
  const bodyText = await c.req.text()
  const payload = JSON.parse(bodyText || '{}')
  const hasSystemSettingsInput = [
    'tallyFormUrl', 'feedbackRewards', 'companyDetails', 'taxInvoiceTemplate',
    'paymentMethods', 'bankDetails', 'rmbPayment', 'referralSettings',
    'rentalRules', 'registrationSettings',
  ].some(key => Object.prototype.hasOwnProperty.call(payload, key))

  // Always hydrate the current values before merging the settings form.
  // Otherwise a fresh worker can overwrite database-backed agreements with
  // the in-code defaults when only company settings are being saved.
  await loadSystemSettingsFromDB(c)

  const referralSettings = {
    defaultRate: Number(payload.referralSettings?.defaultRate ?? getSystemSettings().referralSettings.defaultRate),
    levelLimit: Number(payload.referralSettings?.levelLimit ?? getSystemSettings().referralSettings.levelLimit),
    referralsPerLevel: Number(payload.referralSettings?.referralsPerLevel ?? getSystemSettings().referralSettings.referralsPerLevel),
    rateIncreasePerLevel: Number(payload.referralSettings?.rateIncreasePerLevel ?? getSystemSettings().referralSettings.rateIncreasePerLevel),
    settlementPeriod: Number(payload.referralSettings?.settlementPeriod ?? getSystemSettings().referralSettings.settlementPeriod),
  }
  validateReferralSettings(referralSettings)

  const currentFeedbackRewards = getSystemSettings().feedbackRewards
  const pickupHours = pickupTimeSettings({
    ...getSystemSettings().rentalRules,
    serviceFeeHours: payload.rentalRules?.serviceFeeHours ?? getSystemSettings().rentalRules.serviceFeeHours,
    businessHours: payload.rentalRules?.businessHours ?? getSystemSettings().rentalRules.businessHours,
    unavailablePickupHours: payload.rentalRules?.unavailablePickupHours ?? getSystemSettings().rentalRules.unavailablePickupHours,
    unavailablePickupRanges: payload.rentalRules?.unavailablePickupRanges ?? getSystemSettings().rentalRules.unavailablePickupRanges,
  })
  const serviceFeeRate = Number(payload.rentalRules?.serviceFeeRate ?? getSystemSettings().rentalRules.serviceFeeRate ?? 0.1)
  if (!hasValidPickupTimeSettings(pickupHours)) throw new Error('服务费时段与营业时段必须依次排列，且每段结束时间要晚于开始时间')
  if (!Number.isFinite(serviceFeeRate) || serviceFeeRate < 0 || serviceFeeRate > 1) throw new Error('时段服务费比例必须在 0% 到 100% 之间')
  const currentTaxInvoiceTemplate = getSystemSettings().taxInvoiceTemplate
  const taxInvoiceTemplateInput = payload.taxInvoiceTemplate && typeof payload.taxInvoiceTemplate === 'object' ? payload.taxInvoiceTemplate : {}
  const taxInvoiceTemplate = Object.fromEntries(Object.keys(currentTaxInvoiceTemplate).map((key) => {
    const value = String(taxInvoiceTemplateInput[key] ?? (currentTaxInvoiceTemplate as any)[key]).trim().slice(0, 200)
    return [key, value || (currentTaxInvoiceTemplate as any)[key]]
  })) as typeof currentTaxInvoiceTemplate

  const stripeConfigInput = payload.stripeConfig
  const shouldSaveStripeConfig = Boolean(
    stripeConfigInput &&
    (
      stripeConfigInput.secretKey ||
      stripeConfigInput.webhookSecret ||
      stripeConfigInput.clear === true
    )
  )

  const next = {
    tallyFormUrl: normalizeTallyEmbedUrl(payload.tallyFormUrl ?? getSystemSettings().tallyFormUrl),
    feedbackRewards: {
      enabled: typeof payload.feedbackRewards?.enabled === 'boolean' ? payload.feedbackRewards.enabled : currentFeedbackRewards.enabled,
      rewardType: ['BALANCE', 'COUPON', 'GIFT_CARD'].includes(String(payload.feedbackRewards?.rewardType)) ? String(payload.feedbackRewards.rewardType) : currentFeedbackRewards.rewardType,
      balanceAmount: Math.min(10000, Math.max(0, Number(payload.feedbackRewards?.balanceAmountMin ?? currentFeedbackRewards.balanceAmountMin ?? currentFeedbackRewards.balanceAmount) || 0)),
      balanceAmountMin: Math.min(10000, Math.max(0, Number(payload.feedbackRewards?.balanceAmountMin ?? currentFeedbackRewards.balanceAmountMin ?? currentFeedbackRewards.balanceAmount) || 0)),
      balanceAmountMax: Math.min(10000, Math.max(0, Number(payload.feedbackRewards?.balanceAmountMax ?? currentFeedbackRewards.balanceAmountMax ?? currentFeedbackRewards.balanceAmount) || 0)),
      couponDiscountType: payload.feedbackRewards?.couponDiscountType === 'percent' ? 'percent' : payload.feedbackRewards?.couponDiscountType === 'fixed' ? 'fixed' : currentFeedbackRewards.couponDiscountType,
      couponDiscountValue: Math.min(10000, Math.max(0, Number(payload.feedbackRewards?.couponDiscountValueMin ?? currentFeedbackRewards.couponDiscountValueMin ?? currentFeedbackRewards.couponDiscountValue) || 0)),
      couponDiscountValueMin: Math.min(10000, Math.max(0, Number(payload.feedbackRewards?.couponDiscountValueMin ?? currentFeedbackRewards.couponDiscountValueMin ?? currentFeedbackRewards.couponDiscountValue) || 0)),
      couponDiscountValueMax: Math.min(10000, Math.max(0, Number(payload.feedbackRewards?.couponDiscountValueMax ?? currentFeedbackRewards.couponDiscountValueMax ?? currentFeedbackRewards.couponDiscountValue) || 0)),
      couponMinimumOrderAmount: Math.min(1000000, Math.max(0, Number(payload.feedbackRewards?.couponMinimumOrderAmount ?? currentFeedbackRewards.couponMinimumOrderAmount ?? 0) || 0)),
      couponExpiresDays: Math.min(365, Math.max(1, Math.floor(Number(payload.feedbackRewards?.couponExpiresDays ?? currentFeedbackRewards.couponExpiresDays) || 30))),
    },
    companyDetails: {
      name: String(payload.companyDetails?.name ?? getSystemSettings().companyDetails.name).trim(),
      abn: String(payload.companyDetails?.abn ?? getSystemSettings().companyDetails.abn).trim(),
      gstIncluded: payload.companyDetails?.gstIncluded ?? getSystemSettings().companyDetails.gstIncluded,
      address: String(payload.companyDetails?.address ?? getSystemSettings().companyDetails.address).trim(),
      contact: String(payload.companyDetails?.contact ?? getSystemSettings().companyDetails.contact).trim(),
      phone: String(payload.companyDetails?.phone ?? getSystemSettings().companyDetails.phone).trim(),
      email: String(payload.companyDetails?.email ?? getSystemSettings().companyDetails.email).trim(),
      website: String(payload.companyDetails?.website ?? getSystemSettings().companyDetails.website).trim(),
      logo: String(payload.companyDetails?.logo ?? getSystemSettings().companyDetails.logo).trim(),
      loginImage: String(payload.companyDetails?.loginImage ?? getSystemSettings().companyDetails.loginImage).trim(),
      wechatUrl: String(payload.companyDetails?.wechatUrl ?? getSystemSettings().companyDetails.wechatUrl ?? '').trim().slice(0, 1000),
      wechatQrUrl: String(payload.companyDetails?.wechatQrUrl ?? getSystemSettings().companyDetails.wechatQrUrl ?? '').trim().slice(0, 1000),
      xiaohongshuUrl: String(payload.companyDetails?.xiaohongshuUrl ?? getSystemSettings().companyDetails.xiaohongshuUrl ?? '').trim().slice(0, 1000),
      xiaohongshuQrUrl: String(payload.companyDetails?.xiaohongshuQrUrl ?? getSystemSettings().companyDetails.xiaohongshuQrUrl ?? '').trim().slice(0, 1000),
      douyinUrl: String(payload.companyDetails?.douyinUrl ?? getSystemSettings().companyDetails.douyinUrl ?? '').trim().slice(0, 1000),
      douyinQrUrl: String(payload.companyDetails?.douyinQrUrl ?? getSystemSettings().companyDetails.douyinQrUrl ?? '').trim().slice(0, 1000),
      pickupLocations: Array.isArray(payload.companyDetails?.pickupLocations)
        ? payload.companyDetails.pickupLocations.map((value: unknown) => String(value).trim()).filter(Boolean).slice(0, 20)
        : getSystemSettings().companyDetails.pickupLocations,
      deliveryAreas: Array.isArray(payload.companyDetails?.deliveryAreas)
        ? payload.companyDetails.deliveryAreas.map((value: unknown) => String(value).trim()).filter(Boolean).slice(0, 50)
        : getSystemSettings().companyDetails.deliveryAreas,
      deliveryNote: String(payload.companyDetails?.deliveryNote ?? getSystemSettings().companyDetails.deliveryNote).trim(),
    },
    taxInvoiceTemplate,
    paymentMethods: {
      stripe: payload.paymentMethods?.stripe ?? getSystemSettings().paymentMethods.stripe,
      square: payload.paymentMethods?.square ?? getSystemSettings().paymentMethods.square,
      bankTransfer: payload.paymentMethods?.bankTransfer ?? getSystemSettings().paymentMethods.bankTransfer,
      balancePayment: payload.paymentMethods?.balancePayment ?? getSystemSettings().paymentMethods.balancePayment,
      alipay: payload.paymentMethods?.alipay ?? getSystemSettings().paymentMethods.alipay,
      wechat: payload.paymentMethods?.wechat ?? getSystemSettings().paymentMethods.wechat,
      processingFeeRate: Math.min(1, Math.max(0, Number(payload.paymentMethods?.processingFeeRate ?? getSystemSettings().paymentMethods.processingFeeRate ?? 0.025))),
      squareProcessingFeeRate: Math.min(1, Math.max(0, Number(payload.paymentMethods?.squareProcessingFeeRate ?? getSystemSettings().paymentMethods.squareProcessingFeeRate ?? 0.022))),
    },
    bankDetails: {
      bankName: String(payload.bankDetails?.bankName ?? getSystemSettings().bankDetails.bankName).trim().slice(0, 120),
      accountName: String(payload.bankDetails?.accountName ?? getSystemSettings().bankDetails.accountName).trim().slice(0, 120),
      bsb: String(payload.bankDetails?.bsb ?? getSystemSettings().bankDetails.bsb).trim().replace(/\s+/g, '').slice(0, 20),
      account: String(payload.bankDetails?.account ?? getSystemSettings().bankDetails.account).trim().replace(/\s+/g, '').slice(0, 40),
    },
    rmbPayment: {
      alipayQrUrl: String(payload.rmbPayment?.alipayQrUrl ?? getSystemSettings().rmbPayment.alipayQrUrl).trim().slice(0, 500),
      wechatQrUrl: String(payload.rmbPayment?.wechatQrUrl ?? getSystemSettings().rmbPayment.wechatQrUrl).trim().slice(0, 500),
    },
    referralSettings,
    rentalRules: {
      ...getSystemSettings().rentalRules,
      unavailableDates: Array.isArray(payload.rentalRules?.unavailableDates)
        ? payload.rentalRules.unavailableDates.map((value: unknown) => String(value).trim()).filter((value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value)).slice(0, 366)
        : getSystemSettings().rentalRules.unavailableDates,
      unavailableTimeSlots: getSystemSettings().rentalRules.unavailableTimeSlots,
      serviceFeeHours: pickupHours.serviceFeeHours,
      businessHours: pickupHours.businessHours,
      unavailablePickupHours: pickupHours.unavailablePickupHours,
      unavailablePickupRanges: pickupHours.unavailablePickupRanges,
      serviceFeeRate,
      minimumRentalDays: Math.max(1, Math.floor(Number(payload.rentalRules?.minimumRentalDays ?? getSystemSettings().rentalRules.minimumRentalDays) || 1)),
      bufferDays: Math.max(0, Math.floor(Number(payload.rentalRules?.bufferDays ?? getSystemSettings().rentalRules.bufferDays) || 0)),
    },
    registrationSettings: {
      requireEmailVerification: payload.registrationSettings?.requireEmailVerification ?? getSystemSettings().registrationSettings.requireEmailVerification,
    },
  }

  if (String(payload.tallyFormUrl ?? '').trim() && !next.tallyFormUrl) {
    throw new Error('Tally 表单地址必须是 https://tally.so/embed/... 格式')
  }
  if (next.feedbackRewards.rewardType === 'BALANCE' && next.feedbackRewards.enabled && (next.feedbackRewards.balanceAmountMin <= 0 || next.feedbackRewards.balanceAmountMax < next.feedbackRewards.balanceAmountMin)) throw new Error('反馈奖励余额范围无效')
  if (next.feedbackRewards.rewardType === 'COUPON' && next.feedbackRewards.enabled && (next.feedbackRewards.couponDiscountValueMin <= 0 || next.feedbackRewards.couponDiscountValueMax < next.feedbackRewards.couponDiscountValueMin || (next.feedbackRewards.couponDiscountType === 'percent' && next.feedbackRewards.couponDiscountValueMax > 100))) throw new Error('反馈奖励优惠值范围无效')

  for (const key of ['wechatUrl', 'wechatQrUrl', 'xiaohongshuUrl', 'xiaohongshuQrUrl', 'douyinUrl', 'douyinQrUrl'] as const) {
    const value = next.companyDetails[key]
    if (!value) continue
    try { validateHostedImageUrls(value, 1) } catch { throw new Error('社交平台链接和二维码必须使用公开的 HTTPS 地址') }
  }

  for (const [name, value] of Object.entries(next.rmbPayment)) {
    if (value && (!/^https:\/\//i.test(String(value)) || String(value).includes('"'))) throw new Error(`${name} 必须是 HTTPS 图片地址`)
  }

  if (shouldSaveStripeConfig) await saveStripeConfig(c, stripeConfigInput)

  if (payload.translationConfig) await saveTranslationConfig(c, payload.translationConfig)

  const cloudinaryConfigInput = payload.cloudinaryConfig
  const shouldSaveCloudinaryConfig = Boolean(cloudinaryConfigInput && (
    // Cloud Name is echoed back on every settings save, so it must not by
    // itself trigger validation when credentials already live in env vars.
    cloudinaryConfigInput.apiKey || cloudinaryConfigInput.apiSecret || cloudinaryConfigInput.clear === true
  ))
  if (shouldSaveCloudinaryConfig) await saveCloudinaryConfig(c, cloudinaryConfigInput)

  const squareConfigInput = payload.squareConfig
  const shouldSaveSquareConfig = Boolean(squareConfigInput && (squareConfigInput.accessToken || squareConfigInput.webhookSignatureKey || squareConfigInput.applicationId || squareConfigInput.locationId || squareConfigInput.clear === true))
  if (shouldSaveSquareConfig) await saveSquareConfig(c, squareConfigInput)

  const turnstileConfigInput = payload.turnstileConfig
  // Mirror the Stripe rule: only persist when a secret is actually supplied
  // (or on an explicit clear). The Site Key alone is always echoed back by the
  // form, so triggering on it would break every save on env-var deployments.
  const shouldSaveTurnstileConfig = Boolean(
    turnstileConfigInput &&
    (
      turnstileConfigInput.secretKey ||
      turnstileConfigInput.clear === true
    )
  )
  if (shouldSaveTurnstileConfig) await saveTurnstileConfig(c, turnstileConfigInput)
  const emailTransportInput = payload.emailTransport
  const shouldSaveEmailTransport = Boolean(
    emailTransportInput &&
    (
      emailTransportInput.clear === true ||
      emailTransportInput.host ||
      emailTransportInput.user ||
      emailTransportInput.password ||
      emailTransportInput.from
    )
  )
  if (shouldSaveEmailTransport) await saveEmailConfig(c, emailTransportInput)

  const notifyChannelsInput = payload.notifyChannels
  const shouldSaveNotifyChannels = Boolean(
    notifyChannelsInput &&
    (
      notifyChannelsInput.clear === true ||
      notifyChannelsInput.emailProvider !== undefined ||
      notifyChannelsInput.resendApiKey || notifyChannelsInput.resendClear === true ||
      notifyChannelsInput.resendFrom !== undefined ||
      notifyChannelsInput.brevoApiKey || notifyChannelsInput.brevoClear === true ||
      notifyChannelsInput.brevoFrom !== undefined ||
      notifyChannelsInput.mailersendApiKey || notifyChannelsInput.mailersendClear === true ||
      notifyChannelsInput.mailersendFrom !== undefined ||
      'webhookEnabled' in notifyChannelsInput || notifyChannelsInput.webhookUrl
    )
  )
  if (shouldSaveNotifyChannels) await saveNotifyChannels(c, notifyChannelsInput)

  const deliveryConfigInput = payload.deliveryConfig
  const shouldSaveDeliveryConfig = Boolean(deliveryConfigInput && (
    deliveryConfigInput.apiToken || deliveryConfigInput.webhookSecret || deliveryConfigInput.adminToken ||
    deliveryConfigInput.clear === true || Object.keys(deliveryConfigInput).some((key) => key !== 'clear')
  ))
  if (shouldSaveDeliveryConfig) await saveDeliveryConfig(c, deliveryConfigInput)

  if (hasSystemSettingsInput) {
    await updateSystemSettings(c, next as any)
    await loadSystemSettingsFromDB(c)
  }

  return c.json({ success: true, settings: getSystemSettings(), stripe: await getStripeConfigSummary(c), square: await getSquareConfigSummary(c), email: await getEmailConfigSummary(c), notify: await getNotifyChannelsSummary(c), turnstile: await getTurnstileConfigSummary(c), delivery: await getDeliveryConfigSummary(c), cloudinary: await getCloudinaryConfigSummary(c) })
}

/** Save only the Tally feedback campaign settings, without touching unrelated system settings. */
export async function handleSaveTallyFeedbackSettings(c: Context): Promise<Response> {
  const payload = JSON.parse(await c.req.text() || '{}')
  await loadSystemSettingsFromDB(c)

  const current = getSystemSettings().feedbackRewards
  const rawEmbedUrl = String(payload.tallyFormUrl ?? getSystemSettings().tallyFormUrl).trim()
  const tallyFormUrl = normalizeTallyEmbedUrl(rawEmbedUrl)
  if (rawEmbedUrl && !tallyFormUrl) throw new Error('Tally 表单地址必须是 https://tally.so/embed/... 格式')

  const input = payload.feedbackRewards && typeof payload.feedbackRewards === 'object' ? payload.feedbackRewards : {}
  const feedbackRewards = {
    enabled: typeof input.enabled === 'boolean' ? input.enabled : current.enabled,
    rewardType: ['BALANCE', 'COUPON', 'GIFT_CARD'].includes(String(input.rewardType)) ? String(input.rewardType) : current.rewardType,
    balanceAmount: Math.min(10000, Math.max(0, Number(input.balanceAmountMin ?? current.balanceAmountMin ?? current.balanceAmount) || 0)),
    balanceAmountMin: Math.min(10000, Math.max(0, Number(input.balanceAmountMin ?? current.balanceAmountMin ?? current.balanceAmount) || 0)),
    balanceAmountMax: Math.min(10000, Math.max(0, Number(input.balanceAmountMax ?? current.balanceAmountMax ?? current.balanceAmount) || 0)),
    couponDiscountType: input.couponDiscountType === 'percent' ? 'percent' : input.couponDiscountType === 'fixed' ? 'fixed' : current.couponDiscountType,
    couponDiscountValue: Math.min(10000, Math.max(0, Number(input.couponDiscountValueMin ?? current.couponDiscountValueMin ?? current.couponDiscountValue) || 0)),
    couponDiscountValueMin: Math.min(10000, Math.max(0, Number(input.couponDiscountValueMin ?? current.couponDiscountValueMin ?? current.couponDiscountValue) || 0)),
    couponDiscountValueMax: Math.min(10000, Math.max(0, Number(input.couponDiscountValueMax ?? current.couponDiscountValueMax ?? current.couponDiscountValue) || 0)),
    couponMinimumOrderAmount: Math.min(1000000, Math.max(0, Number(input.couponMinimumOrderAmount ?? current.couponMinimumOrderAmount ?? 0) || 0)),
    couponExpiresDays: Math.min(365, Math.max(1, Math.floor(Number(input.couponExpiresDays ?? current.couponExpiresDays) || 30))),
  }

  if (feedbackRewards.rewardType === 'BALANCE' && feedbackRewards.enabled && (feedbackRewards.balanceAmountMin <= 0 || feedbackRewards.balanceAmountMax < feedbackRewards.balanceAmountMin)) throw new Error('反馈奖励余额范围无效')
  if (feedbackRewards.rewardType === 'COUPON' && feedbackRewards.enabled && (feedbackRewards.couponDiscountValueMin <= 0 || feedbackRewards.couponDiscountValueMax < feedbackRewards.couponDiscountValueMin || (feedbackRewards.couponDiscountType === 'percent' && feedbackRewards.couponDiscountValueMax > 100))) throw new Error('反馈奖励优惠值范围无效')

  await updateSystemSettings(c, { tallyFormUrl, feedbackRewards } as any)
  await loadSystemSettingsFromDB(c)
  return c.json({ success: true, tallyFormUrl: getSystemSettings().tallyFormUrl, feedbackRewards: getSystemSettings().feedbackRewards })
}
