-- DigAlert main ticket table
CREATE TABLE IF NOT EXISTS dig_alert_tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_number TEXT NOT NULL,
  revision TEXT NOT NULL,
  api_status TEXT,
  api_message TEXT,
  api_timestamp TEXT,
  completed TEXT,
  type TEXT,
  county TEXT,
  place TEXT,
  st_from_address TEXT,
  street TEXT,
  cross1 TEXT,
  cross2 TEXT,
  location TEXT,
  replace_by_date TEXT,
  caller TEXT,
  email TEXT,
  phone TEXT,
  contact_phone TEXT,
  done_for TEXT,
  work_type TEXT,
  work_order TEXT,
  one_year INTEGER,
  centroid_x REAL,
  centroid_y REAL,
  minfit_rectangle TEXT,
  work_area_shape TEXT,
  polygon_wkt TEXT,
  bbox_min_lon REAL,
  bbox_min_lat REAL,
  bbox_max_lon REAL,
  bbox_max_lat REAL,
  had_late_response INTEGER NOT NULL DEFAULT 0,
  fetch_status TEXT,
  fetch_error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(ticket_number, revision)
);

CREATE TABLE IF NOT EXISTS dig_alert_responses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_number TEXT NOT NULL,
  revision TEXT NOT NULL,
  utility_code TEXT NOT NULL,
  utility_name TEXT,
  response_code TEXT,
  response_description TEXT,
  responded_at TEXT,
  response_by TEXT,
  comments TEXT,
  url TEXT
);

CREATE TABLE IF NOT EXISTS dig_alert_revisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_number TEXT NOT NULL,
  revision TEXT NOT NULL,
  type TEXT,
  completed TEXT
);

-- USAN CA
CREATE TABLE IF NOT EXISTS usan_ca_tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_number TEXT NOT NULL UNIQUE,
  root_job_start_date TEXT,
  root_work_expiration_date TEXT,
  root_street_sidewalk_or_parkstrip TEXT,
  trail_id TEXT,
  is_successful INTEGER,
  address TEXT,
  map_link TEXT,
  job_start_date TEXT,
  work_expiration_date TEXT,
  work_type TEXT,
  work_activity TEXT,
  excavation_method TEXT,
  street_sidewalk_or_parkstrip INTEGER,
  additional_remarks TEXT,
  created_by TEXT,
  job_status TEXT,
  is_cancelled INTEGER,
  polygon_wkt TEXT,
  bbox_min_lon REAL,
  bbox_min_lat REAL,
  bbox_max_lon REAL,
  bbox_max_lat REAL,
  had_late_response INTEGER NOT NULL DEFAULT 0,
  fetch_status TEXT,
  fetch_error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS usan_ca_stations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_number TEXT NOT NULL,
  name TEXT,
  code TEXT NOT NULL,
  response_date TEXT,
  response_date_string TEXT,
  response_code TEXT,
  response_description TEXT,
  comment TEXT
);

CREATE TABLE IF NOT EXISTS usan_ca_ticket_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_number TEXT NOT NULL,
  request_number TEXT,
  name TEXT,
  code TEXT,
  response_date TEXT,
  response_date_string TEXT,
  response_code TEXT,
  response_description TEXT,
  comment TEXT
);

-- USAN NV (same shape as CA)
CREATE TABLE IF NOT EXISTS usan_nv_tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_number TEXT NOT NULL UNIQUE,
  root_job_start_date TEXT,
  root_work_expiration_date TEXT,
  root_street_sidewalk_or_parkstrip TEXT,
  trail_id TEXT,
  is_successful INTEGER,
  address TEXT,
  map_link TEXT,
  job_start_date TEXT,
  work_expiration_date TEXT,
  work_type TEXT,
  work_activity TEXT,
  excavation_method TEXT,
  street_sidewalk_or_parkstrip INTEGER,
  additional_remarks TEXT,
  created_by TEXT,
  job_status TEXT,
  is_cancelled INTEGER,
  polygon_wkt TEXT,
  bbox_min_lon REAL,
  bbox_min_lat REAL,
  bbox_max_lon REAL,
  bbox_max_lat REAL,
  had_late_response INTEGER NOT NULL DEFAULT 0,
  fetch_status TEXT,
  fetch_error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS usan_nv_stations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_number TEXT NOT NULL,
  name TEXT,
  code TEXT NOT NULL,
  response_date TEXT,
  response_date_string TEXT,
  response_code TEXT,
  response_description TEXT,
  comment TEXT
);

CREATE TABLE IF NOT EXISTS usan_nv_ticket_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_number TEXT NOT NULL,
  request_number TEXT,
  name TEXT,
  code TEXT,
  response_date TEXT,
  response_date_string TEXT,
  response_code TEXT,
  response_description TEXT,
  comment TEXT
);

-- Batch jobs
CREATE TABLE IF NOT EXISTS fetch_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  status TEXT NOT NULL DEFAULT 'pending',
  triggered_by TEXT NOT NULL DEFAULT 'manual',
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  include_digalert INTEGER NOT NULL DEFAULT 0,
  include_usan_ca INTEGER NOT NULL DEFAULT 0,
  include_usan_nv INTEGER NOT NULL DEFAULT 0,
  digalert_cursor TEXT,
  usan_ca_cursor TEXT,
  usan_nv_cursor TEXT,
  digalert_fetched INTEGER NOT NULL DEFAULT 0,
  usan_ca_fetched INTEGER NOT NULL DEFAULT 0,
  usan_nv_fetched INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT OR IGNORE INTO app_settings (key, value) VALUES
  ('auto_fetch_enabled', '0'),
  ('auto_fetch_time_utc', '06:00'),
  ('auto_fetch_include_digalert', '1'),
  ('auto_fetch_include_usan_ca', '1'),
  ('auto_fetch_include_usan_nv', '0'),
  ('auto_fetch_lookback_days', '1'),
  ('fetch_stopped', '0'),
  ('auto_fetch_last_run_date', '');

-- Indexes
CREATE INDEX IF NOT EXISTS idx_dig_alert_tickets_number ON dig_alert_tickets(ticket_number);
CREATE INDEX IF NOT EXISTS idx_dig_alert_tickets_dates ON dig_alert_tickets(completed, replace_by_date);
CREATE INDEX IF NOT EXISTS idx_dig_alert_tickets_bbox ON dig_alert_tickets(bbox_min_lon, bbox_max_lon, bbox_min_lat, bbox_max_lat);
CREATE INDEX IF NOT EXISTS idx_dig_alert_responses_ticket ON dig_alert_responses(ticket_number, revision);

CREATE INDEX IF NOT EXISTS idx_usan_ca_tickets_dates ON usan_ca_tickets(job_start_date, work_expiration_date);
CREATE INDEX IF NOT EXISTS idx_usan_ca_tickets_bbox ON usan_ca_tickets(bbox_min_lon, bbox_max_lon, bbox_min_lat, bbox_max_lat);
CREATE INDEX IF NOT EXISTS idx_usan_ca_stations_ticket ON usan_ca_stations(ticket_number);

CREATE INDEX IF NOT EXISTS idx_usan_nv_tickets_dates ON usan_nv_tickets(job_start_date, work_expiration_date);
CREATE INDEX IF NOT EXISTS idx_usan_nv_tickets_bbox ON usan_nv_tickets(bbox_min_lon, bbox_max_lon, bbox_min_lat, bbox_max_lat);
CREATE INDEX IF NOT EXISTS idx_usan_nv_stations_ticket ON usan_nv_stations(ticket_number);

CREATE INDEX IF NOT EXISTS idx_fetch_jobs_status ON fetch_jobs(status);
