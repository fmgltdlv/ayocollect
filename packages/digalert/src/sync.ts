import type { IngestTicketMessage, PolygonIngestPayload } from '@ayocollect/db';
import { SYNC_CONFIG } from './config';
import { fetchCompleteTicketBundle } from './fetch';
import { computeBbox, extractPolygonFromTicket, ringToGeoJson } from './polygon';

export type DigalertSyncResult = {
  ticketBase: string;
  success: boolean;
  message?: IngestTicketMessage;
};

export async function fetchDigalertTicketBundle(
  ticketBase: string,
  revision: string = '00A',
  sessionCookies?: Record<string, string>,
): Promise<DigalertSyncResult> {
  const bundle = await fetchCompleteTicketBundle(ticketBase, revision, sessionCookies);
  if (!bundle) {
    return { ticketBase, success: false };
  }

  const ring = extractPolygonFromTicket(bundle.ticketData);
  if (!ring) {
    return { ticketBase, success: false };
  }

  const polygon = ringToGeoJson(ring);

  const polygons: PolygonIngestPayload[] = [
    {
      requestNumber: bundle.requestNumber,
      geojson: JSON.stringify(polygon),
      bbox: computeBbox(ring),
      mapHtml: null,
    },
  ];

  return {
    ticketBase,
    success: true,
    message: {
      type: 'ingest-ticket',
      region: 'DA',
      ticketBase,
      payload: JSON.stringify(bundle),
      polygons,
    },
  };
}

export async function fetchDigalertTicketsBatched(
  ticketBases: string[],
  revision: string = '00A',
  sessionCookies?: Record<string, string>,
): Promise<DigalertSyncResult[]> {
  const results: DigalertSyncResult[] = [];

  for (let i = 0; i < ticketBases.length; i += SYNC_CONFIG.MAX_CONCURRENT) {
    const batch = ticketBases.slice(i, i + SYNC_CONFIG.MAX_CONCURRENT);
    const batchResults = await Promise.all(
      batch.map((ticketBase) => fetchDigalertTicketBundle(ticketBase, revision, sessionCookies)),
    );
    results.push(...batchResults);

    if (i + SYNC_CONFIG.MAX_CONCURRENT < ticketBases.length) {
      await new Promise((r) => setTimeout(r, SYNC_CONFIG.BATCH_INTERVAL_MS));
    }
  }

  return results;
}

export function passesCallerFilter(
  caller: string | undefined,
  allowlist: string | undefined,
): boolean {
  if (!allowlist?.trim()) return true;
  if (!caller) return false;
  const allowed = allowlist.split(',').map((s) => s.trim().toLowerCase());
  return allowed.includes(caller.toLowerCase());
}
