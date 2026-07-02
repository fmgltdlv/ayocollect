import { api, badgesHtml, bboxFromLayer, parseWktToLatLngs } from './api.js';

const app = document.getElementById('app');
const stoppedBanner = document.getElementById('stopped-banner');
const detailTab = document.getElementById('detail-tab');

let state = {
  view: 'browse',
  system: 'usan-nv',
  detail: null,
  detailSystem: null,
  searchMap: null,
  detailMap: null,
  drawLayer: null,
};

function setView(view) {
  state.view = view;
  document.querySelectorAll('.tab').forEach((t) => {
    t.classList.toggle('active', t.dataset.view === view);
  });
  render();
}

async function refreshStopped() {
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

document.getElementById('all-stop-btn').addEventListener('click', async () => {
  if (!confirm('ALL STOP — cancel all jobs and abort in-flight fetches?')) return;
  await api.stopAll();
  await refreshStopped();
  render();
});

function systemLabel(s) {
  if (s === 'digalert') return 'Dig Alert';
  if (s === 'usan-ca') return 'USAN CA';
  return 'USAN NV';
}

function ticketRowLabel(t, system) {
  if (system === 'digalert') {
    return [t.place, t.street, t.work_type].filter(Boolean).join(' · ') || t.location || '—';
  }
  return [t.address, t.work_type, t.work_activity].filter(Boolean).join(' · ') || '—';
}

function renderBrowse() {
  app.innerHTML = `
    <div class="panel">
      <div class="row">
        <label>System
          <select id="browse-system">
            <option value="digalert">Dig Alert</option>
            <option value="usan-ca">USAN CA</option>
            <option value="usan-nv" selected>USAN NV</option>
          </select>
        </label>
        <label>Start date <input type="date" id="start-date" /></label>
        <label>End date <input type="date" id="end-date" /></label>
        <label>Ticket # <input type="text" id="ticket-filter" placeholder="optional" /></label>
        <button class="btn" id="search-btn" type="button">Search</button>
      </div>
      <p class="muted">Draw a rectangle on the map to search by bounding box (coarse overlap).</p>
      <div id="search-map"></div>
    </div>
    <div class="panel"><div id="results">Run a search to see tickets.</div></div>
  `;

  document.getElementById('browse-system').value = state.system;

  setTimeout(() => initSearchMap(), 0);

  document.getElementById('search-btn').addEventListener('click', runSearch);
}

function initSearchMap() {
  if (state.searchMap) {
    state.searchMap.remove();
    state.searchMap = null;
  }
  state.searchMap = L.map('search-map').setView([36.16, -115.15], 9);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap',
  }).addTo(state.searchMap);

  const drawn = new L.FeatureGroup();
  state.searchMap.addLayer(drawn);

  state.searchMap.addControl(
    new L.Control.Draw({
      draw: {
        polygon: false,
        polyline: false,
        circle: false,
        circlemarker: false,
        marker: false,
        rectangle: true,
      },
      edit: { featureGroup: drawn },
    })
  );

  state.searchMap.on(L.Draw.Event.CREATED, (e) => {
    drawn.clearLayers();
    drawn.addLayer(e.layer);
    state.drawLayer = e.layer;
  });
}

async function runSearch() {
  state.system = document.getElementById('browse-system').value;
  const params = {};
  const start = document.getElementById('start-date').value;
  const end = document.getElementById('end-date').value;
  const ticket = document.getElementById('ticket-filter').value.trim();
  if (start) params.startDate = start;
  if (end) params.endDate = end;
  if (ticket) params.ticketNumber = ticket;
  if (state.drawLayer) {
    const b = bboxFromLayer(state.drawLayer);
    Object.assign(params, b);
  }

  const resultsEl = document.getElementById('results');
  resultsEl.textContent = 'Loading…';
  try {
    const { tickets } = await api.listTickets(state.system, params);
    if (!tickets.length) {
      resultsEl.textContent = 'No tickets found.';
      return;
    }
    resultsEl.innerHTML = `
      <table>
        <thead><tr>
          <th>Badges</th><th>Ticket</th><th>Summary</th><th>Updated</th>
        </tr></thead>
        <tbody>
          ${tickets
            .map(
              (t) => `
            <tr class="clickable" data-ticket="${t.ticket_number}" data-revision="${t.revision ?? '00A'}">
              <td>${badgesHtml(t.badges)}</td>
              <td class="mono">${t.ticket_number}${t.revision ? ` / ${t.revision}` : ''}</td>
              <td>${ticketRowLabel(t, state.system)}</td>
              <td>${t.updated_at ?? ''}</td>
            </tr>`
            )
            .join('')}
        </tbody>
      </table>`;
    resultsEl.querySelectorAll('tr.clickable').forEach((tr) => {
      tr.addEventListener('click', () => openDetail(state.system, tr.dataset.ticket, tr.dataset.revision));
    });
  } catch (e) {
    resultsEl.textContent = e.message;
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
      <h2>Batch job (6 parallel fetches per wave, runs continuously)</h2>
      <p class="muted">Like the Python scraper: scans each day until 2 consecutive misses, then next day. Each wave pulls 6 tickets at once per system — runs continuously until the date range is done.</p>
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
      await api.createJob({ systems, startDate, endDate });
      out.textContent = 'Job started — fetching continuously in background. Check Jobs tab for progress.';
      await refreshStopped();
      setView('jobs');
    } catch (e) {
      out.textContent = e.message;
    }
  });
}

async function renderJobs() {
  app.innerHTML = `
    <div class="panel">
      <h2>Auto-fetch settings</h2>
      <div id="settings-form">Loading…</div>
    </div>
    <div class="panel"><div id="jobs-list">Loading…</div></div>
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

    const { jobs, fetchStopped } = await api.listJobs();
    stoppedBanner.classList.toggle('hidden', !fetchStopped);
    const el = document.getElementById('jobs-list');
    if (!jobs.length) {
      el.textContent = 'No jobs yet.';
      return;
    }
    el.innerHTML = `
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
              <td>${j.status}</td>
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
                  ${j.status === 'running' ? `<button class="btn tick-btn" data-id="${j.id}" type="button">Continue</button>` : ''}
                  ${['running', 'paused', 'pending'].includes(j.status) ? `<button class="btn-danger stop-btn" data-id="${j.id}" type="button">Stop</button>` : ''}
                </div>
              </td>
            </tr>`
            )
            .join('')}
        </tbody>
      </table>`;
    el.querySelectorAll('.tick-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        await api.tickJob(btn.dataset.id);
        renderJobs();
      });
    });
    el.querySelectorAll('.stop-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm(`Stop job #${btn.dataset.id}?`)) return;
        await api.cancelJob(btn.dataset.id);
        renderJobs();
      });
    });
    el.querySelectorAll('.progress-btn').forEach((btn) => {
      btn.addEventListener('click', () => showJobProgress(btn.dataset.id));
    });
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

function systemBlock(label, sys) {
  if (!sys.enabled) {
    return `<div class="system-progress done"><strong>${label}</strong><p class="muted">${sys.detail}</p></div>`;
  }
  return `
    <div class="system-progress ${sys.done ? 'done' : ''}">
      <strong>${label}</strong>
      ${sys.done ? '<span class="badge badge-ok">Done</span>' : '<span class="badge badge-pending">In progress</span>'}
      <p>${sys.detail}</p>
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
      <p><strong>Status:</strong> ${p.status}
        ${fetchStopped ? ' · <span class="badge badge-blocker">ALL STOP active</span>' : ''}</p>
      <p><strong>Range:</strong> ${p.dateRange.start} → ${p.dateRange.end}</p>
      <p><strong>Triggered by:</strong> ${p.triggeredBy} · <strong>Parallel batch:</strong> ${p.batchSize} tickets/system/wave (continuous)</p>
      <p class="muted">Updated: ${p.updatedAt}</p>
      ${p.errorCount ? `<p class="badge badge-blocker">Errors: ${p.errorCount}${p.lastError ? ` — ${p.lastError}` : ''}</p>` : ''}
      ${systemBlock('Dig Alert', p.systems.digalert)}
      ${systemBlock('USAN CA', p.systems.usanCa)}
      ${systemBlock('USAN NV', p.systems.usanNv)}
      <div class="btn-row" style="margin-top:1rem">
        ${job.status === 'running' ? `<button class="btn tick-btn-modal" type="button">Continue job</button>` : ''}
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
        renderJobs();
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
        renderJobs();
      });
    }
  } catch (e) {
    backdrop.querySelector('.modal').innerHTML = `
      <h2>Error</h2><p>${e.message}</p>
      <button class="btn-secondary close-modal" type="button">Close</button>`;
    backdrop.querySelector('.close-modal').addEventListener('click', () => backdrop.remove());
  }
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

  app.innerHTML = `
    <div class="panel">
      <h2>${systemLabel(system)} — <span class="mono">${t.ticket_number}</span></h2>
      <p>${badgesHtml(d.badges)}</p>
      ${d.analytics?.hadLateResponse ? '<p class="banner" style="margin:0.5rem 0">Ticket flagged — utility responded late (888/999 in history).</p>' : ''}
    </div>
    <div class="detail-grid">
      <div class="panel">
        <h3>Ticket info</h3>
        <dl class="mono">
          ${Object.entries(t)
            .filter(([k]) => !k.startsWith('bbox_') && k !== 'polygon_wkt')
            .slice(0, 24)
            .map(([k, v]) => `<dt>${k}</dt><dd>${v ?? ''}</dd>`)
            .join('')}
        </dl>
        <h3>Utility responses (current)</h3>
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

  setTimeout(() => {
    if (state.detailMap) state.detailMap.remove();
    state.detailMap = L.map('detail-map').setView([36.16, -115.15], 12);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap',
    }).addTo(state.detailMap);

    const latlngs = parseWktToLatLngs(t.polygon_wkt);
    if (latlngs.length) {
      const poly = L.polygon(latlngs).addTo(state.detailMap);
      state.detailMap.fitBounds(poly.getBounds());
    } else if (t.centroid_y && t.centroid_x) {
      state.detailMap.setView([t.centroid_y, t.centroid_x], 15);
      L.marker([t.centroid_y, t.centroid_x]).addTo(state.detailMap);
    }
  }, 0);
}

function render() {
  if (state.view === 'browse') renderBrowse();
  else if (state.view === 'fetch') renderFetch();
  else if (state.view === 'jobs') renderJobs();
  else if (state.view === 'detail' && state.detail) renderDetail();
}

refreshStopped();
render();
