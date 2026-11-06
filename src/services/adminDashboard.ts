/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

// 管理员控制台的只读聚合查询。以前 /admin/dashboard 会把 orders / users / devices
// 三张整表拉进 Worker 内存再逐项 filter/reduce，随数据量增长越来越慢。这里改成
// 数据库侧聚合 + 只取需要展示的「最近 5 条」。仅依赖 db/client。

import type { Context } from 'hono'
import { getDB } from '../db/client'

export interface AdminDashboardData {
  stats: {
    totalRevenue: number
    activeRentals: number
    pendingOrders: number
    availableDevices: number
    totalDevices: number
    totalUsers: number
    totalOrders: number
    todayPickups: number
    todayReturns: number
    overdueRentals: number
    pendingDeposits: number
    reservedDevices: number
    maintenanceDevices: number
    damagedDevices: number
    idleDevices: number
    utilizationRate: number
    onTheWayRevenue: number
    awaitingPickup: number
  }
  recentOrders: Array<{
    id: string
    orderNo: string | null
    status: string
    totalAmount: number
    customerName: string | null
    deviceName: string | null
  }>
  recentDevices: Array<{
    id: string
    name: string
    model: string | null
    status: string
    lifecycleStatus: string | null
    customerName: string | null
  }>
}

interface RecentOrderRow {
  id: unknown
  orderNo?: string | null
  status?: string | null
  totalAmount?: number | string | null
  customerName?: string | null
  deviceName?: string | null
}

interface RecentDeviceRow {
  id: unknown
  name?: string | null
  model?: string | null
  status?: string | null
  lifecycleStatus?: string | null
  customerName?: string | null
}

export async function getAdminDashboardData(c: Context): Promise<AdminDashboardData> {
  const db = getDB(c)

  // date('now') 与旧代码里的 new Date().toISOString().slice(0,10) 一样是 UTC 日期，保持口径一致。
  const statsQuery = `
    SELECT
      (SELECT COALESCE(SUM(rental_amount), 0) FROM payments WHERE status IN ('paid', 'refunded')) AS totalRevenue,
      (SELECT COUNT(*) FROM orders WHERE status IN ('active', 'paid')
         AND date(startDate) <= date('now') AND date(endDate) >= date('now')) AS activeRentals,
      (SELECT COUNT(*) FROM orders WHERE status IN ('pending_approval', 'pending_payment')) AS pendingOrders,
      (SELECT COUNT(*) FROM devices WHERE status = 'available') AS availableDevices,
      (SELECT COUNT(*) FROM devices) AS totalDevices,
      (SELECT COUNT(*) FROM orders) AS totalOrders,
      (SELECT COUNT(*) FROM users WHERE status = 'active'
         AND (account_type IS NULL OR account_type <> 'deleted_guest')) AS totalUsers,
      (SELECT COUNT(*) FROM orders WHERE date(startDate) = date('now')
         AND status IN ('approved', 'paid', 'pending_pickup')) AS todayPickups,
      (SELECT COUNT(*) FROM orders WHERE date(endDate) = date('now')
         AND status IN ('active', 'extended', 'overdue')) AS todayReturns,
      (SELECT COUNT(*) FROM orders WHERE status IN ('active', 'extended', 'overdue', 'pending_return')
         AND date(endDate) < date('now')) AS overdueRentals,
      (SELECT COUNT(*) FROM orders WHERE deposit_status = 'HELD' AND deleted_at IS NULL AND refund_ignored_at IS NULL) AS pendingDeposits,
      (SELECT COUNT(*) FROM devices WHERE lifecycle_status = 'RESERVED') AS reservedDevices,
      (SELECT COUNT(*) FROM devices WHERE lifecycle_status = 'MAINTENANCE') AS maintenanceDevices,
      (SELECT COUNT(*) FROM devices WHERE lifecycle_status = 'DAMAGED') AS damagedDevices,
      (SELECT COUNT(*) FROM devices d WHERE d.status = 'available'
         AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.deviceId = d.id AND o.status IN ('active', 'paid', 'approved', 'pending_payment', 'pending_pickup'))) AS idleDevices,
      (SELECT COALESCE(SUM(totalAmount), 0) FROM orders WHERE status IN ('pending_payment', 'approved', 'paid')) AS onTheWayRevenue,
      (SELECT COUNT(*) FROM orders WHERE status IN ('approved', 'paid') AND date(startDate) >= date('now')) AS awaitingPickup
  `

  const recentOrdersQuery = `
    SELECT o.id, o.orderNo, o.status, o.totalAmount,
           u.name AS customerName, d.name AS deviceName
    FROM orders o
    LEFT JOIN users u ON o.userId = u.id
    LEFT JOIN devices d ON o.deviceId = d.id
    ORDER BY o.createdAt DESC
    LIMIT 5
  `

  const recentDevicesQuery = `
    SELECT d.id, d.name, d.model, d.status, d.lifecycle_status AS lifecycleStatus,
           (SELECT u.name FROM orders o JOIN users u ON o.userId = u.id
            WHERE o.deviceId = d.id AND o.status IN ('active', 'paid')
            ORDER BY o.createdAt DESC LIMIT 1) AS customerName
    FROM devices d
    ORDER BY d.createdAt DESC
    LIMIT 5
  `

  const [statsRow, recentOrders, recentDevices] = await Promise.all([
    db.prepare(statsQuery).first(),
    db.prepare(recentOrdersQuery).all().then((r: any) => (r.results || []) as RecentOrderRow[]),
    db.prepare(recentDevicesQuery).all().then((r: any) => (r.results || []) as RecentDeviceRow[]),
  ])

  const s = (statsRow || {}) as any
  return {
    stats: {
      totalRevenue: Number(s.totalRevenue || 0),
      activeRentals: Number(s.activeRentals || 0),
      pendingOrders: Number(s.pendingOrders || 0),
      availableDevices: Number(s.availableDevices || 0),
      totalDevices: Number(s.totalDevices || 0),
      totalUsers: Number(s.totalUsers || 0),
      totalOrders: Number(s.totalOrders || 0),
      todayPickups: Number(s.todayPickups || 0),
      todayReturns: Number(s.todayReturns || 0),
      overdueRentals: Number(s.overdueRentals || 0),
      pendingDeposits: Number(s.pendingDeposits || 0),
      reservedDevices: Number(s.reservedDevices || 0),
      maintenanceDevices: Number(s.maintenanceDevices || 0),
      damagedDevices: Number(s.damagedDevices || 0),
      idleDevices: Number(s.idleDevices || 0),
      utilizationRate: Number(s.totalDevices || 0) > 0
        ? Math.round((1 - Number(s.idleDevices || 0) / Number(s.totalDevices)) * 100)
        : 0,
      onTheWayRevenue: Number(s.onTheWayRevenue || 0),
      awaitingPickup: Number(s.awaitingPickup || 0),
    },
    recentOrders: recentOrders.map((o: RecentOrderRow) => ({
      id: String(o.id),
      orderNo: o.orderNo ?? null,
      status: String(o.status || ''),
      totalAmount: Number(o.totalAmount || 0),
      customerName: o.customerName ?? null,
      deviceName: o.deviceName ?? null,
    })),
    recentDevices: recentDevices.map((d: RecentDeviceRow) => ({
      id: String(d.id),
      name: String(d.name || ''),
      model: d.model ?? null,
      status: String(d.status || ''),
      lifecycleStatus: d.lifecycleStatus ?? null,
      customerName: d.customerName ?? null,
    })),
  }
}
