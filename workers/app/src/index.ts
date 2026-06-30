import type { QueueMessage } from '@ayocollect/db';
import { ALL_SYNC_REGIONS, formatTodayPacific, runSyncForDate } from '@ayocollect/posr';
import { handleFetch } from './api';
import type { Env } from './env';
import { runOverlapScan } from './overlap';
import { handleQueueBatch } from './queue';

const SYNC_CRON = '0 7 * * *';
const OVERLAP_CRON = '0 8 * * *';

async function runDailySync(env: Env): Promise<void> {
  const targetDate = formatTodayPacific();

  for (const region of ALL_SYNC_REGIONS) {
    await runSyncForDate(env, targetDate, 'cron', undefined, region);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return handleFetch(request, env);
  },

  async queue(batch: MessageBatch<QueueMessage>, env: Env): Promise<void> {
    return handleQueueBatch(batch, env);
  },

  async scheduled(controller: ScheduledController, env: Env): Promise<void> {
    if (controller.cron === SYNC_CRON) {
      await runDailySync(env);
      return;
    }

    if (controller.cron === OVERLAP_CRON) {
      await runOverlapScan(env);
    }
  },
};
