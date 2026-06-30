import {
  DEFAULT_REVISION,
  FETCH_HEADERS,
  GET_CONTACTS_URL,
  GET_CONTACTS_URL_ALT,
  GET_EPR_URL,
  GET_EPR_URL_ALT,
  GET_TICKET_URL,
  GET_TICKET_URL_ALT,
  SYNC_CONFIG,
} from './config';

export type DigalertEprResponse = {
  member?: string;
  response?: string;
  description?: string;
  responded?: string;
  respondent?: string;
  comments?: string;
  url?: string;
};

export type DigalertTicketBundle = {
  ticket: string;
  revision: string;
  requestNumber: string;
  ticketData: Record<string, unknown>;
  eprResponses: DigalertEprResponse[];
};

function formatUrl(template: string, ticket: string, revision: string): string {
  return template.replace('{ticket}', encodeURIComponent(ticket)).replace('{revision}', encodeURIComponent(revision));
}

async function fetchJsonUrls(
  urls: string[],
  sessionCookies?: Record<string, string>,
): Promise<Record<string, unknown> | null> {
  const cookieHeader =
    sessionCookies && Object.keys(sessionCookies).length > 0
      ? Object.entries(sessionCookies)
          .map(([k, v]) => `${k}=${v}`)
          .join('; ')
      : undefined;

  for (const url of urls) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), SYNC_CONFIG.TIMEOUT_MS);
      const res = await fetch(url, {
        signal: controller.signal,
        headers: {
          ...FETCH_HEADERS,
          ...(cookieHeader ? { Cookie: cookieHeader } : {}),
        },
      });
      clearTimeout(timeout);

      if (!res.ok) continue;

      const text = await res.text();
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(text) as Record<string, unknown>;
      } catch {
        const match = text.match(/\{[\s\S]*\}/);
        if (!match) continue;
        data = JSON.parse(match[0]) as Record<string, unknown>;
      }

      if ('err' in data) continue;
      return data;
    } catch {
      continue;
    }
  }

  return null;
}

export async function fetchDigalertTicket(
  ticket: string,
  revision: string = DEFAULT_REVISION,
  sessionCookies?: Record<string, string>,
): Promise<Record<string, unknown> | null> {
  return fetchJsonUrls(
    [formatUrl(GET_TICKET_URL, ticket, revision), formatUrl(GET_TICKET_URL_ALT, ticket, revision)],
    sessionCookies,
  );
}

export async function fetchDigalertContacts(
  ticket: string,
  revision: string = DEFAULT_REVISION,
  sessionCookies?: Record<string, string>,
): Promise<Record<string, unknown> | null> {
  return fetchJsonUrls(
    [formatUrl(GET_CONTACTS_URL, ticket, revision), formatUrl(GET_CONTACTS_URL_ALT, ticket, revision)],
    sessionCookies,
  );
}

export async function fetchDigalertEpr(
  ticket: string,
  sessionCookies?: Record<string, string>,
): Promise<DigalertEprResponse[]> {
  const data = await fetchJsonUrls(
    [GET_EPR_URL.replace('{ticket}', encodeURIComponent(ticket)), GET_EPR_URL_ALT.replace('{ticket}', encodeURIComponent(ticket))],
    sessionCookies,
  );

  if (!data) return [];

  const nested = data.data;
  if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
    const responses = (nested as Record<string, unknown>).responses;
    if (Array.isArray(responses)) {
      return responses as DigalertEprResponse[];
    }
  }

  if (Array.isArray(data.responses)) {
    return data.responses as DigalertEprResponse[];
  }

  return [];
}

export function ticketExists(ticketData: Record<string, unknown> | null): boolean {
  if (!ticketData) return false;
  const ticket = ticketData.ticket;
  return typeof ticket === 'string' && ticket.length > 0;
}

export async function fetchCompleteTicketBundle(
  ticket: string,
  revision: string = DEFAULT_REVISION,
  sessionCookies?: Record<string, string>,
): Promise<DigalertTicketBundle | null> {
  const ticketData = await fetchDigalertTicket(ticket, revision, sessionCookies);
  if (!ticketExists(ticketData)) return null;

  const contacts = await fetchDigalertContacts(ticket, revision, sessionCookies);
  if (contacts) {
    ticketData!.contacts = contacts;
  }

  const eprResponses = await fetchDigalertEpr(ticket, sessionCookies);
  const requestNumber = `${ticket}-${revision}`;

  return {
    ticket,
    revision,
    requestNumber,
    ticketData: ticketData!,
    eprResponses,
  };
}
