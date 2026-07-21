import { Hono } from 'hono';
import { BROWSE_MAP_PAGE_SIZE, getAnalyticsSummary } from '../db/analytics-queries';
import { getUsanDetail, listTicketsMulti } from '../db/queries';
import type { Env, TicketSystem } from '../types';

type HonoEnv = { Bindings: Env };

const PUBLIC_SYSTEMS: TicketSystem[] = ['usan-nv'];
const PUBLIC_DAY_OPTIONS = [7, 14, 28] as const;
export type PublicDays = (typeof PUBLIC_DAY_OPTIONS)[number];
const PUBLIC_DEFAULT_DAYS: PublicDays = 7;
const PUBLIC_MAX_LIMIT = BROWSE_MAP_PAGE_SIZE;

export function parsePublicDays(raw: string | undefined): PublicDays {
  const days = Number(raw ?? PUBLIC_DEFAULT_DAYS);
  return PUBLIC_DAY_OPTIONS.includes(days as PublicDays) ? (days as PublicDays) : PUBLIC_DEFAULT_DAYS;
}

export function publicDateRange(days: PublicDays = PUBLIC_DEFAULT_DAYS): {
  startDate: string;
  endDate: string;
  days: PublicDays;
} {
  const end = new Date();
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - (days - 1));
  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
    days,
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

function sanitizePublicTicket(ticket: Record<string, unknown>) {
  const { created_by: _createdBy, id: _id, ...rest } = ticket;
  return rest;
}

function sanitizePublicStation(row: Record<string, unknown>) {
  return {
    code: row.code ?? null,
    name: row.name ?? null,
    response_code: row.response_code ?? null,
    response_description: row.response_description ?? null,
    response_date: row.response_date ?? null,
    comment: row.comment ?? null,
  };
}

function sanitizePublicHistory(row: Record<string, unknown>) {
  return {
    response_date: row.response_date ?? row.response_date_string ?? null,
    request_number: row.request_number ?? row.requestNumber ?? row.revision_suffix ?? null,
    code: row.code ?? null,
    name: row.name ?? null,
    response_code: row.response_code ?? null,
    response_description: row.response_description ?? null,
    comment: row.comment ?? null,
  };
}

export const publicRoutes = new Hono<HonoEnv>();

publicRoutes.get('/summary', async (c) => {
  const days = parsePublicDays(c.req.query('days'));
  const range = publicDateRange(days);
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
  const days = parsePublicDays(c.req.query('days'));
  const range = publicDateRange(days);
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

publicRoutes.get('/tickets/:ticketNumber', async (c) => {
  const ticketNumber = c.req.param('ticketNumber').trim();
  if (!ticketNumber) return c.json({ error: 'ticketNumber required' }, 400);

  const detail = await getUsanDetail(c.env.DB, 'usan-nv', ticketNumber);
  if (!detail) return c.json({ error: 'Not found' }, 404);

  c.header('Cache-Control', 'public, max-age=300');
  return c.json({
    system: PUBLIC_SYSTEMS[0],
    ticket: sanitizePublicTicket(detail.ticket as Record<string, unknown>),
    stations: (detail.stations ?? []).map((row) => sanitizePublicStation(row as Record<string, unknown>)),
    ticketHistory: (detail.ticketHistory ?? []).map((row) => sanitizePublicHistory(row as Record<string, unknown>)),
    analytics: detail.analytics,
    badges: detail.badges,
  });
});
