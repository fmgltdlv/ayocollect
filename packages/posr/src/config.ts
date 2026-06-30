/** Nevada endpoints. */

export const NV_POSR_BASE = 'https://appsnv.undergroundservicealert.org';

export const NV_MAP_BASE = 'https://onecallnv.undergroundservicealert.org';



/** Northern California endpoints. */

export const CA_POSR_BASE = 'https://appsca.undergroundservicealert.org';

export const CA_MAP_BASE = 'https://onecallca.undergroundservicealert.org';



export const POSR_SEARCH_PATH =

  '/posr/searchtool/PositiveResponse/GetJobsListForTable';



export const MAP_INDEX_PATH = '/ngen.web/map/index';



export const SYNC_CONFIG = {
  MAX_CONCURRENT: 6,
  BATCH_INTERVAL_MS: 1000,

  CONSECUTIVE_MISS_LIMIT: 2,

  RETRY_COUNT: 1,

  RETRY_BACKOFF_MS: 2000,

  TIMEOUT_MS: 15000,

} as const;



export type UsanRegion = 'NV' | 'CA';



export const ALL_SYNC_REGIONS = ['NV', 'CA', 'DA'] as const;

export type SyncRegion = (typeof ALL_SYNC_REGIONS)[number];



export function getPosrBaseUrl(region: UsanRegion): string {

  return region === 'CA' ? CA_POSR_BASE : NV_POSR_BASE;

}



export function getMapBaseUrl(region: UsanRegion): string {

  return region === 'CA' ? CA_MAP_BASE : NV_MAP_BASE;

}



export function buildPosrUrl(ticketBase: string, region: UsanRegion): string {

  const base = getPosrBaseUrl(region);

  return `${base}${POSR_SEARCH_PATH}?format=json&ticketNumber=${encodeURIComponent(ticketBase)}`;

}



export function buildMapUrl(requestNumber: string, region: UsanRegion): string {

  const base = getMapBaseUrl(region);

  return `${base}${MAP_INDEX_PATH}?RequestNumber=${encodeURIComponent(requestNumber)}`;

}



export function isUsanRegion(region: SyncRegion): region is UsanRegion {

  return region === 'NV' || region === 'CA';

}


