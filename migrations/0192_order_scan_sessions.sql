CREATE TABLE order_scan_sessions (
  token_hash TEXT PRIMARY KEY NOT NULL,
  actor_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  stage TEXT NOT NULL CHECK (stage IN ('pickup','return')),
  source TEXT NOT NULL DEFAULT 'camera' CHECK (source IN ('camera','code')),
  device_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  status_snapshot TEXT NOT NULL,
  scanned_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  confirmed_at INTEGER,
  claimed_at INTEGER,
  completed_at INTEGER
);
CREATE INDEX order_scan_sessions_order_stage ON order_scan_sessions(order_id,stage,completed_at);
CREATE INDEX order_scan_sessions_expiry ON order_scan_sessions(expires_at);

CREATE TABLE order_verification_codes (
  order_id TEXT PRIMARY KEY NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  verification_code TEXT NOT NULL COLLATE NOCASE UNIQUE
    CHECK (length(verification_code)=6 AND verification_code NOT GLOB '*[^A-Z0-9]*'),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

UPDATE email_templates SET body=body||'<p>取还校验码：<strong>{order_verification_code}</strong></p>'
WHERE id IN ('pickup_reminder','pickup_reminder_2h','pickup_reminder_30m')
  AND instr(body,'{order_verification_code}')=0;
