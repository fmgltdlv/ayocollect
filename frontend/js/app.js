import { api, badgesHtml, bboxFromLayer, parseWktToLatLngs } from './api.js';
import {
  initAuth,
  mountAuthHeader,
  refreshAuthHeader,
  renderGoogleButton,
  setupGoogleButton,
} from './auth.js';

const app = document.getElementById('app');
const stoppedBanner = document.getElementById('stopped-banner');
const detailTab = document.getElementById('detail-tab');
const authArea = document.getElementById('auth-area');

const BROWSE_PAGE_SIZE = 100;
const BROWSE_POLYGON_MAX_ZOOM = 17;

let state = {
  view: 'browse',
  isAdmin: false,
  browseSystems: ['digalert', 'usan-ca', 'usan-nv'],
  browsePage: 0,
  browseTotal: 0,
  browseParams: {},
  browseBadges: [],
  detail: null,
  detailSystem: null,
  analytics: null,
  analyticsMap: null,
  searchMap: null,
  detailMap: null,
  drawLayer: null,
  drawnGroup: null,
  ticketLayerGroup: null,
  browseMapTickets: [],
  jobsPollId: null,
};

const ADMIN_VIEWS = new Set(['fetch', 'jobs', 'admin']);

function updateAdminTabs(isAdmin) {
  document.querySelectorAll('.admin-tab').forEach((tab) => {
    tab.classList.toggle('hidden', !isAdmin);
  });
}

function setView(view) {
  if (ADMIN_VIEWS.has(view) && !state.isAdmin) {
    view = 'browse';
  }
  if (state.jobsPollId) {
    clearInterval(state.jobsPollId);
    state.jobsPollId = null;
  }
  state.view = view;
  document.querySelectorAll('.tab').forEach((t) => {
    t.classList.toggle('active', t.dataset.view === view);
  });
  render();
}

async function refreshStopped() {
  if (!state.isAdmin) return;
  try {
    const { fetchStopped } = await api.listJobs();
    stoppedBanner.classList.toggle('hidden', !fetchStopped);
  } catch {
    /* ignore */
  }
}

document.querySelectorAll('.tab').forEach((btn) => {
  btn.addEventListener('click', () => setView(btn.dataset.view));
});

function systemLabel(s) {
  if (s === 'digalert') return 'Dig Alert';
  if (s === 'usan-ca') return 'USAN CA';
  return 'USAN NV';
}

function ticketRowLabel(t, system) {
  const sys = system ?? t.system;
  if (sys === 'digalert') {
    return [t.place, t.street, t.work_type].filter(Boolean).join(' · ') || t.location || '—';
  }
  return [t.address, t.work_type, t.work_activity].filter(Boolean).join(' · ') || '—';
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatTicketFieldValue(key, value) {
  if (value === null || value === undefined || value === '') {
    return '<span class="muted">—</span>';
  }
  if (typeof value === 'number' && (key.startsWith('is_') || key === 'one_year')) {
    return value ? 'Yes' : 'No';
  }
  if (key === 'map_link') {
    const url = String(value);
    return `<a class="info-link" href="${escapeHtml(url)}" target="_blank" rel="noopener">Open map</a>`;
  }
  if (key.includes('date') || key === 'completed' || key.endsWith('_at')) {
    const d = new Date(String(value));
    if (!Number.isNaN(d.getTime())) {
      return escapeHtml(d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }));
    }
  }
  if (key === 'fetch_error') {
    return `<span class="info-error">${escapeHtml(String(value))}</span>`;
  }
  return escapeHtml(String(value));
}

const DIGALERT_INFO_SECTIONS = [
  {
    title: 'Identification',
    fields: [
      { key: 'revision', label: 'Revision' },
      { key: 'type', label: 'Type' },
      { key: 'completed', label: 'Completed' },
      { key: 'replace_by_date', label: 'Replace by' },
    ],
  },
  {
    title: 'Location',
    fields: [
      { key: 'place', label: 'Place' },
      { key: 'street', label: 'Street' },
      { key: 'st_from_address', label: 'From address' },
      { key: 'cross1', label: 'Cross street 1' },
      { key: 'cross2', label: 'Cross street 2' },
      { key: 'location', label: 'Location notes' },
      { key: 'county', label: 'County' },
    ],
  },
  {
    title: 'Work',
    fields: [
      { key: 'work_type', label: 'Work type' },
      { key: 'work_order', label: 'Work order' },
      { key: 'done_for', label: 'Done for' },
      { key: 'one_year', label: 'One-year ticket' },
    ],
  },
  {
    title: 'Contact',
    fields: [
      { key: 'caller', label: 'Caller' },
      { key: 'email', label: 'Email' },
      { key: 'phone', label: 'Phone' },
      { key: 'contact_phone', label: 'Contact phone' },
    ],
  },
  {
    title: 'Record',
    fields: [{ key: 'updated_at', label: 'Updated' }],
  },
];

const USAN_INFO_SECTIONS = [
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
    title: 'Contact',
    fields: [{ key: 'created_by', label: 'Created by' }],
  },
  {
    title: 'Record',
    fields: [
      { key: 'fetch_status', label: 'Fetch status' },
      { key: 'fetch_error', label: 'Fetch error' },
      { key: 'created_at', label: 'Created' },
      { key: 'updated_at', label: 'Updated' },
    ],
  },
];

function ticketInfoHtml(system, ticket) {
  const sections = system === 'digalert' ? DIGALERT_INFO_SECTIONS : USAN_INFO_SECTIONS;
  const html = sections
    .map((section) => {
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

function browseSystemsFromDom() {
  const systems = [];
  if (document.getElementById('browse-da')?.checked) systems.push('digalert');
  if (document.getElementById('browse-ca')?.checked) systems.push('usan-ca');
  if (document.getElementById('browse-nv')?.checked) systems.push('usan-nv');
  return systems;
}

function browseBadgesFromDom() {
  const badges = [];
  if (document.getElementById('browse-badge-pending')?.checked) badges.push('pending');
  if (document.getElementById('browse-badge-blocker')?.checked) badges.push('blocker');
  if (document.getElementById('browse-badge-late')?.checked) badges.push('late');
  return badges;
}

function browseFiltersFromDom() {
  const params = {};
  const start = document.getElementById('start-date')?.value;
  const end = document.getElementById('end-date')?.value;
  const ticket = document.getElementById('ticket-filter')?.value.trim();
  if (start) params.startDate = start;
  if (end) params.endDate = end;
  if (ticket) params.ticketNumber = ticket;
  if (state.drawLayer) {
    Object.assign(params, bboxFromLayer(state.drawLayer));
  }
  const badges = browseBadgesFromDom();
  if (badges.length) params.badges = badges.join(',');
  return params;
}

function renderBrowseResults(tickets, total, page) {
  const resultsEl = document.getElementById('results');
  updateBrowseMapTickets(tickets);
  if (!tickets.length) {
    resultsEl.textContent = 'No tickets found.';
    return;
  }

  const start = page * BROWSE_PAGE_SIZE + 1;
  const end = Math.min(start + tickets.length - 1, total);
  const multiSystem = state.browseSystems.length > 1;

  resultsEl.innerHTML = `
    <div class="browse-meta">
      <span class="muted">Showing ${start}–${end} of ${total}</span>
      <div class="pagination">
        <button class="btn btn-secondary" id="browse-prev" type="button" ${page === 0 ? 'disabled' : ''}>Previous</button>
        <span class="muted">Page ${page + 1} of ${Math.max(1, Math.ceil(total / BROWSE_PAGE_SIZE))}</span>
        <button class="btn btn-secondary" id="browse-next" type="button" ${end >= total ? 'disabled' : ''}>Next</button>
      </div>
    </div>
    <table>
      <thead><tr>
        <th>Badges</th>${multiSystem ? '<th>System</th>' : ''}<th>Ticket</th><th>Summary</th><th>Updated</th>
      </tr></thead>
      <tbody>
        ${tickets
          .map(
            (t) => `
          <tr class="clickable" data-system="${t.system}" data-ticket="${t.ticket_number}" data-revision="${t.revision ?? '00A'}">
            <td>${badgesHtml(t.badges)}</td>
            ${multiSystem ? `<td>${systemLabel(t.system)}</td>` : ''}
            <td class="mono">${t.ticket_number}${t.revision ? ` / ${t.revision}` : ''}</td>
            <td>${ticketRowLabel(t)}</td>
            <td>${t.updated_at ?? ''}</td>
          </tr>`
          )
          .join('')}
      </tbody>
    </table>`;

  document.getElementById('browse-prev')?.addEventListener('click', () => {
    if (state.browsePage > 0) runBrowseSearch(state.browsePage - 1);
  });
  document.getElementById('browse-next')?.addEventListener('click', () => {
    if ((state.browsePage + 1) * BROWSE_PAGE_SIZE < state.browseTotal) {
      runBrowseSearch(state.browsePage + 1);
    }
  });

  resultsEl.querySelectorAll('tr.clickable').forEach((tr) => {
    tr.addEventListener('click', () =>
      openDetail(tr.dataset.system, tr.dataset.ticket, tr.dataset.revision)
    );
  });
}

function renderBrowse() {
  const { startDate = '', endDate = '', ticketNumber = '' } = state.browseParams;
  app.innerHTML = `
    <div class="panel browse-panel">
      <h2 class="panel-heading">Browse tickets</h2>
      <div class="browse-filters">
        <div class="filter-group">
          <span class="filter-label">Systems</span>
          <div class="chip-group">
            <label class="chip-check"><input type="checkbox" id="browse-da" ${state.browseSystems.includes('digalert') ? 'checked' : ''} /><span>Dig Alert</span></label>
            <label class="chip-check"><input type="checkbox" id="browse-ca" ${state.browseSystems.includes('usan-ca') ? 'checked' : ''} /><span>USAN CA</span></label>
            <label class="chip-check"><input type="checkbox" id="browse-nv" ${state.browseSystems.includes('usan-nv') ? 'checked' : ''} /><span>USAN NV</span></label>
          </div>
        </div>
        <div class="filter-group">
          <span class="filter-label">Badges</span>
          <div class="chip-group">
            <label class="chip-check chip-badge"><input type="checkbox" id="browse-badge-pending" ${state.browseBadges.includes('pending') ? 'checked' : ''} /><span class="badge badge-pending">Pending</span></label>
            <label class="chip-check chip-badge"><input type="checkbox" id="browse-badge-blocker" ${state.browseBadges.includes('blocker') ? 'checked' : ''} /><span class="badge badge-blocker">Blocker</span></label>
            <label class="chip-check chip-badge"><input type="checkbox" id="browse-badge-late" ${state.browseBadges.includes('late') ? 'checked' : ''} /><span class="badge badge-late">Late</span></label>
          </div>
        </div>
        <div class="filter-group filter-group-wide">
          <span class="filter-label">Date range</span>
          <div class="date-range">
            <label class="field-inline"><span>From</span><input type="date" id="start-date" value="${startDate}" /></label>
            <span class="date-sep" aria-hidden="true">–</span>
            <label class="field-inline"><span>To</span><input type="date" id="end-date" value="${endDate}" /></label>
          </div>
        </div>
        <div class="filter-group">
          <span class="filter-label">Ticket #</span>
          <input type="text" id="ticket-filter" class="filter-input" placeholder="Optional" value="${ticketNumber}" />
        </div>
        <div class="filter-actions">
          <button class="btn" id="search-btn" type="button">Search</button>
        </div>
      </div>
      <div class="map-section">
        <p class="map-hint">Draw a rectangle to filter by area. Ticket shapes appear on the map; zoom in past level 17 to see pins.</p>
        <div id="search-map"></div>
      </div>
    </div>
    <div class="panel"><div id="results">Loading…</div></div>
  `;

  setTimeout(() => {
    initSearchMap();
    runBrowseSearch(0);
  }, 0);

  document.getElementById('search-btn').addEventListener('click', () => runBrowseSearch(0));
}

function initSearchMap() {
  if (state.searchMap) {
    state.searchMap.remove();
    state.searchMap = null;
  }
  state.drawnGroup = null;
  state.ticketLayerGroup = null;
  state.drawLayer = null;
  state.browseMapTickets = [];

  state.searchMap = L.map('search-map').setView([36.16, -115.15], 9);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap',
  }).addTo(state.searchMap);

  state.drawnGroup = new L.FeatureGroup();
  state.ticketLayerGroup = new L.FeatureGroup();
  state.searchMap.addLayer(state.drawnGroup);
  state.searchMap.addLayer(state.ticketLayerGroup);

  state.searchMap.addControl(
    new L.Control.Draw({
      draw: {
        polygon: false,
        polyline: false,
        circle: false,
        circlemarker: false,
        marker: false,
        rectangle: {
          shapeOptions: { color: '#eab308', weight: 2, fillOpacity: 0.08 },
        },
      },
      edit: { featureGroup: state.drawnGroup },
    })
  );

  state.searchMap.on(L.Draw.Event.CREATED, (e) => {
    state.drawnGroup.clearLayers();
    state.drawnGroup.addLayer(e.layer);
    state.drawLayer = e.layer;
  });

  state.searchMap.on(L.Draw.Event.DELETED, () => {
    state.drawLayer = null;
  });

  state.searchMap.on('zoomend', () => renderBrowseMapTickets(false));
}

const BROWSE_SYSTEM_COLORS = {
  digalert: '#3b82f6',
  'usan-ca': '#22c55e',
  'usan-nv': '#f97316',
};

function ticketMapCenter(ticket, latlngs) {
  if (ticket.centroid_y != null && ticket.centroid_x != null) {
    return [ticket.centroid_y, ticket.centroid_x];
  }
  if (latlngs.length) {
    const center = L.polygon(latlngs).getBounds().getCenter();
    return [center.lat, center.lng];
  }
  return null;
}

function bindBrowseTicketLayer(layer, ticket, label) {
  layer.bindTooltip(label, { sticky: true });
  layer.on('click', () => openDetail(ticket.system, ticket.ticket_number, ticket.revision ?? '00A'));
}

function browsePinSize(zoom) {
  return Math.round(Math.min(58, Math.max(26, 78 - zoom * 1.35)));
}

function createBrowseTicketPin(ticket, latlng, color, label, zoom) {
  const size = browsePinSize(zoom);
  const icon = L.divIcon({
    className: 'browse-pin-icon',
    html: `<span class="browse-pin-marker" style="--pin-color:${color};--pin-size:${size}px"><span class="browse-pin-core"></span></span>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
  const marker = L.marker(latlng, { icon });
  bindBrowseTicketLayer(marker, ticket, label);
  return marker;
}

function createBrowseTicketPolygon(ticket, latlngs, color, label) {
  const poly = L.polygon(latlngs, {
    color,
    weight: 2,
    fillOpacity: 0.2,
  });
  bindBrowseTicketLayer(poly, ticket, label);
  return poly;
}

function browseMapUsesPins() {
  return state.searchMap.getZoom() > BROWSE_POLYGON_MAX_ZOOM;
}

function renderBrowseMapTickets(fitBounds = false) {
  if (!state.searchMap || !state.ticketLayerGroup) return;

  state.ticketLayerGroup.clearLayers();
  const usePins = browseMapUsesPins();
  const zoom = state.searchMap.getZoom();
  const boundsLayers = [];

  for (const t of state.browseMapTickets) {
    const color = BROWSE_SYSTEM_COLORS[t.system] ?? '#3b82f6';
    const label = `${systemLabel(t.system)} — ${t.ticket_number}${t.revision ? ` / ${t.revision}` : ''}`;
    const latlngs = parseWktToLatLngs(t.polygon_wkt);

    if (usePins || !latlngs.length) {
      const center = ticketMapCenter(t, latlngs);
      if (!center) continue;
      const marker = createBrowseTicketPin(t, center, color, label, zoom);
      state.ticketLayerGroup.addLayer(marker);
      boundsLayers.push(marker);
      continue;
    }

    const poly = createBrowseTicketPolygon(t, latlngs, color, label);
    state.ticketLayerGroup.addLayer(poly);
    boundsLayers.push(poly);
  }

  if (state.drawLayer) boundsLayers.push(state.drawLayer);

  if (fitBounds && boundsLayers.length) {
    const combined = boundsLayers[0].getBounds();
    for (let i = 1; i < boundsLayers.length; i++) {
      combined.extend(boundsLayers[i].getBounds());
    }
    state.searchMap.fitBounds(combined, { padding: [28, 28], maxZoom: 15 });
  }
}

function updateBrowseMapTickets(tickets) {
  state.browseMapTickets = tickets;
  renderBrowseMapTickets(true);
}

async function runBrowseSearch(page = 0) {
  const systems = browseSystemsFromDom();
  if (!systems.length) {
    document.getElementById('results').textContent = 'Select at least one system.';
    updateBrowseMapTickets([]);
    return;
  }

  state.browseSystems = systems;
  state.browsePage = page;
  if (page === 0) {
    state.browseParams = browseFiltersFromDom();
    state.browseBadges = browseBadgesFromDom();
  }

  const params = {
    ...state.browseParams,
    limit: BROWSE_PAGE_SIZE,
    offset: page * BROWSE_PAGE_SIZE,
  };

  const resultsEl = document.getElementById('results');
  resultsEl.textContent = 'Loading…';
  try {
    const { tickets, total } = await api.browseTickets(systems, params);
    state.browseTotal = total;
    renderBrowseResults(tickets, total, page);
  } catch (e) {
    resultsEl.textContent = e.message;
    updateBrowseMapTickets([]);
  }
}

function renderFetch() {
  app.innerHTML = `
    <div class="panel">
      <h2>Fetch single ticket</h2>
      <div class="row">
        <label>System
          <select id="fetch-system">
            <option value="digalert">Dig Alert</option>
            <option value="usan-ca">USAN CA</option>
            <option value="usan-nv">USAN NV</option>
          </select>
        </label>
        <label>Ticket # <input id="fetch-ticket" type="text" placeholder="e.g. 2026063000123-000" /></label>
        <label id="rev-label">Revision <input id="fetch-revision" type="text" value="00A" /></label>
        <button class="btn" id="fetch-one-btn" type="button">Fetch & Store</button>
      </div>
      <pre id="fetch-result" class="mono"></pre>
    </div>
    <div class="panel">
      <h2>Batch scrape (container)</h2>
      <p class="muted">Starts the dedicated scraper container. Tickets appear in Browse as batches are ingested.</p>
      <div class="row checks">
        <label><input type="checkbox" id="job-da" /> Dig Alert</label>
        <label><input type="checkbox" id="job-ca" checked /> USAN CA</label>
        <label><input type="checkbox" id="job-nv" checked /> USAN NV</label>
      </div>
      <div class="row">
        <label>Start <input type="date" id="job-start" /></label>
        <label>End <input type="date" id="job-end" /></label>
        <button class="btn" id="job-start-btn" type="button">Start job</button>
      </div>
      <pre id="job-result" class="mono"></pre>
    </div>
  `;

  const sysSel = document.getElementById('fetch-system');
  const toggleRev = () => {
    document.getElementById('rev-label').classList.toggle('hidden', sysSel.value !== 'digalert');
  };
  sysSel.addEventListener('change', toggleRev);
  toggleRev();

  document.getElementById('fetch-one-btn').addEventListener('click', async () => {
    const system = sysSel.value;
    const ticket = document.getElementById('fetch-ticket').value.trim();
    const out = document.getElementById('fetch-result');
    out.textContent = 'Fetching…';
    try {
      const body = system === 'digalert'
        ? { ticket, revision: document.getElementById('fetch-revision').value.trim() || '00A' }
        : { ticket };
      const res = await api.fetchOne(system, body);
      out.textContent = JSON.stringify(res, null, 2);
      openDetail(system, ticket, body.revision);
    } catch (e) {
      out.textContent = e.message;
    }
  });

  document.getElementById('job-start-btn').addEventListener('click', async () => {
    const systems = [];
    if (document.getElementById('job-da').checked) systems.push('digalert');
    if (document.getElementById('job-ca').checked) systems.push('usan-ca');
    if (document.getElementById('job-nv').checked) systems.push('usan-nv');
    const startDate = document.getElementById('job-start').value;
    const endDate = document.getElementById('job-end').value;
    const out = document.getElementById('job-result');
    if (!systems.length || !startDate || !endDate) {
      out.textContent = 'Select systems and date range.';
      return;
    }
    out.textContent = 'Starting…';
    try {
      const payload = { systems, startDate, endDate };
      const res = await api.createJob(payload);
      out.textContent = res.dedicatedScraper
        ? (res.message ||
            `Job #${res.job?.id ?? '?'} started — scraper container running. See Jobs tab for progress.`)
        : 'Job started — fetching continuously in background. Check Jobs tab for progress.';
      await refreshStopped();
      setView('jobs');
    } catch (e) {
      out.textContent = e.message;
    }
  });
}

const JOBS_POLL_MS = 30_000;

function jobListStatusLabel(job) {
  if (job.triggered_by === 'container') {
    const fetched =
      (job.digalert_fetched || 0) + (job.usan_ca_fetched || 0) + (job.usan_nv_fetched || 0);
    if (job.status === 'running') {
      return fetched ? `${job.status} (container · ${fetched} tickets)` : `${job.status} (container)`;
    }
    return `${job.status} (container)`;
  }
  return job.status;
}

function jobStatusLabel(job, progress) {
  if (job.triggered_by === 'container') {
    if (job.status === 'running') {
      const fetched =
        (job.digalert_fetched || 0) + (job.usan_ca_fetched || 0) + (job.usan_nv_fetched || 0);
      if (progress && progress.systemsComplete < progress.systemsActive) {
        return `running (container · ${fetched} tickets)`;
      }
      return fetched ? `running (container · ${fetched} tickets)` : 'running (container)';
    }
    return job.status;
  }
  if (job.status !== 'running' || !progress) return job.status;
  if (progress.systemsComplete >= progress.systemsActive) return 'running';
  return `running (${progress.systemsComplete}/${progress.systemsActive} systems done)`;
}

function bindJobsTableEvents(el) {
  el.querySelectorAll('.tick-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await api.tickJob(btn.dataset.id);
      refreshJobsList();
    });
  });
  el.querySelectorAll('.stop-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm(`Stop job #${btn.dataset.id}?`)) return;
      await api.cancelJob(btn.dataset.id);
      refreshJobsList();
    });
  });
  el.querySelectorAll('.progress-btn').forEach((btn) => {
    btn.addEventListener('click', () => showJobProgress(btn.dataset.id));
  });
}

function renderJobsTable(jobs) {
  if (!jobs.length) return '<p>No jobs yet.</p>';
  return `
    <p class="muted">DigAlert = Southern CA only. Each system scans up to 3999 tickets/day. CA/NV share ticket number format, so identical counts are expected.</p>
    <table>
      <thead><tr>
        <th>ID</th><th>Status</th><th>Range</th><th>Systems</th><th>Fetched</th><th></th>
      </tr></thead>
      <tbody>
        ${jobs
          .map(
            (j) => `
          <tr>
            <td>${j.id}</td>
            <td>${jobListStatusLabel(j)}${j.status === 'running' ? ' <span class="muted">(auto-refreshes every 30s)</span>' : ''}</td>
            <td>${j.start_date} → ${j.end_date}</td>
            <td class="mono">${[
              j.include_digalert ? 'DA' : '',
              j.include_usan_ca ? 'CA' : '',
              j.include_usan_nv ? 'NV' : '',
            ]
              .filter(Boolean)
              .join(', ')}</td>
            <td>DA:${j.digalert_fetched} CA:${j.usan_ca_fetched} NV:${j.usan_nv_fetched}</td>
            <td>
              <div class="btn-row">
                <button class="btn-secondary progress-btn" data-id="${j.id}" type="button">Progress</button>
                ${j.status === 'paused' ? `<button class="btn tick-btn" data-id="${j.id}" type="button">Continue</button>` : ''}
                ${['running', 'paused', 'pending'].includes(j.status) ? `<button class="btn-danger stop-btn" data-id="${j.id}" type="button">Stop</button>` : ''}
              </div>
            </td>
          </tr>`
          )
          .join('')}
      </tbody>
    </table>`;
}

function syncJobsPoll(jobs) {
  const hasRunning = jobs.some((j) => j.status === 'running');
  if (hasRunning && !state.jobsPollId) {
    state.jobsPollId = setInterval(() => {
      if (state.view === 'jobs') refreshJobsList();
    }, JOBS_POLL_MS);
  } else if (!hasRunning && state.jobsPollId) {
    clearInterval(state.jobsPollId);
    state.jobsPollId = null;
  }
}

async function refreshJobsList() {
  const el = document.getElementById('jobs-list');
  if (!el) return;
  try {
    const { jobs, fetchStopped } = await api.listJobs();
    stoppedBanner.classList.toggle('hidden', !fetchStopped);
    el.innerHTML = renderJobsTable(jobs);
    bindJobsTableEvents(el);
    syncJobsPoll(jobs);
  } catch (e) {
    el.textContent = e.message;
  }
}

async function renderJobs() {
  app.innerHTML = `
    <div class="panel">
      <h2>Auto-fetch settings</h2>
      <div id="settings-form">Loading…</div>
    </div>
    <div class="panel">
      <div class="row" style="align-items:center;justify-content:space-between;margin-bottom:0.75rem">
        <h2 style="margin:0">Jobs</h2>
        <button class="btn-secondary" id="jobs-refresh-btn" type="button">Refresh</button>
      </div>
      <div id="jobs-list">Loading…</div>
    </div>
  `;
  try {
    const settings = await api.getSettings();
    document.getElementById('settings-form').innerHTML = `
      <div class="row checks">
        <label><input type="checkbox" id="set-enabled" ${settings.auto_fetch_enabled === '1' ? 'checked' : ''} /> Enabled</label>
        <label><input type="checkbox" id="set-da" ${settings.auto_fetch_include_digalert === '1' ? 'checked' : ''} /> Dig Alert</label>
        <label><input type="checkbox" id="set-ca" ${settings.auto_fetch_include_usan_ca === '1' ? 'checked' : ''} /> USAN CA</label>
        <label><input type="checkbox" id="set-nv" ${settings.auto_fetch_include_usan_nv === '1' ? 'checked' : ''} /> USAN NV</label>
      </div>
      <div class="row">
        <label>Daily time (UTC) <input type="time" id="set-time" value="${settings.auto_fetch_time_utc || '06:00'}" /></label>
        <label>Lookback days <input type="number" id="set-lookback" min="1" value="${settings.auto_fetch_lookback_days || '1'}" /></label>
        <button class="btn" id="save-settings" type="button">Save</button>
      </div>`;
    document.getElementById('save-settings').addEventListener('click', async () => {
      await api.putSettings({
        auto_fetch_enabled: document.getElementById('set-enabled').checked ? '1' : '0',
        auto_fetch_include_digalert: document.getElementById('set-da').checked ? '1' : '0',
        auto_fetch_include_usan_ca: document.getElementById('set-ca').checked ? '1' : '0',
        auto_fetch_include_usan_nv: document.getElementById('set-nv').checked ? '1' : '0',
        auto_fetch_time_utc: document.getElementById('set-time').value,
        auto_fetch_lookback_days: document.getElementById('set-lookback').value,
      });
      alert('Settings saved');
    });

    document.getElementById('jobs-refresh-btn').addEventListener('click', async () => {
      const btn = document.getElementById('jobs-refresh-btn');
      btn.disabled = true;
      btn.textContent = 'Refreshing…';
      await refreshJobsList();
      btn.disabled = false;
      btn.textContent = 'Refresh';
    });

    await refreshJobsList();
  } catch (e) {
    document.getElementById('jobs-list').textContent = e.message;
  }
}

function progressBarHtml(pct) {
  if (pct === null || pct === undefined) return '';
  return `
    <div class="progress-bar"><div class="progress-bar-fill" style="width:${pct}%"></div></div>
    <span class="muted">${pct}% through date range</span>`;
}

function systemBlock(label, sys, jobStatus) {
  if (!sys.enabled) {
    return `<div class="system-progress done"><strong>${label}</strong><p class="muted">${sys.detail}</p></div>`;
  }
  const badge = sys.done
    ? jobStatus === 'running'
      ? '<span class="badge badge-ok">Done scanning</span>'
      : '<span class="badge badge-ok">Done</span>'
    : '<span class="badge badge-pending">In progress</span>';
  const note =
    sys.done && jobStatus === 'running'
      ? '<p class="muted">This system finished — job continues for remaining systems.</p>'
      : '';
  return `
    <div class="system-progress ${sys.done ? 'done' : ''}">
      <strong>${label}</strong>
      ${badge}
      <p>${sys.detail}</p>
      ${note}
      ${progressBarHtml(sys.dateProgressPct)}
      <p class="mono muted">Fetched: ${sys.fetched}${sys.nextTicket ? ` · Next: ${sys.nextTicket}` : ''}</p>
    </div>`;
}

async function showJobProgress(jobId) {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `<div class="modal"><p>Loading job #${jobId}…</p></div>`;
  document.body.appendChild(backdrop);
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) backdrop.remove();
  });

  try {
    const { job, progress, fetchStopped } = await api.getJob(jobId);
    const p = progress;
    backdrop.querySelector('.modal').innerHTML = `
      <h2>Job #${p.jobId} progress</h2>
      <p><strong>Status:</strong> ${jobStatusLabel(job, p)}
        ${fetchStopped ? ' · <span class="badge badge-blocker">ALL STOP active</span>' : ''}</p>
      ${p.status === 'running' && p.systemsComplete < p.systemsActive
        ? `<p class="muted">${p.systemsComplete} of ${p.systemsActive} systems finished scanning — job is still running.</p>`
        : ''}
      <p><strong>Range:</strong> ${p.dateRange.start} → ${p.dateRange.end}</p>
      <p><strong>Triggered by:</strong> ${p.triggeredBy === 'container' ? 'container scraper' : p.triggeredBy}${p.triggeredBy === 'container' ? '' : ` · <strong>Parallel batch:</strong> ${p.batchSize} tickets/system/wave (continuous)`}</p>
      <p class="muted">Updated: ${p.updatedAt}</p>
      ${p.errorCount ? `<p class="badge badge-blocker">Errors: ${p.errorCount}${p.lastError ? ` — ${p.lastError}` : ''}</p>` : ''}
      ${systemBlock('Dig Alert', p.systems.digalert, p.status)}
      ${systemBlock('USAN CA', p.systems.usanCa, p.status)}
      ${systemBlock('USAN NV', p.systems.usanNv, p.status)}
      <div class="btn-row" style="margin-top:1rem">
        ${job.status === 'paused' && job.triggered_by !== 'container' ? `<button class="btn tick-btn-modal" type="button">Continue job</button>` : ''}
        ${['running', 'paused', 'pending'].includes(job.status) ? `<button class="btn-danger stop-btn-modal" type="button">Stop job</button>` : ''}
        <button class="btn-secondary close-modal" type="button">Close</button>
      </div>`;
    backdrop.querySelector('.close-modal').addEventListener('click', () => backdrop.remove());
    const tickBtn = backdrop.querySelector('.tick-btn-modal');
    if (tickBtn) {
      tickBtn.addEventListener('click', async () => {
        tickBtn.disabled = true;
        tickBtn.textContent = 'Continuing…';
        await api.tickJob(jobId);
        backdrop.remove();
        refreshJobsList();
      });
    }
    const stopBtn = backdrop.querySelector('.stop-btn-modal');
    if (stopBtn) {
      stopBtn.addEventListener('click', async () => {
        if (!confirm(`Stop job #${jobId}?`)) return;
        stopBtn.disabled = true;
        stopBtn.textContent = 'Stopping…';
        await api.cancelJob(jobId);
        backdrop.remove();
        refreshJobsList();
      });
    }
  } catch (e) {
    backdrop.querySelector('.modal').innerHTML = `
      <h2>Error</h2><p>${e.message}</p>
      <button class="btn-secondary close-modal" type="button">Close</button>`;
    backdrop.querySelector('.close-modal').addEventListener('click', () => backdrop.remove());
  }
}

async function renderAnalytics() {
  app.innerHTML = '<div class="panel">Loading analytics…</div>';
  try {
    const [summary, trends, hotspotsData] = await Promise.all([
      api.analyticsSummary(),
      api.analyticsTrends({ days: 30 }),
      api.analyticsOverlaps({ limit: 20 }).catch(() => ({ hotspots: [] })),
    ]);
    state.analytics = { summary, trends, hotspots: hotspotsData.hotspots ?? [] };
  } catch (e) {
    app.innerHTML = `<div class="panel">${escapeHtml(e.message)}</div>`;
    return;
  }

  const { summary, trends, hotspots } = state.analytics;
  const t = summary.totals;

  app.innerHTML = `
    <div class="panel">
      <h2 class="panel-heading">Analytics</h2>
      <p class="muted">As of ${escapeHtml(summary.today)} · active = work window includes today</p>
      <div class="kpi-grid">
        <div class="kpi-card"><span class="kpi-label">Active</span><span class="kpi-value">${t.active.toLocaleString()}</span></div>
        <div class="kpi-card"><span class="kpi-label">Pending</span><span class="kpi-value kpi-pending">${t.pending.toLocaleString()}</span></div>
        <div class="kpi-card"><span class="kpi-label">Blockers</span><span class="kpi-value kpi-blocker">${t.blockers.toLocaleString()}</span></div>
        <div class="kpi-card"><span class="kpi-label">Late</span><span class="kpi-value kpi-late">${t.late.toLocaleString()}</span></div>
        <div class="kpi-card"><span class="kpi-label">Total stored</span><span class="kpi-value">${t.total.toLocaleString()}</span></div>
        <div class="kpi-card"><span class="kpi-label">Geometry</span><span class="kpi-value">${t.geometryCoveragePct}%</span></div>
        <div class="kpi-card"><span class="kpi-label">Overlaps</span><span class="kpi-value">${(summary.overlaps?.total ?? 0).toLocaleString()}</span></div>
        <div class="kpi-card"><span class="kpi-label">Concurrent overlaps</span><span class="kpi-value">${(summary.overlaps?.concurrent ?? 0).toLocaleString()}</span></div>
      </div>
    </div>
    <div class="analytics-grid">
      <div class="panel">
        <h3>By system</h3>
        <table>
          <thead><tr><th>System</th><th>Total</th><th>Active</th><th>Pending</th><th>Blockers</th><th>Late</th><th>Geometry</th></tr></thead>
          <tbody>
            ${summary.bySystem
              .map(
                (s) => `
              <tr>
                <td>${systemLabel(s.system)}</td>
                <td>${s.total.toLocaleString()}</td>
                <td>${s.active.toLocaleString()}</td>
                <td>${s.badges.pending.toLocaleString()}</td>
                <td>${s.badges.blocker.toLocaleString()}</td>
                <td>${s.badges.late.toLocaleString()}</td>
                <td>${s.geometryCoveragePct}%</td>
              </tr>`
              )
              .join('')}
          </tbody>
        </table>
      </div>
      <div class="panel">
        <h3>Top work types</h3>
        ${summary.bySystem
          .map(
            (s) => `
          <h4 class="analytics-subheading">${systemLabel(s.system)}</h4>
          <table>
            <thead><tr><th>Type</th><th>Count</th></tr></thead>
            <tbody>
              ${(s.workTypes.length
                ? s.workTypes
                : [{ label: '—', count: 0 }]
              )
                .map((w) => `<tr><td>${escapeHtml(w.label)}</td><td>${w.count.toLocaleString()}</td></tr>`)
                .join('')}
            </tbody>
          </table>`
          )
          .join('')}
      </div>
    </div>
    <div class="panel">
      <h3>Ingest trend (30 days)</h3>
      <table>
        <thead><tr><th>Date</th><th>Dig Alert</th><th>USAN CA</th><th>USAN NV</th></tr></thead>
        <tbody>
          ${(trends.trend.length
            ? trends.trend.slice(-14)
            : [{ date: '—' }]
          )
            .map(
              (row) => `
            <tr>
              <td>${escapeHtml(row.date)}</td>
              <td>${row.digalert ?? 0}</td>
              <td>${row['usan-ca'] ?? 0}</td>
              <td>${row['usan-nv'] ?? 0}</td>
            </tr>`
            )
            .join('')}
        </tbody>
      </table>
    </div>
    ${
      hotspots.length
        ? `<div class="panel">
      <h3>Overlap hotspots</h3>
      <p class="muted">Tickets with the most overlapping dig areas. Click a row or map marker to open detail.</p>
      <div id="analytics-map" class="analytics-map"></div>
      <table class="analytics-hotspots-table">
        <thead><tr><th>System</th><th>Ticket</th><th>Overlaps</th><th>Concurrent</th></tr></thead>
        <tbody>
          ${hotspots
            .map(
              (h) => `
            <tr class="clickable analytics-hotspot-row" data-system="${h.system}" data-ticket="${escapeHtml(h.ticketNumber)}" data-revision="${escapeHtml(h.revision ?? '00A')}">
              <td>${systemLabel(h.system)}</td>
              <td class="mono">${escapeHtml(h.ticketNumber)}${h.revision ? ` / ${escapeHtml(h.revision)}` : ''}</td>
              <td>${h.overlapCount}</td>
              <td>${h.concurrentCount}</td>
            </tr>`
            )
            .join('')}
        </tbody>
      </table>
    </div>`
        : ''
    }
    ${
      state.isAdmin
        ? `<div class="panel">
      <h3>Admin — overlap backfill</h3>
      <p class="muted">Rebuild overlap rows for stored tickets (batch of 500). New ingests compute overlaps automatically.</p>
      <div class="btn-row">
        <button class="btn btn-secondary" id="rebuild-overlaps-da" type="button">Rebuild Dig Alert</button>
        <button class="btn btn-secondary" id="rebuild-overlaps-ca" type="button">Rebuild USAN CA</button>
        <button class="btn btn-secondary" id="rebuild-overlaps-nv" type="button">Rebuild USAN NV</button>
      </div>
      <p id="rebuild-overlaps-msg" class="muted"></p>
    </div>`
        : ''
    }`;

  app.querySelectorAll('.analytics-hotspot-row').forEach((tr) => {
    tr.addEventListener('click', () =>
      openDetail(tr.dataset.system, tr.dataset.ticket, tr.dataset.revision)
    );
  });

  if (hotspots.length) {
    setTimeout(() => initAnalyticsMap(hotspots), 0);
  }

  if (state.isAdmin) {
    async function runRebuild(system, btn) {
      const msg = document.getElementById('rebuild-overlaps-msg');
      btn.disabled = true;
      msg.textContent = `Rebuilding ${systemLabel(system)}…`;
      try {
        let offset = 0;
        let totalProcessed = 0;
        let totalOverlaps = 0;
        for (;;) {
          const result = await api.rebuildOverlaps({ system, limit: 500, offset });
          totalProcessed += result.processed;
          totalOverlaps += result.overlapsFound;
          offset = result.nextOffset;
          msg.textContent = `${systemLabel(system)}: processed ${totalProcessed}, overlaps ${totalOverlaps}…`;
          if (result.processed < 500) break;
        }
        msg.textContent = `Done — ${systemLabel(system)}: ${totalProcessed} tickets, ${totalOverlaps} overlap rows written.`;
      } catch (e) {
        msg.textContent = e.message;
      } finally {
        btn.disabled = false;
      }
    }
    document.getElementById('rebuild-overlaps-da')?.addEventListener('click', (e) => runRebuild('digalert', e.target));
    document.getElementById('rebuild-overlaps-ca')?.addEventListener('click', (e) => runRebuild('usan-ca', e.target));
    document.getElementById('rebuild-overlaps-nv')?.addEventListener('click', (e) => runRebuild('usan-nv', e.target));
  }
}

function initAnalyticsMap(hotspots) {
  if (state.analyticsMap) {
    state.analyticsMap.remove();
    state.analyticsMap = null;
  }
  const el = document.getElementById('analytics-map');
  if (!el) return;
  state.analyticsMap = L.map('analytics-map').setView([36.16, -115.15], 9);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap',
  }).addTo(state.analyticsMap);

  const bounds = [];
  for (const h of hotspots) {
    if (h.centroidLat == null || h.centroidLon == null) continue;
    const marker = L.circleMarker([h.centroidLat, h.centroidLon], {
      radius: Math.min(8 + h.overlapCount, 20),
      color: '#f97316',
      fillColor: '#f97316',
      fillOpacity: 0.7,
    }).addTo(state.analyticsMap);
    marker.bindPopup(`${h.ticketNumber}: ${h.overlapCount} overlaps`);
    marker.on('click', () => openDetail(h.system, h.ticketNumber, h.revision ?? '00A'));
    bounds.push([h.centroidLat, h.centroidLon]);
  }
  if (bounds.length) state.analyticsMap.fitBounds(bounds, { padding: [24, 24] });
}

async function openDetail(system, ticketNumber, revision) {
  state.detailSystem = system;
  detailTab.classList.remove('hidden');
  setView('detail');
  app.innerHTML = '<div class="panel">Loading detail…</div>';
  try {
    const detail = await api.getTicket(system, ticketNumber, revision);
    state.detail = detail;
    renderDetail();
  } catch (e) {
    app.innerHTML = `<div class="panel">${e.message}</div>`;
  }
}

function renderDetail() {
  const d = state.detail;
  const t = d.ticket;
  const system = state.detailSystem;
  const stations = d.stations ?? d.responsesCurrent ?? [];
  const history = d.ticketHistory ?? d.responsesAll ?? [];
  const overlaps = d.overlaps ?? [];
  const overlapCount = d.overlapCount ?? overlaps.length;

  app.innerHTML = `
    <div class="panel">
      <h2>${systemLabel(system)} — <span class="mono">${t.ticket_number}</span></h2>
      <p>${badgesHtml(d.badges)}</p>
      ${d.analytics?.hadLateResponse ? '<p class="banner" style="margin:0.5rem 0">Ticket flagged — utility responded late (888/999 in history).</p>' : ''}
    </div>
    <div class="detail-grid">
      <div class="panel">
        <h3>Ticket info</h3>
        <div class="ticket-info">${ticketInfoHtml(system, t)}</div>
        <h3 class="detail-subheading">Overlapping tickets (${overlapCount})</h3>
        <p class="muted" style="margin:0 0 0.5rem;font-size:0.85rem">Only tickets filed on different days are counted (same-day tickets are usually from the same caller).</p>
        ${
          overlaps.length
            ? `<table>
          <thead><tr><th>System</th><th>Ticket</th><th>Kind</th><th>Concurrent</th></tr></thead>
          <tbody>
            ${overlaps
              .map(
                (o) => `
              <tr class="clickable overlap-row" data-system="${o.system}" data-ticket="${escapeHtml(o.ticketNumber)}" data-revision="${escapeHtml(o.revision ?? '00A')}">
                <td>${systemLabel(o.system)}</td>
                <td class="mono">${escapeHtml(o.ticketNumber)}${o.revision ? ` / ${escapeHtml(o.revision)}` : ''}</td>
                <td>${o.overlapKind === 'bbox' ? '<span class="muted" title="Bbox-only — polygon missing">Bbox</span>' : 'Polygon'}</td>
                <td>${o.concurrent ? '<span class="badge badge-pending">Yes</span>' : '<span class="muted">No</span>'}</td>
              </tr>`
              )
              .join('')}
          </tbody>
        </table>`
            : '<p class="muted">No overlapping tickets found.</p>'
        }
        <h3 class="detail-subheading">Utility responses (current)</h3>
        <table>
          <thead><tr><th>Code</th><th>Name</th><th>Resp</th><th>Description</th></tr></thead>
          <tbody>
            ${stations
              .map(
                (s) => `
              <tr>
                <td>${s.code ?? s.utility_code ?? ''}</td>
                <td>${s.name ?? s.utility_name ?? ''}</td>
                <td>${s.responseCode ?? s.response_code ?? ''}</td>
                <td>${s.responseDescription ?? s.response_description ?? ''}</td>
              </tr>`
              )
              .join('')}
          </tbody>
        </table>
        <details><summary>History (${history.length})</summary>
          <pre class="mono" style="max-height:200px;overflow:auto">${JSON.stringify(history.slice(0, 20), null, 2)}</pre>
        </details>
      </div>
      <div class="panel">
        <h3>Map</h3>
        <div id="detail-map"></div>
      </div>
    </div>
  `;

  app.querySelectorAll('.overlap-row').forEach((tr) => {
    tr.addEventListener('click', () =>
      openDetail(tr.dataset.system, tr.dataset.ticket, tr.dataset.revision)
    );
  });

  setTimeout(async () => {
    if (state.detailMap) state.detailMap.remove();
    state.detailMap = L.map('detail-map').setView([36.16, -115.15], 12);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap',
    }).addTo(state.detailMap);

    const layers = [];
    const latlngs = parseWktToLatLngs(t.polygon_wkt);
    if (latlngs.length) {
      const poly = L.polygon(latlngs, { color: '#3b82f6', fillOpacity: 0.25 }).addTo(state.detailMap);
      layers.push(poly);
    } else if (t.centroid_y && t.centroid_x) {
      state.detailMap.setView([t.centroid_y, t.centroid_x], 15);
      layers.push(L.marker([t.centroid_y, t.centroid_x]).addTo(state.detailMap));
    }

    for (const o of overlaps.slice(0, 20)) {
      try {
        const other = await api.getTicket(o.system, o.ticketNumber, o.revision ?? undefined);
        const otherLatLngs = parseWktToLatLngs(other.ticket?.polygon_wkt);
        if (otherLatLngs.length) {
          layers.push(
            L.polygon(otherLatLngs, { color: '#f97316', fillOpacity: 0.15, dashArray: '4' }).addTo(
              state.detailMap
            )
          );
        }
      } catch {
        /* skip missing overlap ticket */
      }
    }

    if (layers.length) {
      const group = L.featureGroup(layers);
      state.detailMap.fitBounds(group.getBounds().pad(0.1));
    }
  }, 0);
}

async function renderAdmin() {
  app.innerHTML = `
    <div class="panel">
      <h2>Admin users</h2>
      <p class="muted">Only explicitly granted admins can use Fetch and Jobs. Signing in with @aspadeco.com does not grant admin access.</p>
      <div id="admin-list">Loading…</div>
      <form class="admin-add-form" id="admin-add-form">
        <label>Add admin email
          <input type="email" id="admin-email" placeholder="name@aspadeco.com" required />
        </label>
        <button class="btn" type="submit">Add admin</button>
      </form>
      <p id="admin-message" class="muted"></p>
    </div>
    <div class="panel admin-danger-panel">
      <h2>Danger zone</h2>
      <p class="muted">Permanently delete all ticket data (Dig Alert, USAN CA, USAN NV). Jobs, settings, and admin users are not affected.</p>
      <button class="btn-danger" id="nuke-tickets-btn" type="button">Nuke tickets in DB</button>
      <p id="nuke-message" class="muted"></p>
    </div>
    <div class="panel">
      <h2>Overlap settings</h2>
      <p class="muted">Cross-system overlap compares Dig Alert tickets against USAN when enabled (slower ingest).</p>
      <label class="chip-check"><input type="checkbox" id="overlap-cross-system" /><span>Enable cross-system overlaps</span></label>
      <label class="chip-check"><input type="checkbox" id="overlap-prune-enabled" /><span>Prune stale overlap rows (90+ days expired)</span></label>
      <p id="overlap-settings-msg" class="muted"></p>
    </div>
  `;

  async function refreshAdminList() {
    const el = document.getElementById('admin-list');
    try {
      const { admins } = await api.listAdmins();
      if (!admins.length) {
        el.innerHTML = '<p class="muted">No admins configured yet.</p>';
        return;
      }
      el.innerHTML = `
        <table>
          <thead><tr><th>Email</th><th>Source</th><th>Added</th><th></th></tr></thead>
          <tbody>
            ${admins
              .map(
                (a) => `
              <tr>
                <td class="mono">${escapeHtml(a.email)}</td>
                <td>${a.source === 'env' ? 'Super admin' : 'Added'}</td>
                <td>${a.created_at ? escapeHtml(a.created_at) : '—'}</td>
                <td>
                  ${
                    a.source === 'db'
                      ? `<button class="btn-danger btn-sm remove-admin-btn" data-email="${escapeHtml(a.email)}" type="button">Remove</button>`
                      : '<span class="muted">—</span>'
                  }
                </td>
              </tr>`
              )
              .join('')}
          </tbody>
        </table>`;
      el.querySelectorAll('.remove-admin-btn').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const email = btn.dataset.email;
          if (!confirm(`Remove admin access for ${email}?`)) return;
          const msg = document.getElementById('admin-message');
          btn.disabled = true;
          try {
            await api.removeAdmin(email);
            msg.textContent = `Removed ${email}.`;
            await refreshAdminList();
          } catch (e) {
            msg.textContent = e.message;
          } finally {
            btn.disabled = false;
          }
        });
      });
    } catch (e) {
      el.textContent = e.message;
    }
  }

  document.getElementById('admin-add-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = document.getElementById('admin-email');
    const msg = document.getElementById('admin-message');
    const email = input.value.trim();
    if (!email) return;
    msg.textContent = 'Adding…';
    try {
      await api.addAdmin(email);
      input.value = '';
      msg.textContent = `Added ${email}.`;
      await refreshAdminList();
    } catch (err) {
      msg.textContent = err.message;
    }
  });

  document.getElementById('nuke-tickets-btn').addEventListener('click', async () => {
    if (!confirm('Delete ALL tickets from the database? This cannot be undone.')) return;
    if (!confirm('Last chance — permanently wipe every stored ticket?')) return;

    const btn = document.getElementById('nuke-tickets-btn');
    const msg = document.getElementById('nuke-message');
    btn.disabled = true;
    msg.textContent = 'Deleting…';
    try {
      const result = await api.nukeTickets();
      msg.textContent = `Deleted ${result.total} rows across all ticket tables.`;
    } catch (err) {
      msg.textContent = err.message;
    } finally {
      btn.disabled = false;
    }
  });

  await refreshAdminList();

  try {
    const overlapSettings = await api.getOverlapSettings();
    document.getElementById('overlap-cross-system').checked = !!overlapSettings.crossSystem;
    document.getElementById('overlap-prune-enabled').checked = !!overlapSettings.pruneEnabled;
  } catch {
    /* ignore */
  }

  async function saveOverlapSettings() {
    const msg = document.getElementById('overlap-settings-msg');
    try {
      await api.putOverlapSettings({
        crossSystem: document.getElementById('overlap-cross-system').checked,
        pruneEnabled: document.getElementById('overlap-prune-enabled').checked,
      });
      msg.textContent = 'Overlap settings saved.';
    } catch (e) {
      msg.textContent = e.message;
    }
  }

  document.getElementById('overlap-cross-system')?.addEventListener('change', saveOverlapSettings);
  document.getElementById('overlap-prune-enabled')?.addEventListener('change', saveOverlapSettings);
}

function render() {
  if (state.view === 'browse') renderBrowse();
  else if (state.view === 'analytics') renderAnalytics();
  else if (state.view === 'fetch') renderFetch();
  else if (state.view === 'jobs') renderJobs();
  else if (state.view === 'admin') renderAdmin();
  else if (state.view === 'detail' && state.detail) renderDetail();
}

function renderSignIn(status) {
  app.innerHTML = `
    <section class="panel signin-panel">
      <h2>Sign in required</h2>
      ${status.error ? `<p class="error">${status.error}</p>` : ''}
      <div id="signin-mount" class="signin-mount"></div>
    </section>
  `;
  setupGoogleButton(authArea);
  const mount = document.getElementById('signin-mount');
  if (mount) {
    renderGoogleButton(mount, { size: 'large' });
  }
}

function handleAuthChange(status) {
  refreshAuthHeader(authArea);
  state.isAdmin = !!status.admin;
  updateAdminTabs(state.isAdmin);
  if (status.authenticated) {
    if (ADMIN_VIEWS.has(state.view) && !state.isAdmin) {
      state.view = 'browse';
      document.querySelectorAll('.tab').forEach((t) => {
        t.classList.toggle('active', t.dataset.view === 'browse');
      });
    }
    if (state.isAdmin) refreshStopped();
    else stoppedBanner.classList.add('hidden');
    render();
    return;
  }
  renderSignIn(status);
}

function boot() {
  mountAuthHeader(authArea, handleAuthChange);
  initAuth((status) => {
    if (status.authenticated) {
      setupGoogleButton(authArea);
      refreshAuthHeader(authArea);
      state.isAdmin = !!status.admin;
      updateAdminTabs(state.isAdmin);
      if (state.isAdmin) refreshStopped();
      render();
      return;
    }
    renderSignIn(status);
    setupGoogleButton(authArea);
  });
}

boot();
