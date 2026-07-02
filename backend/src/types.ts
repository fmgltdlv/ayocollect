export type Env = {
  DB: D1Database;
  DIGALERT_SESSION_COOKIES?: string;
  /** Public Worker URL for self-fetch job chaining (cron / background). */
  WORKER_URL?: string;
};

export type TicketSystem = 'digalert' | 'usan-ca' | 'usan-nv';

export type FetchJobStatus =
  | 'pending'
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type UtilityResponse = {
  code: string;
  name?: string;
  responseCode: string;
  responseDescription?: string;
  responseDate?: string;
  comment?: string;
};

export type AnalyticsFlags = {
  isPending: boolean;
  hasBlockers: boolean;
  hadLateResponse: boolean;
  pendingUtilities: { code: string; name?: string; responseCode: string }[];
  blockerUtilities: { code: string; name?: string; responseCode: string }[];
};

export type Bbox = {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
};

export const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

export const BATCH_SIZE = 6;
export const FETCH_STAGGER_MS = 250; // pause between waves
/** Skip to next day after this many consecutive ticket misses (USAN + DigAlert) */
export const CONSECUTIVE_MISS_LIMIT = 2;
/** Max tickets to scan per day (DigAlert counter / USAN sequence) */
export const MAX_TICKETS_PER_DAY = 3999;
export const DIGALERT_MAX_COUNTER = MAX_TICKETS_PER_DAY;
export const USAN_CA_MAX_SEQ = MAX_TICKETS_PER_DAY;
export const USAN_NV_MAX_SEQ = MAX_TICKETS_PER_DAY;
export const SENTINEL_DATE = '1900-01-02';
export const LATE_CODES = new Set(['888', '999']);
export const BLOCKER_CODES = new Set(['888', '999']);
export const PENDING_CODE = '000';
