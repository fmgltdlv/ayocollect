const TICKET_TABLES = [
  'dig_alert_responses',
  'dig_alert_revisions',
  'dig_alert_tickets',
  'usan_ca_stations',
  'usan_ca_ticket_history',
  'usan_ca_tickets',
  'usan_nv_stations',
  'usan_nv_ticket_history',
  'usan_nv_tickets',
] as const;

export type NukeTicketsResult = {
  deleted: Record<string, number>;
  total: number;
};

async function countTable(db: D1Database, table: string): Promise<number> {
  const row = await db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>();
  return row?.n ?? 0;
}

export async function nukeAllTickets(db: D1Database): Promise<NukeTicketsResult> {
  const counts: Record<string, number> = {};
  for (const table of TICKET_TABLES) {
    counts[table] = await countTable(db, table);
  }

  await db.batch(TICKET_TABLES.map((table) => db.prepare(`DELETE FROM ${table}`)));

  const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
  return { deleted: counts, total };
}
