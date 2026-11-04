-- Copyright (c) 2026 jiongjiong123441. All rights reserved.
-- Licensed under PolyForm Noncommercial 1.0.0.
-- Keep this notice and the LICENSE file with all copies and modified versions.

ALTER TABLE c2c_settings ADD COLUMN shipping_address_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(shipping_address_json));
ALTER TABLE c2c_memberships ADD COLUMN mode_changed_at TEXT;

CREATE TRIGGER c2c_mode_interval_guard BEFORE UPDATE OF mode ON c2c_memberships
WHEN NEW.mode<>OLD.mode AND julianday('now')<=julianday(COALESCE(OLD.mode_changed_at,OLD.joined_at),'+3 months')
BEGIN SELECT RAISE(ABORT,'C2C_MODE_CHANGE_COOLDOWN'); END;

CREATE TRIGGER c2c_mode_changed_at AFTER UPDATE OF mode ON c2c_memberships
WHEN NEW.mode<>OLD.mode
BEGIN UPDATE c2c_memberships SET mode_changed_at=CURRENT_TIMESTAMP WHERE user_id=NEW.user_id; END;
