import { beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '../api.js';
import { resetStores } from './index.js';
import { PAGE_SIZE, useNotesStore } from './notesStore.js';

const note = (id, extra = {}) => ({ id, title: `note ${id}`, tags: [], ...extra });
const page = (items, total = items.length) => ({ items, total });

function stubList(pages = [page([note(1)])]) {
  const list = vi.spyOn(api, 'listNotes');
  pages.forEach((p) => list.mockResolvedValueOnce(p));
  list.mockResolvedValue(pages[pages.length - 1]);
  vi.spyOn(api, 'tags').mockResolvedValue(['work']);
  return list;
}

const store = () => useNotesStore.getState();

describe('resetStores isolation', () => {
  it('leaves state dirty inside a single test', () => {
    useNotesStore.setState({ search: 'dirty', items: [note(9)] });
    expect(store().search).toBe('dirty');
  });

  it('starts the next test from the initial state', () => {
    expect(store().search).toBe('');
    expect(store().items).toEqual([]);
    expect(store().selectedIds.size).toBe(0);
  });
});

describe('load', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('stores the page and the tag list', async () => {
    stubList([page([note(1), note(2)], 5)]);
    await store().load();
    expect(store().items.map((n) => n.id)).toEqual([1, 2]);
    expect(store().total).toBe(5);
    expect(store().tags).toEqual(['work']);
    expect(store().offset).toBe(0);
  });

  it('appends instead of replacing when asked to', async () => {
    stubList([page([note(1)], 2), page([note(2)], 2)]);
    await store().load();
    await store().load(PAGE_SIZE, true);
    expect(store().items.map((n) => n.id)).toEqual([1, 2]);
    expect(store().offset).toBe(PAGE_SIZE);
  });

  it('passes the current filters to the request', async () => {
    const list = stubList();
    useNotesStore.setState({ search: 'draft', activeTag: 'work', view: 'archived' });
    await store().load();
    expect(list).toHaveBeenCalledWith({
      q: 'draft',
      tag: 'work',
      archived: true,
      limit: PAGE_SIZE,
      offset: 0,
    });
  });

  it('asks for the next page and appends it', async () => {
    const list = stubList([page([note(1)], 2), page([note(2)], 2)]);
    await store().load();
    await store().loadMore();
    expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ offset: PAGE_SIZE }));
    expect(store().items.map((n) => n.id)).toEqual([1, 2]);
  });

  it('puts a failed request into error instead of throwing', async () => {
    vi.spyOn(api, 'listNotes').mockRejectedValue(new Error('offline'));
    vi.spyOn(api, 'tags').mockResolvedValue([]);
    await store().load();
    expect(store().error).toBe('offline');
    expect(store().items).toEqual([]);
  });
});

describe('error does not outlive the failure', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('clears the message once a load succeeds', async () => {
    const list = vi.spyOn(api, 'listNotes').mockRejectedValueOnce(new Error('offline'));
    vi.spyOn(api, 'tags').mockResolvedValue([]);
    await store().load();
    expect(store().error).toBe('offline');

    list.mockResolvedValue(page([note(1)]));
    await store().load();
    // Otherwise the banner sits above a freshly loaded list — and, living in a store rather than the
    // page, it would survive navigating away and back.
    expect(store().error).toBeNull();
  });

  it.each([
    ['remove', async () => store().remove(1)],
    ['setPin', async () => store().setPin(note(1), true)],
    ['bulkDelete', async () => store().bulkDelete([1])],
  ])('%s starts from a clean error', async (_name, act) => {
    stubList();
    vi.spyOn(api, 'deleteNote').mockResolvedValue(null);
    vi.spyOn(api, 'pinNote').mockResolvedValue(note(1));
    vi.spyOn(api, 'bulkDelete').mockResolvedValue(null);
    useNotesStore.setState({ error: 'stale' });
    await act();
    expect(store().error).toBeNull();
  });
});

describe('out-of-order answers', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('ignores a response that a newer request has already superseded', async () => {
    vi.spyOn(api, 'tags').mockResolvedValue([]);
    let releaseStale;
    const stale = new Promise((resolve) => {
      releaseStale = () => resolve(page([note(1)], 1));
    });
    vi.spyOn(api, 'listNotes')
      .mockReturnValueOnce(stale)
      .mockResolvedValueOnce(page([note(2)], 1));

    const first = store().load();
    await store().load();
    releaseStale();
    await first;

    // Typing fast fires a request per keystroke; the slowest answer must not win.
    expect(store().items.map((n) => n.id)).toEqual([2]);
  });

  it('drops an answer that arrives after the stores were reset', async () => {
    vi.spyOn(api, 'tags').mockResolvedValue([]);
    let releasePending;
    const pending = new Promise((resolve) => {
      releasePending = () => resolve(page([note(1)], 1));
    });
    vi.spyOn(api, 'listNotes').mockReturnValueOnce(pending);

    const inFlight = store().load();
    // What afterEach does between tests. A request started by one test must not land in the next.
    resetStores();
    releasePending();
    await inFlight;

    expect(store().items).toEqual([]);
    expect(store().error).toBeNull();
  });
});

describe('filters reload exactly once', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    ['setSearch', () => store().setSearch('a')],
    ['setActiveTag', () => store().setActiveTag('work')],
    ['setView', () => store().setView('archived')],
  ])('%s triggers one list request', async (_name, act) => {
    const list = stubList();
    await act();
    expect(list).toHaveBeenCalledTimes(1);
  });

  it('keeps the typed value while reloading', async () => {
    stubList();
    await store().setSearch('abc');
    expect(store().search).toBe('abc');
  });

  it('closes the editor when the view changes', async () => {
    stubList();
    useNotesStore.setState({ selected: note(1), creating: true });
    await store().setView('archived');
    expect(store().selected).toBeNull();
    expect(store().creating).toBe(false);
  });
});

describe('mutations reload the list', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('creates a note and reloads', async () => {
    const list = stubList();
    const create = vi.spyOn(api, 'createNote').mockResolvedValue(note(7));
    useNotesStore.setState({ creating: true });
    await store().save({ title: 'fresh' });
    expect(create).toHaveBeenCalledWith({ title: 'fresh' });
    expect(store().selected).toEqual(note(7));
    expect(store().creating).toBe(false);
    expect(list).toHaveBeenCalledTimes(1);
  });

  it('updates the selected note and reloads', async () => {
    const list = stubList();
    const update = vi.spyOn(api, 'updateNote').mockResolvedValue(note(3, { title: 'edited' }));
    useNotesStore.setState({ selected: note(3) });
    await store().save({ title: 'edited' });
    expect(update).toHaveBeenCalledWith(3, { title: 'edited' });
    expect(store().selected.title).toBe('edited');
    expect(list).toHaveBeenCalledTimes(1);
  });

  it('deletes a note, clears the selection and reloads', async () => {
    const list = stubList();
    const remove = vi.spyOn(api, 'deleteNote').mockResolvedValue(null);
    useNotesStore.setState({ selected: note(3) });
    await store().remove(3);
    expect(remove).toHaveBeenCalledWith(3);
    expect(store().selected).toBeNull();
    expect(list).toHaveBeenCalledTimes(1);
  });

  it('pins and unpins through the matching endpoint', async () => {
    stubList();
    const pin = vi.spyOn(api, 'pinNote').mockResolvedValue(note(1, { pinned_at: 'now' }));
    const unpin = vi.spyOn(api, 'unpinNote').mockResolvedValue(note(1));
    await store().setPin(note(1), true);
    expect(pin).toHaveBeenCalledWith(1);
    await store().setPin(note(1), false);
    expect(unpin).toHaveBeenCalledWith(1);
  });

  it('closes the editor when archiving takes the note out of the current view', async () => {
    stubList();
    vi.spyOn(api, 'archiveNote').mockResolvedValue(note(1, { archived_at: 'now' }));
    useNotesStore.setState({ view: 'active', selected: note(1) });
    await store().setArchive(note(1), true);
    expect(store().selected).toBeNull();
  });

  it('keeps the note selected when it stays in view', async () => {
    stubList();
    vi.spyOn(api, 'unarchiveNote').mockResolvedValue(note(1, { title: 'back' }));
    useNotesStore.setState({ view: 'active', selected: note(1) });
    await store().setArchive(note(1), false);
    expect(store().selected.title).toBe('back');
  });

  it('bulk-deletes the given ids and leaves bulk mode', async () => {
    const list = stubList();
    const bulk = vi.spyOn(api, 'bulkDelete').mockResolvedValue(null);
    useNotesStore.setState({ bulkMode: true, selectedIds: new Set([1, 2]) });
    await store().bulkDelete([1, 2]);
    expect(bulk).toHaveBeenCalledWith([1, 2]);
    expect(store().bulkMode).toBe(false);
    expect(store().selectedIds.size).toBe(0);
    expect(list).toHaveBeenCalledTimes(1);
  });

  it('does not call the API for an empty bulk selection', async () => {
    const bulk = vi.spyOn(api, 'bulkDelete').mockResolvedValue(null);
    await store().bulkDelete([]);
    expect(bulk).not.toHaveBeenCalled();
  });

  it('reports a failed mutation without losing the list', async () => {
    stubList();
    await store().load();
    vi.spyOn(api, 'deleteNote').mockRejectedValue(new Error('gone'));
    await store().remove(1);
    expect(store().error).toBe('gone');
    expect(store().items).toHaveLength(1);
  });
});

describe('selection', () => {
  it('toggles ids without mutating the previous Set', () => {
    const before = store().selectedIds;
    store().toggleSelect(1);
    const after = store().selectedIds;
    expect(before.has(1)).toBe(false);
    expect(after.has(1)).toBe(true);
    expect(after).not.toBe(before);
  });

  it('drops an id that was already selected', () => {
    store().toggleSelect(1);
    store().toggleSelect(1);
    expect(store().selectedIds.size).toBe(0);
  });

  it('selects every loaded note', () => {
    useNotesStore.setState({ items: [note(1), note(2)] });
    store().selectAll();
    expect([...store().selectedIds]).toEqual([1, 2]);
  });

  it('clears the selection when bulk mode toggles', () => {
    useNotesStore.setState({ selectedIds: new Set([1]) });
    store().toggleBulk();
    expect(store().bulkMode).toBe(true);
    expect(store().selectedIds.size).toBe(0);
  });
});
