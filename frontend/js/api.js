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
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
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
  const m = wkt.match(/POLYGON\s*\(\(([^)]+)\)\)/i);
  if (!m) return [];
  return m[1].split(',').map((pair) => {
    const [lon, lat] = pair.trim().split(/\s+/).map(Number);
    return [lat, lon];
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
