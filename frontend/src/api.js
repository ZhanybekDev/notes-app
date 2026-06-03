import { clearToken, getToken } from './auth.js';

const BASE = '/api';

export class ApiError extends Error {
  constructor(message, status) {
    super(typeof message === 'string' ? message : JSON.stringify(message));
    this.status = status;
  }
}

async function request(path, { method = 'GET', body, form } = {}) {
  const headers = {};
  const token = getToken();
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
    clearToken();
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

// Fetch a binary attachment (auth header included) and trigger a browser download.
async function download(path, fallbackName) {
  const token = getToken();
  const res = await fetch(`${BASE}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (res.status === 401) {
    clearToken();
    throw new ApiError('Unauthorized', 401);
  }
  if (!res.ok) throw new ApiError('Export failed', res.status);

  const blob = await res.blob();
  const match = /filename="(.+?)"/.exec(res.headers.get('Content-Disposition') || '');
  const name = match ? match[1] : fallbackName;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
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

  changePassword: (currentPassword, newPassword) =>
    request('/account/change-password', {
      method: 'POST',
      body: { current_password: currentPassword, new_password: newPassword },
    }),
  deleteAccount: (password) =>
    request('/account', { method: 'DELETE', body: { password } }),

  getTelegramStatus: () => request('/account/telegram'),
  linkTelegram: () => request('/account/telegram/link', { method: 'POST' }),
  unlinkTelegram: () => request('/account/telegram', { method: 'DELETE' }),
  setTelegramReminders: (enabled) =>
    request('/account/telegram/reminders', { method: 'PUT', body: { enabled } }),
  setTimezone: (timezone) =>
    request('/account/telegram/timezone', { method: 'PUT', body: { timezone } }),

  exportNote: (id) => download(`/export/note/${id}`, `note-${id}.md`),
  exportAllNotes: () => download('/export/notes', 'notes.zip'),

  shareNote: (id) => request(`/notes/${id}/share`, { method: 'POST' }),
  unshareNote: (id) => request(`/notes/${id}/share`, { method: 'DELETE' }),
  getSharedNote: (token) => request(`/share/${token}`),
};
