import { useSessionStore } from './stores/sessionStore.js';

const BASE = '/api';

export class ApiError extends Error {
  constructor(message, status) {
    super(typeof message === 'string' ? message : JSON.stringify(message));
    this.status = status;
  }
}

async function request(path, { method = 'GET', body, form } = {}) {
  const headers = {};
  const token = useSessionStore.getState().token;
  if (token) headers.Authorization = `Bearer ${token}`;

  let payload;
  if (form) {
    payload = new URLSearchParams(form).toString();
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
  } else if (body !== undefined) {
    payload = JSON.stringify(body);
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(`${BASE}${path}`, { method, headers, body: payload });

  if (res.status === 401) {
    useSessionStore.getState().logout();
    throw new ApiError('Unauthorized', 401);
  }
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new ApiError(detail.detail || res.statusText, res.status);
  }
  if (res.status === 204) return null;
  return res.json();
}

function buildQuery(params) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') qs.append(k, v);
  }
  return qs.toString() ? `?${qs}` : '';
}

/**
 * A request that carries no session and must not end one.
 *
 * The shared-note page is opened by people who may have no account here at all, and by owners who
 * do. `request()` above ends the session on any 401, which for a public link would mean a revoked
 * link signs out whoever opened it. This path sends no token and treats every failure as a failure
 * of that one page.
 */
async function publicRequest(path) {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new ApiError(detail.detail || res.statusText, res.status);
  }
  return res.json();
}

export const api = {
  register: (username, password) =>
    request('/auth/register', { method: 'POST', body: { username, password } }),
  login: (username, password) =>
    request('/auth/login', { method: 'POST', form: { username, password } }),

  listNotes: (params = {}) => request(`/notes${buildQuery(params)}`),
  getNote: (id) => request(`/notes/${id}`),
  createNote: (data) => request('/notes', { method: 'POST', body: data }),
  updateNote: (id, data) => request(`/notes/${id}`, { method: 'PUT', body: data }),
  deleteNote: (id) => request(`/notes/${id}`, { method: 'DELETE' }),
  bulkDelete: (ids) => request('/notes/bulk-delete', { method: 'POST', body: { ids } }),

  archiveNote: (id) => request(`/notes/${id}/archive`, { method: 'POST' }),
  unarchiveNote: (id) => request(`/notes/${id}/unarchive`, { method: 'POST' }),
  pinNote: (id) => request(`/notes/${id}/pin`, { method: 'POST' }),
  unpinNote: (id) => request(`/notes/${id}/unpin`, { method: 'POST' }),

  calendar: (year, month) => request(`/notes/calendar?year=${year}&month=${month}`),
  tags: () => request('/tags'),

  shareNote: (id) => request(`/notes/${id}/share`, { method: 'POST' }),
  unshareNote: (id) => request(`/notes/${id}/share`, { method: 'DELETE' }),
  publicNote: (token) => publicRequest(`/public/notes/${encodeURIComponent(token)}`),

  getSettings: () => request('/account/settings'),
  updateSettings: (patch) => request('/account/settings', { method: 'PATCH', body: patch }),
  linkTelegram: () => request('/account/telegram/link', { method: 'POST' }),
  unlinkTelegram: () => request('/account/telegram', { method: 'DELETE' }),

  changePassword: (currentPassword, newPassword) =>
    request('/account/change-password', {
      method: 'POST',
      body: { current_password: currentPassword, new_password: newPassword },
    }),
  deleteAccount: (password) =>
    request('/account', { method: 'DELETE', body: { password } }),
};
