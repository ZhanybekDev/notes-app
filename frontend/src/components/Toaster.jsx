import { useEffect, useState } from 'react';

import { useLang } from '../i18n.jsx';
import { useUiStore } from '../stores/uiStore.js';

// Long enough to read, short enough not to sit in the way. Errors get twice as long because they
// carry something the reader may need to act on.
const STATUS_MS = 4000;
const ERROR_MS = 8000;

function Toast({ toast, onDismiss, onHold, onRelease }) {
  const { t } = useLang();
  const [paused, setPaused] = useState(false);

  const hold = () => {
    setPaused(true);
    onHold(toast.id);
  };

  const release = () => {
    setPaused(false);
    onRelease(toast.id);
  };

  // Held state lives in the store so eviction can respect it, so it has to be given back on unmount —
  // a toast dismissed while hovered would otherwise leave its id marked as held forever.
  useEffect(() => () => onRelease(toast.id), [toast.id, onRelease]);

  useEffect(() => {
    if (paused) return undefined;
    const ms = toast.kind === 'error' ? ERROR_MS : STATUS_MS;
    const timer = setTimeout(() => onDismiss(toast.id), ms);
    return () => clearTimeout(timer);
    // `renewals` is in here deliberately: a repeat of the same message bumps that counter, which
    // restarts this countdown without the banner unmounting and reappearing.
  }, [toast.id, toast.kind, toast.renewals, paused, onDismiss]);

  return (
    <div
      className={`toast toast-${toast.kind}`}
      onMouseEnter={hold}
      onMouseLeave={release}
      onFocus={hold}
      onBlur={release}
    >
      <span className="toast-text">{toast.message}</span>
      <button
        type="button"
        className="toast-close"
        onClick={() => onDismiss(toast.id)}
        aria-label={t('toast.close')}
      >
        ×
      </button>
    </div>
  );
}

/**
 * Toast host.
 *
 * Two live regions, not one, and both always in the DOM. A region created together with its message
 * is not announced — a screen reader watches regions that already exist — and putting the role on
 * the toast inside a region gives nested live regions, which announces twice or not at all. So the
 * empty `role="status"` and `role="alert"` containers wait here, and a toast joins whichever matches
 * its kind. The toasts themselves carry no role.
 *
 * Visually this is one stack: both regions sit inside a single positioned parent, otherwise
 * successes and failures would surface in two different corners of the screen. The split is for the
 * screen reader, not the eye.
 *
 * Focus is never moved here (WCAG 4.1.3): a toast that steals focus interrupts whatever the person
 * was typing.
 */
export default function Toaster() {
  const toasts = useUiStore((s) => s.toasts);
  const dismiss = useUiStore((s) => s.dismiss);
  const hold = useUiStore((s) => s.hold);
  const release = useUiStore((s) => s.release);

  const polite = toasts.filter((toast) => toast.kind !== 'error');
  const assertive = toasts.filter((toast) => toast.kind === 'error');

  return (
    <div className="toaster">
      <div className="toast-region" role="status" data-testid="toast-region-status">
        {polite.map((toast) => (
          <Toast key={toast.id} toast={toast} onDismiss={dismiss} onHold={hold} onRelease={release} />
        ))}
      </div>
      <div className="toast-region" role="alert" data-testid="toast-region-alert">
        {assertive.map((toast) => (
          <Toast key={toast.id} toast={toast} onDismiss={dismiss} onHold={hold} onRelease={release} />
        ))}
      </div>
    </div>
  );
}
