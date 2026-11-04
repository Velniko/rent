-- Keep transfer references stable across reloads, resubmissions and payment-method changes.
-- Codes are unique across rental orders and balance top-ups, including historical records.
CREATE TABLE bank_transfer_references (
  scope TEXT NOT NULL CHECK(scope IN ('order', 'topup')),
  source_id TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE CHECK(length(code) = 5 AND code NOT GLOB '*[^A-Z0-9]*'),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (scope, source_id)
);

CREATE INDEX idx_payments_bank_transfer_created ON payments(created_at DESC, id DESC)
  WHERE payment_method = 'bank_transfer';
CREATE INDEX idx_balance_topups_bank_transfer_created ON balance_topups(created_at DESC, id DESC)
  WHERE payment_method = 'bank_transfer';
