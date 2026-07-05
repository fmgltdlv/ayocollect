import { continueJobUntilDone, getJob, type FetchJobRow } from '../jobs/processor';
import type { Env } from '../types';
import {
  containerResumeCursor,
  containerSystemNeedsResume,
  failContainerJob,
  isContainerJob,
  parseContainerState,
  type ContainerJobSystem,
  type ContainerResumeCursor,
  type ContainerSystemState,
} from './container-jobs';
import { compareDates } from './ticket-sequence';
import { setFetchStopped } from './settings';
import { triggerDedicatedScraper } from './scraper-proxy';

const RESUMABLE_STATUSES = new Set(['paused', 'failed', 'cancelled']);

function cursorField(system: ContainerJobSystem): keyof FetchJobRow {
  if (system === 'digalert') return 'digalert_cursor';
  if (system === 'usan-ca') return 'usan_ca_cursor';
  return 'usan_nv_cursor';
}

function systemsFromJob(job: FetchJobRow): ContainerJobSystem[] {
  const systems: ContainerJobSystem[] = [];
  if (job.include_digalert) systems.push('digalert');
  if (job.include_usan_ca) systems.push('usan-ca');
  if (job.include_usan_nv) systems.push('usan-nv');
  return systems;
}

function prepareSystemForResume(
  state: ContainerSystemState,
  system: ContainerJobSystem,
  startDate: string
): { state: ContainerSystemState; resumeCursor: ContainerResumeCursor } {
  state.done = false;
  const resumeCursor = containerResumeCursor(state, system, startDate) ?? {
    date: startDate,
    ...(system === 'digalert' ? { counter: 1 } : { seq: 1 }),
  };
  return { state, resumeCursor };
}

async function resumeContainerJob(
  db: D1Database,
  job: FetchJobRow,
  env: Env
): Promise<{ job: FetchJobRow; resumeStart: string; systems: string[] }> {
  const systemsToRun: string[] = [];
  const resumeCursors: Partial<Record<ContainerJobSystem, ContainerResumeCursor>> = {};
  let resumeStart: string | null = null;
  const cursorUpdates: Partial<Record<keyof FetchJobRow, string>> = {};

  for (const system of systemsFromJob(job)) {
    const state = parseContainerState(job[cursorField(system)] as string | null);
    if (!containerSystemNeedsResume(state, job.start_date, job.end_date)) continue;

    const { state: nextState, resumeCursor } = prepareSystemForResume(state, system, job.start_date);
    systemsToRun.push(system);
    resumeCursors[system] = resumeCursor;
    cursorUpdates[cursorField(system)] = JSON.stringify(nextState);
    if (resumeStart === null || compareDates(resumeCursor.date, resumeStart) < 0) {
      resumeStart = resumeCursor.date;
    }
  }

  // Failed jobs may have stale done flags after a full scan (e.g. ingest errors) — retry from job start.
  if (!systemsToRun.length && job.status === 'failed') {
    for (const system of systemsFromJob(job)) {
      const state = parseContainerState(job[cursorField(system)] as string | null);
      state.done = false;
      state.date = job.start_date;
      state.seq = system === 'digalert' ? null : 1;
      state.counter = system === 'digalert' ? 1 : null;
      state.scanDate = null;
      state.consecutiveMisses = 0;
      systemsToRun.push(system);
      cursorUpdates[cursorField(system)] = JSON.stringify(state);
      resumeCursors[system] =
        system === 'digalert'
          ? { date: job.start_date, counter: 1 }
          : { date: job.start_date, seq: 1 };
    }
    resumeStart = job.start_date;
  }

  if (!systemsToRun.length) {
    throw new Error('No remaining work to resume for this job');
  }

  const startDate = resumeStart ?? job.start_date;
  await setFetchStopped(db, false);

  await db
    .prepare(
      `UPDATE fetch_jobs SET
        status = 'running',
        digalert_cursor = COALESCE(?, digalert_cursor),
        usan_ca_cursor = COALESCE(?, usan_ca_cursor),
        usan_nv_cursor = COALESCE(?, usan_nv_cursor),
        updated_at = datetime('now')
       WHERE id = ?`
    )
    .bind(
      cursorUpdates.digalert_cursor ?? null,
      cursorUpdates.usan_ca_cursor ?? null,
      cursorUpdates.usan_nv_cursor ?? null,
      job.id
    )
    .run();

  try {
    await triggerDedicatedScraper(env, {
      startDate,
      endDate: job.end_date,
      systems: systemsToRun,
      jobId: job.id,
      resumeCursors,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await failContainerJob(db, job.id, `Resume failed: ${msg}`);
    throw new Error(msg);
  }

  const updated = await getJob(db, job.id);
  if (!updated) throw new Error('Job not found after resume');
  return { job: updated, resumeStart: startDate, systems: systemsToRun };
}

export async function resumeJob(
  db: D1Database,
  jobId: number,
  env: Env,
  ctx: ExecutionContext,
  workerOrigin?: string
): Promise<{ job: FetchJobRow; container?: { resumeStart: string; systems: string[] } }> {
  const job = await getJob(db, jobId);
  if (!job) throw new Error('Job not found');
  if (!RESUMABLE_STATUSES.has(job.status)) {
    throw new Error(`Job cannot be resumed from status "${job.status}"`);
  }

  if (isContainerJob(job)) {
    const result = await resumeContainerJob(db, job, env);
    return {
      job: result.job,
      container: { resumeStart: result.resumeStart, systems: result.systems },
    };
  }

  await setFetchStopped(db, false);
  await db
    .prepare("UPDATE fetch_jobs SET status = 'running', updated_at = datetime('now') WHERE id = ?")
    .bind(jobId)
    .run();

  ctx.waitUntil(continueJobUntilDone(db, jobId, env, ctx, workerOrigin));
  const updated = await getJob(db, jobId);
  if (!updated) throw new Error('Job not found after resume');
  return { job: updated };
}
