import { create } from 'zustand';
import { api } from '../api.js';

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
  offset: 0,
  bulkMode: false,
  selectedIds: new Set(),
  error: null,
};

/**
 * Notes list, its filters and the current selection.
 *
 * Mutations reload the list themselves. Server data in a client-state store means invalidation is
 * manual, and keeping it inside the action is what stops a caller from forgetting it.
 *
 * The store is headless: no `window` access lives here, so it can be tested without a DOM. The
 * confirmation dialog before a bulk delete stays in the page, which passes an already-confirmed
 * list of ids.
 */
export const useNotesStore = create((set, get) => ({
  ...initialState,

  load: async (nextOffset = 0, append = false) => {
    const { search, activeTag, view } = get();
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
      set((prev) => ({
        total: page.total,
        items: append ? [...prev.items, ...page.items] : page.items,
        tags,
        offset: nextOffset,
      }));
    } catch (err) {
      set({ error: err.message });
    }
  },

  loadMore: () => get().load(get().offset + PAGE_SIZE, true),

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
    try {
      if (selected) {
        set({ selected: await api.updateNote(selected.id, data) });
      } else {
        set({ selected: await api.createNote(data), creating: false });
      }
      await get().load(0, false);
    } catch (err) {
      set({ error: err.message });
    }
  },

  remove: async (id) => {
    try {
      await api.deleteNote(id);
      set({ selected: null });
      await get().load(0, false);
    } catch (err) {
      set({ error: err.message });
    }
  },

  setPin: async (note, pin) => {
    try {
      set({ selected: pin ? await api.pinNote(note.id) : await api.unpinNote(note.id) });
      await get().load(0, false);
    } catch (err) {
      set({ error: err.message });
    }
  },

  setArchive: async (note, archive) => {
    try {
      const updated = archive ? await api.archiveNote(note.id) : await api.unarchiveNote(note.id);
      // Archiving from the active view moves the note out of sight, so the editor closes instead of
      // showing a note the list no longer contains.
      const leavesView = get().view === (archive ? 'active' : 'archived');
      set({ selected: leavesView ? null : updated });
      await get().load(0, false);
    } catch (err) {
      set({ error: err.message });
    }
  },

  bulkDelete: async (ids) => {
    if (!ids.length) return;
    try {
      await api.bulkDelete(ids);
      set({ selectedIds: new Set(), bulkMode: false, selected: null });
      await get().load(0, false);
    } catch (err) {
      set({ error: err.message });
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
