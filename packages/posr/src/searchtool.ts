import type { PosrSearchToolResponse } from '@ayocollect/db';
import { SYNC_CONFIG, buildPosrUrl, type UsanRegion } from './config';

export function isTicketMiss(response: PosrSearchToolResponse | null): boolean {
  if (!response) return true;
  if (!response.isSuccessful) return true;
  if (!response.posrTicket) return true;
  return false;
}

export async function fetchPosrTicket(
  ticketBase: string,
  region: UsanRegion = 'NV',
): Promise<PosrSearchToolResponse | null> {
  const url = buildPosrUrl(ticketBase, region);
  let lastError: unknown;

  for (let attempt = 0; attempt <= SYNC_CONFIG.RETRY_COUNT; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), SYNC_CONFIG.TIMEOUT_MS);
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      });
      clearTimeout(timeout);

      if (!res.ok) {
        if (res.status === 404) return { isSuccessful: false, posrTicket: null };
        throw new Error(`POSR HTTP ${res.status}`);
      }

      return (await res.json()) as PosrSearchToolResponse;
    } catch (err) {
      lastError = err;
      if (attempt < SYNC_CONFIG.RETRY_COUNT) {
        await sleep(SYNC_CONFIG.RETRY_BACKOFF_MS);
      }
    }
  }

  console.error(`fetchPosrTicket failed for ${ticketBase}:`, lastError);
  return null;
}

export function getRevisionNumbers(ticket: NonNullable<PosrSearchToolResponse['posrTicket']>): string[] {
  const revisions = new Set<string>();
  if (ticket.ticketNumber) revisions.add(ticket.ticketNumber);
  for (const entry of ticket.ticketHistory ?? []) {
    if (entry.requestNumber) revisions.add(entry.requestNumber);
  }
  return [...revisions];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
