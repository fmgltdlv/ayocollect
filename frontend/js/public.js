import { apiBase } from './api.js';

const MAP_PAGE_SIZE = 400;
const ZOOM_CLUSTERS_UNTIL = 13;
const DAY_OPTIONS = [7, 14, 28];

const PUBLIC_SYSTEM_COLOR = '#f97316';

const statsEl = document.getElementById('public-stats');
const rangeEl = document.getElementById('public-range');
const mapHintEl = document.getElementById('public-map-hint');
const dayFiltersEl = document.getElementById('public-day-filters');
const legendEl = document.getElementById('public-map-legend');
const paginationEl = document.getElementById('public-map-pagination');

let map = null;
let clusterGroup = null;
let tickets = [];
let total = 0;
let mapPage = 0;
let range = null;
let selectedDays = readDaysFromUrl();

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function systemLabel() {
  return 'USAN NV';
}

function readDaysFromUrl() {
  const raw = Number(new URLSearchParams(window.location.search).get('days') ?? 7);
  return DAY_OPTIONS.includes(raw) ? raw : 7;
}

function daysQuery() {
  return `days=${selectedDays}`;
}

function syncDaysToUrl() {
  const url = new URL(window.location.href);
  url.searchParams.set('days', String(selectedDays));
  window.history.replaceState({}, '', url);
}

function updateDayFilterButtons() {
  dayFiltersEl?.querySelectorAll('.public-day-btn').forEach((btn) => {
    btn.classList.toggle('active', Number(btn.dataset.days) === selectedDays);
  });
}

function formatDate(iso) {
  if (!iso) return '';
  const date = new Date(`${iso}T12:00:00`);
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

async function publicRequest(path) {
  const res = await fetch(`${apiBase()}${path}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || res.statusText);
  }
  return data;
}

function ticketMapCenter(ticket) {
  if (ticket.centroid_y != null && ticket.centroid_x != null) {
    return [ticket.centroid_y, ticket.centroid_x];
  }
  if (
    ticket.bbox_min_lat != null &&
    ticket.bbox_max_lat != null &&
    ticket.bbox_min_lon != null &&
    ticket.bbox_max_lon != null
  ) {
    return [
      (ticket.bbox_min_lat + ticket.bbox_max_lat) / 2,
      (ticket.bbox_min_lon + ticket.bbox_max_lon) / 2,
    ];
  }
  return null;
}

function browsePinSize(zoom) {
  if (zoom < ZOOM_CLUSTERS_UNTIL) {
    return Math.round(Math.min(36, Math.max(22, 48 - zoom * 0.9)));
  }
  return Math.round(Math.min(52, Math.max(30, 68 - zoom * 1.1)));
}

function browseClusterIcon(cluster) {
  const count = cluster.getChildCount();
  const style = `background:${PUBLIC_SYSTEM_COLOR}`;
  let sizeClass = 'browse-cluster-sm';
  if (count >= 25) sizeClass = 'browse-cluster-lg';
  else if (count >= 10) sizeClass = 'browse-cluster-md';
  return L.divIcon({
    html: `<span class="browse-cluster ${sizeClass}" style="${style}">${count}</span>`,
    className: 'browse-cluster-icon',
    iconSize: L.point(44, 44),
  });
}

function createTicketPin(ticket, latlng, color, label, zoom) {
  const size = browsePinSize(zoom);
  const icon = L.divIcon({
    className: 'browse-pin-icon',
    html: `<span class="browse-pin-marker" style="--pin-color:${color};--pin-size:${size}px"><span class="browse-pin-core"></span></span>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
  const marker = L.marker(latlng, { icon, browseSystem: ticket.system });
  marker.bindTooltip(label, { sticky: true });
  return marker;
}

function initMap() {
  map = L.map('public-map').setView([36.16, -115.15], 7);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap',
  }).addTo(map);

  clusterGroup = L.markerClusterGroup({
    maxClusterRadius: 56,
    disableClusteringAtZoom: ZOOM_CLUSTERS_UNTIL,
    showCoverageOnHover: false,
    spiderfyOnMaxZoom: false,
    iconCreateFunction: browseClusterIcon,
  });
  map.addLayer(clusterGroup);

  map.on('zoomend', () => renderMapPins(false));
}

function renderMapPins(fitBounds = false) {
  if (!map || !clusterGroup) return;

  const zoom = map.getZoom();
  clusterGroup.clearLayers();
  const boundsLayers = [];

  for (const ticket of tickets) {
    const center = ticketMapCenter(ticket);
    if (!center) continue;
    const color = PUBLIC_SYSTEM_COLOR;
    const label = [
      systemLabel(),
      ticket.ticket_number,
      ticket.revision ? `/ ${ticket.revision}` : '',
      ticket.work_type ? `· ${ticket.work_type}` : '',
    ]
      .filter(Boolean)
      .join(' ');
    const marker = createTicketPin(ticket, center, color, label, zoom);
    clusterGroup.addLayer(marker);
    boundsLayers.push(marker);
  }

  updateLegend();

  if (fitBounds && boundsLayers.length) {
    const combined = boundsLayers[0].getLatLng();
    const bounds = L.latLngBounds(combined, combined);
    for (let i = 1; i < boundsLayers.length; i++) {
      bounds.extend(boundsLayers[i].getLatLng());
    }
    map.fitBounds(bounds, { padding: [28, 28], maxZoom: 10 });
  }
}

function updateLegend() {
  if (!legendEl) return;
  if (!tickets.length) {
    legendEl.classList.add('hidden');
    legendEl.innerHTML = '';
    return;
  }
  legendEl.classList.remove('hidden');
  legendEl.innerHTML = `<span class="browse-legend-item"><span class="browse-legend-swatch" style="background:${PUBLIC_SYSTEM_COLOR}"></span>${systemLabel()}</span>`;
}

function renderPagination() {
  if (!paginationEl) return;

  if (total <= MAP_PAGE_SIZE) {
    paginationEl.classList.add('hidden');
    paginationEl.innerHTML = '';
    return;
  }

  const shown = tickets.length;
  const start = shown ? mapPage * MAP_PAGE_SIZE + 1 : 0;
  const end = shown ? Math.min(mapPage * MAP_PAGE_SIZE + shown, total) : 0;
  const pageCount = Math.max(1, Math.ceil(total / MAP_PAGE_SIZE));

  paginationEl.classList.remove('hidden');
  paginationEl.innerHTML = `
    <span class="muted">Showing ${start.toLocaleString()}–${end.toLocaleString()} of ${total.toLocaleString()} tickets with map data</span>
    <div class="pagination">
      <button class="btn btn-secondary" id="public-map-prev" type="button" ${mapPage === 0 ? 'disabled' : ''}>Previous</button>
      <span class="muted">Page ${mapPage + 1} of ${pageCount}</span>
      <button class="btn btn-secondary" id="public-map-next" type="button" ${(mapPage + 1) * MAP_PAGE_SIZE >= total ? 'disabled' : ''}>Next</button>
    </div>`;

  document.getElementById('public-map-prev')?.addEventListener('click', () => {
    if (mapPage > 0) void loadTickets(mapPage - 1, false);
  });
  document.getElementById('public-map-next')?.addEventListener('click', () => {
    if ((mapPage + 1) * MAP_PAGE_SIZE < total) void loadTickets(mapPage + 1, false);
  });
}

function renderStats(summary) {
  const totalCount = summary.totals?.total ?? 0;
  const activeCount = summary.totals?.active ?? 0;
  const days = range?.days ?? selectedDays;

  statsEl.innerHTML = `
    <div class="kpi-grid public-kpi-grid">
      <div class="kpi-card">
        <span class="kpi-label">USAN NV tickets</span>
        <span class="kpi-value">${totalCount.toLocaleString()}</span>
      </div>
      <div class="kpi-card">
        <span class="kpi-label">Active today</span>
        <span class="kpi-value">${activeCount.toLocaleString()}</span>
      </div>
    </div>
    <p class="browse-stats-hint muted">Counts include USAN NV tickets whose work window overlaps the last ${days} days.</p>`;
}

function renderRange() {
  if (!rangeEl || !range) return;
  rangeEl.textContent = `${formatDate(range.startDate)} – ${formatDate(range.endDate)} · USAN NV · last ${range.days} days`;
  if (mapHintEl) {
    mapHintEl.textContent = `Pins show USAN NV tickets with work windows in the last ${range.days} days. Zoom in to see individual locations.`;
  }
}

async function loadSummary() {
  const summary = await publicRequest(`/public/summary?${daysQuery()}`);
  range = summary.range ?? range;
  selectedDays = range?.days ?? selectedDays;
  renderRange();
  renderStats(summary);
}

async function loadTickets(page = 0, fitBounds = true) {
  mapPage = page;
  const data = await publicRequest(
    `/public/tickets?${daysQuery()}&limit=${MAP_PAGE_SIZE}&offset=${page * MAP_PAGE_SIZE}`
  );
  range = data.range ?? range;
  selectedDays = range?.days ?? selectedDays;
  tickets = data.tickets ?? [];
  total = data.total ?? tickets.length;
  renderRange();
  renderMapPins(fitBounds);
  renderPagination();
}

async function reloadData() {
  syncDaysToUrl();
  updateDayFilterButtons();
  statsEl.textContent = 'Loading ticket counts…';
  if (paginationEl) {
    paginationEl.classList.remove('hidden');
    paginationEl.innerHTML = '<span class="muted">Loading map tickets…</span>';
  }
  await Promise.all([loadSummary(), loadTickets(0, true)]);
}

function initDayFilters() {
  dayFiltersEl?.addEventListener('click', (event) => {
    const btn = event.target.closest('.public-day-btn');
    if (!btn) return;
    const days = Number(btn.dataset.days);
    if (!DAY_OPTIONS.includes(days) || days === selectedDays) return;
    selectedDays = days;
    void reloadData();
  });
  updateDayFilterButtons();
}

async function boot() {
  initMap();
  initDayFilters();
  try {
    await reloadData();
    map.invalidateSize();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    statsEl.innerHTML = `<p class="error">Unable to load public data: ${escapeHtml(message)}</p>`;
    if (rangeEl) rangeEl.textContent = 'Data unavailable';
  }
}

boot();
