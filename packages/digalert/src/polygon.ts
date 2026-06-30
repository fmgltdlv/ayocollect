import type { Bbox } from '@ayocollect/db';

export type PolygonGeoJson = {
  type: 'Polygon';
  coordinates: number[][][];
};

export function parseQmFormat(qmString: string): number[][] | null {
  if (!qmString?.trim()) return null;

  const mainPart = qmString.split(':')[0]?.trim() ?? '';
  const values = mainPart.split(',');
  if (values.length % 2 !== 0) return null;

  const coords: number[][] = [];
  try {
    for (let i = 0; i < values.length; i += 2) {
      const lon = parseFloat(values[i]!.trim());
      const lat = parseFloat(values[i + 1]!.trim());
      if (Number.isNaN(lon) || Number.isNaN(lat)) return null;
      coords.push([lon, lat]);
    }
  } catch {
    return null;
  }

  if (coords.length === 0) return null;
  if (coords[0]![0] !== coords[coords.length - 1]![0] || coords[0]![1] !== coords[coords.length - 1]![1]) {
    coords.push([coords[0]![0], coords[0]![1]]);
  }
  return coords;
}

export function extractPolygonFromTicket(ticketData: Record<string, unknown>): number[][] | null {
  const shape = ticketData.work_area_shape;
  if (typeof shape === 'string') {
    const parsed = parseQmFormat(shape);
    if (parsed) return parsed;
  }

  const vertices = ticketData.vertices;
  if (!Array.isArray(vertices)) return null;

  const coords: number[][] = [];
  for (const vertex of vertices) {
    if (vertex && typeof vertex === 'object' && !Array.isArray(vertex)) {
      const v = vertex as Record<string, unknown>;
      const lat = v.latitude ?? v.lat;
      const lon = v.longitude ?? v.lon;
      if (lat != null && lon != null) {
        coords.push([Number(lon), Number(lat)]);
      }
    } else if (Array.isArray(vertex) && vertex.length >= 2) {
      coords.push([Number(vertex[1]), Number(vertex[0])]);
    }
  }

  if (coords.length === 0) return null;
  if (coords[0]![0] !== coords[coords.length - 1]![0] || coords[0]![1] !== coords[coords.length - 1]![1]) {
    coords.push([coords[0]![0], coords[0]![1]]);
  }
  return coords;
}

export function ringToGeoJson(ring: number[][]): PolygonGeoJson {
  return { type: 'Polygon', coordinates: [ring] };
}

export function computeBbox(ring: number[][]): Bbox {
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLon = Infinity;
  let maxLon = -Infinity;

  for (const [lon, lat] of ring) {
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
    minLon = Math.min(minLon, lon);
    maxLon = Math.max(maxLon, lon);
  }

  return { minLat, maxLat, minLon, maxLon };
}
