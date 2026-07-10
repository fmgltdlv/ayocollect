function apiBase() {
  if (typeof window !== 'undefined' && window.AYO_API_BASE) {
    return String(window.AYO_API_BASE).replace(/\/$/, '');
  }
  return '/api';
}

export { apiBase };

let authTokenGetter = () => null;
let onUnauthorized = () => {};

export function setAuthTokenGetter(fn) {
  authTokenGetter = fn;
}

export function setUnauthorizedHandler(fn) {
  onUnauthorized = fn;
}

export function authHeaders(extra = {}) {
  const headers = { ...extra };
  const token = authTokenGetter();
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function request(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...authHeaders(), ...(options.headers || {}) };

  const res = await fetch(`${apiBase()}${path}`, {
    headers,
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) onUnauthorized();
  if (!res.ok) {
    const err = new Error(data.error || res.statusText);
    err.status = res.status;
    throw err;
  }
  return data;
}

function isNotFound(err) {
  return err?.status === 404 || /not found/i.test(String(err?.message ?? ''));
}

export const api = {
  me: () => request('/auth/me'),
  health: () => request('/health'),
  listTickets: (system, params) => {
    const q = new URLSearchParams(params).toString();
    return request(`/${system}/tickets?${q}`);
  },
  browseTickets: (systems, params = {}) => {
    const q = new URLSearchParams({ ...params, systems: systems.join(',') }).toString();
    return request(`/tickets?${q}`);
  },
  /** Up to 400 tickets for map pins — fetched in 100-ticket pages to avoid heavy badge queries. */
  browseMapTickets: async (systems, params = {}, maxTickets = 400) => {
    const pageSize = 100;
    const tickets = [];
    for (let offset = 0; offset < maxTickets; offset += pageSize) {
      const limit = Math.min(pageSize, maxTickets - offset);
      const batch = await request(
        `/tickets?${new URLSearchParams({
          ...params,
          systems: systems.join(','),
          limit: String(limit),
          offset: String(offset),
          skipBadges: '1',
        }).toString()}`
      );
      tickets.push(...(batch.tickets ?? []));
      if ((batch.tickets?.length ?? 0) < limit) break;
    }
    return { tickets };
  },
  browseTicketPolygons: (tickets) =>
    request('/tickets/polygons', { method: 'POST', body: JSON.stringify({ tickets }) }),
  getTicket: (system, ticketNumber, revision) => {
    const q = revision ? `?revision=${encodeURIComponent(revision)}` : '';
    return request(`/${system}/tickets/${encodeURIComponent(ticketNumber)}${q}`);
  },
  fetchOne: (system, body) =>
    request(`/${system}/fetch`, { method: 'POST', body: JSON.stringify(body) }),
  createJob: (body) => request('/jobs', { method: 'POST', body: JSON.stringify(body) }),
  listJobs: () => request('/jobs'),
  getJob: (id) => request(`/jobs/${id}`),
  tickJob: (id) => request(`/jobs/${id}/tick`, { method: 'POST' }),
  cancelJob: (id) => request(`/jobs/${id}/cancel`, { method: 'POST' }),
  resumeJob: (id) => request(`/jobs/${id}/resume`, { method: 'POST' }),
  stopAll: () => request('/jobs/stop-all', { method: 'POST' }),
  getSettings: () => request('/settings/auto-fetch'),
  putSettings: (body) =>
    request('/settings/auto-fetch', { method: 'PUT', body: JSON.stringify(body) }),
  listAdmins: () => request('/admin/users'),
  addAdmin: (email) =>
    request('/admin/users', { method: 'POST', body: JSON.stringify({ email }) }),
  removeAdmin: (email) =>
    request(`/admin/users/${encodeURIComponent(email)}`, { method: 'DELETE' }),
  nukeTickets: () => request('/admin/nuke-tickets', { method: 'POST' }),
  analyticsKpis: async () => {
    try {
      return await request('/analytics/kpis');
    } catch (e) {
      if (!isNotFound(e)) throw e;
      const summary = await request('/analytics/summary');
      return { today: summary.today, totals: summary.totals, bySystem: summary.bySystem };
    }
  },
  analyticsStats: async (params = {}) => {
    const q = new URLSearchParams(params).toString();
    const qs = q ? `?${q}` : '';
    try {
      return await request(`/analytics/stats${qs}`);
    } catch (e) {
      if (!isNotFound(e)) throw e;
      const [summary, trends] = await Promise.all([
        request(`/analytics/summary${qs}`),
        request(`/analytics/trends${qs}`),
      ]);
      return { summary, trends };
    }
  },
  analyticsArea: async (params = {}) => {
    const q = new URLSearchParams({ fast: '1', ...params }).toString();
    try {
      return await request(`/analytics/area?${q}`);
    } catch (e) {
      if (isNotFound(e)) {
        throw new Error('Area insights need a backend update. Deploy the latest API worker.');
      }
      throw e;
    }
  },
  analyticsSummary: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return request(`/analytics/summary${q ? `?${q}` : ''}`);
  },
  analyticsTrends: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return request(`/analytics/trends${q ? `?${q}` : ''}`);
  },
  analyticsOverlaps: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return request(`/analytics/overlaps${q ? `?${q}` : ''}`);
  },
  getTicketOverlaps: (system, ticketNumber, params = {}) => {
    const q = new URLSearchParams(params).toString();
    return request(`/tickets/${system}/${encodeURIComponent(ticketNumber)}/overlaps${q ? `?${q}` : ''}`);
  },
  rebuildOverlaps: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return request(`/admin/overlaps/rebuild${q ? `?${q}` : ''}`, { method: 'POST' });
  },
  clearOverlaps: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return request(`/admin/overlaps/clear${q ? `?${q}` : ''}`, { method: 'POST' });
  },
  getOverlapStats: () => request('/admin/overlaps/stats'),
  getOverlapSettings: () => request('/admin/settings/overlaps'),
  putOverlapSettings: (body) =>
    request('/admin/settings/overlaps', { method: 'PUT', body: JSON.stringify(body) }),
  submitFeedback: (body) =>
    request('/feedback', { method: 'POST', body: JSON.stringify(body) }),
  listFeedback: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return request(`/admin/feedback${q ? `?${q}` : ''}`);
  },
  feedbackUnreadCount: () => request('/admin/feedback/unread-count'),
  markFeedbackRead: (id) =>
    request(`/admin/feedback/${id}/read`, { method: 'POST' }),
  listUtilityLayers: () => request('/utility-layers'),
  getUtilityLayerFeatures: (layerId, bbox) => {
    const q = new URLSearchParams({
      minLon: String(bbox.minLon),
      minLat: String(bbox.minLat),
      maxLon: String(bbox.maxLon),
      maxLat: String(bbox.maxLat),
    }).toString();
    return request(`/utility-layers/${encodeURIComponent(layerId)}/features?${q}`);
  },
};

export function badgesHtml(badges) {
  if (!badges) return '';
  const parts = [];
  if (badges.isPending) parts.push('<span class="badge badge-pending">Pending</span>');
  if (badges.hasBlockers) parts.push('<span class="badge badge-blocker">Blocker</span>');
  if (badges.hadLateResponse) parts.push('<span class="badge badge-late">Late</span>');
  return parts.join('') || '<span class="muted">—</span>';
}

export function parseWktToLatLngs(wkt) {
  if (!wkt) return [];
  const normalized = String(wkt).replace(/\s+/g, ' ').trim();
  const match =
    normalized.match(/POLYGON\s*\(\s*\(\s*([^)]+)\s*\)/i) ||
    normalized.match(/MULTIPOLYGON\s*\(\s*\(\s*\(\s*([^)]+)\s*\)/i);
  if (!match) return [];
  return match[1].split(',').flatMap((pair) => {
    const parts = pair.trim().split(/\s+/).map(Number);
    if (parts.length < 2 || Number.isNaN(parts[0]) || Number.isNaN(parts[1])) return [];
    const [lon, lat] = parts;
    return [[lat, lon]];
  });
}

export function bboxFromLayer(layer) {
  const b = layer.getBounds();
  return {
    minLat: b.getSouth(),
    minLon: b.getWest(),
    maxLat: b.getNorth(),
    maxLon: b.getEast(),
  };
}
