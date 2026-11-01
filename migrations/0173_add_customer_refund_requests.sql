-- Copyright (c) 2026 jiongjiong123441. All rights reserved.
-- Licensed under PolyForm Noncommercial 1.0.0.
-- Noncommercial use, modification, and distribution are permitted.
-- Keep this notice and the LICENSE file with all copies and modified versions.

CREATE TABLE customer_refund_requests (
  id TEXT PRIMARY KEY NOT NULL,
  order_id TEXT NOT NULL REFERENCES orders(id),
  customer_id TEXT NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'processing', 'approved', 'rejected')),
  order_total REAL NOT NULL,
  service_fee REAL NOT NULL,
  paid_amount REAL NOT NULL,
  fee_amount REAL NOT NULL,
  refund_amount REAL NOT NULL,
  quote_json TEXT NOT NULL,
  reason TEXT NOT NULL,
  refund_bsb TEXT,
  refund_account_number TEXT,
  refund_account_name TEXT,
  reviewed_by TEXT REFERENCES users(id),
  reviewed_at TEXT,
  review_note TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX idx_customer_refund_open ON customer_refund_requests(order_id) WHERE status <> 'rejected';
CREATE INDEX idx_customer_refund_status ON customer_refund_requests(status, created_at);

CREATE TABLE payment_refunds_new (
  id TEXT PRIMARY KEY NOT NULL,
  order_id TEXT NOT NULL,
  payment_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('deposit', 'cancellation', 'early_return')),
  refundable_amount REAL NOT NULL,
  refund_amount REAL NOT NULL,
  deduction_amount REAL NOT NULL DEFAULT 0,
  deduction_reason TEXT,
  stripe_refund_id TEXT,
  status TEXT NOT NULL CHECK(status IN ('pending', 'succeeded', 'failed')),
  processed_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  refund_method TEXT NOT NULL DEFAULT 'balance' CHECK(refund_method IN ('balance', 'stripe', 'bank_transfer', 'alipay', 'wechat')),
  refund_bsb TEXT,
  refund_account_number TEXT,
  refund_account_name TEXT,
  refunded_processing_fee REAL NOT NULL DEFAULT 0,
  refund_number TEXT,
  deduction_category TEXT,
  admin_notified_at TEXT,
  customer_request_id TEXT REFERENCES customer_refund_requests(id),
  FOREIGN KEY (processed_by) REFERENCES users(id)
);

INSERT INTO payment_refunds_new (
  id, order_id, payment_id, type, refundable_amount, refund_amount,
  deduction_amount, deduction_reason, stripe_refund_id, status, processed_by,
  created_at, refund_method, refund_bsb, refund_account_number,
  refund_account_name, refunded_processing_fee, refund_number, deduction_category, admin_notified_at
)
SELECT
  id, order_id, payment_id, type, refundable_amount, refund_amount,
  deduction_amount, deduction_reason, stripe_refund_id, status, processed_by,
  created_at, refund_method, refund_bsb, refund_account_number,
  refund_account_name, refunded_processing_fee, refund_number, deduction_category, admin_notified_at
FROM payment_refunds;

DROP TABLE payment_refunds;
ALTER TABLE payment_refunds_new RENAME TO payment_refunds;

CREATE UNIQUE INDEX idx_payment_refunds_cancellation_once
ON payment_refunds(order_id, type)
WHERE type = 'cancellation' AND status = 'succeeded' AND customer_request_id IS NULL;

CREATE UNIQUE INDEX idx_customer_refund_payment ON payment_refunds(customer_request_id, payment_id) WHERE customer_request_id IS NOT NULL;

CREATE UNIQUE INDEX idx_payment_refunds_early_return_once
ON payment_refunds(order_id, type)
WHERE type = 'early_return' AND status IN ('pending', 'succeeded');

CREATE UNIQUE INDEX idx_payment_refunds_refund_number ON payment_refunds(refund_number) WHERE refund_number IS NOT NULL;

CREATE INDEX idx_payment_refunds_deduction_category
  ON payment_refunds(deduction_category)
  WHERE deduction_category IS NOT NULL;

CREATE INDEX idx_payment_refunds_deposit_history
ON payment_refunds(order_id, payment_id, status, created_at);

CREATE INDEX idx_payment_refunds_pending_bank_transfer
ON payment_refunds(created_at)
WHERE status = 'pending' AND refund_method = 'bank_transfer' AND admin_notified_at IS NULL;

CREATE TRIGGER payment_refunds_to_allocations
AFTER INSERT ON payment_refunds WHEN NEW.status = 'succeeded' BEGIN
  INSERT OR IGNORE INTO refund_allocations (id, refund_id, payment_id, amount)
  VALUES ('ra-' || lower(hex(randomblob(16))), NEW.id, NEW.payment_id, NEW.refund_amount);
END;

CREATE TRIGGER deposit_refunds_cannot_exceed_paid_deposit
BEFORE INSERT ON payment_refunds
WHEN NEW.type = 'deposit' AND NEW.status = 'succeeded'
BEGIN
  SELECT RAISE(ABORT, 'deposit refund exceeds remaining refundable amount')
  WHERE NEW.refund_amount > (
    COALESCE((SELECT deposit_amount FROM payments WHERE id = NEW.payment_id), 0) -
    COALESCE((SELECT SUM(refund_amount) FROM payment_refunds
      WHERE payment_id = NEW.payment_id AND type = 'deposit' AND status = 'succeeded'), 0)
  );
END;

CREATE TRIGGER payment_refund_any_completion_to_allocations
AFTER UPDATE ON payment_refunds
WHEN NEW.status = 'succeeded' AND OLD.status <> 'succeeded' AND NEW.payment_id IS NOT NULL
BEGIN
  INSERT OR IGNORE INTO refund_allocations (id, refund_id, payment_id, amount)
  VALUES ('ra-' || lower(hex(randomblob(16))), NEW.id, NEW.payment_id, NEW.refund_amount);
END;

-- Keep fulfillment and financial snapshots stable while an application is reviewed.
CREATE TRIGGER customer_refund_prevents_handover
BEFORE UPDATE OF handover_completed_at, status ON orders
WHEN EXISTS (SELECT 1 FROM customer_refund_requests r WHERE r.order_id = OLD.id AND r.status IN ('pending', 'processing', 'approved'))
 AND ((OLD.handover_completed_at IS NULL AND NEW.handover_completed_at IS NOT NULL)
   OR NEW.status IN ('active', 'extended', 'overdue', 'suspended', 'pending_return', 'returned', 'completed'))
BEGIN
  SELECT RAISE(ABORT, '退款申请待处理，不能交付设备');
END;

CREATE TRIGGER customer_refund_snapshot_guard
BEFORE UPDATE OF status ON customer_refund_requests
WHEN OLD.status = 'pending' AND NEW.status = 'processing'
BEGIN
  SELECT RAISE(ABORT, '订单或付款已变化，请驳回后重新申请') WHERE NOT EXISTS (
    SELECT 1 FROM orders o WHERE o.id = NEW.order_id AND o.deleted_at IS NULL AND o.handover_completed_at IS NULL
      AND o.status IN ('draft', 'pending_approval', 'approved', 'awaiting_signature', 'pending_payment', 'paid', 'pending_pickup')
      AND o.totalAmount = NEW.order_total AND o.serviceFee = NEW.service_fee
      AND NOT EXISTS (SELECT 1 FROM payment_refunds f WHERE f.order_id = o.id AND f.status IN ('pending', 'succeeded'))
      AND (SELECT COUNT(*) FROM payments p WHERE p.rental_id = o.id AND (p.status = 'paid' OR (p.status = 'pending' AND p.stripe_payment_intent_id = o.stripe_deposit_payment_intent_id AND o.deposit_payment_mode = 'PREAUTH' AND o.deposit_status = 'HELD'))) = json_array_length(NEW.quote_json, '$.payments')
      AND NOT EXISTS (
        SELECT 1 FROM json_each(NEW.quote_json, '$.payments') j
        WHERE NOT EXISTS (SELECT 1 FROM payments p WHERE p.id = json_extract(j.value, '$.id') AND p.rental_id = o.id AND p.status = json_extract(j.value, '$.status')
          AND p.amount = json_extract(j.value, '$.amount') AND p.payment_method = json_extract(j.value, '$.method')
          AND p.processing_fee = json_extract(j.value, '$.processingFee')
          AND (CASE WHEN p.payment_provider = 'square' OR p.payment_method = 'balance' THEN 'balance' WHEN p.payment_method = 'card' THEN 'stripe' ELSE p.payment_method END) = json_extract(j.value, '$.channel')
          AND COALESCE(p.stripe_payment_intent_id, '') = json_extract(j.value, '$.intent'))
      )
  );
END;
