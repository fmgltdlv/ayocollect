import { buildListConditions, type BrowseListParams } from '../db/queries';
import type { TicketSystem } from '../types';
import {
  mapDigAlertRow,
  mapUsanRow,
  type TicketCandidate,
} from './overlap-candidates';

function tableForSystem(system: TicketSystem): string {
  if (system === 'digalert') return 'dig_alert_tickets';
  if (system === 'usan-ca') return 'usan_ca_tickets';
  return 'usan_nv_tickets';
}

function digAlertSelect(): string {
  return `ticket_number, revision, polygon_wkt,
    bbox_min_lon, bbox_min_lat, bbox_max_lon, bbox_max_lat,
    completed AS window_start, replace_by_date AS window_end,
    date(completed) AS created_day, caller AS created_by`;
}

function usanSelect(): string {
  return `ticket_number, NULL AS revision, polygon_wkt,
    bbox_min_lon, bbox_min_lat, bbox_max_lon, bbox_max_lat,
    job_start_date AS window_start, work_expiration_date AS window_end,
    is_cancelled, date(job_start_date) AS created_day, created_by`;
}

export async function loadTicketCandidatesWithFilters(
  db: D1Database,
  systems: TicketSystem[],
  params: BrowseListParams,
  limit: number
): Promise<TicketCandidate[]> {
  const candidates: TicketCandidate[] = [];

  for (const system of systems) {
    const table = tableForSystem(system);
    const { where, binds } = buildListConditions(system, params);
    const extra = where ? `${where} AND bbox_min_lon IS NOT NULL` : 'WHERE bbox_min_lon IS NOT NULL';
    const select = system === 'digalert' ? digAlertSelect() : usanSelect();
    const remaining = limit - candidates.length;
    if (remaining <= 0) break;

    const { results } = await db
      .prepare(`SELECT ${select} FROM ${table} ${extra} LIMIT ?`)
      .bind(...binds, remaining)
      .all<Record<string, unknown>>();

    for (const row of results ?? []) {
      candidates.push(system === 'digalert' ? mapDigAlertRow(row) : mapUsanRow(system, row));
    }
  }

  return candidates;
}

/** Load every ticket in the filtered area (all systems) for overlap analysis. */
export async function loadAllTicketCandidatesWithFilters(
  db: D1Database,
  systems: TicketSystem[],
  params: BrowseListParams
): Promise<TicketCandidate[]> {
  const candidates: TicketCandidate[] = [];

  for (const system of systems) {
    const table = tableForSystem(system);
    const { where, binds } = buildListConditions(system, params);
    const extra = where ? `${where} AND bbox_min_lon IS NOT NULL` : 'WHERE bbox_min_lon IS NOT NULL';
    const select = system === 'digalert' ? digAlertSelect() : usanSelect();

    const { results } = await db
      .prepare(`SELECT ${select} FROM ${table} ${extra}`)
      .bind(...binds)
      .all<Record<string, unknown>>();

    for (const row of results ?? []) {
      candidates.push(system === 'digalert' ? mapDigAlertRow(row) : mapUsanRow(system, row));
    }
  }

  return candidates;
}
