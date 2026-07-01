const API_BASE = import.meta.env.VITE_API_BASE ?? '';

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error?: string }).error ?? 'Request failed');
  }
  return res.json() as Promise<T>;
}

export const fetchOverview = () =>
  api<{ overview: Record<string, number> }>('/api/metrics/overview');

export const fetchUtilities = () =>
  api<{ utilities: UtilityMetric[] }>('/api/metrics/utilities');

export const fetchTickets = (q = '', limit = 50) =>
  api<{ tickets: TicketRow[] }>(`/api/tickets?q=${encodeURIComponent(q)}&limit=${limit}`);

export const fetchTicketDetail = (region: string, ticketBase: string) =>
  api<TicketDetail>(`/api/tickets/${region}/${ticketBase}`);

export const fetchOverlaps = () =>
  api<{ overlaps: OverlapRow[] }>('/api/overlaps');

export const fetchSyncStatus = () =>
  api<{ syncState: SyncState }>('/api/sync/status');

export const fetchBackfillRuns = () =>
  api<{ runs: BackfillRun[] }>('/api/sync/backfill');

export const fetchBackfillQueueStatus = () =>
  api<BackfillQueueStatus>('/api/sync/backfill/queue-status');

export const REGION_LABELS: Record<string, string> = {
  NV: 'USAN NV',
  CA: 'USAN CA',
  DA: 'DigAlert',
};

export const BACKFILL_REGIONS = [
  { id: 'NV', label: 'USAN Nevada' },
  { id: 'CA', label: 'USAN Northern California' },
  { id: 'DA', label: 'DigAlert (Southern CA)' },
] as const;

export type BackfillRegion = (typeof BACKFILL_REGIONS)[number]['id'];

export const startBackfill = (body: {
  startDate?: string;
  endDate?: string;
  dates?: string[];
  regions: BackfillRegion[];
}) =>
  api<{ runIds: number[]; queuedDates: string[] }>('/api/sync/backfill', {
    method: 'POST',
    body: JSON.stringify(body),
  });

export type TicketRow = {
  ticket_base: string;
  region: string;
  created_by: string | null;
  latest_request_number: string;
  address?: string;
  job_start_at?: string;
  last_refreshed_at?: string;
};

export type UtilityMetric = {
  station_code: string;
  station_name: string;
  on_time_count: number;
  late_count: number;
  pending_count: number;
  total: number;
};

export type OverlapRow = {
  region_a: string;
  ticket_base_a: string;
  region_b: string;
  ticket_base_b: string;
  overlap_area_sqm: number;
  created_by_a?: string;
  created_by_b?: string;
};

export type SyncState = {
  last_success_at: string | null;
  last_target_date: string | null;
  tickets_synced: number;
  tickets_failed: number;
  last_error: string | null;
};

export type BackfillRun = {
  id: number;
  target_date: string;
  region: string;
  status: string;
  tickets_synced: number;
  tickets_failed: number;
  error: string | null;
  started_at?: string | null;
  completed_at?: string | null;
};

export type BackfillQueueStatus = {
  capturedAt: string;
  active: boolean;
  currentlyRunning: BackfillRun | null;
  queued: Array<BackfillRun & { queuePosition: number }>;
  counts: {
    queued: number;
    running: number;
    completed: number;
    failed: number;
  };
};

export type TicketDetail = {
  ticket: TicketRow;
  revisions: Array<Record<string, unknown>>;
  events: Array<{
    request_number: string;
    station_code: string;
    station_name: string;
    response_date: string;
    response_code: string;
    is_late_trigger: number;
    is_acceptable: number;
    is_pending: number;
  }>;
  timeliness: Array<{
    request_number: string;
    station_code: string;
    timeliness_status: string;
  }>;
  polygons: Array<{ request_number: string; geojson: string }>;
};
