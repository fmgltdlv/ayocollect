import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env, TicketSystem } from './types';
import {
  fetchDigAlertRaw,
  fetchUsanPolygonWkt,
  fetchUsanPosr,
} from './fetchers';
import { upsertDigAlert, upsertUsan } from './db/upsert';
import {
  enrichListWithBadges,
  getDigAlertDetail,
  getUsanDetail,
  listTickets,
} from './db/queries';
import {
  abortJob,
  cancelJob,
  continueJobUntilDone,
  createJob,
  getJob,
  listJobs,
  runJobSlice,
  runCron,
  stopAllJobs,
} from './jobs/processor';
import { buildJobProgress } from './lib/job-progress';
import { getAutoFetchSettings, isFetchStopped, setSetting } from './lib/settings';

type HonoEnv = { Bindings: Env; Variables: {} };

const app = new Hono<HonoEnv>();

function workerOrigin(c: { req: { url: string } }): string {
  return new URL(c.req.url).origin;
}

app.use('/api/*', cors());

app.get('/api/health', (c) => c.json({ ok: true }));

app.get('/api/settings/auto-fetch', async (c) => {
  return c.json(await getAutoFetchSettings(c.env.DB));
});

app.put('/api/settings/auto-fetch', async (c) => {
  const body = await c.req.json<Record<string, string>>();
  for (const [key, value] of Object.entries(body)) {
    if (key.startsWith('auto_fetch_') || key === 'fetch_stopped') {
      await setSetting(c.env.DB, key, String(value));
    }
  }
  return c.json(await getAutoFetchSettings(c.env.DB));
});

app.post('/api/jobs/stop-all', async (c) => {
  const count = await stopAllJobs(c.env.DB);
  return c.json({ stopped: true, cancelledJobCount: count, fetchStopped: true });
});

app.get('/api/jobs', async (c) => {
  const jobs = await listJobs(c.env.DB);
  const stopped = await isFetchStopped(c.env.DB);
  return c.json({ jobs, fetchStopped: stopped });
});

app.get('/api/jobs/:id', async (c) => {
  const job = await getJob(c.env.DB, Number(c.req.param('id')));
  if (!job) return c.json({ error: 'Not found' }, 404);
  return c.json({
    job,
    progress: buildJobProgress(job),
    fetchStopped: await isFetchStopped(c.env.DB),
  });
});

app.post('/api/jobs', async (c) => {
  const body = await c.req.json<{ systems: string[]; startDate: string; endDate: string }>();
  if (!body.systems?.length || !body.startDate || !body.endDate) {
    return c.json({ error: 'systems, startDate, endDate required' }, 400);
  }
  const id = await createJob(c.env.DB, body);
  c.executionCtx.waitUntil(continueJobUntilDone(c.env.DB, id, c.env, c.executionCtx, workerOrigin(c)));
  const job = await getJob(c.env.DB, id);
  return c.json({ job, started: true, fetchStopped: await isFetchStopped(c.env.DB) });
});

app.post('/api/jobs/:id/tick', async (c) => {
  const id = Number(c.req.param('id'));
  c.executionCtx.waitUntil(continueJobUntilDone(c.env.DB, id, c.env, c.executionCtx, workerOrigin(c)));
  const job = await getJob(c.env.DB, id);
  if (!job) return c.json({ error: 'Not found' }, 404);
  return c.json({ job, continued: true });
});

app.post('/api/jobs/:id/cancel', async (c) => {
  const id = Number(c.req.param('id'));
  const job = await cancelJob(c.env.DB, id);
  if (!job) return c.json({ error: 'Not found' }, 404);
  return c.json({ job, cancelled: true });
});

app.post('/api/jobs/:id/pause', async (c) => {
  const id = Number(c.req.param('id'));
  await c.env.DB.prepare("UPDATE fetch_jobs SET status = 'paused', updated_at = datetime('now') WHERE id = ?").bind(id).run();
  abortJob(id);
  return c.json({ ok: true });
});

app.post('/api/jobs/:id/resume', async (c) => {
  const id = Number(c.req.param('id'));
  await c.env.DB.prepare("UPDATE fetch_jobs SET status = 'running', updated_at = datetime('now') WHERE id = ?").bind(id).run();
  c.executionCtx.waitUntil(continueJobUntilDone(c.env.DB, id, c.env, c.executionCtx, workerOrigin(c)));
  const job = await getJob(c.env.DB, id);
  return c.json({ job, continued: true });
});

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
  };
}

async function ticketsListHandler(c: { env: Env; req: { query: (k: string) => string | undefined } }, system: TicketSystem) {
  const rows = await listTickets(c.env.DB, system, listQuery(c));
  const tickets = await enrichListWithBadges(c.env.DB, system, rows);
  return { tickets };
}

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

app.post('/api/digalert/fetch', async (c) => {
  const body = await c.req.json<{ ticket: string; revision?: string }>();
  const payload = await fetchDigAlertRaw(body.ticket, body.revision ?? '00A', c.env);
  if (!payload) return c.json({ error: 'Fetch failed' }, 502);
  const id = await upsertDigAlert(c.env.DB, payload);
  const detail = await getDigAlertDetail(c.env.DB, body.ticket, body.revision ?? '00A');
  return c.json({ ticketNumber: id, detail });
});

app.post('/api/usan-ca/fetch', async (c) => {
  const body = await c.req.json<{ ticket: string }>();
  const posr = await fetchUsanPosr('ca', body.ticket);
  if (!posr) return c.json({ error: 'Fetch failed' }, 502);
  const polygon = await fetchUsanPolygonWkt('ca', body.ticket);
  const id = await upsertUsan(c.env.DB, 'usan_ca', posr, polygon);
  const detail = await getUsanDetail(c.env.DB, 'usan-ca', body.ticket);
  return c.json({ ticketNumber: id, detail });
});

app.post('/api/usan-nv/fetch', async (c) => {
  const body = await c.req.json<{ ticket: string }>();
  const posr = await fetchUsanPosr('nv', body.ticket);
  if (!posr) return c.json({ error: 'Fetch failed' }, 502);
  const polygon = await fetchUsanPolygonWkt('nv', body.ticket);
  const id = await upsertUsan(c.env.DB, 'usan_nv', posr, polygon);
  const detail = await getUsanDetail(c.env.DB, 'usan-nv', body.ticket);
  return c.json({ ticketNumber: id, detail });
});

app.all('*', async (c) => {
  if (c.req.path.startsWith('/api/')) return c.notFound();
  return c.env.ASSETS.fetch(c.req.raw);
});

export default {
  fetch: app.fetch,
  scheduled: async (_event: ScheduledEvent, env: Env, ctx: ExecutionContext) => {
    ctx.waitUntil(runCron(env.DB, env, ctx));
  },
};

export { app };
