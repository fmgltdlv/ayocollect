import { SYNC_CONFIG } from './config';
import { fetchDigalertTicket, ticketExists } from './fetch';

export function getJulianDay(date: Date): number {
  const start = new Date(date.getFullYear(), 0, 0);
  const diff = date.getTime() - start.getTime();
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}

export function buildDigalertTicketNumber(date: Date, counter: number): string {
  const yy = String(date.getFullYear()).slice(-2).padStart(2, '0');
  const jdd = String(getJulianDay(date)).padStart(3, '0');
  const xxx = String(counter).padStart(3, '0');
  return `A${yy}${jdd}0${xxx}`;
}

export function parseTargetDate(targetDate: string): Date {
  const y = parseInt(targetDate.slice(0, 4), 10);
  const m = parseInt(targetDate.slice(4, 6), 10);
  const d = parseInt(targetDate.slice(6, 8), 10);
  return new Date(y, m - 1, d);
}

export type DigalertEnumerateOptions = {
  targetDate: string;
  revision?: string;
  sessionCookies?: Record<string, string>;
  onTicketFound?: (ticketBase: string) => void;
};

export async function enumerateDigalertTicketsForDate(
  options: DigalertEnumerateOptions,
): Promise<string[]> {
  const { targetDate, revision = '00A', sessionCookies, onTicketFound } = options;
  const date = parseTargetDate(targetDate);
  const found: string[] = [];
  let consecutiveMisses = 0;

  for (let counter = SYNC_CONFIG.COUNTER_START; counter <= SYNC_CONFIG.COUNTER_END; counter++) {
    if (consecutiveMisses >= SYNC_CONFIG.CONSECUTIVE_MISS_LIMIT) break;

    const ticketBase = buildDigalertTicketNumber(date, counter);
    const ticketData = await fetchDigalertTicket(ticketBase, revision, sessionCookies);

    if (!ticketExists(ticketData)) {
      consecutiveMisses++;
    } else {
      consecutiveMisses = 0;
      found.push(ticketBase);
      onTicketFound?.(ticketBase);
    }

    await sleep(SYNC_CONFIG.THROTTLE_MS);
  }

  return found;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
