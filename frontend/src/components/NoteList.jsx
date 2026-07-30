import LoadFailure from './LoadFailure.jsx';
import { useLang } from '../i18n.jsx';

export default function NoteList({
  notes,
  selectedId,
  onSelect,
  bulkMode = false,
  selectedIds = new Set(),
  onToggleSelect,
  filtered = false,
  archivedView = false,
  failed = false,
  pending = false,
  onRetry,
}) {
  const { t } = useLang();

  // A failed load has no notes either, and without its own branch it would render as "no notes yet" —
  // a lie about the data. The toast reports the event and leaves; this block holds the state.
  if (failed && !notes.length) {
    return <LoadFailure onRetry={onRetry} />;
  }

  // Nothing is known yet, so nothing is claimed. Every one of the branches below is a statement about
  // the server's answer, and until the first answer arrives — or during the 300ms the skeleton waits
  // out on a retry — the honest output is empty space.
  if (pending && !notes.length) {
    return null;
  }

  if (!notes.length) {
    // Three ways to have nothing to show, and the user needs to know which one:
    // a query that matched nothing, an empty archive, and an account with no notes.
    return (
      <div className="list-empty">
        {filtered ? (
          <>
            <p className="list-empty-title">{t('notes.noMatchTitle')}</p>
            <p className="list-empty-hint">{t('notes.noMatchHint')}</p>
          </>
        ) : archivedView ? (
          <p className="list-empty-title">{t('notes.emptyArchive')}</p>
        ) : (
          <>
            <p className="list-empty-title">{t('notes.emptyTitle')}</p>
            <p className="list-empty-hint">{t('notes.emptyHint')}</p>
          </>
        )}
      </div>
    );
  }
  return (
    <ul className="note-list">
      {notes.map((n) => {
        const isSelected = n.id === selectedId;
        const isChecked = selectedIds.has(n.id);
        const isPinned = Boolean(n.pinned_at);
        const isArchived = Boolean(n.archived_at);
        const classes = [
          'note-item',
          isSelected ? 'selected' : '',
          isArchived ? 'archived' : '',
          isChecked ? 'checked' : '',
        ].filter(Boolean).join(' ');

        const onClick = () => {
          if (bulkMode) onToggleSelect?.(n.id);
          else onSelect(n);
        };

        return (
          <li key={n.id} className={classes} onClick={onClick}>
            {bulkMode && (
              <input
                type="checkbox"
                checked={isChecked}
                onChange={() => onToggleSelect?.(n.id)}
                onClick={(e) => e.stopPropagation()}
                className="note-item-checkbox"
              />
            )}
            <div className="note-item-body">
              <div className="note-item-title">
                {isPinned && <span className="pin-ind" title={t('notes.pinned')}>📌</span>}
                {n.title}
              </div>
              <div className="note-item-meta">
                {n.note_date && <span className="date-pill">📅 {n.note_date}</span>}
                {(n.tags || []).slice(0, 3).map((tag) => (
                  <span key={tag} className="tag">#{tag}</span>
                ))}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
