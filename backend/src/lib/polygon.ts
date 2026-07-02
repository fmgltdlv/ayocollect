import type { Bbox } from './types';

export function parseQmFormat(qm: string): [number, number][] | null {
  if (!qm?.trim()) return null;
  const main = qm.split(':')[0].trim();
  const values = main.split(',');
  if (values.length % 2 !== 0) return null;
  const coords: [number, number][] = [];
  for (let i = 0; i < values.length; i += 2) {
    const lon = parseFloat(values[i].trim());
    const lat = parseFloat(values[i + 1].trim());
    if (Number.isNaN(lon) || Number.isNaN(lat)) return null;
    coords.push([lon, lat]);
  }
  if (coords.length && (coords[0][0] !== coords.at(-1)![0] || coords[0][1] !== coords.at(-1)![1])) {
    coords.push(coords[0]);
  }
  return coords.length ? coords : null;
}

export function coordsToWkt(coords: [number, number][]): string {
  const ring = coords.map(([lon, lat]) => `${lon} ${lat}`).join(', ');
  return `POLYGON((${ring}))`;
}

export function parseWktPolygon(wkt: string): [number, number][] | null {
  const m = wkt.match(/POLYGON\s*\(\(([^)]+)\)\)/i);
  if (!m) return null;
  const coords: [number, number][] = [];
  for (const pair of m[1].split(',')) {
    const parts = pair.trim().split(/\s+/);
    if (parts.length >= 2) {
      const lon = parseFloat(parts[0]);
      const lat = parseFloat(parts[1]);
      if (!Number.isNaN(lon) && !Number.isNaN(lat)) coords.push([lon, lat]);
    }
  }
  return coords.length ? coords : null;
}

export function bboxFromCoords(coords: [number, number][]): Bbox | null {
  if (!coords.length) return null;
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  for (const [lon, lat] of coords) {
    minLon = Math.min(minLon, lon);
    minLat = Math.min(minLat, lat);
    maxLon = Math.max(maxLon, lon);
    maxLat = Math.max(maxLat, lat);
  }
  return { minLon, minLat, maxLon, maxLat };
}

export function bboxFromWkt(wkt: string | null | undefined): Bbox | null {
  if (!wkt) return null;
  return bboxFromCoords(parseWktPolygon(wkt) ?? []);
}

export function scrapeUsanPolygonWkt(html: string): string | null {
  const pattern = /var spatialObjectDescription = 'POLYGON\((.*?)\)';/;
  const m = html.match(pattern);
  if (!m) return null;
  const inner = m[1].trim();
  const coords: [number, number][] = [];
  for (const coord of inner.replace(/[()]/g, '').split(',')) {
    const parts = coord.trim().split(/\s+/);
    if (parts.length >= 2) {
      const x = parseFloat(parts[0]);
      const y = parseFloat(parts[1]);
      if (!Number.isNaN(x) && !Number.isNaN(y)) coords.push([x, y]);
    }
  }
  if (!coords.length) return null;
  if (coords[0][0] !== coords.at(-1)![0] || coords[0][1] !== coords.at(-1)![1]) {
    coords.push(coords[0]);
  }
  return coordsToWkt(coords);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
