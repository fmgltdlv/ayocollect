import type { DigalertTicketBundle, PosrSearchToolResponse, QueueMessage } from '@ayocollect/db';
import {
  parseRequestNumber,
  upsertDigalertPayload,
  upsertPolygon,
  upsertPosrPayload,
} from '@ayocollect/db';
import { isUsanRegion, processNextBackfill, runSyncForDate } from '@ayocollect/posr';
import type { Env } from './env';

async function handleIngestTicket(
  env: Env,
  message: Extract<QueueMessage, { type: 'ingest-ticket' }>,
): Promise<void> {
  if (isUsanRegion(message.region)) {
    const payload = JSON.parse(message.payload) as PosrSearchToolResponse;
    await upsertPosrPayload(env.DB, payload, message.region, message.payloadR2Key || undefined);
  } else {
    const bundle = JSON.parse(message.payload) as DigalertTicketBundle;
    await upsertDigalertPayload(env.DB, bundle, message.payloadR2Key || undefined);
  }

  for (const polygon of message.polygons) {
    const { ticketBase } = parseRequestNumber(polygon.requestNumber);
    await upsertPolygon(
      env.DB,
      polygon.requestNumber,
      ticketBase,
      polygon.geojson,
      polygon.bbox,
      polygon.htmlR2Key,
    );
  }
}

export async function handleQueueBatch(batch: MessageBatch<QueueMessage>, env: Env): Promise<void> {
  for (const message of batch.messages) {
    try {
      const body = message.body;
      if (body.type === 'ingest-ticket') {
        await handleIngestTicket(env, body);
      } else if (body.type === 'sync-date') {
        try {
          await runSyncForDate(env, body.targetDate, body.triggeredBy, body.backfillRunId, body.region);
        } finally {
          if (body.backfillRunId) {
            await processNextBackfill(env);
          }
        }
      }
      message.ack();
    } catch (err) {
      console.error('Queue consumer error:', err);
      message.retry();
    }
  }
}
