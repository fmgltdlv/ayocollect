import { computeAnalytics, deriveDigAlertCurrentResponses, listBadges } from '../lib/analytics';
import type { AnalyticsFlags, TicketSystem } from '../types';

type ListParams = {
  ticketNumber?: string;
  startDate?: string;
  endDate?: string;
  minLon?: number;
  minLat?: number;
  maxLon?: number;
  maxLat?: number;
  limit?: number;
};

function tableForSystem(system: TicketSystem): string {
  if (system === 'digalert') return 'dig_alert_tickets';
  if (system === 'usan-ca') return 'usan_ca_tickets';
  return 'usan_nv_tickets';
}

export async function listTickets(db: D1Database, system: TicketSystem, params: ListParams) {
  const table = tableForSystem(system);
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

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = params.limit ?? 100;

  const { results } = await db
    .prepare(`SELECT * FROM ${table} ${where} ORDER BY updated_at DESC LIMIT ?`)
    .bind(...binds, limit)
    .all<Record<string, unknown>>();

  return results ?? [];
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
    const tn = String(row.ticket_number);
    if (system === 'digalert') {
      const rev = String(row.revision ?? '00A');
      const detail = await getDigAlertDetail(db, tn, rev);
      enriched.push({ ...row, badges: detail?.badges ?? { isPending: false, hasBlockers: false, hadLateResponse: !!row.had_late_response } });
    } else {
      const detail = await getUsanDetail(db, system, tn);
      enriched.push({ ...row, badges: detail?.badges ?? { isPending: false, hasBlockers: false, hadLateResponse: !!row.had_late_response } });
    }
  }
  return enriched;
}
