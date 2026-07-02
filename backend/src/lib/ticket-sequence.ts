import { MAX_TICKETS_PER_DAY } from '../types';

export type DigAlertCursor = { date: string; counter: number; consecutiveMisses: number };
export type UsanCursor = { date: string; seq: number; consecutiveMisses: number };

export function parseUsanCursor(raw: string | null, startDate: string): UsanCursor {
  if (!raw) return { date: startDate, seq: 1, consecutiveMisses: 0 };
  try {
    return JSON.parse(raw) as UsanCursor;
  } catch {
    return { date: startDate, seq: 1, consecutiveMisses: 0 };
  }
}

export function parseDigAlertCursor(raw: string | null, startDate: string): DigAlertCursor {
  if (!raw) return { date: startDate, counter: 1, consecutiveMisses: 0 };
  try {
    return JSON.parse(raw) as DigAlertCursor;
  } catch {
    return { date: startDate, counter: 1, consecutiveMisses: 0 };
  }
}

export function formatUsanTicket(date: string, seq: number): string {
  return `${date.replace(/-/g, '')}${String(seq).padStart(5, '0')}-000`;
}

export function julianDay(d: Date): number {
  const start = new Date(Date.UTC(d.getUTCFullYear(), 0, 0));
  const diff = d.getTime() - start.getTime();
  return Math.floor(diff / 86400000);
}

export function formatDigAlertTicket(d: Date, counter: number): string {
  const yy = String(d.getUTCFullYear()).slice(-2);
  const jdd = String(julianDay(d)).padStart(3, '0');
  const xxx = counter <= 999 ? String(counter).padStart(3, '0') : String(counter);
  return `A${yy}${jdd}0${xxx}`;
}

export function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function compareDates(a: string, b: string): number {
  return a.localeCompare(b);
}

export function nextUsanCandidates(cursor: UsanCursor, endDate: string, count: number): {
  tickets: string[];
  cursor: UsanCursor;
  done: boolean;
} {
  const tickets: string[] = [];
  let c = { ...cursor };
  let done = false;

  while (tickets.length < count) {
    if (compareDates(c.date, endDate) > 0) {
      done = true;
      break;
    }
    tickets.push(formatUsanTicket(c.date, c.seq));
    c.seq += 1;
    if (c.seq > MAX_TICKETS_PER_DAY) {
      c.date = addDays(c.date, 1);
      c.seq = 1;
      c.consecutiveMisses = 0;
    }
  }

  return { tickets, cursor: c, done };
}

export function nextDigAlertCandidates(
  cursor: DigAlertCursor,
  endDate: string,
  count: number
): { tickets: string[]; cursor: DigAlertCursor; done: boolean } {
  const tickets: string[] = [];
  let c = { ...cursor };
  let done = false;

  while (tickets.length < count) {
    if (compareDates(c.date, endDate) > 0) {
      done = true;
      break;
    }
    const d = new Date(c.date + 'T12:00:00Z');
    tickets.push(formatDigAlertTicket(d, c.counter));
    c.counter += 1;
    if (c.counter > MAX_TICKETS_PER_DAY) {
      c.date = addDays(c.date, 1);
      c.counter = 1;
      c.consecutiveMisses = 0;
    }
  }

  return { tickets, cursor: c, done };
}

export function advanceUsanAfterMiss(cursor: UsanCursor, endDate: string): { cursor: UsanCursor; done: boolean } {
  const c = { ...cursor, consecutiveMisses: cursor.consecutiveMisses + 1 };
  if (c.consecutiveMisses >= 2) {
    c.date = addDays(c.date, 1);
    c.seq = 1;
    c.consecutiveMisses = 0;
  }
  return { cursor: c, done: compareDates(c.date, endDate) > 0 };
}

export function advanceDigAlertAfterMiss(cursor: DigAlertCursor, endDate: string): {
  cursor: DigAlertCursor;
  done: boolean;
} {
  const c = { ...cursor, consecutiveMisses: cursor.consecutiveMisses + 1 };
  if (c.consecutiveMisses >= 2) {
    c.date = addDays(c.date, 1);
    c.counter = 1;
    c.consecutiveMisses = 0;
  }
  return { cursor: c, done: compareDates(c.date, endDate) > 0 };
}
