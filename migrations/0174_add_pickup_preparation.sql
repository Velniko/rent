-- Copyright (c) 2026 jiongjiong123441. All rights reserved.
-- Licensed under PolyForm Noncommercial 1.0.0.
-- Noncommercial use, modification, and distribution are permitted.
-- Keep this notice and the LICENSE file with all copies and modified versions.

-- Record preparation per rental, rather than marking every future booking of a device ready.
ALTER TABLE orders ADD COLUMN pickup_ready_at TEXT;
ALTER TABLE orders ADD COLUMN pickup_ready_by TEXT;
ALTER TABLE orders ADD COLUMN pickup_ready_email_sent_at TEXT;
ALTER TABLE orders ADD COLUMN pickup_ready_email_attempt_at TEXT;

CREATE TRIGGER reset_pickup_preparation_after_reassignment
AFTER UPDATE OF deviceId, userId, deliveryMethod ON orders
WHEN OLD.deviceId IS NOT NEW.deviceId OR OLD.userId IS NOT NEW.userId OR OLD.deliveryMethod IS NOT NEW.deliveryMethod
BEGIN
  UPDATE orders SET pickup_ready_at = NULL, pickup_ready_by = NULL,
    pickup_ready_email_sent_at = NULL, pickup_ready_email_attempt_at = NULL WHERE id = NEW.id;
END;
