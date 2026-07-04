import { buildBadgeCondition, type BadgeFilter } from './badge-sql';
import { enrichRowsWithBadges } from './list-badges';
import { computeAnalytics, deriveDigAlertCurrentResponses, listBadges } from '../lib/analytics';
import { countOverlapsForTicket, listOverlapsForTicket } from '../lib/overlaps';
import { enrichUsanHistoryRow } from '../lib/usan-ticket';
import { type TicketSystem } from '../types';

type ListParams = {
  ticketNumber?: string;
  startDate?: string;
  endDate?: string;
  minLon?: number;
  minLat?: number;
  maxLon?: number;
  maxLat?: number;
  limit?: number;
  offset?: number;
  badges?: BadgeFilter[];
};

export type { BadgeFilter } from './badge-sql';

function tableForSystem(system: TicketSystem): string {
  if (system === 'digalert') return 'dig_alert_tickets';
  if (system === 'usan-ca') return 'usan_ca_tickets';
  return 'usan_nv_tickets';
}

const BROWSE_PAGE_SIZE = 100;

const DIGALERT_LIST_COLUMNS = [
  'id',
  'ticket_number',
  'revision',
  'place',
  'street',
  'work_type',
  'location',
  'centroid_x',
  'centroid_y',
  'bbox_min_lon',
  'bbox_min_lat',
  'bbox_max_lon',
  'bbox_max_lat',
  'had_late_response',
  'updated_at',
  'completed',
  'replace_by_date',
].join(', ');

const USAN_LIST_COLUMNS = [
  'id',
  'ticket_number',
  'address',
  'work_type',
  'work_activity',
  'bbox_min_lon',
  'bbox_min_lat',
  'bbox_max_lon',
  'bbox_max_lat',
  'had_late_response',
  'updated_at',
  'job_start_date',
  'work_expiration_date',
].join(', ');

function listColumnsForSystem(system: TicketSystem): string {
  return system === 'digalert' ? DIGALERT_LIST_COLUMNS : USAN_LIST_COLUMNS;
}

function perSystemPageLimits(pageSize: number, systemCount: number): number[] {
  const base = Math.floor(pageSize / systemCount);
  const extra = pageSize % systemCount;
  return Array.from({ length: systemCount }, (_, i) => base + (i < extra ? 1 : 0));
}

function buildBadgeConditions(system: TicketSystem, badges?: BadgeFilter[]) {
  if (!badges?.length) return [];
  const parts = badges.map((badge) => buildBadgeCondition(system, badge));
  return [`(${parts.join(' OR ')})`];
}

function buildListConditions(system: TicketSystem, params: ListParams) {
  const conditions: string[] = [];
  const binds: unknown[] = [];

  if (params.ticketNumber) {
    conditions.push('ticket_number LIKE ?');
    binds.push(`%${params.ticketNumber}%`);
  }

  if (system === 'digalert') {
    if (params.startDate) {
      conditions.push('(completed >= ? OR replace_by_date >= ?)');
      binds.push(params.startDate, params.startDate);
    }
    if (params.endDate) {
      conditions.push('(completed <= ? OR replace_by_date <= ?)');
      binds.push(params.endDate + 'T23:59:59', params.endDate + 'T23:59:59');
    }
  } else {
    if (params.startDate) {
      conditions.push('job_start_date >= ?');
      binds.push(params.startDate);
    }
    if (params.endDate) {
      conditions.push('work_expiration_date <= ?');
      binds.push(params.endDate + 'T23:59:59');
    }
  }

  if (
    params.minLon !== undefined &&
    params.minLat !== undefined &&
    params.maxLon !== undefined &&
    params.maxLat !== undefined
  ) {
    conditions.push(
      'bbox_max_lon >= ? AND bbox_min_lon <= ? AND bbox_max_lat >= ? AND bbox_min_lat <= ?'
    );
    binds.push(params.minLon, params.maxLon, params.minLat, params.maxLat);
  }

  conditions.push(...buildBadgeConditions(system, params.badges));

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  return { where, binds };
}

export async function countTickets(db: D1Database, system: TicketSystem, params: ListParams) {
  const table = tableForSystem(system);
  const { where, binds } = buildListConditions(system, params);
  const row = await db
    .prepare(`SELECT COUNT(*) AS n FROM ${table} ${where}`)
    .bind(...binds)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

export async function listTickets(db: D1Database, system: TicketSystem, params: ListParams) {
  const table = tableForSystem(system);
  const { where, binds } = buildListConditions(system, params);
  const limit = params.limit ?? BROWSE_PAGE_SIZE;
  const offset = params.offset ?? 0;

  const columns = listColumnsForSystem(system);
  const { results } = await db
    .prepare(`SELECT ${columns} FROM ${table} ${where} ORDER BY updated_at DESC LIMIT ? OFFSET ?`)
    .bind(...binds, limit, offset)
    .all<Record<string, unknown>>();

  return results ?? [];
}

export async function listTicketsMulti(db: D1Database, systems: TicketSystem[], params: ListParams) {
  const selected = systems.length ? systems : (['digalert', 'usan-ca', 'usan-nv'] as TicketSystem[]);
  const pageSize = params.limit ?? BROWSE_PAGE_SIZE;
  const offset = params.offset ?? 0;
  const page = Math.floor(offset / pageSize);

  const perSystemLimits = perSystemPageLimits(pageSize, selected.length);

  const [counts, rowSets] = await Promise.all([
    Promise.all(selected.map((system) => countTickets(db, system, params))),
    Promise.all(
      selected.map((system, i) =>
        listTickets(db, system, {
          ...params,
          limit: perSystemLimits[i],
          offset: page * perSystemLimits[i],
        })
      )
    ),
  ]);

  const total = counts.reduce((sum, n) => sum + n, 0);
  if (!total) {
    return { tickets: [], total, limit: pageSize, offset };
  }

  const merged: Record<string, unknown>[] = [];
  for (let i = 0; i < selected.length; i++) {
    const system = selected[i];
    for (const row of rowSets[i]) {
      merged.push({ ...row, system });
    }
  }

  merged.sort((a, b) => String(b.updated_at ?? '').localeCompare(String(a.updated_at ?? '')));

  return { tickets: merged.slice(0, pageSize), total, limit: pageSize, offset };
}

export async function getDigAlertDetail(db: D1Database, ticketNumber: string, revision = '00A') {
  const ticket = await db
    .prepare('SELECT * FROM dig_alert_tickets WHERE ticket_number = ? AND revision = ?')
    .bind(ticketNumber, revision)
    .first<Record<string, unknown>>();

  if (!ticket) return null;

  const { results: responsesAll } = await db
    .prepare('SELECT * FROM dig_alert_responses WHERE ticket_id = ?')
    .bind(ticket.id)
    .all<Record<string, unknown>>();

  const { results: revisions } = await db
    .prepare('SELECT * FROM dig_alert_revisions WHERE ticket_number = ?')
    .bind(ticketNumber)
    .all<Record<string, unknown>>();

  const responsesCurrent = deriveDigAlertCurrentResponses(
    (responsesAll ?? []) as Parameters<typeof deriveDigAlertCurrentResponses>[0]
  );

  const analytics = computeAnalytics(
    responsesCurrent,
    !!ticket.had_late_response,
    (responsesAll ?? []).map((r) => r.response_code as string)
  );

  const ref = { system: 'digalert' as const, ticketNumber, revision };
  let overlapCount = 0;
  let overlaps: Awaited<ReturnType<typeof listOverlapsForTicket>> = [];
  try {
    overlapCount = await countOverlapsForTicket(db, ref);
    overlaps = await listOverlapsForTicket(db, ref);
  } catch {
    /* overlaps table may not exist yet */
  }

  return {
    ticket,
    responsesCurrent,
    responsesAll: responsesAll ?? [],
    revisions: revisions ?? [],
    analytics,
    badges: listBadges(analytics),
    overlapCount,
    overlaps,
  };
}

export async function getUsanDetail(db: D1Database, system: 'usan-ca' | 'usan-nv', ticketNumber: string) {
  const prefix = system === 'usan-ca' ? 'usan_ca' : 'usan_nv';

  const ticket = await db
    .prepare(`SELECT * FROM ${prefix}_tickets WHERE ticket_number = ?`)
    .bind(ticketNumber)
    .first<Record<string, unknown>>();

  if (!ticket) return null;

  const { results: stations } = await db
    .prepare(`SELECT * FROM ${prefix}_stations WHERE ticket_id = ?`)
    .bind(ticket.id)
    .all<Record<string, unknown>>();

  const { results: ticketHistoryRaw } = await db
    .prepare(`SELECT * FROM ${prefix}_ticket_history WHERE ticket_id = ?`)
    .bind(ticket.id)
    .all<Record<string, unknown>>();

  const ticketHistory = (ticketHistoryRaw ?? []).map((row) => enrichUsanHistoryRow(ticketNumber, row));

  const current = (stations ?? []).map((s) => ({
    code: String(s.code),
    name: s.name ? String(s.name) : undefined,
    responseCode: String(s.response_code ?? ''),
    responseDescription: s.response_description ? String(s.response_description) : undefined,
    responseDate: s.response_date ? String(s.response_date) : undefined,
    comment: s.comment ? String(s.comment) : undefined,
  }));

  const allCodes = [
    ...(stations ?? []).map((s) => s.response_code as string),
    ...(ticketHistory ?? []).map((h) => h.response_code as string),
  ];

  const analytics = computeAnalytics(current, !!ticket.had_late_response, allCodes);

  const ref = { system, ticketNumber, revision: null };
  let overlapCount = 0;
  let overlaps: Awaited<ReturnType<typeof listOverlapsForTicket>> = [];
  try {
    overlapCount = await countOverlapsForTicket(db, ref);
    overlaps = await listOverlapsForTicket(db, ref);
  } catch {
    /* overlaps table may not exist yet */
  }

  return {
    ticket,
    stations: stations ?? [],
    ticketHistory: ticketHistory ?? [],
    analytics,
    badges: listBadges(analytics),
    overlapCount,
    overlaps,
  };
}

export async function enrichListWithBadges(
  db: D1Database,
  system: TicketSystem,
  rows: Record<string, unknown>[]
) {
  return enrichRowsWithBadges(db, system, rows);
}
