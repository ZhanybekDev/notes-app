import BusyButton from './BusyButton.jsx';
import { useLang } from '../i18n.jsx';
import { useUiStore } from '../stores/uiStore.js';

/** The address a reader would open. Built here rather than on the server: the server has no idea
 *  which host the app is served from, and guessing it in a config would be one more thing to keep
 *  in sync with reality. */
export function shareUrl(token) {
  return `${window.location.origin}/s/${token}`;
}

/**
 * The owner's half of sharing: publish a link, copy it, take it back.
 *
 * Presentational — it renders the token it is given and calls out for the two actions, because
 * `docs/architecture.md` keeps fetching in pages and stores. Copying stays here: the clipboard is a
 * browser API, not a request, and threading it through two components would buy nothing.
 *
 * `token` is read on every render rather than seeded into state, so switching notes in the editor
 * cannot leave the previous note's link on screen.
 */
export default function ShareControl({ token, busy = null, onShare, onRevoke }) {
  const { t } = useLang();
  const notify = useUiStore((s) => s.notify);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl(token));
      notify(t('share.copied'), 'status');
    } catch {
      // Clipboard access is refused in plenty of ordinary situations — an insecure origin, a
      // permission the reader declined. The link goes on screen instead, and as an error rather
      // than a notice: an error toast lasts twice as long, and this one has to be read and copied
      // by hand.
      notify(shareUrl(token), 'error');
    }
  };

  if (!token) {
    return (
      <BusyButton
        type="button"
        className="btn btn-ghost btn-sm"
        onClick={onShare}
        busy={busy === 'share'}
        title={t('share.hint')}
      >
        {t('share.action')}
      </BusyButton>
    );
  }

  return (
    <div className="share-live">
      <span className="share-badge">{t('share.shared')}</span>
      <button type="button" className="link-button" onClick={copy}>
        {t('share.copy')}
      </button>
      <BusyButton
        type="button"
        className="link-button"
        onClick={onRevoke}
        busy={busy === 'unshare'}
      >
        {t('share.revoke')}
      </BusyButton>
    </div>
  );
}
