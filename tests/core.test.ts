/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

import test from 'node:test'
import assert from 'node:assert/strict'
import styles from '../src/styles.css'
import { buildLayout, canTransitionOrder, ensureOrderNumber, findUserBySession, getContractBySignToken, hashPassword, verifyPassword, isStrongPassword, generateTemporaryPassword, isContractExpired, isContractFinalized, renderContractVariables, renderSiteVariables, CONTRACT_VARIABLE_GROUPS, CONTRACT_VARIABLE_NAMES, validateHostedImageUrls, sanitizePlainText, sanitizeRichHtml, createPageBreakHtml, updateOrder, loadSystemSettingsFromDB, splitPersonName, canUseAccountBalance, getAccountTypeDisplay, getCustomerSigningUser, getContractCustomerSnapshot, cancelExpiredPendingBalanceTopUps } from '../src/site'
import { generateWindowsPassword } from '../src/lib/password'
import { decryptSecret, encryptSecret, isEncryptedSecret } from '../src/lib/secretBox'
import { renderAdminSettings } from '../src/pages/admin/settings'
import { renderAdminApiSettings } from '../src/pages/admin/apiSettings'
import { renderAdminDeviceCalendar } from '../src/pages/admin/deviceCalendar'
import { renderAdminContracts } from '../src/pages/admin/contracts'
import { renderAdminDataRetention } from '../src/pages/admin/dataRetention'
import { renderAdminAgreementEditor, renderAdminTemplateHub } from '../src/pages/admin/templates'
import { renderAdminUserNew } from '../src/pages/admin/userNew'
import { renderAdminUserEdit } from '../src/pages/admin/userEdit'
import { renderAdminDeviceNew } from '../src/pages/admin/deviceNew'
import { renderAdminDeviceEdit } from '../src/pages/admin/deviceEdit'
import { renderStaffCustomerNew } from '../src/pages/staff/customerNew'
import { renderRegister } from '../src/pages/public/register'
import { renderNewContractPage } from '../src/pages/staff/newContract'
import { renderAdminOrderReview } from '../src/pages/admin/orderReview'
import { renderAdminOrders } from '../src/pages/admin/orders'
import { renderStaffContracts } from '../src/pages/staff/contracts'
import { renderStaffMobileOperations } from '../src/pages/staff/mobileOperations'
import { renderStaffMobileScan } from '../src/pages/staff/mobileScan'
import { buildPickupQrPayload, parsePickupQrPayload } from '../src/lib/pickupQr'
import { renderStaffCustomerDetail } from '../src/pages/staff/customerDetail'
import { renderStaffOrdersOngoing } from '../src/pages/staff/ordersPending'
import { renderStaffDevices } from '../src/pages/staff/devices'
import { renderStaffCustomerEdit } from '../src/pages/staff/customerEdit'
import { allocateProportionalRefund, balanceAfterPriceAdjustment, paidRentalPaymentCoversOrder, refundableDepositFee, stripeAuthorizationAmount, stripeCheckoutItems, stripePaymentAmounts, stripeCustomerProfile, stripeDepositSettlementCaptureAmount, summarizeOrderPriceAdjustment, resolveOrderPriceAdjustmentRefundMethod } from '../src/actions/stripePayments'
import { renderCustomerReferral } from '../src/pages/customer/referral'
import { getBankRefundPrefill, readContractSignDraft, renderSigningProgress } from '../src/pages/public/contractSign'
import { paymentResultState, selectPaymentResultPayment } from '../src/pages/public/paymentResult'
import { renderOrderStatusFeedback } from '../src/pages/admin/orderStatusFeedback'
import { renderStaffInspection } from '../src/pages/staff/inspection'
import { renderGuestAccount } from '../src/pages/customer/guestAccount'
import { depositAuthorizationWindowDays, depositPaymentModeForRental, normalizeSecurityDepositMethod } from '../src/domain/paymentPlan'
import { isPickupHoldExpired, returnOverdueDays } from '../src/domain/pickupHold'
import { extractInlineScripts } from './helpers'
import { couponApplicableComponents, couponDiscountableBase } from '../src/actions/coupons'
import { formatInvoicePaymentMethods } from '../src/pages/invoice'
import { renderLogin } from '../src/pages/public/login'
import { normalizeUserRow } from '../src/db/repositories'
import { pickupTimeSlotEndMinutes, pickupTimeSlots } from '../src/domain/pickupTimeSlots'

function assertInlineScriptsParse(html: string) {
  const scripts = extractInlineScripts(html).map(script => script.trim()).filter(Boolean)
  assert.ok(scripts.length > 0)
  for (const script of scripts) assert.doesNotThrow(() => new Function(script))
}

test('receipt payment summary includes every paid payment method', () => {
  assert.equal(formatInvoicePaymentMethods([
    { payment_method: 'card', payment_provider: 'stripe' },
    { payment_method: 'balance' },
    { payment_method: 'card', payment_provider: 'stripe' },
  ]), '信用卡 + 账户余额')
  assert.equal(formatInvoicePaymentMethods([{ payment_method: 'card', payment_provider: 'square' }]), '礼品卡')
  assert.equal(formatInvoicePaymentMethods([{ payment_method: 'wechat' }]), '微信支付')
})

test('legacy pickup slots remain available after exact-time settings are enabled', () => {
  const rules = {
    businessHours: { start: '09:00', end: '20:00' },
    serviceFeeHours: [{ start: '07:00', end: '08:00' }, { start: '21:00', end: '23:00' }],
    serviceFeeRate: 0.1,
  }
  assert.deepEqual(pickupTimeSlots(rules).map(([value]) => value), ['morning_service', 'morning', 'afternoon', 'evening_service'])
  assert.equal(pickupTimeSlotEndMinutes('morning_service', rules), 8 * 60)
  assert.equal(pickupTimeSlotEndMinutes('afternoon', rules), 20 * 60)
  assert.equal(pickupTimeSlotEndMinutes('19:30', rules), 19 * 60 + 30)
})

test('store pickup holds expire two Melbourne hours after the scheduled exact time', () => {
  const order = { startDate: '2026-10-05', pickupTimeSlot: '09:30', deliveryMethod: 'Pickup' }
  assert.equal(isPickupHoldExpired(order, new Date('2026-10-05T00:29:00Z')), false) // 11:29 AEDT
  assert.equal(isPickupHoldExpired(order, new Date('2026-10-05T00:30:00Z')), true) // 11:30 AEDT
  assert.equal(isPickupHoldExpired({ startDate: '2026-10-05', pickupTimeSlot: '23:30' }, new Date('2026-10-05T14:30:00Z')), true)
  assert.equal(isPickupHoldExpired({ ...order, deliveryMethod: 'Delivery' }, new Date('2026-10-05T00:30:00Z')), false)
})

test('return becomes overdue after its two-hour grace period and rents accrue from the next day', () => {
  const order = { endDate: '2026-10-05', returnTimeSlot: '20:00' }
  assert.equal(returnOverdueDays(order, new Date('2026-10-05T10:59:00Z')), null) // 21:59 AEDT
  assert.equal(returnOverdueDays(order, new Date('2026-10-05T11:01:00Z')), 0)
  assert.equal(returnOverdueDays(order, new Date('2026-10-06T01:00:00Z')), 1)
})

test('login preserves a safe internal redirect for protected pages', () => {
  const html = renderLogin(undefined, false, '/orders/o-1/invoice/print')
  assert.match(html, /name="redirect" value="\/orders\/o-1\/invoice\/print"/)
  assert.match(renderLogin(undefined, false, 'https://example.com/steal'), /name="redirect" value=""/)
})

test('normalised users never expose credential material', () => {
  const user = normalizeUserRow({
    id: 'u-1', name: '客户', email: 'customer@example.com', role: 'CUSTOMER', status: 'active', balance: 0,
    commission_balance: 0, password_hash: 'pbkdf2$100000$salt$hash', password_salt: 'legacy', password: 'plaintext',
  })
  assert.equal('password_hash' in user, false)
  assert.equal('password_salt' in user, false)
  assert.equal('passwordHash' in user, false)
  assert.equal('password' in user, false)
})

test('coupon fee components default to rental and support delivery/deposit selections', () => {
  assert.deepEqual([...couponApplicableComponents({ applicable_components: '' })], ['RENTAL_FEE'])
  assert.equal(couponDiscountableBase(
    { applicable_components: 'DELIVERY_FEE,DEPOSIT_FEE' },
    { rentalFee: 100, deliveryFee: 20, depositFee: 50 },
  ), 70)
  assert.equal(couponDiscountableBase(
    { applicable_components: 'DELIVERY_FEE,UNKNOWN' },
    { rentalFee: 100, deliveryFee: 20, depositFee: 50 },
  ), 20)
})

test('PBKDF2 passwords verify without storing plaintext', async () => {
  const hash = await hashPassword('A-secure-password-123')
  assert.match(hash, /^pbkdf2\$100000\$/)
  assert.equal(await verifyPassword('A-secure-password-123', hash), true)
  assert.equal(await verifyPassword('wrong-password', hash), false)
  assert.equal(await verifyPassword('A-secure-password-123', 'pbkdf2$210000$salt$hash'), false)
})

test('sensitive database values are encrypted at rest and legacy plaintext remains readable', async () => {
  const context = { env: { SETTINGS_ENCRYPTION_KEY: 'test-settings-encryption-key' } } as any
  const encrypted = await encryptSecret(context, 'Windows-Secret-42!')
  assert.equal(isEncryptedSecret(encrypted), true)
  assert.notEqual(encrypted, 'Windows-Secret-42!')
  assert.equal(await decryptSecret(context, encrypted), 'Windows-Secret-42!')
  assert.equal(await decryptSecret(context, 'legacy-secret'), 'legacy-secret')
})

test('only customer accounts are treated as contract signers', () => {
  const staff = { id: 'staff-1', name: 'Minkang He', role: 'ADMIN' }
  const customer = { id: 'customer-1', name: '真实客户', role: 'CUSTOMER' }
  assert.equal(getCustomerSigningUser(staff as any), null)
  assert.equal(getCustomerSigningUser(customer as any), customer)
})

test('Stripe customer profile uses the real customer identity', () => {
  const profile = stripeCustomerProfile({ id: 'customer-1', name: '真实客户', email: 'customer@example.com', phone: '+61412345678' })
  assert.equal(profile.get('name'), '真实客户')
  assert.equal(profile.get('email'), 'customer@example.com')
  assert.equal(profile.get('phone'), '+61412345678')
  assert.equal(profile.get('metadata[user_id]'), 'customer-1')
})

test('new account passwords require letters, numbers, symbols, and eight characters', () => {
  assert.equal(isStrongPassword('Abcd123!'), true)
  assert.equal(isStrongPassword('abcdefg!'), false)
  assert.equal(isStrongPassword('1234567!'), false)
  assert.equal(isStrongPassword('Abcd1234'), false)
  assert.equal(isStrongPassword('Ab1!'), false)
  assert.equal(isStrongPassword('Abcd123 '), false)
})

test('only logged-in formal customers can use account balance', () => {
  assert.equal(canUseAccountBalance(undefined), false)
  assert.equal(canUseAccountBalance({ role: 'CUSTOMER', accountType: 'guest' }), false)
  assert.equal(canUseAccountBalance({ role: 'CUSTOMER', account_type: 'deleted_guest' }), false)
  assert.equal(canUseAccountBalance({ role: 'STAFF', accountType: 'formal' }), false)
  assert.equal(canUseAccountBalance({ role: 'CUSTOMER', accountType: 'formal' }), true)
  assert.equal(canUseAccountBalance({ role: 'CUSTOMER' }), true)
  assert.equal(canUseAccountBalance({ role: 'customer', account_type: 'FORMAL' }), true)
})

test('account type shows deletion requests before the stored account type', () => {
  assert.deepEqual(getAccountTypeDisplay({ accountType: 'formal' }), { text: '正式账户', class: 'badge-success' })
  assert.deepEqual(getAccountTypeDisplay({ accountType: 'guest' }), { text: '访客/临时账户', class: 'badge-warning' })
  assert.deepEqual(getAccountTypeDisplay({ accountType: 'formal', deletion_scheduled_at: '2026-09-20T00:00:00.000Z' }), { text: '申请删除', class: 'badge-danger' })
})

test('session lookup loads the complete user without schema probes', async () => {
  const statements: string[] = []
  const db = { prepare(sql: string) { statements.push(sql); return { bind() { return this }, async run() { return { success: true } }, async first() { return sql.includes('auth_sessions') ? { user_id: 'guest-1' } : { id: 'guest-1', name: 'Guest', email: 'guest@example.com', role: 'CUSTOMER', status: 'active', account_type: 'guest', guest_order_id: 'order-1', bsb: '062-001', account: '12345678' } } } } }
  const user = await findUserBySession({ env: { RENT: db } } as any, `session=${'a'.repeat(32)}`)
  assert.equal(user?.accountType, 'guest')
  assert.equal(user?.guestOrderId, 'order-1')
  assert.equal(user?.accountNumber, '12345678')
  assert.equal(statements.some(sql => /PRAGMA table_info/i.test(sql)), false)
  assert.equal(statements.filter(sql => /SELECT \* FROM users/i.test(sql)).length, 1)
})

test('guest passwords are strong and generated independently', () => {
  const first = generateTemporaryPassword()
  const second = generateTemporaryPassword()
  assert.match(first, /^(?=.*[A-Z])(?=.*[a-z])(?=.*\d)[A-Za-z\d]{8}$/)
  assert.match(second, /^(?=.*[A-Z])(?=.*[a-z])(?=.*\d)[A-Za-z\d]{8}$/)
  assert.notEqual(first, second)
})

test('Windows passwords are 8 characters, random, and contain all required character classes', () => {
  const first = generateWindowsPassword()
  const second = generateWindowsPassword()
  assert.match(first, /^(?=.*[A-Z])(?=.*[a-z])(?=.*\d)(?=.*[^A-Za-z0-9\s])\S{8}$/)
  assert.match(second, /^(?=.*[A-Z])(?=.*[a-z])(?=.*\d)(?=.*[^A-Za-z0-9\s])\S{8}$/)
  assert.notEqual(first, second)
})

test('guest sessions show their deletion date and only the guest workspace navigation', () => {
  const html = buildLayout('访客合同中心', '<p>guest</p>', {
    id: 'guest-1', name: 'Guest User', email: 'guest@example.com', role: 'CUSTOMER',
    balance: 0, commissionBalance: 0, accountType: 'guest', guestOrderId: 'order-1', guestExpiresAt: '2026-09-30',
  } as any)
  assert.match(html, /访客（2026-09-30删除）/)
  assert.match(html, /访客合同中心/)
  assert.doesNotMatch(html, /推荐计划/)
  assert.doesNotMatch(html, /个人资料/)
})

test('staff and admin mobile navigation keeps only core rental operations', () => {
  const adminHtml = buildLayout('管理员页面', '<p>admin</p>', {
    id: 'admin-1', name: 'Admin User', email: 'admin@example.com', role: 'ADMIN',
  } as any)
  const staffHtml = buildLayout('员工页面', '<p>staff</p>', {
    id: 'staff-1', name: 'Staff User', email: 'staff@example.com', role: 'STAFF',
  } as any)
  for (const html of [adminHtml, staffHtml]) {
    const mobileNav = html.slice(html.indexOf('<nav class="mobile-bottom-nav"'), html.indexOf('</nav>', html.indexOf('<nav class="mobile-bottom-nav"')))
    assert.match(mobileNav, /href="\/staff\/mobile"[^>]*>.*今日订单/s)
    assert.match(mobileNav, /href="\/staff\/mobile\/pickup"[^>]*>.*取货/s)
    assert.match(mobileNav, /href="\/staff\/mobile\/return"[^>]*>.*归还/s)
    assert.match(mobileNav, /href="\/staff\/mobile\/scan"[^>]*>.*扫码/s)
    assert.match(mobileNav, /href="\/staff\/inspections"[^>]*>.*验机/s)
    assert.doesNotMatch(mobileNav, /通知|设置|客户|合同/)
    assert.match(html, /class="sidebar sidebar--desktop"/)
    assert.match(html, /class="sidebar sidebar--mobile"/)
    const desktopSidebar = html.slice(html.indexOf('<aside class="sidebar sidebar--desktop"'), html.indexOf('</aside>', html.indexOf('<aside class="sidebar sidebar--desktop"')))
    assert.doesNotMatch(desktopSidebar, /href="\/staff\/mobile(?:\?|\")|href="\/staff\/mobile\/scan"|>今日订单<\/a>|>取货<\/a>|>归还<\/a>|>扫码<\/a>/)
  }

  const customerHtml = buildLayout('客户页面', '<p>customer</p>', {
    id: 'customer-1', name: 'Customer User', email: 'customer@example.com', role: 'CUSTOMER',
  } as any)
  const customerMobileNav = customerHtml.slice(customerHtml.indexOf('<nav class="mobile-bottom-nav"'), customerHtml.indexOf('</nav>', customerHtml.indexOf('<nav class="mobile-bottom-nav"')))
  assert.match(customerMobileNav, /href="\/customer\/dashboard"[^>]*>.*首页/s)
  assert.match(customerMobileNav, /href="\/customer\/rentals"[^>]*>.*租赁/s)
  assert.match(customerMobileNav, /href="\/customer\/profile"[^>]*>.*我的/s)
})

test('mobile staff operations page renders a fast searchable task list', async () => {
  let query = ''
  const db = {
    prepare(sql: string) {
      query = sql
      return {
        bind() { return this },
        async all() {
          return { results: [
            { order_id: 'pickup-1', order_no: 'OD-PICKUP', status: 'pending_pickup', customer_name: '张三', device_name: 'Laptop A', task_type: 'pickup', task_slot: 'morning' },
            { order_id: 'return-1', order_no: 'OD-RETURN', status: 'active', customer_name: '李四', device_name: 'Laptop B', task_type: 'return', task_slot: 'afternoon' },
          ] }
        },
      }
    },
  }
  const html = await renderStaffMobileOperations({ req: { query: () => '' }, env: { RENT: db } } as any, { id: 'staff-1', name: 'Staff', role: 'STAFF' })
  assert.match(query, /date\(o\.startDate\) = \?/)
  assert.match(query, /date\(o\.endDate\) = \?/)
  assert.match(html, /今日租赁任务/)
  assert.match(html, /OD-PICKUP[\s\S]*去取货/)
  assert.match(html, /OD-RETURN[\s\S]*去验机/)
  assert.match(html, /name="q"/)
  assert.match(html, /扫码或搜索订单号、客户、设备/)
  assert.match(html, /class="sidebar sidebar--desktop"/)
})

test('mobile scan page uses the camera and routes pickup QR payloads', () => {
  const html = renderStaffMobileScan({} as any, { id: 'staff-1', name: 'Staff', role: 'STAFF' })
  assert.match(html, /<title>扫码作业 - 电脑租赁管理系统<\/title>/)
  assert.match(html, /getUserMedia/)
  assert.match(html, /Html5Qrcode/)
  assert.match(html, /\/staff\/mobile\/scan\?code=/)
  assertInlineScriptsParse(html)
  const payload = buildPickupQrPayload('o-abc_123')
  assert.equal(parsePickupQrPayload(payload), 'o-abc_123')
  const directUrl = buildPickupQrPayload('o-abc_123', 'https://rent.example.test/notifications')
  assert.equal(directUrl, 'https://rent.example.test/pickup/o-abc_123')
  assert.equal(parsePickupQrPayload(directUrl), 'o-abc_123')
  assert.equal(parsePickupQrPayload('not-a-rental-code'), '')
  const retryHtml = renderStaffMobileScan({} as any, { id: 'staff-1', name: 'Staff', role: 'STAFF' }, '请核实输入信息是否正确')
  assert.match(retryHtml, /请核实输入信息是否正确/)
  assert.match(retryHtml, />继续扫码</)
})

test('admin exception center belongs to system settings navigation', () => {
  const html = buildLayout('管理员页面', '<p>admin</p>', {
    id: 'admin-1', name: 'Admin User', email: 'admin@example.com', role: 'ADMIN',
  } as any)
  const financeGroup = html.slice(html.indexOf('<summary>财务管理'), html.indexOf('</details>', html.indexOf('<summary>财务管理')))
  const systemGroup = html.slice(html.indexOf('<summary>系统设置'), html.indexOf('</details>', html.indexOf('<summary>系统设置')))
  assert.doesNotMatch(financeGroup, /异常任务中心/)
  assert.match(systemGroup, /异常任务中心/)
})

test('admin notification settings is available from notification navigation', () => {
  const html = buildLayout('管理员页面', '<p>admin</p>', {
    id: 'admin-1', name: 'Admin User', email: 'admin@example.com', role: 'ADMIN',
  } as any)
  const notificationGroup = html.slice(html.indexOf('<summary>通知中心'), html.indexOf('</details>', html.indexOf('<summary>通知中心')))
  assert.match(notificationGroup, /href="\/admin\/notifications\/settings"[^>]*>.*通知设置/)
})

test('guest order links preserve the bound order identifier', async () => {
  const order = { id: 'o-order-1', userId: 'guest-1', orderNo: 'OD-20260913-ABC123', startDate: '2026-09-13', endDate: '2026-09-14' }
  const db = {
    prepare(sql: string) {
      const statement: any = {
        args: [] as unknown[],
        bind(...args: unknown[]) { this.args = args; return this },
        async run() { return { success: true } },
        async first() {
          if (sql.includes('orders')) return this.args[0] === 'order-1' ? null : order
          if (sql.includes('contracts')) return { id: 'contract-1', orderId: order.id, status: 'signed' }
          if (sql.includes('COUNT')) return { count: 0 }
          return null
        },
        async all() { return { results: [] } },
      }
      return statement
    },
  }
  const html = await renderGuestAccount({ env: { RENT: db }, req: { query: () => undefined } } as any, {
    id: 'guest-1', name: 'Guest User', role: 'CUSTOMER', accountType: 'guest', guestOrderId: 'order-1',
  })
  assert.equal((html.match(/href="\/customer\/orders\/order-1"/g) || []).length, 2)
  assert.match(html, /href="\/orders\/order-1\/invoice"/)
  assert.doesNotMatch(html, /href="\/customer\/orders\/o-order-1"/)
})

test('terminal order states cannot be reopened', () => {
  assert.equal(canTransitionOrder('pending_payment', 'paid'), true)
  assert.equal(canTransitionOrder('completed', 'active'), false)
  assert.equal(canTransitionOrder('cancelled', 'paid'), false)
})

test('balance top-ups pending for more than 24 hours are cancelled by the sweep', async () => {
  const statements: Array<{ sql: string; args: unknown[] }> = []
  const db = {
    prepare(sql: string) {
      const statement: any = {
        args: [] as unknown[],
        bind(...args: unknown[]) { this.args = args; return this },
        async all() {
          statements.push({ sql, args: this.args })
          return { results: sql.includes('FROM balance_topups') ? [{ id: 'topup-old', stripe_payment_intent_id: null }] : [] }
        },
        async run() {
          statements.push({ sql, args: this.args })
          return { meta: { changes: 1 } }
        },
      }
      return statement
    },
  }

  assert.equal(await cancelExpiredPendingBalanceTopUps({ env: { RENT: db } } as any), 1)
  assert.match(statements[0].sql, /status = 'pending'/)
  assert.match(statements[0].sql, /datetime\(created_at\).*'-24 hours'/s)
  assert.match(statements[1].sql, /SET status = 'failed'/)
  assert.deepEqual(statements[1].args, ['topup-old'])
})

test('unsigned contracts display as expired after their signing deadline', () => {
  const base = { id: 'c1', rentalId: 'o1', contractNumber: 'CT1', content: '', signedAt: null, status: 'pending_sign' as const }
  assert.equal(isContractExpired({ ...base, signExpiresAt: '2026-01-01T00:00:00.000Z' }, Date.parse('2026-01-02T00:00:00.000Z')), true)
  assert.equal(isContractExpired({ ...base, signExpiresAt: '2026-01-03T00:00:00.000Z' }, Date.parse('2026-01-02T00:00:00.000Z')), false)
  assert.equal(isContractExpired({ ...base, status: 'signed', signedAt: '2026-01-01T00:00:00.000Z', signExpiresAt: '2026-01-01T00:00:00.000Z' }, Date.parse('2026-01-02T00:00:00.000Z')), false)
})

test('contract downloads require a completed signed snapshot', () => {
  const base = { id: 'c1', rentalId: 'o1', contractNumber: 'CT1', content: '', status: 'signed' as const }
  assert.equal(isContractFinalized({ ...base, signedAt: null, signed_content: null }), false)
  assert.equal(isContractFinalized({ ...base, signedAt: '2026-08-06T00:00:00.000Z', signed_content: '<p>signed</p>' }), true)
  assert.equal(isContractFinalized({ ...base, status: 'completed', signedAt: '2026-08-06T00:00:00.000Z', signed_content: '<p>signed</p>' }), true)
  assert.equal(isContractFinalized({ ...base, status: 'cancelled', signedAt: '2026-08-06T00:00:00.000Z', signed_content: '<p>signed</p>' }), false)
})

test('contract links resolve the database orderId field', async () => {
  const row = { id: 'ct1', orderId: 'o1', contractNumber: 'CN1', content: '', signedAt: null, status: 'pending_sign', signToken: 'token' }
  const statement = { bind() { return this }, async first() { return row } }
  const contract = await getContractBySignToken({ env: { RENT: { prepare: () => statement } } } as any, 'token')
  assert.equal(contract?.rentalId, 'o1')
  assert.equal(contract?.rental_id, 'o1')
})

test('order numbers are created once after payment with the public reference format', async () => {
  let orderNo: string | null = null
  const db = {
    prepare(sql: string) {
      let values: any[] = []
      return {
        bind(...args: any[]) { values = args; return this },
        async first() { return { orderNo } },
        async run() { if (sql.startsWith('UPDATE orders SET orderNo')) orderNo ||= values[0]; return { success: true } },
      }
    }
  }
  const context = { env: { RENT: db } } as any
  const generated = await ensureOrderNumber(context, 'o1', 'pi_123abc')
  assert.match(generated, /^OD-\d{8}-[A-Z0-9]{6}$/)
  assert.equal(await ensureOrderNumber(context, 'o1', 'pi_different'), generated)
})

test('return inspection is available for every active rental status', async () => {
  const statuses = ['active', 'extended', 'overdue', 'suspended', 'pending_return']
  for (const status of statuses) {
    const db = {
      prepare(sql: string) {
        const statement = {
          bind() { return this },
          async first() {
            if (sql.includes('FROM orders')) return { id: 'o1', userId: 'u1', deviceId: 'd1', status, totalAmount: 100, depositAmount: 50, startDate: '2026-09-01', endDate: '2026-09-10' }
            if (sql.includes('FROM devices')) return { id: 'd1', name: '测试设备', pricePerDay: 10, depositAmount: 50 }
            if (sql.includes('FROM users')) return { id: 'u1', name: '客户', role: 'CUSTOMER', staff_id: 'staff-1' }
            return null
          },
          async all() { return { results: [] } },
        }
        return statement
      },
    }
    const html = await renderStaffInspection({ env: { RENT: db } } as any, { id: 'staff-1', role: 'STAFF', name: 'Staff' }, 'o1')
    assert.match(html, /<h2>归还后验机<\/h2>/)
    assert.doesNotMatch(html, /当前订单不能执行归还验机/)
  }
})

test('order updates never bind undefined values into D1', async () => {
  let bound: unknown[] = []
  let preparedSql = ''
  const statement = { bind(...values: unknown[]) { bound = values; return this }, async run() { return { success: true } } }
  const context = { env: { RENT: { prepare: (sql: string) => { preparedSql = sql; return statement } } } } as any
  await updateOrder(context, {
    id: 'o1', userId: 'u1', deviceId: 'd1', startDate: '2026-08-08', endDate: '2026-08-10',
    status: 'pending_payment', paymentMethod: 'card', totalAmount: 100, depositAmount: 50,
  } as any)
  assert.equal(bound.includes(undefined), false)
  assert.equal(bound.at(-1), 'o1')
  assert.doesNotMatch(preparedSql, /signedAt/)
})

test('system settings load in one D1 query instead of eight serial queries', async () => {
  let queryCount = 0
  const context = { env: { RENT: { prepare() { queryCount += 1; return { async all() { return { results: [{ key: 'paymentMethods', value: JSON.stringify({ stripe: true, bankTransfer: true, balancePayment: false }) }] } } } } } } } as any
  const settings = await loadSystemSettingsFromDB(context)
  assert.equal(queryCount, 1)
  assert.equal(settings.paymentMethods.stripe, true)
})

test('contract signing drafts restore only non-sensitive fields for the matching token', () => {
  const value = encodeURIComponent(JSON.stringify({ token: 'sign-1', firstName: 'Alice', lastName: 'Chen', email: 'alice@example.com', phone: '0412345678', password: 'secret', esignSignature: 'Alice Chen' }))
  assert.deepEqual(readContractSignDraft(`session=x; contract_sign_draft=${value}`, 'sign-1'), { firstName: 'Alice', lastName: 'Chen', email: 'alice@example.com', phone: '0412345678' })
  assert.deepEqual(readContractSignDraft(`contract_sign_draft=${value}`, 'another-contract'), {})
})

test('existing account names are prefilled into separate given and family name fields', () => {
  assert.deepEqual(splitPersonName('Alice Chen'), { firstName: 'Alice', lastName: 'Chen' })
  assert.deepEqual(splitPersonName('何敏康'), { firstName: '敏康', lastName: '何' })
})

test('saved customer bank details prefill an editable bank refund form', () => {
  assert.deepEqual(getBankRefundPrefill(undefined), { accountName: '', bsb: '', accountNumber: '' })
  assert.deepEqual(getBankRefundPrefill({ name: 'Alice Zhang', bsb: '062-001', account: '12345678' }), {
    accountName: 'Alice Zhang', bsb: '062-001', accountNumber: '12345678',
  })
  assert.deepEqual(getBankRefundPrefill({ name: 'Alice Zhang', account_name: 'A Zhang', account_number: '87654321' }), {
    accountName: 'A Zhang', bsb: '', accountNumber: '87654321',
  })
})

test('contract signing progress renders readable step labels and one current step', () => {
  const websiteHtml = renderSigningProgress(2, false)
  assert.match(websiteHtml, /signing-step--complete[^>]*>[\s\S]*同意协议/)
  assert.match(websiteHtml, /signing-step--current" aria-current="step"[\s\S]*填写资料/)
  assert.doesNotMatch(websiteHtml, /选择支付|付款方式/)
  assert.equal((websiteHtml.match(/aria-current="step"/g) || []).length, 1)
  const staffSigningHtml = renderSigningProgress(2)
  assert.match(staffSigningHtml, /signing-step--current" aria-current="step"[\s\S]*填写资料/)
  const staffPaymentHtml = renderSigningProgress(3)
  assert.match(staffPaymentHtml, /signing-step--current" aria-current="step"[\s\S]*选择支付/)
  assert.doesNotMatch(websiteHtml, /\*\*/)
})

test('Stripe adds 2.5% to rent and service fees while excluding the deposit', () => {
  assert.deepEqual(stripePaymentAmounts(220, 200), { baseCents: 2000, feeCents: 50, chargedCents: 2050 })
  assert.deepEqual(stripePaymentAmounts(1100), { baseCents: 110000, feeCents: 2750, chargedCents: 112750 })
  assert.deepEqual(stripePaymentAmounts(99.99), { baseCents: 9999, feeCents: 250, chargedCents: 10249 })
  assert.deepEqual(stripePaymentAmounts(1100, 1000), { baseCents: 10000, feeCents: 250, chargedCents: 10250 })
  assert.deepEqual(stripePaymentAmounts(1100, 1000, 50), { baseCents: 10000, feeCents: 250, chargedCents: 10250 })
  assert.equal(stripeAuthorizationAmount(220, 200), 22050)
})

test('a paid Stripe payment only suppresses a new authorization when it covers rent and delivery', () => {
  assert.equal(paidRentalPaymentCoversOrder({ status: 'paid', rental_amount: 320 }, 1320, 1000), true)
  assert.equal(paidRentalPaymentCoversOrder({ status: 'paid', rental_amount: 300 }, 1320, 1000), false)
  assert.equal(paidRentalPaymentCoversOrder({ status: 'paid', rental_amount: 320, payment_provider: 'square' }, 1320, 1000), true)
  assert.equal(paidRentalPaymentCoversOrder({ status: 'pending', rental_amount: 320 }, 1320, 1000), false)
})

test('rental length selects preauthorization or SetupIntent deposit handling', () => {
  assert.equal(depositPaymentModeForRental(7, true, 'amex'), 'PREAUTH')
  assert.equal(depositPaymentModeForRental(8, true, 'amex'), 'SETUP_INTENT')
  assert.equal(depositPaymentModeForRental(29, true, 'visa'), 'PREAUTH')
  assert.equal(depositPaymentModeForRental(30, true, 'visa'), 'PAID')
  assert.equal(depositPaymentModeForRental(90, false), 'PAID')
})

test('Visa and Mastercard request a 30-day deposit authorization window', () => {
  assert.equal(depositAuthorizationWindowDays('visa'), 30)
  assert.equal(depositAuthorizationWindowDays('mastercard'), 30)
  assert.equal(depositAuthorizationWindowDays('amex'), 7)
  assert.equal(depositAuthorizationWindowDays('unknown'), 7)
})

test('security deposit methods are explicit and separate from Stripe rent payment', () => {
  assert.equal(normalizeSecurityDepositMethod('bank_transfer'), 'bank_transfer')
  assert.equal(normalizeSecurityDepositMethod('cash'), 'cash')
  assert.equal(normalizeSecurityDepositMethod('card_hold'), 'card_hold')
  assert.equal(normalizeSecurityDepositMethod('unknown'), 'card_hold')
})

test('Stripe checkout contains rent and processing fee but no deposit', () => {
  assert.deepEqual(stripeCheckoutItems({ totalAmount: 1100, depositAmount: 1000, rentalPeriod: 5, startDate: '2026-08-10', endDate: '2026-08-15' }), [
    { name: '设备租金（5 天，2026-08-10 至 2026-08-15）', amountCents: 10000 },
    { name: '信用卡支付手续费（2.50%）', amountCents: 250 },
  ])
})

test('balance price adjustments can expose a negative projected balance', () => {
  assert.equal(balanceAfterPriceAdjustment(20, 50), -30)
  assert.equal(balanceAfterPriceAdjustment(-10, 5), -15)
  assert.equal(balanceAfterPriceAdjustment(20, -5), 20)
})

test('price adjustment summary exposes only the unpaid increase and tracks transfer refunds for deposit settlement', () => {
  const order = { totalAmount: 120, depositAmount: 20, paymentMethod: 'bank_transfer', status: 'active' }
  const payments = [{ amount: 110, rental_amount: 110, deposit_amount: 0, processing_fee: 0, status: 'paid' }]
  const decrease = summarizeOrderPriceAdjustment(order, payments, [{ direction: 'decrease', status: 'succeeded', amount: 10, refund_method: 'pending_deposit', deposit_refunded: 0 }])
  assert.equal(decrease.amountDue, 0)
  assert.equal(decrease.pendingDepositRefund, 10)
  const increase = summarizeOrderPriceAdjustment({ ...order, totalAmount: 130 }, payments, [{ direction: 'decrease', status: 'succeeded', amount: 10, refund_method: 'pending_deposit', deposit_refunded: 0 }])
  assert.equal(increase.amountDue, 0)
})

test('price adjustment refund selection is applied to the appropriate channel', () => {
  const card = { payment_method: 'card', stripe_payment_intent_id: 'pi_123' }
  assert.equal(resolveOrderPriceAdjustmentRefundMethod('original', 'card', card), 'stripe')
  assert.equal(resolveOrderPriceAdjustmentRefundMethod('balance', 'card', card), 'balance')
  assert.equal(resolveOrderPriceAdjustmentRefundMethod('pending_deposit', 'bank_transfer', null), 'pending_deposit')
  assert.throws(() => resolveOrderPriceAdjustmentRefundMethod('pending_deposit', 'card', card), /转账类订单/)
  assert.throws(() => resolveOrderPriceAdjustmentRefundMethod('original', 'card', null), /Stripe 信用卡付款记录/)
})

test('payment results distinguish Stripe, bank transfer, and immediate balance payment', () => {
  assert.equal(paymentResultState({ paymentMethod: 'card', status: 'pending_payment' }, { status: 'pending' }), 'stripe_pending')
  assert.equal(paymentResultState({ paymentMethod: 'bank_transfer', status: 'pending_payment' }, { status: 'pending' }), 'bank_pending')
  assert.equal(paymentResultState({ paymentMethod: 'balance', status: 'paid' }, { status: 'paid' }), 'success')
})

test('payment result follows the actual latest payment record instead of a stale order method', () => {
  const payment = selectPaymentResultPayment({ paymentMethod: 'bank_transfer' }, [
    { payment_method: 'card', payment_provider: 'stripe', status: 'pending' },
  ])
  assert.equal(payment?.payment_provider, 'stripe')
  assert.equal(paymentResultState({ paymentMethod: payment?.payment_method, paymentProvider: payment?.payment_provider }, payment), 'stripe_pending')
})

test('deposit refunds do not return a processing fee because the fee excludes deposits', () => {
  const stripePayment = { payment_method: 'card', processing_fee: 27.5 }
  assert.equal(refundableDepositFee(1000, stripePayment), 0)
  assert.equal(refundableDepositFee(499.99, stripePayment), 0)
  assert.equal(refundableDepositFee(1000, { payment_method: 'bank_transfer', processing_fee: 0 }), 0)
  assert.equal(refundableDepositFee(1000, { payment_method: 'card', processing_fee: 0 }), 0)
})

test('Stripe settlement captures rent and actual deductions and releases unused deposit', () => {
  const payment = { amount: 122.5, rental_amount: 100, processing_fee: 2.5 }
  assert.equal(stripeDepositSettlementCaptureAmount(payment, 0), 102.5)
  assert.equal(stripeDepositSettlementCaptureAmount(payment, 10), 112.5)
  assert.equal(stripeDepositSettlementCaptureAmount(payment, 20), 122.5)
  assert.equal(stripeDepositSettlementCaptureAmount(payment, 0, 'balance'), 122.5)
  assert.equal(stripeDepositSettlementCaptureAmount(payment, 10, 'balance'), 122.5)
})

test('mixed-payment refunds are proportional, rounded to cents, and never exceed a source balance', () => {
  assert.deepEqual(allocateProportionalRefund([{ id: 'balance', amount: 50 }, { id: 'stripe', amount: 150 }], 100), [{ id: 'balance', amount: 25 }, { id: 'stripe', amount: 75 }])
  assert.deepEqual(allocateProportionalRefund([{ id: 'a', amount: 1 }, { id: 'b', amount: 2 }], 0.01), [{ id: 'a', amount: 0.01 }])
  assert.throws(() => allocateProportionalRefund([{ id: 'a', amount: 10, refunded: 8 }], 3), /超过原始付款/)
})

test('all registered contract variables render without leftovers', () => {
  const names = [...CONTRACT_VARIABLE_NAMES]
  const groupedNames = CONTRACT_VARIABLE_GROUPS.flatMap(([, groupNames]) => [...groupNames])
  assert.equal(new Set(names).size, names.length)
  assert.deepEqual(new Set(groupedNames), new Set(names))
  const values = Object.fromEntries(names.map(name => [name, 'TEST']))
  const template = names.map(name => `\${${name}}`).join('|')
  const result = renderContractVariables(template, { id: 'c', rentalId: 'o', contractNumber: 'CN1', content: template, signedAt: null, status: 'signed', contract_data: values }, {}, {}, {}, values, true)
  assert.equal(result.includes('${'), false)
})

test('website contract customer identity uses the locked snapshot over account data', () => {
  const contract = {
    id: 'c', rentalId: 'o', contractNumber: 'CN1', content: '', signedAt: null, status: 'signed',
    contract_data: JSON.stringify({
      customer_name: '网站填写姓名',
      customer_email: 'website@example.com',
      customer_phone: '+61412345678',
      customer_identity_locked_at: '2026-09-13T01:02:03.000Z',
    }),
  } as any
  assert.deepEqual(getContractCustomerSnapshot(contract), {
    name: '网站填写姓名', email: 'website@example.com', phone: '+61412345678', lockedAt: '2026-09-13T01:02:03.000Z',
  })
  assert.equal(renderContractVariables('{customer_name}|{customer_email}|{customer_phone}', contract, {}, {}, {
    name: '账号姓名', email: 'account@example.com', phone: '+8613800000000',
  }, { customer_name: '其他姓名' }, true), '网站填写姓名|website@example.com|+61412345678')
})

test('contract ID number is masked for internal viewers unless sensitive reveal is on', () => {
  const contract = { id: 'c', rentalId: 'o', contractNumber: 'CN1', content: '', signedAt: null, status: 'signed', contract_data: { customer_id_number: 'X1234567' } } as any
  const tpl = 'ID=${customer_id_number}'
  // includeInternal=true, revealSensitive omitted -> still masked
  const masked = renderContractVariables(tpl, contract, {}, {}, {}, { customer_id_number: 'X1234567' }, true)
  assert.equal(masked.includes('X1234567'), false)
  assert.match(masked, /ID=X1\*+67/)
  // explicit reveal -> full value
  const revealed = renderContractVariables(tpl, contract, {}, {}, {}, { customer_id_number: 'X1234567' }, true, true)
  assert.match(revealed, /ID=X1234567/)
})

test('site variables replace company and user values in legal pages', () => {
  const html = renderSiteVariables('<p>欢迎来到 {company_name}，用户：${user_name}，邮箱：{user_email}</p>', { name: '张三', email: 'zhangsan@example.com' })
  assert.match(html, /欢迎来到.*PC Rental/)
  assert.match(html, /用户：张三/)
  assert.match(html, /邮箱：zhangsan@example\.com/)
})

test('hosted image links require public HTTPS URLs', () => {
  assert.deepEqual(validateHostedImageUrls('https://images.example.com/proof.jpg', 1), ['https://images.example.com/proof.jpg'])
  assert.throws(() => validateHostedImageUrls('http://images.example.com/proof.jpg', 1))
  assert.throws(() => validateHostedImageUrls('https://127.0.0.1/proof.jpg', 1))
  assert.throws(() => validateHostedImageUrls('https://a.example/1.jpg\nhttps://a.example/2.jpg', 1))
})

test('plain text and contract HTML reject script injection', () => {
  assert.equal(sanitizePlainText('<img src=x onerror=alert(1)>Alice'), 'Alice')
  const cleaned = sanitizeRichHtml('<p>Hello ${contract_number}</p><script>alert(1)</script><a href="javascript:alert(2)" onclick="alert(3)">link</a>')
  assert.match(cleaned, /Hello \$\{contract_number\}/)
  assert.doesNotMatch(cleaned, /script|javascript:|onclick/i)
  assert.match(cleaned, /<a rel="noopener noreferrer">link<\/a>/)
})

test('page break markup can be inserted into contract templates', () => {
  const html = createPageBreakHtml()
  const cleaned = sanitizeRichHtml(html)
  assert.match(html, /class="page-break"/)
  assert.match(html, /page-break-after:/)
  assert.match(cleaned, /page-break-after:/)
})

test('rich text editor pages emit valid browser JavaScript', async () => {
  const user = { id: 'admin', name: 'Admin', email: 'admin@example.com', role: 'ADMIN' }
  const settingsHtml = renderAdminSettings(user)
  assertInlineScriptsParse(settingsHtml)
  assert.match(settingsHtml, /<form id="systemSettingsForm" class="asset-editor" novalidate>/)
  assert.match(settingsHtml, /fetch\('\/admin\/settings\/save',[\s\S]*credentials: 'same-origin'/)
  assert.doesNotMatch(settingsHtml, /Zoom2u API|Stripe API 配置|Cloudinary 图片上传|Turnstile 人机验证|Resend 邮件 API/)
  const apiSettingsHtml = renderAdminApiSettings(user)
  assertInlineScriptsParse(apiSettingsHtml)
  assert.match(apiSettingsHtml, /Zoom2u API/)
  assert.match(apiSettingsHtml, /Stripe API/)
  assert.doesNotMatch(settingsHtml, /id="userTermsEditor"/)
  assert.doesNotMatch(settingsHtml, /id="rentalTermsEditor"/)
  assert.match(settingsHtml, /href="\/admin\/templates"/)
  assert.match(settingsHtml, /完整邮件变量索引/)
  assert.doesNotMatch(settingsHtml, /邮件通知模板可用变量/)

  const hubHtml = renderAdminTemplateHub(user)
  assert.match(hubHtml, /href="\/admin\/templates\/user"/)
  assert.match(hubHtml, /href="\/admin\/templates\/rental"/)
  assert.match(hubHtml, /href="\/admin\/templates\/contract"/)
  assert.match(hubHtml, /href="\/admin\/templates\/service"/)
  assert.match(hubHtml, /href="\/admin\/templates\/privacy"/)
  assert.match(hubHtml, /href="\/admin\/templates\/copyright"/)
  assertInlineScriptsParse(renderAdminAgreementEditor(user, 'user'))
  assertInlineScriptsParse(renderAdminAgreementEditor(user, 'rental'))
  assertInlineScriptsParse(renderAdminAgreementEditor(user, 'service'))
  assertInlineScriptsParse(renderAdminAgreementEditor(user, 'privacy'))
  assertInlineScriptsParse(renderAdminAgreementEditor(user, 'copyright'))

  const statement = {
    bind() { return this },
    async first() { return null },
  }
  const context = { env: { RENT: { prepare: () => statement } } } as any
  const contractTemplateHtml = await renderAdminContracts(context, user)
  assert.match(contractTemplateHtml, /返回协议与模板/)
  assert.match(contractTemplateHtml, /完整合同变量索引/)
  assert.doesNotMatch(contractTemplateHtml, /合同模板可用变量/)
  assert.ok(contractTemplateHtml.indexOf('id="templateSaveStatus"') < contractTemplateHtml.indexOf('class="form-actions form-actions-right"'))
  assertInlineScriptsParse(contractTemplateHtml)
})

test('data retention controls stay in their matching table columns and submit one row', () => {
  const html = renderAdminDataRetention(
    { id: 'admin', name: 'Admin', email: 'admin@example.com', role: 'ADMIN' },
    [{ category: 'CONTRACTS', label: '租赁合同与签署快照', retention_days: 2555, action: 'RETAIN', basis: '税务 / 合同法', notes: '仅归档不删', enabled: 1, updated_at: '2026-09-07' }],
    { CONTRACTS: 0 },
  )
  assert.match(html, /class="table-wrapper retention-policy-table"/)
  assert.match(html, /<form id="retention-policy-0"[^>]+action="\/admin\/data-retention\/CONTRACTS"/)
  assert.match(html, /class="retention-policy-period"><input[^>]+form="retention-policy-0"[^>]+name="retentionDays"/)
  assert.match(html, /class="retention-policy-action"><select[^>]+form="retention-policy-0"[^>]+name="action"/)
  assert.match(html, /<button[^>]+form="retention-policy-0"[^>]+type="submit">保存<\/button>/)
})

test('button shine is contained by the button instead of the whole page', () => {
  assert.match(styles, /\.button\s*\{[^}]*position:\s*relative;[^}]*overflow:\s*hidden;/)
})

test('site layout loads the external stylesheet and resolves template slots', () => {
  const html = buildLayout('测试页面', '<section id="test-content">内容</section>')
  assert.match(html, /<link rel="stylesheet" href="\/styles\.css(?:\?v=[a-z0-9]+)?">/)
  assert.doesNotMatch(html, /<style(?:\s|>)/i)
  assert.doesNotMatch(html, /\{\{[A-Z_]+\}\}/)
  assert.match(html, /<section id="test-content">内容<\/section>/)
  assert.match(html, /class="legal-footer"/)
  assert.match(html, /href="\/service-terms"/)
  assert.match(html, /href="\/privacy"/)
  assert.match(html, /href="\/refund-policy"/)
})

test('order status failures stay on the page and use a modal dialog', () => {
  const html = renderOrderStatusFeedback()
  assert.match(html, /data-order-status-dialog/)
  assert.match(html, /\.js-order-status-form/)
  assert.match(html, /Accept: 'application\/json'/)
  assert.match(html, /showModal/)
  assertInlineScriptsParse(html)
})

test('admin order CSV export is marked as a browser download', async () => {
  const db = {
    prepare(sql: string) {
      return {
        bind() { return this },
        async all() { return { results: [] } },
        async first() { return { total: 0, revenue: 0, pendingCount: 0, activeCount: 0, completedCount: 0 } },
      }
    },
  }
  const html = await renderAdminOrders(
    { req: { url: 'https://rent.example.test/admin/orders' }, env: { RENT: db } } as any,
    { id: 'admin', name: 'Admin', email: 'admin@example.com', role: 'ADMIN' },
  )
  assert.match(html, /href="\/admin\/orders\/export"[^>]*download>/)
})

test('user management forms use the shared identity record design', async () => {
  const html = renderAdminUserNew({ id: 'admin', name: 'Admin', email: 'admin@example.com', role: 'ADMIN' })
  assert.match(html, /class="identity-strip mono"/)
  assert.match(html, /class="record-form"/)
  assert.match(html, /name="firstName"/)
  assert.match(html, /name="lastName"/)
  assert.doesNotMatch(html, /name="name"/)
  assert.doesNotMatch(html, /onfocus=|linear-gradient\(135deg|👤|🎭|✅/)

  const staffHtml = renderStaffCustomerNew({ id: 'staff', name: 'Staff', email: 'staff@example.com', role: 'STAFF' })
  assert.match(staffHtml, /name="firstName"/)
  assert.match(staffHtml, /name="lastName"/)
  assert.doesNotMatch(staffHtml, /name="role"/)

  const registrationHtml = renderRegister()
  assert.match(registrationHtml, /name="firstName"/)
  assert.match(registrationHtml, /name="lastName"/)
  assert.doesNotMatch(registrationHtml, /name="name"/)
  assert.match(registrationHtml, /minlength="8"/)
  assert.match(registrationHtml, /pattern="\(\?=\.\*\[A-Za-z\]\).*\[0-9\].*\{8,\}"/)
  assert.match(registrationHtml, /href="\/service-terms"/)
  assert.match(registrationHtml, /href="\/privacy"/)

  const rows = [
    { id: 'customer-1', name: 'Kai Chen', email: 'kai@example.com', role: 'CUSTOMER', status: 'active', account_status: 'active', staff_id: 'staff-1' },
    { id: 'staff-1', name: 'Alex Wu', email: 'alex@example.com', role: 'STAFF', status: 'active', account_status: 'active' },
    { id: 'staff-departed', name: 'Former Staff', email: 'former@example.com', role: 'STAFF', status: 'inactive', account_status: 'departed' },
  ]
  const context = { env: { RENT: { prepare(sql: string) { return { bind(...values: unknown[]) { return { async first() { return sql.includes('WHERE id = ?') ? rows.find(row => row.id === values[0]) ?? null : null } } }, async all() { return { results: rows } } } } } } } as any
  const editHtml = await renderAdminUserEdit(context, { id: 'admin', name: 'Admin', email: 'admin@example.com', role: 'ADMIN' }, 'customer-1')
  assert.match(editHtml, /name="accountStatus"/)
  for (const status of ['active', 'banned', 'inactive', 'departed']) assert.match(editHtml, new RegExp(`value="${status}"`))
  assert.match(editHtml, /name="staffId"/)
  assert.match(editHtml, /Alex Wu/)
  assert.doesNotMatch(editHtml, /Former Staff/)
  assertInlineScriptsParse(editHtml)

  const currentAdminRows = [{ id: 'admin', name: 'Admin User', email: 'admin@example.com', role: 'ADMIN', status: 'active', account_status: 'active' }]
  const currentAdminContext = { env: { RENT: { prepare(sql: string) { return { bind(...values: unknown[]) { return { async first() { return sql.includes('WHERE id = ?') ? currentAdminRows.find(row => row.id === values[0]) ?? null : null } } }, async all() { return { results: currentAdminRows } } } } } } } as any
  const currentAdminHtml = await renderAdminUserEdit(currentAdminContext, currentAdminRows[0], 'admin')
  assert.match(currentAdminHtml, /id="user-role" name="role" disabled/)
  assert.match(currentAdminHtml, /id="account-status" name="accountStatus" disabled/)
  assert.match(currentAdminHtml, /当前正在使用的管理员账号不能更改账户状态/)
})

test('admin device forms edit every field used by staff device search', () => {
  const user = { id: 'admin', name: 'Admin', email: 'admin@example.com', role: 'ADMIN' }
  const newHtml = renderAdminDeviceNew(user)
  for (const field of ['name', 'brand', 'model', 'serialNumber', 'cpu', 'ram', 'storage', 'gpu', 'os', 'description', 'weeklyDiscountPercent', 'monthlyDiscountPercent']) {
    assert.match(newHtml, new RegExp(`name="${field}"`))
  }
  assert.match(newHtml, /id="assetTag"/)
  const editHtml = renderAdminDeviceEdit(user, { id: 'd1', name: 'MacBook Pro', brand: 'Apple', model: 'A2918', asset_tag: 'RENT-001', serialNumber: 'SN1', cpu: 'M3 Pro', ram: '18GB', storage: '512GB SSD', gpu: '18-core', os: 'macOS 15', description: '14 inch', pricePerDay: 50, depositAmount: 1000, weekly_discount_percent: 10, monthly_discount_percent: 20, status: 'available' })
  for (const expected of ['Apple', 'RENT-001', 'M3 Pro', '18GB', '512GB SSD', '18-core', 'macOS 15']) assert.match(editHtml, new RegExp(expected))
  assert.match(editHtml, /name="weeklyDiscountPercent"[^>]*value="10"/)
  assert.match(editHtml, /name="monthlyDiscountPercent"[^>]*value="20"/)
})

test('new contract delivery form emits valid autocomplete JavaScript', async () => {
  const context = { env: { RENT: { prepare(sql: string) { return { bind() { return this }, async first() { return null }, async all() { return { results: sql.includes('FROM devices') ? [{ id: 'device-rented', name: 'MacBook', brand: 'Apple', model: 'Pro', asset_tag: 'RENT-001', serialNumber: 'SN1', cpu: 'M3 Pro', ram: '18GB', storage: '512GB SSD', gpu: '18-core', os: 'macOS 15', pricePerDay: 20, depositAmount: 500, status: 'rented' }] : [] } } } } } } } as any
  const html = await renderNewContractPage(context, { id: 'staff', name: 'Staff', email: 'staff@example.com', role: 'STAFF' })
  assertInlineScriptsParse(html)
  assert.match(html, /id="delivery-address-search"/)
  assert.match(html, /<select id="pickup-location"/)
  assert.match(html, /id="delivery-fee"[^>]*required/)
  assert.match(html, /id="return-method"/)
  assert.match(html, /value="CourierPickup"/)
  assert.match(html, /value="StoreReturn"/)
  assert.match(html, /value="device-rented"/)
  assert.match(html, /id="device-search"/)
  assert.match(html, /data-group-pagination/)
  assert.match(html, /data-group-toggle/)
  assert.match(html, /devicePageSize = 4/)
  assert.match(html, /data-device-search=/)
  assert.match(html, /SN1/)
  assert.match(html, /M3 Pro · 18GB · 512GB SSD · 18-core · macOS 15/)
  assert.match(html, /RENT-001/)
  assert.match(html, /id="booking-calendar"/)
  assert.match(html, /id="booking-prev"/)
  assert.match(html, /selectBookingDate/)
  assert.match(html, /setCustomValidity/)
  assert.match(html, /请手动选择设备/)

  const adminHtml = await renderNewContractPage(context, { id: 'admin', name: 'Admin', email: 'admin@example.com', role: 'ADMIN' })
  assertInlineScriptsParse(adminHtml)
  assert.match(adminHtml, /id="booking-calendar"/)
  assert.match(adminHtml, /selectBookingDate/)
  assert.doesNotMatch(html, /GOOGLE_MAPS_API_KEY/)
})

test('website order review requires a delivery fee for delivery orders', async () => {
  const context = {
    env: {
      RENT: {
        prepare() {
          return {
            async all() {
              return { results: [{ id: 'order-1', startDate: '2026-10-01', endDate: '2026-10-03', totalAmount: 800, depositAmount: 500, deliveryMethod: 'Delivery', deliveryFee: 0, createdAt: '2026-09-13T00:00:00.000Z', customerName: '客户', customerEmail: 'customer@example.com', accountType: 'formal', deviceName: 'MacBook', deviceCategory: '电脑' }] }
            }
          }
        }
      }
    }
  } as any
  const html = await renderAdminOrderReview(context, { id: 'admin', name: 'Admin', email: 'admin@example.com', role: 'ADMIN' })
  assertInlineScriptsParse(html)
  assert.match(html, /name="deliveryMethod"/)
  assert.match(html, /name="deliveryFee"[^>]*required/)
  assert.match(html, /送货订单必须填写配送费/)
})

test('admin rental calendar filters all devices or a single device', async () => {
  const context = { env: { RENT: { prepare(sql: string) { return { async all() { return { results: sql.includes('FROM orders') ? [{ id: 'o1', deviceId: 'd1', deviceName: 'MacBook', customerName: 'Customer', startDate: '2026-08-10', endDate: '2026-08-12', status: 'paid' }] : [{ id: 'd1', name: 'MacBook', serialNumber: 'SN1', status: 'rented' }] } } } } } } } as any
  const html = await renderAdminDeviceCalendar(context, { id: 'admin', name: 'Admin', email: 'admin@example.com', role: 'ADMIN' })
  assertInlineScriptsParse(html)
  assert.match(html, /全部出租设备/)
  assert.match(html, /value="d1"/)
  assert.match(html, /id="fleet-calendar"/)
  assert.match(html, /id="calendar-prev"/)
  assert.match(html, /id="calendar-next"/)
  assert.doesNotMatch(html, /type="month"/)
})

test('joined referral users see their referral workspace instead of the join prompt', async () => {
  const db = {
    prepare(sql: string) {
      return {
        bind() { return this },
        async first() {
          if (sql.includes('FROM users WHERE id')) return { id: 'customer', name: 'Customer', email: 'customer@example.com', role: 'CUSTOMER', referral_code: 'REFER123', commission_balance: 25 }
          return null
        },
        async all() {
          if (sql.includes('PRAGMA table_info(users)')) return { results: [{ name: 'referrer_id' }] }
          return { results: [] }
        },
      }
    },
  }
  const html = await renderCustomerReferral({ env: { RENT: db } } as any, { id: 'customer', name: 'Customer', email: 'customer@example.com', role: 'CUSTOMER' })
  assert.match(html, /value="REFER123"/)
  assert.match(html, /佣金提现/)
  assert.doesNotMatch(html, />立即加入</)
})

test('staff contract lists exclude contracts created by other employees', async () => {
  const rows: Record<string, any[]> = {
    contracts: [
      { id: 'ct-own', orderId: 'o-own', contractNumber: 'OWN-CONTRACT', status: 'pending_sign', created_by: 'staff-1', signToken: 'own-token' },
      { id: 'ct-other', orderId: 'o-other', contractNumber: 'OTHER-CONTRACT', status: 'pending_sign', created_by: 'staff-2', signToken: 'other-token' },
    ],
    orders: [
      { id: 'o-own', userId: 'u-own', deviceId: 'd1', status: 'active', startDate: '2026-08-01', endDate: '2026-08-02', totalAmount: 10, depositAmount: 5 },
      { id: 'o-other', userId: 'u-other', deviceId: 'd1', status: 'active', startDate: '2026-08-01', endDate: '2026-08-02', totalAmount: 10, depositAmount: 5 },
    ],
    users: [{ id: 'staff-1', name: 'Staff One', role: 'STAFF' }, { id: 'u-own', name: 'Own Customer', role: 'CUSTOMER' }, { id: 'u-other', name: 'Other Customer', role: 'CUSTOMER' }],
    devices: [{ id: 'd1', name: 'Laptop' }],
  }
  const db = { prepare(sql: string) { const table = /FROM\s+(contracts|orders|users|devices)/i.exec(sql)?.[1].toLowerCase() || ''; return { bind() { return this }, async all() { return { results: rows[table] || [] } } } } }
  const html = await renderStaffContracts({ env: { RENT: db } } as any, { id: 'staff-1', name: 'Staff One', role: 'STAFF' })
  assert.match(html, /OWN-CONTRACT/)
  assert.doesNotMatch(html, /OTHER-CONTRACT/)
  assert.match(html, /等待客户签署/)
  assert.doesNotMatch(html, />签署进度</)
  assert.match(html, /contract-list-action copy-sign-link/)
  assert.match(html, /contract-list-action contract-cancel-action/)

  const adminHtml = await renderStaffContracts({ env: { RENT: db } } as any, { id: 'admin', name: 'Admin', role: 'ADMIN' })
  assert.match(adminHtml, /OWN-CONTRACT/)
  assert.match(adminHtml, /OTHER-CONTRACT/)
  assert.match(adminHtml, /href="\/admin\/templates"/)
  assert.match(adminHtml, /action="\/admin\/contracts"/)

  const filteredAdminHtml = await renderStaffContracts({ env: { RENT: db } } as any, { id: 'admin', name: 'Admin', role: 'ADMIN' }, undefined, undefined, undefined, undefined, 'staff-1')
  assert.match(filteredAdminHtml, /id="contract-staff-filter"/)
  assert.match(filteredAdminHtml, /负责员工/)
  assert.match(filteredAdminHtml, /员工账户请前往用户管理创建或停用/)
  assert.match(filteredAdminHtml, /value="staff-1" selected/)
  assert.match(filteredAdminHtml, /OWN-CONTRACT/)
  assert.doesNotMatch(filteredAdminHtml, /OTHER-CONTRACT/)
})

test('terminal contracts hide progress and editing while only finalized contracts can be viewed', async () => {
  const rows: Record<string, any[]> = {
    contracts: [
      { id: 'ct-pending', orderId: 'o1', contractNumber: 'PENDING', status: 'pending_sign', created_by: 'staff-1' },
      { id: 'ct-cancelled', orderId: 'o2', contractNumber: 'CANCELLED', status: 'cancelled', created_by: 'staff-1' },
      { id: 'ct-completed', orderId: 'o3', contractNumber: 'COMPLETED', status: 'completed', signedAt: '2026-08-01', signed_content: '<p>signed</p>', created_by: 'staff-1' },
    ],
    orders: ['o1', 'o2', 'o3'].map(id => ({ id, userId: 'u1', deviceId: 'd1', status: 'active', startDate: '2026-08-01', endDate: '2026-08-02' })),
    users: [{ id: 'staff-1', name: 'Staff', role: 'STAFF' }, { id: 'u1', name: 'Customer', role: 'CUSTOMER' }], devices: [{ id: 'd1', name: 'Laptop' }],
  }
  const db = { prepare(sql: string) { const table = /FROM\s+(contracts|orders|users|devices)/i.exec(sql)?.[1].toLowerCase() || ''; return { bind() { return this }, async all() { return { results: rows[table] || [] } } } } }
  const html = await renderStaffContracts({ env: { RENT: db } } as any, { id: 'staff-1', name: 'Staff', email: 'staff@example.com', role: 'STAFF' }, 'completed')
  assert.match(html, /COMPLETED/)
  assert.match(html, /contract\/view\/ct-completed/)
  assert.doesNotMatch(html, /ct-completed\/data/)
  assert.doesNotMatch(html, /ct-completed\/progress/)
})

test('staff cannot open a customer assigned to another employee', async () => {
  const statement = { bind() { return this }, async first() { return { id: 'customer', name: 'Other Customer', email: 'other@example.com', role: 'CUSTOMER', staff_id: 'staff-2' } } }
  const html = await renderStaffCustomerDetail({ env: { RENT: { prepare: () => statement } } } as any, { id: 'staff-1', name: 'Staff One', email: 'staff@example.com', role: 'STAFF' }, 'customer')
  assert.match(html, /客户未找到/)
  assert.doesNotMatch(html, /other@example\.com/)
})

test('staff ongoing orders are read-only and limited to assigned customers', async () => {
  const rows: Record<string, any[]> = {
    orders: [
      { id: 'own-active', orderNo: 'OWN-1', userId: 'own-customer', deviceId: 'd1', status: 'active', startDate: '2026-08-01', endDate: '2026-08-10', totalAmount: 100 },
      { id: 'other-active', orderNo: 'OTHER-1', userId: 'other-customer', deviceId: 'd1', status: 'active', startDate: '2026-08-01', endDate: '2026-08-10', totalAmount: 100 },
      { id: 'own-pending-review', orderNo: 'REVIEW-1', userId: 'own-customer', deviceId: 'd1', status: 'pending_approval', startDate: '2026-08-01', endDate: '2026-08-10', totalAmount: 100 },
    ],
    users: [{ id: 'own-customer', name: 'Own', staff_id: 'staff-1' }, { id: 'other-customer', name: 'Other', staff_id: 'staff-2' }],
    devices: [{ id: 'd1', name: 'Laptop' }],
  }
  // 归属过滤已经下推成 SQL（`... AND u.staff_id = ?`），这个假 D1 按语句里的
  // 绑定参数模拟该过滤，保证测试断言的仍是「员工只看自己客户」。
  const db = {
    prepare(sql: string) {
      const table = /FROM\s+(orders|users|devices)/i.exec(sql)?.[1].toLowerCase() || ''
      let params: any[] = []
      return {
        bind(...values: any[]) { params = values; return this },
        async all() {
          let results = rows[table] || []
          if (sql.includes('o.status IN') || /FROM\s+orders/i.test(sql)) {
            const statuses = params.filter(value => typeof value === 'string' && !String(value).startsWith('staff-'))
            const staffId = params.find(value => typeof value === 'string' && String(value).startsWith('staff-'))
            const byCustomer = new Map(rows.users.map(account => [account.id, account]))
            results = results.filter(order => (!statuses.length || statuses.includes(order.status)) && (!staffId || (byCustomer as Map<string, any>).get(order.userId)?.staff_id === staffId))
          }
          return { results }
        },
      }
    },
  }
  const html = await renderStaffOrdersOngoing({ env: { RENT: db } } as any, { id: 'staff-1', name: 'Staff', email: 'staff@example.com', role: 'STAFF' })
  assert.match(html, /OWN-1/)
  assert.doesNotMatch(html, /OTHER-1|REVIEW-1/)
  assert.doesNotMatch(html, />批准<|>拒绝<|approve|reject/)
  assert.match(html, /归还验机/)
})

test('staff device and customer pages hide administrator-only mutations', async () => {
  const db = { prepare(sql: string) { return { bind() { return this }, async first() { return { id: 'customer', name: 'Customer One', email: 'customer@example.com', role: 'CUSTOMER', staff_id: 'staff-1', balance: 50 } }, async all() { return { results: sql.includes('FROM devices') ? [{ id: 'd1', name: 'Laptop', model: 'Pro', serialNumber: 'SN1', pricePerDay: 20, status: 'available' }] : [] } } } } }
  const user = { id: 'staff-1', name: 'Staff', email: 'staff@example.com', role: 'STAFF' }
  const devicesHtml = await renderStaffDevices({ env: { RENT: db } } as any, user)
  assert.doesNotMatch(devicesHtml, /添加设备|\/staff\/devices\/new|\/staff\/devices\/d1\/edit/)
  const customerHtml = await renderStaffCustomerEdit({ env: { RENT: db } } as any, user, 'customer')
  assert.doesNotMatch(customerHtml, /name="balance"/)
  assert.match(customerHtml, /name="bsb"/)
})
