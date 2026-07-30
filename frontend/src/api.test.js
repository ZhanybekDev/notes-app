import { beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from './api.js';
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
