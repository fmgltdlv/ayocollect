import {
  fetchDigAlertRaw,
  fetchUsanPolygonWkt,
  fetchUsanPosr,
  ticketExistsDigAlert,
  ticketExistsUsan,
} from '../fetchers';
import { upsertDigAlert, upsertUsan } from '../db/upsert';
import { sleep } from '../lib/polygon';
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
import { BATCH_SIZE, FETCH_STAGGER_MS, type Env, type FetchJobStatus } from '../types';

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

/** Max runtime per Worker slice before chaining another via waitUntil */
const TIME_BUDGET_MS = 28_000;

let activeAbort: AbortController | null = null;

export function abortActiveBatch(): void {
  activeAbort?.abort();
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

function buildUsanWave(cursor: UsanCursor, endDate: string): WaveSlot[] {
  const slots: WaveSlot[] = [];
  let date = cursor.date;
  let seq = cursor.seq;
  for (let i = 0; i < BATCH_SIZE; i++) {
    if (compareDates(date, endDate) > 0) break;
    slots.push({ ticket: formatUsanTicket(date, seq), seq, counter: seq, date });
    seq += 1;
    if (seq > 99999) {
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
    if (counter > 999) {
      date = addDays(date, 1);
      counter = 1;
    }
  }
  return slots;
}

function applyUsanWaveResults(
  cursor: UsanCursor,
  endDate: string,
  slots: WaveSlot[],
  existsResults: boolean[]
): UsanCursor {
  let { date, seq, consecutiveMisses } = cursor;

  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i];
    if (compareDates(slot.date, date) !== 0 || slot.seq < seq) continue;

    if (existsResults[i]) {
      consecutiveMisses = 0;
    } else {
      consecutiveMisses += 1;
      if (consecutiveMisses >= 2) {
        date = addDays(date, 1);
        seq = 1;
        consecutiveMisses = 0;
        return { date, seq, consecutiveMisses };
      }
    }
    seq = slot.seq + 1;
    if (seq > 99999) {
      date = addDays(date, 1);
      seq = 1;
      consecutiveMisses = 0;
    }
  }

  return { date, seq, consecutiveMisses };
}

function applyDigAlertWaveResults(
  cursor: DigAlertCursor,
  endDate: string,
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
      if (consecutiveMisses >= 2) {
        date = addDays(date, 1);
        counter = 1;
        consecutiveMisses = 0;
        return { date, counter, consecutiveMisses };
      }
    }
    counter = slot.counter + 1;
    if (counter > 999) {
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
  let cursor = parseUsanCursor(job[cursorKey], job.start_date);

  if (isUsanSystemDone(cursor, job.end_date)) return;

  const slots = buildUsanWave(cursor, job.end_date);
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

  cursor = applyUsanWaveResults(cursor, job.end_date, slots, existsResults);
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

  const existsResults = await Promise.all(
    slots.map((s) => ticketExistsDigAlert(s.ticket, env, signal))
  );

  await Promise.all(
    slots.map(async (s, i) => {
      if (!existsResults[i] || signal.aborted) return;
      try {
        const payload = await fetchDigAlertRaw(s.ticket, '00A', env, signal);
        if (payload) {
          await upsertDigAlert(db, payload);
          job.digalert_fetched += 1;
        }
      } catch (e) {
        if (signal.aborted) throw e;
        job.error_count += 1;
        job.last_error = e instanceof Error ? e.message : String(e);
      }
    })
  );

  cursor = applyDigAlertWaveResults(cursor, job.end_date, slots, existsResults);
  job.digalert_cursor = JSON.stringify(cursor);
}

/** One round = up to 6 parallel fetches per enabled system (Python-style day advance). */
async function processOneRound(
  db: D1Database,
  job: FetchJobRow,
  env: Env,
  signal: AbortSignal
): Promise<void> {
  if (job.include_digalert) await processDigAlertWave(db, job, env, signal);
  if (job.include_usan_ca) await processUsanWave(db, job, 'ca', env, signal);
  if (job.include_usan_nv) await processUsanWave(db, job, 'nv', env, signal);
}

/**
 * Run continuously until job completes, stopped, or Worker time budget.
 * Chains immediately via waitUntil — no hourly wait between waves.
 */
export async function runJobSlice(db: D1Database, jobId: number, env: Env): Promise<FetchJobRow | null> {
  if (await isFetchStopped(db)) return getJob(db, jobId);

  let job = await getJob(db, jobId);
  if (!job || job.status === 'cancelled' || job.status === 'completed' || job.status === 'paused') {
    return job;
  }

  activeAbort = new AbortController();
  const signal = activeAbort.signal;
  const deadline = Date.now() + TIME_BUDGET_MS;

  try {
    while (Date.now() < deadline) {
      if (signal.aborted || (await isFetchStopped(db))) {
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
      await sleep(FETCH_STAGGER_MS);
    }

    return job;
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') {
      await saveJob(db, job!, 'cancelled');
      return { ...job!, status: 'cancelled' };
    }
    job!.error_count += 1;
    job!.last_error = e instanceof Error ? e.message : String(e);
    await saveJob(db, job!, 'failed');
    return { ...job!, status: 'failed' };
  } finally {
    activeAbort = null;
  }
}

/** Chain slices until the job finishes — no delay between slices except ~100ms throttle. */
export async function continueJobUntilDone(
  db: D1Database,
  jobId: number,
  env: Env,
  ctx: ExecutionContext
): Promise<void> {
  const job = await runJobSlice(db, jobId, env);
  if (!job) return;
  if (job.status === 'running' && !(await isFetchStopped(db))) {
    ctx.waitUntil(continueJobUntilDone(db, jobId, env, ctx));
  }
}

/** @deprecated alias — runs one continuous slice (chains via continueJobUntilDone) */
export async function processBatch(db: D1Database, jobId: number, env: Env): Promise<FetchJobRow | null> {
  return runJobSlice(db, jobId, env);
}

export async function runCron(db: D1Database, env: Env, ctx: ExecutionContext): Promise<void> {
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
      ctx.waitUntil(continueJobUntilDone(db, id, env, ctx));
    }
  }
}
