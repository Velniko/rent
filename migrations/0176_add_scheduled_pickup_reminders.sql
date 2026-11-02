-- Copyright (c) 2026 jiongjiong123441. All rights reserved.
-- Licensed under PolyForm Noncommercial 1.0.0.
-- Noncommercial use, modification, and distribution are permitted.
-- Keep this notice and the LICENSE file with all copies and modified versions.

ALTER TABLE orders ADD COLUMN pickup_notice_base_url TEXT;
ALTER TABLE orders ADD COLUMN pickup_reminder_2h_sent_at TEXT;
ALTER TABLE orders ADD COLUMN pickup_reminder_30m_sent_at TEXT;
ALTER TABLE orders ADD COLUMN pickup_reminder_attempt_at TEXT;

CREATE INDEX idx_orders_pickup_reminders ON orders(startDate)
WHERE pickup_ready_at IS NOT NULL AND handover_completed_at IS NULL AND deleted_at IS NULL;

CREATE TRIGGER reset_pickup_reminders_after_appointment_change
AFTER UPDATE OF startDate, pickupTimeSlot, deviceId, userId, deliveryMethod ON orders
WHEN OLD.startDate IS NOT NEW.startDate OR OLD.pickupTimeSlot IS NOT NEW.pickupTimeSlot
  OR OLD.deviceId IS NOT NEW.deviceId OR OLD.userId IS NOT NEW.userId OR OLD.deliveryMethod IS NOT NEW.deliveryMethod
BEGIN
  UPDATE orders SET pickup_reminder_2h_sent_at = NULL, pickup_reminder_30m_sent_at = NULL,
    pickup_reminder_attempt_at = NULL WHERE id = NEW.id;
END;

INSERT OR IGNORE INTO email_templates (id, name, subject, body, format) VALUES
('pickup_reminder_2h', '取货前 2 小时提醒', '取货前 2 小时提醒 - {order_number}', '<h2>取货提醒</h2><p>您好 {customer_name}：</p><p>距离预约取货还有 2 小时。</p><p>订单编号：{order_number}<br>租赁设备：{device_name}<br>取货日期：{pickup_date}<br>取货时间：{pickup_time}<br>取货地点：{pickup_location}</p><h3>取货二维码</h3><p>{pickup_qr_code}</p>', 'html'),
('pickup_reminder_30m', '取货前 30 分钟提醒', '取货前 30 分钟提醒 - {order_number}', '<h2>取货提醒</h2><p>您好 {customer_name}：</p><p>距离预约取货还有 30 分钟。</p><p>订单编号：{order_number}<br>租赁设备：{device_name}<br>取货日期：{pickup_date}<br>取货时间：{pickup_time}<br>取货地点：{pickup_location}</p><h3>取货二维码</h3><p>{pickup_qr_code}</p>', 'html');
