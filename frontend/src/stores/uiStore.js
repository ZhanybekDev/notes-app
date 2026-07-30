import { create } from 'zustand';

const initialState = {
  toasts: [],
};

// A stack taller than this stops being a notification and becomes a wall. Distinct messages are not
// deduplicated, so a server answering differently every time would otherwise pile up without bound.
const MAX_VISIBLE = 4;

let nextId = 0;

/**
 * Invalidates nothing — ids only have to be unique within a session. Exported for `resetStores()` so
 * a test cannot see an id another test produced.
 */
export function resetToastIds() {
  nextId = 0;
}

/**
 * The toast queue, and nothing else.
 *
 * No timers live here on purpose. A `setTimeout` owned by the store outlives both the page that
 * caused it and `resetStores()`, so a dismissal scheduled by one test fires inside the next one.
 * `<Toaster />` owns the clocks; the store owns the list.
 */
export const useUiStore = create((set, get) => ({
  ...initialState,

  /**
   * Queues a message, or renews the one already saying it.
   *
   * Mounting `/notes` starts two loads at once — the notes list and the account prefs — so one
   * dropped network produces two failures in the same tick. Without collapsing them the user gets
   * two identical banners stacked on top of each other.
   *
   * A repeat is not silently dropped, though: it bumps `renewals` on the existing toast, and the
   * timer effect in `<Toaster />` is keyed on that counter, so the countdown restarts without the
   * banner unmounting. Dropping the repeat outright would let the first toast leave on its original
   * schedule while the thing it reports is still happening.
   */
  notify: (message, kind = 'status') => {
    // Kind is part of the identity: a polite message whose text happens to match a queued error
    // must not renew the error and inherit its eight seconds.
    const existing = get().toasts.find((toast) => toast.message === message && toast.kind === kind);
    if (existing) {
      set((prev) => ({
        toasts: prev.toasts.map((toast) =>
          toast.id === existing.id ? { ...toast, renewals: toast.renewals + 1 } : toast,
        ),
      }));
      return existing.id;
    }
    const id = ++nextId;
    set((prev) => ({
      toasts: [...prev.toasts, { id, message, kind, renewals: 0 }].slice(-MAX_VISIBLE),
    }));
    return id;
  },

  dismiss: (id) => set((prev) => ({ toasts: prev.toasts.filter((toast) => toast.id !== id) })),
}));

/**
 * Shows a failure that has nowhere better to appear.
 *
 * A 401 is deliberately not shown. `api.js` answers it by ending the session, so the redirect to the
 * login form already tells the reader what happened; reporting it as well would put an untranslated
 * "Unauthorized" alert on that form for eight seconds, announced assertively, for what is a normal
 * end of a session rather than an error.
 */
export function reportFailure(err) {
  if (err?.status === 401) return;
  useUiStore.getState().notify(err?.message ?? String(err), 'error');
}
