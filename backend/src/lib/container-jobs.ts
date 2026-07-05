import { getJob, type FetchJobRow } from '../jobs/processor';
import { compareDates } from './ticket-sequence';
import { setFetchStopped } from './settings';

export type ContainerSystemState = {
  batches: number;
  lastBatchAt: string | null;
  done: boolean;
  scanDate: string | null;
};

export type ContainerJobSystem = 'digalert' | 'usan-ca' | 'usan-nv';

const CONTAINER_IDLE_MS = 10 * 60 * 1000;
const CONTAINER_STALE_MS = 2 * 60 * 60 * 1000;

function jobHasIngestBatches(job: FetchJobRow): boolean {
  for (const key of ['digalert_cursor', 'usan_ca_cursor', 'usan_nv_cursor'] as const) {
    if (parseContainerState(job[key] as string | null).batches > 0) return true;
  }
  return false;
}

export function isContainerJob(job: FetchJobRow): boolean {
  return job.triggered_by === 'container';
}

export function emptyContainerState(): ContainerSystemState {
  return { batches: 0, lastBatchAt: null, done: false, scanDate: null };
}

/** Whether a container system still has date range left to scan (ignores stale done flags). */
export function containerSystemNeedsResume(
  state: ContainerSystemState,
  startDate: string,
  endDate: string
): boolean {
  const scanDate = state.scanDate ?? startDate;
  return compareDates(scanDate, endDate) < 0;
}

export function parseContainerState(raw: string | null): ContainerSystemState {
  if (!raw) return emptyContainerState();
  try {
    const o = JSON.parse(raw) as Partial<ContainerSystemState>;
    if (typeof o.batches === 'number') {
      return {
        batches: o.batches,
        lastBatchAt: o.lastBatchAt ?? null,
        done: !!o.done,
        scanDate: o.scanDate ?? null,
      };
    }
  } catch {
    /* legacy worker cursor — treat as empty container state */
  }
  return emptyContainerState();
}

function cursorField(system: ContainerJobSystem): keyof FetchJobRow {
  if (system === 'digalert') return 'digalert_cursor';
  if (system === 'usan-ca') return 'usan_ca_cursor';
  return 'usan_nv_cursor';
}

function fetchedField(system: ContainerJobSystem): keyof FetchJobRow {
  if (system === 'digalert') return 'digalert_fetched';
  if (system === 'usan-ca') return 'usan_ca_fetched';
  return 'usan_nv_fetched';
}

function includeField(system: ContainerJobSystem): keyof FetchJobRow {
  if (system === 'digalert') return 'include_digalert';
  if (system === 'usan-ca') return 'include_usan_ca';
  return 'include_usan_nv';
}

function initialContainerCursor(): string {
  return JSON.stringify(emptyContainerState());
}

export async function createContainerJob(
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
      body.triggeredBy ?? 'container',
      body.startDate,
      body.endDate,
      systems.has('digalert') ? 1 : 0,
      systems.has('usan-ca') ? 1 : 0,
      systems.has('usan-nv') ? 1 : 0,
      systems.has('digalert') ? initialContainerCursor() : null,
      systems.has('usan-ca') ? initialContainerCursor() : null,
      systems.has('usan-nv') ? initialContainerCursor() : null
    )
    .run();
  return Number(result.meta.last_row_id);
}

function scanDateFromBatchId(batchId: string, fallback: string): string {
  const match = batchId.match(/^(\d{4}-\d{2}-\d{2})/);
  return match?.[1] ?? fallback;
}

export async function recordContainerBatch(
  db: D1Database,
  jobId: number,
  system: ContainerJobSystem,
  accepted: number,
  failed: number,
  batchId: string
): Promise<void> {
  const job = await getJob(db, jobId);
  if (!job || !isContainerJob(job) || job.status !== 'running') return;
  if (!job[includeField(system)]) return;

  const cursorKey = cursorField(system);
  const fetchedKey = fetchedField(system);
  const state = parseContainerState(job[cursorKey] as string | null);
  state.batches += 1;
  state.lastBatchAt = new Date().toISOString();
  state.scanDate = scanDateFromBatchId(batchId, job.start_date);

  const fetched = Number(job[fetchedKey]) + accepted;
  const errorCount = Number(job.error_count) + failed;
  const lastError =
    failed > 0 ? `${system} batch ${batchId}: ${failed} ticket(s) failed ingest` : job.last_error;

  await db
    .prepare(
      `UPDATE fetch_jobs SET
        ${cursorKey} = ?,
        ${fetchedKey} = ?,
        error_count = ?,
        last_error = ?,
        updated_at = datetime('now')
       WHERE id = ?`
    )
    .bind(JSON.stringify(state), fetched, errorCount, lastError, jobId)
    .run();
}

export async function completeContainerJob(
  db: D1Database,
  jobId: number,
  body: {
    ok?: boolean;
    lastError?: string;
    systems?: Record<string, { ingest_errors?: number }>;
  }
): Promise<void> {
  const job = await getJob(db, jobId);
  if (!job || !isContainerJob(job) || !['running', 'paused'].includes(job.status)) return;

  const ingestErrors = Object.values(body.systems ?? {}).reduce(
    (sum, s) => sum + (s.ingest_errors ?? 0),
    0
  );
  const failed = body.ok === false || ingestErrors > 0;
  const status = failed ? 'failed' : 'completed';

  const updates: Record<string, string> = {};
  for (const system of ['digalert', 'usan-ca', 'usan-nv'] as const) {
    if (!job[includeField(system)]) continue;
    const state = parseContainerState(job[cursorField(system)] as string | null);
    if (!failed) {
      state.done = true;
      updates[cursorField(system)] = JSON.stringify(state);
    }
  }
  const lastError =
    body.lastError ??
    (ingestErrors > 0 ? `Scraper finished with ${ingestErrors} ingest error(s)` : null);

  await db
    .prepare(
      `UPDATE fetch_jobs SET
        status = ?,
        digalert_cursor = COALESCE(?, digalert_cursor),
        usan_ca_cursor = COALESCE(?, usan_ca_cursor),
        usan_nv_cursor = COALESCE(?, usan_nv_cursor),
        last_error = COALESCE(?, last_error),
        updated_at = datetime('now')
       WHERE id = ?`
    )
    .bind(
      status,
      updates.digalert_cursor ?? null,
      updates.usan_ca_cursor ?? null,
      updates.usan_nv_cursor ?? null,
      lastError,
      jobId
    )
    .run();
}

export async function failContainerJob(
  db: D1Database,
  jobId: number,
  lastError: string
): Promise<void> {
  await db
    .prepare(
      `UPDATE fetch_jobs SET status = 'failed', last_error = ?, updated_at = datetime('now') WHERE id = ?`
    )
    .bind(lastError, jobId)
    .run();
}

function parseDbDateTime(iso: string): number {
  const ms = Date.parse(iso.endsWith('Z') ? iso : `${iso}Z`);
  return Number.isFinite(ms) ? ms : 0;
}

/** Mark container jobs stale if the scraper has not reported in a while. */
export async function finalizeStaleContainerJobs(db: D1Database): Promise<number> {
  const { results } = await db
    .prepare(
      "SELECT * FROM fetch_jobs WHERE status = 'running' AND triggered_by = 'container'"
    )
    .all<FetchJobRow>();

  const now = Date.now();
  let finalized = 0;
  for (const job of results ?? []) {
    const updatedAt = parseDbDateTime(job.updated_at);
    const createdAt = parseDbDateTime(job.created_at);
    const idleMs = now - updatedAt;
    const ageMs = now - createdAt;

    if (!jobHasIngestBatches(job) && ageMs > CONTAINER_IDLE_MS) {
      await failContainerJob(
        db,
        job.id,
        'Scraper container stopped without ingesting data'
      );
      finalized += 1;
      continue;
    }

    if (idleMs > CONTAINER_STALE_MS) {
      await failContainerJob(
        db,
        job.id,
        'Scraper stopped reporting progress (no batch activity for 2+ hours)'
      );
      finalized += 1;
    }
  }
  return finalized;
}
