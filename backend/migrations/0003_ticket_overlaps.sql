CREATE TABLE IF NOT EXISTS ticket_overlaps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  a_system TEXT NOT NULL,
  a_number TEXT NOT NULL,
  a_revision TEXT,
  b_system TEXT NOT NULL,
  b_number TEXT NOT NULL,
  b_revision TEXT,
  overlap_kind TEXT NOT NULL DEFAULT 'polygon',
  concurrent INTEGER NOT NULL DEFAULT 0,
  computed_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(a_system, a_number, a_revision, b_system, b_number, b_revision)
);

CREATE INDEX IF NOT EXISTS idx_overlaps_a ON ticket_overlaps(a_system, a_number, a_revision);
CREATE INDEX IF NOT EXISTS idx_overlaps_b ON ticket_overlaps(b_system, b_number, b_revision);
CREATE INDEX IF NOT EXISTS idx_overlaps_concurrent ON ticket_overlaps(concurrent);

INSERT OR IGNORE INTO app_settings (key, value) VALUES
  ('overlap_cross_system_enabled', '0'),
  ('overlap_rebuild_cursor', ''),
  ('overlap_prune_enabled', '1');
