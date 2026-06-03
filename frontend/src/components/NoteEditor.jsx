import { useEffect, useImperativeHandle, useRef, useState, forwardRef } from 'react';
import ReactMarkdown from 'react-markdown';
import MarkdownToolbar from './MarkdownToolbar.jsx';
import { api } from '../api.js';
import { useLang } from '../i18n.jsx';

function emptyNote() {
  return { title: '', content: '', tags: [], note_date: null, pinned_at: null, archived_at: null };
}

const NoteEditor = forwardRef(function NoteEditor(
  { note, onSave, onCancel, onDelete, onPin, onArchive },
  ref,
) {
  const { t } = useLang();
  const [draft, setDraft] = useState(emptyNote());
  const [tagsInput, setTagsInput] = useState('');
  const [exportError, setExportError] = useState(null);
  const [shareToken, setShareToken] = useState(null);
  const [copied, setCopied] = useState(false);
  const formRef = useRef(null);
  const contentRef = useRef(null);

  const exportMd = async () => {
    setExportError(null);
    try {
      await api.exportNote(note.id);
    } catch (err) {
      setExportError(err.message);
    }
  };

  const doShare = async () => {
    setExportError(null);
    try {
      const { token } = await api.shareNote(note.id);
      setShareToken(token);
      setCopied(false);
    } catch (err) {
      setExportError(err.message);
    }
  };

  const doUnshare = async () => {
    setExportError(null);
    try {
      await api.unshareNote(note.id);
      setShareToken(null);
      setCopied(false);
    } catch (err) {
      setExportError(err.message);
    }
  };

  const shareUrl = shareToken ? `${window.location.origin}/share/${shareToken}` : '';
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
    } catch {
      // clipboard may be unavailable; the link is visible to copy manually.
    }
  };

  useEffect(() => {
    if (note) {
      setDraft({ ...note });
      setTagsInput((note.tags || []).join(', '));
      setShareToken(note.public_token ?? null);
    } else {
      setDraft(emptyNote());
      setTagsInput('');
      setShareToken(null);
    }
    setCopied(false);
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
              title={isPinned ? t('editor.unpin') : t('editor.pin')}
              onClick={() => onPin?.(note, !isPinned)}
            >
              {isPinned ? '📌' : '📍'}
            </button>
            <button
              type="button"
              className={`flag-btn ${isArchived ? 'on' : ''}`}
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
      {isPersisted && (
        <div className="share-row">
          {shareToken ? (
            <>
              <span className="share-label">{t('editor.publicLink')}:</span>
              <a className="share-url" href={`/share/${shareToken}`} target="_blank" rel="noreferrer">
                {shareUrl}
              </a>
              <button type="button" className="btn btn-ghost" onClick={copyLink}>
                {copied ? t('editor.copied') : t('editor.copy')}
              </button>
              <button type="button" className="btn btn-ghost" onClick={doUnshare}>
                {t('editor.unshare')}
              </button>
            </>
          ) : (
            <button type="button" className="btn btn-ghost" onClick={doShare}>
              {t('editor.share')}
            </button>
          )}
        </div>
      )}
      <div className="actions">
        <button type="submit" className="btn btn-primary">{t('editor.save')}</button>
        {onCancel && <button type="button" className="btn btn-ghost" onClick={onCancel}>{t('editor.cancel')}</button>}
        {isPersisted && (
          <button type="button" className="btn btn-ghost" onClick={exportMd}>
            {t('editor.exportMd')}
          </button>
        )}
        {exportError && <div className="error">{exportError}</div>}
        <div className="spacer" />
        {note && onDelete && (
          <button
            type="button"
            className="btn btn-danger"
            onClick={() => {
              if (window.confirm(t('editor.confirmDelete'))) onDelete(note.id);
            }}
          >
            {t('editor.delete')}
          </button>
        )}
      </div>
    </form>
  );
});

export default NoteEditor;
