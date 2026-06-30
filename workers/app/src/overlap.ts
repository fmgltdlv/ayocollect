import booleanIntersects from '@turf/boolean-intersects';
import intersect from '@turf/intersect';
import area from '@turf/area';
import { polygon as turfPolygon } from '@turf/helpers';
import type { Env } from './env';

type PolygonRow = {
  request_number: string;
  ticket_base: string;
  geojson: string;
  bbox_min_lat: number;
  bbox_max_lat: number;
  bbox_min_lon: number;
  bbox_max_lon: number;
  created_by: string | null;
};

function bboxesOverlap(a: PolygonRow, b: PolygonRow): boolean {
  return !(
    a.bbox_max_lat < b.bbox_min_lat ||
    a.bbox_min_lat > b.bbox_max_lat ||
    a.bbox_max_lon < b.bbox_min_lon ||
    a.bbox_min_lon > b.bbox_max_lon
  );
}

function passesOrgFilter(createdBy: string | null, allowlist: string | undefined): boolean {
  if (!allowlist?.trim()) return true;
  if (!createdBy) return false;
  const allowed = allowlist.split(',').map((s) => s.trim().toLowerCase());
  return allowed.includes(createdBy.toLowerCase());
}

function normalizePair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

export async function runOverlapScan(env: Env): Promise<void> {
  const rows = await env.DB.prepare(
    `SELECT tp.request_number, tp.ticket_base, tp.geojson,
            tp.bbox_min_lat, tp.bbox_max_lat, tp.bbox_min_lon, tp.bbox_max_lon,
            tb.created_by
     FROM ticket_polygons tp
     JOIN ticket_revisions tr ON tr.request_number = tp.request_number AND tr.is_current = 1
     JOIN ticket_bases tb ON tb.ticket_base = tp.ticket_base`,
  ).all<PolygonRow>();

  const polygons = (rows.results ?? []).filter((p) =>
    passesOrgFilter(p.created_by, env.ORG_CREATED_BY_FILTER),
  );

  await env.DB.prepare(`DELETE FROM polygon_overlaps`).run();

  for (let i = 0; i < polygons.length; i++) {
    for (let j = i + 1; j < polygons.length; j++) {
      const a = polygons[i]!;
      const b = polygons[j]!;
      if (a.ticket_base === b.ticket_base) continue;
      if (!bboxesOverlap(a, b)) continue;

      try {
        const geoA = JSON.parse(a.geojson) as { coordinates: number[][][] };
        const geoB = JSON.parse(b.geojson) as { coordinates: number[][][] };
        const polyA = turfPolygon(geoA.coordinates);
        const polyB = turfPolygon(geoB.coordinates);
        if (!booleanIntersects(polyA, polyB)) continue;

        const intersection = intersect({
          type: 'FeatureCollection',
          features: [
            { type: 'Feature', properties: {}, geometry: polyA.geometry },
            { type: 'Feature', properties: {}, geometry: polyB.geometry },
          ],
        });

        const overlapArea = intersection ? area(intersection) : 0;
        const [ticketBaseA, ticketBaseB] = normalizePair(a.ticket_base, b.ticket_base);

        await env.DB.prepare(
          `INSERT INTO polygon_overlaps (
            ticket_base_a, ticket_base_b, request_number_a, request_number_b, overlap_area_sqm
          ) VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(ticket_base_a, ticket_base_b) DO UPDATE SET
            request_number_a = excluded.request_number_a,
            request_number_b = excluded.request_number_b,
            overlap_area_sqm = excluded.overlap_area_sqm,
            detected_at = datetime('now')`,
        )
          .bind(ticketBaseA, ticketBaseB, a.request_number, b.request_number, overlapArea)
          .run();
      } catch (err) {
        console.error(`Overlap check failed ${a.ticket_base} vs ${b.ticket_base}:`, err);
      }
    }
  }
}
