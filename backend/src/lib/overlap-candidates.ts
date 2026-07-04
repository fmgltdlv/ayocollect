import type { TicketSystem } from '../types';

export type TicketRef = {
  system: TicketSystem;
  ticketNumber: string;
  revision?: string | null;
};

export type TicketCandidate = {
  system: TicketSystem;
  ticketNumber: string;
  revision: string | null;
  polygonWkt: string | null;
  bboxMinLon: number;
  bboxMinLat: number;
  bboxMaxLon: number;
  bboxMaxLat: number;
  windowStart: string | null;
  windowEnd: string | null;
  isCancelled?: number | null;
};

export const CANDIDATE_CAP = 200;

function tableForSystem(system: TicketSystem): string {
  if (system === 'digalert') return 'dig_alert_tickets';
  if (system === 'usan-ca') return 'usan_ca_tickets';
  return 'usan_nv_tickets';
}

function digAlertSelect(): string {
  return `ticket_number, revision, polygon_wkt,
    bbox_min_lon, bbox_min_lat, bbox_max_lon, bbox_max_lat,
    completed AS window_start, replace_by_date AS window_end`;
}

function usanSelect(): string {
  return `ticket_number, NULL AS revision, polygon_wkt,
    bbox_min_lon, bbox_min_lat, bbox_max_lon, bbox_max_lat,
    job_start_date AS window_start, work_expiration_date AS window_end,
    is_cancelled`;
}

function mapDigAlertRow(row: Record<string, unknown>): TicketCandidate {
  return {
    system: 'digalert',
    ticketNumber: String(row.ticket_number),
    revision: row.revision ? String(row.revision) : '00A',
    polygonWkt: row.polygon_wkt ? String(row.polygon_wkt) : null,
    bboxMinLon: Number(row.bbox_min_lon),
    bboxMinLat: Number(row.bbox_min_lat),
    bboxMaxLon: Number(row.bbox_max_lon),
    bboxMaxLat: Number(row.bbox_max_lat),
    windowStart: row.window_start ? String(row.window_start) : null,
    windowEnd: row.window_end ? String(row.window_end) : null,
  };
}

function mapUsanRow(system: 'usan-ca' | 'usan-nv', row: Record<string, unknown>): TicketCandidate {
  return {
    system,
    ticketNumber: String(row.ticket_number),
    revision: null,
    polygonWkt: row.polygon_wkt ? String(row.polygon_wkt) : null,
    bboxMinLon: Number(row.bbox_min_lon),
    bboxMinLat: Number(row.bbox_min_lat),
    bboxMaxLon: Number(row.bbox_max_lon),
    bboxMaxLat: Number(row.bbox_max_lat),
    windowStart: row.window_start ? String(row.window_start) : null,
    windowEnd: row.window_end ? String(row.window_end) : null,
    isCancelled: row.is_cancelled != null ? Number(row.is_cancelled) : null,
  };
}

export function workWindowsOverlap(a: TicketCandidate, b: TicketCandidate): boolean {
  if (a.system !== 'digalert' && a.isCancelled) return false;
  if (b.system !== 'digalert' && b.isCancelled) return false;
  if (!a.windowStart || !a.windowEnd || !b.windowStart || !b.windowEnd) return false;
  return a.windowStart <= b.windowEnd && b.windowStart <= a.windowEnd;
}

export function compareTicketRef(a: TicketRef, b: TicketRef): number {
  if (a.system !== b.system) return a.system.localeCompare(b.system);
  if (a.ticketNumber !== b.ticketNumber) return a.ticketNumber.localeCompare(b.ticketNumber);
  const ar = a.revision ?? '';
  const br = b.revision ?? '';
  return ar.localeCompare(br);
}

export function canonicalPair(a: TicketRef, b: TicketRef): [TicketRef, TicketRef] {
  return compareTicketRef(a, b) <= 0 ? [a, b] : [b, a];
}

export async function loadTicketCandidate(
  db: D1Database,
  ref: TicketRef
): Promise<TicketCandidate | null> {
  const table = tableForSystem(ref.system);
  if (ref.system === 'digalert') {
    const row = await db
      .prepare(`SELECT ${digAlertSelect()} FROM ${table} WHERE ticket_number = ? AND revision = ?`)
      .bind(ref.ticketNumber, ref.revision ?? '00A')
      .first<Record<string, unknown>>();
    if (!row || row.bbox_min_lon == null) return null;
    return mapDigAlertRow(row);
  }

  const row = await db
    .prepare(`SELECT ${usanSelect()} FROM ${table} WHERE ticket_number = ?`)
    .bind(ref.ticketNumber)
    .first<Record<string, unknown>>();
  if (!row || row.bbox_min_lon == null) return null;
  return mapUsanRow(ref.system, row);
}

export async function findOverlapCandidates(
  db: D1Database,
  source: TicketCandidate,
  targetSystems: TicketSystem[]
): Promise<TicketCandidate[]> {
  const candidates: TicketCandidate[] = [];

  for (const system of targetSystems) {
    const table = tableForSystem(system);
    const binds: unknown[] = [
      source.bboxMinLon,
      source.bboxMaxLon,
      source.bboxMinLat,
      source.bboxMaxLat,
    ];

    let exclude = '';
    if (system === source.system) {
      if (system === 'digalert') {
        exclude = 'AND NOT (ticket_number = ? AND revision = ?)';
        binds.push(source.ticketNumber, source.revision ?? '00A');
      } else {
        exclude = 'AND ticket_number != ?';
        binds.push(source.ticketNumber);
      }
    }

    let temporal = '';
    if (source.windowStart && source.windowEnd) {
      if (system === 'digalert') {
        temporal = `AND replace_by_date >= ? AND completed <= ?`;
        binds.push(source.windowStart, source.windowEnd);
      } else {
        temporal = `AND (is_cancelled = 0 OR is_cancelled IS NULL)
          AND work_expiration_date >= ? AND job_start_date <= ?`;
        binds.push(source.windowStart, source.windowEnd);
      }
    }

    const select = system === 'digalert' ? digAlertSelect() : usanSelect();
    const sql = `SELECT ${select} FROM ${table}
      WHERE bbox_min_lon IS NOT NULL
        AND bbox_max_lon >= ? AND bbox_min_lon <= ?
        AND bbox_max_lat >= ? AND bbox_min_lat <= ?
        ${exclude}
        ${temporal}
      LIMIT ${CANDIDATE_CAP}`;

    const { results } = await db.prepare(sql).bind(...binds).all<Record<string, unknown>>();
    for (const row of results ?? []) {
      candidates.push(system === 'digalert' ? mapDigAlertRow(row) : mapUsanRow(system, row));
    }
  }

  return candidates;
}

export async function listTicketsForRebuild(
  db: D1Database,
  system: TicketSystem,
  limit: number,
  offset: number
): Promise<TicketRef[]> {
  const table = tableForSystem(system);
  if (system === 'digalert') {
    const { results } = await db
      .prepare(
        `SELECT ticket_number, revision FROM ${table}
         WHERE bbox_min_lon IS NOT NULL
         ORDER BY updated_at DESC LIMIT ? OFFSET ?`
      )
      .bind(limit, offset)
      .all<{ ticket_number: string; revision: string }>();
    return (results ?? []).map((r) => ({
      system,
      ticketNumber: r.ticket_number,
      revision: r.revision ?? '00A',
    }));
  }

  const { results } = await db
    .prepare(
      `SELECT ticket_number FROM ${table}
       WHERE bbox_min_lon IS NOT NULL
       ORDER BY updated_at DESC LIMIT ? OFFSET ?`
    )
    .bind(limit, offset)
    .all<{ ticket_number: string }>();
  return (results ?? []).map((r) => ({ system, ticketNumber: r.ticket_number, revision: null }));
}
