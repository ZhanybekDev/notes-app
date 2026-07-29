import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import NoteList from '../components/NoteList.jsx';
import NoteEditor from '../components/NoteEditor.jsx';
import TagFilter from '../components/TagFilter.jsx';
import { useLang } from '../i18n.jsx';

const PAGE_SIZE = 20;

export default function Notes({ registerAction }) {
  const { t } = useLang();
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [tags, setTags] = useState([]);
  const [selected, setSelected] = useState(null);
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState('');
  const [activeTag, setActiveTag] = useState(null);
  const [view, setView] = useState('active'); // 'active' | 'archived'
  const [offset, setOffset] = useState(0);
  const [bulkMode, setBulkMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [error, setError] = useState(null);
  // Fetched here rather than in NoteEditor: components stay presentational, pages fetch.
  const [reminderPrefs, setReminderPrefs] = useState(null);
  const [reminderPrefsFailed, setReminderPrefsFailed] = useState(false);

  const searchRef = useRef(null);
  const editorRef = useRef(null);

  const load = useCallback(async (nextOffset = 0, append = false) => {
    try {
      const [page, ts] = await Promise.all([
        api.listNotes({
          q: search,
          tag: activeTag,
          archived: view === 'archived',
          limit: PAGE_SIZE,
          offset: nextOffset,
        }),
        api.tags(),
      ]);
      setTotal(page.total);
      setItems((prev) => (append ? [...prev, ...page.items] : page.items));
      setTags(ts);
      setOffset(nextOffset);
    } catch (err) {
      setError(err.message);
    }
  }, [search, activeTag, view]);

  useEffect(() => {
    load(0, false);
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    api
      .getSettings()
      .then((prefs) => {
        if (!cancelled) setReminderPrefs(prefs);
      })
      .catch(() => {
        // Reported next to the date field rather than as a page-level error: the reminder hint
        // is secondary, and failing it should not read as "the notes list is broken".
        if (!cancelled) setReminderPrefsFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    registerAction?.('newNote', () => { setCreating(true); setSelected(null); });
    registerAction?.('focusSearch', () => searchRef.current?.focus());
    registerAction?.('save', () => editorRef.current?.submit());
    return () => {
      registerAction?.('newNote', null);
      registerAction?.('focusSearch', null);
      registerAction?.('save', null);
    };
  }, [registerAction]);

  const onSave = async (data) => {
    try {
      if (selected) {
        const updated = await api.updateNote(selected.id, data);
        setSelected(updated);
      } else {
        const created = await api.createNote(data);
        setSelected(created);
        setCreating(false);
      }
      await load(0, false);
    } catch (err) {
      setError(err.message);
    }
  };

  const onDelete = async (id) => {
    try {
      await api.deleteNote(id);
      setSelected(null);
      await load(0, false);
    } catch (err) {
      setError(err.message);
    }
  };

  const onPin = async (note, pin) => {
    try {
      const updated = pin ? await api.pinNote(note.id) : await api.unpinNote(note.id);
      setSelected(updated);
      await load(0, false);
    } catch (err) {
      setError(err.message);
    }
  };

  const onArchive = async (note, archive) => {
    try {
      const updated = archive ? await api.archiveNote(note.id) : await api.unarchiveNote(note.id);
      setSelected(view === (archive ? 'active' : 'archived') ? null : updated);
      await load(0, false);
    } catch (err) {
      setError(err.message);
    }
  };

  const toggleBulk = () => {
    setBulkMode((b) => !b);
    setSelectedIds(new Set());
  };

  const toggleSelect = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    setSelectedIds(new Set(items.map((n) => n.id)));
  };

  const bulkDelete = async () => {
    if (selectedIds.size === 0) return;
    const count = selectedIds.size;
    if (!window.confirm(t('notes.confirmBulkDelete', { count }))) return;
    try {
      await api.bulkDelete([...selectedIds]);
      setSelectedIds(new Set());
      setBulkMode(false);
      setSelected(null);
      await load(0, false);
    } catch (err) {
      setError(err.message);
    }
  };

  const loadMore = () => load(offset + PAGE_SIZE, true);

  const showEditor = creating || selected;
  const hasMore = items.length < total;
  const selectedCount = selectedIds.size;

  const viewTabs = useMemo(() => [
    { id: 'active', label: t('notes.viewActive'), tip: 'tips.viewActive' },
    { id: 'archived', label: t('notes.viewArchived'), tip: 'tips.viewArchived' },
  ], [t]);

  return (
    <div className="notes-page">
      <aside className="sidebar">
        <div className="view-tabs">
          {viewTabs.map((tab) => (
            <button
              key={tab.id}
              className={`view-tab${view === tab.id ? ' active' : ''}`}
              onClick={() => { setView(tab.id); setSelected(null); setCreating(false); }}
              title={t(tab.tip)}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="controls">
          <input
            ref={searchRef}
            className="search"
            placeholder={t('notes.search')}
            title={t('tips.search')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {!bulkMode && (
            <button
              className="btn btn-primary"
              onClick={() => { setCreating(true); setSelected(null); }}
              title={t('tips.newNote')}
            >
              {t('notes.new')}
            </button>
          )}
        </div>
        <div className="bulk-bar">
          <button
            className={`link-button ${bulkMode ? 'active' : ''}`}
            onClick={toggleBulk}
            title={t(bulkMode ? 'tips.cancelSelect' : 'tips.selectMode')}
          >
            {bulkMode ? t('notes.cancelSelect') : t('notes.selectMode')}
          </button>
          {bulkMode && (
            <>
              <button className="link-button" onClick={selectAll} title={t('tips.selectAll')}>
                {t('notes.selectAll')}
              </button>
              <div className="spacer" />
              <button
                className="btn btn-danger"
                onClick={bulkDelete}
                disabled={selectedCount === 0}
                title={t('tips.deleteSelected')}
              >
                {t('notes.deleteSelected', { count: selectedCount })}
              </button>
            </>
          )}
        </div>
        <TagFilter tags={tags} active={activeTag} onChange={setActiveTag} />
        <NoteList
          notes={items}
          selectedId={selected?.id}
          onSelect={(n) => { setSelected(n); setCreating(false); }}
          bulkMode={bulkMode}
          selectedIds={selectedIds}
          onToggleSelect={toggleSelect}
        />
        {hasMore && (
          <button className="btn btn-ghost load-more" onClick={loadMore} title={t('tips.loadMore')}>
            {t('notes.loadMore')} ({items.length} {t('notes.of')} {total})
          </button>
        )}
      </aside>
      <section className="content-pane">
        {error && <div className="error" style={{ marginBottom: '0.75rem' }}>{error}</div>}
        {showEditor ? (
          <NoteEditor
            ref={editorRef}
            note={creating ? null : selected}
            onSave={onSave}
            onCancel={() => { setCreating(false); setSelected(null); }}
            onDelete={onDelete}
            onPin={onPin}
            onArchive={onArchive}
            reminderPrefs={reminderPrefs}
            reminderPrefsFailed={reminderPrefsFailed}
          />
        ) : (
          <div className="empty-state">
            <div className="empty-state-icon">📝</div>
            <h3>{t('notes.nothingSelected')}</h3>
            <p>{t('notes.pickOrCreate')}</p>
          </div>
        )}
      </section>
    </div>
  );
}
