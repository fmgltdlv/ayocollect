import { apiBase, badgesHtml, parseWktToLatLngs } from './api.js';

const MAP_PAGE_SIZE = 400;
const ZOOM_CLUSTERS_UNTIL = 13;
const DAY_OPTIONS = [7, 14, 28];
const PUBLIC_SYSTEM_COLOR = '#f97316';

const PUBLIC_TICKET_SECTIONS = [
  {
    title: 'Identification',
    fields: [
      { key: 'job_status', label: 'Job status' },
      { key: 'is_cancelled', label: 'Cancelled' },
      { key: 'is_successful', label: 'Successful' },
      { key: 'trail_id', label: 'Trail ID' },
    ],
  },
  {
    title: 'Location',
    fields: [
      { key: 'address', label: 'Address' },
      { key: 'map_link', label: 'Map link' },
      { key: 'street_sidewalk_or_parkstrip', label: 'Street / sidewalk / parkstrip' },
    ],
  },
  {
    title: 'Schedule',
    fields: [
      { key: 'job_start_date', label: 'Job start' },
      { key: 'work_expiration_date', label: 'Work expires' },
    ],
  },
  {
    title: 'Work',
    fields: [
      { key: 'work_type', label: 'Work type' },
      { key: 'work_activity', label: 'Work activity' },
      { key: 'excavation_method', label: 'Excavation method' },
      { key: 'additional_remarks', label: 'Remarks' },
    ],
  },
  {
    title: 'Record',
    fields: [
      { key: 'created_at', label: 'Created' },
      { key: 'updated_at', label: 'Updated' },
    ],
  },
];

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
let detailBackdrop = null;
let detailMap = null;

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

function formatDateTime(value) {
  if (value === null || value === undefined || value === '') {
    return '<span class="muted">—</span>';
  }
  const date = new Date(String(value));
  if (!Number.isNaN(date.getTime())) {
    return escapeHtml(date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }));
  }
  return escapeHtml(String(value));
}

function formatTicketFieldValue(key, value) {
  if (value === null || value === undefined || value === '') {
    return '<span class="muted">—</span>';
  }
  if (typeof value === 'number' && key.startsWith('is_')) {
    return value ? 'Yes' : 'No';
  }
  if (key === 'map_link') {
    const url = String(value);
    return `<a class="info-link" href="${escapeHtml(url)}" target="_blank" rel="noopener">Open map</a>`;
  }
  if (key.includes('date') || key.endsWith('_at')) {
    return formatDateTime(value);
  }
  return escapeHtml(String(value));
}

function ticketInfoHtml(ticket) {
  const html = PUBLIC_TICKET_SECTIONS.map((section) => {
    const rows = section.fields
      .map(({ key, label }) => {
        const value = ticket[key];
        if (value === null || value === undefined || value === '') return '';
        return `<div class="info-row"><dt class="info-label">${label}</dt><dd class="info-value">${formatTicketFieldValue(key, value)}</dd></div>`;
      })
      .filter(Boolean)
      .join('');
    if (!rows) return '';
    return `<section class="info-section"><h4 class="info-section-title">${section.title}</h4><dl class="info-grid">${rows}</dl></section>`;
  })
    .filter(Boolean)
    .join('');
  return html || '<p class="muted">No ticket details available.</p>';
}

function historyCell(value) {
  if (value === null || value === undefined || value === '') {
    return '<span class="muted">—</span>';
  }
  return escapeHtml(String(value));
}

function ticketHistoryTableHtml(history) {
  if (!history.length) {
    return '<p class="muted">No history recorded.</p>';
  }

  const rows = [...history].sort((a, b) => {
    const ta = a.response_date ? new Date(String(a.response_date)).getTime() : NaN;
    const tb = b.response_date ? new Date(String(b.response_date)).getTime() : NaN;
    if (Number.isNaN(ta) && Number.isNaN(tb)) return 0;
    if (Number.isNaN(ta)) return 1;
    if (Number.isNaN(tb)) return -1;
    return ta - tb;
  });

  const body = rows
    .map(
      (row) => `<tr>
        <td>${formatDateTime(row.response_date)}</td>
        <td class="mono">${historyCell(row.request_number)}</td>
        <td class="mono">${historyCell(row.code)}</td>
        <td>${historyCell(row.name)}</td>
        <td class="mono">${historyCell(row.response_code)}</td>
        <td>${historyCell(row.response_description)}</td>
        <td>${historyCell(row.comment)}</td>
      </tr>`
    )
    .join('');

  return `<div class="history-table-wrap">
    <table class="history-table">
      <thead><tr><th>Date</th><th>Request</th><th>Utility</th><th>Name</th><th>Resp</th><th>Description</th><th>Notes</th></tr></thead>
      <tbody>${body}</tbody>
    </table>
  </div>`;
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

function ticketMapBounds(ticket, latlngs) {
  if (latlngs?.length >= 3) {
    try {
      const bounds = L.polygon(latlngs).getBounds();
      if (bounds.isValid()) return bounds;
    } catch {
      /* fall through */
    }
  }
  if (
    ticket?.bbox_min_lat != null &&
    ticket?.bbox_max_lat != null &&
    ticket?.bbox_min_lon != null &&
    ticket?.bbox_max_lon != null
  ) {
    const bounds = L.latLngBounds(
      [Number(ticket.bbox_min_lat), Number(ticket.bbox_min_lon)],
      [Number(ticket.bbox_max_lat), Number(ticket.bbox_max_lon)]
    );
    if (bounds.isValid()) return bounds;
  }
  return null;
}

function closeDetailModal() {
  document.removeEventListener('keydown', onDetailModalKeydown);
  if (detailMap) {
    detailMap.remove();
    detailMap = null;
  }
  detailBackdrop?.remove();
  detailBackdrop = null;
}

function onDetailModalKeydown(event) {
  if (event.key === 'Escape') closeDetailModal();
}

function openDetailModal(title) {
  closeDetailModal();
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop detail-modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal detail-modal" role="dialog" aria-modal="true" aria-labelledby="public-detail-title">
      <div class="detail-modal-header">
        <h2 class="detail-modal-title" id="public-detail-title">${escapeHtml(title)}</h2>
        <button class="btn-secondary detail-modal-close" type="button">Close</button>
      </div>
      <div class="detail-modal-body"><p class="muted">Loading detail…</p></div>
    </div>`;
  document.body.appendChild(backdrop);
  detailBackdrop = backdrop;
  backdrop.querySelector('.detail-modal-close')?.addEventListener('click', closeDetailModal);
  backdrop.addEventListener('click', (event) => {
    if (event.target === backdrop) closeDetailModal();
  });
  document.addEventListener('keydown', onDetailModalKeydown);
}

function detailModalBody() {
  return detailBackdrop?.querySelector('.detail-modal-body') ?? null;
}

function renderPublicDetail(detail) {
  const body = detailModalBody();
  if (!body) return;

  const ticket = detail.ticket ?? {};
  const stations = detail.stations ?? [];
  const history = detail.ticketHistory ?? [];

  body.innerHTML = `
    <p>${badgesHtml(detail.badges)}</p>
    ${detail.analytics?.hadLateResponse ? '<p class="banner detail-banner">Ticket flagged — utility responded late (888/999 in history).</p>' : ''}
    <div class="detail-grid">
      <div class="panel detail-panel-inline">
        <h3>Ticket info</h3>
        <div class="ticket-info">${ticketInfoHtml(ticket)}</div>
        <h3 class="detail-subheading">Utility responses (current)</h3>
        <table>
          <thead><tr><th>Code</th><th>Name</th><th>Resp</th><th>Description</th></tr></thead>
          <tbody>
            ${stations.length
              ? stations
                  .map(
                    (station) => `<tr>
                <td>${historyCell(station.code)}</td>
                <td>${historyCell(station.name)}</td>
                <td>${historyCell(station.response_code)}</td>
                <td>${historyCell(station.response_description)}</td>
              </tr>`
                  )
                  .join('')
              : '<tr><td colspan="4" class="muted">No utility responses recorded.</td></tr>'}
          </tbody>
        </table>
        <details><summary>History (${history.length})</summary>
          ${ticketHistoryTableHtml(history)}
        </details>
      </div>
      <div class="panel detail-panel-inline">
        <h3>Map</h3>
        <div id="public-detail-map" class="public-detail-map"></div>
      </div>
    </div>`;

  setTimeout(() => {
    const mapEl = body.querySelector('#public-detail-map');
    if (!mapEl) return;

    if (detailMap) {
      detailMap.remove();
      detailMap = null;
    }

    const latlngs = parseWktToLatLngs(ticket.polygon_wkt);
    const bounds = ticketMapBounds(ticket, latlngs);
    const center = bounds ? bounds.getCenter() : L.latLng(36.16, -115.15);
    const zoom = bounds ? 15 : 9;

    detailMap = L.map(mapEl).setView(center, zoom);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap',
    }).addTo(detailMap);

    if (latlngs.length >= 3) {
      const polygon = L.polygon(latlngs, {
        color: PUBLIC_SYSTEM_COLOR,
        weight: 2,
        fillOpacity: 0.2,
      }).addTo(detailMap);
      detailMap.fitBounds(polygon.getBounds(), { padding: [24, 24], maxZoom: 17 });
    } else if (bounds) {
      detailMap.fitBounds(bounds, { padding: [24, 24], maxZoom: 17 });
    }

    detailMap.invalidateSize();
  }, 0);
}

async function openPublicDetail(ticketNumber) {
  const title = `${systemLabel()} — ${ticketNumber}`;
  openDetailModal(title);
  try {
    const detail = await publicRequest(`/public/tickets/${encodeURIComponent(ticketNumber)}`);
    renderPublicDetail(detail);
  } catch (error) {
    const body = detailModalBody();
    const message = error instanceof Error ? error.message : String(error);
    if (body) body.innerHTML = `<p class="error">${escapeHtml(message)}</p>`;
  }
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
  marker.on('click', () => {
    void openPublicDetail(ticket.ticket_number);
  });
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
    mapHintEl.textContent = `Pins show USAN NV tickets with work windows in the last ${range.days} days. Click a pin for ticket details.`;
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
