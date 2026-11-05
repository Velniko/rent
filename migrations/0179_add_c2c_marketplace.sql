-- Copyright (c) 2026 jiongjiong123441. All rights reserved.
-- Licensed under PolyForm Noncommercial 1.0.0.
-- Keep this notice and the LICENSE file with all copies and modified versions.

CREATE TABLE c2c_settings (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  commission_bps INTEGER NOT NULL DEFAULT 1000 CHECK(commission_bps BETWEEN 0 AND 10000)
);
INSERT INTO c2c_settings (id) VALUES (1);

CREATE TABLE c2c_listings (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id),
  device_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL, model TEXT NOT NULL, serial_number TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  daily_rate REAL NOT NULL CHECK(daily_rate > 0 AND daily_rate <= 100000),
  deposit REAL NOT NULL CHECK(deposit >= 0 AND deposit <= 1000000),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','paused')),
  review_note TEXT NOT NULL DEFAULT '', reviewed_by TEXT REFERENCES users(id), reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_c2c_owner ON c2c_listings(owner_id, created_at);
CREATE INDEX idx_c2c_review ON c2c_listings(status, created_at);

CREATE TABLE c2c_order_terms (
  order_id TEXT PRIMARY KEY REFERENCES orders(id),
  listing_id TEXT NOT NULL REFERENCES c2c_listings(id),
  owner_id TEXT NOT NULL REFERENCES users(id),
  commission_bps INTEGER NOT NULL CHECK(commission_bps BETWEEN 0 AND 10000),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_c2c_terms_owner ON c2c_order_terms(owner_id, created_at);

-- Every order creation path takes the same ownership and commission snapshot.
CREATE TRIGGER c2c_validate_order BEFORE INSERT ON orders
WHEN EXISTS (SELECT 1 FROM c2c_listings WHERE device_id = NEW.deviceId)
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM c2c_listings l JOIN users u ON u.id = l.owner_id
    WHERE l.device_id = NEW.deviceId AND l.status = 'approved' AND l.owner_id <> NEW.userId
      AND u.status = 'active' AND u.deleted_at IS NULL
  ) THEN RAISE(ABORT, 'C2C_DEVICE_UNAVAILABLE') END;
END;
CREATE TRIGGER c2c_snapshot_order AFTER INSERT ON orders
BEGIN
  INSERT INTO c2c_order_terms (order_id, listing_id, owner_id, commission_bps)
  SELECT NEW.id, l.id, l.owner_id, s.commission_bps FROM c2c_listings l CROSS JOIN c2c_settings s
  WHERE l.device_id = NEW.deviceId AND s.id = 1;
END;
-- Changing devices across owners would invalidate the original payout terms.
CREATE TRIGGER c2c_no_device_swap BEFORE UPDATE OF deviceId, userId ON orders
WHEN (NEW.deviceId IS NOT OLD.deviceId AND (
  EXISTS(SELECT 1 FROM c2c_order_terms WHERE order_id = OLD.id) OR
  EXISTS(SELECT 1 FROM c2c_listings WHERE device_id = NEW.deviceId))) OR
  EXISTS(SELECT 1 FROM c2c_order_terms WHERE order_id = OLD.id AND owner_id = NEW.userId)
BEGIN SELECT RAISE(ABORT, 'C2C_ORDER_OWNERSHIP_LOCKED'); END;
CREATE TRIGGER c2c_terms_no_update BEFORE UPDATE ON c2c_order_terms
BEGIN SELECT RAISE(ABORT, 'C2C_TERMS_IMMUTABLE'); END;
CREATE TRIGGER c2c_terms_no_delete BEFORE DELETE ON c2c_order_terms
BEGIN SELECT RAISE(ABORT, 'C2C_TERMS_IMMUTABLE'); END;

CREATE TABLE c2c_settlements (
  order_id TEXT PRIMARY KEY REFERENCES c2c_order_terms(order_id),
  owner_id TEXT NOT NULL REFERENCES users(id),
  rental_cents INTEGER NOT NULL CHECK(rental_cents > 0),
  commission_cents INTEGER NOT NULL CHECK(commission_cents >= 0),
  owner_cents INTEGER NOT NULL CHECK(owner_cents >= 0 AND owner_cents + commission_cents = rental_cents),
  transfer_reference TEXT NOT NULL,
  account_name TEXT NOT NULL, bsb TEXT NOT NULL, account_number TEXT NOT NULL,
  processed_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TRIGGER c2c_settlements_no_update BEFORE UPDATE ON c2c_settlements
BEGIN SELECT RAISE(ABORT, 'C2C_SETTLEMENT_IMMUTABLE'); END;
CREATE TRIGGER c2c_settlements_no_delete BEFORE DELETE ON c2c_settlements
BEGIN SELECT RAISE(ABORT, 'C2C_SETTLEMENT_IMMUTABLE'); END;

-- rental_amount excludes deposits and card processing fees. Delivery, service
-- charges and overdue charges stay with the platform. Refunds reduce rent.
CREATE VIEW c2c_settlement_quotes AS
WITH amounts AS (
 SELECT t.*, o.orderNo, o.status AS order_status, o.deleted_at, o.return_received_at,
   o.deposit_status, o.overdue_outstanding_amount, o.settlement_status,
   u.name AS owner_name, u.bsb, u.account_number,
   MAX(0, ROUND((MIN(
     o.totalAmount - o.depositAmount - COALESCE(o.deliveryFee,0) - COALESCE(o.serviceFee,0) - COALESCE(o.overdue_charge_total,0)
       - COALESCE((SELECT SUM(refund_amount) FROM payment_refunds WHERE order_id=o.id AND type='early_return' AND status='succeeded'),0),
     COALESCE((SELECT SUM(rental_amount) FROM payments WHERE rental_id=o.id AND status IN ('paid','refunded') AND currency='AUD'),0)
       - COALESCE((SELECT SUM(refund_amount) FROM payment_refunds WHERE order_id=o.id AND type<>'deposit' AND status='succeeded'),0)
       - COALESCE((SELECT SUM(amount) FROM order_price_adjustments WHERE order_id=o.id AND direction='decrease' AND status='succeeded'),0)
       - COALESCE(o.deliveryFee,0) - COALESCE(o.serviceFee,0) - COALESCE(o.overdue_charge_total,0)
   )) * 100)) AS rental_cents,
   CASE WHEN o.status='completed' AND o.deleted_at IS NULL AND o.return_received_at IS NOT NULL
     AND o.settlement_status='SETTLED' AND COALESCE(o.overdue_outstanding_amount,0)=0
     AND o.deposit_status IN ('NOT_REQUIRED','REFUNDED','FORFEITED','PARTIALLY_DEDUCTED')
     AND NOT EXISTS(SELECT 1 FROM payment_refunds WHERE order_id=o.id AND status<>'succeeded')
     AND NOT EXISTS(SELECT 1 FROM order_price_adjustments WHERE order_id=o.id AND (status IN ('pending','processing') OR (refund_method='pending_deposit' AND deposit_refunded=0)))
     AND NOT EXISTS(SELECT 1 FROM customer_refund_requests WHERE order_id=o.id AND status IN ('pending','processing','approved'))
     AND NOT EXISTS(SELECT 1 FROM payment_disputes WHERE order_id=o.id AND status NOT IN ('DISPUTE_WON','DISPUTE_CLOSED'))
     AND NOT EXISTS(SELECT 1 FROM rental_installments WHERE order_id=o.id AND status NOT IN ('paid','cancelled'))
     THEN 1 ELSE 0 END AS eligible
 FROM c2c_order_terms t JOIN orders o ON o.id=t.order_id JOIN users u ON u.id=t.owner_id
)
SELECT *, CAST(ROUND(rental_cents * commission_bps / 10000.0) AS INTEGER) AS commission_cents,
 rental_cents - CAST(ROUND(rental_cents * commission_bps / 10000.0) AS INTEGER) AS owner_cents
FROM amounts;
