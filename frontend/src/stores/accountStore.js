import { create } from 'zustand';
import { api } from '../api.js';
import { translate } from '../i18n.jsx';
import { usePrefsStore } from './prefsStore.js';
import { useUiStore } from './uiStore.js';

function notify(message, kind) {
  useUiStore.getState().notify(message, kind);
}

const initialState = {
  prefs: null,
  status: 'idle', // idle | loading | ready | error
  error: null,
  saved: false,
  inflight: null,
};

/**
 * Account settings — one copy for the whole app instead of one per screen.
 *
 * `load()` deduplicates callers that arrive in the same tick and still refetches on every mount:
 * the settings change outside this tab too. `/pause` and `/resume` in the Telegram bot write
 * `notifications_enabled` straight to the database, so a cache that never revalidates would keep
 * claiming reminders are on after the user silenced them from a chat.
 *
 * The cached value stays visible while the refetch runs, which is what removes the placeholder that
 * used to greet every visit to Settings.
 */
export const useAccountStore = create((set, get) => ({
  ...initialState,

  load: () => {
    const pending = get().inflight;
    if (pending) return pending;

    const request = (async () => {
      set({ status: get().prefs ? 'ready' : 'loading', error: null });
      try {
        const prefs = await api.getSettings();
        set({ prefs, status: 'ready' });
        return prefs;
      } catch (err) {
        set({ status: 'error', error: err.message });
        notify(err.message, 'error');
        return null;
      } finally {
        set({ inflight: null });
      }
    })();

    set({ inflight: request });
    return request;
  },

  patch: async (patch) => {
    set({ error: null, saved: false });
    try {
      const prefs = await api.updateSettings(patch);
      set({ prefs, status: 'ready', saved: true });
      notify(translate(usePrefsStore.getState().lang, 'settings.settingsSaved'), 'status');
      return prefs;
    } catch (err) {
      // The already-loaded settings survive a failed PATCH: the screen keeps showing what the
      // server last confirmed rather than blanking out.
      set({ error: err.message });
      notify(err.message, 'error');
      return null;
    }
  },

  unlink: async () => {
    set({ error: null });
    try {
      await api.unlinkTelegram();
      const prefs = await api.getSettings();
      set({ prefs, status: 'ready' });
      return prefs;
    } catch (err) {
      set({ error: err.message });
      notify(err.message, 'error');
      return null;
    }
  },

  /** Settings that arrived from somewhere other than this store — the Telegram link handshake. */
  setPrefs: (prefs) => set({ prefs, status: 'ready' }),

  clearError: () => set({ error: null }),

  // How long the "saved" notice stays on screen is the screen's business; the store only records
  // that a save happened. A timer here would outlive both the page and resetStores().
  clearSaved: () => set({ saved: false }),
}));
