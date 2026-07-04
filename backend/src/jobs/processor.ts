import {
  fetchDigAlertRaw,
  fetchUsanPolygonWkt,
  fetchUsanPosr,
  ticketExistsUsan,
} from '../fetchers';
import { upsertDigAlert, upsertUsan } from '../db/upsert';
import { sleep } from '../lib/polygon';
import { workerScrapingEnabled } from '../lib/ingest-auth';
import { isFetchStopped, setFetchStopped } from '../lib/settings';
import {
  addDays,
  compareDates,
  formatDigAlertTicket,
  formatUsanTicket,
  parseDigAlertCursor,
  parseUsanCursor,
  type DigAlertCursor,
  type UsanCursor,
} from '../lib/ticket-sequence';
import {
  BATCH_SIZE,
  CONSECUTIVE_MISS_LIMIT,
  DIGALERT_MAX_COUNTER,
  FETCH_STAGGER_MS,
  USAN_CA_MAX_SEQ,
  USAN_NV_MAX_SEQ,
  type Env,
  type FetchJobStatus,
} from '../types';

export type FetchJobRow = {
  id: number;
  status: string;
  triggered_by: string;
  start_date: string;
  end_date: string;
  include_digalert: number;
  include_usan_ca: number;
  include_usan_nv: number;
  digalert_cursor: string | null;
  usan_ca_cursor: string | null;
  usan_nv_cursor: string | null;
  digalert_fetched: number;
  usan_ca_fetched: number;
  usan_nv_fetched: number;
  error_count: number;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

/** Max runtime per Worker slice — two slices + chain must fit in the 30s waitUntil limit */
const TIME_BUDGET_MS = 12_000;
/** Slices to run per tick before chaining to the next HTTP request */
const SLICES_PER_TICK = 2;
/** If a running job hasn't saved progress this long, treat auto-chain as lost */
export const STALE_JOB_MS = 60_000;

const activeAborts = new Map<number, AbortController>();
const runningSlices = new Set<number>();
const sliceStartedAt = new Map<number, number>();

export function abortJob(jobId: number): void {
  activeAborts.get(jobId)?.abort();
}

export function abortActiveBatch(): void {
  for (const ctrl of activeAborts.values()) ctrl.abort();
}

export async function cancelJob(db: D1Database, jobId: number): Promise<FetchJobRow | null> {
  abortJob(jobId);
  await db
    .prepare("UPDATE fetch_jobs SET status = 'cancelled', updated_at = datetime('now') WHERE id = ?")
    .bind(jobId)
    .run();
  return getJob(db, jobId);
}

export async function stopAllJobs(db: D1Database): Promise<number> {
  await setFetchStopped(db, true);
  abortActiveBatch();
  const result = await db
    .prepare(
      `UPDATE fetch_jobs SET status = 'cancelled', updated_at = datetime('now')
       WHERE status IN ('pending', 'running', 'paused')`
    )
    .run();
  return result.meta.changes ?? 0;
}

export async function createJob(
  db: D1Database,
  body: {
    systems: string[];
    startDate: string;
    endDate: string;
    triggeredBy?: string;
  }
): Promise<number> {
  await setFetchStopped(db, false);
  const systems = new Set(body.systems);
  const result = await db
    .prepare(
      `INSERT INTO fetch_jobs (
        status, triggered_by, start_date, end_date,
        include_digalert, include_usan_ca, include_usan_nv,
        digalert_cursor, usan_ca_cursor, usan_nv_cursor
      ) VALUES ('running', ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      body.triggeredBy ?? 'manual',
      body.startDate,
      body.endDate,
      systems.has('digalert') ? 1 : 0,
      systems.has('usan-ca') ? 1 : 0,
      systems.has('usan-nv') ? 1 : 0,
      JSON.stringify(parseDigAlertCursor(null, body.startDate)),
      JSON.stringify(parseUsanCursor(null, body.startDate)),
      JSON.stringify(parseUsanCursor(null, body.startDate))
    )
    .run();
  return Number(result.meta.last_row_id);
}

export async function getJob(db: D1Database, id: number): Promise<FetchJobRow | null> {
  return db.prepare('SELECT * FROM fetch_jobs WHERE id = ?').bind(id).first<FetchJobRow>();
}

export async function listJobs(db: D1Database, limit = 20): Promise<FetchJobRow[]> {
  const { results } = await db
    .prepare('SELECT * FROM fetch_jobs ORDER BY id DESC LIMIT ?')
    .bind(limit)
    .all<FetchJobRow>();
  return results ?? [];
}

async function saveJob(db: D1Database, job: FetchJobRow, status?: FetchJobStatus) {
  await db
    .prepare(
      `UPDATE fetch_jobs SET
        status = ?, digalert_cursor = ?, usan_ca_cursor = ?, usan_nv_cursor = ?,
        digalert_fetched = ?, usan_ca_fetched = ?, usan_nv_fetched = ?,
        error_count = ?, last_error = ?, updated_at = datetime('now')
       WHERE id = ?`
    )
    .bind(
      status ?? job.status,
      job.digalert_cursor,
      job.usan_ca_cursor,
      job.usan_nv_cursor,
      job.digalert_fetched,
      job.usan_ca_fetched,
      job.usan_nv_fetched,
      job.error_count,
      job.last_error,
      job.id
    )
    .run();
}

function isUsanSystemDone(cursor: UsanCursor, endDate: string): boolean {
  return compareDates(cursor.date, endDate) > 0;
}

function isDigAlertSystemDone(cursor: DigAlertCursor, endDate: string): boolean {
  return compareDates(cursor.date, endDate) > 0;
}

function isJobDone(job: FetchJobRow): boolean {
  if (job.include_digalert) {
    const c = parseDigAlertCursor(job.digalert_cursor, job.start_date);
    if (!isDigAlertSystemDone(c, job.end_date)) return false;
  }
  if (job.include_usan_ca) {
    const c = parseUsanCursor(job.usan_ca_cursor, job.start_date);
    if (!isUsanSystemDone(c, job.end_date)) return false;
  }
  if (job.include_usan_nv) {
    const c = parseUsanCursor(job.usan_nv_cursor, job.start_date);
    if (!isUsanSystemDone(c, job.end_date)) return false;
  }
  return true;
}

type WaveSlot = { ticket: string; seq: number; counter: number; date: string };

function buildUsanWave(cursor: UsanCursor, endDate: string, maxSeq: number): WaveSlot[] {
  const slots: WaveSlot[] = [];
  let date = cursor.date;
  let seq = cursor.seq;
  for (let i = 0; i < BATCH_SIZE; i++) {
    if (compareDates(date, endDate) > 0) break;
    slots.push({ ticket: formatUsanTicket(date, seq), seq, counter: seq, date });
    seq += 1;
    if (seq > maxSeq) {
      date = addDays(date, 1);
      seq = 1;
    }
  }
  return slots;
}

function buildDigAlertWave(cursor: DigAlertCursor, endDate: string): WaveSlot[] {
  const slots: WaveSlot[] = [];
  let date = cursor.date;
  let counter = cursor.counter;
  for (let i = 0; i < BATCH_SIZE; i++) {
    if (compareDates(date, endDate) > 0) break;
    const d = new Date(date + 'T12:00:00Z');
    slots.push({
      ticket: formatDigAlertTicket(d, counter),
      seq: counter,
      counter,
      date,
    });
    counter += 1;
    if (counter > DIGALERT_MAX_COUNTER) {
      date = addDays(date, 1);
      counter = 1;
    }
  }
  return slots;
}

function applyUsanWaveResults(
  cursor: UsanCursor,
  slots: WaveSlot[],
  existsResults: boolean[],
  maxSeq: number
): UsanCursor {
  let { date, seq, consecutiveMisses } = cursor;

  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i];
    if (compareDates(slot.date, date) !== 0 || slot.seq < seq) continue;

    if (existsResults[i]) {
      consecutiveMisses = 0;
    } else {
      consecutiveMisses += 1;
      if (consecutiveMisses >= CONSECUTIVE_MISS_LIMIT) {
        date = addDays(date, 1);
        seq = 1;
        consecutiveMisses = 0;
        return { date, seq, consecutiveMisses };
      }
    }
    seq = slot.seq + 1;
    if (seq > maxSeq) {
      date = addDays(date, 1);
      seq = 1;
      consecutiveMisses = 0;
    }
  }

  return { date, seq, consecutiveMisses };
}

function applyDigAlertWaveResults(
  cursor: DigAlertCursor,
  slots: WaveSlot[],
  existsResults: boolean[]
): DigAlertCursor {
  let { date, counter, consecutiveMisses } = cursor;

  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i];
    if (compareDates(slot.date, date) !== 0 || slot.counter < counter) continue;

    if (existsResults[i]) {
      consecutiveMisses = 0;
    } else {
      consecutiveMisses += 1;
      if (consecutiveMisses >= CONSECUTIVE_MISS_LIMIT) {
        date = addDays(date, 1);
        counter = 1;
        consecutiveMisses = 0;
        return { date, counter, consecutiveMisses };
      }
    }
    counter = slot.counter + 1;
    if (counter > DIGALERT_MAX_COUNTER) {
      date = addDays(date, 1);
      counter = 1;
      consecutiveMisses = 0;
    }
  }

  return { date, counter, consecutiveMisses };
}

async function processUsanWave(
  db: D1Database,
  job: FetchJobRow,
  system: 'ca' | 'nv',
  env: Env,
  signal: AbortSignal
): Promise<void> {
  const cursorKey = system === 'ca' ? 'usan_ca_cursor' : 'usan_nv_cursor';
  const fetchedKey = system === 'ca' ? 'usan_ca_fetched' : 'usan_nv_fetched';
  const maxSeq = system === 'ca' ? USAN_CA_MAX_SEQ : USAN_NV_MAX_SEQ;
  let cursor = parseUsanCursor(job[cursorKey], job.start_date);

  if (isUsanSystemDone(cursor, job.end_date)) return;

  const slots = buildUsanWave(cursor, job.end_date, maxSeq);
  if (!slots.length) {
    job[cursorKey] = JSON.stringify({ ...cursor, date: addDays(cursor.date, 1), seq: 1, consecutiveMisses: 0 });
    return;
  }

  const existsResults = await Promise.all(
    slots.map((s) => ticketExistsUsan(system, s.ticket, signal))
  );

  await Promise.all(
    slots.map(async (s, i) => {
      if (!existsResults[i] || signal.aborted) return;
      try {
        const posr = await fetchUsanPosr(system, s.ticket, signal);
        const polygon = await fetchUsanPolygonWkt(system, s.ticket, signal);
        if (posr) {
          const table = system === 'ca' ? 'usan_ca' : 'usan_nv';
          await upsertUsan(db, table, posr, polygon);
          job[fetchedKey] += 1;
        }
      } catch (e) {
        if (signal.aborted) throw e;
        job.error_count += 1;
        job.last_error = e instanceof Error ? e.message : String(e);
      }
    })
  );

  cursor = applyUsanWaveResults(cursor, slots, existsResults, maxSeq);
  job[cursorKey] = JSON.stringify(cursor);
}

async function processDigAlertWave(
  db: D1Database,
  job: FetchJobRow,
  env: Env,
  signal: AbortSignal
): Promise<void> {
  let cursor = parseDigAlertCursor(job.digalert_cursor, job.start_date);
  if (isDigAlertSystemDone(cursor, job.end_date)) return;

  const slots = buildDigAlertWave(cursor, job.end_date);
  if (!slots.length) {
    job.digalert_cursor = JSON.stringify({ ...cursor, date: addDays(cursor.date, 1), counter: 1, consecutiveMisses: 0 });
    return;
  }

  if (!slots.length) {
    job.digalert_cursor = JSON.stringify({
      date: addDays(cursor.date, 1),
      counter: 1,
      consecutiveMisses: 0,
    });
    return;
  }

  const existsResults: boolean[] = new Array(slots.length).fill(false);
  await Promise.all(
    slots.map(async (s, i) => {
      if (signal.aborted) return;
      try {
        const payload = await fetchDigAlertRaw(s.ticket, '00A', env, signal);
        if (!payload) return;
        existsResults[i] = true;
        await upsertDigAlert(db, payload);
        job.digalert_fetched += 1;
      } catch (e) {
        if (signal.aborted) throw e;
        job.error_count += 1;
        job.last_error = e instanceof Error ? e.message : String(e);
      }
    })
  );

  cursor = applyDigAlertWaveResults(cursor, slots, existsResults);
  job.digalert_cursor = JSON.stringify(cursor);
}

/** One round = up to 6 parallel fetches per enabled system (systems run in parallel). */
async function processOneRound(
  db: D1Database,
  job: FetchJobRow,
  env: Env,
  signal: AbortSignal
): Promise<void> {
  const tasks: Promise<void>[] = [];
  if (job.include_digalert) tasks.push(processDigAlertWave(db, job, env, signal));
  if (job.include_usan_ca) tasks.push(processUsanWave(db, job, 'ca', env, signal));
  if (job.include_usan_nv) tasks.push(processUsanWave(db, job, 'nv', env, signal));
  await Promise.all(tasks);
}

/**
 * Run continuously until job completes, stopped, or Worker time budget.
 * Chains immediately via waitUntil — no hourly wait between waves.
 */
export async function runJobSlice(db: D1Database, jobId: number, env: Env): Promise<FetchJobRow | null> {
  if (await isFetchStopped(db)) return getJob(db, jobId);
  if (runningSlices.has(jobId)) {
    const started = sliceStartedAt.get(jobId) ?? 0;
    if (Date.now() - started < TIME_BUDGET_MS + 5_000) return getJob(db, jobId);
    clearRunningSlice(jobId);
  }

  let job = await getJob(db, jobId);
  if (!job || job.status === 'cancelled' || job.status === 'completed' || job.status === 'paused') {
    return job;
  }

  runningSlices.add(jobId);
  sliceStartedAt.set(jobId, Date.now());
  const abort = new AbortController();
  activeAborts.set(jobId, abort);
  const signal = abort.signal;
  const deadlineTimer = setTimeout(() => abort.abort(), TIME_BUDGET_MS);

  try {
    while (!signal.aborted) {
      if (await isFetchStopped(db)) {
        await saveJob(db, job, 'cancelled');
        return { ...job, status: 'cancelled' };
      }

      job = (await getJob(db, jobId))!;
      if (!job || job.status !== 'running') return job;

      if (isJobDone(job)) {
        await saveJob(db, job, 'completed');
        return { ...job, status: 'completed' };
      }

      await processOneRound(db, job, env, signal);
      await saveJob(db, job, 'running');
      if (signal.aborted) break;
      await sleep(FETCH_STAGGER_MS);
    }

    return job;
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') {
      if (await isFetchStopped(db)) {
        await saveJob(db, job!, 'cancelled');
        return { ...job!, status: 'cancelled' };
      }
      await saveJob(db, job!, 'running');
      return { ...job!, status: 'running' };
    }
    job!.error_count += 1;
    job!.last_error = e instanceof Error ? e.message : String(e);
    await saveJob(db, job!, 'failed');
    return { ...job!, status: 'failed' };
  } finally {
    clearTimeout(deadlineTimer);
    runningSlices.delete(jobId);
    sliceStartedAt.delete(jobId);
    if (activeAborts.get(jobId) === abort) activeAborts.delete(jobId);
  }
}

function resolveWorkerOrigin(workerOrigin: string | undefined, env: Env): string | undefined {
  const url = workerOrigin ?? env.WORKER_URL;
  return url?.trim() || undefined;
}

/** Kick off the next slice via a fresh HTTP request (each tick gets its own 30s waitUntil budget). */
async function chainNextSlice(
  jobId: number,
  workerOrigin: string | undefined,
  env: Env
): Promise<void> {
  const origin = resolveWorkerOrigin(workerOrigin, env);
  if (!origin) {
    console.error(`job ${jobId} chain skipped — set WORKER_URL in wrangler.toml`);
    return;
  }

  const url = `${origin.replace(/\/$/, '')}/api/jobs/${jobId}/tick`;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, { method: 'POST' });
      if (res.ok) return;
      console.error(`job ${jobId} chain attempt ${attempt} failed`, res.status, await res.text());
    } catch (e) {
      console.error(`job ${jobId} chain attempt ${attempt} failed`, e);
    }
    if (attempt < 3) await sleep(300 * attempt);
  }
}

function triggerNextSlice(
  jobId: number,
  env: Env,
  ctx: ExecutionContext,
  workerOrigin?: string
): void {
  ctx.waitUntil(chainNextSlice(jobId, workerOrigin, env));
}

function scheduleNextSlice(
  jobId: number,
  workerOrigin: string | undefined,
  env: Env,
  ctx: ExecutionContext
): void {
  triggerNextSlice(jobId, env, ctx, workerOrigin);
}

function parseDbDateTime(value: string): number {
  return Date.parse(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`);
}

function clearRunningSlice(jobId: number): void {
  activeAborts.get(jobId)?.abort();
  runningSlices.delete(jobId);
  sliceStartedAt.delete(jobId);
}

/** Chain slices until the job finishes — each slice triggers the next via a new HTTP tick. */
export async function continueJobUntilDone(
  db: D1Database,
  jobId: number,
  env: Env,
  ctx: ExecutionContext,
  workerOrigin?: string
): Promise<void> {
  for (let round = 0; round < SLICES_PER_TICK; round++) {
    if (await isFetchStopped(db)) return;
    const job = await runJobSlice(db, jobId, env);
    if (!job || job.status !== 'running') return;
  }
  if (!(await isFetchStopped(db))) {
    await chainNextSlice(jobId, workerOrigin, env);
  }
}

/** Nudge stalled running jobs via a new HTTP tick (reliable vs waitUntil recovery). */
export function kickStaleRunningJobs(db: D1Database, env: Env, workerOrigin?: string): void {
  if (!workerScrapingEnabled(env)) return;
  const origin = resolveWorkerOrigin(workerOrigin, env);
  if (!origin) return;

  void (async () => {
    if (await isFetchStopped(db)) return;
    const { results } = await db
      .prepare("SELECT id, updated_at FROM fetch_jobs WHERE status = 'running'")
      .all<{ id: number; updated_at: string }>();
    const now = Date.now();
    for (const row of results ?? []) {
      if (now - parseDbDateTime(row.updated_at) <= STALE_JOB_MS) continue;
      const url = `${origin.replace(/\/$/, '')}/api/jobs/${row.id}/tick`;
      fetch(url, { method: 'POST' }).catch((e) => console.error(`kick stale job ${row.id}`, e));
      break;
    }
  })();
}

/** Resume any running jobs that lost their auto-chain (e.g. Worker isolate restarted). */
export async function resumeStalledJobs(
  db: D1Database,
  env: Env,
  _ctx: ExecutionContext,
  workerOrigin?: string
): Promise<number> {
  kickStaleRunningJobs(db, env, workerOrigin);
  const { results } = await db
    .prepare("SELECT id FROM fetch_jobs WHERE status = 'running'")
    .all<{ id: number }>();
  return results?.length ?? 0;
}

/** @deprecated alias — runs one continuous slice (chains via continueJobUntilDone) */
export async function processBatch(db: D1Database, jobId: number, env: Env): Promise<FetchJobRow | null> {
  return runJobSlice(db, jobId, env);
}

export async function runCron(db: D1Database, env: Env, ctx: ExecutionContext): Promise<void> {
  if (!workerScrapingEnabled(env)) return;
  if (await isFetchStopped(db)) return;

  const enabled =
    (await db.prepare("SELECT value FROM app_settings WHERE key = 'auto_fetch_enabled'").first<{ value: string }>())
      ?.value === '1';

  if (!enabled) return;

  const timeUtc =
    (await db.prepare("SELECT value FROM app_settings WHERE key = 'auto_fetch_time_utc'").first<{ value: string }>())
      ?.value ?? '06:00';
  const lastRun =
    (await db.prepare("SELECT value FROM app_settings WHERE key = 'auto_fetch_last_run_date'").first<{ value: string }>())
      ?.value ?? '';
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const [hh] = timeUtc.split(':').map(Number);

  if (lastRun !== today && now.getUTCHours() === hh) {
    const lookback = Number(
      (await db.prepare("SELECT value FROM app_settings WHERE key = 'auto_fetch_lookback_days'").first<{ value: string }>())
        ?.value ?? '1'
    );
    const endDate = today;
    const start = new Date(now);
    start.setUTCDate(start.getUTCDate() - lookback);
    const startDate = start.toISOString().slice(0, 10);
    const systems: string[] = [];
    if (
      (await db.prepare("SELECT value FROM app_settings WHERE key = 'auto_fetch_include_digalert'").first<{ value: string }>())
        ?.value === '1'
    )
      systems.push('digalert');
    if (
      (await db.prepare("SELECT value FROM app_settings WHERE key = 'auto_fetch_include_usan_ca'").first<{ value: string }>())
        ?.value === '1'
    )
      systems.push('usan-ca');
    if (
      (await db.prepare("SELECT value FROM app_settings WHERE key = 'auto_fetch_include_usan_nv'").first<{ value: string }>())
        ?.value === '1'
    )
      systems.push('usan-nv');

    if (systems.length) {
      const id = await createJob(db, { systems, startDate, endDate, triggeredBy: 'cron' });
      await db.prepare("UPDATE app_settings SET value = ? WHERE key = 'auto_fetch_last_run_date'").bind(today).run();
      ctx.waitUntil(continueJobUntilDone(db, id, env, ctx, env.WORKER_URL));
    }
  }

  ctx.waitUntil(resumeStalledJobs(db, env, ctx, env.WORKER_URL));
}
