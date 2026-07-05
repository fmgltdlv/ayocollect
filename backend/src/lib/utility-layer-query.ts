import { deserialize } from 'flatgeobuf/lib/mjs/geojson.js';
import type { Env } from '../types';
import { createUtilityFileToken } from './utility-layer-token';

export type QueryBbox = {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
};

type GeoFeature = {
  type: 'Feature';
  geometry: { type: string; coordinates: unknown } | null;
  properties: Record<string, unknown> | null;
};

export async function queryLayerFeatures(
  env: Env,
  workerOrigin: string,
  layerId: string,
  bbox: QueryBbox,
  email: string
): Promise<GeoFeature[]> {
  const token = await createUtilityFileToken(env, email);
  const url = `${workerOrigin}/api/utility-layers/${encodeURIComponent(layerId)}?token=${encodeURIComponent(token)}`;
  const rect = {
    minX: bbox.minLon,
    minY: bbox.minLat,
    maxX: bbox.maxLon,
    maxY: bbox.maxLat,
  };

  const features: GeoFeature[] = [];
  for await (const feature of deserialize(url, rect)) {
    features.push(feature as GeoFeature);
  }
  return features;
}
