import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { isAvailable, onUnavailable, read, remove, write } from './safeStorage.js';

export const TOKEN_KEY = 'notes_token';

/**
 * Stores the JWT as a bare string, the way it has always been stored.
 *
 * `persist`'s default storage wraps state in `{"state":…,"version":0}` and reads it back with
 * `JSON.parse`. A raw JWT is not valid JSON, so that default would fail to hydrate and log every
 * live session out the moment this shipped — and a rollback would do it again in the other
 * direction. Reading and writing the plain token keeps both directions working.
 */
const tokenStorage = {
  getItem: (name) => {
    const token = read(name);
    return token ? { state: { token }, version: 0 } : null;
  },
  setItem: (name, value) => {
    const token = value?.state?.token;
    if (token) write(name, token);
    else remove(name);
  },
  removeItem: (name) => remove(name),
};

export const useSessionStore = create(
  persist(
    (set) => ({
      token: null,
      // False once a storage operation has failed: the session works but will not survive a reload,
      // and saying so beats letting the user rediscover it after every refresh.
      persistAvailable: true,

      login: (token) => set({ token }),
      logout: () => set({ token: null }),
    }),
    {
      name: TOKEN_KEY,
      storage: tokenStorage,
      partialize: (state) => ({ token: state.token }),
    },
  ),
);

// Hydration already ran by now, so this records whether it could actually reach storage. Later
// failures arrive through the subscription, because `persist` writes after the action's own `set`.
useSessionStore.setState({ persistAvailable: isAvailable() });
onUnavailable(() => useSessionStore.setState({ persistAvailable: false }));

if (typeof window !== 'undefined') {
  // Applied in both directions on purpose. Handling only the emptied key would log every tab out
  // together but leave a second tab showing the login form to someone who has just signed in —
  // half a mechanism reads as a bug.
  window.addEventListener('storage', (event) => {
    if (event.key !== TOKEN_KEY) return;
    useSessionStore.setState({ token: event.newValue || null });
  });
}
