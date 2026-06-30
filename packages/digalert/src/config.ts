export const GET_TICKET_URL =
  'https://newtinb.digalert.org/direct/getTicket.vjs?ticket={ticket}&revision={revision}';

export const GET_TICKET_URL_ALT =
  'https://newtinb.digalert.org/direct/getTicket.vjs?t={ticket}&r={revision}';

export const GET_CONTACTS_URL =
  'https://newtinb.digalert.org/direct/getTicketContacts.vjs?ticket={ticket}&revision={revision}';

export const GET_CONTACTS_URL_ALT =
  'https://newtinb.digalert.org/direct/getTicketContacts.vjs?t={ticket}&r={revision}';

export const GET_EPR_URL =
  'https://newtin.digalert.org/direct/getElectronicPositiveResponse.vjs?ticket={ticket}';

export const GET_EPR_URL_ALT =
  'https://newtinb.digalert.org/direct/getElectronicPositiveResponse.vjs?ticket={ticket}';

export const DEFAULT_REVISION = '00A';

export const SYNC_CONFIG = {
  MAX_CONCURRENT: 6,
  BATCH_INTERVAL_MS: 1000,
  CONSECUTIVE_MISS_LIMIT: 2,
  COUNTER_START: 1,
  COUNTER_END: 999,
  RETRY_COUNT: 1,
  RETRY_BACKOFF_MS: 2000,
  TIMEOUT_MS: 15000,
  THROTTLE_MS: 500,
} as const;

export const FETCH_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; ayocollect/1.0)',
  Accept: 'application/json',
} as const;
