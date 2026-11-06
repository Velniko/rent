/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

// 领域实体的数据访问层（用户 / 订单 / 设备 / 合同的 CRUD + 行归一化）。
// 只依赖 db/client、db/types、lib/*、domain 常量与 nanoid，不反向依赖 site.ts /
// services / 路由。site.ts 统一 re-export，页面 / action 的既有 import 不变。
//
// 编排类逻辑（updateOrderStatus、调度清理任务、webhook 幂等、对账、系统设置读写）
// 仍留在 site.ts，它们会从这里 import 需要的 CRUD 函数。

import type { Context } from 'hono'
import { nanoid } from 'nanoid'
import { getDB, getTableColumns } from './client'
import type { User, Device, DeviceLifecycleStatus, Order, Contract } from './types'
import { getAccessLevel } from '../lib/access'
import { sanitizePlainText } from '../lib/html'
import { generateReferenceNumber } from '../lib/reference'
import { generateUserId } from '../lib/userId'
import { hashPassword, verifyPassword } from '../lib/password'
import { syncSquareCatalogItem, syncSquareCustomerProfile } from '../square'
import { canTransitionDeviceLifecycle } from '../domain/deviceLifecycle'
import type { ManualOrderData } from '../domain/manualOrders'
import { createDemoAvailableFrom } from '../domain/deviceDemo'
import { resolveRentalDiscounts } from '../domain/rentalPricing'
import { getSystemSettings } from '../settings/systemSettings'

// ---------------------------------------------------------------------------
// 私有：设备生命周期映射 + 行归一化
// ---------------------------------------------------------------------------

const DEVICE_LIFECYCLE_STATES = new Set<DeviceLifecycleStatus>(['RESERVED', 'READY', 'RENTED', 'RETURNED', 'INSPECTION', 'MAINTENANCE', 'DAMAGED', 'RETIRED'])

function legacyDeviceStatusForLifecycle(status: DeviceLifecycleStatus): Device['status'] {
  if (status === 'READY') return 'available'
  if (status === 'MAINTENANCE' || status === 'DAMAGED') return 'maintenance'
  if (status === 'RETIRED') return 'retired'
  return 'rented'
}

// 将数据库行归一化为同时包含 snake_case 和 camelCase 字段的 User 对象
export function normalizeUserRow(row: any): User {
  if (!row) return null as any
  // Never let credential material escape the repository boundary. Login
  // verification reads the raw row above this helper, while all other
  // callers only need the public user profile and account fields.
  const {
    password,
    passwordHash,
    password_hash,
    passwordSalt,
    password_salt,
    ...safeRow
  } = row
  const account_number = row.account_number ?? row.accountNumber ?? row.account
  const accountNumber = row.accountNumber ?? row.account_number ?? row.account

  const commissionBalance = Number(row.commissionBalance ?? row.commission_balance ?? 0)
  const balance = Number(row.balance ?? 0)

  const createdAt = row.createdAt ?? row.created_at ?? row.registrationDate ?? row.created_at
  const created_at = row.created_at ?? row.createdAt ?? row.registrationDate ?? row.createdAt
  const updatedAt = row.updatedAt ?? row.updated_at ?? null
  const updated_at = row.updated_at ?? row.updatedAt ?? null

  const referralCode = row.referralCode ?? row.referral_code ?? null
  const referrerId = row.referrerId ?? row.referrer_id ?? row.referrerId
  const staffId = row.staffId ?? row.staff_id
  const accountType = row.accountType ?? row.account_type ?? 'formal'
  const accessLevel = getAccessLevel(row)
  const accountStatus = row.accountStatus ?? row.account_status ?? (row.status === 'inactive' ? 'inactive' : 'active')
  const guestOrderId = row.guestOrderId ?? row.guest_order_id ?? null
  const guestExpiresAt = row.guestExpiresAt ?? row.guest_expires_at ?? null
  const deletedAt = row.deletedAt ?? row.deleted_at ?? null
  const deletionRequestedAt = row.deletionRequestedAt ?? row.deletion_requested_at ?? null
  const deletionScheduledAt = row.deletionScheduledAt ?? row.deletion_scheduled_at ?? null
  const identityStatus = row.identityStatus ?? row.identity_status ?? null
  const stripeCustomerId = row.stripeCustomerId ?? row.stripe_customer_id ?? null
  const squareCustomerId = row.squareCustomerId ?? row.square_customer_id ?? null

  return {
    ...safeRow,
    identityStatus,
    identity_status: identityStatus,
    stripeCustomerId,
    stripe_customer_id: stripeCustomerId,
    squareCustomerId,
    square_customer_id: squareCustomerId,
    account_number,
    accountNumber,
    commissionBalance,
    commission_balance: commissionBalance,
    balance,
    createdAt,
    created_at,
    updatedAt,
    updated_at,
    referralCode,
    referrerId,
    staffId,
    staff_id: staffId,
    accountType,
    accessLevel,
    access_level: accessLevel,
    account_type: accountType,
    accountStatus,
    account_status: accountStatus,
    guestOrderId,
    guest_order_id: guestOrderId,
    guestExpiresAt,
    guest_expires_at: guestExpiresAt,
    deletedAt,
    deleted_at: deletedAt,
    deletionRequestedAt,
    deletionScheduledAt,
    deletion_requested_at: deletionRequestedAt,
    deletion_scheduled_at: deletionScheduledAt,
  } as User
}

function normalizeOrderRow(orderRow: any): Order {
  if (!orderRow) return null as any

  const deviceId = orderRow.deviceId ?? orderRow.device_id
  const startDate = orderRow.startDate ?? orderRow.start_date
  const endDate = orderRow.endDate ?? orderRow.end_date
  const rentalPeriod = orderRow.rentalPeriod ?? orderRow.rental_period
  const totalAmount = orderRow.totalAmount ?? orderRow.total_amount
  const depositAmount = orderRow.depositAmount ?? orderRow.deposit_amount
  const createdAt = orderRow.createdAt ?? orderRow.created_at
  const refundMethod = orderRow.refundMethod ?? orderRow.refund_method ?? 'balance'
  const refundBsb = orderRow.refundBsb ?? orderRow.refund_bsb
  const refundAccountNumber = orderRow.refundAccountNumber ?? orderRow.refund_account_number
  const refundAccountName = orderRow.refundAccountName ?? orderRow.refund_account_name
  const orderNo = orderRow.orderNo ?? orderRow.order_no
  const contractId = orderRow.contractId ?? orderRow.contract_id
  const signedAt = orderRow.signedAt ?? orderRow.signed_at
  const depositMethod = orderRow.deposit_method ?? orderRow.depositMethod
  const depositPaymentMode = orderRow.deposit_payment_mode ?? orderRow.depositPaymentMode
  const paymentMethod = orderRow.paymentMethod ?? orderRow.payment_method
  const paymentProvider = orderRow.payment_provider ?? (paymentMethod === 'card' ? 'stripe' : 'internal')

  return {
    ...orderRow,
    deviceId,
    device_id: deviceId,
    startDate,
    start_date: startDate,
    endDate,
    end_date: endDate,
    rentalPeriod,
    rental_period: rentalPeriod,
    totalAmount,
    total_amount: totalAmount,
    depositAmount,
    deposit_amount: depositAmount,
    createdAt,
    created_at: createdAt,
    refundMethod,
    refundBsb,
    orderNo,
    order_no: orderNo,
    contractId,
    contract_id: contractId,
    signedAt,
    signed_at: signedAt,
    depositMethod,
    deposit_method: depositMethod,
    depositPaymentMode,
    deposit_payment_mode: depositPaymentMode,
    paymentMethod,
    payment_method: paymentMethod,
    paymentProvider,
    payment_provider: paymentProvider,
    refundAccountNumber,
    refundAccountName,
    status: orderRow.status ?? orderRow.order_status
  } as Order
}

export function normalizeContractRow(contractRow: any): Contract {
  if (!contractRow) return null as any

  const validFrom = contractRow.validFrom ?? contractRow.valid_from
  const validUntil = contractRow.validUntil ?? contractRow.valid_until
  const signExpiresAt = contractRow.signExpiresAt ?? contractRow.sign_expires_at
  const rentalId = contractRow.orderId ?? contractRow.order_id ?? contractRow.rentalId ?? contractRow.rental_id
  const rental_id = contractRow.rental_id ?? contractRow.rentalId ?? contractRow.orderId ?? contractRow.order_id
  const sign_expires_at = contractRow.sign_expires_at ?? contractRow.signExpiresAt
  const valid_from = contractRow.valid_from ?? contractRow.validFrom
  const valid_until = contractRow.valid_until ?? contractRow.validUntil
  const createdBy = contractRow.createdBy ?? contractRow.created_by
  const created_by = contractRow.created_by ?? contractRow.createdBy

  return {
    ...contractRow,
    validFrom,
    validUntil,
    signExpiresAt,
    rentalId,
    rental_id,
    sign_expires_at,
    valid_from,
    valid_until,
    createdBy,
    created_by
  } as Contract
}

export async function userHasColumn(c: Context, columnName: string): Promise<boolean> {
  const db = getDB(c)
  return (await getTableColumns(db, 'users')).has(columnName)
}

// ---------------------------------------------------------------------------
// 用户
// ---------------------------------------------------------------------------

export async function generateUniqueUserId(c: Context, role: 'ADMIN' | 'STAFF' | 'CUSTOMER', accountType: 'formal' | 'guest' = 'formal'): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const id = generateUserId(role, accountType)
    const existing = await c.env.RENT.prepare('SELECT id FROM users WHERE id = ?').bind(id).first()
    if (!existing) return id
  }
  throw new Error('无法生成唯一用户 ID，请稍后重试')
}

export async function getUserById(cOrContext: Context | string, id?: string): Promise<User | null> {
  const db = getDB(typeof cOrContext === 'string' ? undefined : cOrContext)
  const actualId = typeof cOrContext === 'string' ? cOrContext : id
  if (!actualId) return null
  const userRow = await db.prepare('SELECT * FROM users WHERE id = ?').bind(actualId).first()
  if (!userRow) return null

  return normalizeUserRow(userRow)
}

export async function findUserByEmail(c: Context, email: string): Promise<User | null> {
  const db = getDB(c)
  const userRow = await db.prepare('SELECT * FROM users WHERE email = ?').bind(email).first()
  if (!userRow) return null
  return normalizeUserRow(userRow)
}

export async function verifyUserCredentials(c: Context, account: string, password: string): Promise<User | null> {
  const db = getDB(c)
  // Find user by email first
  const userRow = await db.prepare('SELECT * FROM users WHERE email = ?').bind(account).first()
  if (userRow) {
    // Check password
    const normalizedUser = normalizeUserRow(userRow)
    // Get password hash (handle both camelCase and snake_case)
    const passwordHash = userRow.passwordHash || userRow.password_hash
    const passwordSalt = userRow.passwordSalt || userRow.password_salt
    if (passwordHash) {
      const isValid = await verifyPassword(password, String(passwordHash).startsWith('pbkdf2$') ? String(passwordHash) : `${passwordSalt}$${passwordHash}`)
      if (isValid) {
        if (!String(passwordHash).startsWith('pbkdf2$')) await updateUser(c, normalizedUser.id, { password })
        delete (normalizedUser as any).passwordHash
        delete (normalizedUser as any).passwordSalt
        delete (normalizedUser as any).password
        return normalizedUser
      }
    }
  }
  // If not found by email, try phone number as account
  const phoneRow = await db.prepare('SELECT * FROM users WHERE phone = ?').bind(account).first()
  if (phoneRow) {
    const normalizedUser = normalizeUserRow(phoneRow)
    const passwordHash = phoneRow.passwordHash || phoneRow.password_hash
    const passwordSalt = phoneRow.passwordSalt || phoneRow.password_salt
    if (passwordHash) {
      const isValid = await verifyPassword(password, String(passwordHash).startsWith('pbkdf2$') ? String(passwordHash) : `${passwordSalt}$${passwordHash}`)
      if (isValid) {
        if (!String(passwordHash).startsWith('pbkdf2$')) await updateUser(c, normalizedUser.id, { password })
        delete (normalizedUser as any).passwordHash
        delete (normalizedUser as any).passwordSalt
        delete (normalizedUser as any).password
        return normalizedUser
      }
    }
  }
  return null
}

export async function findUserByReferralCode(c: Context, referralCode: string): Promise<User | null> {
  const db = getDB(c)
  const normalizedCode = referralCode.trim().toUpperCase()
  const userRow = await db.prepare('SELECT * FROM users WHERE UPPER(referral_code) = ?').bind(normalizedCode).first()
  return userRow ? normalizeUserRow(userRow as any) : null
}

export async function getUsers(c?: Context): Promise<User[]> {
  const db = getDB(c)
  const result = await db.prepare('SELECT * FROM users').all()
  if (!result.results) return []
  return (result.results as any[]).map(normalizeUserRow) || []
}

export async function getUsersByIds(c: Context, ids: string[]): Promise<User[]> {
  if (!ids.length) return []
  const db = getDB(c)
  const placeholders = ids.map(() => '?').join(', ')
  const result = await db.prepare(`SELECT * FROM users WHERE id IN (${placeholders})`).bind(...ids).all()
  if (!result.results) return []
  return (result.results as any[]).map(normalizeUserRow) || []
}

export async function getUsersAsync(c: Context): Promise<User[]> {
  return getUsers(c)
}

export async function insertUser(c: Context, user: any): Promise<User> {
  const db = getDB(c)
  user = {
    ...user,
    name: sanitizePlainText(user.name, 100),
    email: String(user.email ?? '').trim().toLowerCase().slice(0, 254),
    phone: sanitizePlainText(user.phone, 40),
    bsb: sanitizePlainText(user.bsb, 20),
    account: sanitizePlainText(user.account, 40),
    accountNumber: sanitizePlainText(user.accountNumber, 40),
    referralCode: sanitizePlainText(user.referralCode, 64) || null,
  }

  // 检查数据库中存在哪些列
  const hasPasswordHashSnake = await userHasColumn(c, 'password_hash')
  const hasPasswordHashCamel = await userHasColumn(c, 'passwordHash')
  const hasPasswordSaltSnake = await userHasColumn(c, 'password_salt')
  const hasPasswordSaltCamel = await userHasColumn(c, 'passwordSalt')
  const hasReferrerIdSnake = await userHasColumn(c, 'referrer_id')
  const hasReferrerIdCamel = await userHasColumn(c, 'referrerId')
  const hasReferralCodeSnake = await userHasColumn(c, 'referral_code')
  const hasReferralCodeCamel = await userHasColumn(c, 'referralCode')
  const hasCreatedAtSnake = await userHasColumn(c, 'created_at')
  const hasCreatedAtCamel = await userHasColumn(c, 'createdAt')
  const hasCommissionBalanceSnake = await userHasColumn(c, 'commission_balance')
  const hasCommissionBalanceCamel = await userHasColumn(c, 'commissionBalance')
  const hasStaffIdSnake = await userHasColumn(c, 'staff_id')
  const hasStaffIdCamel = await userHasColumn(c, 'staffId')
  const hasAccountType = await userHasColumn(c, 'account_type')
  const hasAccountStatus = await userHasColumn(c, 'account_status')
  const hasGuestOrderId = await userHasColumn(c, 'guest_order_id')
  const hasGuestExpiresAt = await userHasColumn(c, 'guest_expires_at')
  const hasAccessLevel = await userHasColumn(c, 'access_level')

  let passwordHashToStore = user.passwordHash ?? null;
  let passwordSaltToStore = user.passwordSalt ?? null;

  if (user.password) {
    const newHashedPassword = await hashPassword(user.password);
    passwordHashToStore = newHashedPassword;
    passwordSaltToStore = 'v2';
  } else if (user.passwordHash && user.passwordHash.includes('$')) {
    if (user.passwordHash.startsWith('pbkdf2$')) {
      passwordHashToStore = user.passwordHash;
      passwordSaltToStore = 'v2';
    } else {
      const [newSalt, newHash] = user.passwordHash.split('$');
      passwordHashToStore = newHash;
      passwordSaltToStore = newSalt;
    }
  }

  // 构建INSERT字段和值
  const insertFields = ['id', 'name', 'email', 'phone', 'role', 'status', 'balance'];
  const insertValues = [user.id, user.name, user.email, user.phone || null, user.role, user.status ?? 'active', user.balance ?? 0];
  if (hasAccessLevel) { insertFields.push('access_level'); insertValues.push(user.accessLevel ?? user.access_level ?? user.role) }

  // 处理commission_balance / commissionBalance
  if (hasCommissionBalanceSnake) {
    insertFields.push('commission_balance');
    insertValues.push(user.commissionBalance ?? 0);
  } else if (hasCommissionBalanceCamel) {
    insertFields.push('commissionBalance');
    insertValues.push(user.commissionBalance ?? 0);
  }

  // 处理referral_code / referralCode
  if (hasReferralCodeSnake) {
    insertFields.push('referral_code');
    insertValues.push(user.referralCode ?? null);
  } else if (hasReferralCodeCamel) {
    insertFields.push('referralCode');
    insertValues.push(user.referralCode ?? null);
  }

  // 处理referrer_id / referrerId
  if (hasReferrerIdSnake) {
    insertFields.push('referrer_id');
    insertValues.push(user.referrerId ?? null);
  } else if (hasReferrerIdCamel) {
    insertFields.push('referrerId');
    insertValues.push(user.referrerId ?? null);
  }

  if (hasStaffIdSnake) {
    insertFields.push('staff_id');
    insertValues.push(user.staffId ?? null);
  } else if (hasStaffIdCamel) {
    insertFields.push('staffId');
    insertValues.push(user.staffId ?? null);
  }

  if (hasAccountType) {
    insertFields.push('account_type'); insertValues.push(user.accountType ?? 'formal')
  }
  if (hasAccountStatus) {
    insertFields.push('account_status'); insertValues.push(user.accountStatus ?? (user.status === 'active' ? 'active' : 'inactive'))
  }
  if (hasGuestOrderId) {
    insertFields.push('guest_order_id'); insertValues.push(user.guestOrderId ?? null)
  }
  if (hasGuestExpiresAt) {
    insertFields.push('guest_expires_at'); insertValues.push(user.guestExpiresAt ?? null)
  }

  // 处理created_at / createdAt
  if (hasCreatedAtSnake) {
    insertFields.push('created_at');
    insertValues.push(user.createdAt ?? new Date().toISOString());
  } else if (hasCreatedAtCamel) {
    insertFields.push('createdAt');
    insertValues.push(user.createdAt ?? new Date().toISOString());
  }

  // 根据数据库存在的列添加密码相关字段
  if (passwordHashToStore !== null) {
    if (hasPasswordHashSnake) {
      insertFields.push('password_hash');
      insertValues.push(passwordHashToStore);
    } else if (hasPasswordHashCamel) {
      insertFields.push('passwordHash');
      insertValues.push(passwordHashToStore);
    }
  }

  if (passwordSaltToStore !== null) {
    if (hasPasswordSaltSnake) {
      insertFields.push('password_salt');
      insertValues.push(passwordSaltToStore);
    } else if (hasPasswordSaltCamel) {
      insertFields.push('passwordSalt');
      insertValues.push(passwordSaltToStore);
    }
  }

  const placeholders = insertFields.map(() => '?').join(', ');
  const sql = `INSERT INTO users (${insertFields.join(', ')}) VALUES (${placeholders})`;

  await db.prepare(sql).bind(...insertValues).run()

  const usersOldTable = await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='users_old'").first()
  if (usersOldTable) {
    await db.prepare(`
      INSERT OR IGNORE INTO users_old
        (id, name, email, phone, passwordHash, role, status, bsb, accountNumber,
         referrerId, commissionBalance, balance, referralCode, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      user.id,
      user.name,
      user.email,
      user.phone || null,
      passwordHashToStore ?? '',
      user.role,
      user.status ?? 'active',
      user.bsb || null,
      user.accountNumber || null,
      user.referrerId || null,
      user.commissionBalance ?? 0,
      user.balance ?? 0,
      user.referralCode ?? null,
      user.createdAt ?? new Date().toISOString(),
      user.updatedAt ?? new Date().toISOString()
    ).run()
  }

  const insertedRow = await db.prepare('SELECT * FROM users WHERE id = ?').bind(user.id).first() as any | null
  if (!insertedRow) return null as any
  const inserted = normalizeUserRow(insertedRow)
  delete (inserted as any).passwordHash
  delete (inserted as any).passwordSalt
  delete (inserted as any).password_hash
  delete (inserted as any).password_salt
  delete (inserted as any).password
  if (inserted.role === 'CUSTOMER') {
    await syncSquareCustomerProfile(c, inserted).catch(error => console.error(JSON.stringify({ message: 'Square customer sync skipped', error: error instanceof Error ? error.message : String(error), userId: inserted.id })))
  }
  return inserted as User
}

export async function updateUser(c: Context, userId: string, data: Partial<User> & { password?: string }): Promise<User | null> {
  const db = getDB(c)
  const fields: Record<string, any> = { ...data }

  if (fields.password) {
    const newHashedPassword = await hashPassword(fields.password);
    fields.passwordHash = newHashedPassword;
    fields.passwordSalt = 'v2';
    delete fields.password;
  }

  // 字段名映射：前端驼峰 -> 数据库蛇形列名
  const fieldMapping: Record<string, string> = {
    referralCode: 'referral_code',
    referrerId: 'referrer_id',
    passwordHash: 'password_hash',
    passwordSalt: 'password_salt',
    commissionBalance: 'commission_balance',
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    commissionRate: 'commission_rate',
    staffId: 'staff_id',
    accountType: 'account_type',
    accountStatus: 'account_status',
    guestOrderId: 'guest_order_id',
    guestExpiresAt: 'guest_expires_at',
    deletedAt: 'deleted_at',
    deletionRequestedAt: 'deletion_requested_at',
    deletionScheduledAt: 'deletion_scheduled_at',
    squareCustomerId: 'square_customer_id',
    accountNumber: 'account_number'
    , accessLevel: 'access_level'
  }

  const allowedFields = new Set([
    'name', 'email', 'role', 'status', 'balance', 'phone', 'bsb', 'account', 'accountNumber',
    'referralCode', 'referrerId', 'passwordHash', 'passwordSalt', 'commissionBalance',
    'createdAt', 'updatedAt', 'commissionRate', 'staffId', 'accountType', 'accountStatus',
    'guestOrderId', 'guestExpiresAt', 'deletedAt', 'deletionRequestedAt', 'deletionScheduledAt', 'accessLevel',
    'squareCustomerId',
  ])
  for (const key of Object.keys(fields)) {
    if (!allowedFields.has(key)) delete fields[key]
  }
  for (const key of ['name', 'phone', 'bsb', 'account', 'accountNumber', 'referralCode']) {
    if (fields[key] !== undefined) fields[key] = sanitizePlainText(fields[key], key === 'name' ? 100 : 64)
  }
  if (fields.email !== undefined) fields.email = String(fields.email).trim().toLowerCase().slice(0, 254)

  const setEntries = Object.entries(fields).filter(([k]) => k !== 'id' && fields[k] !== undefined)
  if (setEntries.length === 0) {
    return db.prepare('SELECT * FROM users WHERE id = ?').bind(userId).first() as User | null
  }

  const columns = await getTableColumns(db, 'users')
  const mappedSetEntries = setEntries
    .map(([key, value]) => {
      const mappedKey = fieldMapping[key] || key
      if (columns.has(mappedKey)) return [mappedKey, value]
      if (columns.has(key)) return [key, value]
      return null
    })
    .filter((entry): entry is [string, any] => Boolean(entry))
  if (!mappedSetEntries.length) return getUserById(c, userId)
  const setClause = mappedSetEntries.map(([k]) => `${k} = ?`).join(', ')
  const values = mappedSetEntries.map(([, v]) => v)

  await db.prepare(`UPDATE users SET ${setClause} WHERE id = ?`).bind(...values, userId).run()
  const updated = await db.prepare('SELECT * FROM users WHERE id = ?').bind(userId).first() as User | null
  if (!updated) return null
  const normalized = normalizeUserRow(updated as any)
  delete (normalized as any).passwordHash
  delete (normalized as any).passwordSalt
  delete (normalized as any).password
  if (normalized.role === 'CUSTOMER' && ['name', 'email', 'phone'].some(key => data[key as keyof User] !== undefined)) {
    await syncSquareCustomerProfile(c, normalized).catch(error => console.error(JSON.stringify({ message: 'Square customer update skipped', error: error instanceof Error ? error.message : String(error), userId })))
  }
  return normalized
}

// ---------------------------------------------------------------------------
// 订单
// ---------------------------------------------------------------------------

export async function getOrderById(cOrContext: Context | string, id?: string): Promise<Order | null> {
  const db = getDB(typeof cOrContext === 'string' ? undefined : cOrContext)
  const actualId = typeof cOrContext === 'string' ? cOrContext : id
  if (!actualId) {
    return null;
  }

  // 1. 直接使用传入的 id 进行查询
  let orderRow = await db.prepare('SELECT * FROM orders WHERE id = ? AND deleted_at IS NULL').bind(actualId).first()
  if (orderRow) {
    return normalizeOrderRow(orderRow)
  }

  // 2. 如果查询结果为空，并且传入的 id 不以 o- 开头，则尝试添加 o- 前缀后再次查询
  if (!actualId.startsWith('o-')) {
    const prefixedId = `o-${actualId}`
    orderRow = await db.prepare('SELECT * FROM orders WHERE id = ? AND deleted_at IS NULL').bind(prefixedId).first()
    if (orderRow) {
      return normalizeOrderRow(orderRow)
    }
  }

  // 3. 如果查询结果为空，并且传入的 id 以 o- 开头，则尝试去除 o- 前缀后再次查询
  if (actualId.startsWith('o-')) {
    const unprefixedId = actualId.substring(2)
    orderRow = await db.prepare('SELECT * FROM orders WHERE id = ? AND deleted_at IS NULL').bind(unprefixedId).first()
    if (orderRow) {
      return normalizeOrderRow(orderRow)
    }
  }

  return null
}

export async function getOrderByOrderNo(c: Context, orderNo: string): Promise<Order | null> {
  const db = getDB(c)
  const orderRow = await db.prepare('SELECT * FROM orders WHERE UPPER(orderNo) = ? AND deleted_at IS NULL').bind(orderNo.toUpperCase()).first()
  return orderRow ? normalizeOrderRow(orderRow) : null
}

export async function getOrders(c?: Context): Promise<Order[]> {
  const db = getDB(c)
  const result = await db.prepare('SELECT * FROM orders WHERE deleted_at IS NULL').all()
  return ((result.results || []) as any[]).map(normalizeOrderRow) || []
}

export async function getOrdersForUser(cOrContext: Context | string, userId?: string): Promise<Order[]> {
  const db = getDB(typeof cOrContext === 'string' ? undefined : cOrContext)
  const actualUserId = typeof cOrContext === 'string' ? cOrContext : userId
  if (!actualUserId) return []
  const result = await db.prepare('SELECT * FROM orders WHERE userId = ? AND deleted_at IS NULL').bind(actualUserId).all()
  return ((result.results || []) as any[]).map(normalizeOrderRow) || []
}

export async function getOrdersWithDetailsForUser(c: Context, userId: string): Promise<any[]> {
  const db = getDB(c);
  const query = `
    SELECT
      o.id,
      o.orderNo,
      o.startDate,
      o.endDate,
      o.totalAmount,
      o.status,
      o.deliveryMethod,
      o.deliveryFee,
      d.name as deviceName
    FROM orders o
    LEFT JOIN devices d ON o.deviceId = d.id
    WHERE o.userId = ? AND o.deleted_at IS NULL
    ORDER BY o.createdAt DESC
  `;
  const result = await db.prepare(query).bind(userId).all();
  const rows = (result.results || []) as any[]
  if (!rows.length) return rows
  try {
    const placeholders = rows.map(() => '?').join(',')
    const bookings = await db.prepare(`SELECT order_id, direction, status, provider_reference, tracking_url FROM delivery_bookings WHERE order_id IN (${placeholders}) ORDER BY created_at DESC`).bind(...rows.map(row => row.id)).all() as any
    const grouped = new Map<string, any[]>()
    for (const booking of bookings.results || []) grouped.set(String(booking.order_id), [...(grouped.get(String(booking.order_id)) || []), booking])
    return rows.map(row => ({ ...row, deliveryBookings: grouped.get(String(row.id)) || [] }))
  } catch {
    return rows.map(row => ({ ...row, deliveryBookings: [] }))
  }
}

export async function getOrdersByIds(c: Context, ids: string[]): Promise<Order[]> {
  if (!ids.length) return []
  const db = getDB(c)
  const placeholders = ids.map(() => '?').join(', ')
  const result = await db.prepare(`SELECT * FROM orders WHERE id IN (${placeholders}) AND deleted_at IS NULL`).bind(...ids).all()
  return (result.results as Order[]) || []
}

export async function getOrdersAsync(c: Context): Promise<any[]> {
  const db = getDB(c)
  const result = await db.prepare('SELECT * FROM orders WHERE deleted_at IS NULL').all()
  return result.results || []
}

export async function insertOrder(c: Context, order: Order): Promise<void> {
  const db = getDB(c)
  await db
    .prepare(
      'INSERT INTO orders (id, orderNo, userId, deviceId, startDate, endDate, startPeriod, endPeriod, rentalPeriod, status, paymentMethod, totalAmount, depositAmount, contractId, pickupTimeSlot, returnTimeSlot, pickupLocation, returnLocation, deliveryMethod, deliveryFee, serviceFee, rentalNote, coupon_code, discount_amount, createdAt, rental_link_id, booking_buffer_days, rental_pricing_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    )
    .bind(
      order.id,
      order.orderNo,
      order.userId,
      order.deviceId,
      order.startDate,
      order.endDate,
      order.startPeriod || 'AM', order.endPeriod || 'AM',
      order.rentalPeriod, // Add rentalPeriod here
      order.status,
      order.paymentMethod,
      order.totalAmount,
      order.depositAmount,
      order.contractId, order.pickupTimeSlot || null, order.returnTimeSlot || null, order.pickupLocation || null, order.returnLocation || null, (order as any).deliveryMethod || 'Pickup', Number((order as any).deliveryFee || 0), Number((order as any).serviceFee || 0), (order as any).rentalNote || null,
      (order as any).couponCode || null, Number((order as any).discountAmount || 0), order.createdAt, order.rental_link_id || null, Number(order.booking_buffer_days || 0), order.rental_pricing_json || null
    )
    .run()
}

// 手动订单不隐含收款或合同签署；空客户和租期直接存 NULL。
export async function insertManualOrder(c: Context, id: string, data: ManualOrderData, createdBy: string): Promise<void> {
  const fields = Object.keys(data) as (keyof ManualOrderData)[]
  await getDB(c).prepare(`INSERT INTO orders (id, orderNo, is_manual, createdAtBy, order_status, rental_status, ${fields.join(', ')}) VALUES (?, ?, 1, ?, 'ACTIVE', 'ACTIVE', ${fields.map(() => '?').join(', ')})`)
    .bind(id, generateReferenceNumber('OD'), createdBy, ...fields.map(field => data[field])).run()
}

export async function updateManualOrder(c: Context, id: string, data: ManualOrderData, previousStatus: string): Promise<boolean> {
  const fields = Object.keys(data) as (keyof ManualOrderData)[]
  const result = await getDB(c).prepare(`UPDATE orders SET ${fields.map(field => `${field} = ?`).join(', ')}, updatedAt = CURRENT_TIMESTAMP WHERE id = ? AND is_manual = 1 AND status = ? AND status NOT IN ('completed', 'cancelled')`)
    .bind(...fields.map(field => data[field]), id, previousStatus).run()
  return Number(result.meta?.changes || 0) > 0
}

export async function ensureOrderNumber(c: Context, orderId: string, externalReference = ''): Promise<string> {
  const existing = await c.env.RENT.prepare('SELECT orderNo FROM orders WHERE id = ?').bind(orderId).first() as any
  if (!existing) throw new Error('订单不存在，无法生成订单编号')
  if (existing.orderNo) return String(existing.orderNo)

  const orderNo = generateReferenceNumber('OD')
  await c.env.RENT.prepare('UPDATE orders SET orderNo = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ? AND (orderNo IS NULL OR orderNo = ?)')
    .bind(orderNo, orderId, '').run()
  const saved = await c.env.RENT.prepare('SELECT orderNo FROM orders WHERE id = ?').bind(orderId).first() as any
  if (!saved?.orderNo) throw new Error('订单编号生成失败')
  return String(saved.orderNo)
}

export async function updateOrder(c: Context, order: Order): Promise<void> {
  const db = getDB(c)
  await db
    .prepare(
      'UPDATE orders SET orderNo = ?, userId = ?, deviceId = ?, startDate = ?, endDate = ?, status = ?, paymentMethod = ?, totalAmount = ?, depositAmount = ?, contractId = ? WHERE id = ?'
    )
    .bind(
      order.orderNo ?? null,
      order.userId ?? null,
      order.deviceId ?? null,
      order.startDate ?? null,
      order.endDate ?? null,
      order.status ?? 'pending_payment',
      order.paymentMethod ?? null,
      Number(order.totalAmount ?? 0),
      Number(order.depositAmount ?? 0),
      order.contractId || null,
      order.id
    )
    .run()
}

// Compatibility aliases expected by legacy code
export async function updateOrderInDB(c: Context, orderId: string, data: Partial<Order>): Promise<void> {
  const fields: Array<[string, unknown]> = [
    ['orderNo', data.orderNo],
    ['userId', data.userId],
    ['deviceId', data.deviceId],
    ['startDate', data.startDate],
    ['endDate', data.endDate],
    ['status', data.status],
    ['paymentMethod', data.paymentMethod],
    ['payment_provider', data.paymentProvider ?? data.payment_provider],
    ['totalAmount', data.totalAmount],
    ['depositAmount', data.depositAmount],
    ['contractId', data.contractId],
  ]
  const updates = fields.filter(([, value]) => value !== undefined)
  if (!updates.length) return
  const existing = await c.env.RENT.prepare('SELECT id FROM orders WHERE id = ?').bind(orderId).first()
  if (!existing) return
  await c.env.RENT.prepare(`UPDATE orders SET ${updates.map(([field]) => `${field} = ?`).join(', ')} WHERE id = ?`)
    .bind(...updates.map(([, value]) => value), orderId)
    .run()
}

export async function hasDeviceBookingConflict(c: Context, deviceId: string, startDate: string, endDate: string, excludeOrderId?: string, bufferDays = 0, startPeriod?: string, endPeriod?: string): Promise<boolean> {
  const requestedStart = new Date(`${startDate}T00:00:00Z`)
  const requestedEnd = new Date(`${endDate}T00:00:00Z`)
  requestedStart.setUTCDate(requestedStart.getUTCDate() - Math.max(0, bufferDays))
  requestedEnd.setUTCDate(requestedEnd.getUTCDate() + Math.max(0, bufferDays))
  const conflictStart = requestedStart.toISOString().slice(0, 10)
  const conflictEnd = requestedEnd.toISOString().slice(0, 10)
  if (!startPeriod || !endPeriod) {
    const row = await c.env.RENT.prepare(`
      SELECT id FROM orders
      WHERE deviceId = ? AND id != ? AND deleted_at IS NULL
        AND status NOT IN ('completed', 'cancelled')
        AND startDate < ? AND endDate > ?
      LIMIT 1
    `).bind(deviceId, excludeOrderId || '', conflictEnd, conflictStart).first()
    return Boolean(row)
  }
  const periodIndex = (date: string, period: string) => Math.round(Date.parse(`${date}T00:00:00Z`) / 86400000) * 2 + (period === 'PM' ? 1 : 0)
  const requestStart = periodIndex(conflictStart, bufferDays ? 'AM' : startPeriod)
  const requestEnd = periodIndex(conflictEnd, bufferDays ? 'PM' : endPeriod)
  const rows = await c.env.RENT.prepare(`
    SELECT startDate, endDate, startPeriod, endPeriod FROM orders
    WHERE deviceId = ? AND id != ? AND deleted_at IS NULL
      AND status NOT IN ('completed', 'cancelled')
      AND startDate IS NOT NULL AND endDate IS NOT NULL
  `).bind(deviceId, excludeOrderId || '').all() as any
  return (rows.results || []).some((item: any) => requestStart < periodIndex(String(item.endDate || '').slice(0, 10), String(item.endPeriod || 'AM')) && periodIndex(String(item.startDate || '').slice(0, 10), String(item.startPeriod || 'AM')) < requestEnd)
}

// ---------------------------------------------------------------------------
// 设备
// ---------------------------------------------------------------------------

export async function getDeviceById(cOrContext: Context | string, id?: string): Promise<Device | null> {
  const db = getDB(typeof cOrContext === 'string' ? undefined : cOrContext)
  const actualId = typeof cOrContext === 'string' ? cOrContext : id
  if (!actualId) return null
  const deviceRow = await db.prepare('SELECT * FROM devices WHERE id = ? AND deleted_at IS NULL').bind(actualId).first()
  if (!deviceRow) return null

  // 统一处理snake_case和camelCase字段
  const pricePerDay = deviceRow.pricePerDay ?? deviceRow.price_per_day
  const depositAmount = deviceRow.depositAmount ?? deviceRow.deposit_amount
  const discounts = resolveRentalDiscounts(deviceRow, getSystemSettings().rentalRules)
  const { weeklyDiscountPercent, monthlyDiscountPercent } = discounts

  // Add type validation for required fields
  if (typeof pricePerDay !== 'number' || typeof depositAmount !== 'number') {
    throw new Error(`Device ${actualId} has missing or invalid pricePerDay or depositAmount`)
  }

  // 确保返回的设备对象同时包含两种格式的字段，兼容所有调用方
  return {
    ...deviceRow,
    ...discounts,
    category: deviceRow.category || '其他',
    pricePerDay,
    price_per_day: pricePerDay,
    depositAmount,
    deposit_amount: depositAmount,
    weeklyDiscountPercent,
    monthlyDiscountPercent,
    weekly_discount_percent: weeklyDiscountPercent,
    monthly_discount_percent: monthlyDiscountPercent,
    minimumRentalDays: deviceRow.minimumRentalDays ?? deviceRow.minimum_rental_days ?? null,
    minimum_rental_days: deviceRow.minimum_rental_days ?? deviceRow.minimumRentalDays ?? null,
    bufferDays: deviceRow.bufferDays ?? deviceRow.buffer_days ?? null,
    buffer_days: deviceRow.buffer_days ?? deviceRow.bufferDays ?? null
  } as Device
}

export async function getDeviceBySerialNumber(c: Context, serialNumber: string): Promise<Device | null> {
  const db = getDB(c)
  return db.prepare('SELECT * FROM devices WHERE serialNumber = ? AND deleted_at IS NULL').bind(serialNumber).first() as Device | null
}

export async function getDevices(c?: Context): Promise<Device[]> {
  const db = getDB(c)
  const result = await db.prepare('SELECT * FROM devices WHERE deleted_at IS NULL').all()
  if (!result.results) return []

  // 为每个设备统一处理snake_case和camelCase字段
  return (result.results as any[]).map(deviceRow => {
    const pricePerDay = deviceRow.pricePerDay ?? deviceRow.price_per_day
    const depositAmount = deviceRow.depositAmount ?? deviceRow.deposit_amount
    const serialNumber = deviceRow.serialNumber ?? deviceRow.serial_number
    const serial_number = deviceRow.serial_number ?? deviceRow.serialNumber
    const price_per_day = deviceRow.price_per_day ?? deviceRow.pricePerDay
    const deposit_amount = deviceRow.deposit_amount ?? deviceRow.depositAmount
    const discounts = resolveRentalDiscounts(deviceRow, getSystemSettings().rentalRules)
    const { weeklyDiscountPercent, monthlyDiscountPercent } = discounts

    return {
      ...deviceRow,
      ...discounts,
      category: deviceRow.category || '其他',
      pricePerDay,
      depositAmount,
      serialNumber,
      serial_number,
      price_per_day,
      deposit_amount,
      weeklyDiscountPercent,
      monthlyDiscountPercent,
      weekly_discount_percent: weeklyDiscountPercent,
      monthly_discount_percent: monthlyDiscountPercent,
      minimumRentalDays: deviceRow.minimumRentalDays ?? deviceRow.minimum_rental_days ?? null,
      minimum_rental_days: deviceRow.minimum_rental_days ?? deviceRow.minimumRentalDays ?? null,
      bufferDays: deviceRow.bufferDays ?? deviceRow.buffer_days ?? null,
      buffer_days: deviceRow.buffer_days ?? deviceRow.bufferDays ?? null
    } as Device
  }) || []
}

export async function getDevicesByIds(c: Context, ids: string[]): Promise<Device[]> {
  if (!ids.length) return []
  const db = getDB(c)
  const placeholders = ids.map(() => '?').join(', ')
  const result = await db.prepare(`SELECT * FROM devices WHERE id IN (${placeholders}) AND deleted_at IS NULL`).bind(...ids).all()
  return (result.results as Device[]) || []
}

export async function getDevicesAsync(c: Context): Promise<Device[]> {
  return getDevices(c)
}

export async function insertDevice(c: Context, device: Omit<Device, 'id'> & { id?: string; demoMode?: boolean }): Promise<Device> {
  const db = getDB(c)
  const { nanoid } = await import('nanoid')
  const deviceId = device.id || `d-${nanoid(8)}`

  // 先检查devices表中存在哪些列，避免硬编码列名导致错误
  const deviceColumns = await getTableColumns(db, 'devices');

  const hasSerialNumberSnake = deviceColumns.has('serial_number');
  const hasSerialNumberCamel = deviceColumns.has('serialNumber');
  const hasPricePerDaySnake = deviceColumns.has('price_per_day');
  const hasPricePerDayCamel = deviceColumns.has('pricePerDay');
  const hasDepositAmountSnake = deviceColumns.has('deposit_amount');
  const hasDepositAmountCamel = deviceColumns.has('depositAmount');
  const hasWeeklyDiscountSnake = deviceColumns.has('weekly_discount_percent');
  const hasWeeklyDiscountCamel = deviceColumns.has('weeklyDiscountPercent');
  const hasMonthlyDiscountSnake = deviceColumns.has('monthly_discount_percent');
  const hasMonthlyDiscountCamel = deviceColumns.has('monthlyDiscountPercent');

  // 构建插入字段和值
  const insertFields = ['id', 'name', 'model', 'status', 'description'];
  const insertValues: Array<string | null> = [
    deviceId,
    sanitizePlainText(device.name, 120),
    sanitizePlainText(device.model, 120),
    device.status || 'available',
    sanitizePlainText(device.description, 2000),
  ];
  if (deviceColumns.has('lifecycle_status')) {
    const initialLifecycle: DeviceLifecycleStatus = device.status === 'maintenance' ? 'MAINTENANCE' : device.status === 'retired' ? 'RETIRED' : device.status === 'rented' ? 'RENTED' : 'READY'
    insertFields.push('lifecycle_status')
    insertValues.push(initialLifecycle)
  }

  for (const field of ['category', 'brand', 'asset_tag', 'cpu', 'ram', 'storage', 'gpu', 'os']) {
    if (!deviceColumns.has(field)) continue
    const sourceKey = field === 'asset_tag' ? 'assetTag' : field
    insertFields.push(field)
    insertValues.push(sanitizePlainText((device as any)[sourceKey] ?? (device as any)[field], 200))
  }

  if (deviceColumns.has('agent_token_hash') && (device as any).agentTokenHash) {
    insertFields.push('agent_token_hash')
    insertValues.push(sanitizePlainText((device as any).agentTokenHash, 128))
  }

  // 处理序列号字段
  if (hasSerialNumberCamel) {
    insertFields.push('serialNumber');
    insertValues.push(device.serialNumber);
  } else if (hasSerialNumberSnake) {
    insertFields.push('serial_number');
    insertValues.push(device.serialNumber);
  }

  // 处理日租金字段
  if (hasPricePerDayCamel) {
    insertFields.push('pricePerDay');
    insertValues.push(device.pricePerDay.toString());
  } else if (hasPricePerDaySnake) {
    insertFields.push('price_per_day');
    insertValues.push(device.pricePerDay.toString());
  }

  // 处理押金字段
  if (hasDepositAmountCamel) {
    insertFields.push('depositAmount');
    insertValues.push(device.depositAmount.toString());
  } else if (hasDepositAmountSnake) {
    insertFields.push('deposit_amount');
    insertValues.push(device.depositAmount.toString());
  }

  if (hasWeeklyDiscountCamel) {
    insertFields.push('weeklyDiscountPercent');
    insertValues.push(String((device as any).weeklyDiscountPercent ?? (device as any).weekly_discount_percent ?? 0));
  } else if (hasWeeklyDiscountSnake) {
    insertFields.push('weekly_discount_percent');
    insertValues.push(String((device as any).weeklyDiscountPercent ?? (device as any).weekly_discount_percent ?? 0));
  }
  if (hasMonthlyDiscountCamel) {
    insertFields.push('monthlyDiscountPercent');
    insertValues.push(String((device as any).monthlyDiscountPercent ?? (device as any).monthly_discount_percent ?? 0));
  } else if (hasMonthlyDiscountSnake) {
    insertFields.push('monthly_discount_percent');
    insertValues.push(String((device as any).monthlyDiscountPercent ?? (device as any).monthly_discount_percent ?? 0));
  }

  const overrides = resolveRentalDiscounts(device, getSystemSettings().rentalRules)
  for (const [column, value] of [['weekly_discount_override', overrides.weeklyDiscountOverride], ['monthly_discount_override', overrides.monthlyDiscountOverride]] as const) {
    if (deviceColumns.has(column)) { insertFields.push(column); insertValues.push(value == null ? null : String(value)) }
  }

  if (device.demoMode) {
    insertFields.push('demo_available_from')
    insertValues.push(createDemoAvailableFrom())
  }

  const placeholders = insertFields.map(() => '?').join(', ');
  const sql = `INSERT INTO devices (${insertFields.join(', ')}) VALUES (${placeholders})`;

  await db.prepare(sql).bind(...insertValues).run()
  const inserted = await db.prepare('SELECT * FROM devices WHERE id = ? AND deleted_at IS NULL').bind(deviceId).first() as Device
  await syncSquareCatalogItem(c, inserted).catch(error => console.error(JSON.stringify({ message: 'Square catalog sync skipped', error: error instanceof Error ? error.message : String(error), deviceId })))
  return inserted
}

export async function updateDevice(c: Context, deviceId: string, data: Partial<Device> & { demoMode?: boolean }): Promise<Device | null> {
  const db = getDB(c)
  const existing = await getDeviceById(c, deviceId)
  if (!existing) return null

  // Older deployments use snake_case columns while newer ones use camelCase.
  // Resolve the actual schema once so editing works against either database.
  const columns = await getTableColumns(db, 'devices')

  const columnMapping: Record<string, string> = {
    name: 'name', category: 'category', brand: 'brand', model: 'model', assetTag: 'asset_tag', asset_tag: 'asset_tag',
    cpu: 'cpu', ram: 'ram', storage: 'storage', gpu: 'gpu', os: 'os', status: 'status', description: 'description',
    serialNumber: 'serialNumber', serial_number: 'serial_number',
    pricePerDay: 'pricePerDay', price_per_day: 'price_per_day',
    depositAmount: 'depositAmount', deposit_amount: 'deposit_amount',
    weeklyDiscountPercent: 'weekly_discount_percent', weekly_discount_percent: 'weekly_discount_percent',
    monthlyDiscountPercent: 'monthly_discount_percent', monthly_discount_percent: 'monthly_discount_percent',
    weeklyDiscountOverride: 'weekly_discount_override', weekly_discount_override: 'weekly_discount_override',
    monthlyDiscountOverride: 'monthly_discount_override', monthly_discount_override: 'monthly_discount_override',
    minimumRentalDays: 'minimum_rental_days', minimum_rental_days: 'minimum_rental_days',
    bufferDays: 'buffer_days', buffer_days: 'buffer_days',
    agentStatus: 'agent_status', agent_status: 'agent_status',
    deviceMode: 'device_mode', device_mode: 'device_mode',
    lifecycleStatus: 'lifecycle_status', lifecycle_status: 'lifecycle_status',
  }
  const plainTextFields = new Set(['name', 'category', 'brand', 'model', 'assetTag', 'asset_tag', 'cpu', 'ram', 'storage', 'gpu', 'os', 'description', 'serialNumber', 'serial_number'])
  const setEntries: [string, any][] = []
  if (data.demoMode !== undefined) {
    setEntries.push(['demo_available_from', data.demoMode ? (existing.demo_available_from || existing.demoAvailableFrom || createDemoAvailableFrom()) : null])
  }
  for (const [key, value] of Object.entries(data)) {
    let column = columnMapping[key]
    if (column === 'asset_tag' && !columns.has(column) && columns.has('assetTag')) column = 'assetTag'
    if (column === 'serialNumber' && !columns.has(column) && columns.has('serial_number')) column = 'serial_number'
    if (column === 'pricePerDay' && !columns.has(column) && columns.has('price_per_day')) column = 'price_per_day'
    if (column === 'depositAmount' && !columns.has(column) && columns.has('deposit_amount')) column = 'deposit_amount'
    if (column === 'weekly_discount_percent' && !columns.has(column) && columns.has('weeklyDiscountPercent')) column = 'weeklyDiscountPercent'
    if (column === 'monthly_discount_percent' && !columns.has(column) && columns.has('monthlyDiscountPercent')) column = 'monthlyDiscountPercent'
    if (column && columns.has(column) && value !== undefined) {
      setEntries.push([column, plainTextFields.has(key) ? sanitizePlainText(value, key === 'description' ? 2000 : 120) : value])
    }
  }

  if (setEntries.length === 0) return existing

  const setClause = setEntries.map(([col]) => `${col} = ?`).join(', ')
  const values = setEntries.map(([, v]) => v)

  await db.prepare(`UPDATE devices SET ${setClause} WHERE id = ?`).bind(...values, deviceId).run()
  const updated = await db.prepare('SELECT * FROM devices WHERE id = ? AND deleted_at IS NULL').bind(deviceId).first() as Device
  await syncSquareCatalogItem(c, updated).catch(error => console.error(JSON.stringify({ message: 'Square catalog update skipped', error: error instanceof Error ? error.message : String(error), deviceId })))
  return updated
}

export async function deleteDevice(c: Context, deviceId: string): Promise<boolean> {
  const db = getDB(c)
  const activeOrder = await db.prepare("SELECT id FROM orders WHERE deviceId = ? AND deleted_at IS NULL AND status IN ('approved', 'pending_payment', 'paid', 'pending_pickup', 'active', 'extended', 'overdue', 'suspended', 'pending_return') LIMIT 1").bind(deviceId).first()
  if (activeOrder) return false
  const result = await db.prepare("UPDATE devices SET deleted_at = CURRENT_TIMESTAMP, status = 'retired', updatedAt = CURRENT_TIMESTAMP WHERE id = ? AND deleted_at IS NULL").bind(deviceId).run()
  return Number(result.meta?.changes || 0) > 0
}

export async function updateDeviceStatus(c: Context, deviceId: string, status: string): Promise<void> {
  const db = getDB(c);
  await db.prepare('UPDATE devices SET status = ? WHERE id = ?').bind(status, deviceId).run();
}

export async function recordDeviceLifecycle(c: Context, deviceId: string, nextStatus: DeviceLifecycleStatus, options: { orderId?: string, reason?: string, changedBy?: string } = {}): Promise<void> {
  if (!DEVICE_LIFECYCLE_STATES.has(nextStatus)) throw new Error('设备生命周期状态无效')
  const db = getDB(c)
  const device = await db.prepare('SELECT lifecycle_status FROM devices WHERE id = ?').bind(deviceId).first() as any
  if (!device) throw new Error('设备不存在')
  const previousStatus = String(device.lifecycle_status || 'READY')
  if (previousStatus === nextStatus) return
  await db.batch([
    db.prepare('UPDATE devices SET lifecycle_status = ?, status = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?').bind(nextStatus, legacyDeviceStatusForLifecycle(nextStatus), deviceId),
    db.prepare('INSERT INTO device_lifecycle_events (id, device_id, order_id, previous_status, next_status, reason, changed_by) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(`dle-${nanoid(16)}`, deviceId, options.orderId || null, previousStatus, nextStatus, options.reason || null, options.changedBy || null),
  ])
}

export async function releaseDeviceIfUnbooked(c: Context, deviceId: string, options: { orderId?: string, reason?: string, changedBy?: string } = {}): Promise<void> {
  const activeOrder = await c.env.RENT.prepare(`
    SELECT id FROM orders
    WHERE deviceId = ? AND deleted_at IS NULL AND status IN ('paid', 'active', 'extended', 'overdue', 'suspended', 'pending_pickup', 'pending_return', 'returned')
    LIMIT 1
  `).bind(deviceId).first()
  if (activeOrder) return
  // 验机完成直接恢复可租；未完成维护、损坏和退役设备继续保留当前状态。
  const openMaintenance = await c.env.RENT.prepare("SELECT id FROM maintenance_records WHERE device_id = ? AND status IN ('OPEN','IN_PROGRESS','DATA_CLEAN','SYSTEM_RESET','CLIENT_CHECK') LIMIT 1").bind(deviceId).first()
  if (openMaintenance) return
  const device = await c.env.RENT.prepare('SELECT lifecycle_status FROM devices WHERE id = ?').bind(deviceId).first() as any
  const currentLifecycle = String(device?.lifecycle_status || 'READY')
  if (!device || ['DAMAGED', 'MAINTENANCE', 'RETIRED'].includes(currentLifecycle)) return
  if (currentLifecycle === 'READY') {
    await updateDeviceStatus(c, deviceId, 'available')
  } else if (canTransitionDeviceLifecycle(currentLifecycle, 'READY')) {
    await recordDeviceLifecycle(c, deviceId, 'READY', { reason: '关联订单已取消/完成，设备已释放', ...options })
  }
}

// ---------------------------------------------------------------------------
// 合同
// ---------------------------------------------------------------------------

export async function getContractById(cOrContext: Context | string, id?: string): Promise<Contract | null> {
  const db = getDB(typeof cOrContext === 'string' ? undefined : cOrContext)
  const actualId = typeof cOrContext === 'string' ? cOrContext : id
  if (!actualId) return null
  const contractRow = await db.prepare('SELECT * FROM contracts WHERE id = ? AND deleted_at IS NULL').bind(actualId).first()
  if (!contractRow) return null

  // 统一处理snake_case和camelCase字段
  const validFrom = contractRow.validFrom ?? contractRow.valid_from
  const validUntil = contractRow.validUntil ?? contractRow.valid_until
  const signExpiresAt = contractRow.signExpiresAt ?? contractRow.sign_expires_at
  const rentalId = contractRow.orderId ?? contractRow.order_id ?? contractRow.rentalId ?? contractRow.rental_id
  const rental_id = contractRow.rental_id ?? contractRow.rentalId ?? contractRow.orderId ?? contractRow.order_id
  const sign_expires_at = contractRow.sign_expires_at ?? contractRow.signExpiresAt
  const valid_from = contractRow.valid_from ?? contractRow.validFrom
  const valid_until = contractRow.valid_until ?? contractRow.validUntil
  const createdBy = contractRow.createdBy ?? contractRow.created_by
  const created_by = contractRow.created_by ?? contractRow.createdBy

  // 确保返回的合同对象同时包含两种格式的字段，兼容所有调用方
  return {
    ...contractRow,
    validFrom,
    validUntil,
    signExpiresAt,
    rentalId,
    rental_id,
    sign_expires_at,
    valid_from,
    valid_until,
    createdBy,
    created_by
  } as Contract
}

export async function getContractByOrderId(cOrContext: Context | string, orderId?: string): Promise<Contract | null> {
  const db = getDB(typeof cOrContext === 'string' ? undefined : cOrContext)
  const actualOrderId = typeof cOrContext === 'string' ? cOrContext : orderId
  if (!actualOrderId) return null
  const contractRow = await db.prepare('SELECT * FROM contracts WHERE orderId = ? AND deleted_at IS NULL').bind(actualOrderId).first()
  if (!contractRow) return null

  // 统一处理snake_case和camelCase字段
  const validFrom = contractRow.validFrom ?? contractRow.valid_from
  const validUntil = contractRow.validUntil ?? contractRow.valid_until
  const signExpiresAt = contractRow.signExpiresAt ?? contractRow.sign_expires_at
  const rentalId = contractRow.orderId ?? contractRow.order_id ?? contractRow.rentalId ?? contractRow.rental_id
  const rental_id = contractRow.rental_id ?? contractRow.rentalId ?? contractRow.orderId ?? contractRow.order_id
  const sign_expires_at = contractRow.sign_expires_at ?? contractRow.signExpiresAt
  const valid_from = contractRow.valid_from ?? contractRow.validFrom
  const valid_until = contractRow.valid_until ?? contractRow.validUntil
  const createdBy = contractRow.createdBy ?? contractRow.created_by
  const created_by = contractRow.created_by ?? contractRow.createdBy

  // 确保返回的合同对象同时包含两种格式的字段，兼容所有调用方
  return {
    ...contractRow,
    validFrom,
    validUntil,
    signExpiresAt,
    rentalId,
    rental_id,
    sign_expires_at,
    valid_from,
    valid_until,
    createdBy,
    created_by
  } as Contract
}

export async function getAllContracts(c?: Context): Promise<Contract[]> {
  const db = getDB(c)
  const result = await db.prepare('SELECT * FROM contracts WHERE deleted_at IS NULL').all()
  return ((result.results || []) as any[]).map(normalizeContractRow) || []
}

export async function getContractByContractNumber(c: Context, contractNumber: string): Promise<Contract | null> {
  const db = getDB(c)
  // 将输入的合同编号转为大写，数据库中存储的都是大写字母和数字，实现大小写不敏感查询
  const upperCaseContractNumber = contractNumber.toUpperCase()
  const contractRow = await db.prepare('SELECT * FROM contracts WHERE UPPER(contractNumber) = ? AND deleted_at IS NULL').bind(upperCaseContractNumber).first()
  if (!contractRow) return null

  // 统一处理snake_case和camelCase字段
  const validFrom = contractRow.validFrom ?? contractRow.valid_from
  const validUntil = contractRow.validUntil ?? contractRow.valid_until
  const signExpiresAt = contractRow.signExpiresAt ?? contractRow.sign_expires_at
  const rentalId = contractRow.orderId ?? contractRow.order_id ?? contractRow.rentalId ?? contractRow.rental_id
  const rental_id = contractRow.rental_id ?? contractRow.rentalId ?? contractRow.orderId ?? contractRow.order_id
  const sign_expires_at = contractRow.sign_expires_at ?? contractRow.signExpiresAt
  const valid_from = contractRow.valid_from ?? contractRow.validFrom
  const valid_until = contractRow.valid_until ?? contractRow.validUntil
  const createdBy = contractRow.createdBy ?? contractRow.created_by
  const created_by = contractRow.created_by ?? contractRow.createdBy

  // 确保返回的合同对象同时包含两种格式的字段，兼容所有调用方
  return {
    ...contractRow,
    validFrom,
    validUntil,
    signExpiresAt,
    rentalId,
    rental_id,
    sign_expires_at,
    valid_from,
    valid_until,
    createdBy,
    created_by
  } as Contract
}

export async function getContractBySignToken(c: Context, signToken: string): Promise<Contract | null> {
  const db = getDB(c)
  const contractRow = await db.prepare('SELECT * FROM contracts WHERE signToken = ? AND deleted_at IS NULL AND EXISTS (SELECT 1 FROM orders WHERE orders.id = contracts.orderId AND orders.deleted_at IS NULL)').bind(signToken).first()
  if (!contractRow) return null

  // 统一处理snake_case和camelCase字段
  const validFrom = contractRow.validFrom ?? contractRow.valid_from
  const validUntil = contractRow.validUntil ?? contractRow.valid_until
  const signExpiresAt = contractRow.signExpiresAt ?? contractRow.sign_expires_at
  const rentalId = contractRow.orderId ?? contractRow.order_id ?? contractRow.rentalId ?? contractRow.rental_id
  const rental_id = contractRow.rental_id ?? contractRow.rentalId ?? contractRow.orderId ?? contractRow.order_id
  const sign_expires_at = contractRow.sign_expires_at ?? contractRow.signExpiresAt
  const valid_from = contractRow.valid_from ?? contractRow.validFrom
  const valid_until = contractRow.valid_until ?? contractRow.validUntil
  const createdBy = contractRow.createdBy ?? contractRow.created_by
  const created_by = contractRow.created_by ?? contractRow.createdBy

  // 确保返回的合同对象同时包含两种格式的字段，兼容所有调用方
  return {
    ...contractRow,
    validFrom,
    validUntil,
    signExpiresAt,
    rentalId,
    rental_id,
    sign_expires_at,
    valid_from,
    valid_until,
    createdBy,
    created_by
  } as Contract
}

export async function insertContract(c: Context, contract: Contract): Promise<void> {
  const db = getDB(c);
  // 同时插入驼峰和下划线格式的字段，确保兼容性
  await db.prepare('INSERT INTO contracts (id, orderId, contractNumber, content, signedAt, createdAt, signToken, status, validFrom, validUntil, signExpiresAt, created_by, sign_expires_at, sign_token, device_condition, device_accessories, late_fee_per_day, repair_cost, pickup_location, return_location, contract_data) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(
    contract.id, contract.rentalId, contract.contractNumber, contract.content, contract.signedAt, contract.createdAt, contract.signToken, contract.status, contract.validFrom, contract.validUntil, contract.signExpiresAt, contract.createdBy, contract.signExpiresAt, contract.signToken,
    contract.device_condition || null, contract.device_accessories || null, contract.late_fee_per_day || 0, contract.repair_cost ?? null, contract.pickup_location || null, contract.return_location || null,
    typeof contract.contract_data === 'string' ? contract.contract_data : JSON.stringify(contract.contract_data || {})
  ).run();
}

export async function updateContractStatus(c: Context, contractId: string, status: string, signedAt: string | null = null): Promise<void> {
  const db = getDB(c)
  await db.prepare('UPDATE contracts SET status = ?, signedAt = ? WHERE id = ?').bind(status, signedAt, contractId).run()

  // 如果合同被取消，则将关联的设备状态设置回“可用”
  if (status === 'cancelled') {
    const contract = await getContractById(c, contractId);
    if (contract && (contract.rentalId || contract.rental_id)) {
      const orderId = contract.rentalId || contract.rental_id;
      const order = await getOrderById(c, orderId);
      if (order && order.deviceId) {
        await updateDeviceStatus(c, order.deviceId, 'available');
        console.log(`Device ${order.deviceId} status set to 'available' due to contract ${contractId} cancellation.`);
      }
    }
  }
}

// Compatibility alias expected by legacy code
export async function updateContractStatusInDB(c: Context, contractId: string, status: string, signedAt: string | null = null): Promise<void> {
  await updateContractStatus(c, contractId, status, signedAt)
}
