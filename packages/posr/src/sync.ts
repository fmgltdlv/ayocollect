import type { IngestTicketMessage, PolygonIngestPayload } from '@ayocollect/db';
import { computeBbox, fetchMapHtml, parseMapPolygon, wktToGeoJson } from '@ayocollect/gml';
import { SYNC_CONFIG, type UsanRegion } from './config';
import { fetchPosrTicket, getRevisionNumbers } from './searchtool';

export type SyncTicketResult = {
  ticketBase: string;
  success: boolean;
  message?: IngestTicketMessage;
};

export async function fetchTicketBundle(
  ticketBase: string,
  region: UsanRegion = 'NV',
): Promise<SyncTicketResult> {
  const posr = await fetchPosrTicket(ticketBase, region);
  if (!posr?.isSuccessful || !posr.posrTicket) {
    return { ticketBase, success: false };
  }

  const revisions = getRevisionNumbers(posr.posrTicket);
  const polygons: PolygonIngestPayload[] = [];

  for (const requestNumber of revisions) {
    const html = await fetchMapHtml(requestNumber, region);
    if (!html) continue;

    const wktString = parseMapPolygon(html);
    if (!wktString) continue;
    const polygon = wktToGeoJson(wktString);
    if (!polygon) continue;

    polygons.push({
      requestNumber,
      geojson: JSON.stringify(polygon),
      bbox: computeBbox(polygon),
      mapHtml: html,
    });
  }

  return {
    ticketBase,
    success: true,
    message: {
      type: 'ingest-ticket',
      region,
      ticketBase,
      payload: JSON.stringify(posr),
      polygons,
    },
  };
}

export async function fetchTicketsBatched(
  ticketBases: string[],
  region: UsanRegion = 'NV',
  onProgress?: (done: number, total: number) => void,
): Promise<SyncTicketResult[]> {
  const results: SyncTicketResult[] = [];

  for (let i = 0; i < ticketBases.length; i += SYNC_CONFIG.MAX_CONCURRENT) {
    const batch = ticketBases.slice(i, i + SYNC_CONFIG.MAX_CONCURRENT);
    const batchResults = await Promise.all(
      batch.map((ticketBase) => fetchTicketBundle(ticketBase, region)),
    );
    results.push(...batchResults);
    onProgress?.(Math.min(i + SYNC_CONFIG.MAX_CONCURRENT, ticketBases.length), ticketBases.length);

    if (i + SYNC_CONFIG.MAX_CONCURRENT < ticketBases.length) {
      await new Promise((r) => setTimeout(r, SYNC_CONFIG.BATCH_INTERVAL_MS));
    }
  }

  return results;
}

export function passesCreatedByFilter(
  createdBy: string | undefined,
  allowlist: string | undefined,
): boolean {
  if (!allowlist?.trim()) return true;
  if (!createdBy) return false;
  const allowed = allowlist.split(',').map((s) => s.trim().toLowerCase());
  return allowed.includes(createdBy.toLowerCase());
}
