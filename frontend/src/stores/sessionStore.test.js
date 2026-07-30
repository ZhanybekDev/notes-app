import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TOKEN_KEY, useSessionStore } from './sessionStore.js';

const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature';
const store = () => useSessionStore.getState();

describe('token storage format', () => {
  it('writes the bare token, not a JSON envelope', () => {
    store().login(JWT);
    expect(localStorage.getItem(TOKEN_KEY)).toBe(JWT);
  });

  it('reads a session written before this migration', () => {
    // Exactly what the previous auth.js left behind: the raw JWT under the same key.
    localStorage.setItem(TOKEN_KEY, JWT);
    useSessionStore.persist.rehydrate();
    expect(store().token).toBe(JWT);
  });

  it('drops the key on logout', () => {
    store().login(JWT);
    store().logout();
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
    expect(store().token).toBeNull();
  });
});

describe('cross-tab synchronisation', () => {
  it('signs out when another tab clears the key', () => {
    store().login(JWT);
    window.dispatchEvent(new StorageEvent('storage', { key: TOKEN_KEY, newValue: null }));
    expect(store().token).toBeNull();
  });

  it('signs in when another tab writes a token', () => {
    window.dispatchEvent(new StorageEvent('storage', { key: TOKEN_KEY, newValue: JWT }));
    expect(store().token).toBe(JWT);
  });

  it('ignores unrelated keys', () => {
    store().login(JWT);
    window.dispatchEvent(new StorageEvent('storage', { key: 'notes_theme', newValue: 'dark' }));
    expect(store().token).toBe(JWT);
  });
});

describe('storage the browser refuses', () => {
  let warn;

  beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  function blockStorage() {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('The operation is insecure.', 'SecurityError');
    });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('The operation is insecure.', 'SecurityError');
    });
  }

  it('keeps working in memory and says so once', () => {
    blockStorage();

    expect(() => store().login(JWT)).not.toThrow();
    expect(store().token).toBe(JWT);
    expect(store().persistAvailable).toBe(false);

    store().logout();
    store().login(JWT);
    // One warning for the whole session, not one per write.
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('survives a hydration that cannot reach storage', () => {
    blockStorage();
    expect(() => useSessionStore.persist.rehydrate()).not.toThrow();
    expect(store().token).toBeNull();
  });
});
