-- Copyright (c) 2026 jiongjiong123441. All rights reserved.
-- Licensed under PolyForm Noncommercial 1.0.0.
-- Keep this notice and the LICENSE file with all copies and modified versions.

CREATE TABLE c2c_memberships (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  joined_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE c2c_photos (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id),
  slot TEXT NOT NULL CHECK(slot IN ('a','b','c','d','power','extra')),
  url TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_c2c_photos_owner ON c2c_photos(owner_id, created_at);
ALTER TABLE c2c_listings ADD COLUMN photos_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(photos_json));

CREATE TRIGGER c2c_require_review_photos BEFORE UPDATE OF status ON c2c_listings
WHEN NEW.status='approved'
BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM c2c_memberships WHERE user_id=NEW.owner_id)
    OR COALESCE(json_extract(NEW.photos_json,'$.a.url'),'') NOT LIKE 'https://%'
    OR COALESCE(json_extract(NEW.photos_json,'$.b.url'),'') NOT LIKE 'https://%'
    OR COALESCE(json_extract(NEW.photos_json,'$.c.url'),'') NOT LIKE 'https://%'
    OR COALESCE(json_extract(NEW.photos_json,'$.d.url'),'') NOT LIKE 'https://%'
    OR COALESCE(json_extract(NEW.photos_json,'$.power.url'),'') NOT LIKE 'https://%'
  THEN RAISE(ABORT,'C2C_MEMBERSHIP_PHOTOS_REQUIRED') END;
END;

DROP TRIGGER c2c_validate_order;
CREATE TRIGGER c2c_validate_order BEFORE INSERT ON orders
WHEN EXISTS (SELECT 1 FROM c2c_listings WHERE device_id=NEW.deviceId)
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM c2c_listings l JOIN users u ON u.id=l.owner_id JOIN c2c_memberships m ON m.user_id=l.owner_id
    WHERE l.device_id=NEW.deviceId AND l.status='approved' AND l.owner_id<>NEW.userId AND u.status='active' AND u.deleted_at IS NULL
      AND json_extract(l.photos_json,'$.a.url') LIKE 'https://%'
      AND json_extract(l.photos_json,'$.b.url') LIKE 'https://%'
      AND json_extract(l.photos_json,'$.c.url') LIKE 'https://%'
      AND json_extract(l.photos_json,'$.d.url') LIKE 'https://%'
      AND json_extract(l.photos_json,'$.power.url') LIKE 'https://%'
  ) THEN RAISE(ABORT,'C2C_DEVICE_UNAVAILABLE') END;
END;
