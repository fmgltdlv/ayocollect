import type { DigAlertPayload } from '../fetchers';
import { upsertDigAlert, upsertUsan } from '../db/upsert';
import { recordContainerBatch, type ContainerJobSystem } from './container-jobs';

export const MAX_INGEST_BATCH_SIZE = 100;

export type IngestBatchMeta = {
  batchId: string;
  scrapedAt?: string;
  /** Links ingest batches to a container job in fetch_jobs */
  jobId?: number;
};

export type IngestBatchResult = IngestBatchMeta & {
  accepted: number;
  failed: number;
  errors: { ticket: string | null; error: string }[];
};

export type DigAlertIngestBody = IngestBatchMeta & {
  tickets: DigAlertPayload[];
};

export type UsanIngestTicket = {
  /** Full POSR JSON — same shape as fetchUsanPosr returns */
  payload: Record<string, unknown>;
  polygonWkt?: string | null;
};

export type UsanIngestBody = IngestBatchMeta & {
  tickets: UsanIngestTicket[];
};

function ticketLabelDigAlert(envelope: DigAlertPayload): string | null {
  const t = envelope.data?.ticket;
  return t != null ? String(t) : null;
}

function ticketLabelUsan(item: UsanIngestTicket): string | null {
  const posr = item.payload?.posrTicket as Record<string, unknown> | undefined;
  const t = posr?.ticketNumber;
  return t != null ? String(t) : null;
}

function validateBatchMeta(body: IngestBatchMeta): string | null {
  if (!body.batchId?.trim()) return 'batchId required';
  if (!Array.isArray((body as { tickets?: unknown }).tickets)) return 'tickets array required';
  return null;
}

export async function ingestDigAlertBatch(
  db: D1Database,
  body: DigAlertIngestBody
): Promise<IngestBatchResult | { error: string }> {
  const metaErr = validateBatchMeta(body);
  if (metaErr) return { error: metaErr };
  if (body.tickets.length > MAX_INGEST_BATCH_SIZE) {
    return { error: `tickets exceeds max batch size (${MAX_INGEST_BATCH_SIZE})` };
  }

  const errors: IngestBatchResult['errors'] = [];
  let accepted = 0;

  for (const envelope of body.tickets) {
    const label = ticketLabelDigAlert(envelope);
    try {
      const id = await upsertDigAlert(db, envelope);
      if (id) accepted += 1;
      else errors.push({ ticket: label, error: 'missing ticket number in payload' });
    } catch (e) {
      errors.push({
        ticket: label,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return {
    batchId: body.batchId,
    scrapedAt: body.scrapedAt,
    accepted,
    failed: errors.length,
    errors,
  };
}

export async function ingestUsanBatch(
  db: D1Database,
  table: 'usan_ca' | 'usan_nv',
  body: UsanIngestBody
): Promise<IngestBatchResult | { error: string }> {
  const metaErr = validateBatchMeta(body);
  if (metaErr) return { error: metaErr };
  if (body.tickets.length > MAX_INGEST_BATCH_SIZE) {
    return { error: `tickets exceeds max batch size (${MAX_INGEST_BATCH_SIZE})` };
  }

  const errors: IngestBatchResult['errors'] = [];
  let accepted = 0;

  for (const item of body.tickets) {
    const label = ticketLabelUsan(item);
    try {
      const id = await upsertUsan(db, table, item.payload, item.polygonWkt ?? null);
      if (id) accepted += 1;
      else errors.push({ ticket: label, error: 'missing posrTicket.ticketNumber in payload' });
    } catch (e) {
      errors.push({
        ticket: label,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return {
    batchId: body.batchId,
    scrapedAt: body.scrapedAt,
    accepted,
    failed: errors.length,
    errors,
  };
}

export async function trackContainerIngest(
  db: D1Database,
  system: ContainerJobSystem,
  body: IngestBatchMeta,
  accepted: number,
  failed: number
): Promise<void> {
  if (!body.jobId) return;
  await recordContainerBatch(db, body.jobId, system, accepted, failed, body.batchId);
}
