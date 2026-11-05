-- Copyright (c) 2026 jiongjiong123441. All rights reserved.
-- Licensed under PolyForm Noncommercial 1.0.0.
-- Keep this notice and the LICENSE file with all copies and modified versions.

ALTER TABLE c2c_listings ADD COLUMN pickup_address_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(pickup_address_json));
