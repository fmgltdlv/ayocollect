import type { Env } from '../types';

const LAYER_ID_RE = /^[a-zA-Z0-9_-]+$/;

export type UtilityLayerInfo = {
  id: string;
  name: string;
  key: string;
};

function layersPrefix(env: Env): string {
  const raw = env.UTILITY_LAYERS_PREFIX?.trim() ?? '';
  return raw && !raw.endsWith('/') ? `${raw}/` : raw;
}

function formatLayerName(id: string): string {
  return id
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function layerKey(env: Env, layerId: string): string | null {
  if (!LAYER_ID_RE.test(layerId)) return null;
  return `${layersPrefix(env)}${layerId}.fgb`;
}

export function utilityLayersConfigured(env: Env): boolean {
  return !!env.UTILITY_LAYERS;
}

export async function listUtilityLayers(env: Env): Promise<UtilityLayerInfo[]> {
  if (!env.UTILITY_LAYERS) return [];

  const prefix = layersPrefix(env);
  const listed = await env.UTILITY_LAYERS.list({ prefix });
  const layers: UtilityLayerInfo[] = [];

  for (const object of listed.objects) {
    if (!object.key.toLowerCase().endsWith('.fgb')) continue;
    const relative = object.key.slice(prefix.length);
    const id = relative.replace(/\.fgb$/i, '');
    if (!id || !LAYER_ID_RE.test(id)) continue;
    layers.push({ id, name: formatLayerName(id), key: object.key });
  }

  layers.sort((a, b) => a.name.localeCompare(b.name));
  return layers;
}

type ParsedRange = {
  offset: number;
  length: number;
  start: number;
  end: number;
};

function parseRangeHeader(range: string | null, size: number): ParsedRange | null {
  if (!range) return null;
  const match = /^bytes=(\d+)-(\d*)$/i.exec(range.trim());
  if (!match) return null;

  const start = Number(match[1]);
  if (!Number.isFinite(start) || start < 0 || start >= size) return null;

  const end = match[2] ? Number(match[2]) : size - 1;
  if (!Number.isFinite(end) || end < start || end >= size) return null;

  return {
    offset: start,
    length: end - start + 1,
    start,
    end,
  };
}

export async function proxyUtilityLayer(env: Env, layerId: string, request: Request): Promise<Response> {
  if (!env.UTILITY_LAYERS) {
    return new Response(JSON.stringify({ error: 'Utility layers not configured' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const key = layerKey(env, layerId);
  if (!key) {
    return new Response(JSON.stringify({ error: 'Invalid layer id' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const head = await env.UTILITY_LAYERS.head(key);
  if (!head) {
    return new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const size = head.size;
  const range = parseRangeHeader(request.headers.get('Range'), size);
  const object = await env.UTILITY_LAYERS.get(
    key,
    range ? { range: { offset: range.offset, length: range.length } } : undefined
  );

  if (!object) {
    return new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const headers = new Headers();
  headers.set('Content-Type', 'application/octet-stream');
  headers.set('Accept-Ranges', 'bytes');
  headers.set('Cache-Control', 'public, max-age=3600');

  if (range) {
    headers.set('Content-Range', `bytes ${range.start}-${range.end}/${size}`);
    headers.set('Content-Length', String(range.length));
    return new Response(object.body, { status: 206, headers });
  }

  headers.set('Content-Length', String(size));
  return new Response(object.body, { status: 200, headers });
}
