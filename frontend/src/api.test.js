import { beforeEach, describe, expect, it, vi } from 'vitest';

import { api, filenameFrom } from './api.js';
import { useSessionStore } from './stores/sessionStore.js';

describe('the public request path', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('escapes the token instead of pasting it into the path', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    });

    // A real token is urlsafe base64, so this cannot arrive from the router — it can arrive from a
    // hand-typed address, and a raw `/` would silently request a different path.
    await api.publicNote('a/b?c');

    expect(fetchMock).toHaveBeenCalledWith('/api/public/notes/a%2Fb%3Fc');
  });

  it('sends no session and ends none', async () => {
    useSessionStore.getState().login('jwt');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({}),
    });

    await expect(api.publicNote('tok')).rejects.toThrow();

    // The private path logs out on 401. This one must not, or a dead link signs out its reader.
    expect(useSessionStore.getState().token).toBe('jwt');
  });

  it('carries the status through so a caller can tell 404 from a network failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ detail: 'Note not found' }),
    });

    await expect(api.publicNote('tok')).rejects.toMatchObject({ status: 404 });
  });
});


describe('the download path', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('prefers the encoded filename over the ascii fallback', () => {
    // Reading `filename` first would turn "Планы.md" into ".md": the fallback drops every
    // non-Latin character by construction.
    const header = 'attachment; filename=".md"; filename*=UTF-8\'\'%D0%9F%D0%BB%D0%B0%D0%BD%D1%8B.md';
    expect(filenameFrom(header)).toBe('Планы.md');
  });

  it('falls back to the plain name, and then to a default', () => {
    expect(filenameFrom('attachment; filename="notes.zip"')).toBe('notes.zip');
    expect(filenameFrom(null, 'download')).toBe('download');
    expect(filenameFrom("attachment; filename*=UTF-8''%E0%A4%A", 'download')).toBe('download');
  });

  it('carries the session on an export, unlike the public read', async () => {
    useSessionStore.getState().login('jwt');
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      blob: async () => new Blob(['zip']),
      headers: { get: () => 'attachment; filename="notes.zip"' },
    });

    const { filename } = await api.exportNotes({ tag: 'work' });

    expect(fetchMock).toHaveBeenCalledWith('/api/notes/export?tag=work', {
      headers: { Authorization: 'Bearer jwt' },
    });
    expect(filename).toBe('notes.zip');
  });

  it('ends the session on a 401, the same as every other private request', async () => {
    useSessionStore.getState().login('jwt');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({}),
    });

    await expect(api.exportNote(1)).rejects.toThrow('Unauthorized');
    expect(useSessionStore.getState().token).toBeNull();
  });
});
