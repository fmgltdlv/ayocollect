import { Hono } from 'hono';
import type { Env } from '../types';
import { requireIngestSecret } from '../lib/ingest-auth';
import {
  ingestDigAlertBatch,
  ingestUsanBatch,
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
    ],
  })
);

ingestRoutes.post('/digalert', async (c) => {
  const body = await c.req.json<DigAlertIngestBody>();
  const result = await ingestDigAlertBatch(c.env.DB, body);
  if ('error' in result) return c.json(result, 400);
  return c.json(result);
});

ingestRoutes.post('/usan-ca', async (c) => {
  const body = await c.req.json<UsanIngestBody>();
  const result = await ingestUsanBatch(c.env.DB, 'usan_ca', body);
  if ('error' in result) return c.json(result, 400);
  return c.json(result);
});

ingestRoutes.post('/usan-nv', async (c) => {
  const body = await c.req.json<UsanIngestBody>();
  const result = await ingestUsanBatch(c.env.DB, 'usan_nv', body);
  if ('error' in result) return c.json(result, 400);
  return c.json(result);
});
