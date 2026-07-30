import { create } from 'zustand';

import { translate } from '../messages.js';
import { selectLang, usePrefsStore } from './prefsStore.js';

const initialState = {
  toasts: [],
  // Ids the reader is holding open — hovered or focused. Kept here rather than in the component so
  // eviction can see it; the timers stay in the component, this is a flag, not a clock.
  held: new Set(),
};

// A stack taller than this stops being a notification and becomes a wall. Distinct messages are not
// deduplicated, so a server answering differently every time would otherwise pile up without bound.
const MAX_VISIBLE = 4;

/**
 * Which toast makes room for a new one.
 *
 * Not simply the oldest. A toast the reader is holding is never taken from under them — that is the
 * whole point of pausing on hover — and a polite message goes before a failure, so three "Saved."
 * notices cannot push out the one thing that needed attention. Returns null when everything on screen
 * is held, in which case the stack is briefly allowed to exceed the cap.
 */
function victimFor(toasts, held, incomingId) {
  const candidates = toasts.filter((toast) => toast.id !== incomingId && !held.has(toast.id));
  if (!candidates.length) return null;
  return (candidates.find((toast) => toast.kind !== 'error') ?? candidates[0]).id;
}

/**
 * What to show the reader for a rejection.
 *
 * A message from the server is passed through: it answered, and its answer is more specific than
 * anything this layer could invent. Everything else is ours — a rejection with no status never reached
 * the server, which in practice means the network, and the browser's own wording for that ("Failed to
 * fetch") is both English and meaningless to the person reading it.
 */
function messageFor(err) {
  const lang = selectLang(usePrefsStore.getState());
  if (typeof err === 'string') return err;
  if (typeof err?.message !== 'string' || !err.message) return translate(lang, 'errors.unknown');
  if (err.status === undefined) return translate(lang, 'errors.offline');
  return err.message;
}

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
    set((prev) => {
      const next = [...prev.toasts, { id, message, kind, renewals: 0 }];
      if (next.length <= MAX_VISIBLE) return { toasts: next };
      const victim = victimFor(next, prev.held, id);
      return { toasts: victim === null ? next : next.filter((toast) => toast.id !== victim) };
    });
    return id;
  },

  dismiss: (id) =>
    set((prev) => ({
      toasts: prev.toasts.filter((toast) => toast.id !== id),
      held: setWithout(prev.held, id),
    })),

  hold: (id) => set((prev) => ({ held: new Set(prev.held).add(id) })),

  release: (id) => set((prev) => ({ held: setWithout(prev.held, id) })),
}));

function setWithout(source, id) {
  if (!source.has(id)) return source;
  const next = new Set(source);
  next.delete(id);
  return next;
}

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
  useUiStore.getState().notify(messageFor(err), 'error');
}
