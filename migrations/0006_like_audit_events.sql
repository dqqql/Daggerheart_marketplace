CREATE TABLE IF NOT EXISTS like_audit_events (
  event_id TEXT PRIMARY KEY,
  occurred_at TEXT NOT NULL,
  entry_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('like', 'unlike', 'unknown')),
  outcome TEXT NOT NULL CHECK (outcome IN ('success', 'no_change', 'failed')),
  reason_code TEXT NOT NULL DEFAULT '',
  count_delta INTEGER CHECK (count_delta IS NULL OR count_delta IN (-1, 0, 1)),
  visitor_id TEXT,
  visitor_first_seen_at TEXT,
  visitor_id_status TEXT NOT NULL CHECK (visitor_id_status IN ('valid', 'new', 'unavailable')),
  ip_hash TEXT,
  identity_version TEXT NOT NULL,
  browser_family TEXT NOT NULL,
  os_family TEXT NOT NULL,
  device_class TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_like_audit_events_occurred_at
  ON like_audit_events(occurred_at);

CREATE INDEX IF NOT EXISTS idx_like_audit_events_entry_occurred_at
  ON like_audit_events(entry_id, occurred_at);

CREATE INDEX IF NOT EXISTS idx_like_audit_events_visitor_occurred_at
  ON like_audit_events(visitor_id, occurred_at);

CREATE INDEX IF NOT EXISTS idx_like_audit_events_ip_occurred_at
  ON like_audit_events(ip_hash, occurred_at);
