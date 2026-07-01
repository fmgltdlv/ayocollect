import type {
  DigalertTicketBundle,
  PosrSearchToolResponse,
  TicketRegion,
} from './types';

export function parseRequestNumber(requestNumber: string): {
  ticketBase: string;
  revision: number;
} {
  const dash = requestNumber.lastIndexOf('-');
  if (dash === -1) {
    return { ticketBase: requestNumber, revision: 0 };
  }
  const suffix = requestNumber.slice(dash + 1);
  const parsed = parseInt(suffix.replace(/\D/g, ''), 10);
  return {
    ticketBase: requestNumber.slice(0, dash),
    revision: Number.isNaN(parsed) ? 0 : parsed,
  };
}

export function classifyResponseCode(code: string): {
  isPending: boolean;
  isLateTrigger: boolean;
  isAcceptable: boolean;
} {
  if (code === '000') {
    return { isPending: true, isLateTrigger: false, isAcceptable: false };
  }
  if (code === '888' || code === '999') {
    return { isPending: false, isLateTrigger: true, isAcceptable: false };
  }
  return { isPending: false, isLateTrigger: false, isAcceptable: true };
}

export async function upsertPosrPayload(
  db: D1Database,
  payload: PosrSearchToolResponse,
  region: TicketRegion,
  rawPayload?: string,
): Promise<void> {
  const ticket = payload.posrTicket;
  if (!ticket?.ticketNumber) return;

  const { ticketBase, revision } = parseRequestNumber(ticket.ticketNumber);

  await db
    .prepare(
      `INSERT INTO ticket_bases (ticket_base, state, created_by, latest_request_number, latest_revision, last_refreshed_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(ticket_base) DO UPDATE SET
         created_by = COALESCE(excluded.created_by, ticket_bases.created_by),
         latest_request_number = excluded.latest_request_number,
         latest_revision = excluded.latest_revision,
         last_refreshed_at = datetime('now')`,
    )
    .bind(ticketBase, region, ticket.createdBy ?? null, ticket.ticketNumber, revision)
    .run();

  await db
    .prepare(`UPDATE ticket_revisions SET is_current = 0 WHERE ticket_base = ?`)
    .bind(ticketBase)
    .run();

  await upsertRevision(db, ticket.ticketNumber, ticketBase, revision, ticket, true);

  const history = ticket.ticketHistory ?? [];
  const revisionNumbers = new Set<string>([ticket.ticketNumber]);
  for (const entry of history) {
    if (entry.requestNumber) revisionNumbers.add(entry.requestNumber);
  }

  for (const reqNum of revisionNumbers) {
    if (reqNum === ticket.ticketNumber) continue;
    const parsed = parseRequestNumber(reqNum);
    await ensureRevisionExists(db, reqNum, parsed.ticketBase, parsed.revision);
  }

  for (const entry of history) {
    if (!entry.requestNumber) continue;
    const flags = classifyResponseCode(entry.responseCode);
    await db
      .prepare(
        `INSERT INTO response_events (
          request_number, station_code, station_name, response_date, response_date_display,
          response_code, response_description, comment,
          is_pending, is_late_trigger, is_acceptable, source
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(request_number, station_code, response_date, response_code) DO UPDATE SET
          station_name = excluded.station_name,
          response_description = excluded.response_description,
          comment = excluded.comment,
          is_pending = excluded.is_pending,
          is_late_trigger = excluded.is_late_trigger,
          is_acceptable = excluded.is_acceptable`,
      )
      .bind(
        entry.requestNumber,
        entry.code,
        entry.name,
        entry.responseDate,
        entry.responseDateString ?? null,
        entry.responseCode,
        entry.responseDescription ?? null,
        entry.comment ?? null,
        flags.isPending ? 1 : 0,
        flags.isLateTrigger ? 1 : 0,
        flags.isAcceptable ? 1 : 0,
        'searchtool',
      )
      .run();

    await db
      .prepare(
        `INSERT INTO utility_stations (station_code, station_name, updated_at)
         VALUES (?, ?, datetime('now'))
         ON CONFLICT(station_code) DO UPDATE SET station_name = excluded.station_name, updated_at = datetime('now')`,
      )
      .bind(entry.code, entry.name)
      .run();
  }

  await db
    .prepare(`DELETE FROM station_snapshots WHERE request_number = ?`)
    .bind(ticket.ticketNumber)
    .run();

  for (const station of ticket.stations ?? []) {
    await db
      .prepare(
        `INSERT INTO station_snapshots (
          request_number, station_code, station_name, response_date, response_date_display,
          response_code, response_description, comment
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(request_number, station_code) DO UPDATE SET
          station_name = excluded.station_name,
          response_date = excluded.response_date,
          response_date_display = excluded.response_date_display,
          response_code = excluded.response_code,
          response_description = excluded.response_description,
          comment = excluded.comment,
          scraped_at = datetime('now')`,
      )
      .bind(
        ticket.ticketNumber,
        station.code,
        station.name,
        station.responseDate,
        station.responseDateString ?? null,
        station.responseCode,
        station.responseDescription ?? null,
        station.comment ?? null,
      )
      .run();
  }

  await db
    .prepare(
      `INSERT INTO posr_fetches (ticket_base, trail_id, is_successful, validation_errors, raw_payload)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(
      ticketBase,
      payload.trailId ?? null,
      payload.isSuccessful ? 1 : 0,
      payload.validationErrors ? JSON.stringify(payload.validationErrors) : null,
      rawPayload ?? null,
    )
    .run();

  await recomputeTimeliness(db, ticketBase);
}

export async function upsertDigalertPayload(
  db: D1Database,
  bundle: DigalertTicketBundle,
  rawPayload?: string,
): Promise<void> {
  const ticketData = bundle.ticketData;
  const ticketBase = bundle.ticket;
  const requestNumber = bundle.requestNumber;
  const revision = parseRequestNumber(requestNumber).revision;
  const caller = typeof ticketData.caller === 'string' ? ticketData.caller : null;
  const address =
    typeof ticketData.address1 === 'string'
      ? ticketData.address1
      : typeof ticketData.address === 'string'
        ? ticketData.address
        : null;

  await db
    .prepare(
      `INSERT INTO ticket_bases (ticket_base, state, created_by, latest_request_number, latest_revision, last_refreshed_at)
       VALUES (?, 'DA', ?, ?, ?, datetime('now'))
       ON CONFLICT(ticket_base) DO UPDATE SET
         created_by = COALESCE(excluded.created_by, ticket_bases.created_by),
         latest_request_number = excluded.latest_request_number,
         latest_revision = excluded.latest_revision,
         last_refreshed_at = datetime('now')`,
    )
    .bind(ticketBase, caller, requestNumber, revision)
    .run();

  await db
    .prepare(`UPDATE ticket_revisions SET is_current = 0 WHERE ticket_base = ?`)
    .bind(ticketBase)
    .run();

  await db
    .prepare(
      `INSERT INTO ticket_revisions (
        request_number, ticket_base, revision,
        job_start_at, job_start_display, work_expiration_at, work_expiration_display,
        address, map_link, work_type, work_activity, excavation_method,
        street_sidewalk_or_parkstrip, additional_remarks, is_cancelled, job_status, is_current, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL, NULL, 0, ?, 0, ?, 1, datetime('now'))
      ON CONFLICT(request_number) DO UPDATE SET
        job_start_at = excluded.job_start_at,
        work_expiration_at = excluded.work_expiration_at,
        address = excluded.address,
        work_type = excluded.work_type,
        additional_remarks = excluded.additional_remarks,
        job_status = excluded.job_status,
        is_current = excluded.is_current,
        updated_at = datetime('now')`,
    )
    .bind(
      requestNumber,
      ticketBase,
      revision,
      typeof ticketData.work_date === 'string' ? ticketData.work_date : null,
      typeof ticketData.work_date === 'string' ? ticketData.work_date : null,
      typeof ticketData.expires === 'string' ? ticketData.expires : null,
      typeof ticketData.expires === 'string' ? ticketData.expires : null,
      address,
      typeof ticketData.work_type === 'string' ? ticketData.work_type : null,
      typeof ticketData.remarks === 'string' ? ticketData.remarks : null,
      typeof ticketData.type === 'string' ? ticketData.type : null,
    )
    .run();

  await db
    .prepare(`DELETE FROM station_snapshots WHERE request_number = ?`)
    .bind(requestNumber)
    .run();

  for (const epr of bundle.eprResponses) {
    if (!epr.member || !epr.response) continue;
    const responseCode = epr.response;
    const flags = classifyResponseCode(responseCode);
    const responseDate = epr.responded ?? new Date().toISOString();

    await db
      .prepare(
        `INSERT INTO response_events (
          request_number, station_code, station_name, response_date, response_date_display,
          response_code, response_description, comment,
          is_pending, is_late_trigger, is_acceptable, source
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(request_number, station_code, response_date, response_code) DO UPDATE SET
          station_name = excluded.station_name,
          response_description = excluded.response_description,
          comment = excluded.comment,
          is_pending = excluded.is_pending,
          is_late_trigger = excluded.is_late_trigger,
          is_acceptable = excluded.is_acceptable`,
      )
      .bind(
        requestNumber,
        epr.member,
        epr.member,
        responseDate,
        responseDate,
        responseCode,
        epr.description ?? null,
        epr.comments ?? null,
        flags.isPending ? 1 : 0,
        flags.isLateTrigger ? 1 : 0,
        flags.isAcceptable ? 1 : 0,
        'searchtool',
      )
      .run();

    await db
      .prepare(
        `INSERT INTO utility_stations (station_code, station_name, updated_at)
         VALUES (?, ?, datetime('now'))
         ON CONFLICT(station_code) DO UPDATE SET station_name = excluded.station_name, updated_at = datetime('now')`,
      )
      .bind(epr.member, epr.member)
      .run();

    await db
      .prepare(
        `INSERT INTO station_snapshots (
          request_number, station_code, station_name, response_date, response_date_display,
          response_code, response_description, comment
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(request_number, station_code) DO UPDATE SET
          station_name = excluded.station_name,
          response_date = excluded.response_date,
          response_date_display = excluded.response_date_display,
          response_code = excluded.response_code,
          response_description = excluded.response_description,
          comment = excluded.comment,
          scraped_at = datetime('now')`,
      )
      .bind(
        requestNumber,
        epr.member,
        epr.member,
        responseDate,
        responseDate,
        responseCode,
        epr.description ?? null,
        epr.comments ?? null,
      )
      .run();
  }

  await db
    .prepare(
      `INSERT INTO posr_fetches (ticket_base, trail_id, is_successful, validation_errors, raw_payload)
       VALUES (?, NULL, 1, NULL, ?)`,
    )
    .bind(ticketBase, rawPayload ?? null)
    .run();

  await recomputeTimeliness(db, ticketBase);
}

async function ensureRevisionExists(
  db: D1Database,
  requestNumber: string,
  ticketBase: string,
  revision: number,
): Promise<void> {
  await db
    .prepare(
      `INSERT OR IGNORE INTO ticket_revisions (request_number, ticket_base, revision, is_current)
       VALUES (?, ?, ?, 0)`,
    )
    .bind(requestNumber, ticketBase, revision)
    .run();
}

async function upsertRevision(
  db: D1Database,
  requestNumber: string,
  ticketBase: string,
  revision: number,
  ticket: NonNullable<PosrSearchToolResponse['posrTicket']>,
  isCurrent: boolean,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO ticket_revisions (
        request_number, ticket_base, revision,
        job_start_at, job_start_display, work_expiration_at, work_expiration_display,
        address, map_link, work_type, work_activity, excavation_method,
        street_sidewalk_or_parkstrip, additional_remarks, is_cancelled, job_status, is_current, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(request_number) DO UPDATE SET
        job_start_at = excluded.job_start_at,
        job_start_display = excluded.job_start_display,
        work_expiration_at = excluded.work_expiration_at,
        work_expiration_display = excluded.work_expiration_display,
        address = excluded.address,
        map_link = excluded.map_link,
        work_type = excluded.work_type,
        work_activity = excluded.work_activity,
        excavation_method = excluded.excavation_method,
        street_sidewalk_or_parkstrip = excluded.street_sidewalk_or_parkstrip,
        additional_remarks = excluded.additional_remarks,
        is_cancelled = excluded.is_cancelled,
        job_status = excluded.job_status,
        is_current = excluded.is_current,
        updated_at = datetime('now')`,
    )
    .bind(
      requestNumber,
      ticketBase,
      revision,
      ticket.jobStartDate ?? null,
      ticket.jobStartDateString ?? null,
      ticket.workExpirationDate ?? null,
      ticket.workExpirationDateString ?? null,
      ticket.address ?? null,
      ticket.mapLink ?? null,
      ticket.workType ?? null,
      ticket.workActivity ?? null,
      ticket.excavationMethod ?? null,
      ticket.streetSidewalkOrParkstrip ?? 0,
      ticket.additionalRemarks ?? null,
      ticket.isCancelled ? 1 : 0,
      ticket.jobStatus ?? null,
      isCurrent ? 1 : 0,
    )
    .run();
}

export async function upsertPolygon(
  db: D1Database,
  requestNumber: string,
  ticketBase: string,
  geojson: string,
  bbox: { minLat: number; maxLat: number; minLon: number; maxLon: number } | null,
  mapHtml: string | null,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO ticket_polygons (
        request_number, ticket_base, geojson,
        bbox_min_lat, bbox_max_lat, bbox_min_lon, bbox_max_lon, map_html, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(request_number) DO UPDATE SET
        geojson = excluded.geojson,
        bbox_min_lat = excluded.bbox_min_lat,
        bbox_max_lat = excluded.bbox_max_lat,
        bbox_min_lon = excluded.bbox_min_lon,
        bbox_max_lon = excluded.bbox_max_lon,
        map_html = excluded.map_html,
        updated_at = datetime('now')`,
    )
    .bind(
      requestNumber,
      ticketBase,
      geojson,
      bbox?.minLat ?? null,
      bbox?.maxLat ?? null,
      bbox?.minLon ?? null,
      bbox?.maxLon ?? null,
      mapHtml,
    )
    .run();
}

export async function recomputeTimeliness(db: D1Database, ticketBase?: string): Promise<void> {
  if (ticketBase) {
    await db
      .prepare(
        `DELETE FROM station_timeliness
         WHERE request_number IN (SELECT request_number FROM ticket_revisions WHERE ticket_base = ?)`,
      )
      .bind(ticketBase)
      .run();

    await db
      .prepare(
        `INSERT INTO station_timeliness (
          request_number, station_code, timeliness_status,
          first_late_trigger_at, first_acceptable_at, computed_at
        )
        SELECT request_number, station_code, timeliness_status,
               first_late_trigger_at, first_acceptable_at, datetime('now')
        FROM v_station_timeliness vst
        WHERE EXISTS (
          SELECT 1 FROM ticket_revisions tr
          WHERE tr.request_number = vst.request_number AND tr.ticket_base = ?
        )`,
      )
      .bind(ticketBase)
      .run();
  } else {
    await db.prepare(`DELETE FROM station_timeliness`).run();
    await db
      .prepare(
        `INSERT INTO station_timeliness (
          request_number, station_code, timeliness_status,
          first_late_trigger_at, first_acceptable_at, computed_at
        )
        SELECT request_number, station_code, timeliness_status,
               first_late_trigger_at, first_acceptable_at, datetime('now')
        FROM v_station_timeliness`,
      )
      .run();
  }
}
