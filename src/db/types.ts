/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

// 领域实体类型。这些接口带大量 camelCase / snake_case 兼容字段，历史上散在
// site.ts 顶部，被几乎所有 pages / actions 通过 `import { ... } from './site'` 引用。
// 拆到这里后 site.ts 仍统一 re-export，消费方无需改动。

import type { Role, AccessLevel } from '../lib/access'

export interface User {
  id: string
  name: string
  email: string
  passwordHash?: string
  password_salt?: string // 添加 password_salt 字段
  password?: string // 添加password属性以兼容旧代码
  role: Role
  accessLevel?: AccessLevel
  access_level?: AccessLevel
  phone?: string
  stripe_customer_id?: string | null
  stripeCustomerId?: string | null
  square_customer_id?: string | null
  squareCustomerId?: string | null
  bsb?: string
  account?: string
  account_number?: string
  accountNumber?: string // camelCase兼容前端代码
  balance: number
  status?: 'active' | 'inactive'
  accountStatus?: 'active' | 'banned' | 'inactive' | 'departed'
  account_status?: 'active' | 'banned' | 'inactive' | 'departed'
  commissionRate?: number
  referrerId?: string
  referralCode?: string
  registrationDate?: string

  // camelCase
  createdAt?: string
  commissionBalance: number

  // snake_case 兼容旧页面
  created_at?: string
  commission_balance?: number

  pendingCommission?: number
  withdrawnCommission?: number
  referredUsers?: Array<Record<string, any>>

  // staff 相关旧代码可能依赖
  staffId?: string
  staff_id?: string
  accountType?: 'formal' | 'guest' | 'deleted_guest'
  account_type?: 'formal' | 'guest' | 'deleted_guest'
  guestOrderId?: string | null
  guest_order_id?: string | null
  guestExpiresAt?: string | null
  guest_expires_at?: string | null
  deletedAt?: string | null
  deleted_at?: string | null
  deletionRequestedAt?: string | null
  deletionScheduledAt?: string | null
}

export interface Device {
  id: string
  name: string
  category?: string
  brand?: string
  model: string
  assetTag?: string
  asset_tag?: string
  serialNumber: string
  serial_number?: string
  cpu?: string
  ram?: string
  storage?: string
  gpu?: string
  os?: string

  // camelCase
  pricePerDay: number
  dailyRate?: number
  depositAmount: number
  weeklyDiscountPercent?: number
  monthlyDiscountPercent?: number
  weeklyDiscountOverride?: number | null
  monthlyDiscountOverride?: number | null
  weekly_discount_override?: number | null
  monthly_discount_override?: number | null
  minimumRentalDays?: number | null
  minimum_rental_days?: number | null
  bufferDays?: number | null
  buffer_days?: number | null
  demoAvailableFrom?: string | null
  demo_available_from?: string | null

  // snake_case 兼容旧页面
  price_per_day?: number
  deposit_amount?: number
  weekly_discount_percent?: number
  monthly_discount_percent?: number

  status: 'available' | 'rented' | 'maintenance' | 'retired'
  lifecycleStatus?: DeviceLifecycleStatus
  lifecycle_status?: DeviceLifecycleStatus
  description: string
  deviceMode?: 'normal' | 'return' | 'maintenance' | 'lost'
  device_mode?: 'normal' | 'return' | 'maintenance' | 'lost'
  agent_status?: string
  agent_hostname?: string
  agent_os_version?: string
  agent_cpu?: string
  agent_memory_mb?: number
  agent_storage_free_bytes?: number
  agent_version?: string
  agent_detected_serial?: string
  square_catalog_object_id?: string | null
  squareCatalogObjectId?: string | null
}

export type DeviceLifecycleStatus = 'RESERVED' | 'READY' | 'RENTED' | 'RETURNED' | 'INSPECTION' | 'MAINTENANCE' | 'DAMAGED' | 'RETIRED'

export interface Order {
  rental_pricing_json?: string | null
  billing_mode?: 'FULL' | 'MONTHLY'
  is_manual?: number
  rental_link_id?: string | null
  booking_buffer_days?: number
  id: string
  orderNo: string | null
  userId: string
  deviceId: string
  deviceName?: string
  startDate: string
  endDate: string
  startPeriod?: 'AM' | 'PM'
  endPeriod?: 'AM' | 'PM'
  pickupTimeSlot?: string
  returnTimeSlot?: string
  pickupLocation?: string
  returnLocation?: string
  deliveryMethod?: 'Pickup' | 'Delivery' | string
  delivery_method?: string
  deliveryFee?: number
  delivery_fee?: number
  serviceFee?: number
  service_fee?: number
  rentalPeriod?: number
  orderDate?: string
  status: string
  order_status?: string
  payment_status?: string
  rental_status?: string
  amount_due?: number
  pickup_notice_base_url?: string | null
  pickup_reminder_2h_sent_at?: string | null
  pickup_reminder_30m_sent_at?: string | null
  pickup_reminder_attempt_at?: string | null
  pickup_ready_at?: string | null
  pickup_ready_by?: string | null
  pickup_ready_email_sent_at?: string | null
  pickup_ready_email_attempt_at?: string | null
  handover_completed_at?: string | null
  handover_by?: string | null
  return_received_at?: string | null
  return_received_by?: string | null
  early_return_requested_at?: string | null
  early_return_requested_by?: string | null
  early_return_approved_at?: string | null
  early_return_approved_by?: string | null
  paymentMethod: 'card' | 'bank_transfer' | 'alipay' | 'wechat' | 'balance'
  paymentProvider?: 'stripe' | 'square' | 'internal' | string | null
  payment_provider?: 'stripe' | 'square' | 'internal' | string | null
  totalAmount: number
  depositAmount: number
  deposit_method?: 'bank_transfer' | 'cash' | 'card_hold'
  depositMethod?: 'bank_transfer' | 'cash' | 'card_hold'
  deposit_payment_mode?: 'PAID' | 'PREAUTH' | 'SETUP_INTENT'
  depositPaymentMode?: 'PAID' | 'PREAUTH' | 'SETUP_INTENT'
  stripe_deposit_payment_intent_id?: string | null
  deposit_status?: string
  deposit_deduction_amount?: number
  overdue_collected_amount?: number
  overdue_charge_total?: number
  overdue_outstanding_amount?: number
  overdue_deposit_applied?: number
  settlement_status?: 'NOT_APPLICABLE' | 'PENDING' | 'SETTLED'
  couponCode?: string | null
  discountAmount?: number
  dailyRate: number
  contractId: string
  signedAt: string | null
  createdAt: string

  // snake_case 兼容旧页面
  device_id?: string
  start_date?: string
  end_date?: string
  rental_period?: number
  total_amount?: number
  deposit_amount?: number
  created_at?: string

  // refunds 旧逻辑
  needsRefund?: boolean
  refund_ignored_at?: string | null
  refund_ignored_by?: string | null
  refund_ignore_reason?: string | null
  refundMethod?: 'balance' | 'original'
  refundBsb?: string
  refundAccountNumber?: string
  refundAccountName?: string
}

export interface Contract {
  id: string
  rentalId: string
  contractNumber: string
  content: string
  signedAt: string | null
  createdAt?: string
  signToken?: string
  status: 'draft' | 'pending_sign' | 'signed' | 'completed' | 'cancelled' | 'expired'
  validFrom?: string | null // New field for contract validity start date
  validUntil?: string | null // New field for contract validity end date
  valid_until?: string | null
  signExpiresAt?: string | null
  sign_expires_at?: string | null
  created_by?: string | null // 记录合同创建人ID
  createdBy?: string | null // camelCase 兼容：合同创建人ID
  deleted_at?: string | null // 软删除时间戳

  // snake_case 兼容旧页面
  rental_id?: string
  device_condition?: string | null
  device_accessories?: string | null
  late_fee_per_day?: number
  repair_cost?: number | null
  pickup_location?: string | null
  return_location?: string | null
  customer_id_type?: string | null
  customer_id_number?: string | null
  esign_ip?: string | null
  esign_device?: string | null
  contract_data?: string | Record<string, unknown> | null
  signed_content?: string | null
  content_hash?: string | null
  privacy_policy_accepted?: boolean | number | null
  privacy_policy_version?: string | null
  privacy_policy_accepted_at?: string | null
  privacy_policy_accepted_ip?: string | null
}

export interface ContractTemplate {
  id: string
  name: string
  content: string
  createdAt?: string
  updatedAt?: string
}
