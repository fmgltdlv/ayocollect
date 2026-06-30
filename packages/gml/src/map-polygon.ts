import { wktToGeoJSON } from '@terraformer/wkt';
import type { Bbox } from '@ayocollect/db';
import { buildMapUrl, SYNC_CONFIG, type UsanRegion } from '@ayocollect/posr';

export type PolygonGeoJson = {
  type: 'Polygon';
  coordinates: number[][][];
};

const WKT_RE = /spatialObjectDescription\s*=\s*'(POLYGON\s*\(\([^']+\)\))'/i;

export function parseMapPolygon(html: string): string | null {
  const match = html.match(WKT_RE);
  return match?.[1] ?? null;
}

export function wktToGeoJson(wktString: string): PolygonGeoJson | null {
  try {
    const geo = wktToGeoJSON(wktString) as PolygonGeoJson;
    if (geo.type === 'Polygon') return geo;
    return null;
  } catch {
    return null;
  }
}

export function computeBbox(geojson: PolygonGeoJson): Bbox {
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLon = Infinity;
  let maxLon = -Infinity;

  for (const ring of geojson.coordinates) {
    for (const [lon, lat] of ring) {
      minLat = Math.min(minLat, lat);
      maxLat = Math.max(maxLat, lat);
      minLon = Math.min(minLon, lon);
      maxLon = Math.max(maxLon, lon);
    }
  }

  return { minLat, maxLat, minLon, maxLon };
}

export async function fetchMapHtml(
  requestNumber: string,
  region: UsanRegion = 'NV',
): Promise<string | null> {
  const url = buildMapUrl(requestNumber, region);
  let lastError: unknown;

  for (let attempt = 0; attempt <= SYNC_CONFIG.RETRY_COUNT; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), SYNC_CONFIG.TIMEOUT_MS);
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);
      if (!res.ok) return null;
      return await res.text();
    } catch (err) {
      lastError = err;
      if (attempt < SYNC_CONFIG.RETRY_COUNT) {
        await new Promise((r) => setTimeout(r, SYNC_CONFIG.RETRY_BACKOFF_MS));
      }
    }
  }

  console.error(`fetchMapHtml failed for ${requestNumber}:`, lastError);
  return null;
}

export async function fetchAndParsePolygon(
  requestNumber: string,
  region: UsanRegion = 'NV',
): Promise<{ geojson: string; bbox: Bbox } | null> {
  const html = await fetchMapHtml(requestNumber, region);
  if (!html) return null;

  const wktString = parseMapPolygon(html);
  if (!wktString) return null;

  const polygon = wktToGeoJson(wktString);
  if (!polygon) return null;

  const bbox = computeBbox(polygon);
  return { geojson: JSON.stringify(polygon), bbox };
}
