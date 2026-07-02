import { scanHadLateResponse } from '../lib/analytics';
import { bboxFromWkt } from '../lib/polygon';
import type { DigAlertPayload } from '../fetchers';

function boolInt(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  return v ? 1 : 0;
}

function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  return String(v);
}

export async function upsertDigAlert(db: D1Database, envelope: DigAlertPayload): Promise<string | null> {
  const d = envelope.data;
  const ticketNumber = str(d.ticket);
  const revision = str(d.revision) ?? '00A';
  if (!ticketNumber) return null;

  const polygonWkt = str(d.polygon_wkt);
  const bbox = bboxFromWkt(polygonWkt);

  const responses = (d.responses as Record<string, unknown>[]) ?? [];
  const revisions = (d.revisions as Record<string, unknown>[]) ?? [];
  const responseCodes = responses.map((r) => str(r.response));
  const hadLate =
    scanHadLateResponse(responseCodes) ? 1 : 0;

  const existing = await db
    .prepare('SELECT had_late_response FROM dig_alert_tickets WHERE ticket_number = ? AND revision = ?')
    .bind(ticketNumber, revision)
    .first<{ had_late_response: number }>();

  const hadLateFinal = existing?.had_late_response || hadLate ? 1 : 0;

  await db.batch([
    db.prepare('DELETE FROM dig_alert_responses WHERE ticket_number = ? AND revision = ?').bind(ticketNumber, revision),
    db.prepare('DELETE FROM dig_alert_revisions WHERE ticket_number = ?').bind(ticketNumber),
  ]);

  await db
    .prepare(
      `INSERT INTO dig_alert_tickets (
        ticket_number, revision, api_status, api_message, api_timestamp,
        completed, type, county, place, st_from_address, street, cross1, cross2,
        location, replace_by_date, caller, email, phone, contact_phone, done_for,
        work_type, work_order, one_year, centroid_x, centroid_y, minfit_rectangle,
        work_area_shape, polygon_wkt, bbox_min_lon, bbox_min_lat, bbox_max_lon, bbox_max_lat,
        had_late_response, fetch_status, updated_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, datetime('now'))
      ON CONFLICT(ticket_number, revision) DO UPDATE SET
        api_status=excluded.api_status, api_message=excluded.api_message, api_timestamp=excluded.api_timestamp,
        completed=excluded.completed, type=excluded.type, county=excluded.county, place=excluded.place,
        st_from_address=excluded.st_from_address, street=excluded.street, cross1=excluded.cross1, cross2=excluded.cross2,
        location=excluded.location, replace_by_date=excluded.replace_by_date, caller=excluded.caller,
        email=excluded.email, phone=excluded.phone, contact_phone=excluded.contact_phone, done_for=excluded.done_for,
        work_type=excluded.work_type, work_order=excluded.work_order, one_year=excluded.one_year,
        centroid_x=excluded.centroid_x, centroid_y=excluded.centroid_y, minfit_rectangle=excluded.minfit_rectangle,
        work_area_shape=excluded.work_area_shape, polygon_wkt=excluded.polygon_wkt,
        bbox_min_lon=excluded.bbox_min_lon, bbox_min_lat=excluded.bbox_min_lat,
        bbox_max_lon=excluded.bbox_max_lon, bbox_max_lat=excluded.bbox_max_lat,
        had_late_response=CASE WHEN dig_alert_tickets.had_late_response=1 OR excluded.had_late_response=1 THEN 1 ELSE 0 END,
        fetch_status=excluded.fetch_status, updated_at=datetime('now')`
    )
    .bind(
      ticketNumber,
      revision,
      str(envelope.status),
      str(envelope.message),
      str(envelope.timestamp),
      str(d.completed),
      str(d.type),
      str(d.county),
      str(d.place),
      str(d.st_from_address),
      str(d.street),
      str(d.cross1),
      str(d.cross2),
      str(d.location),
      str(d.replace_by_date),
      str(d.caller),
      str(d.email),
      str(d.phone),
      str(d.contact_phone),
      str(d.done_for),
      str(d.work_type),
      str(d.work_order),
      boolInt(d.one_year),
      d.centroid_x ?? null,
      d.centroid_y ?? null,
      str(d.minfit_rectangle),
      str(d.work_area_shape),
      polygonWkt,
      bbox?.minLon ?? null,
      bbox?.minLat ?? null,
      bbox?.maxLon ?? null,
      bbox?.maxLat ?? null,
      hadLateFinal,
      'complete'
    )
    .run();

  for (const r of responses) {
    await db
      .prepare(
        `INSERT INTO dig_alert_responses (
          ticket_number, revision, utility_code, utility_name, response_code,
          response_description, responded_at, response_by, comments, url
        ) VALUES (?,?,?,?,?,?,?,?,?,?)`
      )
      .bind(
        ticketNumber,
        revision,
        str(r.code) ?? '',
        str(r.name),
        str(r.response),
        str(r.description),
        str(r.responded),
        str(r.response_by),
        str(r.comments),
        str(r.url)
      )
      .run();
  }

  for (const r of revisions) {
    await db
      .prepare(
        'INSERT INTO dig_alert_revisions (ticket_number, revision, type, completed) VALUES (?,?,?,?)'
      )
      .bind(ticketNumber, str(r.revision), str(r.type), str(r.completed))
      .run();
  }

  return ticketNumber;
}

type UsanTable = 'usan_ca' | 'usan_nv';

export async function upsertUsan(
  db: D1Database,
  table: UsanTable,
  payload: Record<string, unknown>,
  polygonWkt: string | null
): Promise<string | null> {
  const posr = payload.posrTicket as Record<string, unknown> | undefined;
  if (!posr) return null;
  const ticketNumber = str(posr.ticketNumber);
  if (!ticketNumber) return null;

  const stations = (posr.stations as Record<string, unknown>[]) ?? [];
  const history = (posr.ticketHistory as Record<string, unknown>[]) ?? [];
  const allCodes = [
    ...stations.map((s) => str(s.responseCode)),
    ...history.map((h) => str(h.responseCode)),
  ];
  const hadLate = scanHadLateResponse(allCodes) ? 1 : 0;

  const existing = await db
    .prepare(`SELECT had_late_response FROM ${table}_tickets WHERE ticket_number = ?`)
    .bind(ticketNumber)
    .first<{ had_late_response: number }>();
  const hadLateFinal = existing?.had_late_response || hadLate ? 1 : 0;

  const bbox = bboxFromWkt(polygonWkt);

  await db.batch([
    db.prepare(`DELETE FROM ${table}_stations WHERE ticket_number = ?`).bind(ticketNumber),
    db.prepare(`DELETE FROM ${table}_ticket_history WHERE ticket_number = ?`).bind(ticketNumber),
  ]);

  await db
    .prepare(
      `INSERT INTO ${table}_tickets (
        ticket_number, root_job_start_date, root_work_expiration_date, root_street_sidewalk_or_parkstrip,
        trail_id, is_successful, address, map_link, job_start_date, work_expiration_date,
        work_type, work_activity, excavation_method, street_sidewalk_or_parkstrip,
        additional_remarks, created_by, job_status, is_cancelled,
        polygon_wkt, bbox_min_lon, bbox_min_lat, bbox_max_lon, bbox_max_lat,
        had_late_response, fetch_status, updated_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, datetime('now'))
      ON CONFLICT(ticket_number) DO UPDATE SET
        root_job_start_date=excluded.root_job_start_date,
        root_work_expiration_date=excluded.root_work_expiration_date,
        root_street_sidewalk_or_parkstrip=excluded.root_street_sidewalk_or_parkstrip,
        trail_id=excluded.trail_id, is_successful=excluded.is_successful,
        address=excluded.address, map_link=excluded.map_link,
        job_start_date=excluded.job_start_date, work_expiration_date=excluded.work_expiration_date,
        work_type=excluded.work_type, work_activity=excluded.work_activity,
        excavation_method=excluded.excavation_method,
        street_sidewalk_or_parkstrip=excluded.street_sidewalk_or_parkstrip,
        additional_remarks=excluded.additional_remarks, created_by=excluded.created_by,
        job_status=excluded.job_status, is_cancelled=excluded.is_cancelled,
        polygon_wkt=excluded.polygon_wkt,
        bbox_min_lon=excluded.bbox_min_lon, bbox_min_lat=excluded.bbox_min_lat,
        bbox_max_lon=excluded.bbox_max_lon, bbox_max_lat=excluded.bbox_max_lat,
        had_late_response=CASE WHEN ${table}_tickets.had_late_response=1 OR excluded.had_late_response=1 THEN 1 ELSE 0 END,
        fetch_status=excluded.fetch_status, updated_at=datetime('now')`
    )
    .bind(
      ticketNumber,
      str(payload.jobStartDate),
      str(payload.workExpirationDate),
      str(payload.streetSideWalkOrParkstrip),
      str(payload.trailId),
      boolInt(payload.isSuccessful),
      str(posr.address),
      str(posr.mapLink),
      str(posr.jobStartDate),
      str(posr.workExpirationDate),
      str(posr.workType),
      str(posr.workActivity),
      str(posr.excavationMethod),
      boolInt(posr.streetSidewalkOrParkstrip),
      str(posr.additionalRemarks),
      str(posr.createdBy),
      str(posr.jobStatus),
      boolInt(posr.isCancelled),
      polygonWkt,
      bbox?.minLon ?? null,
      bbox?.minLat ?? null,
      bbox?.maxLon ?? null,
      bbox?.maxLat ?? null,
      hadLateFinal,
      polygonWkt ? 'complete' : 'partial'
    )
    .run();

  for (const s of stations) {
    await db
      .prepare(
        `INSERT INTO ${table}_stations (
          ticket_number, name, code, response_date, response_date_string,
          response_code, response_description, comment
        ) VALUES (?,?,?,?,?,?,?,?)`
      )
      .bind(
        ticketNumber,
        str(s.name),
        str(s.code) ?? '',
        str(s.responseDate),
        str(s.responseDateString),
        str(s.responseCode),
        str(s.responseDescription),
        str(s.comment)
      )
      .run();
  }

  for (const h of history) {
    await db
      .prepare(
        `INSERT INTO ${table}_ticket_history (
          ticket_number, request_number, name, code, response_date, response_date_string,
          response_code, response_description, comment
        ) VALUES (?,?,?,?,?,?,?,?,?)`
      )
      .bind(
        ticketNumber,
        str(h.requestNumber),
        str(h.name),
        str(h.code),
        str(h.responseDate),
        str(h.responseDateString),
        str(h.responseCode),
        str(h.responseDescription),
        str(h.comment)
      )
      .run();
  }

  return ticketNumber;
}
