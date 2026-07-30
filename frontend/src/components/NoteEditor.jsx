import { useEffect, useImperativeHandle, useRef, useState, forwardRef } from 'react';
import { Link } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import BusyButton from './BusyButton.jsx';
import MarkdownToolbar from './MarkdownToolbar.jsx';
import { useLang } from '../i18n.jsx';
import {
  REMINDER_OFF,
  REMINDER_PASSED,
  REMINDER_SCHEDULED,
  formatNoteDate,
  reminderStatus,
} from '../reminderStatus.js';

function emptyNote() {
  return { title: '', content: '', tags: [], note_date: null, pinned_at: null, archived_at: null };
}

const NoteEditor = forwardRef(function NoteEditor(
  {
    note, onSave, onCancel, onDelete, onPin, onArchive, reminderPrefs, reminderPrefsFailed,
    saving = false, deleting = false, flagBusy = false,
  },
  ref,
) {
  const { lang, t } = useLang();
  const [draft, setDraft] = useState(emptyNote());
  const [tagsInput, setTagsInput] = useState('');
  const formRef = useRef(null);
  const contentRef = useRef(null);

  useEffect(() => {
    if (note) {
      setDraft({ ...note });
      setTagsInput((note.tags || []).join(', '));
    } else {
      setDraft(emptyNote());
      setTagsInput('');
    }
  }, [note]);

  useImperativeHandle(ref, () => ({
    submit: () => formRef.current?.requestSubmit(),
  }));

  const submit = (e) => {
    e.preventDefault();
    const tags = tagsInput
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    onSave({
      title: draft.title,
      content: draft.content,
      tags,
      note_date: draft.note_date || null,
    });
  };

  // One source of truth for the hint, so the failure and success cases cannot both render.
  let reminderHint = null;
  if (reminderPrefsFailed) {
    reminderHint = t('editor.reminderUnknown');
  } else {
    const status = reminderStatus(draft.note_date, reminderPrefs);
    if (status?.kind === REMINDER_SCHEDULED) {
      reminderHint = t('editor.reminderScheduled', {
        date: formatNoteDate(status.date, lang),
        time: status.time,
      });
    } else if (status?.kind === REMINDER_PASSED) {
      reminderHint = t('editor.reminderPassed');
    } else if (status?.kind === REMINDER_OFF) {
      reminderHint = (
        <>
          {t('editor.reminderOff')} <Link to="/settings">{t('editor.reminderSettingsLink')}</Link>
        </>
      );
    }
  }

  const isPersisted = Boolean(note);
  const isPinned = Boolean(draft.pinned_at);
  const isArchived = Boolean(draft.archived_at);

  return (
    <form ref={formRef} className="editor" onSubmit={submit}>
      <div className="editor-head">
        <input
          className="title"
          placeholder={t('editor.untitled')}
          value={draft.title}
          onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          required
        />
        {isPersisted && (
          <div className="editor-flags">
            <button
              type="button"
              className={`flag-btn ${isPinned ? 'on' : ''}`}
              disabled={flagBusy}
              title={isPinned ? t('editor.unpin') : t('editor.pin')}
              onClick={() => onPin?.(note, !isPinned)}
            >
              {isPinned ? '📌' : '📍'}
            </button>
            <button
              type="button"
              className={`flag-btn ${isArchived ? 'on' : ''}`}
              disabled={flagBusy}
              title={isArchived ? t('editor.unarchive') : t('editor.archive')}
              onClick={() => onArchive?.(note, !isArchived)}
            >
              🗄
            </button>
          </div>
        )}
      </div>
      <div className="meta">
        <label>
          📅 {t('editor.date')}
          <input
            type="date"
            value={draft.note_date || ''}
            onChange={(e) => setDraft({ ...draft, note_date: e.target.value || null })}
          />
          {draft.note_date && reminderHint && (
            <span className={`reminder-hint${reminderPrefsFailed ? ' reminder-hint-failed' : ''}`}>
              {reminderHint}
            </span>
          )}
        </label>
        <label>
          🏷 {t('editor.tags')}
          <input
            value={tagsInput}
            onChange={(e) => setTagsInput(e.target.value)}
            placeholder={t('editor.tagsPlaceholder')}
          />
        </label>
      </div>
      <MarkdownToolbar textareaRef={contentRef} />
      <div className="split">
        <textarea
          ref={contentRef}
          className="content"
          placeholder={t('editor.writeHere')}
          value={draft.content}
          onChange={(e) => setDraft({ ...draft, content: e.target.value })}
        />
        <div className="preview">
          <ReactMarkdown>{draft.content || t('editor.previewEmpty')}</ReactMarkdown>
        </div>
      </div>
      <div className="actions">
        <BusyButton type="submit" className="btn btn-primary" busy={saving} title={t('tips.save')}>
          {t('editor.save')}
        </BusyButton>
        {onCancel && (
          <button
            type="button"
            className="btn btn-ghost"
            onClick={onCancel}
            title={t('tips.cancel')}
          >
            {t('editor.cancel')}
          </button>
        )}
        <div className="spacer" />
        {note && onDelete && (
          <BusyButton
            type="button"
            className="btn btn-danger"
            busy={deleting}
            title={t('tips.deleteNote')}
            onClick={() => {
              if (window.confirm(t('editor.confirmDelete'))) onDelete(note.id);
            }}
          >
            {t('editor.delete')}
          </BusyButton>
        )}
      </div>
    </form>
  );
});

export default NoteEditor;
