import type { MiddlewareHandler } from 'hono';
import type { Env } from '../types';

type IngestEnv = { Bindings: Env };

export async function getIngestSecret(env: Env): Promise<string | null> {
  if (!env.INGEST_SECRET?.get) return null;
  try {
    const secret = (await env.INGEST_SECRET.get())?.trim();
    return secret || null;
  } catch {
    return null;
  }
}

export function requireIngestSecret(): MiddlewareHandler<IngestEnv> {
  return async (c, next) => {
    const secret = await getIngestSecret(c.env);
    if (!secret) {
      return c.json({ error: 'Ingest not configured — bind INGEST_SECRET from Secrets Store' }, 503);
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
