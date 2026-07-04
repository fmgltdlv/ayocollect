import booleanIntersects from '@turf/boolean-intersects';
import {
  CANDIDATE_CAP,
  canonicalPair,
  createdOnDifferentDays,
  findOverlapCandidates,
  loadTicketCandidate,
  listTicketsForRebuild,
  workWindowsOverlap,
  type TicketCandidate,
  type TicketRef,
} from './overlap-candidates';
import { bboxesOverlap, wktToGeoJsonPolygon } from './polygon';
import { getSetting, setSetting } from './settings';
import type { TicketSystem } from '../types';

const ALL_SYSTEMS: TicketSystem[] = ['digalert', 'usan-ca', 'usan-nv'];
const PRUNE_DAYS = 60;
const PRUNE_BATCH = 5000;
const PRUNE_MAX_ROUNDS = 5;

function overlapKind(source: TicketCandidate, candidate: TicketCandidate): 'polygon' | 'bbox' | null {
  const aBbox = {
    minLon: source.bboxMinLon,
    minLat: source.bboxMinLat,
    maxLon: source.bboxMaxLon,
    maxLat: source.bboxMaxLat,
  };
  const bBbox = {
    minLon: candidate.bboxMinLon,
    minLat: candidate.bboxMinLat,
    maxLon: candidate.bboxMaxLon,
    maxLat: candidate.bboxMaxLat,
  };
  if (!bboxesOverlap(aBbox, bBbox)) return null;

  if (source.polygonWkt && candidate.polygonWkt) {
    const ga = wktToGeoJsonPolygon(source.polygonWkt);
    const gb = wktToGeoJsonPolygon(candidate.polygonWkt);
    if (ga && gb && booleanIntersects(ga, gb)) return 'polygon';
    return null;
  }

  return 'bbox';
}

async function deleteOverlapsForTicket(db: D1Database, ref: TicketRef): Promise<void> {
  const revision = ref.revision ?? null;
  await db
    .prepare(
      `DELETE FROM ticket_overlaps
       WHERE (a_system = ? AND a_number = ? AND COALESCE(a_revision, '') = COALESCE(?, ''))
          OR (b_system = ? AND b_number = ? AND COALESCE(b_revision, '') = COALESCE(?, ''))`
    )
    .bind(ref.system, ref.ticketNumber, revision, ref.system, ref.ticketNumber, revision)
    .run();
}

async function insertOverlap(
  db: D1Database,
  a: TicketRef,
  b: TicketRef,
  kind: 'polygon' | 'bbox',
  source: TicketCandidate,
  candidate: TicketCandidate
): Promise<void> {
  const [left, right] = canonicalPair(a, b);
  const concurrent = workWindowsOverlap(source, candidate) ? 1 : 0;
  await db
    .prepare(
      `INSERT INTO ticket_overlaps (
        a_system, a_number, a_revision, b_system, b_number, b_revision,
        overlap_kind, concurrent, computed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(a_system, a_number, a_revision, b_system, b_number, b_revision) DO UPDATE SET
        overlap_kind = excluded.overlap_kind,
        concurrent = excluded.concurrent,
        computed_at = datetime('now')`
    )
    .bind(
      left.system,
      left.ticketNumber,
      left.revision ?? null,
      right.system,
      right.ticketNumber,
      right.revision ?? null,
      kind,
      concurrent
    )
    .run();
}

async function targetSystems(db: D1Database, sourceSystem: TicketSystem): Promise<TicketSystem[]> {
  const systems: TicketSystem[] = [sourceSystem];
  const crossEnabled = (await getSetting(db, 'overlap_cross_system_enabled')) === '1';
  if (crossEnabled) {
    for (const s of ALL_SYSTEMS) {
      if (s !== sourceSystem) systems.push(s);
    }
  }
  return systems;
}

export async function recomputeOverlapsForTicket(db: D1Database, ref: TicketRef): Promise<number> {
  const source = await loadTicketCandidate(db, ref);
  if (!source) return 0;

  await deleteOverlapsForTicket(db, ref);

  const systems = await targetSystems(db, ref.system);
  const candidates = await findOverlapCandidates(db, source, systems);
  let count = 0;

  for (const candidate of candidates.slice(0, CANDIDATE_CAP)) {
    if (!createdOnDifferentDays(source, candidate)) continue;

    const kind = overlapKind(source, candidate);
    if (!kind) continue;

    const candidateRef: TicketRef = {
      system: candidate.system,
      ticketNumber: candidate.ticketNumber,
      revision: candidate.revision,
    };
    await insertOverlap(db, ref, candidateRef, kind, source, candidate);
    count++;
  }

  return count;
}

export async function countOverlapsForTicket(
  db: D1Database,
  ref: TicketRef,
  concurrentOnly = false
): Promise<number> {
  const revision = ref.revision ?? null;
  const concurrentSql = concurrentOnly ? ' AND concurrent = 1' : '';
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM ticket_overlaps
       WHERE ((a_system = ? AND a_number = ? AND COALESCE(a_revision, '') = COALESCE(?, ''))
           OR (b_system = ? AND b_number = ? AND COALESCE(b_revision, '') = COALESCE(?, '')))
       ${concurrentSql}`
    )
    .bind(ref.system, ref.ticketNumber, revision, ref.system, ref.ticketNumber, revision)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

export type OverlapListItem = {
  system: TicketSystem;
  ticketNumber: string;
  revision: string | null;
  overlapKind: string;
  concurrent: boolean;
};

export async function listOverlapsForTicket(
  db: D1Database,
  ref: TicketRef,
  concurrentOnly = false
): Promise<OverlapListItem[]> {
  const revision = ref.revision ?? null;
  const revMatch = `COALESCE(a_revision, '') = COALESCE(?, '')`;
  const revMatchB = `COALESCE(b_revision, '') = COALESCE(?, '')`;
  const concurrentSql = concurrentOnly ? ' AND concurrent = 1' : '';

  const { results } = await db
    .prepare(
      `SELECT
         CASE WHEN a_system = ? AND a_number = ? AND ${revMatch}
           THEN b_system ELSE a_system END AS system,
         CASE WHEN a_system = ? AND a_number = ? AND ${revMatch}
           THEN b_number ELSE a_number END AS ticket_number,
         CASE WHEN a_system = ? AND a_number = ? AND ${revMatch}
           THEN b_revision ELSE a_revision END AS revision,
         overlap_kind,
         concurrent
       FROM ticket_overlaps
       WHERE ((a_system = ? AND a_number = ? AND ${revMatch})
           OR (b_system = ? AND b_number = ? AND ${revMatchB}))
       ${concurrentSql}
       ORDER BY concurrent DESC, computed_at DESC`
    )
    .bind(
      ref.system,
      ref.ticketNumber,
      revision,
      ref.system,
      ref.ticketNumber,
      revision,
      ref.system,
      ref.ticketNumber,
      revision,
      ref.system,
      ref.ticketNumber,
      revision,
      ref.system,
      ref.ticketNumber,
      revision
    )
    .all<{
      system: TicketSystem;
      ticket_number: string;
      revision: string | null;
      overlap_kind: string;
      concurrent: number;
    }>();

  return (results ?? []).map((r) => ({
    system: r.system,
    ticketNumber: r.ticket_number,
    revision: r.revision,
    overlapKind: r.overlap_kind,
    concurrent: !!r.concurrent,
  }));
}

export async function rebuildOverlapsBatch(
  db: D1Database,
  system: TicketSystem,
  limit: number,
  offset: number
): Promise<{ processed: number; overlapsFound: number; nextOffset: number }> {
  const refs = await listTicketsForRebuild(db, system, limit, offset);
  let overlapsFound = 0;
  for (const ref of refs) {
    overlapsFound += await recomputeOverlapsForTicket(db, ref);
  }
  const nextOffset = offset + refs.length;
  await setSetting(db, 'overlap_rebuild_cursor', `${system}:${nextOffset}`);
  return { processed: refs.length, overlapsFound, nextOffset };
}

export async function runOverlapMaintenance(db: D1Database): Promise<{ refreshed: number; pruned: number }> {
  let refreshed = 0;
  let pruned = 0;

  pruned += await pruneSameDayOverlaps(db);

  const { results: rows } = await db
    .prepare('SELECT id, a_system, a_number, a_revision, b_system, b_number, b_revision, concurrent FROM ticket_overlaps WHERE concurrent = 1 LIMIT 500')
    .all<{
      id: number;
      a_system: TicketSystem;
      a_number: string;
      a_revision: string | null;
      b_system: TicketSystem;
      b_number: string;
      b_revision: string | null;
      concurrent: number;
    }>();

  for (const row of rows ?? []) {
    const a = await loadTicketCandidate(db, {
      system: row.a_system,
      ticketNumber: row.a_number,
      revision: row.a_revision,
    });
    const b = await loadTicketCandidate(db, {
      system: row.b_system,
      ticketNumber: row.b_number,
      revision: row.b_revision,
    });
    if (!a || !b) continue;
    const shouldBeConcurrent = workWindowsOverlap(a, b) ? 1 : 0;
    if (shouldBeConcurrent !== row.concurrent) {
      await db.prepare('UPDATE ticket_overlaps SET concurrent = ? WHERE id = ?').bind(shouldBeConcurrent, row.id).run();
      refreshed++;
    }
  }

  const pruneEnabled = (await getSetting(db, 'overlap_prune_enabled')) !== '0';
  if (pruneEnabled) {
    const cutoff = new Date();
    cutoff.setUTCDate(cutoff.getUTCDate() - PRUNE_DAYS);
    const cutoffStr = cutoff.toISOString().slice(0, 10);

    for (let round = 0; round < PRUNE_MAX_ROUNDS; round++) {
      const batchPruned = await pruneStaleOverlaps(db, cutoffStr);
      pruned += batchPruned;
      if (batchPruned < PRUNE_BATCH) break;
    }

    pruned += await pruneOrphanedOverlaps(db);
  }

  return { refreshed, pruned };
}

async function pruneSameDayOverlaps(db: D1Database): Promise<number> {
  const { results } = await db
    .prepare('SELECT id, a_system, a_number, a_revision, b_system, b_number, b_revision FROM ticket_overlaps LIMIT ?')
    .bind(PRUNE_BATCH)
    .all<{
      id: number;
      a_system: TicketSystem;
      a_number: string;
      a_revision: string | null;
      b_system: TicketSystem;
      b_number: string;
      b_revision: string | null;
    }>();

  let pruned = 0;
  for (const row of results ?? []) {
    const a = await loadTicketCandidate(db, {
      system: row.a_system,
      ticketNumber: row.a_number,
      revision: row.a_revision,
    });
    const b = await loadTicketCandidate(db, {
      system: row.b_system,
      ticketNumber: row.b_number,
      revision: row.b_revision,
    });
    if (!a || !b) continue;
    if (!createdOnDifferentDays(a, b)) {
      await db.prepare('DELETE FROM ticket_overlaps WHERE id = ?').bind(row.id).run();
      pruned++;
    }
  }
  return pruned;
}

async function pruneStaleOverlaps(db: D1Database, cutoffStr: string): Promise<number> {
  const { results } = await db
    .prepare(`SELECT id, a_system, a_number, a_revision, b_system, b_number, b_revision FROM ticket_overlaps LIMIT ?`)
    .bind(PRUNE_BATCH)
    .all<{
      id: number;
      a_system: TicketSystem;
      a_number: string;
      a_revision: string | null;
      b_system: TicketSystem;
      b_number: string;
      b_revision: string | null;
    }>();

  let pruned = 0;
  for (const row of results ?? []) {
    const aEnd = await ticketWindowEnd(db, row.a_system, row.a_number, row.a_revision);
    const bEnd = await ticketWindowEnd(db, row.b_system, row.b_number, row.b_revision);
    if (aEnd && bEnd && aEnd < cutoffStr && bEnd < cutoffStr) {
      await db.prepare('DELETE FROM ticket_overlaps WHERE id = ?').bind(row.id).run();
      pruned++;
    }
  }
  return pruned;
}

async function pruneOrphanedOverlaps(db: D1Database): Promise<number> {
  let pruned = 0;

  const digAlertOrphans = await db
    .prepare(
      `DELETE FROM ticket_overlaps WHERE id IN (
        SELECT o.id FROM ticket_overlaps o
        WHERE o.a_system = 'digalert'
          AND NOT EXISTS (
            SELECT 1 FROM dig_alert_tickets t
            WHERE t.ticket_number = o.a_number AND t.revision = COALESCE(o.a_revision, '00A')
          )
      ) OR id IN (
        SELECT o.id FROM ticket_overlaps o
        WHERE o.b_system = 'digalert'
          AND NOT EXISTS (
            SELECT 1 FROM dig_alert_tickets t
            WHERE t.ticket_number = o.b_number AND t.revision = COALESCE(o.b_revision, '00A')
          )
      )`
    )
    .run();
  pruned += digAlertOrphans.meta.changes ?? 0;

  for (const [system, table] of [
    ['usan-ca', 'usan_ca_tickets'],
    ['usan-nv', 'usan_nv_tickets'],
  ] as const) {
    const result = await db
      .prepare(
        `DELETE FROM ticket_overlaps WHERE id IN (
          SELECT o.id FROM ticket_overlaps o
          WHERE o.a_system = ?
            AND NOT EXISTS (SELECT 1 FROM ${table} t WHERE t.ticket_number = o.a_number)
        ) OR id IN (
          SELECT o.id FROM ticket_overlaps o
          WHERE o.b_system = ?
            AND NOT EXISTS (SELECT 1 FROM ${table} t WHERE t.ticket_number = o.b_number)
        )`
      )
      .bind(system, system)
      .run();
    pruned += result.meta.changes ?? 0;
  }

  return pruned;
}

async function ticketWindowEnd(
  db: D1Database,
  system: TicketSystem,
  ticketNumber: string,
  revision: string | null
): Promise<string | null> {
  if (system === 'digalert') {
    const row = await db
      .prepare('SELECT replace_by_date FROM dig_alert_tickets WHERE ticket_number = ? AND revision = ?')
      .bind(ticketNumber, revision ?? '00A')
      .first<{ replace_by_date: string | null }>();
    return row?.replace_by_date ?? null;
  }
  const table = system === 'usan-ca' ? 'usan_ca_tickets' : 'usan_nv_tickets';
  const row = await db
    .prepare(`SELECT work_expiration_date FROM ${table} WHERE ticket_number = ?`)
    .bind(ticketNumber)
    .first<{ work_expiration_date: string | null }>();
  return row?.work_expiration_date ?? null;
}
