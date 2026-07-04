CREATE INDEX IF NOT EXISTS idx_dig_alert_tickets_updated ON dig_alert_tickets(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_usan_ca_tickets_updated ON usan_ca_tickets(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_usan_nv_tickets_updated ON usan_nv_tickets(updated_at DESC);
