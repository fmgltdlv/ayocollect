-- ayocollect D1 initial schema

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

CREATE TABLE ticket_revisions (
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

CREATE INDEX idx_revisions_base ON ticket_revisions(region, ticket_base);
CREATE INDEX idx_revisions_current ON ticket_revisions(region, ticket_base, is_current);

CREATE TABLE utility_stations (
  station_code          TEXT PRIMARY KEY,
  station_name          TEXT NOT NULL,
  updated_at            TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE station_snapshots (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  request_number        TEXT NOT NULL REFERENCES ticket_revisions(request_number),
  station_code          TEXT NOT NULL,
  station_name          TEXT NOT NULL,
  response_date         TEXT NOT NULL,
  response_date_display TEXT,
  response_code         TEXT NOT NULL,
  response_description  TEXT,
  comment               TEXT,
  scraped_at            TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (request_number, station_code)
);

CREATE INDEX idx_snapshots_station ON station_snapshots(station_code);

CREATE TABLE response_events (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  request_number        TEXT NOT NULL REFERENCES ticket_revisions(request_number),
  station_code          TEXT NOT NULL,
  station_name          TEXT NOT NULL,
  response_date         TEXT NOT NULL,
  response_date_display TEXT,
  response_code         TEXT NOT NULL,
  response_description  TEXT,
  comment               TEXT,
  is_pending            INTEGER NOT NULL DEFAULT 0,
  is_late_trigger       INTEGER NOT NULL DEFAULT 0,
  is_acceptable         INTEGER NOT NULL DEFAULT 0,
  source                TEXT NOT NULL DEFAULT 'searchtool'
                          CHECK (source IN ('searchtool')),
  ingested_at           TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (request_number, station_code, response_date, response_code)
);

CREATE INDEX idx_events_revision ON response_events(request_number);
CREATE INDEX idx_events_station ON response_events(station_code);
CREATE INDEX idx_events_late_trigger ON response_events(is_late_trigger);
CREATE INDEX idx_events_acceptable ON response_events(is_acceptable);

CREATE TABLE response_code_catalog (
  response_code         TEXT PRIMARY KEY,
  category              TEXT NOT NULL CHECK (category IN ('pending', 'late_trigger', 'acceptable')),
  description           TEXT
);

INSERT INTO response_code_catalog (response_code, category, description) VALUES
  ('000', 'pending',     'Utility is yet to provide a suitable response code'),
  ('888', 'late_trigger', 'Legacy no-response marker (rare; USAN now uses 999)'),
  ('999', 'late_trigger', 'Member did not respond by required time (system use only)');

CREATE TABLE posr_fetches (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  region                TEXT NOT NULL CHECK (region IN ('CA', 'NV', 'DA')),
  ticket_base           TEXT NOT NULL,
  trail_id              TEXT,
  is_successful         INTEGER NOT NULL,
  validation_errors     TEXT,
  raw_payload           TEXT,
  fetched_at            TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_fetches_base ON posr_fetches(region, ticket_base, fetched_at);

CREATE TABLE ticket_polygons (
  request_number        TEXT PRIMARY KEY REFERENCES ticket_revisions(request_number),
  region                TEXT NOT NULL CHECK (region IN ('CA', 'NV', 'DA')),
  ticket_base           TEXT NOT NULL,
  geojson               TEXT NOT NULL,
  bbox_min_lat          REAL,
  bbox_max_lat          REAL,
  bbox_min_lon          REAL,
  bbox_max_lon          REAL,
  map_html              TEXT,
  updated_at            TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_polygons_base ON ticket_polygons(region, ticket_base);

CREATE TABLE polygon_overlaps (
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

CREATE TABLE sync_state (
  id                    INTEGER PRIMARY KEY CHECK (id = 1),
  last_success_at       TEXT,
  last_target_date      TEXT,
  tickets_synced        INTEGER NOT NULL DEFAULT 0,
  tickets_failed        INTEGER NOT NULL DEFAULT 0,
  last_error            TEXT,
  updated_at            TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO sync_state (id) VALUES (1);

CREATE TABLE backfill_runs (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  target_date           TEXT NOT NULL,
  region                TEXT NOT NULL DEFAULT 'NV'
                          CHECK (region IN ('CA', 'NV', 'DA')),
  status                TEXT NOT NULL DEFAULT 'queued'
                          CHECK (status IN ('queued', 'running', 'completed', 'failed')),
  tickets_synced        INTEGER NOT NULL DEFAULT 0,
  tickets_failed        INTEGER NOT NULL DEFAULT 0,
  started_at            TEXT,
  completed_at          TEXT,
  error                 TEXT,
  triggered_by          TEXT NOT NULL DEFAULT 'dashboard',
  UNIQUE (target_date, region)
);

CREATE TABLE station_timeliness (
  request_number        TEXT NOT NULL,
  station_code          TEXT NOT NULL,
  timeliness_status     TEXT NOT NULL CHECK (timeliness_status IN ('on_time','late','pending')),
  first_late_trigger_at TEXT,
  first_acceptable_at   TEXT,
  computed_at           TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (request_number, station_code)
);

CREATE VIEW v_station_timeliness AS
WITH per_station AS (
  SELECT
    re.request_number,
    tr.ticket_base,
    tr.revision,
    re.station_code,
    re.station_name,
    MIN(CASE WHEN re.is_late_trigger = 1 THEN re.response_date END)
      AS first_late_trigger_at,
    MIN(CASE WHEN re.is_acceptable = 1 THEN re.response_date END)
      AS first_acceptable_at
  FROM response_events re
  JOIN ticket_revisions tr ON tr.request_number = re.request_number
  GROUP BY re.request_number, tr.ticket_base, tr.revision,
           re.station_code, re.station_name
)
SELECT
  *,
  CASE
    WHEN first_acceptable_at IS NOT NULL
     AND (first_late_trigger_at IS NULL OR first_acceptable_at <= first_late_trigger_at)
      THEN 'on_time'
    WHEN first_late_trigger_at IS NOT NULL
     AND (first_acceptable_at IS NULL OR first_late_trigger_at < first_acceptable_at)
      THEN 'late'
    ELSE 'pending'
  END AS timeliness_status
FROM per_station;
