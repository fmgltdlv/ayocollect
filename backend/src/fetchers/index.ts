import { USER_AGENT } from '../types';
import { parseQmFormat, coordsToWkt, scrapeUsanPolygonWkt } from '../lib/polygon';
import { digAlertCookieHeader } from '../lib/settings';
import type { Env } from '../types';

const HEADERS = { 'User-Agent': USER_AGENT };

export type DigAlertPayload = {
  status?: string;
  message?: string;
  timestamp?: string;
  data: Record<string, unknown>;
};

export type UsanPosrPayload = Record<string, unknown>;

const USAN_URLS = {
  ca: {
    posr: 'https://appsca.undergroundservicealert.org/posr/searchtool/PositiveResponse/GetJobsListForTable?format=json&ticketNumber={ticket}',
    map: 'https://onecallca.undergroundservicealert.org/ngen.web/map/index?RequestNumber={base}-000',
  },
  nv: {
    posr: 'https://appsnv.undergroundservicealert.org/posr/searchtool/PositiveResponse/GetJobsListForTable?format=json&ticketNumber={ticket}',
    map: 'https://onecallnv.undergroundservicealert.org/ngen.web/map/index?RequestNumber={base}-000',
  },
};

function normalizeBase(ticket: string): string {
  return ticket.split('-')[0];
}

async function fetchJson(url: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

export async function fetchDigAlertRaw(
  ticket: string,
  revision = '00A',
  env?: Env,
  signal?: AbortSignal
): Promise<DigAlertPayload | null> {
  const cookie = env ? digAlertCookieHeader(env) : undefined;
  const headers: Record<string, string> = { ...HEADERS };
  if (cookie) headers.Cookie = cookie;

  const ticketUrl = `https://newtinb.digalert.org/direct/getTicket.vjs?ticket=${encodeURIComponent(ticket)}&revision=${encodeURIComponent(revision)}`;
  const eprUrl = `https://newtinb.digalert.org/direct/getElectronicPositiveResponse.vjs?ticket=${encodeURIComponent(ticket)}`;

  let ticketJson: Record<string, unknown>;
  try {
    ticketJson = (await fetchJson(ticketUrl, { headers, signal })) as Record<string, unknown>;
  } catch {
    return null;
  }

  if (ticketJson.err) return null;

  let envelope: DigAlertPayload;
  if (ticketJson.data && typeof ticketJson.data === 'object') {
    envelope = ticketJson as DigAlertPayload;
  } else {
    envelope = { data: ticketJson };
  }

  const data = envelope.data as Record<string, unknown>;
  if (!data.responses) {
    try {
      const epr = (await fetchJson(eprUrl, { headers, signal })) as DigAlertPayload;
      if (epr?.data) {
        if (epr.data.responses) data.responses = epr.data.responses;
        if (epr.data.revisions) data.revisions = epr.data.revisions;
        if (epr.status) envelope.status = epr.status as string;
        if (epr.message) envelope.message = epr.message as string;
        if (epr.timestamp) envelope.timestamp = epr.timestamp as string;
      }
    } catch {
      /* optional merge */
    }
  }

  data.ticket = data.ticket ?? ticket;
  data.revision = data.revision ?? revision;

  const qm = data.work_area_shape as string | undefined;
  if (qm && !data.polygon_wkt) {
    const coords = parseQmFormat(qm);
    if (coords) data.polygon_wkt = coordsToWkt(coords);
  }

  return envelope;
}

export async function fetchUsanPosr(
  system: 'ca' | 'nv',
  ticket: string,
  signal?: AbortSignal
): Promise<UsanPosrPayload | null> {
  const urls = USAN_URLS[system];
  const tryTickets = [ticket, normalizeBase(ticket)];
  for (const t of [...new Set(tryTickets)]) {
    const url = urls.posr.replace('{ticket}', encodeURIComponent(t));
    try {
      const data = (await fetchJson(url, { headers: HEADERS, signal })) as UsanPosrPayload;
      if (data?.posrTicket) return data;
    } catch {
      continue;
    }
  }
  return null;
}

export async function fetchUsanPolygonWkt(
  system: 'ca' | 'nv',
  ticket: string,
  signal?: AbortSignal
): Promise<string | null> {
  const base = normalizeBase(ticket);
  const url = USAN_URLS[system].map.replace('{base}', encodeURIComponent(base));
  const res = await fetch(url, { headers: HEADERS, signal });
  if (!res.ok) return null;
  const html = await res.text();
  return scrapeUsanPolygonWkt(html);
}

export async function ticketExistsUsan(system: 'ca' | 'nv', ticket: string, signal?: AbortSignal): Promise<boolean> {
  const data = await fetchUsanPosr(system, ticket, signal);
  return !!data?.posrTicket;
}

export async function ticketExistsDigAlert(
  ticket: string,
  env?: Env,
  signal?: AbortSignal
): Promise<boolean> {
  const payload = await fetchDigAlertRaw(ticket, '00A', env, signal);
  return !!payload?.data?.ticket;
}
