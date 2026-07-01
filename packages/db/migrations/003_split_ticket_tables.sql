-- Split unified ticket_bases into per-system tables

CREATE TABLE usan_nv_tickets (
  ticket_base           TEXT PRIMARY KEY,
  created_by            TEXT,
  latest_request_number TEXT,
  latest_revision       INTEGER NOT NULL DEFAULT 0,
  first_seen_at         TEXT NOT NULL DEFAULT (datetime('now')),
  last_refreshed_at     TEXT,
  refresh_priority      TEXT NOT NULL DEFAULT 'active'
                          CHECK (refresh_priority IN ('active', 'archived'))
);

CREATE TABLE usan_ca_tickets (
  ticket_base           TEXT PRIMARY KEY,
  created_by            TEXT,
  latest_request_number TEXT,
  latest_revision       INTEGER NOT NULL DEFAULT 0,
  first_seen_at         TEXT NOT NULL DEFAULT (datetime('now')),
  last_refreshed_at     TEXT,
  refresh_priority      TEXT NOT NULL DEFAULT 'active'
                          CHECK (refresh_priority IN ('active', 'archived'))
);

CREATE TABLE digalert_tickets (
  ticket_base           TEXT PRIMARY KEY,
  created_by            TEXT,
  latest_request_number TEXT,
  latest_revision       INTEGER NOT NULL DEFAULT 0,
  first_seen_at         TEXT NOT NULL DEFAULT (datetime('now')),
  last_refreshed_at     TEXT,
  refresh_priority      TEXT NOT NULL DEFAULT 'active'
                          CHECK (refresh_priority IN ('active', 'archived'))
);

INSERT INTO usan_nv_tickets (
  ticket_base, created_by, latest_request_number, latest_revision,
  first_seen_at, last_refreshed_at, refresh_priority
)
SELECT ticket_base, created_by, latest_request_number, latest_revision,
       first_seen_at, last_refreshed_at, refresh_priority
FROM ticket_bases
WHERE state = 'NV';

INSERT INTO usan_ca_tickets (
  ticket_base, created_by, latest_request_number, latest_revision,
  first_seen_at, last_refreshed_at, refresh_priority
)
SELECT ticket_base, created_by, latest_request_number, latest_revision,
       first_seen_at, last_refreshed_at, refresh_priority
FROM ticket_bases
WHERE state = 'CA';

INSERT INTO digalert_tickets (
  ticket_base, created_by, latest_request_number, latest_revision,
  first_seen_at, last_refreshed_at, refresh_priority
)
SELECT ticket_base, created_by, latest_request_number, latest_revision,
       first_seen_at, last_refreshed_at, refresh_priority
FROM ticket_bases
WHERE state = 'DA';

ALTER TABLE ticket_revisions ADD COLUMN region TEXT;
UPDATE ticket_revisions
SET region = (
  SELECT state FROM ticket_bases tb WHERE tb.ticket_base = ticket_revisions.ticket_base
);
CREATE TABLE ticket_revisions_new (
  request_number        TEXT PRIMARY KEY,
  region                TEXT NOT NULL CHECK (region IN ('CA', 'NV', 'DA')),
  ticket_base           TEXT NOT NULL,
  revision              INTEGER NOT NULL,
  job_start_at          TEXT,
  job_start_display     TEXT,
  work_expiration_at    TEXT,
  work_expiration_display TEXT,
  address               TEXT,
  map_link              TEXT,
  work_type             TEXT,
  work_activity         TEXT,
  excavation_method     TEXT,
  street_sidewalk_or_parkstrip INTEGER NOT NULL DEFAULT 0,
  additional_remarks    TEXT,
  is_cancelled          INTEGER NOT NULL DEFAULT 0,
  job_status            TEXT,
  is_current            INTEGER NOT NULL DEFAULT 0,
  first_seen_at         TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (region, ticket_base, revision)
);
INSERT INTO ticket_revisions_new SELECT * FROM ticket_revisions;
DROP TABLE ticket_revisions;
ALTER TABLE ticket_revisions_new RENAME TO ticket_revisions;
CREATE INDEX idx_revisions_base ON ticket_revisions(region, ticket_base);
CREATE INDEX idx_revisions_current ON ticket_revisions(region, ticket_base, is_current);

ALTER TABLE posr_fetches ADD COLUMN region TEXT;
UPDATE posr_fetches
SET region = (
  SELECT state FROM ticket_bases tb WHERE tb.ticket_base = posr_fetches.ticket_base
);

ALTER TABLE ticket_polygons ADD COLUMN region TEXT;
UPDATE ticket_polygons
SET region = (
  SELECT tr.region FROM ticket_revisions tr WHERE tr.request_number = ticket_polygons.request_number
);
CREATE INDEX idx_polygons_base ON ticket_polygons(region, ticket_base);

CREATE TABLE polygon_overlaps_new (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  region_a              TEXT NOT NULL CHECK (region_a IN ('CA', 'NV', 'DA')),
  ticket_base_a         TEXT NOT NULL,
  region_b              TEXT NOT NULL CHECK (region_b IN ('CA', 'NV', 'DA')),
  ticket_base_b         TEXT NOT NULL,
  request_number_a      TEXT,
  request_number_b      TEXT,
  overlap_area_sqm      REAL,
  detected_at           TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (region_a, ticket_base_a, region_b, ticket_base_b)
);
INSERT INTO polygon_overlaps_new (
  id, region_a, ticket_base_a, region_b, ticket_base_b,
  request_number_a, request_number_b, overlap_area_sqm, detected_at
)
SELECT
  po.id,
  COALESCE(ta.state, 'NV'),
  po.ticket_base_a,
  COALESCE(tb.state, 'NV'),
  po.ticket_base_b,
  po.request_number_a,
  po.request_number_b,
  po.overlap_area_sqm,
  po.detected_at
FROM polygon_overlaps po
LEFT JOIN ticket_bases ta ON ta.ticket_base = po.ticket_base_a
LEFT JOIN ticket_bases tb ON tb.ticket_base = po.ticket_base_b;
DROP TABLE polygon_overlaps;
ALTER TABLE polygon_overlaps_new RENAME TO polygon_overlaps;

DROP TABLE ticket_bases;
