/**
 * The single place that touches `localStorage` after the state migration.
 *
 * Nothing here throws. A browser can refuse storage entirely — Safari's private mode, an enterprise
 * policy, site data switched off — and `persist` hydrates at module import, before the first render:
 * an exception there would take the whole app down instead of one preference. Failing soft keeps the
 * app running with state that lives for the session only.
 *
 * Soft does not mean silent. The first failure logs once and flips a flag the stores expose, so the
 * degradation is visible to code and to tests rather than being swallowed.
 */
let available = true;
let warned = false;
const listeners = new Set();

function unavailable(operation, key, error) {
  const firstFailure = available;
  available = false;
  if (!warned) {
    warned = true;
    console.warn(
      `localStorage unavailable while ${operation} "${key}" — state will not survive a reload`,
      error,
    );
  }
  // Pushed rather than polled: `persist` writes *after* the store's own `set`, so a store asking
  // `isAvailable()` inside its action would still see the state from before the failed write.
  //
  // Only on the first failure. A listener flips state in a persisted store, that write fails too,
  // and notifying again would recurse until the stack gave out.
  if (firstFailure) {
    for (const listener of listeners) listener();
  }
}

/** Called the moment storage first refuses. Returns an unsubscribe function. */
export function onUnavailable(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function read(key) {
  try {
    return localStorage.getItem(key);
  } catch (error) {
    unavailable('reading', key, error);
    return null;
  }
}

export function write(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch (error) {
    unavailable('writing', key, error);
  }
}

export function remove(key) {
  try {
    localStorage.removeItem(key);
  } catch (error) {
    unavailable('removing', key, error);
  }
}

export function isAvailable() {
  return available;
}

/** Part of the reset infrastructure `resetStores()` drives, not a test-only escape hatch. */
export function resetAvailability() {
  available = true;
  warned = false;
}
