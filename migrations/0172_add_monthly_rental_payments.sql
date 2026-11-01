-- 新订单的定价快照及信用卡月付计划；历史已付款订单不生成补扣计划。
ALTER TABLE orders ADD COLUMN rental_pricing_json TEXT;
ALTER TABLE orders ADD COLUMN billing_mode TEXT NOT NULL DEFAULT 'FULL' CHECK (billing_mode IN ('FULL', 'MONTHLY'));

CREATE TABLE rental_installments (
  id TEXT PRIMARY KEY NOT NULL,
  order_id TEXT NOT NULL REFERENCES orders(id),
  installment_number INTEGER NOT NULL,
  due_date TEXT NOT NULL,
  period_end TEXT NOT NULL,
  rental_amount REAL NOT NULL CHECK (rental_amount >= 0),
  deposit_amount REAL NOT NULL DEFAULT 0 CHECK (deposit_amount >= 0),
  processing_fee REAL NOT NULL CHECK (processing_fee >= 0),
  amount REAL NOT NULL CHECK (amount >= 0),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'paid', 'failed', 'cancelled')),
  payment_id TEXT UNIQUE REFERENCES payments(id),
  stripe_payment_intent_id TEXT UNIQUE,
  last_error TEXT,
  attempted_at TEXT,
  paid_at TEXT,
  UNIQUE (order_id, installment_number)
);
CREATE INDEX idx_rental_installments_due ON rental_installments(status, due_date);

CREATE TRIGGER cancel_monthly_installments_after_rental
AFTER UPDATE OF status ON orders
WHEN NEW.billing_mode = 'MONTHLY' AND NEW.status IN ('completed', 'cancelled', 'returned')
BEGIN
  UPDATE rental_installments SET status = 'cancelled'
  WHERE order_id = NEW.id AND status IN ('pending', 'failed');
END;
