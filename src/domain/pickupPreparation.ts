/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

import type { Order } from '../db/types'
import { pickupTimeSettings } from './pickupTimeSlots'

export function pickupAppointmentAt(order: Pick<Order, 'startDate' | 'pickupTimeSlot'>, rules?: unknown): number | null {
  const settings = pickupTimeSettings(rules)
  const legacyStarts: Record<string, string> = {
    morning_service: settings.serviceFeeHours[0]?.start || '07:00', morning: settings.businessHours.start,
    afternoon: '13:00', evening_service: settings.serviceFeeHours[1]?.start || '21:00',
  }
  const slot = String(order.pickupTimeSlot || '').trim()
  const time = legacyStarts[slot] || slot
  if (!/^\d{4}-\d{2}-\d{2}$/.test(order.startDate) || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) return null
  const local = `${order.startDate}T${time}:00.000Z`
  const target = Date.parse(local)
  if (!Number.isFinite(target) || new Date(target).toISOString() !== local) return null
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Australia/Melbourne', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  })
  // Resolve the appointment's Melbourne wall time to an instant, including DST changes.
  let timestamp = target
  for (let i = 0; i < 3; i++) {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(timestamp)).map(part => [part.type, part.value]))
    const difference = target - Date.parse(`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:00Z`)
    if (!difference) return timestamp
    timestamp += difference
  }
  return null
}

export function canPreparePickup(order: Pick<Order, 'status' | 'deliveryMethod' | 'handover_completed_at' | 'paymentProvider' | 'payment_provider' | 'depositAmount' | 'deposit_status'>, contract?: { status?: string } | null): boolean {
  const squareDepositUnconfirmed = (order.paymentProvider || order.payment_provider) === 'square' && Number(order.depositAmount || 0) > 0 && order.deposit_status !== 'PAID'
  return !squareDepositUnconfirmed && order.deliveryMethod !== 'Delivery' && !order.handover_completed_at &&
    (['paid', 'pending_pickup'].includes(order.status) || (order.status === 'approved' && contract?.status === 'signed'))
}
