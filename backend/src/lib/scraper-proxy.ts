import type { Env } from '../types';

export type ScrapeTriggerBody = {
  startDate: string;
  endDate: string;
  systems: string[];
};

export async function triggerDedicatedScraper(
  env: Env,
  body: ScrapeTriggerBody
): Promise<{ ok: true; scraper: Record<string, unknown> }> {
  const base = env.SCRAPER_WORKER_URL?.trim().replace(/\/$/, '');
  if (!base) {
    throw new Error(
      'Dedicated scraper URL not configured. Set SCRAPER_WORKER_URL on the API Worker, or set ENABLE_WORKER_SCRAPING=true.'
    );
  }

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (env.SCRAPER_RUN_SECRET) {
    headers.Authorization = `Bearer ${env.SCRAPER_RUN_SECRET}`;
  }

  const payload: Record<string, unknown> = {
    start: body.startDate,
    end: body.endDate,
    systems: body.systems,
  };

  const resp = await fetch(`${base}/run`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });

  const data = (await resp.json().catch(() => ({}))) as Record<string, unknown>;
  if (!resp.ok) {
    const msg =
      typeof data.message === 'string'
        ? data.message
        : typeof data.error === 'string'
          ? data.error
          : `Scraper returned HTTP ${resp.status}`;
    throw new Error(msg);
  }

  return { ok: true, scraper: data };
}
