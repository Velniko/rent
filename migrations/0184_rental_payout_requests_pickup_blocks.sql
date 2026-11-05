-- Copyright (c) 2026 jiongjiong123441. All rights reserved.
-- Licensed under PolyForm Noncommercial 1.0.0.
-- Keep this notice and the LICENSE file with all copies and modified versions.

ALTER TABLE c2c_listings ADD COLUMN public_city TEXT NOT NULL DEFAULT '';
UPDATE c2c_listings SET public_city=CASE WHEN listing_mode='managed' THEN '墨尔本' ELSE COALESCE(json_extract(pickup_address_json,'$.city'),'') END;

CREATE TABLE c2c_payout_preferences (
  owner_id TEXT PRIMARY KEY REFERENCES users(id),
  cadence TEXT NOT NULL DEFAULT 'manual' CHECK(cadence IN ('manual','every_other_day','weekly')),
  weekday INTEGER CHECK(weekday BETWEEN 0 AND 6),
  next_run_date TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK((cadence='manual' AND next_run_date IS NULL) OR (cadence='every_other_day' AND next_run_date IS NOT NULL) OR (cadence='weekly' AND weekday IS NOT NULL AND next_run_date IS NOT NULL))
);
CREATE INDEX idx_c2c_payout_due ON c2c_payout_preferences(next_run_date) WHERE cadence<>'manual';

CREATE TABLE c2c_payout_requests (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL UNIQUE REFERENCES c2c_order_terms(order_id),
  owner_id TEXT NOT NULL REFERENCES users(id),
  origin TEXT NOT NULL CHECK(origin IN ('manual','every_other_day','weekly')),
  commission_bps INTEGER NOT NULL CHECK(commission_bps BETWEEN 0 AND 10000),
  rental_cents INTEGER NOT NULL CHECK(rental_cents>0),
  commission_cents INTEGER NOT NULL CHECK(commission_cents>=0),
  owner_cents INTEGER NOT NULL CHECK(owner_cents>0 AND owner_cents+commission_cents=rental_cents),
  account_name TEXT NOT NULL,
  bsb TEXT NOT NULL,
  account_number TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','paid')),
  requested_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  refreshed_at TEXT,
  notified_at TEXT,
  paid_at TEXT
);
CREATE INDEX idx_c2c_payout_pending ON c2c_payout_requests(status,requested_at);
CREATE INDEX idx_c2c_payout_owner ON c2c_payout_requests(owner_id,requested_at);

CREATE TRIGGER c2c_payout_request_valid BEFORE INSERT ON c2c_payout_requests
WHEN NEW.status<>'pending' OR NOT EXISTS (
  SELECT 1 FROM c2c_settlement_quotes q WHERE q.order_id=NEW.order_id AND q.owner_id=NEW.owner_id
  AND q.eligible=1 AND q.rental_cents=NEW.rental_cents AND q.owner_cents=NEW.owner_cents
  AND q.commission_cents=NEW.commission_cents AND q.commission_bps=NEW.commission_bps
  AND q.owner_name=NEW.account_name AND q.bsb=NEW.bsb AND q.account_number=NEW.account_number
  AND length(replace(q.bsb,'-',''))=6 AND replace(q.bsb,'-','') NOT GLOB '*[^0-9]*'
  AND length(q.account_number) BETWEEN 5 AND 20 AND q.account_number NOT GLOB '*[^0-9]*'
  AND NOT EXISTS(SELECT 1 FROM c2c_settlements s WHERE s.order_id=q.order_id)
)
BEGIN SELECT RAISE(ABORT,'C2C_PAYOUT_NOT_ELIGIBLE'); END;

CREATE TRIGGER c2c_payout_identity_immutable BEFORE UPDATE ON c2c_payout_requests
WHEN NEW.id IS NOT OLD.id OR NEW.order_id IS NOT OLD.order_id OR NEW.owner_id IS NOT OLD.owner_id
 OR NEW.requested_at IS NOT OLD.requested_at OR NEW.origin IS NOT OLD.origin
 OR (OLD.status='paid' AND (NEW.status<>'paid' OR NEW.commission_bps<>OLD.commission_bps
 OR NEW.rental_cents<>OLD.rental_cents OR NEW.commission_cents<>OLD.commission_cents OR NEW.owner_cents<>OLD.owner_cents
 OR NEW.account_name IS NOT OLD.account_name OR NEW.bsb IS NOT OLD.bsb OR NEW.account_number IS NOT OLD.account_number OR NEW.paid_at IS NOT OLD.paid_at))
BEGIN SELECT RAISE(ABORT,'C2C_PAYOUT_IMMUTABLE'); END;
CREATE TRIGGER c2c_payout_no_delete BEFORE DELETE ON c2c_payout_requests
BEGIN SELECT RAISE(ABORT,'C2C_PAYOUT_IMMUTABLE'); END;

CREATE TRIGGER c2c_payout_transfer_snapshot BEFORE INSERT ON c2c_settlements
WHEN EXISTS(SELECT 1 FROM c2c_payout_requests r WHERE r.order_id=NEW.order_id AND
 (r.status<>'pending' OR r.owner_id<>NEW.owner_id OR r.rental_cents<>NEW.rental_cents
 OR r.commission_cents<>NEW.commission_cents OR r.owner_cents<>NEW.owner_cents
 OR r.account_name IS NOT NEW.account_name OR r.bsb IS NOT NEW.bsb OR r.account_number IS NOT NEW.account_number))
BEGIN SELECT RAISE(ABORT,'C2C_PAYOUT_REFRESH_REQUIRED'); END;
CREATE TRIGGER c2c_payout_mark_paid AFTER INSERT ON c2c_settlements
BEGIN UPDATE c2c_payout_requests SET status='paid',paid_at=NEW.created_at WHERE order_id=NEW.order_id AND status='pending'; END;

CREATE TABLE c2c_pickup_blocks (
  id TEXT PRIMARY KEY,
  listing_id TEXT NOT NULL REFERENCES c2c_listings(id),
  blocked_date TEXT NOT NULL CHECK(blocked_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  start_time TEXT,
  end_time TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK((start_time IS NULL AND end_time IS NULL) OR (start_time IS NOT NULL AND end_time IS NOT NULL AND start_time<end_time AND start_time>='00:00' AND end_time<='24:00'))
);
CREATE INDEX idx_c2c_pickup_blocks ON c2c_pickup_blocks(listing_id,blocked_date);

-- Both the owner edit and order creation paths check the same appointment boundary.
CREATE TRIGGER c2c_pickup_block_existing_order BEFORE INSERT ON c2c_pickup_blocks
WHEN EXISTS(SELECT 1 FROM orders o JOIN c2c_listings l ON l.device_id=o.deviceId WHERE l.id=NEW.listing_id
 AND o.deleted_at IS NULL AND o.status NOT IN ('completed','cancelled') AND lower(COALESCE(o.deliveryMethod,'Pickup'))='pickup'
 AND ((substr(o.startDate,1,10)=NEW.blocked_date AND (NEW.start_time IS NULL OR o.pickupTimeSlot IS NULL OR o.pickupTimeSlot NOT GLOB '[0-9][0-9]:[0-9][0-9]' OR (NEW.start_time<=o.pickupTimeSlot AND o.pickupTimeSlot<NEW.end_time)))
 OR (substr(o.endDate,1,10)=NEW.blocked_date AND (NEW.start_time IS NULL OR o.returnTimeSlot IS NULL OR o.returnTimeSlot NOT GLOB '[0-9][0-9]:[0-9][0-9]' OR (NEW.start_time<=o.returnTimeSlot AND o.returnTimeSlot<NEW.end_time)))))
BEGIN SELECT RAISE(ABORT,'C2C_PICKUP_HAS_APPOINTMENT'); END;
CREATE TRIGGER c2c_pickup_block_new_order BEFORE INSERT ON orders
WHEN lower(COALESCE(NEW.deliveryMethod,'Pickup'))='pickup' AND EXISTS (
 SELECT 1 FROM c2c_pickup_blocks b JOIN c2c_listings l ON l.id=b.listing_id WHERE l.device_id=NEW.deviceId
 AND ((substr(NEW.startDate,1,10)=b.blocked_date AND (b.start_time IS NULL OR NEW.pickupTimeSlot IS NULL OR NEW.pickupTimeSlot NOT GLOB '[0-9][0-9]:[0-9][0-9]' OR (b.start_time<=NEW.pickupTimeSlot AND NEW.pickupTimeSlot<b.end_time)))
 OR (substr(NEW.endDate,1,10)=b.blocked_date AND (b.start_time IS NULL OR NEW.returnTimeSlot IS NULL OR NEW.returnTimeSlot NOT GLOB '[0-9][0-9]:[0-9][0-9]' OR (b.start_time<=NEW.returnTimeSlot AND NEW.returnTimeSlot<b.end_time)))))
BEGIN SELECT RAISE(ABORT,'C2C_PICKUP_UNAVAILABLE'); END;

CREATE TRIGGER c2c_payout_paid_requires_ledger BEFORE UPDATE OF status ON c2c_payout_requests
WHEN NEW.status='paid' AND NOT EXISTS(SELECT 1 FROM c2c_settlements s WHERE s.order_id=NEW.order_id)
BEGIN SELECT RAISE(ABORT,'C2C_PAYOUT_LEDGER_REQUIRED'); END;
CREATE TRIGGER c2c_payout_refresh_valid BEFORE UPDATE OF commission_bps,rental_cents,commission_cents,owner_cents,account_name,bsb,account_number ON c2c_payout_requests
WHEN NOT EXISTS(SELECT 1 FROM c2c_settlement_quotes q WHERE q.order_id=NEW.order_id AND q.owner_id=NEW.owner_id AND q.eligible=1
 AND q.commission_bps=NEW.commission_bps AND q.rental_cents=NEW.rental_cents AND q.commission_cents=NEW.commission_cents AND q.owner_cents=NEW.owner_cents
 AND q.owner_name=NEW.account_name AND q.bsb=NEW.bsb AND q.account_number=NEW.account_number)
BEGIN SELECT RAISE(ABORT,'C2C_PAYOUT_NOT_ELIGIBLE'); END;

CREATE TRIGGER c2c_pickup_block_changed_order BEFORE UPDATE OF startDate,endDate,pickupTimeSlot,returnTimeSlot,deliveryMethod ON orders
WHEN lower(COALESCE(NEW.deliveryMethod,'Pickup'))='pickup' AND EXISTS (
 SELECT 1 FROM c2c_pickup_blocks b JOIN c2c_listings l ON l.id=b.listing_id WHERE l.device_id=NEW.deviceId
 AND ((substr(NEW.startDate,1,10)=b.blocked_date AND (b.start_time IS NULL OR NEW.pickupTimeSlot IS NULL OR NEW.pickupTimeSlot NOT GLOB '[0-9][0-9]:[0-9][0-9]' OR (b.start_time<=NEW.pickupTimeSlot AND NEW.pickupTimeSlot<b.end_time)))
 OR (substr(NEW.endDate,1,10)=b.blocked_date AND (b.start_time IS NULL OR NEW.returnTimeSlot IS NULL OR NEW.returnTimeSlot NOT GLOB '[0-9][0-9]:[0-9][0-9]' OR (b.start_time<=NEW.returnTimeSlot AND NEW.returnTimeSlot<b.end_time)))))
BEGIN SELECT RAISE(ABORT,'C2C_PICKUP_UNAVAILABLE'); END;
