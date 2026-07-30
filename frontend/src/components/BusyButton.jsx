/**
 * A button that shows its own request.
 *
 * While `busy` it is disabled and marked `aria-busy`, which does two jobs at once: the reader gets a
 * spinner where the action is instead of somewhere else on the page, and a second click cannot start
 * a second request. The label stays put — swapping it for "Saving…" moves everything around it and
 * loses the word the reader was aiming at.
 */
export default function BusyButton({ busy = false, disabled = false, className = '', children, ...rest }) {
  return (
    <button
      {...rest}
      className={`${className}${busy ? ' is-busy' : ''}`.trim()}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
    >
      {/* The label keeps its space while the spinner sits over it: hiding it outright, or appending
          the spinner beside it, would resize the button under the cursor that just pressed it. */}
      <span className="btn-label">{children}</span>
      {busy && <span className="btn-spinner" aria-hidden="true" />}
    </button>
  );
}
