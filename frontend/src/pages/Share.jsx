import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import { api } from '../api.js';
import { useLang } from '../i18n.jsx';

export default function Share() {
  const { token } = useParams();
  const { t } = useLang();
  const [note, setNote] = useState(null);
  const [state, setState] = useState('loading'); // loading | ok | notfound

  useEffect(() => {
    let active = true;
    api
      .getSharedNote(token)
      .then((n) => active && (setNote(n), setState('ok')))
      .catch(() => active && setState('notfound'));
    return () => {
      active = false;
    };
  }, [token]);

  if (state === 'loading') {
    return (
      <div className="share-page">
        <p>{t('share.loading')}</p>
      </div>
    );
  }
  if (state === 'notfound') {
    return (
      <div className="share-page">
        <p className="error">{t('share.notFound')}</p>
      </div>
    );
  }

  return (
    <div className="share-page">
      <div className="share-badge">{t('share.readOnly')}</div>
      <h1>{note.title}</h1>
      {note.note_date && <p className="share-date">{note.note_date}</p>}
      <article className="preview">
        <ReactMarkdown>{note.content || ''}</ReactMarkdown>
      </article>
    </div>
  );
}
