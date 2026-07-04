import { computeAnalytics, deriveDigAlertCurrentResponses, listBadges } from '../lib/analytics';
import { BLOCKER_CODES, SENTINEL_DATE, PENDING_CODE, type AnalyticsFlags, type TicketSystem } from '../types';

export type BadgeFilter = 'pending' | 'blocker' | 'late';

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

const BROWSE_PAGE_SIZE = 30;

function tableForSystem(system: TicketSystem): string {
  if (system === 'digalert') return 'dig_alert_tickets';
  if (system === 'usan-ca') return 'usan_ca_tickets';
  return 'usan_nv_tickets';
}

function digAlertCurrentResponseExists(codeCondition: string): string {
  return `EXISTS (
    SELECT 1 FROM dig_alert_responses r
    WHERE r.ticket_number = dig_alert_tickets.ticket_number
      AND r.revision = dig_alert_tickets.revision
      AND r.responded_at >= '${SENTINEL_DATE}'
      AND (${codeCondition})
      AND NOT EXISTS (
        SELECT 1 FROM dig_alert_responses r2
        WHERE r2.ticket_number = r.ticket_number
          AND r2.revision = r.revision
          AND r2.utility_code = r.utility_code
          AND r2.responded_at >= '${SENTINEL_DATE}'
          AND r2.responded_at > r.responded_at
      )
  )`;
}

function usanStationExists(system: 'usan-ca' | 'usan-nv', codeCondition: string): string {
  const prefix = system === 'usan-ca' ? 'usan_ca' : 'usan_nv';
  return `EXISTS (
    SELECT 1 FROM ${prefix}_stations s
    WHERE s.ticket_number = ${prefix}_tickets.ticket_number
      AND (${codeCondition})
  )`;
}

function buildBadgeCondition(system: TicketSystem, badge: BadgeFilter): string {
  if (badge === 'late') {
    return 'had_late_response = 1';
  }
  if (badge === 'pending') {
    if (system === 'digalert') {
      return digAlertCurrentResponseExists(`r.response_code = '${PENDING_CODE}'`);
    }
    return usanStationExists(system, `s.response_code = '${PENDING_CODE}'`);
  }
  const blockerList = [...BLOCKER_CODES].map((c) => `'${c}'`).join(', ');
  if (system === 'digalert') {
    return digAlertCurrentResponseExists(`r.response_code IN (${blockerList})`);
  }
  return usanStationExists(system, `s.response_code IN (${blockerList})`);
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

  const { results } = await db
    .prepare(`SELECT * FROM ${table} ${where} ORDER BY updated_at DESC LIMIT ? OFFSET ?`)
    .bind(...binds, limit, offset)
    .all<Record<string, unknown>>();

  return results ?? [];
}

function unionSelect(system: TicketSystem): string {
  const table = tableForSystem(system);
  if (system === 'digalert') {
    return `SELECT 'digalert' AS system, ticket_number, revision, updated_at,
      place, street, location, work_type, NULL AS address, NULL AS work_activity, had_late_response,
      polygon_wkt, centroid_x, centroid_y
      FROM ${table}`;
  }
  return `SELECT '${system}' AS system, ticket_number, NULL AS revision, updated_at,
    NULL AS place, NULL AS street, NULL AS location, work_type, address, work_activity, had_late_response,
    polygon_wkt, NULL AS centroid_x, NULL AS centroid_y
    FROM ${table}`;
}

export async function listTicketsMulti(db: D1Database, systems: TicketSystem[], params: ListParams) {
  const selected = systems.length ? systems : (['digalert', 'usan-ca', 'usan-nv'] as TicketSystem[]);
  const limit = params.limit ?? BROWSE_PAGE_SIZE;
  const offset = params.offset ?? 0;

  let total = 0;
  for (const system of selected) {
    total += await countTickets(db, system, params);
  }

  if (!total) {
    return { tickets: [], total, limit, offset };
  }

  const parts: string[] = [];
  const binds: unknown[] = [];
  for (const system of selected) {
    const { where, binds: systemBinds } = buildListConditions(system, params);
    parts.push(`${unionSelect(system)} ${where}`);
    binds.push(...systemBinds);
  }

  const sql = `SELECT * FROM (${parts.join(' UNION ALL ')}) ORDER BY updated_at DESC LIMIT ? OFFSET ?`;
  const { results } = await db
    .prepare(sql)
    .bind(...binds, limit, offset)
    .all<Record<string, unknown>>();

  return { tickets: results ?? [], total, limit, offset };
}

export async function getDigAlertDetail(db: D1Database, ticketNumber: string, revision = '00A') {
  const ticket = await db
    .prepare('SELECT * FROM dig_alert_tickets WHERE ticket_number = ? AND revision = ?')
    .bind(ticketNumber, revision)
    .first<Record<string, unknown>>();

  if (!ticket) return null;

  const { results: responsesAll } = await db
    .prepare('SELECT * FROM dig_alert_responses WHERE ticket_number = ? AND revision = ?')
    .bind(ticketNumber, revision)
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

  return {
    ticket,
    responsesCurrent,
    responsesAll: responsesAll ?? [],
    revisions: revisions ?? [],
    analytics,
    badges: listBadges(analytics),
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
    .prepare(`SELECT * FROM ${prefix}_stations WHERE ticket_number = ?`)
    .bind(ticketNumber)
    .all<Record<string, unknown>>();

  const { results: ticketHistory } = await db
    .prepare(`SELECT * FROM ${prefix}_ticket_history WHERE ticket_number = ?`)
    .bind(ticketNumber)
    .all<Record<string, unknown>>();

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

  return {
    ticket,
    stations: stations ?? [],
    ticketHistory: ticketHistory ?? [],
    analytics,
    badges: listBadges(analytics),
  };
}

export async function enrichListWithBadges(
  db: D1Database,
  system: TicketSystem,
  rows: Record<string, unknown>[]
) {
  const enriched = [];
  for (const row of rows) {
    const rowSystem = (row.system as TicketSystem | undefined) ?? system;
    const tn = String(row.ticket_number);
    if (rowSystem === 'digalert') {
      const rev = String(row.revision ?? '00A');
      const detail = await getDigAlertDetail(db, tn, rev);
      enriched.push({
        ...row,
        system: rowSystem,
        badges: detail?.badges ?? { isPending: false, hasBlockers: false, hadLateResponse: !!row.had_late_response },
      });
    } else {
      const detail = await getUsanDetail(db, rowSystem, tn);
      enriched.push({
        ...row,
        system: rowSystem,
        badges: detail?.badges ?? { isPending: false, hasBlockers: false, hadLateResponse: !!row.had_late_response },
      });
    }
  }
  return enriched;
}
