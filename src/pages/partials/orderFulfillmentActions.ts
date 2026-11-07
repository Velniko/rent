/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

import type { Order } from '../../db/types'

export function renderOrderPickupAction(order: Pick<Order, 'id' | 'is_manual'>, preInspectionDone = true): string {
  const id = encodeURIComponent(order.id)
  // 出租前验机没填完时，交付动作走不通（服务端会拦），降级成次要按钮，
  // 把唯一的强调色让给真正能点下去的「填写出租前验机」。
  const buttonClass = preInspectionDone ? 'button-primary' : 'button-secondary'
  return order.is_manual === 1
    ? `<a class="button ${buttonClass}" href="/staff/orders/${id}/handover">交付设备</a>`
    : `<a class="button ${buttonClass}" href="/staff/mobile?stage=pickup&order=${id}#scan">扫码取货</a>`
}

export function renderOrderReturnAction(order: Pick<Order, 'id' | 'is_manual' | 'return_received_at'>): string {
  const id = encodeURIComponent(order.id)
  if (order.return_received_at) return `<a class="button button-primary" data-workspace-modal href="/staff/orders/${id}/inspection?fragment=1">验机</a>`
  return order.is_manual === 1
    ? `<a class="button button-secondary" data-workspace-modal href="/staff/orders/${id}/receive-return?fragment=1">登记归还</a>`
    : `<a class="button button-secondary" href="/staff/mobile?stage=return&order=${id}#scan">扫码归还</a>`
}
