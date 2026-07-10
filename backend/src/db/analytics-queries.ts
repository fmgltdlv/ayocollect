import { badgeCountSql, buildBadgeCondition, type BadgeFilter } from './badge-sql';
import { buildListConditions, countTickets, type BrowseListParams } from './queries';
import { findOverlapsInArea } from '../lib/overlaps';
import { loadTicketCandidatesWithFilters } from '../lib/overlap-load';
import type { TicketSystem } from '../types';

export type AreaAnalyticsParams = BrowseListParams & {
  systems: TicketSystem[];
};

export const MAX_AREA_TICKETS = 400;

export type AnalyticsParams = {
  startDate?: string;
  endDate?: string;
  systems?: TicketSystem[];
};

const ALL_SYSTEMS: TicketSystem[] = ['digalert', 'usan-ca', 'usan-nv'];

function tableForSystem(system: TicketSystem): string {
  if (system === 'digalert') return 'dig_alert_tickets';
  if (system === 'usan-ca') return 'usan_ca_tickets';
  return 'usan_nv_tickets';
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function activeWhere(system: TicketSystem, today: string): string {
  if (system === 'digalert') {
    return `(completed IS NOT NULL AND replace_by_date IS NOT NULL AND completed <= '${today}T23:59:59' AND replace_by_date >= '${today}')`;
  }
  return `(is_cancelled = 0 OR is_cancelled IS NULL) AND job_start_date IS NOT NULL AND work_expiration_date IS NOT NULL AND job_start_date <= '${today}T23:59:59' AND work_expiration_date >= '${today}'`;
}

function dateRangeWhere(system: TicketSystem, startDate?: string, endDate?: string): string {
  const parts: string[] = [];
  if (system === 'digalert') {
    if (startDate) parts.push(`(completed >= '${startDate}' OR replace_by_date >= '${startDate}')`);
    if (endDate) parts.push(`(completed <= '${endDate}T23:59:59' OR replace_by_date <= '${endDate}T23:59:59')`);
  } else {
    if (startDate) parts.push(`job_start_date >= '${startDate}'`);
    if (endDate) parts.push(`work_expiration_date <= '${endDate}T23:59:59'`);
  }
  return parts.join(' AND ');
}

async function countWhere(db: D1Database, sql: string, ...binds: unknown[]): Promise<number> {
  const row = await db.prepare(sql).bind(...binds).first<{ n: number }>();
  return row?.n ?? 0;
}

async function systemKpis(db: D1Database, system: TicketSystem, today: string) {
  const table = tableForSystem(system);
  const total = await countWhere(db, `SELECT COUNT(*) AS n FROM ${table}`);
  const active = await countWhere(db, `SELECT COUNT(*) AS n FROM ${table} WHERE ${activeWhere(system, today)}`);
  const badges: Record<BadgeFilter, number> = {
    pending: await countWhere(db, badgeCountSql(system, 'pending', activeWhere(system, today))),
    blocker: await countWhere(db, badgeCountSql(system, 'blocker', activeWhere(system, today))),
    late: await countWhere(db, badgeCountSql(system, 'late', activeWhere(system, today))),
  };
  return { system, total, active, badges };
}

export async function getGlobalKpis(db: D1Database) {
  const today = todayIso();
  const bySystem = [];
  let totals = { total: 0, active: 0, pending: 0, blockers: 0, late: 0 };

  for (const system of ALL_SYSTEMS) {
    const row = await systemKpis(db, system, today);
    bySystem.push(row);
    totals.total += row.total;
    totals.active += row.active;
    totals.pending += row.badges.pending;
    totals.blockers += row.badges.blocker;
    totals.late += row.badges.late;
  }

  return { today, totals, bySystem };
}

export async function getAnalyticsStatsBundle(db: D1Database, params: AnalyticsParams = {}) {
  const [summary, trends] = await Promise.all([
    getAnalyticsSummary(db, params),
    getAnalyticsTrends(db, 30, params.systems),
  ]);
  return { summary, trends };
}

async function systemCounts(db: D1Database, system: TicketSystem, today: string, params: AnalyticsParams) {
  const table = tableForSystem(system);
  const total = await countWhere(db, `SELECT COUNT(*) AS n FROM ${table}`);
  const active = await countWhere(db, `SELECT COUNT(*) AS n FROM ${table} WHERE ${activeWhere(system, today)}`);
  const withPolygon = await countWhere(
    db,
    `SELECT COUNT(*) AS n FROM ${table} WHERE polygon_wkt IS NOT NULL AND polygon_wkt != ''`
  );

  const dateWhere = dateRangeWhere(system, params.startDate, params.endDate);
  const rangeTotal = dateWhere
    ? await countWhere(db, `SELECT COUNT(*) AS n FROM ${table} WHERE ${dateWhere}`)
    : total;

  const badges: Record<BadgeFilter, number> = {
    pending: await countWhere(db, badgeCountSql(system, 'pending', activeWhere(system, today))),
    blocker: await countWhere(db, badgeCountSql(system, 'blocker', activeWhere(system, today))),
    late: await countWhere(db, badgeCountSql(system, 'late', activeWhere(system, today))),
  };

  const { results: workTypes } = await db
    .prepare(
      `SELECT work_type AS label, COUNT(*) AS count FROM ${table}
       WHERE work_type IS NOT NULL AND work_type != ''
       GROUP BY work_type ORDER BY count DESC LIMIT 10`
    )
    .all<{ label: string; count: number }>();

  let geography: { label: string; count: number }[] = [];
  if (system === 'digalert') {
    const { results } = await db
      .prepare(
        `SELECT COALESCE(place, county, 'Unknown') AS label, COUNT(*) AS count FROM ${table}
         GROUP BY label ORDER BY count DESC LIMIT 10`
      )
      .all<{ label: string; count: number }>();
    geography = results ?? [];
  }

  const fetchStatus: Record<string, number> = {};
  if (system !== 'digalert') {
    const { results: statusRows } = await db
      .prepare(`SELECT COALESCE(fetch_status, 'unknown') AS status, COUNT(*) AS count FROM ${table} GROUP BY status`)
      .all<{ status: string; count: number }>();
    for (const row of statusRows ?? []) {
      fetchStatus[row.status] = row.count;
    }
  }

  return {
    system,
    total,
    active,
    rangeTotal,
    withPolygon,
    geometryCoveragePct: total ? Math.round((withPolygon / total) * 1000) / 10 : 0,
    badges,
    workTypes: workTypes ?? [],
    geography,
    fetchStatus,
  };
}

export async function getAnalyticsSummary(db: D1Database, params: AnalyticsParams = {}) {
  const systems = params.systems?.length ? params.systems : ALL_SYSTEMS;
  const today = todayIso();
  const bySystem = [];
  let totals = { total: 0, active: 0, pending: 0, blockers: 0, late: 0, withPolygon: 0 };

  for (const system of systems) {
    const row = await systemCounts(db, system, today, params);
    bySystem.push(row);
    totals.total += row.total;
    totals.active += row.active;
    totals.pending += row.badges.pending;
    totals.blockers += row.badges.blocker;
    totals.late += row.badges.late;
    totals.withPolygon += row.withPolygon;
  }

  const recentJobs = await db
    .prepare(
      `SELECT id, status, error_count, last_error, created_at, updated_at FROM fetch_jobs
       ORDER BY updated_at DESC LIMIT 5`
    )
    .all<Record<string, unknown>>();

  let overlapCount = 0;
  let concurrentOverlapCount = 0;
  try {
    overlapCount = await countWhere(db, 'SELECT COUNT(*) AS n FROM ticket_overlaps');
    concurrentOverlapCount = await countWhere(db, 'SELECT COUNT(*) AS n FROM ticket_overlaps WHERE concurrent = 1');
  } catch {
    /* table may not exist */
  }

  return {
    today,
    totals: {
      ...totals,
      geometryCoveragePct: totals.total ? Math.round((totals.withPolygon / totals.total) * 1000) / 10 : 0,
    },
    bySystem,
    ingestHealth: {
      recentJobs: recentJobs.results ?? [],
    },
    overlaps: {
      total: overlapCount,
      concurrent: concurrentOverlapCount,
    },
  };
}

export async function getAnalyticsTrends(db: D1Database, days = 30, systems?: TicketSystem[]) {
  const selected = systems?.length ? systems : ALL_SYSTEMS;
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - days);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  const byDate = new Map<string, Record<string, number>>();

  for (const system of selected) {
    const table = tableForSystem(system);
    const { results } = await db
      .prepare(
        `SELECT date(updated_at) AS day, COUNT(*) AS count FROM ${table}
         WHERE updated_at >= ? GROUP BY day ORDER BY day ASC`
      )
      .bind(cutoffStr)
      .all<{ day: string; count: number }>();

    for (const row of results ?? []) {
      const entry = byDate.get(row.day) ?? {};
      entry[system] = row.count;
      byDate.set(row.day, entry);
    }
  }

  const trend = [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, counts]) => ({ date, ...counts }));

  return { days, cutoff: cutoffStr, trend };
}

export type OverlapHotspot = {
  system: string;
  ticketNumber: string;
  revision: string | null;
  overlapCount: number;
  concurrentCount: number;
  centroidLat?: number | null;
  centroidLon?: number | null;
};

export async function getOverlapHotspots(
  db: D1Database,
  opts: { concurrent?: boolean; limit?: number } = {}
): Promise<{ hotspots: OverlapHotspot[] }> {
  const limit = opts.limit ?? 20;
  const concurrentOnly = opts.concurrent ? 'WHERE concurrent = 1' : '';

  const { results } = await db
    .prepare(
      `SELECT system, ticket_number, revision,
              COUNT(*) AS overlap_count,
              SUM(concurrent) AS concurrent_count
       FROM (
         SELECT a_system AS system, a_number AS ticket_number, a_revision AS revision, concurrent
         FROM ticket_overlaps ${concurrentOnly}
         UNION ALL
         SELECT b_system, b_number, b_revision, concurrent
         FROM ticket_overlaps ${concurrentOnly}
       )
       GROUP BY system, ticket_number, revision
       ORDER BY overlap_count DESC
       LIMIT ?`
    )
    .bind(limit)
    .all<{ system: string; ticket_number: string; revision: string | null; overlap_count: number; concurrent_count: number }>();

  const hotspots: OverlapHotspot[] = [];

  for (const row of results ?? []) {
    const h: OverlapHotspot = {
      system: row.system,
      ticketNumber: row.ticket_number,
      revision: row.revision,
      overlapCount: row.overlap_count,
      concurrentCount: row.concurrent_count,
    };

    const table = tableForSystem(row.system as TicketSystem);
    if (row.system === 'digalert') {
      const t = await db
        .prepare(`SELECT centroid_y, centroid_x, polygon_wkt FROM ${table} WHERE ticket_number = ? AND revision = ?`)
        .bind(row.ticket_number, row.revision ?? '00A')
        .first<{ centroid_y: number | null; centroid_x: number | null; polygon_wkt: string | null }>();
      h.centroidLat = t?.centroid_y ?? null;
      h.centroidLon = t?.centroid_x ?? null;
      if (!h.centroidLat && t?.polygon_wkt) {
        const m = t.polygon_wkt.match(/POLYGON\s*\(\(([^)]+)\)\)/i);
        if (m) {
          const first = m[1].split(',')[0].trim().split(/\s+/);
          if (first.length >= 2) {
            h.centroidLon = parseFloat(first[0]);
            h.centroidLat = parseFloat(first[1]);
          }
        }
      }
    } else {
      const t = await db
        .prepare(`SELECT bbox_min_lat, bbox_min_lon, bbox_max_lat, bbox_max_lon FROM ${table} WHERE ticket_number = ?`)
        .bind(row.ticket_number)
        .first<{ bbox_min_lat: number | null; bbox_min_lon: number | null; bbox_max_lat: number | null; bbox_max_lon: number | null }>();
      if (t?.bbox_min_lat != null && t?.bbox_max_lat != null && t.bbox_min_lon != null && t.bbox_max_lon != null) {
        h.centroidLat = (t.bbox_min_lat + t.bbox_max_lat) / 2;
        h.centroidLon = (t.bbox_min_lon + t.bbox_max_lon) / 2;
      }
    }

    hotspots.push(h);
  }

  return { hotspots };
}

function mergeFilterWhere(system: TicketSystem, params: BrowseListParams, extra: string[] = []) {
  const { where, binds } = buildListConditions(system, params);
  const base = where ? where.replace(/^WHERE\s+/, '') : '';
  const parts = [...(base ? [base] : []), ...extra.filter(Boolean)];
  return {
    where: parts.length ? `WHERE ${parts.join(' AND ')}` : '',
    binds,
  };
}

async function countFiltered(
  db: D1Database,
  system: TicketSystem,
  params: BrowseListParams,
  extra: string[] = []
): Promise<number> {
  const table = tableForSystem(system);
  const { where, binds } = mergeFilterWhere(system, params, extra);
  const row = await db.prepare(`SELECT COUNT(*) AS n FROM ${table} ${where}`).bind(...binds).first<{ n: number }>();
  return row?.n ?? 0;
}

async function areaSystemKpis(
  db: D1Database,
  system: TicketSystem,
  today: string,
  params: BrowseListParams
) {
  const activeExtra = activeWhere(system, today);
  const badges: Record<BadgeFilter, number> = {
    pending: await countFiltered(db, system, params, [
      activeExtra,
      buildBadgeCondition(system, 'pending'),
    ]),
    blocker: await countFiltered(db, system, params, [
      activeExtra,
      buildBadgeCondition(system, 'blocker'),
    ]),
    late: await countFiltered(db, system, params, [buildBadgeCondition(system, 'late')]),
  };
  return {
    system,
    total: await countTickets(db, system, params),
    active: await countFiltered(db, system, params, [activeExtra]),
    badges,
  };
}

export async function getAreaAnalytics(
  db: D1Database,
  params: AreaAnalyticsParams,
  opts: { limit?: number; bboxOnly?: boolean } = {}
) {
  const systems = params.systems.length ? params.systems : ALL_SYSTEMS;
  if (
    params.minLon === undefined ||
    params.minLat === undefined ||
    params.maxLon === undefined ||
    params.maxLat === undefined
  ) {
    throw new Error('minLon, minLat, maxLon, maxLat required');
  }

  const ticketCount = (
    await Promise.all(systems.map((system) => countTickets(db, system, params)))
  ).reduce((sum, n) => sum + n, 0);

  if (ticketCount > MAX_AREA_TICKETS) {
    const err = new Error(
      `Area contains ${ticketCount} tickets — draw a smaller rectangle (max ${MAX_AREA_TICKETS}).`
    ) as Error & { ticketCount: number; code: string };
    err.ticketCount = ticketCount;
    err.code = 'AREA_TOO_LARGE';
    throw err;
  }

  const today = todayIso();
  const bySystem = await Promise.all(systems.map((system) => areaSystemKpis(db, system, today, params)));

  let totals = { total: 0, active: 0, pending: 0, blockers: 0, late: 0 };
  for (const row of bySystem) {
    totals.total += row.total;
    totals.active += row.active;
    totals.pending += row.badges.pending;
    totals.blockers += row.badges.blocker;
    totals.late += row.badges.late;
  }

  const candidates = await loadTicketCandidatesWithFilters(db, systems, params, MAX_AREA_TICKETS + 1);
  const overlapResult = findOverlapsInArea(candidates, {
    limit: opts.limit ?? 20,
    bboxOnly: opts.bboxOnly ?? true,
  });

  return {
    today,
    ticketCount,
    totals,
    bySystem,
    overlaps: overlapResult,
  };
}
