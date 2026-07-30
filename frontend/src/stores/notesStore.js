import { create } from 'zustand';
import { api } from '../api.js';
import { translate } from '../messages.js';
import { selectLang, usePrefsStore } from './prefsStore.js';
import { reportFailure, useUiStore } from './uiStore.js';

export const PAGE_SIZE = 20;

const initialState = {
  items: [],
  total: 0,
  tags: [],
  selected: null,
  creating: false,
  search: '',
  activeTag: null,
  view: 'active',
  status: 'idle', // idle | loading | ready | error
  // Whether any request has ever settled. Not derivable from `items`: an empty list is both what a
  // fresh store looks like and what a query matching nothing looks like, and the screen has to say
  // different things about the two.
  loaded: false,
  // Which request is in flight, by name: 'save' | 'remove' | 'pin' | 'archive' | 'bulk' | 'more'.
  // A tag rather than a boolean, because the screen has several buttons and only the one that was
  // pressed should show a spinner.
  busy: null,
  offset: 0,
  bulkMode: false,
  selectedIds: new Set(),
  error: null,
};

// Which list request is the current one. Typing three characters fires three requests and the
// server may answer them out of order; without this the slowest answer wins and the list stops
// matching the query in the box. Module scope, not state: only the ordering matters, and it must
// survive the resets the test setup performs.
let latestRequest = 0;

/**
 * Invalidates every request still in flight. Called by `resetStores()` so an answer started by one
 * test cannot land in the next one.
 *
 * Increments rather than zeroes on purpose: resetting to 0 would let a pending ticket 1 match the
 * next request's ticket 1 and apply anyway.
 */
export function resetRequestSequence() {
  latestRequest += 1;
}

/**
 * Notes list, its filters and the current selection.
 *
 * Mutations reload the list themselves. Server data in a client-state store means invalidation is
 * manual, and keeping it inside the action is what stops a caller from forgetting it.
 *
 * The store is headless: no `window` access lives here, so it can be tested without a DOM. The
 * confirmation dialog before a bulk delete stays in the page, which passes an already-confirmed
 * list of ids.
 *
 * Failures go two ways on purpose. `reportFailure` shows the event, which leaves; `error` records it
 * and is the field the tests assert against. No component reads `error` today — the screens show a
 * failure through `status` — and it stays anyway, because it is the only durable record that the last
 * request failed and what it said. One direction only: domain stores reach into `uiStore`, and
 * `uiStore` imports nothing, so there is no cycle.
 */
export const useNotesStore = create((set, get) => ({
  ...initialState,

  load: async (nextOffset = 0, append = false) => {
    const { search, activeTag, view } = get();
    const ticket = ++latestRequest;
    // Whatever the last answer was — a list or an empty result — it stays on screen while the next
    // one is fetched. Keyed on `loaded` rather than on `items.length`, because an empty result is an
    // answer too: keying it on the list made "Nothing found" blink on every keystroke.
    set({ status: get().loaded ? 'ready' : 'loading' });
    try {
      const [page, tags] = await Promise.all([
        api.listNotes({
          q: search,
          tag: activeTag,
          archived: view === 'archived',
          limit: PAGE_SIZE,
          offset: nextOffset,
        }),
        api.tags(),
      ]);
      if (ticket !== latestRequest) return;
      set((prev) => ({
        status: 'ready',
        loaded: true,
        total: page.total,
        items: append ? [...prev.items, ...page.items] : page.items,
        tags,
        offset: nextOffset,
        // A success clears the previous failure. Leaving it would keep an "offline" banner above a
        // freshly loaded list — and, now that this lives in a store rather than the page, would keep
        // it there across navigation until the tab was reloaded.
        error: null,
      }));
    } catch (err) {
      if (ticket !== latestRequest) return;
      set({ status: 'error', error: err.message });
      reportFailure(err);
    }
  },

  loadMore: async () => {
    if (get().busy) return;
    set({ busy: 'more' });
    try {
      await get().load(get().offset + PAGE_SIZE, true);
    } finally {
      set({ busy: null });
    }
  },

  // Reloading on a filter change lives here and nowhere else. It used to hang on the identity of a
  // useCallback in the page; leaving a second trigger in an effect would double every request.
  setSearch: (search) => {
    set({ search });
    return get().load(0, false);
  },

  setActiveTag: (activeTag) => {
    set({ activeTag });
    return get().load(0, false);
  },

  setView: (view) => {
    set({ view, selected: null, creating: false });
    return get().load(0, false);
  },

  select: (note) => set({ selected: note, creating: false }),
  startCreating: () => set({ creating: true, selected: null }),
  cancel: () => set({ creating: false, selected: null }),

  save: async (data) => {
    const { selected } = get();
    if (get().busy) return;
    set({ error: null, busy: 'save' });
    try {
      if (selected) {
        set({ selected: await api.updateNote(selected.id, data) });
      } else {
        set({ selected: await api.createNote(data), creating: false });
      }
      await get().load(0, false);
    } catch (err) {
      set({ error: err.message });
      reportFailure(err);
    } finally {
      set({ busy: null });
    }
  },

  remove: async (id) => {
    if (get().busy) return;
    set({ error: null, busy: 'remove' });
    try {
      await api.deleteNote(id);
      set({ selected: null });
      await get().load(0, false);
    } catch (err) {
      set({ error: err.message });
      reportFailure(err);
    } finally {
      set({ busy: null });
    }
  },

  setPin: async (note, pin) => {
    if (get().busy) return;
    set({ error: null, busy: 'pin' });
    try {
      set({ selected: pin ? await api.pinNote(note.id) : await api.unpinNote(note.id) });
      await get().load(0, false);
    } catch (err) {
      set({ error: err.message });
      reportFailure(err);
    } finally {
      set({ busy: null });
    }
  },

  setArchive: async (note, archive) => {
    if (get().busy) return;
    set({ error: null, busy: 'archive' });
    try {
      const updated = archive ? await api.archiveNote(note.id) : await api.unarchiveNote(note.id);
      // Archiving from the active view moves the note out of sight, so the editor closes instead of
      // showing a note the list no longer contains.
      const leavesView = get().view === (archive ? 'active' : 'archived');
      set({ selected: leavesView ? null : updated });
      await get().load(0, false);
    } catch (err) {
      set({ error: err.message });
      reportFailure(err);
    } finally {
      set({ busy: null });
    }
  },

  bulkDelete: async (ids) => {
    if (!ids.length) return;
    if (get().busy) return;
    set({ error: null, busy: 'bulk' });
    try {
      await api.bulkDelete(ids);
      set({ selectedIds: new Set(), bulkMode: false, selected: null });
      await get().load(0, false);
    } catch (err) {
      set({ error: err.message });
      reportFailure(err);
    } finally {
      set({ busy: null });
    }
  },

  /**
   * Publish a read-only link for the open note, or hand back the one it already has.
   *
   * Here rather than in the component that renders the button: `docs/architecture.md` keeps
   * fetching out of `components/*`, and the token belongs to the note, so the note's own store is
   * where it belongs. Writing it back into `selected` is what stops the editor from offering to
   * share something that is already shared.
   */
  share: async (id) => {
    if (get().busy) return null;
    set({ error: null, busy: 'share' });
    try {
      const { share_token: token } = await api.shareNote(id);
      set((prev) => ({
        selected: prev.selected?.id === id ? { ...prev.selected, share_token: token } : prev.selected,
      }));
      return token;
    } catch (err) {
      set({ error: err.message });
      reportFailure(err);
      return null;
    } finally {
      set({ busy: null });
    }
  },

  unshare: async (id) => {
    if (get().busy) return;
    set({ error: null, busy: 'unshare' });
    try {
      await api.unshareNote(id);
      set((prev) => ({
        selected: prev.selected?.id === id ? { ...prev.selected, share_token: null } : prev.selected,
      }));
      const lang = selectLang(usePrefsStore.getState());
      useUiStore.getState().notify(translate(lang, 'share.revoked'), 'status');
    } catch (err) {
      set({ error: err.message });
      reportFailure(err);
    } finally {
      set({ busy: null });
    }
  },

  toggleBulk: () => set((prev) => ({ bulkMode: !prev.bulkMode, selectedIds: new Set() })),

  toggleSelect: (id) =>
    set((prev) => {
      const next = new Set(prev.selectedIds);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { selectedIds: next };
    }),

  selectAll: () => set((prev) => ({ selectedIds: new Set(prev.items.map((n) => n.id)) })),
}));
