CREATE TABLE IF NOT EXISTS user_feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_email TEXT NOT NULL,
  message TEXT NOT NULL,
  page_url TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  read_at TEXT,
  read_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_user_feedback_unread ON user_feedback(read_at) WHERE read_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_user_feedback_created ON user_feedback(created_at DESC);
