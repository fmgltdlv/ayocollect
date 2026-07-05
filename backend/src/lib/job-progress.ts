import type { FetchJobRow } from '../jobs/processor';
import {
  formatDigAlertTicket,
  formatUsanTicket,
  parseDigAlertCursor,
  parseUsanCursor,
  compareDates,
} from './ticket-sequence';
import { BATCH_SIZE } from '../types';
import { isContainerJob, parseContainerState } from './container-jobs';

export type SystemProgress = {
  enabled: boolean;
  fetched: number;
  currentDate: string;
  consecutiveMisses: number;
  nextTicket: string | null;
  done: boolean;
  dateProgressPct: number | null;
  detail: string;
};

export type JobProgress = {
  jobId: number;
  status: string;
  dateRange: { start: string; end: string };
  errorCount: number;
  lastError: string | null;
  triggeredBy: string;
  createdAt: string;
  updatedAt: string;
  batchSize: number;
  systemsComplete: number;
  systemsActive: number;
  systems: {
    digalert: SystemProgress;
    usanCa: SystemProgress;
    usanNv: SystemProgress;
  };
};

function daysInclusive(start: string, end: string): number {
  const s = new Date(start + 'T12:00:00Z');
  const e = new Date(end + 'T12:00:00Z');
  return Math.max(1, Math.round((e.getTime() - s.getTime()) / 86400000) + 1);
}

function dateProgressPct(start: string, end: string, current: string): number | null {
  if (compareDates(current, end) > 0) return 100;
  if (compareDates(current, start) < 0) return 0;
  const total = daysInclusive(start, end);
  const done = daysInclusive(start, current);
  return Math.min(100, Math.round((done / total) * 100));
}

function usanProgress(
  enabled: boolean,
  raw: string | null,
  fetched: number,
  start: string,
  end: string
): SystemProgress {
  if (!enabled) {
    return {
      enabled: false,
      fetched: 0,
      currentDate: start,
      consecutiveMisses: 0,
      nextTicket: null,
      done: true,
      dateProgressPct: null,
      detail: 'Not included in this job',
    };
  }
  const c = parseUsanCursor(raw, start);
  const done = compareDates(c.date, end) > 0;
  const nextTicket = done ? null : formatUsanTicket(c.date, c.seq);
  const pct = dateProgressPct(start, end, c.date);
  return {
    enabled: true,
    fetched,
    currentDate: c.date,
    consecutiveMisses: c.consecutiveMisses,
    nextTicket,
    done,
    dateProgressPct: pct,
    detail: done
      ? 'Finished scanning date range'
      : `Scanning ${c.date}, sequence ${c.seq} (next: ${nextTicket})`,
  };
}

function digAlertProgress(
  enabled: boolean,
  raw: string | null,
  fetched: number,
  start: string,
  end: string
): SystemProgress {
  if (!enabled) {
    return {
      enabled: false,
      fetched: 0,
      currentDate: start,
      consecutiveMisses: 0,
      nextTicket: null,
      done: true,
      dateProgressPct: null,
      detail: 'Not included in this job',
    };
  }
  const c = parseDigAlertCursor(raw, start);
  const done = compareDates(c.date, end) > 0;
  const d = new Date(c.date + 'T12:00:00Z');
  const nextTicket = done ? null : formatDigAlertTicket(d, c.counter);
  const pct = dateProgressPct(start, end, c.date);
  return {
    enabled: true,
    fetched,
    currentDate: c.date,
    consecutiveMisses: c.consecutiveMisses,
    nextTicket,
    done,
    dateProgressPct: pct,
    detail: done
      ? fetched
        ? 'Finished scanning date range'
        : 'No DigAlert tickets in range (Southern CA only)'
      : `Scanning ${c.date}, counter ${c.counter} (next: ${nextTicket})`,
  };
}

function containerSystemProgress(
  enabled: boolean,
  raw: string | null,
  fetched: number,
  start: string,
  end: string,
  system: 'digalert' | 'usan'
): SystemProgress {
  if (!enabled) {
    return {
      enabled: false,
      fetched: 0,
      currentDate: start,
      consecutiveMisses: 0,
      nextTicket: null,
      done: true,
      dateProgressPct: null,
      detail: 'Not included in this job',
    };
  }
  const state = parseContainerState(raw);
  const current = state.date ?? state.scanDate ?? start;
  const done = state.done || compareDates(current, end) > 0;
  const pct = done ? 100 : dateProgressPct(start, end, current);
  const activity = state.lastBatchAt
    ? ` · last batch ${state.lastBatchAt.replace('T', ' ').slice(0, 19)} UTC`
    : '';
  let nextTicket: string | null = null;
  if (!done && state.date) {
    if (system === 'digalert' && state.counter != null) {
      nextTicket = formatDigAlertTicket(new Date(state.date + 'T12:00:00Z'), state.counter);
    } else if (system === 'usan' && state.seq != null) {
      nextTicket = formatUsanTicket(state.date, state.seq);
    }
  }
  const ticketNote =
    nextTicket && state.lastTicket
      ? ` · resume from ${nextTicket} (after ${state.lastTicket})`
      : nextTicket
        ? ` · resume from ${nextTicket}`
        : '';
  return {
    enabled: true,
    fetched,
    currentDate: current,
    consecutiveMisses: state.consecutiveMisses ?? 0,
    nextTicket,
    done,
    dateProgressPct: pct,
    detail: done
      ? `Finished — ${state.batches} batch(es) ingested, ${fetched} ticket(s)`
      : state.batches
        ? `${state.batches} batch(es) ingested, ${fetched} ticket(s)${ticketNote}${activity}`
        : 'Waiting for scraper batches…',
  };
}

export function buildJobProgress(job: FetchJobRow): JobProgress {
  const container = isContainerJob(job);
  const systems = container
    ? {
        digalert: containerSystemProgress(
          !!job.include_digalert,
          job.digalert_cursor,
          job.digalert_fetched,
          job.start_date,
          job.end_date,
          'digalert'
        ),
        usanCa: containerSystemProgress(
          !!job.include_usan_ca,
          job.usan_ca_cursor,
          job.usan_ca_fetched,
          job.start_date,
          job.end_date,
          'usan'
        ),
        usanNv: containerSystemProgress(
          !!job.include_usan_nv,
          job.usan_nv_cursor,
          job.usan_nv_fetched,
          job.start_date,
          job.end_date,
          'usan'
        ),
      }
    : {
        digalert: digAlertProgress(
          !!job.include_digalert,
          job.digalert_cursor,
          job.digalert_fetched,
          job.start_date,
          job.end_date
        ),
        usanCa: usanProgress(
          !!job.include_usan_ca,
          job.usan_ca_cursor,
          job.usan_ca_fetched,
          job.start_date,
          job.end_date
        ),
        usanNv: usanProgress(
          !!job.include_usan_nv,
          job.usan_nv_cursor,
          job.usan_nv_fetched,
          job.start_date,
          job.end_date
        ),
      };
  const active = [systems.digalert, systems.usanCa, systems.usanNv].filter((s) => s.enabled);
  const systemsComplete = active.filter((s) => s.done).length;

  return {
    jobId: job.id,
    status: job.status,
    dateRange: { start: job.start_date, end: job.end_date },
    errorCount: job.error_count,
    lastError: job.last_error,
    triggeredBy: job.triggered_by,
    createdAt: job.created_at,
    updatedAt: job.updated_at,
    batchSize: BATCH_SIZE,
    systemsComplete,
    systemsActive: active.length,
    systems,
  };
}
