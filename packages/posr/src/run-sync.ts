import type { QueueMessage, SyncDateMessage } from '@ayocollect/db';
import {
  enumerateDigalertTicketsForDate,
  fetchDigalertTicketsBatched,
  passesCallerFilter,
} from '@ayocollect/digalert';
import { ALL_SYNC_REGIONS, isUsanRegion, type SyncRegion } from './config';
import { enumerateTicketsForDate } from './enumerate';
import { fetchTicketsBatched, passesCreatedByFilter } from './sync';

export type RunSyncEnv = {
  DB: D1Database;
  BUCKET?: R2Bucket;
  QUEUE: Queue<QueueMessage>;
  ORG_CREATED_BY_FILTER?: string;
  DIGALERT_SESSION_COOKIES?: string;
  SYNC_REGIONS?: string;
};

function parseSessionCookies(raw: string | undefined): Record<string, string> | undefined {
  if (!raw?.trim()) return undefined;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, string>;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function resolveRegions(env: RunSyncEnv): SyncRegion[] {
  if (env.SYNC_REGIONS?.trim()) {
    return env.SYNC_REGIONS.split(',')
      .map((r) => r.trim().toUpperCase())
      .filter((r): r is SyncRegion => ALL_SYNC_REGIONS.includes(r as SyncRegion));
  }
  return [...ALL_SYNC_REGIONS];
}

async function syncUsanRegion(
  env: RunSyncEnv,
  targetDate: string,
  region: 'NV' | 'CA',
): Promise<{ synced: number; failed: number }> {
  let synced = 0;
  let failed = 0;

  const ticketBases = await enumerateTicketsForDate({ targetDate, region });
  const results = await fetchTicketsBatched(ticketBases, region, env.BUCKET);

  for (const result of results) {
    if (!result.success || !result.message) {
      failed++;
      continue;
    }

    const payload = JSON.parse(result.message.payload);
    const createdBy = payload?.posrTicket?.createdBy as string | undefined;
    if (!passesCreatedByFilter(createdBy, env.ORG_CREATED_BY_FILTER)) {
      continue;
    }

    await env.QUEUE.send(result.message);
    synced++;
  }

  return { synced, failed };
}

async function syncDigalertRegion(
  env: RunSyncEnv,
  targetDate: string,
): Promise<{ synced: number; failed: number }> {
  let synced = 0;
  let failed = 0;
  const sessionCookies = parseSessionCookies(env.DIGALERT_SESSION_COOKIES);

  const ticketBases = await enumerateDigalertTicketsForDate({
    targetDate,
    sessionCookies,
  });
  const results = await fetchDigalertTicketsBatched(
    ticketBases,
    '00A',
    env.BUCKET,
    sessionCookies,
  );

  for (const result of results) {
    if (!result.success || !result.message) {
      failed++;
      continue;
    }

    const bundle = JSON.parse(result.message.payload);
    const caller = bundle?.ticketData?.caller as string | undefined;
    if (!passesCallerFilter(caller, env.ORG_CREATED_BY_FILTER)) {
      continue;
    }

    await env.QUEUE.send(result.message);
    synced++;
  }

  return { synced, failed };
}

export async function runSyncForRegion(
  env: RunSyncEnv,
  targetDate: string,
  region: SyncRegion,
  triggeredBy: SyncDateMessage['triggeredBy'],
  backfillRunId?: number,
): Promise<{ synced: number; failed: number }> {
  let synced = 0;
  let failed = 0;

  try {
    if (isUsanRegion(region)) {
      ({ synced, failed } = await syncUsanRegion(env, targetDate, region));
    } else {
      ({ synced, failed } = await syncDigalertRegion(env, targetDate));
    }

    if (backfillRunId) {
      await env.DB.prepare(
        `UPDATE backfill_runs SET status = 'completed', tickets_synced = ?, tickets_failed = ?, completed_at = datetime('now') WHERE id = ?`,
      )
        .bind(synced, failed, backfillRunId)
        .run();
    } else {
      await env.DB.prepare(
        `UPDATE sync_state SET last_success_at = datetime('now'), last_target_date = ?, tickets_synced = ?, tickets_failed = ?, last_error = NULL, updated_at = datetime('now') WHERE id = 1`,
      )
        .bind(targetDate, synced, failed)
        .run();
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (backfillRunId) {
      await env.DB.prepare(
        `UPDATE backfill_runs SET status = 'failed', error = ?, completed_at = datetime('now') WHERE id = ?`,
      )
        .bind(message, backfillRunId)
        .run();
    } else {
      await env.DB.prepare(
        `UPDATE sync_state SET last_error = ?, updated_at = datetime('now') WHERE id = 1`,
      )
        .bind(message)
        .run();
    }
    throw err;
  }

  return { synced, failed };
}

export async function runSyncForDate(
  env: RunSyncEnv,
  targetDate: string,
  triggeredBy: SyncDateMessage['triggeredBy'],
  backfillRunId?: number,
  region?: SyncRegion,
): Promise<{ synced: number; failed: number }> {
  if (region) {
    return runSyncForRegion(env, targetDate, region, triggeredBy, backfillRunId);
  }

  let totalSynced = 0;
  let totalFailed = 0;

  for (const syncRegion of resolveRegions(env)) {
    const result = await runSyncForRegion(env, targetDate, syncRegion, triggeredBy);
    totalSynced += result.synced;
    totalFailed += result.failed;
  }

  return { synced: totalSynced, failed: totalFailed };
}

/** Dispatch the next queued backfill run (one date + system at a time). */
export async function processNextBackfill(env: RunSyncEnv): Promise<boolean> {
  const running = await env.DB.prepare(
    `SELECT COUNT(*) as c FROM backfill_runs WHERE status = 'running'`,
  ).first<{ c: number }>();
  if (running && running.c > 0) return false;

  const next = await env.DB.prepare(
    `SELECT id, target_date, region FROM backfill_runs WHERE status = 'queued' ORDER BY target_date ASC, region ASC LIMIT 1`,
  ).first<{ id: number; target_date: string; region: SyncRegion }>();

  if (!next) return false;

  const claim = await env.DB.prepare(
    `UPDATE backfill_runs SET status = 'running', started_at = datetime('now'), error = NULL WHERE id = ? AND status = 'queued'`,
  )
    .bind(next.id)
    .run();

  if (!claim.meta.changes) return false;

  await env.QUEUE.send({
    type: 'sync-date',
    targetDate: next.target_date,
    region: next.region,
    backfillRunId: next.id,
    triggeredBy: 'dashboard',
  });

  return true;
}
