import { useCallback, useEffect, useMemo, useRef } from 'react';
import NoteList from '../components/NoteList.jsx';
import NoteEditor from '../components/NoteEditor.jsx';
import TagFilter from '../components/TagFilter.jsx';
import { SkeletonList } from '../components/Skeleton.jsx';
import { useDelayedFlag } from '../hooks/useDelayedFlag.js';
import { useLang } from '../i18n.jsx';
import { useAccountStore } from '../stores/accountStore.js';
import { useNotesStore } from '../stores/notesStore.js';

export default function Notes({ registerAction }) {
  const { t } = useLang();

  const items = useNotesStore((s) => s.items);
  const total = useNotesStore((s) => s.total);
  const tags = useNotesStore((s) => s.tags);
  const selected = useNotesStore((s) => s.selected);
  const creating = useNotesStore((s) => s.creating);
  const search = useNotesStore((s) => s.search);
  const activeTag = useNotesStore((s) => s.activeTag);
  const view = useNotesStore((s) => s.view);
  const bulkMode = useNotesStore((s) => s.bulkMode);
  const selectedIds = useNotesStore((s) => s.selectedIds);
  const status = useNotesStore((s) => s.status);
  const loaded = useNotesStore((s) => s.loaded);

  const load = useNotesStore((s) => s.load);
  const loadMore = useNotesStore((s) => s.loadMore);
  const setSearch = useNotesStore((s) => s.setSearch);
  const setActiveTag = useNotesStore((s) => s.setActiveTag);
  const setView = useNotesStore((s) => s.setView);
  const select = useNotesStore((s) => s.select);
  const startCreating = useNotesStore((s) => s.startCreating);
  const cancel = useNotesStore((s) => s.cancel);
  const save = useNotesStore((s) => s.save);
  const remove = useNotesStore((s) => s.remove);
  const setPin = useNotesStore((s) => s.setPin);
  const setArchive = useNotesStore((s) => s.setArchive);
  const removeSelected = useNotesStore((s) => s.bulkDelete);
  const toggleBulk = useNotesStore((s) => s.toggleBulk);
  const toggleSelect = useNotesStore((s) => s.toggleSelect);
  const selectAll = useNotesStore((s) => s.selectAll);

  // Read here rather than in NoteEditor: components stay presentational, pages fetch. "Still
  // loading" (null) and "could not load" are different states — the hint by the date field stays
  // quiet in the first case and explains itself in the second.
  const reminderPrefs = useAccountStore((s) => s.prefs);
  const reminderPrefsFailed = useAccountStore((s) => s.status === 'error');
  const loadPrefs = useAccountStore((s) => s.load);

  // Failures reach the reader as a toast; what stays on screen is the list's own state.
  const failed = status === 'error';
  const pending = !loaded;
  const showSkeleton = useDelayedFlag(status === 'loading');
  const retry = useCallback(() => load(0, false), [load]);

  const searchRef = useRef(null);
  const editorRef = useRef(null);

  useEffect(() => {
    load(0, false);
  }, [load]);

  useEffect(() => {
    loadPrefs();
  }, [loadPrefs]);

  useEffect(() => {
    registerAction?.('newNote', startCreating);
    registerAction?.('focusSearch', () => searchRef.current?.focus());
    registerAction?.('save', () => editorRef.current?.submit());
    return () => {
      registerAction?.('newNote', null);
      registerAction?.('focusSearch', null);
      registerAction?.('save', null);
    };
  }, [registerAction, startCreating]);

  const bulkDelete = () => {
    const count = selectedIds.size;
    if (count === 0) return;
    if (!window.confirm(t('notes.confirmBulkDelete', { count }))) return;
    removeSelected([...selectedIds]);
  };

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
              onClick={() => setView(tab.id)}
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
              onClick={startCreating}
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
              <button
                className="link-button"
                onClick={selectAll}
                title={t('tips.selectAll')}
              >
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
        {showSkeleton ? (
          <SkeletonList />
        ) : (
          <NoteList
            notes={items}
            selectedId={selected?.id}
            onSelect={select}
            bulkMode={bulkMode}
            selectedIds={selectedIds}
            onToggleSelect={toggleSelect}
            filtered={Boolean(search || activeTag)}
            archivedView={view === 'archived'}
            failed={failed}
            pending={pending}
            onRetry={retry}
          />
        )}
        {hasMore && (
          <button className="btn btn-ghost load-more" onClick={loadMore} title={t('tips.loadMore')}>
            {t('notes.loadMore')} ({items.length} {t('notes.of')} {total})
          </button>
        )}
      </aside>
      <section className="content-pane">
        {showEditor ? (
          <NoteEditor
            ref={editorRef}
            note={creating ? null : selected}
            onSave={save}
            onCancel={cancel}
            onDelete={remove}
            onPin={setPin}
            onArchive={setArchive}
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
