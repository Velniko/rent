-- Copyright (c) 2026 jiongjiong123441. All rights reserved.
-- Licensed under PolyForm Noncommercial 1.0.0.
-- Noncommercial use, modification, and distribution are permitted.
-- Keep this notice and the LICENSE file with all copies and modified versions.

UPDATE email_templates
SET body = body || '<h3>取货二维码</h3><p>到店后请向工作人员出示此二维码</p><p>{pickup_qr_code}</p>',
    updated_at = CURRENT_TIMESTAMP
WHERE id = 'pickup_reminder' AND deleted_at IS NULL
  AND instr(body, '{pickup_qr_code}') = 0;
