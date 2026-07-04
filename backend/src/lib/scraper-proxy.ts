import type { Env } from '../types';

export type ScrapeTriggerBody = {
  startDate: string;
  endDate: string;
  systems: string[];
  jobId?: number;
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

  const apiOrigin = env.WORKER_URL?.trim().replace(/\/$/, '');
  if (apiOrigin && base === apiOrigin) {
    throw new Error(
      'SCRAPER_WORKER_URL points at the API Worker. Set it to the scraper Worker (https://811scrape.ayowerks.com).'
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
  if (body.jobId != null) payload.jobId = body.jobId;

  const runUrl = `${base}/run`;
  const resp = await fetch(runUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });

  const text = await resp.text();
  let data: Record<string, unknown> = {};
  try {
    data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    data = { raw: text.slice(0, 200) };
  }

  if (!resp.ok) {
    const detail =
      typeof data.message === 'string'
        ? data.message
        : typeof data.error === 'string'
          ? data.error
          : typeof data.raw === 'string'
            ? data.raw
            : text.slice(0, 200) || undefined;
    throw new Error(
      detail
        ? `Scraper error (${resp.status} from ${runUrl}): ${detail}`
        : `Scraper returned HTTP ${resp.status} from ${runUrl} — verify SCRAPER_WORKER_URL is https://811scrape.ayowerks.com`
    );
  }

  return { ok: true, scraper: data };
}
