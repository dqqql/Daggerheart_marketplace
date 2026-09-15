CREATE TABLE IF NOT EXISTS notification_subscribers (
  email TEXT PRIMARY KEY,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_notification_subscribers_created_at
  ON notification_subscribers(created_at DESC);
