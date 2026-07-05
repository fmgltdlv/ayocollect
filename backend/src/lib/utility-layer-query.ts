import { deserialize } from 'flatgeobuf/lib/mjs/geojson.js';
import type { Env } from '../types';
import { proxyUtilityLayer, assertLayerObject } from './utility-layers';

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

/** Routes flatgeobuf HTTP range reads to the R2 proxy (no Worker self-fetch). */
const r2FetchHandlers = new Map<string, (init?: RequestInit) => Promise<Response>>();
let fetchPatched = false;

function ensureFetchPatched(): void {
  if (fetchPatched) return;
  const nativeFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const match = /^https:\/\/r2\.local\/([^/]+)\//.exec(url);
    if (match) {
      const handler = r2FetchHandlers.get(match[1]);
      if (handler) return handler(init);
    }
    return nativeFetch(input, init);
  };
  fetchPatched = true;
}

export async function queryLayerFeatures(
  env: Env,
  layerId: string,
  bbox: QueryBbox
): Promise<GeoFeature[]> {
  await assertLayerObject(env, layerId);
  ensureFetchPatched();

  const queryId = crypto.randomUUID();
  const fakeUrl = `https://r2.local/${queryId}/${layerId}.fgb`;

  r2FetchHandlers.set(queryId, (init) =>
    proxyUtilityLayer(env, layerId, new Request(fakeUrl, init))
  );

  try {
    const rect = {
      minX: bbox.minLon,
      minY: bbox.minLat,
      maxX: bbox.maxLon,
      maxY: bbox.maxLat,
    };

    const features: GeoFeature[] = [];
    for await (const feature of deserialize(fakeUrl, rect)) {
      features.push(feature as GeoFeature);
    }
    return features;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('Not a FlatGeobuf file')) {
      throw new Error(`Layer ${layerId} is missing or not a valid .fgb in R2`);
    }
    throw err;
  } finally {
    r2FetchHandlers.delete(queryId);
  }
}
