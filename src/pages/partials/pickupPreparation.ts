/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

import type { Order } from '../../db/types'
import { canPreparePickup } from '../../domain/pickupPreparation'

export function renderPickupPreparation(order: Order, contract?: { status?: string } | null, feedback = ''): string {
  if (!canPreparePickup(order, contract)) return ''
  const notice = feedback === 'sent' ? '取货邮件已发送' : feedback === 'failed' ? '设备已准备完成，取货邮件发送失败，请重试' : feedback === 'busy' ? '邮件正在发送，请稍后重试' : ''
  // 「待准备/准备完成」已经并进订单状态徽章（见 pickupAwareOrderStatusBadge），
  // 这里只保留真正要做的动作，避免页面上出现两个意思重叠的徽章。
  return `<div class="pickup-preparation">${notice ? `<p data-flash-notice class="page-notification page-notification--${feedback === 'sent' ? 'success' : 'error'}">${notice}</p>` : ''}${order.pickup_ready_email_sent_at ? '<span class="badge badge-info">取货邮件已发送</span>' : `<form method="post" action="/staff/orders/${encodeURIComponent(order.id)}/prepare-pickup"><button class="button button-primary" type="submit">${order.pickup_ready_at ? '重发取货邮件' : '准备完成并通知客户'}</button></form>`}</div>`
}
