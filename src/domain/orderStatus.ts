/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

const ORDER_TRANSITIONS: Record<string, string[]> = {
  pending_approval: ['approved', 'awaiting_signature', 'cancelled'],
  approved: ['pending_payment', 'paid', 'pending_pickup', 'active', 'cancelled'],
  draft: ['pending_payment', 'cancelled'],
  pending_payment: ['paid', 'cancelled'],
  paid: ['pending_pickup', 'active', 'cancelled'],
  pending_pickup: ['active', 'pending_return', 'cancelled'],
  awaiting_signature: ['paid', 'pending_payment', 'cancelled'],
  active: ['extended', 'overdue', 'suspended', 'pending_return', 'completed', 'cancelled', 'pending_pickup'],
  extended: ['active', 'overdue', 'suspended', 'pending_return', 'completed', 'cancelled'],
  overdue: ['active', 'suspended', 'pending_return', 'completed', 'cancelled'],
  suspended: ['active', 'pending_return', 'cancelled'],
  pending_return: ['returned', 'completed'],
  returned: ['completed'],
  completed: [], cancelled: [],
}

export function canTransitionOrder(from: string, to: string): boolean {
  return from === to || Boolean(ORDER_TRANSITIONS[from]?.includes(to))
}
