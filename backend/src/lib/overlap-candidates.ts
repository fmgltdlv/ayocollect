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
  /** Calendar day the ticket was filed (DigAlert: completed, USAN: job_start_date). */
  createdDay: string | null;
  /** Filer identity (DigAlert: caller, USAN: created_by). */
  createdBy: string | null;
  isCancelled?: number | null;
};

export const CANDIDATE_CAP = 200;
export const OVERLAP_MIN_CREATOR_GAP_DAYS = 30;

function tableForSystem(system: TicketSystem): string {
  if (system === 'digalert') return 'dig_alert_tickets';
  if (system === 'usan-ca') return 'usan_ca_tickets';
  return 'usan_nv_tickets';
}

function digAlertSelect(): string {
  return `ticket_number, revision, polygon_wkt,
    bbox_min_lon, bbox_min_lat, bbox_max_lon, bbox_max_lat,
    completed AS window_start, replace_by_date AS window_end,
    date(completed) AS created_day, caller AS created_by`;
}

function usanSelect(): string {
  return `ticket_number, NULL AS revision, polygon_wkt,
    bbox_min_lon, bbox_min_lat, bbox_max_lon, bbox_max_lat,
    job_start_date AS window_start, work_expiration_date AS window_end,
    is_cancelled, date(job_start_date) AS created_day, created_by`;
}

export function mapDigAlertRow(row: Record<string, unknown>): TicketCandidate {
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
    createdDay: row.created_day ? String(row.created_day) : null,
    createdBy: row.created_by ? String(row.created_by) : null,
  };
}

export function mapUsanRow(system: 'usan-ca' | 'usan-nv', row: Record<string, unknown>): TicketCandidate {
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
    createdDay: row.created_day ? String(row.created_day) : null,
    createdBy: row.created_by ? String(row.created_by) : null,
    isCancelled: row.is_cancelled != null ? Number(row.is_cancelled) : null,
  };
}

export function normalizeCreatedBy(value: string | null | undefined): string | null {
  const trimmed = (value ?? '').trim();
  return trimmed ? trimmed.toLowerCase() : null;
}

export function daysBetweenCreatedDays(a: string, b: string): number {
  const msPerDay = 86_400_000;
  const dayA = Date.parse(`${a}T00:00:00Z`);
  const dayB = Date.parse(`${b}T00:00:00Z`);
  if (!Number.isFinite(dayA) || !Number.isFinite(dayB)) return 0;
  return Math.abs(Math.round((dayA - dayB) / msPerDay));
}

/** Count overlap when creators differ, or start dates are more than 30 days apart. */
export function shouldCountAsOverlap(a: TicketCandidate, b: TicketCandidate): boolean {
  if (!a.createdDay || !b.createdDay) return false;

  const byA = normalizeCreatedBy(a.createdBy);
  const byB = normalizeCreatedBy(b.createdBy);
  const gap = daysBetweenCreatedDays(a.createdDay, b.createdDay);

  if (byA && byB) {
    return byA !== byB || gap > OVERLAP_MIN_CREATOR_GAP_DAYS;
  }

  return gap > OVERLAP_MIN_CREATOR_GAP_DAYS;
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

export async function findOverlapCandidatesPage(
  db: D1Database,
  source: TicketCandidate,
  targetSystems: TicketSystem[],
  limit: number,
  offset: number
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
      LIMIT ? OFFSET ?`;
    binds.push(limit, offset);

    const { results } = await db.prepare(sql).bind(...binds).all<Record<string, unknown>>();
    for (const row of results ?? []) {
      candidates.push(system === 'digalert' ? mapDigAlertRow(row) : mapUsanRow(system, row));
    }
  }

  return candidates;
}

export async function findAllOverlapCandidates(
  db: D1Database,
  source: TicketCandidate,
  targetSystems: TicketSystem[]
): Promise<TicketCandidate[]> {
  const pageSize = 500;
  const all: TicketCandidate[] = [];
  const seen = new Set<string>();

  for (const system of targetSystems) {
    let offset = 0;
    for (;;) {
      const page = await findOverlapCandidatesPage(db, source, [system], pageSize, offset);
      if (!page.length) break;
      for (const c of page) {
        const key = ticketRefKey(c.system, c.ticketNumber, c.revision);
        if (!seen.has(key)) {
          seen.add(key);
          all.push(c);
        }
      }
      offset += page.length;
      if (page.length < pageSize) break;
    }
  }

  return all;
}

export async function findOverlapCandidates(
  db: D1Database,
  source: TicketCandidate,
  targetSystems: TicketSystem[]
): Promise<TicketCandidate[]> {
  return findOverlapCandidatesPage(db, source, targetSystems, CANDIDATE_CAP, 0);
}

export async function loadTicketCandidatesBatch(
  db: D1Database,
  refs: TicketRef[]
): Promise<Map<string, TicketCandidate>> {
  const map = new Map<string, TicketCandidate>();
  const digAlert = refs.filter((r) => r.system === 'digalert');
  const usanCa = refs.filter((r) => r.system === 'usan-ca');
  const usanNv = refs.filter((r) => r.system === 'usan-nv');

  const chunkSize = 40;

  for (let i = 0; i < digAlert.length; i += chunkSize) {
    const chunk = digAlert.slice(i, i + chunkSize);
    if (!chunk.length) continue;
    const conditions = chunk.map(() => '(ticket_number = ? AND revision = ?)').join(' OR ');
    const binds = chunk.flatMap((r) => [r.ticketNumber, r.revision ?? '00A']);
    const { results } = await db
      .prepare(
        `SELECT ${digAlertSelect()} FROM dig_alert_tickets
         WHERE bbox_min_lon IS NOT NULL AND (${conditions})`
      )
      .bind(...binds)
      .all<Record<string, unknown>>();
    for (const row of results ?? []) {
      const candidate = mapDigAlertRow(row);
      map.set(ticketRefKey(candidate.system, candidate.ticketNumber, candidate.revision), candidate);
    }
  }

  async function loadUsanBatch(system: 'usan-ca' | 'usan-nv', batch: TicketRef[]) {
    const table = tableForSystem(system);
    for (let i = 0; i < batch.length; i += chunkSize) {
      const chunk = batch.slice(i, i + chunkSize);
      if (!chunk.length) continue;
      const placeholders = chunk.map(() => '?').join(', ');
      const binds = chunk.map((r) => r.ticketNumber);
      const { results } = await db
        .prepare(
          `SELECT ${usanSelect()} FROM ${table}
           WHERE bbox_min_lon IS NOT NULL AND ticket_number IN (${placeholders})`
        )
        .bind(...binds)
        .all<Record<string, unknown>>();
      for (const row of results ?? []) {
        const candidate = mapUsanRow(system, row);
        map.set(ticketRefKey(candidate.system, candidate.ticketNumber, candidate.revision), candidate);
      }
    }
  }

  await loadUsanBatch('usan-ca', usanCa);
  await loadUsanBatch('usan-nv', usanNv);
  return map;
}

export function ticketRefKey(system: TicketSystem, ticketNumber: string, revision: string | null): string {
  return `${system}:${ticketNumber}:${revision ?? ''}`;
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
