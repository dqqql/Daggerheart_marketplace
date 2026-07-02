CREATE TABLE IF NOT EXISTS entries (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  author TEXT NOT NULL DEFAULT '',
  content_tags TEXT NOT NULL DEFAULT '[]',
  flavor_tags TEXT NOT NULL DEFAULT '[]',
  recommend_value INTEGER NOT NULL DEFAULT 0,
  summary TEXT NOT NULL DEFAULT '',
  cover_path TEXT NOT NULL DEFAULT '',
  target_url TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS entry_likes (
  entry_id TEXT NOT NULL,
  ip_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (entry_id, ip_hash),
  FOREIGN KEY (entry_id) REFERENCES entries(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_entry_likes_entry_id ON entry_likes(entry_id);

CREATE TABLE IF NOT EXISTS submissions (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  author TEXT NOT NULL DEFAULT '',
  content_tags TEXT NOT NULL DEFAULT '[]',
  flavor_tags TEXT NOT NULL DEFAULT '[]',
  recommend_value INTEGER NOT NULL DEFAULT 0,
  summary TEXT NOT NULL DEFAULT '',
  cover_path TEXT NOT NULL DEFAULT '',
  target_url TEXT NOT NULL,
  feedback_email TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_submissions_created_at ON submissions(created_at DESC);

CREATE TABLE IF NOT EXISTS submission_reviews (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL CHECK (action IN ('approved', 'rejected')),
  entry_id TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  author TEXT NOT NULL DEFAULT '',
  content_tags TEXT NOT NULL DEFAULT '[]',
  flavor_tags TEXT NOT NULL DEFAULT '[]',
  summary TEXT NOT NULL DEFAULT '',
  cover_path TEXT NOT NULL DEFAULT '',
  target_url TEXT NOT NULL DEFAULT '',
  feedback_email TEXT NOT NULL DEFAULT '',
  review_note TEXT NOT NULL DEFAULT '',
  notification TEXT,
  submitted_at TEXT NOT NULL DEFAULT '',
  reviewed_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_submission_reviews_reviewed_at
  ON submission_reviews(reviewed_at DESC);
