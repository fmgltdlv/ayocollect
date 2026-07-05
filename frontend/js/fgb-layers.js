import { deserialize } from 'https://esm.sh/flatgeobuf@4.4.0/lib/mjs/geojson.js';
import { api, apiBase, authHeaders } from './api.js';

const LAYER_COLORS = ['#a855f7', '#14b8a6', '#f59e0b', '#ec4899', '#6366f1', '#84cc16', '#06b6d4', '#ef4444'];

function layerColor(index) {
  return LAYER_COLORS[index % LAYER_COLORS.length];
}

function bboxFromLatLngs(latlngs) {
  if (!latlngs.length) return null;
  let minLat = Infinity;
  let minLon = Infinity;
  let maxLat = -Infinity;
  let maxLon = -Infinity;
  for (const [lat, lon] of latlngs) {
    if (lat < minLat) minLat = lat;
    if (lon < minLon) minLon = lon;
    if (lat > maxLat) maxLat = lat;
    if (lon > maxLon) maxLon = lon;
  }
  return { minLat, minLon, maxLat, maxLon };
}

const TICKET_BUFFER_FEET = 300;
const FEET_TO_METERS = 0.3048;
const METERS_PER_DEG_LAT = 111320;

function feetToDegreeBuffer(feet, centerLat) {
  const meters = feet * FEET_TO_METERS;
  const latPad = meters / METERS_PER_DEG_LAT;
  const cosLat = Math.cos((centerLat * Math.PI) / 180);
  const lonPad = cosLat > 0.01 ? meters / (METERS_PER_DEG_LAT * cosLat) : latPad;
  return { latPad, lonPad };
}

export function ticketQueryBbox(ticket, latlngs, bufferFeet = TICKET_BUFFER_FEET) {
  let minLon;
  let minLat;
  let maxLon;
  let maxLat;

  if (ticket.bbox_min_lon != null && ticket.bbox_max_lon != null) {
    minLon = Number(ticket.bbox_min_lon);
    minLat = Number(ticket.bbox_min_lat);
    maxLon = Number(ticket.bbox_max_lon);
    maxLat = Number(ticket.bbox_max_lat);
  } else {
    const fromPoly = bboxFromLatLngs(latlngs);
    if (fromPoly) {
      minLon = fromPoly.minLon;
      minLat = fromPoly.minLat;
      maxLon = fromPoly.maxLon;
      maxLat = fromPoly.maxLat;
    } else if (ticket.centroid_x != null && ticket.centroid_y != null) {
      minLon = Number(ticket.centroid_x);
      maxLon = Number(ticket.centroid_x);
      minLat = Number(ticket.centroid_y);
      maxLat = Number(ticket.centroid_y);
    } else {
      return null;
    }
  }

  const centerLat = (minLat + maxLat) / 2;
  const { latPad, lonPad } = feetToDegreeBuffer(bufferFeet, centerLat);

  return {
    minLon: minLon - lonPad,
    minLat: minLat - latPad,
    maxLon: maxLon + lonPad,
    maxLat: maxLat + latPad,
  };
}

function layerStyle(color) {
  return {
    color,
    weight: 2,
    opacity: 0.9,
    fillOpacity: 0.08,
  };
}

function pointStyle(color) {
  return {
    radius: 4,
    color,
    weight: 1,
    fillColor: color,
    fillOpacity: 0.85,
  };
}

async function loadLayerFeatures(layer, rect) {
  const url = `${apiBase()}/utility-layers/${encodeURIComponent(layer.id)}`;
  const features = [];
  // flatgeobuf v4 passes the 5th arg as fetch headers for HTTP range reads
  for await (const feature of deserialize(url, rect, undefined, false, authHeaders())) {
    features.push(feature);
  }
  return features;
}

export async function loadUtilityLayersOnMap(map, bbox, { onProgress } = {}) {
  if (!map || !bbox) return { layers: [], totalFeatures: 0 };

  const { layers } = await api.listUtilityLayers();

  if (!layers?.length) return { layers: [], totalFeatures: 0 };

  const rect = {
    minX: bbox.minLon,
    minY: bbox.minLat,
    maxX: bbox.maxLon,
    maxY: bbox.maxLat,
  };
  const loaded = [];
  let totalFeatures = 0;

  for (let i = 0; i < layers.length; i++) {
    const layer = layers[i];
    onProgress?.(`Loading ${layer.name}… (${i + 1}/${layers.length})`);
    const color = layerColor(i);

    try {
      const features = await loadLayerFeatures(layer, rect);
      if (!features.length) continue;

      const geoLayer = L.geoJSON(
        { type: 'FeatureCollection', features },
        {
          style: () => layerStyle(color),
          pointToLayer: (_feature, latlng) => L.circleMarker(latlng, pointStyle(color)),
          onEachFeature: (feature, leafletLayer) => {
            const props = feature.properties ?? {};
            const rows = Object.entries(props)
              .filter(([, value]) => value != null && String(value).trim() !== '')
              .slice(0, 12)
              .map(([key, value]) => `<tr><th>${escapeHtml(key)}</th><td>${escapeHtml(String(value))}</td></tr>`)
              .join('');
            if (rows) {
              leafletLayer.bindPopup(
                `<strong>${escapeHtml(layer.name)}</strong><table class="utility-popup">${rows}</table>`
              );
            }
          },
        }
      );
      geoLayer.addTo(map);
      loaded.push({ layer, geoLayer, color, count: features.length });
      totalFeatures += features.length;
    } catch (err) {
      console.warn(`Utility layer ${layer.id} failed`, err);
    }
  }

  return { layers: loaded, totalFeatures };
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function renderUtilityLegend(container, loadedLayers) {
  if (!container) return;
  if (!loadedLayers.length) {
    container.classList.add('hidden');
    container.innerHTML = '';
    return;
  }

  container.classList.remove('hidden');
  container.innerHTML = `
    <div class="map-legend-title">Utility layers</div>
    ${loadedLayers
      .map(
        (entry) =>
          `<div class="map-legend-item"><span class="map-legend-swatch" style="background:${entry.color}"></span>${escapeHtml(entry.layer.name)} <span class="muted">(${entry.count})</span></div>`
      )
      .join('')}`;
}
