export type TicketRegion = 'CA' | 'NV' | 'DA';

export type TicketBase = {
  ticketBase: string;
  state: TicketRegion;
  createdBy: string | null;
  latestRequestNumber: string;
  latestRevision: number;
};

export type TicketRevision = {
  requestNumber: string;
  ticketBase: string;
  revision: number;
  jobStartAt: string | null;
  workExpirationAt: string | null;
  address: string | null;
  mapLink: string | null;
  isCurrent: boolean;
};

export type ResponseEvent = {
  requestNumber: string;
  stationCode: string;
  stationName: string;
  responseDate: string;
  responseCode: string;
  responseDescription: string | null;
  isPending: boolean;
};

export type TimelinessStatus = 'on_time' | 'late' | 'pending';

export type SyncRegion = 'CA' | 'NV' | 'DA';

export type QueueMessage = SyncDateMessage | IngestTicketMessage;

export type SyncDateMessage = {
  type: 'sync-date';
  targetDate: string;
  region: SyncRegion;
  backfillRunId?: number;
  triggeredBy: 'cron' | 'dashboard' | 'api';
};

export type IngestTicketMessage = {
  type: 'ingest-ticket';
  region: SyncRegion;
  ticketBase: string;
  payload: string;
  polygons: PolygonIngestPayload[];
};

export type PolygonIngestPayload = {
  requestNumber: string;
  geojson: string;
  bbox: Bbox | null;
  mapHtml: string | null;
};

export type Bbox = {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
};

export type PosrStation = {
  name: string;
  code: string;
  responseDate: string;
  responseDateString?: string;
  responseCode: string;
  responseDescription?: string;
  comment?: string;
};

export type PosrHistoryEntry = PosrStation & {
  requestNumber: string;
};

export type PosrTicket = {
  ticketNumber: string;
  address?: string;
  mapLink?: string;
  jobStartDate?: string;
  jobStartDateString?: string;
  workExpirationDate?: string;
  workExpirationDateString?: string;
  workType?: string;
  workActivity?: string;
  excavationMethod?: string;
  streetSidewalkOrParkstrip?: number;
  additionalRemarks?: string;
  isCancelled?: boolean;
  jobStatus?: string;
  createdBy?: string;
  stations?: PosrStation[];
  ticketHistory?: PosrHistoryEntry[];
};

export type PosrSearchToolResponse = {
  isSuccessful: boolean;
  trailId?: string;
  validationErrors?: string[];
  jobStartDate?: string;
  workExpirationDate?: string;
  posrTicket?: PosrTicket | null;
};

export type DigalertTicketBundle = {
  ticket: string;
  revision: string;
  requestNumber: string;
  ticketData: Record<string, unknown>;
  eprResponses: Array<{
    member?: string;
    response?: string;
    description?: string;
    responded?: string;
    respondent?: string;
    comments?: string;
    url?: string;
  }>;
};
