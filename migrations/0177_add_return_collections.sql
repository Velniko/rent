-- Copyright (c) 2026 jiongjiong123441. All rights reserved.
-- Licensed under PolyForm Noncommercial 1.0.0.
-- Noncommercial use, modification, and distribution are permitted.
-- Keep this notice and the LICENSE file with all copies and modified versions.

PRAGMA defer_foreign_keys = ON;

DROP TRIGGER refund_allocations_cannot_exceed_payment;
DROP TRIGGER deposit_refunds_cannot_exceed_paid_deposit;
DROP TRIGGER customer_refund_snapshot_guard;

CREATE TABLE payments_return_new (
  id TEXT PRIMARY KEY NOT NULL,
  rental_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  payment_method TEXT NOT NULL CHECK(payment_method IN ('card', 'bank_transfer', 'balance', 'alipay', 'wechat', 'cash')),
  amount REAL NOT NULL,
  deposit_amount REAL NOT NULL,
  rental_amount REAL NOT NULL,
  currency TEXT NOT NULL DEFAULT 'AUD',
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'paid', 'failed', 'refunded')),
  transaction_id TEXT,
  paid_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  stripe_checkout_session_id TEXT,
  stripe_payment_intent_id TEXT,
  processing_fee REAL NOT NULL DEFAULT 0,
  payment_provider TEXT,
  square_payment_id TEXT,
  square_paid_amount REAL NOT NULL DEFAULT 0
);
INSERT INTO payments_return_new SELECT * FROM payments;
DROP TABLE payments;
ALTER TABLE payments_return_new RENAME TO payments;

CREATE INDEX idx_payments_customer_status ON payments(customer_id, status);

CREATE INDEX idx_payments_provider
  ON payments(payment_provider, rental_id, status);

CREATE UNIQUE INDEX idx_payments_square_payment_id
  ON payments(square_payment_id)
  WHERE square_payment_id IS NOT NULL;

CREATE UNIQUE INDEX idx_payments_stripe_checkout_session
ON payments(stripe_checkout_session_id)
WHERE stripe_checkout_session_id IS NOT NULL;

CREATE UNIQUE INDEX idx_payments_stripe_payment_intent
ON payments(stripe_payment_intent_id)
WHERE stripe_payment_intent_id IS NOT NULL;

CREATE TRIGGER payments_to_allocations
AFTER INSERT ON payments BEGIN
  INSERT INTO payment_allocations (id, payment_id, order_id, allocation_type, amount)
  SELECT 'pa-' || lower(hex(randomblob(16))), NEW.id, NEW.rental_id, 'RENTAL', NEW.rental_amount
  WHERE NEW.rental_amount <> 0;
  INSERT INTO payment_allocations (id, payment_id, order_id, allocation_type, amount)
  SELECT 'pa-' || lower(hex(randomblob(16))), NEW.id, NEW.rental_id, 'DEPOSIT', NEW.deposit_amount
  WHERE NEW.deposit_amount <> 0;
END;

CREATE TRIGGER update_payments_updated_at
AFTER UPDATE ON payments
FOR EACH ROW
BEGIN
  UPDATE payments SET updated_at = CURRENT_TIMESTAMP WHERE id = OLD.id;
END;

CREATE TRIGGER refund_allocations_cannot_exceed_payment
BEFORE INSERT ON refund_allocations BEGIN
  SELECT RAISE(ABORT, 'refund allocation exceeds paid amount')
  WHERE NEW.amount > (
    COALESCE((SELECT amount FROM payments WHERE id = NEW.payment_id), 0) -
    COALESCE((SELECT SUM(amount) FROM refund_allocations WHERE payment_id = NEW.payment_id), 0)
  );
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

PRAGMA defer_foreign_keys = OFF;

ALTER TABLE orders ADD COLUMN overdue_collected_amount REAL NOT NULL DEFAULT 0;

CREATE TABLE return_collections (
  id TEXT PRIMARY KEY NOT NULL,
  order_id TEXT NOT NULL REFERENCES orders(id),
  customer_id TEXT NOT NULL REFERENCES users(id),
  amount REAL NOT NULL CHECK(amount > 0),
  processing_fee REAL NOT NULL DEFAULT 0,
  payment_method TEXT NOT NULL CHECK(payment_method IN ('cash','bank_transfer','balance','alipay','wechat','card')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','paid','cancelled')),
  payment_id TEXT NOT NULL UNIQUE REFERENCES payments(id),
  stripe_customer_id TEXT,
  stripe_payment_intent_id TEXT UNIQUE,
  reference TEXT NOT NULL UNIQUE,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  paid_at TEXT
);
CREATE UNIQUE INDEX idx_return_collection_pending ON return_collections(order_id) WHERE status = 'pending';
CREATE INDEX idx_return_collection_order ON return_collections(order_id, created_at);

CREATE TABLE stripe_pos_receipts (
  intent_id TEXT PRIMARY KEY NOT NULL,
  charge_id TEXT UNIQUE,
  event_id TEXT NOT NULL UNIQUE,
  customer_id TEXT,
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);

CREATE TRIGGER return_collection_payment_guard
BEFORE UPDATE OF status ON return_collections
WHEN OLD.status = 'pending' AND NEW.status = 'paid'
BEGIN
  SELECT RAISE(ABORT, '归还应收金额已变化，请刷新页面') WHERE NOT EXISTS (
    SELECT 1 FROM orders WHERE id = NEW.order_id AND userId = NEW.customer_id
      AND deleted_at IS NULL AND status IN ('active','extended','overdue','suspended','pending_return','completed') AND overdue_outstanding_amount + 0.005 >= NEW.amount
  );
  SELECT RAISE(ABORT, '客户账户余额不足') WHERE NEW.payment_method = 'balance'
    AND NOT EXISTS (SELECT 1 FROM users WHERE id = NEW.customer_id AND balance + 0.005 >= NEW.amount);
END;

CREATE TRIGGER return_collection_paid
AFTER UPDATE OF status ON return_collections
WHEN OLD.status = 'pending' AND NEW.status = 'paid'
BEGIN
  UPDATE orders SET overdue_collected_amount = overdue_collected_amount + NEW.amount,
    overdue_outstanding_amount = MAX(0, overdue_outstanding_amount - NEW.amount),
    settlement_status = CASE WHEN status = 'completed' THEN CASE WHEN overdue_outstanding_amount - NEW.amount > 0.005 OR deposit_status IN ('PENDING','HELD','REFUND_PENDING') THEN 'PENDING' ELSE 'SETTLED' END ELSE settlement_status END, updatedAt = CURRENT_TIMESTAMP WHERE id = NEW.order_id;
  UPDATE users SET balance = balance - NEW.amount WHERE id = NEW.customer_id AND NEW.payment_method = 'balance';
  UPDATE payments SET status = 'paid', transaction_id = COALESCE(transaction_id, NEW.reference),
    stripe_payment_intent_id = NEW.stripe_payment_intent_id, paid_at = CURRENT_TIMESTAMP WHERE id = NEW.payment_id;
END;

CREATE TRIGGER return_collection_insert_guard
BEFORE INSERT ON return_collections
BEGIN
  SELECT RAISE(ABORT, '归还应收金额已变化，请刷新页面') WHERE NOT EXISTS (
    SELECT 1 FROM orders WHERE id = NEW.order_id AND userId = NEW.customer_id AND deleted_at IS NULL
      AND status IN ('active','extended','overdue','suspended','pending_return','completed') AND ABS(overdue_outstanding_amount - NEW.amount) < 0.005
  );
END;
