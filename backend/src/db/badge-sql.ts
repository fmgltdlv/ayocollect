import { BLOCKER_CODES, SENTINEL_DATE, PENDING_CODE, type TicketSystem } from '../types';

export type BadgeFilter = 'pending' | 'blocker' | 'late';

function digAlertCurrentResponseExists(codeCondition: string): string {
  return `EXISTS (
    SELECT 1 FROM dig_alert_responses r
    WHERE r.ticket_id = dig_alert_tickets.id
      AND r.responded_at >= '${SENTINEL_DATE}'
      AND (${codeCondition})
      AND NOT EXISTS (
        SELECT 1 FROM dig_alert_responses r2
        WHERE r2.ticket_id = r.ticket_id
          AND r2.utility_code = r.utility_code
          AND r2.responded_at >= '${SENTINEL_DATE}'
          AND r2.responded_at > r.responded_at
      )
  )`;
}

function usanStationExists(system: 'usan-ca' | 'usan-nv', codeCondition: string): string {
  const prefix = system === 'usan-ca' ? 'usan_ca' : 'usan_nv';
  return `EXISTS (
    SELECT 1 FROM ${prefix}_stations s
    WHERE s.ticket_id = ${prefix}_tickets.id
      AND (${codeCondition})
  )`;
}

export function buildBadgeCondition(system: TicketSystem, badge: BadgeFilter): string {
  if (badge === 'late') {
    return 'had_late_response = 1';
  }
  if (badge === 'pending') {
    if (system === 'digalert') {
      return digAlertCurrentResponseExists(`r.response_code = '${PENDING_CODE}'`);
    }
    return usanStationExists(system, `s.response_code = '${PENDING_CODE}'`);
  }
  const blockerList = [...BLOCKER_CODES].map((c) => `'${c}'`).join(', ');
  if (system === 'digalert') {
    return digAlertCurrentResponseExists(`r.response_code IN (${blockerList})`);
  }
  return usanStationExists(system, `s.response_code IN (${blockerList})`);
}

export function badgeCountSql(system: TicketSystem, badge: BadgeFilter, dateWhere = ''): string {
  const table =
    system === 'digalert' ? 'dig_alert_tickets' : system === 'usan-ca' ? 'usan_ca_tickets' : 'usan_nv_tickets';
  const where = dateWhere ? `WHERE ${dateWhere} AND ${buildBadgeCondition(system, badge)}` : `WHERE ${buildBadgeCondition(system, badge)}`;
  return `SELECT COUNT(*) AS n FROM ${table} ${where}`;
}
