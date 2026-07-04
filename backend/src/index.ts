import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { BadgeFilter } from './db/queries';
import type { Env, TicketSystem } from './types';
import {
  fetchDigAlertRaw,
  fetchUsanPolygonWkt,
  fetchUsanPosr,
} from './fetchers';
import { upsertDigAlert, upsertUsan } from './db/upsert';
import {
  countTickets,
  enrichListWithBadges,
  getDigAlertDetail,
  getUsanDetail,
  listMapPointsMulti,
  listTickets,
  listTicketsMulti,
  loadTicketPolygons,
} from './db/queries';
import { getAnalyticsSummary, getAnalyticsTrends, getOverlapHotspots } from './db/analytics-queries';
import { rebuildOverlapsBatch, listOverlapsForTicket, runOverlapMaintenance } from './lib/overlaps';
import {
  abortJob,
  cancelJob,
  continueJobUntilDone,
  createJob,
  getJob,
  listJobs,
  kickStaleRunningJobs,
  resumeStalledJobs,
  runJobSlice,
  runCron,
  stopAllJobs,
} from './jobs/processor';
import { buildJobProgress } from './lib/job-progress';
import { getIngestSecret, workerScrapingEnabled } from './lib/ingest-auth';
import { authDisabled, requireGoogleAuth } from './lib/google-auth';
import {
  addAdminUser,
  isAdminEmail,
  isEnvAdmin,
  listAdminUsers,
  removeAdminUser,
  requireAdmin,
} from './lib/admin';
import { nukeAllTickets } from './lib/nuke-tickets';
import { triggerDedicatedScraper } from './lib/scraper-proxy';
import { createContainerJob, failContainerJob, finalizeStaleContainerJobs } from './lib/container-jobs';
import { getAutoFetchSettings, getSetting, isFetchStopped, setSetting } from './lib/settings';
import { ingestRoutes } from './routes/ingest';

type HonoEnv = { Bindings: Env; Variables: { userEmail: string; isAdmin: boolean } };

const app = new Hono<HonoEnv>();
const adminOnly = requireAdmin();

const ALLOWED_ORIGINS = [
  'https://811view.ayowerks.com',
  'http://127.0.0.1:8788',
  'http://localhost:8788',
];

function workerOrigin(c: { req: { url: string } }): string {
  return new URL(c.req.url).origin;
}

app.use(
  '/api/*',
  cors({
    origin: ALLOWED_ORIGINS,
    allowHeaders: ['Content-Type', 'Authorization'],
  })
);

app.route('/api/ingest', ingestRoutes);

function scrapingDisabledResponse(c: { env: Env; json: (body: unknown, status?: number) => Response }) {
  if (workerScrapingEnabled(c.env)) return null;
  return c.json(
    {
      error:
        'Single-ticket fetch on the Worker is disabled. Use Browse for stored tickets, or run a batch job (triggers the dedicated scraper container).',
    },
    503
  );
}

app.get('/api/health', async (c) =>
  c.json({
    ok: true,
    ingest: !!(await getIngestSecret(c.env)),
    workerScraping: workerScrapingEnabled(c.env),
    dedicatedScraper: !!c.env.SCRAPER_WORKER_URL?.trim(),
    scraperWorkerUrl: c.env.SCRAPER_WORKER_URL?.trim() || null,
    auth: authDisabled(c.env) ? 'disabled' : 'google',
  })
);

app.use('/api/*', requireGoogleAuth());

app.get('/api/auth/me', async (c) => {
  const email = c.get('userEmail') ?? null;
  const admin = email ? await isAdminEmail(c.env.DB, c.env, email) : false;
  return c.json({ email, admin });
});

app.get('/api/admin/users', adminOnly, async (c) => {
  return c.json({ admins: await listAdminUsers(c.env.DB, c.env) });
});

app.post('/api/admin/users', adminOnly, async (c) => {
  const body = await c.req.json<{ email?: string }>();
  const email = body.email?.trim().toLowerCase();
  if (!email) return c.json({ error: 'email required' }, 400);

  const domain = c.env.ALLOWED_EMAIL_DOMAIN?.trim().toLowerCase().replace(/^@/, '') ?? '';
  if (domain && !email.endsWith(`@${domain}`)) {
    return c.json({ error: `Email must be @${domain}` }, 400);
  }

  if (await isAdminEmail(c.env.DB, c.env, email)) {
    return c.json({ error: 'Already an admin' }, 409);
  }

  const admin = await addAdminUser(c.env.DB, email, c.get('userEmail'));
  return c.json({ admin }, 201);
});

app.delete('/api/admin/users/:email', adminOnly, async (c) => {
  const email = decodeURIComponent(c.req.param('email')).trim().toLowerCase();
  if (email === c.get('userEmail').toLowerCase()) {
    return c.json({ error: 'Cannot remove yourself' }, 400);
  }
  if (isEnvAdmin(c.env, email)) {
    return c.json({ error: 'Cannot remove env-configured super admin' }, 400);
  }
  const removed = await removeAdminUser(c.env.DB, c.env, email);
  if (!removed) return c.json({ error: 'Not found or not removable' }, 404);
  return c.json({ removed: true, email });
});

app.post('/api/admin/nuke-tickets', adminOnly, async (c) => {
  const result = await nukeAllTickets(c.env.DB);
  return c.json({ nuked: true, ...result });
});

app.post('/api/admin/overlaps/rebuild', adminOnly, async (c) => {
  const q = c.req.query.bind(c.req);
  const system = (q('system') ?? 'digalert') as TicketSystem;
  const valid = new Set<TicketSystem>(['digalert', 'usan-ca', 'usan-nv']);
  if (!valid.has(system)) return c.json({ error: 'Invalid system' }, 400);
  const limit = Math.min(Number(q('limit') ?? 500), 500);
  const offset = Number(q('offset') ?? 0);
  const result = await rebuildOverlapsBatch(c.env.DB, system, limit, offset);
  return c.json({ system, ...result });
});

app.get('/api/admin/settings/overlaps', adminOnly, async (c) => {
  const crossSystem = (await getSetting(c.env.DB, 'overlap_cross_system_enabled')) === '1';
  const pruneEnabled = (await getSetting(c.env.DB, 'overlap_prune_enabled')) !== '0';
  const rebuildCursor = (await getSetting(c.env.DB, 'overlap_rebuild_cursor')) ?? '';
  return c.json({ crossSystem, pruneEnabled, rebuildCursor });
});

app.put('/api/admin/settings/overlaps', adminOnly, async (c) => {
  const body = await c.req.json<{ crossSystem?: boolean; pruneEnabled?: boolean }>();
  if (body.crossSystem !== undefined) {
    await setSetting(c.env.DB, 'overlap_cross_system_enabled', body.crossSystem ? '1' : '0');
  }
  if (body.pruneEnabled !== undefined) {
    await setSetting(c.env.DB, 'overlap_prune_enabled', body.pruneEnabled ? '1' : '0');
  }
  const crossSystem = (await getSetting(c.env.DB, 'overlap_cross_system_enabled')) === '1';
  const pruneEnabled = (await getSetting(c.env.DB, 'overlap_prune_enabled')) !== '0';
  return c.json({ crossSystem, pruneEnabled });
});

app.get('/api/settings/auto-fetch', adminOnly, async (c) => {
  return c.json(await getAutoFetchSettings(c.env.DB));
});

app.put('/api/settings/auto-fetch', adminOnly, async (c) => {
  const body = await c.req.json<Record<string, string>>();
  for (const [key, value] of Object.entries(body)) {
    if (key.startsWith('auto_fetch_') || key === 'fetch_stopped') {
      await setSetting(c.env.DB, key, String(value));
    }
  }
  return c.json(await getAutoFetchSettings(c.env.DB));
});

app.post('/api/jobs/stop-all', adminOnly, async (c) => {
  const count = await stopAllJobs(c.env.DB);
  return c.json({ stopped: true, cancelledJobCount: count, fetchStopped: true });
});

app.get('/api/jobs', adminOnly, async (c) => {
  await finalizeStaleContainerJobs(c.env.DB);
  const jobs = await listJobs(c.env.DB);
  const stopped = await isFetchStopped(c.env.DB);
  kickStaleRunningJobs(c.env.DB, c.env, workerOrigin(c));
  return c.json({ jobs, fetchStopped: stopped });
});

app.get('/api/jobs/:id', adminOnly, async (c) => {
  await finalizeStaleContainerJobs(c.env.DB);
  const job = await getJob(c.env.DB, Number(c.req.param('id')));
  if (!job) return c.json({ error: 'Not found' }, 404);
  return c.json({
    job,
    progress: buildJobProgress(job),
    fetchStopped: await isFetchStopped(c.env.DB),
  });
});

app.post('/api/jobs', adminOnly, async (c) => {
  const body = await c.req.json<{
    systems: string[];
    startDate: string;
    endDate: string;
  }>();
  if (!body.systems?.length || !body.startDate || !body.endDate) {
    return c.json({ error: 'systems, startDate, endDate required' }, 400);
  }

  if (!workerScrapingEnabled(c.env)) {
    const id = await createContainerJob(c.env.DB, body);
    try {
      const result = await triggerDedicatedScraper(c.env, { ...body, jobId: id });
      const job = await getJob(c.env.DB, id);
      return c.json({
        started: true,
        dedicatedScraper: true,
        job,
        message:
          'Scraper container started. Track progress on the Jobs tab; tickets appear in Browse as batches are ingested.',
        scraper: result.scraper,
        fetchStopped: await isFetchStopped(c.env.DB),
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await failContainerJob(c.env.DB, id, msg);
      return c.json({ error: msg }, 502);
    }
  }

  const id = await createJob(c.env.DB, body);
  c.executionCtx.waitUntil(continueJobUntilDone(c.env.DB, id, c.env, c.executionCtx, workerOrigin(c)));
  const job = await getJob(c.env.DB, id);
  return c.json({ job, started: true, fetchStopped: await isFetchStopped(c.env.DB) });
});

app.post('/api/jobs/:id/tick', adminOnly, async (c) => {
  const id = Number(c.req.param('id'));
  c.executionCtx.waitUntil(continueJobUntilDone(c.env.DB, id, c.env, c.executionCtx, workerOrigin(c)));
  const job = await getJob(c.env.DB, id);
  if (!job) return c.json({ error: 'Not found' }, 404);
  return c.json({ job, continued: true });
});

app.post('/api/jobs/:id/cancel', adminOnly, async (c) => {
  const id = Number(c.req.param('id'));
  const job = await cancelJob(c.env.DB, id);
  if (!job) return c.json({ error: 'Not found' }, 404);
  return c.json({ job, cancelled: true });
});

app.post('/api/jobs/:id/pause', adminOnly, async (c) => {
  const id = Number(c.req.param('id'));
  await c.env.DB.prepare("UPDATE fetch_jobs SET status = 'paused', updated_at = datetime('now') WHERE id = ?").bind(id).run();
  abortJob(id);
  return c.json({ ok: true });
});

app.post('/api/jobs/:id/resume', adminOnly, async (c) => {
  const id = Number(c.req.param('id'));
  await c.env.DB.prepare("UPDATE fetch_jobs SET status = 'running', updated_at = datetime('now') WHERE id = ?").bind(id).run();
  c.executionCtx.waitUntil(continueJobUntilDone(c.env.DB, id, c.env, c.executionCtx, workerOrigin(c)));
  const job = await getJob(c.env.DB, id);
  return c.json({ job, continued: true });
});

function parseBadges(q: (k: string) => string | undefined) {
  const raw = q('badges');
  if (!raw) return [];
  const valid = new Set<BadgeFilter>(['pending', 'blocker', 'late']);
  return raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s): s is BadgeFilter => valid.has(s as BadgeFilter));
}

function listQuery(c: { req: { query: (k: string) => string | undefined } }) {
  const q = c.req.query.bind(c.req);
  const num = (k: string) => {
    const v = q(k);
    return v !== undefined ? Number(v) : undefined;
  };
  return {
    ticketNumber: q('ticketNumber'),
    startDate: q('startDate'),
    endDate: q('endDate'),
    minLon: num('minLon'),
    minLat: num('minLat'),
    maxLon: num('maxLon'),
    maxLat: num('maxLat'),
    limit: num('limit'),
    offset: num('offset'),
    badges: parseBadges(q),
  };
}

function parseSystems(q: (k: string) => string | undefined): TicketSystem[] {
  const raw = q('systems');
  if (!raw) return [];
  const valid = new Set<TicketSystem>(['digalert', 'usan-ca', 'usan-nv']);
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s): s is TicketSystem => valid.has(s as TicketSystem));
}

async function ticketsListHandler(c: { env: Env; req: { query: (k: string) => string | undefined } }, system: TicketSystem) {
  const params = listQuery(c);
  const rows = await listTickets(c.env.DB, system, params);
  const total = await countTickets(c.env.DB, system, params);
  const tickets = await enrichListWithBadges(c.env.DB, system, rows);
  const limit = params.limit ?? 100;
  const offset = params.offset ?? 0;
  return { tickets, total, limit, offset };
}

app.get('/api/tickets', async (c) => {
  const systems = parseSystems(c.req.query.bind(c.req));
  if (!systems.length) {
    return c.json({ error: 'At least one system required (systems=digalert,usan-ca,usan-nv)' }, 400);
  }
  const params = listQuery(c);
  const { tickets: rows, total, limit, offset } = await listTicketsMulti(c.env.DB, systems, params);
  const tickets = await enrichListWithBadges(c.env.DB, systems[0], rows);
  return c.json({ tickets, total, limit, offset });
});

app.get('/api/tickets/map-points', async (c) => {
  const systems = parseSystems(c.req.query.bind(c.req));
  if (!systems.length) {
    return c.json({ error: 'At least one system required (systems=digalert,usan-ca,usan-nv)' }, 400);
  }
  const params = listQuery(c);
  const { points, capped } = await listMapPointsMulti(c.env.DB, systems, params);
  return c.json({ points, capped, total: points.length });
});

app.post('/api/tickets/polygons', async (c) => {
  const body = await c.req.json<{ tickets?: { system: TicketSystem; ticketNumber: string; revision?: string }[] }>();
  if (!body.tickets?.length) {
    return c.json({ error: 'tickets required' }, 400);
  }
  const valid = new Set<TicketSystem>(['digalert', 'usan-ca', 'usan-nv']);
  const refs = body.tickets.filter((t) => valid.has(t.system)).slice(0, 100);
  const polygons = await loadTicketPolygons(c.env.DB, refs);
  return c.json({ polygons });
});

app.get('/api/analytics/summary', async (c) => {
  const q = c.req.query.bind(c.req);
  const systems = parseSystems(q);
  return c.json(
    await getAnalyticsSummary(c.env.DB, {
      startDate: q('startDate'),
      endDate: q('endDate'),
      systems: systems.length ? systems : undefined,
    })
  );
});

app.get('/api/analytics/trends', async (c) => {
  const q = c.req.query.bind(c.req);
  const days = Number(q('days') ?? 30);
  const systems = parseSystems(q);
  return c.json(await getAnalyticsTrends(c.env.DB, days, systems.length ? systems : undefined));
});

app.get('/api/analytics/overlaps', async (c) => {
  const q = c.req.query.bind(c.req);
  const concurrent = q('concurrent') === '1';
  const limit = Number(q('limit') ?? 20);
  try {
    return c.json(await getOverlapHotspots(c.env.DB, { concurrent, limit }));
  } catch {
    return c.json({ hotspots: [] });
  }
});

app.get('/api/digalert/tickets', async (c) => c.json(await ticketsListHandler(c, 'digalert')));
app.get('/api/usan-ca/tickets', async (c) => c.json(await ticketsListHandler(c, 'usan-ca')));
app.get('/api/usan-nv/tickets', async (c) => c.json(await ticketsListHandler(c, 'usan-nv')));

app.get('/api/digalert/tickets/:ticketNumber', async (c) => {
  const revision = c.req.query('revision') ?? '00A';
  const detail = await getDigAlertDetail(c.env.DB, c.req.param('ticketNumber'), revision);
  if (!detail) return c.json({ error: 'Not found' }, 404);
  return c.json(detail);
});

app.get('/api/usan-ca/tickets/:ticketNumber', async (c) => {
  const detail = await getUsanDetail(c.env.DB, 'usan-ca', c.req.param('ticketNumber'));
  if (!detail) return c.json({ error: 'Not found' }, 404);
  return c.json(detail);
});

app.get('/api/usan-nv/tickets/:ticketNumber', async (c) => {
  const detail = await getUsanDetail(c.env.DB, 'usan-nv', c.req.param('ticketNumber'));
  if (!detail) return c.json({ error: 'Not found' }, 404);
  return c.json(detail);
});

app.get('/api/tickets/:system/:ticketNumber/overlaps', async (c) => {
  const system = c.req.param('system') as TicketSystem;
  const valid = new Set<TicketSystem>(['digalert', 'usan-ca', 'usan-nv']);
  if (!valid.has(system)) return c.json({ error: 'Invalid system' }, 400);
  const ticketNumber = c.req.param('ticketNumber');
  const revision = c.req.query('revision') ?? (system === 'digalert' ? '00A' : undefined);
  const concurrentOnly = c.req.query('concurrent') === '1';
  try {
    const overlaps = await listOverlapsForTicket(
      c.env.DB,
      { system, ticketNumber, revision: revision ?? null },
      concurrentOnly
    );
    return c.json({ overlaps, total: overlaps.length });
  } catch {
    return c.json({ overlaps: [], total: 0 });
  }
});

app.post('/api/digalert/fetch', adminOnly, async (c) => {
  const blocked = scrapingDisabledResponse(c);
  if (blocked) return blocked;
  const body = await c.req.json<{ ticket: string; revision?: string }>();
  const payload = await fetchDigAlertRaw(body.ticket, body.revision ?? '00A');
  if (!payload) return c.json({ error: 'Fetch failed' }, 502);
  const id = await upsertDigAlert(c.env.DB, payload);
  const detail = await getDigAlertDetail(c.env.DB, body.ticket, body.revision ?? '00A');
  return c.json({ ticketNumber: id, detail });
});

app.post('/api/usan-ca/fetch', adminOnly, async (c) => {
  const blocked = scrapingDisabledResponse(c);
  if (blocked) return blocked;
  const body = await c.req.json<{ ticket: string }>();
  const posr = await fetchUsanPosr('ca', body.ticket);
  if (!posr) return c.json({ error: 'Fetch failed' }, 502);
  const polygon = await fetchUsanPolygonWkt('ca', body.ticket);
  const id = await upsertUsan(c.env.DB, 'usan_ca', posr, polygon);
  const detail = await getUsanDetail(c.env.DB, 'usan-ca', body.ticket);
  return c.json({ ticketNumber: id, detail });
});

app.post('/api/usan-nv/fetch', adminOnly, async (c) => {
  const blocked = scrapingDisabledResponse(c);
  if (blocked) return blocked;
  const body = await c.req.json<{ ticket: string }>();
  const posr = await fetchUsanPosr('nv', body.ticket);
  if (!posr) return c.json({ error: 'Fetch failed' }, 502);
  const polygon = await fetchUsanPolygonWkt('nv', body.ticket);
  const id = await upsertUsan(c.env.DB, 'usan_nv', posr, polygon);
  const detail = await getUsanDetail(c.env.DB, 'usan-nv', body.ticket);
  return c.json({ ticketNumber: id, detail });
});

app.get('/', (c) =>
  c.json({
    service: 'ayocollect-api',
    health: '/api/health',
    ingest: '/api/ingest/health',
    ui: 'https://811view.ayowerks.com',
    workerScraping: workerScrapingEnabled(c.env),
    scraperWorkerUrl: c.env.SCRAPER_WORKER_URL?.trim() || null,
  })
);

export default {
  fetch: app.fetch,
  scheduled: async (event: ScheduledEvent, env: Env, ctx: ExecutionContext) => {
    if (event.cron === '0 * * * *') {
      ctx.waitUntil(runCron(env.DB, env, ctx));
      ctx.waitUntil(runOverlapMaintenance(env.DB));
    }
    if (event.cron === '*/5 * * * *') {
      ctx.waitUntil(finalizeStaleContainerJobs(env.DB));
    }
    ctx.waitUntil(resumeStalledJobs(env.DB, env, ctx, env.WORKER_URL));
  },
};

export { app };
