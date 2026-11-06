-- Copyright (c) 2026 jiongjiong123441. All rights reserved.
-- Licensed under PolyForm Noncommercial 1.0.0.
-- Noncommercial use, modification, and distribution are permitted.
-- Keep this notice and the LICENSE file with all copies and modified versions.

-- 官网广告的「查看详情」按钮可自定义链接与文字；留空则官网隐藏该按钮。
ALTER TABLE website_advertisements ADD COLUMN link_url TEXT;
ALTER TABLE website_advertisements ADD COLUMN link_text TEXT;
ALTER TABLE website_advertisements ADD COLUMN link_text_en TEXT;
