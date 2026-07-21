import { Hono } from 'hono';
import { BROWSE_MAP_PAGE_SIZE, getAnalyticsSummary } from '../db/analytics-queries';
import { listTicketsMulti } from '../db/queries';
import type { Env, TicketSystem } from '../types';

type HonoEnv = { Bindings: Env };

const PUBLIC_SYSTEMS: TicketSystem[] = ['usan-nv'];
const PUBLIC_DAYS = 7;
const PUBLIC_MAX_LIMIT = BROWSE_MAP_PAGE_SIZE;

export function publicLast7Days(): { startDate: string; endDate: string; days: number } {
  const end = new Date();
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - (PUBLIC_DAYS - 1));
  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
    days: PUBLIC_DAYS,
  };
}

type PublicTicketRow = {
  system: TicketSystem;
  ticket_number: string;
  revision?: string;
  centroid_x?: number | null;
  centroid_y?: number | null;
  bbox_min_lon?: number | null;
  bbox_min_lat?: number | null;
  bbox_max_lon?: number | null;
  bbox_max_lat?: number | null;
  work_type?: string | null;
};

function toPublicTicket(row: Record<string, unknown>): PublicTicketRow | null {
  const system = row.system as TicketSystem;
  if (!system || !row.ticket_number) return null;
  return {
    system,
    ticket_number: String(row.ticket_number),
    revision: row.revision != null ? String(row.revision) : undefined,
    centroid_x: row.centroid_x != null ? Number(row.centroid_x) : null,
    centroid_y: row.centroid_y != null ? Number(row.centroid_y) : null,
    bbox_min_lon: row.bbox_min_lon != null ? Number(row.bbox_min_lon) : null,
    bbox_min_lat: row.bbox_min_lat != null ? Number(row.bbox_min_lat) : null,
    bbox_max_lon: row.bbox_max_lon != null ? Number(row.bbox_max_lon) : null,
    bbox_max_lat: row.bbox_max_lat != null ? Number(row.bbox_max_lat) : null,
    work_type: row.work_type != null ? String(row.work_type) : null,
  };
}

function publicSummary(summary: Awaited<ReturnType<typeof getAnalyticsSummary>>) {
  return {
    today: summary.today,
    totals: {
      total: summary.totals.total,
      active: summary.totals.active,
    },
    bySystem: summary.bySystem.map((row) => ({
      system: row.system,
      total: row.total,
      active: row.active,
      rangeTotal: row.rangeTotal,
    })),
  };
}

export const publicRoutes = new Hono<HonoEnv>();

publicRoutes.get('/summary', async (c) => {
  const range = publicLast7Days();
  const summary = await getAnalyticsSummary(c.env.DB, {
    startDate: range.startDate,
    endDate: range.endDate,
    systems: PUBLIC_SYSTEMS,
  });

  c.header('Cache-Control', 'public, max-age=300');
  return c.json({
    system: PUBLIC_SYSTEMS[0],
    range,
    ...publicSummary(summary),
  });
});

publicRoutes.get('/tickets', async (c) => {
  const range = publicLast7Days();
  const limit = Math.min(Math.max(Number(c.req.query('limit') ?? PUBLIC_MAX_LIMIT), 1), PUBLIC_MAX_LIMIT);
  const offset = Math.max(Number(c.req.query('offset') ?? 0), 0);

  const { tickets: rows, total } = await listTicketsMulti(c.env.DB, PUBLIC_SYSTEMS, {
    startDate: range.startDate,
    endDate: range.endDate,
    limit,
    offset,
  });

  const tickets = rows
    .map((row) => toPublicTicket(row as Record<string, unknown>))
    .filter((row): row is PublicTicketRow => row !== null);

  c.header('Cache-Control', 'public, max-age=300');
  return c.json({ system: PUBLIC_SYSTEMS[0], range, tickets, total, limit, offset });
});
