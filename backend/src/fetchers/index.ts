import { USER_AGENT } from '../types';
import { parseQmFormat, coordsToWkt, scrapeUsanPolygonWkt } from '../lib/polygon';

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

const FETCH_TIMEOUT_MS = 12_000;

function mergeAbortSignals(signals: AbortSignal[]): AbortSignal {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort();
      return controller.signal;
    }
    signal.addEventListener('abort', onAbort, { once: true });
  }
  return controller.signal;
}

async function fetchJson(url: string, init?: RequestInit): Promise<unknown> {
  const timeout = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  const signal = init?.signal ? mergeAbortSignals([init.signal, timeout]) : timeout;
  const res = await fetch(url, { ...init, signal });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

function digAlertHasTicketData(data: Record<string, unknown>): boolean {
  return !!(
    data.ticket ||
    data.completed ||
    data.place ||
    data.street ||
    data.work_type ||
    data.county
  );
}

export async function fetchDigAlertRaw(
  ticket: string,
  revision = '00A',
  signal?: AbortSignal
): Promise<DigAlertPayload | null> {
  const headers: Record<string, string> = { ...HEADERS };

  const eprUrls = [
    `https://newtinb.digalert.org/direct/getElectronicPositiveResponse.vjs?ticket=${encodeURIComponent(ticket)}`,
    `https://newtin.digalert.org/direct/getElectronicPositiveResponse.vjs?ticket=${encodeURIComponent(ticket)}`,
  ];
  const ticketUrls = [
    `https://newtinb.digalert.org/direct/getTicket.vjs?ticket=${encodeURIComponent(ticket)}&revision=${encodeURIComponent(revision)}`,
    `https://newtinb.digalert.org/direct/getTicket.vjs?t=${encodeURIComponent(ticket)}&r=${encodeURIComponent(revision)}`,
  ];

  for (const eprUrl of eprUrls) {
    try {
      const epr = (await fetchJson(eprUrl, { headers, signal })) as DigAlertPayload;
      const data = epr?.data as Record<string, unknown> | undefined;
      if (data && digAlertHasTicketData(data)) {
        return finalizeDigAlertEnvelope(epr, ticket, revision);
      }
    } catch {
      continue;
    }
  }

  let ticketJson: Record<string, unknown> | null = null;
  for (const ticketUrl of ticketUrls) {
    try {
      const json = (await fetchJson(ticketUrl, { headers, signal })) as Record<string, unknown>;
      if (json.err) continue;
      ticketJson = json;
      break;
    } catch {
      continue;
    }
  }
  if (!ticketJson) return null;

  let envelope: DigAlertPayload;
  if (ticketJson.data && typeof ticketJson.data === 'object') {
    envelope = ticketJson as DigAlertPayload;
  } else {
    envelope = { data: ticketJson };
  }

  const data = envelope.data as Record<string, unknown>;
  if (!digAlertHasTicketData(data)) return null;

  if (!data.responses) {
    for (const eprUrl of eprUrls) {
      try {
        const epr = (await fetchJson(eprUrl, { headers, signal })) as DigAlertPayload;
        if (epr?.data) {
          if (epr.data.responses) data.responses = epr.data.responses;
          if (epr.data.revisions) data.revisions = epr.data.revisions;
          if (epr.status) envelope.status = epr.status as string;
          if (epr.message) envelope.message = epr.message as string;
          if (epr.timestamp) envelope.timestamp = epr.timestamp as string;
          break;
        }
      } catch {
        continue;
      }
    }
  }

  return finalizeDigAlertEnvelope(envelope, ticket, revision);
}

function finalizeDigAlertEnvelope(
  envelope: DigAlertPayload,
  ticket: string,
  revision: string
): DigAlertPayload {
  const data = envelope.data as Record<string, unknown>;
  data.ticket = (data.ticket as string) ?? ticket;
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
  const timeout = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  const merged = signal ? mergeAbortSignals([signal, timeout]) : timeout;
  const res = await fetch(url, { headers: HEADERS, signal: merged });
  if (!res.ok) return null;
  const html = await res.text();
  return scrapeUsanPolygonWkt(html);
}

export async function ticketExistsUsan(system: 'ca' | 'nv', ticket: string, signal?: AbortSignal): Promise<boolean> {
  const data = await fetchUsanPosr(system, ticket, signal);
  return !!data?.posrTicket;
}

export async function ticketExistsDigAlert(ticket: string, signal?: AbortSignal): Promise<boolean> {
  const payload = await fetchDigAlertRaw(ticket, '00A', signal);
  return !!payload?.data?.ticket;
}
