import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';

import { api } from '../api.js';
import { SkeletonList } from '../components/Skeleton.jsx';
import { useDelayedFlag } from '../hooks/useDelayedFlag.js';
import { useLang } from '../i18n.jsx';

/**
 * A note opened by its share link.
 *
 * Outside `RequireAuth`, and outside the session entirely: the reader may have no account here.
 * Failures stay on this page rather than becoming toasts — a toast belongs to an app the reader is
 * working in, and this is one page they were sent to. There is nothing to retry into and nothing
 * else on screen to keep them company, so the failure is the page.
 */
export default function SharedNote() {
  const { token } = useParams();
  const { t } = useLang();
  const [note, setNote] = useState(null);
  const [status, setStatus] = useState('loading'); // loading | ready | missing
  const showSkeleton = useDelayedFlag(status === 'loading');

  useEffect(() => {
    let alive = true;
    setStatus('loading');
    api
      .publicNote(token)
      .then((data) => {
        if (!alive) return;
        setNote(data);
        setStatus('ready');
      })
      .catch(() => {
        // Every rejection is the same page. The server deliberately answers a revoked link, an
        // archived note and a token that never existed identically, and repeating that distinction
        // here would undo it.
        if (alive) setStatus('missing');
      });
    return () => { alive = false; };
  }, [token]);

  if (status === 'missing') {
    return (
      <div className="shared-page">
        <div className="shared-empty">
          <h1>{t('share.notFound')}</h1>
          <p className="list-empty-hint">{t('share.notFoundHint')}</p>
          <Link className="btn btn-ghost" to="/notes">{t('share.openApp')}</Link>
        </div>
      </div>
    );
  }

  if (status === 'loading') {
    return <div className="shared-page">{showSkeleton ? <SkeletonList rows={4} /> : null}</div>;
  }

  return (
    <div className="shared-page">
      <article className="shared-note">
        <p className="shared-badge">{t('share.readOnly')}</p>
        <h1>{note.title}</h1>
        <div className="shared-meta">
          {note.note_date && <span className="date-pill">📅 {note.note_date}</span>}
          {note.tags.map((tag) => (
            <span key={tag} className="tag">#{tag}</span>
          ))}
        </div>
        <div className="preview">
          <ReactMarkdown>{note.content}</ReactMarkdown>
        </div>
      </article>
    </div>
  );
}
