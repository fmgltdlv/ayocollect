import type { QueueMessage } from '@ayocollect/db';
import type { RunSyncEnv } from '@ayocollect/posr';

export interface Env extends RunSyncEnv {
  ORG_CREATED_BY_FILTER?: string;
  DIGALERT_SESSION_COOKIES?: string;
  SYNC_REGIONS?: string;
  QUEUE: Queue<QueueMessage>;
}
