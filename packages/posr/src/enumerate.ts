import { SYNC_CONFIG, type UsanRegion } from './config';
import { fetchPosrTicket, isTicketMiss } from './searchtool';

export type EnumerateOptions = {
  targetDate: string;
  region?: UsanRegion;
  onTicketFound?: (ticketBase: string) => void;
};

export async function enumerateTicketsForDate(
  options: EnumerateOptions,
): Promise<string[]> {
  const { targetDate, region = 'NV', onTicketFound } = options;
  const found: string[] = [];
  let consecutiveMisses = 0;
  let seq = 1;

  while (consecutiveMisses < SYNC_CONFIG.CONSECUTIVE_MISS_LIMIT) {
    const ticketBase = buildTicketNumber(targetDate, seq);
    const response = await fetchPosrTicket(ticketBase, region);

    if (isTicketMiss(response)) {
      consecutiveMisses++;
    } else {
      consecutiveMisses = 0;
      found.push(ticketBase);
      onTicketFound?.(ticketBase);
    }

    seq++;
  }

  return found;
}

export function buildTicketNumber(date: string, seq: number): string {
  return `${date}${String(seq).padStart(5, '0')}`;
}

export function formatTodayPacific(): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = formatter.formatToParts(new Date());
  const y = parts.find((p) => p.type === 'year')?.value ?? '';
  const m = parts.find((p) => p.type === 'month')?.value ?? '';
  const d = parts.find((p) => p.type === 'day')?.value ?? '';
  return `${y}${m}${d}`;
}

export function isValidDateString(date: string): boolean {
  if (!/^\d{8}$/.test(date)) return false;
  const y = parseInt(date.slice(0, 4), 10);
  const m = parseInt(date.slice(4, 6), 10);
  const d = parseInt(date.slice(6, 8), 10);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

export function expandDateRange(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  const start = parseDate(startDate);
  const end = parseDate(endDate);
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    dates.push(formatDate(d));
  }
  return dates;
}

function parseDate(yyyymmdd: string): Date {
  const y = parseInt(yyyymmdd.slice(0, 4), 10);
  const m = parseInt(yyyymmdd.slice(4, 6), 10);
  const d = parseInt(yyyymmdd.slice(6, 8), 10);
  return new Date(y, m - 1, d);
}

function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}
