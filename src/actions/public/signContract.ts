/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

import { Context } from 'hono';
import {
  getContractBySignToken, insertUser, updateOrderInDB, Order, User,
  updateContractStatusInDB, hashPassword, logError, getOrCreateSignSession,
  updateSignSession, deleteSignSession, getUserById, getSystemSettings, getOrderById, getDeviceById,
  getContractVariableData, renderContractVariables, ensureOrderNumber, issueInvoice, findUserBySession, uploadCloudinaryImage, validateHostedImageUrls, isStrongPassword, loadSystemSettingsFromDB, generateTemporaryPassword, generateUniqueUserId, updateUser, buildLayout, canUseAccountBalance, createNotification, enqueueRentalUserCreation, recordBalanceTransaction, generateContractNumber, generateReferenceNumber, lockReferralRelationship, createAuthSession, getCustomerSigningUser, getDeviceRentalRules, getContractCustomerSnapshot, getCustomerRiskAssessment
} from '../../site';
import { applyOrderRiskDeposit } from '../../services/riskDeposit';
import { nanoid } from 'nanoid';
import { getAudCnyRate, roundCnyUp } from '../../rmbExchange';
import { completeOrderSetupIntent, createOrderPaymentIntent, createOrderSetupIntent, resolveDepositPaymentMode } from '../stripePayments';
import { normalizeSecurityDepositMethod } from '../../domain/paymentPlan';
import { getStripeRuntimeConfig } from '../../stripe';
import { getSquareRuntimeConfig } from '../../square';
import { findEligibleCoupon, calculateCouponDiscount, checkCustomerCouponEligibility, reserveCouponForOrder, clearPreviewCouponFromOrder } from '../coupons';
import { calculateRentalFee } from '../../domain/rentalPricing';
import { generateWindowsPassword } from '../../lib/password';
import { getCloudinaryRuntimeConfig } from '../../lib/cloudinary';
import { escapeHtml } from '../../lib/html';
import { encryptSecret } from '../../lib/secretBox';
import { isUnavailablePickupTime, legacyPickupSlot, pickupTimeMode, serviceFeeRate } from '../../domain/pickupTimeSlots';

function isTimeSlotPassed(date: string, slot: string): boolean {
  const melbourneDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Melbourne', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  const parts = new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Melbourne', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date())
  const hour = Number(parts.find((part) => part.type === 'hour')?.value || 0)
  const minutes = (hour === 24 ? 0 : hour) * 60 + Number(parts.find((part) => part.type === 'minute')?.value || 0)
  const endMinutes: Record<string, number> = { morning_service: 8 * 60, morning: 12 * 60, afternoon: 20 * 60, evening_service: 23 * 60, delivery_morning: 12 * 60, delivery_afternoon: 19 * 60 }
  const exactMinutes = /^([01]\d|2[0-3]):(?:00|30)$/.test(slot) ? Number(slot.slice(0, 2)) * 60 + Number(slot.slice(3)) : 0
  return date === melbourneDate && minutes >= (exactMinutes || endMinutes[slot] || 24 * 60)
}

export async function handleSignContractStep(c: Context, identifier: string, step: number, body: Record<string, any>): Promise<Response> {
  const token = identifier; // 明确定义 token
  const viewerUser = c.get('user') || await findUserBySession(c, c.req.header('cookie') ?? null)
  const currentUser = getCustomerSigningUser(viewerUser)
  // 「异步 Stripe」模式：前端第 3 步选 Stripe 时用 fetch 提交，期望拿到 JSON（含 Stripe 链接）而非整页跳转。
  const wantsJson = (c.req.header('accept') || '').includes('application/json') || String((body as any).asyncStripe || '') === '1'

  // 记录进入签约流程的日志
  await logError(c, 'DEBUG', `Entering contract signing process`, undefined, {
    token,
    step,
    requestBody: Object.keys(body)
  });

  let contract = await getContractBySignToken(c, token); // 使用明确定义的 token
  if (!contract) {
    await logError(c, 'WARNING', `Contract not found for signing identifier`, undefined, { identifier: token }); // 使用明确定义的 token
    return new Response('合同链接无效或已过期', { status: 404 });
  }

  const contractData = typeof contract.contract_data === 'string'
    ? (() => { try { return JSON.parse(contract.contract_data || '{}') } catch (_) { return {} } })()
    : (contract.contract_data || {})
  const signingOrderForRouting = await getOrderById(c, contract.rentalId || contract.rental_id)
  const isWebsiteOrderContract = Boolean(contractData.website_order) || String(signingOrderForRouting?.status || '') === 'approved'

  // 步骤 5 完成后合同已签署；访客没有登录态，返回/重复提交时不能再次进入付款选择页。
  if (step === 5 && (contract.status === 'signed' || contract.signedAt)) {
    const orderId = contract.rentalId || contract.rental_id
    return new Response(null, {
      status: 303,
      headers: { Location: isWebsiteOrderContract ? `/customer/orders/${encodeURIComponent(String(orderId || ''))}` : `/payment/result?orderId=${encodeURIComponent(String(orderId || ''))}` },
    })
  }

  // 检查合同是否已过期
  const signExpiresAt = contract.signExpiresAt || contract.sign_expires_at;
  if (signExpiresAt && contract.status === 'pending_sign') {
    const now = new Date();
    const expiryDate = new Date(signExpiresAt);
    if (now > expiryDate) {
      await logError(c, 'WARNING', `Contract signing link has expired`, undefined, {
        token,
        contractId: contract.id,
        expiresAt: signExpiresAt,
        currentTime: now.toISOString()
      });
      // 将过期合同状态更新为已取消
      await updateContractStatusInDB(c, contract.id, 'cancelled');
      return new Response('合同链接已过期，请联系工作人员重新生成签约链接', { status: 400 });
    }
  }

  // 获取或创建数据库持久化的签约会话
  let signSession: Record<string, any>;
  try {
    signSession = await getOrCreateSignSession(c, token, contract.signToken || token);
  } catch (error) {
    await logError(c, 'ERROR', `Failed to initialize sign session`, error as Error, { token });
    const redirectUrl = `/contract/sign?token=${token}&step=1&error=${encodeURIComponent('系统错误，请稍后重试')}`;
    return new Response(null, {
      status: 302,
      headers: { 'Location': redirectUrl },
    });
  }

  let redirectUrl = '';
  let errorMessage: string | undefined = undefined;
  let signingCompleted = false;

  try {
    switch (step) {
      case 1:
        // Step 1: 同意协议
        await logError(c, 'DEBUG', `Processing step 1: Agreement acceptance`, undefined, { token, body });

        if (!body.agreeTerms) {
          await logError(c, 'INFO', `User did not agree to terms`, undefined, { token });
          throw new Error('您必须同意租赁协议才能继续。');
        }

        const privacyPolicyAcceptedAt = new Date().toISOString()
        const privacyPolicyAcceptedIp = (c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For')?.split(',')[0] || '').trim().slice(0, 64)
        await c.env.RENT.prepare(`UPDATE contracts SET privacy_policy_accepted = 1, privacy_policy_version = ?, privacy_policy_accepted_at = ?, privacy_policy_accepted_ip = ? WHERE id = ?`)
          .bind('1.0', privacyPolicyAcceptedAt, privacyPolicyAcceptedIp || null, contract.id).run()

        // 更新会话数据
        await updateSignSession(c, token, { agreedToTerms: true, privacyPolicyAccepted: true, privacyPolicyVersion: '1.0', privacyPolicyAcceptedAt, privacyPolicyAcceptedIp });
        await logError(c, 'INFO', `User agreed to terms, proceeding to step 2`, undefined, { token });

        redirectUrl = `/contract/sign?token=${token}&step=2`;
        break;

      case 2:
        // Step 2: 填写用户信息并创建账户
        await logError(c, 'DEBUG', `Processing step 2: User information submission`, undefined, { token });

        if (!signSession.agreedToTerms) {
          await logError(c, 'WARNING', `User attempted to access step 2 without agreeing to terms`, undefined, { token });
          throw new Error('请先同意租赁协议。');
        }

        const { firstName, lastName, password, passwordConfirm, phoneCode, phone, createAccount: createAccountInput, referrer } = body;
        const createAccount = !currentUser && Boolean(createAccountInput)
        const selectedAccountMode = createAccount ? 'formal' : 'guest'
        const cleanFirstName = String(firstName || '').trim()
        const cleanLastName = String(lastName || '').trim()
        const name = `${cleanFirstName} ${cleanLastName}`.trim()
        const email = String(body.email || '').trim().toLowerCase()
        const submittedPhone = phone

        // 验证必填字段
        if (!cleanFirstName || !cleanLastName || !email || !submittedPhone) {
          await logError(c, 'INFO', `Missing required fields in step 2`, undefined, {
            token,
            hasName: !!name,
            hasEmail: !!email,
            hasPhoneCode: !!phoneCode,
            hasPhone: !!submittedPhone
          });
          throw new Error('请完整填写姓名、邮箱和联系电话。');
        }
        if (cleanFirstName.length > 100 || cleanLastName.length > 100 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          throw new Error('姓名或电子邮箱格式不正确。')
        }

        // 如果选择创建账户，密码是必填的
        if (!currentUser && createAccount && (!password || !passwordConfirm)) {
          await logError(c, 'INFO', `Missing password for account creation`, undefined, { token });
          throw new Error('创建账户时密码和确认密码是必填项。');
        }
        if (!currentUser && createAccount && password !== passwordConfirm) {
          await logError(c, 'INFO', `Password mismatch in account creation`, undefined, { token });
          throw new Error('两次输入的密码不一致。');
        }
        if (!currentUser && createAccount && !isStrongPassword(password)) {
          throw new Error('密码至少需要 8 位，并同时包含字母、数字和符号。');
        }

        // 验证电话号码格式 - 先清理空格、连字符和国际前缀，再按各国规则校验
        const normalizedPhone = String(submittedPhone || '').replace(/\D/g, '');
        let phoneToValidate = normalizedPhone;

        if (phoneCode === '+86') {
          if (normalizedPhone.startsWith('86') && normalizedPhone.length === 13) {
            phoneToValidate = normalizedPhone.slice(2);
          } else if (normalizedPhone.length === 11) {
            phoneToValidate = normalizedPhone;
          } else {
            phoneToValidate = '';
          }
        }
        const phonePatterns: Record<string, RegExp> = {
          '+86': /^1[3-9]\d{9}$/, // 中国：11位，必须以13-19开头
          '+61': /^0\d{9}$/, // 澳大利亚：手机以0开头，共10位
          '+1': /^\d{10}$/, // 美国/加拿大：10位手机号
          '+44': /^7\d{9}$/, // 英国：手机以7开头，共10位
          '+852': /^[5689]\d{7}$/, // 香港：手机以5/6/8/9开头，共8位
          '+853': /^6\d{7}$/, // 澳门：手机以6开头，共8位
          '+886': /^9\d{8}$/, // 台湾：手机以9开头，共9位
          '+65': /^[89]\d{7}$/, // 新加坡：手机以8/9开头，共8位
          '+82': /^1[0-9]\d{7,8}$/, // 韩国：手机以1开头，共9-10位
          '+81': /^[789]0\d{8}$/ // 日本：手机以70/80/90开头，共10位
        };

        const pattern = phonePatterns[phoneCode];
        if (pattern && !pattern.test(phoneToValidate)) {
          // 详细的错误提示信息
          const errorMessages: Record<string, string> = {
            '+86': '中国手机号需要11位，必须以13-19开头',
            '+61': '澳大利亚手机号需要10位，必须以0开头',
            '+1': '美国/加拿大手机号需要10位数字',
            '+44': '英国手机号需要10位，必须以7开头',
            '+852': '香港手机号需要8位，必须以5、6、8或9开头',
            '+853': '澳门手机号需要8位，必须以6开头',
            '+886': '台湾手机号需要9位，必须以9开头',
            '+65': '新加坡手机号需要8位，必须以8/9开头',
            '+82': '韩国手机号需要9-10位，必须以1开头',
            '+81': '日本手机号需要10位，必须以70/80/90开头'
          };

          await logError(c, 'INFO', `Invalid phone number format`, undefined, { token, phoneCode, phone });
          throw new Error(errorMessages[phoneCode] || '电话号码格式不正确，请检查国家代码和手机号。');
        }

        const fullPhone = `${phoneCode}${phoneCode === '+61' && phoneToValidate.startsWith('0') ? phoneToValidate.slice(1) : phoneToValidate}`
        const lockedCustomerSnapshot = isWebsiteOrderContract ? getContractCustomerSnapshot(contract) : null
        if (lockedCustomerSnapshot && (
          lockedCustomerSnapshot.name !== name ||
          lockedCustomerSnapshot.email !== email ||
          lockedCustomerSnapshot.phone !== fullPhone
        )) {
          throw new Error('该网站订单的承租方资料已锁定，不能修改姓名、邮箱或联系电话。')
        }

        if (isWebsiteOrderContract && !lockedCustomerSnapshot) {
          const lockedAt = new Date().toISOString()
          const lockedData = {
            ...contractData,
            customer_name: name,
            customer_email: email,
            customer_phone: fullPhone,
            customer_identity_locked_at: lockedAt,
          }
          const lockResult = await c.env.RENT.prepare(`UPDATE contracts SET contract_data = ? WHERE id = ? AND COALESCE(json_extract(contract_data, '$.customer_identity_locked_at'), '') = ''`)
            .bind(JSON.stringify(lockedData), contract.id).run() as any
          if (Number(lockResult?.meta?.changes ?? lockResult?.changes ?? 0) < 1) {
            throw new Error('该网站订单的承租方资料已锁定，请刷新页面后继续。')
          }
          contractData.customer_name = name
          contractData.customer_email = email
          contractData.customer_phone = fullPhone
          contractData.customer_identity_locked_at = lockedAt
        }

        // 从数据库检查邮箱是否已存在
        const existingUser = await c.env.RENT.prepare('SELECT * FROM users WHERE email = ?').bind(email).first() as any
        if (existingUser?.role === 'CUSTOMER') {
          const risk = await getCustomerRiskAssessment(c, existingUser.id)
          if (risk.blocked) throw new Error('该客户存在有效风控限制，暂时无法签署或创建租赁合同，请联系客服处理。')
        }
        if (currentUser) {
          if (existingUser && existingUser.id !== currentUser.id) throw new Error('该邮箱已被其他账户使用，请更换电子邮箱。')
          await updateUser(c, currentUser.id, { name, email, phone: fullPhone })
          await updateSignSession(c, token, { userIdToLink: currentUser.id });
        } else if (existingUser) {
          // Stripe 或其他第 4 步失败后，用户可能已经在本签约会话中创建；
          // 允许该会话继续使用自己的用户记录，避免重试资料时误报邮箱已注册。
          if (signSession.createdUserId !== existingUser.id) {
            await logError(c, 'INFO', `Existing user found with email`, undefined, { token, email, existingUserId: existingUser.id });
          } else {
            await updateUser(c, existingUser.id, { name, email, phone: `${phoneCode}${phoneCode === '+61' && phoneToValidate.startsWith('0') ? phoneToValidate.slice(1) : phoneToValidate}` });
            await updateSignSession(c, token, { userIdToLink: existingUser.id });
          }
        } else {
          // 仅当用户不存在时，才处理创建账户的逻辑
          if (createAccount && (!password || !passwordConfirm)) {
            await logError(c, 'INFO', `Missing password for new user creation`, undefined, { token });
            throw new Error('创建账户时密码和确认密码是必填项。');
          }
          if (createAccount && password !== passwordConfirm) {
            await logError(c, 'INFO', `Password mismatch for new user creation`, undefined, { token });
            throw new Error('两次输入的密码不一致。');
          }
        }

        // 检查邮箱是否存在，并抛出特定错误以便前端处理
        if (!currentUser && existingUser && signSession.createdUserId !== existingUser.id) {
          await logError(c, 'INFO', `Email exists and user not forced to continue, returning EMAIL_EXISTS`, undefined, { token, email });
          throw new Error('该邮箱已注册，请直接登录或使用其他邮箱。');
        }

        const quotedOrder = await getOrderById(c, contract.rentalId)
        if (quotedOrder) await applyOrderRiskDeposit(c, quotedOrder, existingUser?.role === 'CUSTOMER' ? existingUser.id : undefined)

        // 保存用户信息到会话
        const windowsPassword = String(signSession.windowsPassword || generateWindowsPassword())
        const passwordHash = !currentUser && createAccount ? await hashPassword(String(password)) : ''
        await updateSignSession(c, token, {
          windowsPassword,
          // Do not persist the submitted password or the full request body in
          // sign_sessions. A PBKDF2 verifier is sufficient for the final user
          // creation step and cannot be used as the plaintext password.
          userInfo: {
            firstName: cleanFirstName,
            lastName: cleanLastName,
            name,
            email,
            createAccount,
            accountMode: selectedAccountMode,
            phone: phoneToValidate,
            fullPhone,
            referrer: String(referrer || '').trim().toUpperCase().slice(0, 64),
            ...(passwordHash ? { passwordHash } : {}),
            windowsPassword,
          },
        });
        await logError(c, 'INFO', `User information saved, proceeding to confirmation`, undefined, { token, email });

        redirectUrl = `/contract/sign?token=${token}&step=4`;
        break;

      case 3:
        // 兼容旧签名步骤链接，统一进入资料确认后的最终步骤。
        if (!signSession.agreedToTerms || !signSession.userInfo?.name) throw new Error('请先同意租赁协议并填写您的个人信息。');
        redirectUrl = `/contract/sign?token=${token}&step=4`;
        break;

      case 4:
        // Step 4: 确认取还时间并完成签约；合同签署流程不处理付款。
        await logError(c, 'DEBUG', `Processing step 4: Contract finalization without payment`, undefined, { token });
        await loadSystemSettingsFromDB(c)
        const signingOrder = await getOrderById(c, contract.rentalId)
        if (!signingOrder) throw new Error('合同关联的订单不存在。')
        const order = signingOrder

        if (!signSession.agreedToTerms || !signSession.userInfo?.name) {
          await logError(c, 'WARNING', `User attempted to access step 4 without accepting terms or completing personal information`, undefined, { token });
          throw new Error('请先填写您的个人信息。');
        }

        const noPayment = isWebsiteOrderContract
        const paymentMethod = String(body.paymentMethod || (order as any).paymentMethod || (order as any).payment_method || 'card')
        const storedPaymentProvider = String((order as any).paymentProvider || (order as any).payment_provider || '').toLowerCase()
        const squarePaymentSelected = paymentMethod === 'square' || storedPaymentProvider === 'square'
        const stripePaymentSelected = !squarePaymentSelected && (paymentMethod === 'stripe' || paymentMethod === 'card')
        const chosenBillingMode = order.rental_pricing_json ? JSON.parse(order.rental_pricing_json).billingMode : ''
        if (Number(order.rentalPeriod) >= 60 && chosenBillingMode === 'MONTHLY' && !stripePaymentSelected) throw new Error('月付请选择信用卡支付')
        const depositCardSelected = stripePaymentSelected || Boolean((order as any).stripe_payment_method_id || (order as any).stripe_deposit_payment_intent_id)
        // 押金处理方式不再由客户手选：跟着支付方式自动走——信用卡预授权 / SetupIntent，否则银行转账。
        // 礼品卡支付租金时，如果官网申请已经验证了押金信用卡，也沿用该卡处理押金。
        const depositMethod = normalizeSecurityDepositMethod(depositCardSelected ? 'card_hold' : 'bank_transfer')
        const enteredCouponCode = String(body.couponCode || '').trim().toUpperCase().slice(0, 40)
        const isDelivery = String((order as any).deliveryMethod || (order as any).delivery_method || 'Pickup') === 'Delivery'
        const rentalRules = await getDeviceRentalRules(c, order.deviceId)
        const allowedTimeSlots = isDelivery ? ['delivery_morning', 'delivery_afternoon'] : []
        const pickupTimeSlot = (isDelivery ? allowedTimeSlots.includes(String(body.pickupTimeSlot)) : Boolean(pickupTimeMode(String(body.pickupTimeSlot), rentalRules))) ? String(body.pickupTimeSlot) : ''
        const returnTimeSlot = (isDelivery ? allowedTimeSlots.includes(String(body.returnTimeSlot)) : Boolean(pickupTimeMode(String(body.returnTimeSlot), rentalRules))) ? String(body.returnTimeSlot) : ''
        const unavailableTimeSlots = rentalRules.unavailableTimeSlots || {}
        const unavailable = (date: string, slot: string) => isUnavailablePickupTime(slot, date, rentalRules) || (unavailableTimeSlots[date] || []).includes(slot) || (unavailableTimeSlots[date] || []).includes(legacyPickupSlot(slot, rentalRules))
        if (!pickupTimeSlot || !returnTimeSlot || isTimeSlotPassed(order.startDate, pickupTimeSlot) || isTimeSlotPassed(order.endDate, returnTimeSlot) || unavailable(order.startDate, pickupTimeSlot) || unavailable(order.endDate, returnTimeSlot)) throw new Error('请选择可用的取货和归还时间')
        const deliveryMethod = String((order as any).deliveryMethod || (order as any).delivery_method || 'Pickup')
        const serviceSlots = deliveryMethod === 'Delivery' ? 0 : [pickupTimeSlot, returnTimeSlot].filter(slot => pickupTimeMode(slot, rentalRules) === 'non_business').length
        const serviceFee = Number((Math.max(0, Number(order.totalAmount) - Number(order.depositAmount || 0)) * serviceFeeRate(rentalRules) * serviceSlots).toFixed(2))
        const previousServiceFee = Number((order as any).serviceFee || (order as any).service_fee || 0)
        if (serviceFee !== previousServiceFee) {
          const adjustedTotal = Number((Number(order.totalAmount) + serviceFee - previousServiceFee).toFixed(2))
          await c.env.RENT.prepare('UPDATE orders SET totalAmount = ?, serviceFee = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?').bind(adjustedTotal, serviceFee, contract.rentalId).run()
            ; (order as any).totalAmount = adjustedTotal
            ; (order as any).serviceFee = serviceFee
        }
        const canUseBalance = canUseAccountBalance(currentUser)
        const refundMethod = squarePaymentSelected && !depositCardSelected ? 'balance' : (order as any).refundMethod === 'balance' ? 'balance' : (canUseBalance && body.refundMethod !== 'original' ? 'balance' : 'original')
        const refundBsb = String(body.refundBsb || '').trim()
        const refundAccountNumber = String(body.refundAccountNumber || '').replace(/\s/g, '')
        const refundAccountName = String(body.refundAccountName || '').trim()
        const transferReference = String(body.transferReference || '').trim().slice(0, 100)
        const transferNote = String(body.transferNote || '').trim().slice(0, 500)
        let transferProofUrl = ''
        if (!paymentMethod) {
          await logError(c, 'INFO', `No payment method selected in step 3`, undefined, { token });
          throw new Error('请选择一种支付方式。');
        }
        const enabledMethods = [
          ...(getSystemSettings().paymentMethods.stripe ? ['stripe', 'card'] : []),
          ...(getSystemSettings().paymentMethods.square ? ['square'] : []),
          ...(getSystemSettings().paymentMethods.bankTransfer ? ['bank_transfer'] : []),
          ...(getSystemSettings().paymentMethods.alipay && getSystemSettings().rmbPayment.alipayQrUrl ? ['alipay'] : []),
          ...(getSystemSettings().paymentMethods.wechat && getSystemSettings().rmbPayment.wechatQrUrl ? ['wechat'] : []),
          ...(getSystemSettings().paymentMethods.balancePayment && canUseBalance ? ['balance'] : []),
        ]
        if (paymentMethod === 'balance' && !canUseBalance) throw new Error('只有已登录的正式客户账户可以使用余额支付')
        if (!enabledMethods.includes(paymentMethod)) throw new Error('所选支付方式当前不可用')
        if (stripePaymentSelected) await getStripeRuntimeConfig(c)
        if (squarePaymentSelected) await getSquareRuntimeConfig(c)
        if (paymentMethod === 'bank_transfer' && refundMethod === 'original') {
          if (!/^\d{3}-?\d{3}$/.test(refundBsb) || !/^\d{4,10}$/.test(refundAccountNumber) || !refundAccountName) {
            throw new Error('选择银行原路退款时，请填写正确的账户名、BSB 和银行账号')
          }
        }
        if (['bank_transfer', 'alipay', 'wechat'].includes(paymentMethod)) {
          if (!transferReference) throw new Error('请填写付款 Reference')
          try {
            transferProofUrl = body.transferProofFile
              ? await uploadCloudinaryImage(body.transferProofFile, await getCloudinaryRuntimeConfig(c), 'rent/payment-proofs', { watermark: true })
              : validateHostedImageUrls(body.transferProofUrl, 1)[0]
          } catch (error: any) { throw new Error(error.message || '请上传有效的付款凭证图片') }
        }

        if (depositMethod === 'card_hold' && !depositCardSelected) throw new Error('信用卡预授权押金需要先验证信用卡')
        const selectedDepositMode = depositMethod === 'card_hold' && depositCardSelected
          ? await resolveDepositPaymentMode(c, order)
          : 'PAID'
        await c.env.RENT.prepare('UPDATE orders SET deposit_method = ?, deposit_payment_mode = ?, deposit_status = CASE WHEN depositAmount > 0 THEN ? ELSE \'NOT_REQUIRED\' END WHERE id = ?')
          .bind(depositMethod, selectedDepositMode, selectedDepositMode === 'PAID' ? 'PENDING' : 'NOT_REQUIRED', contract.rentalId).run()
        ; (order as any).deposit_method = depositMethod
        ; (order as any).deposit_payment_mode = selectedDepositMode

        // **核心签约逻辑**
        const userInfo = signSession.userInfo;
        const userIdToLink = signSession.userIdToLink;
        const linkedUser = userIdToLink ? await getUserById(c, userIdToLink) : null
        // 新建合同时订单会暂时指向创建合同的员工；员工 ID 不能成为签约客户或 Stripe 客户。
        let userId = linkedUser?.role === 'CUSTOMER' ? userIdToLink : undefined;
        let guestPassword = String(signSession.guestPassword || '')

        // 1. 如果没有已存在的用户ID，则创建新用户
        if (!userId) {
          const newUserId = await generateUniqueUserId(c, 'CUSTOMER', userInfo.accountMode === 'guest' ? 'guest' : 'formal');
          userId = newUserId;
          await logError(c, 'INFO', `Creating new user for contract`, undefined, { token, newUserId, email: userInfo.email });

          // 处理推荐人关系
          let referrerId = null;
          if (userInfo.referrer) {
            const normalizedReferrerCode = userInfo.referrer.toUpperCase();
            const referrerUser = await c.env.RENT.prepare('SELECT * FROM users WHERE UPPER(referral_code) = ?').bind(normalizedReferrerCode).first();
            if (referrerUser) {
              referrerId = referrerUser.id;
              await logError(c, 'INFO', `Valid referrer found`, undefined, { token, referrerId, referrerCode: normalizedReferrerCode });
            } else {
              await logError(c, 'INFO', `Invalid referral code provided`, undefined, { token, referrerCode: normalizedReferrerCode });
            }
          }

          // 将referrerId保存到会话中，以便后续处理佣金
          await updateSignSession(c, token, { referrerId });

          // 仅当用户选择创建账户时才处理密码
          // let password_hash = null;
          // if (userInfo.createAccount && userInfo.password) {
          //   password_hash = await hashPassword(userInfo.password);
          // }

          const isGuest = userInfo.accountMode === 'guest'
          // Migrate an in-flight session created before passwordHash was stored.
          // New sessions never contain the raw password.
          if (!isGuest && !userInfo.passwordHash && userInfo.password) {
            userInfo.passwordHash = await hashPassword(String(userInfo.password))
            delete userInfo.password
            delete userInfo.passwordConfirm
            await updateSignSession(c, token, { userInfo })
          }
          if (!isGuest && !userInfo.passwordHash) throw new Error('正式账户密码信息已失效，请返回上一步重新设置。')
          if (isGuest && !guestPassword) {
            guestPassword = generateTemporaryPassword()
            await updateSignSession(c, token, { guestPassword })
          }
          const newUser: User = {
            id: newUserId,
            name: userInfo.name,
            email: userInfo.email,
            password: isGuest ? guestPassword : undefined,
            passwordHash: isGuest ? undefined : userInfo.passwordHash,
            // password_hash: password_hash ?? undefined,
            role: 'CUSTOMER',
            phone: userInfo.fullPhone,
            balance: 0,
            commissionBalance: 0,
            pendingCommission: 0,
            withdrawnCommission: 0,
            referralCode: null as any,
            referrerId: referrerId ?? null as any,
            // 历史合同的创建人可能已被删除；staff_id 有外键约束，只保存仍存在的员工/管理员。
            staffId: undefined,
            accountType: isGuest ? 'guest' : 'formal',
            guestOrderId: isGuest ? contract.rentalId : null,
            guestExpiresAt: isGuest ? signingOrder.endDate : null,
            createdAt: new Date().toISOString(),
            registrationDate: new Date().toISOString(),
          };
          const contractOwner = contract.createdBy || contract.created_by
          if (contractOwner) {
            const owner = await c.env.RENT.prepare("SELECT id FROM users WHERE id = ? AND role IN ('STAFF', 'ADMIN')").bind(contractOwner).first()
            if (owner) newUser.staffId = contractOwner
          }
          await insertUser(c, newUser);
          await updateSignSession(c, token, { userIdToLink: newUserId, createdUserId: newUserId });
          await logError(c, 'INFO', `New user created successfully`, undefined, { token, newUserId });
        } else {
          await logError(c, 'INFO', `Linking existing user to contract`, undefined, { token, userId });
          const contractOwner = contract.createdBy || contract.created_by
          if (contractOwner) {
            const owner = await c.env.RENT.prepare("SELECT id FROM users WHERE id = ? AND role IN ('STAFF', 'ADMIN')").bind(contractOwner).first()
            if (owner) {
              const linkedUser = await getUserById(c, userId)
              if (!linkedUser?.staffId) await updateUser(c, userId, { staffId: contractOwner })
            }
          }
        }

        const customerRisk = await getCustomerRiskAssessment(c, userId)
        if (customerRisk.blocked) throw new Error('该客户存在有效风控限制，暂时无法签署或创建租赁合同，请联系客服处理。')

        // 优惠码：此时客户真实身份（userId）才第一次确定，是核销优惠码（原子扣减 used_count
        // + 写入 coupon_redemptions RESERVED 记录）的正确时机。分两种情况：
        // 1) 建合同时已经预览过一个优惠码（coupon_code 有值但 coupon_id 还是空，说明尚未正式核销）：
        //    重新校验一遍（可能这期间过期、命中上限，或这个客户不满足每人限次/仅新客户等条件），
        //    通过就正式核销；不通过就摘掉优惠码、把总价恢复原价，不阻断签约。
        // 2) 客户在这一步自己第一次输入优惠码：跟客户自助结账一样，校验不通过就直接抛错阻断。
        const previewCouponCode = String((order as any).coupon_code || (order as any).couponCode || '').trim().toUpperCase()
        const previewAlreadyReserved = Boolean((order as any).coupon_id)
        if (previewCouponCode && !previewAlreadyReserved) {
          const previousDiscount = Number((order as any).discount_amount ?? (order as any).discountAmount ?? 0)
          try {
            const orderDevice = await getDeviceById(c, order.deviceId || (order as any).device_id)
            if (!orderDevice) throw new Error('订单关联的设备不存在')
            const rentAmountForCoupon = calculateRentalFee(orderDevice, Number(order.rentalPeriod || 0))
            const feeParts = {
              rentalFee: rentAmountForCoupon,
              deliveryFee: Number(order.deliveryFee || order.delivery_fee || 0),
              depositFee: Number(order.depositAmount || order.deposit_amount || 0),
            }
            const coupon = await findEligibleCoupon(c, previewCouponCode, orderDevice, feeParts)
            await checkCustomerCouponEligibility(c, coupon, userId)
            const discountAmount = calculateCouponDiscount(coupon, feeParts)
            await reserveCouponForOrder(c, { coupon, customerId: userId, orderId: contract.rentalId, discountAmount })
            const adjustment = discountAmount - previousDiscount
            if (adjustment !== 0) await c.env.RENT.prepare('UPDATE orders SET totalAmount = totalAmount - ? WHERE id = ?').bind(adjustment, contract.rentalId).run()
              ; (order as any).totalAmount = Number(order.totalAmount) - adjustment
          } catch (error: any) {
            await clearPreviewCouponFromOrder(c, contract.rentalId, previousDiscount)
              ; (order as any).totalAmount = Number(order.totalAmount) + previousDiscount
            await logError(c, 'INFO', `Preview coupon dropped at signing: ${error?.message || error}`, undefined, { token, orderId: contract.rentalId })
          }
        } else if (!previewCouponCode && enteredCouponCode) {
          const orderDevice = await getDeviceById(c, order.deviceId || (order as any).device_id)
          if (!orderDevice) throw new Error('订单关联的设备不存在')
          const rentAmountForCoupon = calculateRentalFee(orderDevice, Number(order.rentalPeriod || 0))
          const feeParts = {
            rentalFee: rentAmountForCoupon,
            deliveryFee: Number(order.deliveryFee || order.delivery_fee || 0),
            depositFee: Number(order.depositAmount || order.deposit_amount || 0),
          }
          const coupon = await findEligibleCoupon(c, enteredCouponCode, orderDevice, feeParts)
          await checkCustomerCouponEligibility(c, coupon, userId)
          const discountAmount = calculateCouponDiscount(coupon, feeParts)
          await reserveCouponForOrder(c, { coupon, customerId: userId, orderId: contract.rentalId, discountAmount })
          await c.env.RENT.prepare('UPDATE orders SET totalAmount = totalAmount - ? WHERE id = ?').bind(discountAmount, contract.rentalId).run()
            ; (order as any).totalAmount = Number(order.totalAmount) - discountAmount
        }

        // 2. 更新订单信息
        // 处理余额支付
        let orderStatus: Order['status'] = noPayment ? 'approved' : 'pending_payment';
        if (!noPayment && paymentMethod === 'balance') {
          const existingBalancePayment = await c.env.RENT.prepare("SELECT id FROM payments WHERE rental_id = ? AND payment_method = 'balance' AND status = 'paid' LIMIT 1").bind(contract.rentalId).first()
          if (existingBalancePayment) {
            orderStatus = 'paid'
          } else {
            // 获取用户当前余额
            const user = await c.env.RENT.prepare('SELECT balance FROM users WHERE id = ?').bind(userId).first() as any;
            const currentBalance = user?.balance || 0;
            // 获取订单总金额
            const rental = await c.env.RENT.prepare('SELECT totalAmount, depositAmount FROM orders WHERE id = ?').bind(contract.rentalId).first() as any;
            const totalAmount = Math.max(0, Number(rental?.totalAmount || 0) - Number(rental?.depositAmount || 0));

            if (currentBalance >= totalAmount) {
              // 扣除余额
              const deduction = await c.env.RENT.prepare(`
              UPDATE users SET balance = balance - ?, updated_at = CURRENT_TIMESTAMP
              WHERE id = ? AND balance >= ?
            `).bind(totalAmount, userId, totalAmount).run();
              const deducted = Number((deduction as any).meta?.changes ?? (deduction as any).changes ?? 0)
              if (deducted < 1) throw new Error('账户余额已发生变化，当前余额不足，请刷新后重试')
              orderStatus = 'paid'; // 余额支付成功，直接标记为已支付
              await recordBalanceTransaction(c, userId, -Number(totalAmount), 'rental_payment_debit', '账户余额支付租赁订单', null, Number((await c.env.RENT.prepare('SELECT balance FROM users WHERE id = ?').bind(userId).first() as any)?.balance || 0));
              await logError(c, 'INFO', `Balance payment processed successfully`, undefined, { token, userId, amount: totalAmount, remainingBalance: currentBalance - totalAmount });
            } else {
              await logError(c, 'WARNING', `Insufficient balance for payment`, undefined, { token, userId, balance: currentBalance, required: totalAmount });
              throw new Error('账户余额不足，无法使用余额支付');
            }
          }
        }

        if (noPayment || orderStatus === 'paid') {
          await c.env.RENT.prepare("UPDATE coupon_redemptions SET status = 'REDEEMED', redeemed_at = CURRENT_TIMESTAMP WHERE order_id = ? AND status = 'RESERVED'").bind(contract.rentalId).run()
        }

        await updateOrderInDB(c, contract.rentalId, {
          userId: userId,
          paymentMethod: (stripePaymentSelected || squarePaymentSelected ? 'card' : paymentMethod) as Order['paymentMethod'],
          paymentProvider: squarePaymentSelected ? 'square' : stripePaymentSelected ? 'stripe' : 'internal',
          status: orderStatus,
          // 合同已经通过 contracts.orderId 关联订单；不要在签署时写入可选的反向外键，
          // 兼容旧数据库中 contractId 外键定义不一致的订单表。
          contractId: null as any,
        });
        await c.env.RENT.prepare('UPDATE orders SET pickupTimeSlot = ?, returnTimeSlot = ? WHERE id = ?')
          .bind(pickupTimeSlot, returnTimeSlot, contract.rentalId).run()
        await c.env.RENT.prepare(`UPDATE orders SET refundMethod = ?, refundBsb = ?, refundAccountNumber = ?, refundAccountName = ? WHERE id = ?`)
          .bind(refundMethod, refundMethod === 'original' ? refundBsb || null : null, refundMethod === 'original' ? refundAccountNumber || null : null, refundMethod === 'original' ? refundAccountName || null : null, contract.rentalId).run()

        if (!noPayment && (paymentMethod === 'balance' || squarePaymentSelected || ['bank_transfer', 'alipay', 'wechat'].includes(paymentMethod))) {
          const paymentOrder = await c.env.RENT.prepare('SELECT totalAmount, depositAmount FROM orders WHERE id = ?').bind(contract.rentalId).first() as any
          const paymentTotal = Math.max(0, Number(paymentOrder?.totalAmount || 0) - Number(paymentOrder?.depositAmount || 0))
          const storedPaymentMethod = squarePaymentSelected ? 'card' : paymentMethod
          const provider = squarePaymentSelected ? 'square' : 'internal'
          const existingPayment = await c.env.RENT.prepare('SELECT id, status FROM payments WHERE rental_id = ? AND payment_method = ? AND payment_provider = ? ORDER BY created_at DESC LIMIT 1').bind(contract.rentalId, storedPaymentMethod, provider).first() as any
          const paymentId = existingPayment?.id || `p-${nanoid(12)}`
          if (!existingPayment) {
            await c.env.RENT.prepare(`
              INSERT INTO payments (id, rental_id, customer_id, payment_method, payment_provider, amount, deposit_amount, rental_amount, currency, status, transaction_id, paid_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'AUD', ?, ?, ?)
            `).bind(
              paymentId, contract.rentalId, userId, storedPaymentMethod, provider,
              paymentTotal, 0, paymentTotal,
              paymentMethod === 'balance' ? 'paid' : 'pending', paymentMethod === 'balance' ? generateReferenceNumber('TXN') : null, paymentMethod === 'balance' ? new Date().toISOString() : null
            ).run()
          }
          if (['bank_transfer', 'alipay', 'wechat'].includes(paymentMethod)) {
            const rate = await getAudCnyRate()
            const cnyAmount = roundCnyUp(paymentTotal, rate)
            const paymentNote = `${transferNote}${transferNote ? '；' : ''}人民币金额：CNY ${cnyAmount.toFixed(2)}，汇率：1 AUD = ${rate.toFixed(6)} CNY`
            const existingProof = await c.env.RENT.prepare("SELECT id FROM payment_proofs WHERE payment_id = ? AND status = 'submitted' ORDER BY uploaded_at DESC LIMIT 1").bind(paymentId).first() as any
            if (existingProof) {
              await c.env.RENT.prepare("UPDATE payment_proofs SET reference_number = ?, note = ?, image_url = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
                .bind(transferReference, paymentNote || null, transferProofUrl, existingProof.id).run()
            } else {
              await c.env.RENT.prepare("INSERT INTO payment_proofs (id, payment_id, reference_number, note, image_url, status) VALUES (?, ?, ?, ?, ?, 'submitted')")
                .bind(`proof-${nanoid(12)}`, paymentId, transferReference, paymentNote || null, transferProofUrl).run()
            }
            const admins = (await c.env.RENT.prepare("SELECT id FROM users WHERE role = 'ADMIN' AND status = 'active'").all()).results || []
            await Promise.all((admins as any[]).map(admin => createNotification(c, { recipientId: admin.id, type: 'payment_review_submitted', title: '新的付款凭证待审核', message: `客户已提交订单 ${order.orderNo || order.id} 的付款凭证，请及时审核。`, orderId: order.id })))
          }
        }
        let stripePayment: { clientSecret?: string; publishableKey?: string; setupIntent?: boolean } | null = null
        if (!noPayment && stripePaymentSelected) {
          const stripeUser = await getUserById(c, userId)
          if (!stripeUser) throw new Error('无法读取付款用户信息')
          const setupIntentId = String(body.stripeSetupIntentId || '').trim()
          if (selectedDepositMode === 'SETUP_INTENT' && !(order as any).stripe_payment_method_id && !setupIntentId) {
            const setup = await createOrderSetupIntent(c, stripeUser, contract.rentalId)
            stripePayment = { clientSecret: setup.clientSecret, publishableKey: setup.publishableKey, setupIntent: true }
          } else {
            const intent = setupIntentId
              ? await completeOrderSetupIntent(c, stripeUser, contract.rentalId, setupIntentId)
              : await createOrderPaymentIntent(c, stripeUser, contract.rentalId, Boolean((order as any).stripe_payment_method_id))
            if (!intent.alreadyPaid && intent.clientSecret) stripePayment = { clientSecret: intent.clientSecret, publishableKey: intent.publishableKey }
          }
        }
        if (!noPayment && paymentMethod === 'balance') {
          await ensureOrderNumber(c, contract.rentalId)
          // 开票失败不能中断签约完成流程（下面还要继续更新合同状态），也不能只靠
          // console.error 消失不见——同类教训见 8f746d9。
          await issueInvoice(c, contract.rentalId).catch(error => logError(c, 'CRITICAL', 'issueInvoice failed after balance payment during contract signing', error, { orderId: contract.rentalId }))
          await enqueueRentalUserCreation(c, await getOrderById(c, contract.rentalId))
        }
        await logError(c, 'INFO', `Order updated with user and payment method`, undefined, {
          token,
          orderId: contract.rentalId,
          userId,
          paymentMethod,
          status: orderStatus
        });

        // 3. 更新合同状态
        const esignIp = (c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For')?.split(',')[0] || '').trim().slice(0, 64)
        const esignDevice = (c.req.header('User-Agent') || '').trim().slice(0, 500)
        const browser = /Edg\//.test(esignDevice) ? 'Edge' : /Chrome\//.test(esignDevice) ? 'Chrome' : /Firefox\//.test(esignDevice) ? 'Firefox' : /Safari\//.test(esignDevice) ? 'Safari' : 'Other'
        const os = /Windows/.test(esignDevice) ? 'Windows' : /Mac OS|Macintosh/.test(esignDevice) ? 'macOS' : /Android/.test(esignDevice) ? 'Android' : /iPhone|iPad/.test(esignDevice) ? 'iOS' : /Linux/.test(esignDevice) ? 'Linux' : 'Other'
        const existingData = typeof contract.contract_data === 'string' ? JSON.parse(contract.contract_data || '{}') : (contract.contract_data || {})
        const signerName = String(userInfo.name || '').trim()
        const customerInitials = signerName.split(/\s+/).filter(Boolean).map((part: string) => part[0]).join('').toUpperCase().slice(0, 8)
        const signedData = {
          ...existingData,
          windows_username: String(userInfo.name || '').trim(),
          // 密码只以 AES-GCM 密文写入 D1；页面/设备命令在授权路径上临时解密。
          windows_password: await encryptSecret(c, String(userInfo.windowsPassword || '').trim()),
          guest_password: await encryptSecret(c, guestPassword || existingData.guest_password || ''),
          signer_name: signerName,
          customer_initials: existingData.customer_initials || customerInitials,
          esign_browser: browser,
          esign_os: os,
          agreement_version: existingData.agreement_version || '1.0',
          privacy_policy_accepted: true,
          privacy_policy_version: contract.privacy_policy_version || '1.0',
          privacy_policy_accepted_at: contract.privacy_policy_accepted_at || new Date().toISOString(),
          privacy_policy_accepted_ip: contract.privacy_policy_accepted_ip || esignIp || ''
        }
        await c.env.RENT.prepare(`UPDATE contracts SET esign_ip = ?, esign_device = ?, contract_data = ? WHERE id = ?`)
          .bind(esignIp || null, esignDevice || null, JSON.stringify(signedData), contract.id).run()
        const signedAt = new Date().toISOString()
        const signedContractNumber = generateContractNumber(new Date(signedAt))
        const signedOrder = await getOrderById(c, contract.rentalId)
        const signedDevice = signedOrder ? await getDeviceById(c, signedOrder.deviceId) : null
        const signedCustomer = await getUserById(c, userId)
        const signedContract = {
          ...contract, contract_data: signedData, esign_ip: esignIp, esign_device: esignDevice, signedAt,
          privacy_policy_accepted: true,
          privacy_policy_version: signedData.privacy_policy_version,
          privacy_policy_accepted_at: signedData.privacy_policy_accepted_at,
          privacy_policy_accepted_ip: signedData.privacy_policy_accepted_ip,
        }
        const signedContent = renderContractVariables(contract.content, signedContract, signedOrder, signedDevice, signedCustomer, signedOrder ? await getContractVariableData(c, signedContract, signedOrder) : {})
        const contentHash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(signedContent))), byte => byte.toString(16).padStart(2, '0')).join('')
        const verificationToken = `${crypto.randomUUID().replaceAll('-', '')}${crypto.randomUUID().replaceAll('-', '')}`
        await c.env.RENT.prepare('UPDATE contracts SET signed_content = ?, content_hash = ?, verification_token = ? WHERE id = ?').bind(signedContent, contentHash, verificationToken, contract.id).run()
        await updateContractStatusInDB(c, contract.id, 'signed', signedAt);
        await c.env.RENT.prepare('UPDATE contracts SET contractNumber = ? WHERE id = ? AND status = \'signed\'').bind(signedContractNumber, contract.id).run()
        await logError(c, 'INFO', `Contract signed successfully`, undefined, { token, contractId: contract.id });


        // 推荐关系在注册时锁定；签约不再把旧“佣金”直接入账。
        const referrerId = signSession.referrerId as string | null;
        const newUserId = userId;

        await lockReferralRelationship(c, referrerId, newUserId, String(userInfo.referrer || ''))

        // 5. 清理会话
        // 长期租赁首次输入卡片时，SetupIntent 成功后还需要用同一签约会话
        // 回传 setup_intent id，再收取租金；收到该 id 后才清理会话。
        if (!(stripePayment && stripePayment.setupIntent)) await deleteSignSession(c, token);
        signingCompleted = true;
        await logError(c, 'INFO', `Sign session deleted after successful completion`, undefined, { token });

        const draftCookie = 'contract_sign_draft=; Path=/contract/sign; Max-Age=0; SameSite=Lax'
        const secure = new URL(c.req.url).protocol === 'https:' ? '; Secure' : ''
        // 异步 Stripe 模式：返回 JSON，前端负责新标签页打开 Stripe、原地展示等待面板。
        if (wantsJson) {
          const res = c.json({
            ok: true,
            stripe: stripePayment,
            orderId: contract.rentalId,
            contractNumber: signedContractNumber,
            guest: guestPassword ? { email: userInfo.email, password: guestPassword } : null,
            redirectTarget: noPayment ? `/customer/orders/${contract.rentalId}` : `/payment/result?orderId=${encodeURIComponent(contract.rentalId)}`,
            resultUrl: noPayment ? `/customer/orders/${encodeURIComponent(contract.rentalId)}` : `/payment/result?orderId=${encodeURIComponent(contract.rentalId)}`,
          })
          res.headers.append('Set-Cookie', draftCookie)
          if (guestPassword) {
            const session = await createAuthSession(c, userId)
            res.headers.append('Set-Cookie', `session=${session.token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${session.maxAge}${secure}`)
          }
          return res
        }
        if (guestPassword) {
          const paymentUrl = noPayment ? `/customer/orders/${encodeURIComponent(contract.rentalId)}` : `/payment/result?orderId=${encodeURIComponent(contract.rentalId)}`
          const guestActionText = noPayment ? '查看订单详情' : '查看付款结果'
          const guestPage = `<div class="entity-header"><div class="identity-strip mono"><span>GUEST ACCESS / READY</span><span>有效至 ${order.endDate}</span></div><div class="entity-heading"><div><p class="section-code">TEMPORARY ACCOUNT</p><h2>合同已完成签署</h2><p>请立即保存以下临时登录资料。为保护账户安全，密码离开本页后不再显示。</p></div><span class="badge badge-warning">访客账户</span></div></div><div class="panel guest-credential-card"><div class="grid grid-2"><div><span class="section-note">登录账号</span><strong class="guest-credential-value">${escapeHtml(userInfo.email)}</strong></div><div><span class="section-note">临时密码</span><strong class="guest-credential-value mono">${escapeHtml(guestPassword)}</strong></div></div><div class="alert" style="margin-top:18px">该账户只可查看和下载本次合同、订单与收据，并将在租期结束后自动失效。登录后可设置新密码升级为正式账户。</div><div class="record-actions"><a class="button button-secondary" href="/login">访客登录</a><a class="button" href="${paymentUrl}">${guestActionText}</a></div></div>`
          const response = c.html(buildLayout('保存访客登录资料', guestPage))
          response.headers.append('Set-Cookie', draftCookie)
          const session = await createAuthSession(c, userId)
          response.headers.append('Set-Cookie', `session=${session.token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${session.maxAge}${secure}`)
          return response
        }
        if (stripePayment) {
          // 无 JS 兜底：跳到订单详情页，那里有站内 Payment Element 收款盒子。
          const response = c.redirect(`/customer/orders/${contract.rentalId}`, 303)
          response.headers.append('Set-Cookie', draftCookie)
          return response
        }
        redirectUrl = noPayment ? `/customer/orders/${contract.rentalId}` : `/payment/result?orderId=${encodeURIComponent(contract.rentalId)}`;
        await logError(c, 'INFO', `Contract signing process completed successfully`, undefined, {
          token,
          contractId: contract.id,
          orderId: contract.rentalId,
          redirectUrl
        });
        break;

      default:
        await logError(c, 'WARNING', `Invalid step encountered`, undefined, { token, step });
        throw new Error('无效的步骤。');
    }
  } catch (e: any) {
    errorMessage = e.message;
    await logError(c, 'ERROR', `Error in contract signing process`, e as Error, {
      token,
      step,
      errorMessage
    });

    // 异步 Stripe 提交出错：返回 JSON，前端就地提示，不整页跳错误页。
    if (wantsJson) {
      return c.json({ ok: false, error: errorMessage || '提交失败，请重试' }, 400)
    }
    // 如果出错，重定向回当前步骤并显示错误消息
    const stepToRedirect = (step > 1 && step <= 5) ? step : 1;
    redirectUrl = `/contract/sign?token=${token}&step=${stepToRedirect}&error=${encodeURIComponent(errorMessage || '')}`;
  }

  return new Response(null, {
    status: 302,
    headers: {
      'Location': redirectUrl,
      ...(signingCompleted ? { 'Set-Cookie': 'contract_sign_draft=; Path=/contract/sign; Max-Age=0; SameSite=Lax' } : {}),
    },
  });
}
