import { ALL_SYNC_REGIONS, expandDateRange, formatTodayPacific, isValidDateString, processNextBackfill } from '@ayocollect/posr';
import { isTicketRegion, TICKET_LIST_UNION_SQL, ticketTableForRegion } from '@ayocollect/db';
import type { Env } from './env';

function corsHeaders(): HeadersInit {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: corsHeaders() });
}

export async function handleFetch(request: Request, env: Env): Promise<Response> {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  const url = new URL(request.url);
  const path = url.pathname.replace(/\/$/, '') || '/';

  try {
    if (path === '/health' || path === '/api/health') {
      return json({ ok: true, worker: 'ayocollect' });
    }

    if (path === '/api/sync/status' && request.method === 'GET') {
      const state = await env.DB.prepare(`SELECT * FROM sync_state WHERE id = 1`).first();
      return json({ syncState: state });
    }

    if (path === '/api/sync/backfill' && request.method === 'GET') {
      const runs = await env.DB.prepare(
        `SELECT * FROM backfill_runs ORDER BY target_date DESC LIMIT 100`,
      ).all();
      return json({ runs: runs.results });
    }

    if (path === '/api/sync/backfill/queue-status' && request.method === 'GET') {
      const capturedAt = new Date().toISOString();

      const counts = await env.DB.prepare(
        `SELECT status, COUNT(*) as count FROM backfill_runs GROUP BY status`,
      ).all<{ status: string; count: number }>();

      const countMap = Object.fromEntries(
        (counts.results ?? []).map((row) => [row.status, row.count]),
      );

      const running = await env.DB.prepare(
        `SELECT * FROM backfill_runs WHERE status = 'running' ORDER BY started_at ASC LIMIT 1`,
      ).first();

      const queued = await env.DB.prepare(
        `SELECT * FROM backfill_runs WHERE status = 'queued' ORDER BY target_date ASC, region ASC LIMIT 25`,
      ).all();

      const queuedResults = queued.results ?? [];
      const queue = queuedResults.map((run, index) => ({
        ...(run as Record<string, unknown>),
        queuePosition: index + 1,
      }));

      return json({
        capturedAt,
        active: Boolean(running) || queuedResults.length > 0,
        currentlyRunning: running ?? null,
        queued: queue,
        counts: {
          queued: countMap.queued ?? 0,
          running: countMap.running ?? 0,
          completed: countMap.completed ?? 0,
          failed: countMap.failed ?? 0,
        },
      });
    }

    if (path.startsWith('/api/sync/backfill/') && request.method === 'GET') {
      const date = path.split('/').pop()!;
      const runs = await env.DB.prepare(
        `SELECT * FROM backfill_runs WHERE target_date = ? ORDER BY region`,
      )
        .bind(date)
        .all();
      if (!runs.results?.length) return json({ error: 'Not found' }, 404);
      return json({ runs: runs.results });
    }

    if (path === '/api/sync/backfill' && request.method === 'POST') {
      const body = (await request.json()) as {
        startDate?: string;
        endDate?: string;
        dates?: string[];
        regions?: string[];
      };

      let dates: string[] = [];
      if (body.dates?.length) {
        dates = body.dates;
      } else if (body.startDate && body.endDate) {
        dates = expandDateRange(body.startDate, body.endDate);
      } else {
        return json({ error: 'Provide dates[] or startDate/endDate' }, 400);
      }

      const regions = (body.regions ?? [])
        .map((r) => r.trim().toUpperCase())
        .filter((r) => ALL_SYNC_REGIONS.includes(r as (typeof ALL_SYNC_REGIONS)[number]));

      if (regions.length === 0) {
        return json({ error: 'Select at least one region: NV, CA, or DA' }, 400);
      }

      const today = formatTodayPacific();
      const queuedDates: string[] = [];
      const runIds: number[] = [];

      for (const date of dates) {
        if (!isValidDateString(date)) {
          return json({ error: `Invalid date: ${date}` }, 400);
        }
        if (date >= today) {
          return json({ error: `Date must be in the past: ${date}` }, 400);
        }

        for (const region of regions) {
          const existing = await env.DB.prepare(
            `SELECT id, status FROM backfill_runs WHERE target_date = ? AND region = ?`,
          )
            .bind(date, region)
            .first<{ id: number; status: string }>();

          if (existing?.status === 'completed') continue;

          let runId = existing?.id;
          if (existing) {
            await env.DB.prepare(
              `UPDATE backfill_runs SET status = 'queued', error = NULL, triggered_by = 'dashboard' WHERE id = ?`,
            )
              .bind(existing.id)
              .run();
          } else {
            const result = await env.DB.prepare(
              `INSERT INTO backfill_runs (target_date, region, status, triggered_by) VALUES (?, ?, 'queued', 'dashboard')`,
            )
              .bind(date, region)
              .run();
            runId = Number(result.meta.last_row_id);
          }

          if (runId) {
            runIds.push(runId);
            queuedDates.push(`${date}:${region}`);
          }
        }
      }

      await processNextBackfill(env);

      return json({ runIds, queuedDates }, 202);
    }

    if (path === '/api/tickets' && request.method === 'GET') {
      const q = url.searchParams.get('q') ?? '';
      const regionFilter = url.searchParams.get('region')?.trim().toUpperCase() ?? '';
      const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '50', 10), 200);
      const offset = parseInt(url.searchParams.get('offset') ?? '0', 10);

      const baseSql = isTicketRegion(regionFilter)
        ? `SELECT ticket_base, '${regionFilter}' AS region, created_by, latest_request_number, latest_revision, first_seen_at, last_refreshed_at, refresh_priority
           FROM ${ticketTableForRegion(regionFilter)}`
        : `SELECT * FROM (${TICKET_LIST_UNION_SQL})`;

      const stmt = q
        ? env.DB.prepare(
            `SELECT tb.*, tr.address, tr.job_start_at
             FROM (${baseSql}) tb
             LEFT JOIN ticket_revisions tr
               ON tr.request_number = tb.latest_request_number AND tr.region = tb.region
             WHERE tb.ticket_base LIKE ? OR tb.created_by LIKE ? OR tr.address LIKE ?
             ORDER BY tb.last_refreshed_at DESC
             LIMIT ? OFFSET ?`,
          ).bind(`%${q}%`, `%${q}%`, `%${q}%`, limit, offset)
        : env.DB.prepare(
            `SELECT tb.*, tr.address, tr.job_start_at
             FROM (${baseSql}) tb
             LEFT JOIN ticket_revisions tr
               ON tr.request_number = tb.latest_request_number AND tr.region = tb.region
             ORDER BY tb.last_refreshed_at DESC
             LIMIT ? OFFSET ?`,
          ).bind(limit, offset);

      const tickets = await stmt.all();
      return json({ tickets: tickets.results });
    }

    if (path.startsWith('/api/tickets/') && request.method === 'GET') {
      const parts = path.split('/').filter(Boolean);
      const region = parts[2]?.toUpperCase();
      const ticketBase = parts[3];
      if (!isTicketRegion(region) || !ticketBase) {
        return json({ error: 'Use /api/tickets/:region/:ticketBase with region NV, CA, or DA' }, 400);
      }

      const ticketTable = ticketTableForRegion(region);
      const base = await env.DB.prepare(`SELECT *, ? AS region FROM ${ticketTable} WHERE ticket_base = ?`)
        .bind(region, ticketBase)
        .first();
      if (!base) return json({ error: 'Not found' }, 404);

      const revisions = await env.DB.prepare(
        `SELECT * FROM ticket_revisions WHERE region = ? AND ticket_base = ? ORDER BY revision`,
      )
        .bind(region, ticketBase)
        .all();

      const events = await env.DB.prepare(
        `SELECT re.* FROM response_events re
         JOIN ticket_revisions tr ON tr.request_number = re.request_number
         WHERE tr.region = ? AND tr.ticket_base = ?
         ORDER BY re.response_date`,
      )
        .bind(region, ticketBase)
        .all();

      const timeliness = await env.DB.prepare(
        `SELECT st.* FROM station_timeliness st
         JOIN ticket_revisions tr ON tr.request_number = st.request_number
         WHERE tr.region = ? AND tr.ticket_base = ?`,
      )
        .bind(region, ticketBase)
        .all();

      const polygons = await env.DB.prepare(
        `SELECT request_number, geojson, bbox_min_lat, bbox_max_lat, bbox_min_lon, bbox_max_lon
         FROM ticket_polygons WHERE region = ? AND ticket_base = ?`,
      )
        .bind(region, ticketBase)
        .all();

      return json({
        ticket: base,
        revisions: revisions.results,
        events: events.results,
        timeliness: timeliness.results,
        polygons: polygons.results,
      });
    }

    if (path === '/api/metrics/utilities' && request.method === 'GET') {
      const metrics = await env.DB.prepare(
        `SELECT
           st.station_code,
           COALESCE(us.station_name, st.station_code) as station_name,
           SUM(CASE WHEN st.timeliness_status = 'on_time' THEN 1 ELSE 0 END) as on_time_count,
           SUM(CASE WHEN st.timeliness_status = 'late' THEN 1 ELSE 0 END) as late_count,
           SUM(CASE WHEN st.timeliness_status = 'pending' THEN 1 ELSE 0 END) as pending_count,
           COUNT(*) as total
         FROM station_timeliness st
         LEFT JOIN utility_stations us ON us.station_code = st.station_code
         GROUP BY st.station_code, us.station_name
         ORDER BY late_count DESC`,
      ).all();
      return json({ utilities: metrics.results });
    }

    if (path === '/api/metrics/overview' && request.method === 'GET') {
      const totals = await env.DB.prepare(
        `SELECT
           COUNT(DISTINCT tr.ticket_base) as ticket_count,
           SUM(CASE WHEN st.timeliness_status = 'on_time' THEN 1 ELSE 0 END) as on_time_count,
           SUM(CASE WHEN st.timeliness_status = 'late' THEN 1 ELSE 0 END) as late_count,
           SUM(CASE WHEN st.timeliness_status = 'pending' THEN 1 ELSE 0 END) as pending_count
         FROM station_timeliness st
         JOIN ticket_revisions tr ON tr.request_number = st.request_number`,
      ).first();

      return json({ overview: totals });
    }

    if (path === '/api/overlaps' && request.method === 'GET') {
      const overlaps = await env.DB.prepare(
        `SELECT po.*,
                ta.created_by as created_by_a,
                tb.created_by as created_by_b
         FROM polygon_overlaps po
         LEFT JOIN (${TICKET_LIST_UNION_SQL}) ta
           ON ta.ticket_base = po.ticket_base_a AND ta.region = po.region_a
         LEFT JOIN (${TICKET_LIST_UNION_SQL}) tb
           ON tb.ticket_base = po.ticket_base_b AND tb.region = po.region_b
         ORDER BY overlap_area_sqm DESC
         LIMIT 100`,
      ).all();
      return json({ overlaps: overlaps.results });
    }

    return json({ error: 'Not found' }, 404);
  } catch (err) {
    console.error(err);
    return json({ error: err instanceof Error ? err.message : 'Internal error' }, 500);
  }
}
