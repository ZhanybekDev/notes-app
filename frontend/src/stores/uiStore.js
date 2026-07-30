import { create } from 'zustand';

const initialState = {
  toasts: [],
};

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
    const existing = get().toasts.find((toast) => toast.message === message);
    if (existing) {
      set((prev) => ({
        toasts: prev.toasts.map((toast) =>
          toast.id === existing.id ? { ...toast, renewals: toast.renewals + 1 } : toast,
        ),
      }));
      return existing.id;
    }
    const id = ++nextId;
    set((prev) => ({ toasts: [...prev.toasts, { id, message, kind, renewals: 0 }] }));
    return id;
  },

  dismiss: (id) => set((prev) => ({ toasts: prev.toasts.filter((toast) => toast.id !== id) })),
}));
