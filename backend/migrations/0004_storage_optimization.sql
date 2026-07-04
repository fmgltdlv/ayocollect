-- Drop redundant DigAlert geometry fields (polygon_wkt is canonical)
ALTER TABLE dig_alert_tickets DROP COLUMN minfit_rectangle;
ALTER TABLE dig_alert_tickets DROP COLUMN work_area_shape;

-- dig_alert_responses: ticket_number + revision → ticket_id
CREATE TABLE dig_alert_responses_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id INTEGER NOT NULL REFERENCES dig_alert_tickets(id) ON DELETE CASCADE,
  utility_code TEXT NOT NULL,
  utility_name TEXT,
  response_code TEXT,
  response_description TEXT,
  responded_at TEXT,
  response_by TEXT,
  comments TEXT,
  url TEXT
);

INSERT INTO dig_alert_responses_new (
  id, ticket_id, utility_code, utility_name, response_code,
  response_description, responded_at, response_by, comments, url
)
SELECT
  r.id, t.id, r.utility_code, r.utility_name, r.response_code,
  r.response_description, r.responded_at, r.response_by, r.comments, r.url
FROM dig_alert_responses r
INNER JOIN dig_alert_tickets t
  ON t.ticket_number = r.ticket_number AND t.revision = r.revision;

DROP TABLE dig_alert_responses;
ALTER TABLE dig_alert_responses_new RENAME TO dig_alert_responses;
CREATE INDEX IF NOT EXISTS idx_dig_alert_responses_ticket ON dig_alert_responses(ticket_id);

-- usan_ca_stations: ticket_number → ticket_id
CREATE TABLE usan_ca_stations_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id INTEGER NOT NULL REFERENCES usan_ca_tickets(id) ON DELETE CASCADE,
  name TEXT,
  code TEXT NOT NULL,
  response_date TEXT,
  response_date_string TEXT,
  response_code TEXT,
  response_description TEXT,
  comment TEXT
);

INSERT INTO usan_ca_stations_new (
  id, ticket_id, name, code, response_date, response_date_string,
  response_code, response_description, comment
)
SELECT
  s.id, t.id, s.name, s.code, s.response_date, s.response_date_string,
  s.response_code, s.response_description, s.comment
FROM usan_ca_stations s
INNER JOIN usan_ca_tickets t ON t.ticket_number = s.ticket_number;

DROP TABLE usan_ca_stations;
ALTER TABLE usan_ca_stations_new RENAME TO usan_ca_stations;
CREATE INDEX IF NOT EXISTS idx_usan_ca_stations_ticket ON usan_ca_stations(ticket_id);

-- usan_nv_stations: ticket_number → ticket_id
CREATE TABLE usan_nv_stations_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id INTEGER NOT NULL REFERENCES usan_nv_tickets(id) ON DELETE CASCADE,
  name TEXT,
  code TEXT NOT NULL,
  response_date TEXT,
  response_date_string TEXT,
  response_code TEXT,
  response_description TEXT,
  comment TEXT
);

INSERT INTO usan_nv_stations_new (
  id, ticket_id, name, code, response_date, response_date_string,
  response_code, response_description, comment
)
SELECT
  s.id, t.id, s.name, s.code, s.response_date, s.response_date_string,
  s.response_code, s.response_description, s.comment
FROM usan_nv_stations s
INNER JOIN usan_nv_tickets t ON t.ticket_number = s.ticket_number;

DROP TABLE usan_nv_stations;
ALTER TABLE usan_nv_stations_new RENAME TO usan_nv_stations;
CREATE INDEX IF NOT EXISTS idx_usan_nv_stations_ticket ON usan_nv_stations(ticket_id);

-- usan_ca_ticket_history: ticket_number + request_number → ticket_id + revision_suffix
CREATE TABLE usan_ca_ticket_history_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id INTEGER NOT NULL REFERENCES usan_ca_tickets(id) ON DELETE CASCADE,
  revision_suffix TEXT,
  name TEXT,
  code TEXT,
  response_date TEXT,
  response_date_string TEXT,
  response_code TEXT,
  response_description TEXT,
  comment TEXT
);

INSERT INTO usan_ca_ticket_history_new (
  id, ticket_id, revision_suffix, name, code, response_date, response_date_string,
  response_code, response_description, comment
)
SELECT
  h.id, t.id,
  CASE
    WHEN h.request_number IS NOT NULL AND instr(h.request_number, '-') > 0
      THEN substr(h.request_number, instr(h.request_number, '-') + 1)
    ELSE h.request_number
  END,
  h.name, h.code, h.response_date, h.response_date_string,
  h.response_code, h.response_description, h.comment
FROM usan_ca_ticket_history h
INNER JOIN usan_ca_tickets t ON t.ticket_number = h.ticket_number;

DROP TABLE usan_ca_ticket_history;
ALTER TABLE usan_ca_ticket_history_new RENAME TO usan_ca_ticket_history;
CREATE INDEX IF NOT EXISTS idx_usan_ca_history_ticket ON usan_ca_ticket_history(ticket_id);

-- usan_nv_ticket_history: ticket_number + request_number → ticket_id + revision_suffix
CREATE TABLE usan_nv_ticket_history_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id INTEGER NOT NULL REFERENCES usan_nv_tickets(id) ON DELETE CASCADE,
  revision_suffix TEXT,
  name TEXT,
  code TEXT,
  response_date TEXT,
  response_date_string TEXT,
  response_code TEXT,
  response_description TEXT,
  comment TEXT
);

INSERT INTO usan_nv_ticket_history_new (
  id, ticket_id, revision_suffix, name, code, response_date, response_date_string,
  response_code, response_description, comment
)
SELECT
  h.id, t.id,
  CASE
    WHEN h.request_number IS NOT NULL AND instr(h.request_number, '-') > 0
      THEN substr(h.request_number, instr(h.request_number, '-') + 1)
    ELSE h.request_number
  END,
  h.name, h.code, h.response_date, h.response_date_string,
  h.response_code, h.response_description, h.comment
FROM usan_nv_ticket_history h
INNER JOIN usan_nv_tickets t ON t.ticket_number = h.ticket_number;

DROP TABLE usan_nv_ticket_history;
ALTER TABLE usan_nv_ticket_history_new RENAME TO usan_nv_ticket_history;
CREATE INDEX IF NOT EXISTS idx_usan_nv_history_ticket ON usan_nv_ticket_history(ticket_id);
