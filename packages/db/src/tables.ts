import type { TicketRegion } from './types';

export const TICKET_TABLE_BY_REGION = {
  NV: 'usan_nv_tickets',
  CA: 'usan_ca_tickets',
  DA: 'digalert_tickets',
} as const satisfies Record<TicketRegion, string>;

export const ALL_TICKET_REGIONS: TicketRegion[] = ['NV', 'CA', 'DA'];

export function ticketTableForRegion(region: TicketRegion): string {
  return TICKET_TABLE_BY_REGION[region];
}

export function isTicketRegion(value: string): value is TicketRegion {
  return value === 'NV' || value === 'CA' || value === 'DA';
}

export const TICKET_LIST_UNION_SQL = ALL_TICKET_REGIONS.map(
  (region) =>
    `SELECT ticket_base, '${region}' AS region, created_by, latest_request_number, latest_revision, first_seen_at, last_refreshed_at, refresh_priority FROM ${TICKET_TABLE_BY_REGION[region]}`,
).join('\nUNION ALL\n');
