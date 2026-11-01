-- Copyright (c) 2026 jiongjiong123441. All rights reserved.
-- Licensed under PolyForm Noncommercial 1.0.0.
-- Noncommercial use, modification, and distribution are permitted.
-- Keep this notice and the LICENSE file with all copies and modified versions.

-- NULL 跟随全局；0 表示单独设置为不打折。保留已有非零设备折扣。
ALTER TABLE devices ADD COLUMN weekly_discount_override REAL CHECK (weekly_discount_override BETWEEN 0 AND 100);
ALTER TABLE devices ADD COLUMN monthly_discount_override REAL CHECK (monthly_discount_override BETWEEN 0 AND 100);
UPDATE devices SET weekly_discount_override = weekly_discount_percent WHERE weekly_discount_percent != 0;
UPDATE devices SET monthly_discount_override = monthly_discount_percent WHERE monthly_discount_percent != 0;
