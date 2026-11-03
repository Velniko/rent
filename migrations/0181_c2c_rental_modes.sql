-- Copyright (c) 2026 jiongjiong123441. All rights reserved.
-- Licensed under PolyForm Noncommercial 1.0.0.
-- Keep this notice and the LICENSE file with all copies and modified versions.

ALTER TABLE c2c_settings ADD COLUMN managed_commission_bps INTEGER CHECK(managed_commission_bps BETWEEN 0 AND 10000);
ALTER TABLE c2c_settings ADD COLUMN shipping_address TEXT NOT NULL DEFAULT '';
ALTER TABLE c2c_memberships ADD COLUMN mode TEXT NOT NULL DEFAULT 'self' CHECK(mode IN ('self','managed'));
ALTER TABLE c2c_listings ADD COLUMN listing_mode TEXT NOT NULL DEFAULT 'self' CHECK(listing_mode IN ('self','managed'));
ALTER TABLE c2c_listings ADD COLUMN pickup_address TEXT NOT NULL DEFAULT '';
ALTER TABLE c2c_listings ADD COLUMN listed_at TEXT;
ALTER TABLE c2c_listings ADD COLUMN custody_received_at TEXT;
ALTER TABLE c2c_order_terms ADD COLUMN listing_mode TEXT NOT NULL DEFAULT 'self' CHECK(listing_mode IN ('self','managed'));
ALTER TABLE c2c_order_terms ADD COLUMN pickup_address TEXT NOT NULL DEFAULT '';
CREATE TRIGGER c2c_mode_change_guard BEFORE UPDATE OF mode ON c2c_memberships
WHEN NEW.mode<>OLD.mode AND (
  EXISTS(SELECT 1 FROM c2c_listings WHERE owner_id=OLD.user_id AND status IN ('pending','approved')) OR
  EXISTS(SELECT 1 FROM c2c_order_terms t JOIN orders o ON o.id=t.order_id WHERE t.owner_id=OLD.user_id AND o.deleted_at IS NULL AND o.status NOT IN ('completed','cancelled'))
)
BEGIN SELECT RAISE(ABORT,'C2C_UNLIST_ALL_BEFORE_MODE_CHANGE'); END;

-- A listing must complete a fresh six-month term each time it is relisted.
CREATE TRIGGER c2c_managed_pause_guard BEFORE UPDATE OF status ON c2c_listings
WHEN NEW.status='paused' AND OLD.status<>'paused' AND OLD.listing_mode='managed' AND OLD.listed_at IS NOT NULL
 AND julianday('now')<=julianday(OLD.listed_at,'+6 months')
BEGIN SELECT RAISE(ABORT,'C2C_MANAGED_SIX_MONTHS_REQUIRED'); END;

DROP TRIGGER c2c_require_review_photos;
CREATE TRIGGER c2c_require_review_photos BEFORE UPDATE OF status ON c2c_listings
WHEN NEW.status='approved'
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM c2c_memberships m CROSS JOIN c2c_settings s WHERE m.user_id=NEW.owner_id AND m.mode=NEW.listing_mode
      AND length(trim(NEW.pickup_address))>0 AND (NEW.listing_mode='self' OR (s.managed_commission_bps IS NOT NULL AND NEW.custody_received_at IS NOT NULL))
  ) OR NOT (EXISTS (SELECT 1 FROM c2c_photos p WHERE p.id=json_extract(NEW.photos_json,'$.a.id') AND p.owner_id=NEW.owner_id AND p.slot='a' AND p.url LIKE 'https://%' AND p.url=json_extract(NEW.photos_json,'$.a.url')) AND
      EXISTS (SELECT 1 FROM c2c_photos p WHERE p.id=json_extract(NEW.photos_json,'$.b.id') AND p.owner_id=NEW.owner_id AND p.slot='b' AND p.url LIKE 'https://%' AND p.url=json_extract(NEW.photos_json,'$.b.url')) AND
      EXISTS (SELECT 1 FROM c2c_photos p WHERE p.id=json_extract(NEW.photos_json,'$.c.id') AND p.owner_id=NEW.owner_id AND p.slot='c' AND p.url LIKE 'https://%' AND p.url=json_extract(NEW.photos_json,'$.c.url')) AND
      EXISTS (SELECT 1 FROM c2c_photos p WHERE p.id=json_extract(NEW.photos_json,'$.d.id') AND p.owner_id=NEW.owner_id AND p.slot='d' AND p.url LIKE 'https://%' AND p.url=json_extract(NEW.photos_json,'$.d.url')) AND
      EXISTS (SELECT 1 FROM c2c_photos p WHERE p.id=json_extract(NEW.photos_json,'$.power.id') AND p.owner_id=NEW.owner_id AND p.slot='power' AND p.url LIKE 'https://%' AND p.url=json_extract(NEW.photos_json,'$.power.url'))) THEN RAISE(ABORT,'C2C_MEMBERSHIP_PHOTOS_REQUIRED') END;
END;

DROP TRIGGER c2c_validate_order;
CREATE TRIGGER c2c_validate_order BEFORE INSERT ON orders
WHEN EXISTS (SELECT 1 FROM c2c_listings WHERE device_id=NEW.deviceId)
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM c2c_listings l JOIN users u ON u.id=l.owner_id JOIN c2c_memberships m ON m.user_id=l.owner_id CROSS JOIN c2c_settings s
    WHERE l.device_id=NEW.deviceId AND l.status='approved' AND l.owner_id<>NEW.userId AND u.status='active' AND u.deleted_at IS NULL
      AND l.listing_mode=m.mode AND length(trim(l.pickup_address))>0
      AND (l.listing_mode='self' OR (s.managed_commission_bps IS NOT NULL AND l.custody_received_at IS NOT NULL))
      AND (l.listing_mode<>'self' OR lower(COALESCE(NEW.deliveryMethod,'Pickup'))='pickup')
      AND EXISTS (SELECT 1 FROM c2c_photos p WHERE p.id=json_extract(l.photos_json,'$.a.id') AND p.owner_id=l.owner_id AND p.slot='a' AND p.url LIKE 'https://%' AND p.url=json_extract(l.photos_json,'$.a.url')) AND
      EXISTS (SELECT 1 FROM c2c_photos p WHERE p.id=json_extract(l.photos_json,'$.b.id') AND p.owner_id=l.owner_id AND p.slot='b' AND p.url LIKE 'https://%' AND p.url=json_extract(l.photos_json,'$.b.url')) AND
      EXISTS (SELECT 1 FROM c2c_photos p WHERE p.id=json_extract(l.photos_json,'$.c.id') AND p.owner_id=l.owner_id AND p.slot='c' AND p.url LIKE 'https://%' AND p.url=json_extract(l.photos_json,'$.c.url')) AND
      EXISTS (SELECT 1 FROM c2c_photos p WHERE p.id=json_extract(l.photos_json,'$.d.id') AND p.owner_id=l.owner_id AND p.slot='d' AND p.url LIKE 'https://%' AND p.url=json_extract(l.photos_json,'$.d.url')) AND
      EXISTS (SELECT 1 FROM c2c_photos p WHERE p.id=json_extract(l.photos_json,'$.power.id') AND p.owner_id=l.owner_id AND p.slot='power' AND p.url LIKE 'https://%' AND p.url=json_extract(l.photos_json,'$.power.url'))
  ) THEN RAISE(ABORT,'C2C_DEVICE_UNAVAILABLE') END;
END;

DROP TRIGGER c2c_snapshot_order;
CREATE TRIGGER c2c_snapshot_order AFTER INSERT ON orders
BEGIN
  INSERT INTO c2c_order_terms (order_id,listing_id,owner_id,commission_bps,listing_mode,pickup_address)
  SELECT NEW.id,l.id,l.owner_id,CASE WHEN l.listing_mode='managed' THEN s.managed_commission_bps ELSE s.commission_bps END,l.listing_mode,l.pickup_address
    FROM c2c_listings l CROSS JOIN c2c_settings s WHERE l.device_id=NEW.deviceId AND s.id=1;
  UPDATE orders SET pickupLocation=(SELECT pickup_address FROM c2c_order_terms WHERE order_id=NEW.id),
    returnLocation=(SELECT pickup_address FROM c2c_order_terms WHERE order_id=NEW.id)
    WHERE id=NEW.id AND lower(COALESCE(NEW.deliveryMethod,'Pickup'))='pickup' AND EXISTS(SELECT 1 FROM c2c_order_terms WHERE order_id=NEW.id);
  INSERT OR IGNORE INTO email_events (id,event_type,recipient,order_id,idempotency_key,status,subject,text_body)
  SELECT 'email-c2c-'||NEW.id,'C2C_NEW_RENTAL',u.email,NEW.id,'c2c-rental:'||NEW.id,'PENDING','您的设备收到新出租申请',
    '设备：'||l.name||char(10)||'订单：'||COALESCE(NEW.orderNo,NEW.id)||char(10)||'租期：'||NEW.startDate||' 至 '||NEW.endDate||char(10)||
    '出租模式：'||CASE WHEN l.listing_mode='managed' THEN '墨尔本托管' ELSE '自行交付' END||char(10)||'请登录「我的出租」查看。'
    FROM c2c_listings l JOIN users u ON u.id=l.owner_id
    WHERE l.device_id=NEW.deviceId AND NEW.deleted_at IS NULL AND NEW.status NOT IN ('cancelled','completed');
END;
