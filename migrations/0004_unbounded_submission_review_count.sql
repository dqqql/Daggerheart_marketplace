CREATE TABLE submissions_next (
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
  updated_at TEXT NOT NULL,
  review_count INTEGER NOT NULL DEFAULT 0 CHECK (review_count >= 0)
);

INSERT INTO submissions_next
  (id, title, author, content_tags, flavor_tags, recommend_value, summary,
   cover_path, target_url, feedback_email, created_at, updated_at, review_count)
SELECT
  id, title, author, content_tags, flavor_tags, recommend_value, summary,
  cover_path, target_url, feedback_email, created_at, updated_at, review_count
FROM submissions;

DROP TABLE submissions;
ALTER TABLE submissions_next RENAME TO submissions;

CREATE INDEX IF NOT EXISTS idx_submissions_created_at
  ON submissions(created_at DESC);
