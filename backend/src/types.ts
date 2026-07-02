export type Env = {
  DB: D1Database;
  ASSETS: Fetcher;
  DIGALERT_SESSION_COOKIES?: string;
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
export const SENTINEL_DATE = '1900-01-02';
export const LATE_CODES = new Set(['888', '999']);
export const BLOCKER_CODES = new Set(['888', '999']);
export const PENDING_CODE = '000';
