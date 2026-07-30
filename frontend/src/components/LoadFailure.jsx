import { useLang } from '../i18n.jsx';

/**
 * What stays on screen after a load fails.
 *
 * The toast that reported the failure leaves; this does not. Three places need exactly the same
 * thing — the notes list, the calendar grid and the notes of one day — and they need it to look the
 * same, because it says the same thing.
 */
export default function LoadFailure({ onRetry }) {
  const { t } = useLang();
  return (
    <div className="list-error">
      <p className="list-empty-title">{t('notes.loadFailedTitle')}</p>
      <p className="list-empty-hint">{t('notes.loadFailedHint')}</p>
      <button type="button" className="btn btn-ghost" onClick={onRetry}>
        {t('notes.retry')}
      </button>
    </div>
  );
}
