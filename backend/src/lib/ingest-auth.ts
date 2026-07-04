import type { MiddlewareHandler } from 'hono';
import type { Env } from '../types';

type IngestEnv = { Bindings: Env };

export function requireIngestSecret(): MiddlewareHandler<IngestEnv> {
  return async (c, next) => {
    const secret = c.env.INGEST_SECRET?.trim();
    if (!secret) {
      return c.json({ error: 'Ingest not configured — set INGEST_SECRET on the Worker' }, 503);
    }
    const auth = c.req.header('Authorization') ?? '';
    if (auth !== `Bearer ${secret}`) {
      return c.json({ error: 'Unauthorized' }, 401);
    }
    await next();
  };
}

export function workerScrapingEnabled(env: Env): boolean {
  const v = env.ENABLE_WORKER_SCRAPING?.trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}
