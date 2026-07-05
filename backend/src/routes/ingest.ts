import { Hono } from 'hono';
import type { Env } from '../types';
import { requireIngestSecret } from '../lib/ingest-auth';
import { completeContainerJob } from '../lib/container-jobs';
import {
  ingestDigAlertBatch,
  ingestUsanBatch,
  trackContainerIngest,
  MAX_INGEST_BATCH_SIZE,
  type DigAlertIngestBody,
  type UsanIngestBody,
} from '../lib/ingest';

type IngestEnv = { Bindings: Env };

export const ingestRoutes = new Hono<IngestEnv>();

ingestRoutes.use('*', requireIngestSecret());

ingestRoutes.get('/health', (c) =>
  c.json({
    ok: true,
    maxBatchSize: MAX_INGEST_BATCH_SIZE,
    endpoints: [
      'POST /api/ingest/digalert',
      'POST /api/ingest/usan-ca',
      'POST /api/ingest/usan-nv',
      'POST /api/ingest/job-complete',
    ],
  })
);

ingestRoutes.post('/digalert', async (c) => {
  const body = await c.req.json<DigAlertIngestBody>();
  const result = await ingestDigAlertBatch(c.env.DB, body);
  if ('error' in result) return c.json(result, 400);
  await trackContainerIngest(
    c.env.DB,
    'digalert',
    body,
    result.accepted,
    result.failed,
    result.lastAcceptedTicket
  );
  return c.json(result);
});

ingestRoutes.post('/usan-ca', async (c) => {
  const body = await c.req.json<UsanIngestBody>();
  const result = await ingestUsanBatch(c.env.DB, 'usan_ca', body);
  if ('error' in result) return c.json(result, 400);
  await trackContainerIngest(
    c.env.DB,
    'usan-ca',
    body,
    result.accepted,
    result.failed,
    result.lastAcceptedTicket
  );
  return c.json(result);
});

ingestRoutes.post('/usan-nv', async (c) => {
  const body = await c.req.json<UsanIngestBody>();
  const result = await ingestUsanBatch(c.env.DB, 'usan_nv', body);
  if ('error' in result) return c.json(result, 400);
  await trackContainerIngest(
    c.env.DB,
    'usan-nv',
    body,
    result.accepted,
    result.failed,
    result.lastAcceptedTicket
  );
  return c.json(result);
});

ingestRoutes.post('/job-complete', async (c) => {
  const body = await c.req.json<{
    jobId: number;
    ok?: boolean;
    lastError?: string;
    systems?: Record<string, { ingest_errors?: number }>;
  }>();
  if (!body.jobId) return c.json({ error: 'jobId required' }, 400);
  await completeContainerJob(c.env.DB, body.jobId, body);
  return c.json({ ok: true, jobId: body.jobId });
});
