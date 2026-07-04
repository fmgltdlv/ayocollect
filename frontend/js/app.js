import { api, badgesHtml, bboxFromLayer, parseWktToLatLngs } from './api.js';

const app = document.getElementById('app');
const stoppedBanner = document.getElementById('stopped-banner');
const detailTab = document.getElementById('detail-tab');

const BROWSE_PAGE_SIZE = 30;

let state = {
  view: 'browse',
  browseSystems: ['digalert', 'usan-ca', 'usan-nv'],
  browsePage: 0,
  browseTotal: 0,
  browseParams: {},
  browseBadges: [],
  detail: null,
  detailSystem: null,
  searchMap: null,
  detailMap: null,
  drawLayer: null,
  jobsPollId: null,
};

function setView(view) {
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
  const sys = system ?? t.system;
  if (sys === 'digalert') {
    return [t.place, t.street, t.work_type].filter(Boolean).join(' · ') || t.location || '—';
  }
  return [t.address, t.work_type, t.work_activity].filter(Boolean).join(' · ') || '—';
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
  app.innerHTML = `
    <div class="panel">
      <div class="row checks">
        <span class="label-text">Systems</span>
        <label><input type="checkbox" id="browse-da" ${state.browseSystems.includes('digalert') ? 'checked' : ''} /> Dig Alert</label>
        <label><input type="checkbox" id="browse-ca" ${state.browseSystems.includes('usan-ca') ? 'checked' : ''} /> USAN CA</label>
        <label><input type="checkbox" id="browse-nv" ${state.browseSystems.includes('usan-nv') ? 'checked' : ''} /> USAN NV</label>
      </div>
      <div class="row checks">
        <span class="label-text">Badges</span>
        <label><input type="checkbox" id="browse-badge-pending" ${state.browseBadges.includes('pending') ? 'checked' : ''} /> <span class="badge badge-pending">Pending</span></label>
        <label><input type="checkbox" id="browse-badge-blocker" ${state.browseBadges.includes('blocker') ? 'checked' : ''} /> <span class="badge badge-blocker">Blocker</span></label>
        <label><input type="checkbox" id="browse-badge-late" ${state.browseBadges.includes('late') ? 'checked' : ''} /> <span class="badge badge-late">Late</span></label>
      </div>
      <div class="row">
        <label>Start date <input type="date" id="start-date" /></label>
        <label>End date <input type="date" id="end-date" /></label>
        <label>Ticket # <input type="text" id="ticket-filter" placeholder="optional" /></label>
        <button class="btn" id="search-btn" type="button">Search</button>
      </div>
      <p class="muted">Draw a rectangle on the map to search by bounding box (coarse overlap). Results show the 30 most recent matches per page.</p>
      <div id="search-map"></div>
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

async function runBrowseSearch(page = 0) {
  const systems = browseSystemsFromDom();
  if (!systems.length) {
    document.getElementById('results').textContent = 'Select at least one system.';
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
            'Scraper container started — tickets will appear in Browse as batches are ingested.')
        : 'Job started — fetching continuously in background. Check Jobs tab for progress.';
      if (!res.dedicatedScraper) {
        await refreshStopped();
        setView('jobs');
      }
    } catch (e) {
      out.textContent = e.message;
    }
  });
}

const JOBS_POLL_MS = 120_000;

function jobStatusLabel(job, progress) {
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
            <td>${j.status}${j.status === 'running' ? ' <span class="muted">(auto-refreshes every 2 min)</span>' : ''}</td>
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
      <p><strong>Triggered by:</strong> ${p.triggeredBy} · <strong>Parallel batch:</strong> ${p.batchSize} tickets/system/wave (continuous)</p>
      <p class="muted">Updated: ${p.updatedAt}</p>
      ${p.errorCount ? `<p class="badge badge-blocker">Errors: ${p.errorCount}${p.lastError ? ` — ${p.lastError}` : ''}</p>` : ''}
      ${systemBlock('Dig Alert', p.systems.digalert, p.status)}
      ${systemBlock('USAN CA', p.systems.usanCa, p.status)}
      ${systemBlock('USAN NV', p.systems.usanNv, p.status)}
      <div class="btn-row" style="margin-top:1rem">
        ${job.status === 'paused' ? `<button class="btn tick-btn-modal" type="button">Continue job</button>` : ''}
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
