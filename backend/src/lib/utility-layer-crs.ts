import proj4 from 'proj4';

export type QueryBbox = {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
};

const WGS84 = 'EPSG:4326';

/** Fallback proj4 defs when WKT is missing from the FGB header. */
const FALLBACK_DEFS: Record<string, string> = {
  'EPSG:3429':
    '+proj=tmerc +lat_0=34.75 +lon_0=-117.5833333333333 +k=0.9999 +x_0=2500000 +y_0=0 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=us-ft +no_defs',
  'EPSG:3430':
    '+proj=tmerc +lat_0=34.75 +lon_0=-116.5833333333333 +k=0.9999 +x_0=6500000 +y_0=0 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=us-ft +no_defs',
  'EPSG:26911': '+proj=utm +zone=11 +datum=NAD83 +units=m +no_defs',
};

export type FgbCrs = {
  code?: number;
  wkt?: string;
  code_string?: string;
} | null;

export function resolveFileProjection(crs: FgbCrs): string {
  if (!crs?.code || crs.code === 4326) return WGS84;

  const key = crs.code_string?.startsWith('EPSG:') ? crs.code_string : `EPSG:${crs.code}`;
  if (!proj4.defs(key)) {
    if (crs.wkt) proj4.defs(key, crs.wkt);
    else if (FALLBACK_DEFS[key]) proj4.defs(key, FALLBACK_DEFS[key]);
  }

  return proj4.defs(key) ? key : WGS84;
}

/** Transform a WGS84 query bbox into the FGB file's native CRS for spatial index reads. */
export function queryBboxForFileCrs(bbox: QueryBbox, fileProj: string): QueryBbox {
  if (fileProj === WGS84) return bbox;

  const corners: [number, number][] = [
    [bbox.minLon, bbox.minLat],
    [bbox.maxLon, bbox.minLat],
    [bbox.minLon, bbox.maxLat],
    [bbox.maxLon, bbox.maxLat],
  ];

  const projected = corners.map(([lon, lat]) => proj4(WGS84, fileProj, [lon, lat]) as [number, number]);
  const xs = projected.map(([x]) => x);
  const ys = projected.map(([, y]) => y);

  return {
    minLon: Math.min(...xs),
    minLat: Math.min(...ys),
    maxLon: Math.max(...xs),
    maxLat: Math.max(...ys),
  };
}

export function bboxToRect(bbox: QueryBbox) {
  return {
    minX: bbox.minLon,
    minY: bbox.minLat,
    maxX: bbox.maxLon,
    maxY: bbox.maxLat,
  };
}

function coordLeafDepth(geometryType: string): number {
  switch (geometryType) {
    case 'Point':
      return 0;
    case 'LineString':
    case 'MultiPoint':
      return 1;
    case 'Polygon':
    case 'MultiLineString':
      return 2;
    case 'MultiPolygon':
      return 3;
    default:
      return 2;
  }
}

function transformCoordinatePairs(
  coords: unknown,
  fromProj: string,
  leafDepth: number,
  depth = 0
): unknown {
  if (depth === leafDepth) {
    const values = coords as number[];
    const [x, y, ...rest] = values;
    const [lon, lat] = proj4(fromProj, WGS84, [x, y]) as [number, number];
    return rest.length ? [lon, lat, ...rest] : [lon, lat];
  }
  return (coords as unknown[]).map((part) =>
    transformCoordinatePairs(part, fromProj, leafDepth, depth + 1)
  );
}

export type GeoFeature = {
  type: 'Feature';
  id?: number | string;
  geometry: { type: string; coordinates: unknown } | null;
  properties: Record<string, unknown> | null;
};

/** FlatGeobuf geojson output keeps native CRS coords — reproject for Leaflet (EPSG:4326). */
export function reprojectFeature(feature: GeoFeature, fromProj: string): GeoFeature {
  if (!feature.geometry || fromProj === WGS84) return feature;
  const leafDepth = coordLeafDepth(feature.geometry.type);
  return {
    ...feature,
    geometry: {
      ...feature.geometry,
      coordinates: transformCoordinatePairs(feature.geometry.coordinates, fromProj, leafDepth),
    },
  };
}

export function reprojectFeatures(features: GeoFeature[], fromProj: string): GeoFeature[] {
  if (fromProj === WGS84) return features;
  return features.map((feature) => reprojectFeature(feature, fromProj));
}
