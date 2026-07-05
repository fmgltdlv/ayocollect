import { deserialize } from 'flatgeobuf/lib/mjs/geojson.js';
import { readMetadata } from 'flatgeobuf/lib/mjs/generic/featurecollection.js';
import { booleanIntersects } from '@turf/boolean-intersects';
import type { Env } from '../types';
import { proxyUtilityLayer, assertLayerObject } from './utility-layers';
import {
  bboxToRect,
  queryBboxForFileCrs,
  reprojectFeatures,
  resolveFileProjection,
  type FgbCrs,
  type GeoFeature,
  type QueryBbox,
} from './utility-layer-crs';

export type { QueryBbox };

function searchAreaFeature(bbox: QueryBbox) {
  const { minLon, minLat, maxLon, maxLat } = bbox;
  return {
    type: 'Feature' as const,
    properties: {},
    geometry: {
      type: 'Polygon' as const,
      coordinates: [
        [
          [minLon, minLat],
          [maxLon, minLat],
          [maxLon, maxLat],
          [minLon, maxLat],
          [minLon, minLat],
        ],
      ],
    },
  };
}

export type LayerQueryMeta = {
  fileCrs: string;
  featureCount: number;
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

function withR2Fetch<T>(
  env: Env,
  layerId: string,
  run: (fakeUrl: string) => Promise<T>
): Promise<T> {
  ensureFetchPatched();
  const queryId = crypto.randomUUID();
  const fakeUrl = `https://r2.local/${queryId}/${layerId}.fgb`;

  r2FetchHandlers.set(queryId, (init) =>
    proxyUtilityLayer(env, layerId, new Request(fakeUrl, init))
  );

  return run(fakeUrl).finally(() => {
    r2FetchHandlers.delete(queryId);
  });
}

export async function queryLayerFeatures(
  env: Env,
  layerId: string,
  bbox: QueryBbox
): Promise<{ features: GeoFeature[]; meta: LayerQueryMeta }> {
  await assertLayerObject(env, layerId);

  return withR2Fetch(env, layerId, async (fakeUrl) => {
    const header = await readMetadata(fakeUrl);
    const fileCrs = resolveFileProjection(header.crs as FgbCrs);
    const fileBbox = queryBboxForFileCrs(bbox, fileCrs);
    const rect = bboxToRect(fileBbox);

    const rawFeatures: GeoFeature[] = [];
    for await (const feature of deserialize(fakeUrl, rect)) {
      rawFeatures.push(feature as GeoFeature);
    }

    const features = reprojectFeatures(rawFeatures, fileCrs);
    const searchArea = searchAreaFeature(bbox);
    const filtered = features.filter(
      (feature) => feature.geometry && booleanIntersects(feature, searchArea)
    );

    return {
      features: filtered,
      meta: {
        fileCrs,
        featureCount: header.featuresCount ?? 0,
      },
    };
  }).catch((err) => {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('Not a FlatGeobuf file')) {
      throw new Error(`Layer ${layerId} is missing or not a valid .fgb in R2`);
    }
    throw err;
  });
}
