import { useMemo } from 'react';

import { LANGS, selectLang, usePrefsStore } from './stores/prefsStore.js';
import { MESSAGES, translate } from './messages.js';

// Re-exported so callers keep importing these from the i18n module they already use.
export { LANGS, MESSAGES, translate };

/**
 * Same shape as before — `{ lang, setLang, t }` — so none of the 14 call sites change.
 *
 * The two selectors return a string and a stable action, never a fresh object: a selector building
 * `{ lang, setLang, t }` would hand zustand a new reference on every render and turn this into
 * "Maximum update depth exceeded" rather than a wasted render.
 */
export function useLang() {
  const lang = usePrefsStore(selectLang);
  const setLang = usePrefsStore((s) => s.setLang);
  const t = useMemo(() => (key, vars) => translate(lang, key, vars), [lang]);
  return { lang, setLang, t };
}

/**
 * Sets `<html lang>` once and follows changes.
 *
 * Called before the first render for the same reason `initTheme()` is: `subscribe` fires only on a
 * change, so a subscription alone would leave the attribute at its initial value until the user
 * switched languages.
 *
 * Returns a teardown, for the same reason `initTheme()` does: the app keeps the subscription for the
 * life of the page, tests do not.
 */
export function initLang() {
  const apply = (lang) => document.documentElement.setAttribute('lang', lang);
  apply(selectLang(usePrefsStore.getState()));
  return usePrefsStore.subscribe((state, previous) => {
    if (state.lang !== previous.lang) apply(selectLang(state));
  });
}
