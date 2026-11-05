-- Copyright (c) 2026 jiongjiong123441. All rights reserved.
-- Licensed under PolyForm Noncommercial 1.0.0.
-- Noncommercial use, modification, and distribution are permitted.
-- Keep this notice and the LICENSE file with all copies and modified versions.

-- 仅邮件的投递记录保留去重用途，不出现在站内通知中。
ALTER TABLE notifications ADD COLUMN in_app INTEGER NOT NULL DEFAULT 1;
