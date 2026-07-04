/** Cloudflare Secrets Store binding — call `get()` to read the secret value. */
export type SecretsStoreBinding = {
  get(): Promise<string>;
};

export type Env = {
  DB: D1Database;
  /** Bearer token for POST /api/ingest/* (scraper → Worker). Secrets Store binding. */
  INGEST_SECRET?: SecretsStoreBinding;
  /** When false, Worker does not run batch jobs, cron scrape, or outbound 811 fetches. */
  ENABLE_WORKER_SCRAPING?: string;
  /** Public Worker URL for self-fetch job chaining (legacy; only if ENABLE_WORKER_SCRAPING). */
  WORKER_URL?: string;
  /** Dedicated scraper Worker (Cloudflare Container) — UI batch jobs proxy here when worker scraping is off. */
  SCRAPER_WORKER_URL?: string;
  /** Optional Bearer token for POST {SCRAPER_WORKER_URL}/run */
  SCRAPER_RUN_SECRET?: string;
  /** Google OAuth Web client ID — verifies browser ID tokens. */
  GOOGLE_CLIENT_ID?: string;
  /** Allowed Workspace domain (e.g. aspadeco.com). */
  ALLOWED_EMAIL_DOMAIN?: string;
  /** When true, skip Google auth (local wrangler dev). */
  AUTH_DISABLED?: string;
  /** Comma-separated emails that always have admin access (bootstrap / super admins). */
  ADMIN_EMAILS?: string;
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
