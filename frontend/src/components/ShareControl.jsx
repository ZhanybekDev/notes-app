import { useState } from 'react';

import BusyButton from './BusyButton.jsx';
import { api } from '../api.js';
import { useLang } from '../i18n.jsx';
import { reportFailure, useUiStore } from '../stores/uiStore.js';

/** The address a reader would open. Built here rather than on the server: the server has no idea
 *  which host the app is served from, and guessing it in a config would be one more thing to keep
 *  in sync with reality. */
function shareUrl(token) {
  return `${window.location.origin}/s/${token}`;
}

/**
 * The owner's half of sharing: publish a link, copy it, take it back.
 *
 * Local state rather than a store: nothing outside this note's editor needs to know, and the token
 * arrives from the note itself on the next load.
 */
export default function ShareControl({ noteId, token: initialToken }) {
  const { t } = useLang();
  const [token, setToken] = useState(initialToken ?? null);
  const [busy, setBusy] = useState(null); // 'share' | 'revoke' | 'copy'
  const notify = useUiStore((s) => s.notify);

  const share = async () => {
    if (busy) return;
    setBusy('share');
    try {
      const { share_token: fresh } = await api.shareNote(noteId);
      setToken(fresh);
    } catch (err) {
      reportFailure(err);
    } finally {
      setBusy(null);
    }
  };

  const revoke = async () => {
    if (busy) return;
    setBusy('revoke');
    try {
      await api.unshareNote(noteId);
      setToken(null);
      notify(t('share.revoked'), 'status');
    } catch (err) {
      reportFailure(err);
    } finally {
      setBusy(null);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl(token));
      notify(t('share.copied'), 'status');
    } catch {
      // Clipboard access is refused in plenty of ordinary situations — an insecure origin, a
      // permission the reader declined. The link is on screen either way, so this is a nuisance
      // rather than a failure, and it is not worth an alert.
      notify(shareUrl(token), 'status');
    }
  };

  if (!token) {
    return (
      <BusyButton
        type="button"
        className="btn btn-ghost btn-sm"
        onClick={share}
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
        onClick={revoke}
        busy={busy === 'revoke'}
      >
        {t('share.revoke')}
      </BusyButton>
    </div>
  );
}
