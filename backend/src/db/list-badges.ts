import { computeAnalytics, deriveDigAlertCurrentResponses, listBadges } from '../lib/analytics';
import type { TicketSystem } from '../types';

export type ListBadgeFlags = {
  isPending: boolean;
  hasBlockers: boolean;
  hadLateResponse: boolean;
};

function defaultBadges(row: Record<string, unknown>): ListBadgeFlags {
  return {
    isPending: false,
    hasBlockers: false,
    hadLateResponse: !!row.had_late_response,
  };
}

async function digAlertBadgeMap(
  db: D1Database,
  rows: Record<string, unknown>[]
): Promise<Map<number, ListBadgeFlags>> {
  const map = new Map<number, ListBadgeFlags>();
  if (!rows.length) return map;

  const ids = rows.map((r) => Number(r.id));
  const placeholders = ids.map(() => '?').join(',');
  const { results } = await db
    .prepare(
      `SELECT ticket_id, utility_code, utility_name, response_code, response_description, responded_at, comments
       FROM dig_alert_responses WHERE ticket_id IN (${placeholders})`
    )
    .bind(...ids)
    .all<Record<string, unknown>>();

  const byTicket = new Map<number, Record<string, unknown>[]>();
  for (const row of results ?? []) {
    const ticketId = Number(row.ticket_id);
    const bucket = byTicket.get(ticketId);
    if (bucket) bucket.push(row);
    else byTicket.set(ticketId, [row]);
  }

  for (const row of rows) {
    const ticketId = Number(row.id);
    const responses = byTicket.get(ticketId) ?? [];
    const current = deriveDigAlertCurrentResponses(
      responses as Parameters<typeof deriveDigAlertCurrentResponses>[0]
    );
    const analytics = computeAnalytics(
      current,
      !!row.had_late_response,
      responses.map((r) => r.response_code as string)
    );
    map.set(ticketId, listBadges(analytics));
  }

  return map;
}

async function usanBadgeMap(
  db: D1Database,
  system: 'usan-ca' | 'usan-nv',
  rows: Record<string, unknown>[]
): Promise<Map<number, ListBadgeFlags>> {
  const map = new Map<number, ListBadgeFlags>();
  if (!rows.length) return map;

  const prefix = system === 'usan-ca' ? 'usan_ca' : 'usan_nv';
  const ids = rows.map((r) => Number(r.id));
  const placeholders = ids.map(() => '?').join(',');

  const [stationsResult, historyResult] = await Promise.all([
    db
      .prepare(
        `SELECT ticket_id, code, name, response_code, response_description, response_date, comment
         FROM ${prefix}_stations WHERE ticket_id IN (${placeholders})`
      )
      .bind(...ids)
      .all<Record<string, unknown>>(),
    db
      .prepare(`SELECT ticket_id, response_code FROM ${prefix}_ticket_history WHERE ticket_id IN (${placeholders})`)
      .bind(...ids)
      .all<Record<string, unknown>>(),
  ]);

  const stationsByTicket = new Map<number, Record<string, unknown>[]>();
  for (const row of stationsResult.results ?? []) {
    const ticketId = Number(row.ticket_id);
    const bucket = stationsByTicket.get(ticketId);
    if (bucket) bucket.push(row);
    else stationsByTicket.set(ticketId, [row]);
  }

  const historyByTicket = new Map<number, string[]>();
  for (const row of historyResult.results ?? []) {
    const ticketId = Number(row.ticket_id);
    const code = row.response_code != null ? String(row.response_code) : '';
    const bucket = historyByTicket.get(ticketId);
    if (bucket) bucket.push(code);
    else historyByTicket.set(ticketId, [code]);
  }

  for (const row of rows) {
    const ticketId = Number(row.id);
    const stations = stationsByTicket.get(ticketId) ?? [];
    const current = stations.map((s) => ({
      code: String(s.code),
      name: s.name ? String(s.name) : undefined,
      responseCode: String(s.response_code ?? ''),
      responseDescription: s.response_description ? String(s.response_description) : undefined,
      responseDate: s.response_date ? String(s.response_date) : undefined,
      comment: s.comment ? String(s.comment) : undefined,
    }));
    const allCodes = [
      ...stations.map((s) => s.response_code as string),
      ...(historyByTicket.get(ticketId) ?? []),
    ];
    const analytics = computeAnalytics(current, !!row.had_late_response, allCodes);
    map.set(ticketId, listBadges(analytics));
  }

  return map;
}

export async function loadListBadgesForSystem(
  db: D1Database,
  system: TicketSystem,
  rows: Record<string, unknown>[]
): Promise<Map<number, ListBadgeFlags>> {
  if (system === 'digalert') return digAlertBadgeMap(db, rows);
  return usanBadgeMap(db, system, rows);
}

export async function enrichRowsWithBadges(
  db: D1Database,
  fallbackSystem: TicketSystem,
  rows: Record<string, unknown>[]
): Promise<Record<string, unknown>[]> {
  if (!rows.length) return [];

  const bySystem = new Map<TicketSystem, Record<string, unknown>[]>();
  for (const row of rows) {
    const system = (row.system as TicketSystem | undefined) ?? fallbackSystem;
    const bucket = bySystem.get(system);
    if (bucket) bucket.push(row);
    else bySystem.set(system, [row]);
  }

  const badgeMaps = new Map<number, ListBadgeFlags>();
  await Promise.all(
    [...bySystem.entries()].map(async ([system, systemRows]) => {
      const badges = await loadListBadgesForSystem(db, system, systemRows);
      for (const [id, flags] of badges) badgeMaps.set(id, flags);
    })
  );

  return rows.map((row) => {
    const system = (row.system as TicketSystem | undefined) ?? fallbackSystem;
    const ticketId = Number(row.id);
    return {
      ...row,
      system,
      badges: badgeMaps.get(ticketId) ?? defaultBadges(row),
    };
  });
}
