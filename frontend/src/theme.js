import { usePrefsStore } from './stores/prefsStore.js';

function resolve(theme) {
  if (theme === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return theme;
}

export function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', resolve(theme));
}

/**
 * Applies the stored theme once, then follows changes.
 *
 * The first call is not decoration: `subscribe` fires only on a change, and this runs before
 * `createRoot().render()` deliberately. Without it the first frame would be light for everyone who
 * chose dark, and the theme would appear only after the next toggle.
 *
 * Returns a teardown. The app never calls it — both listeners live as long as the page — but tests
 * do, so repeated calls stop piling up subscriptions on a module-level store.
 */
export function initTheme() {
  applyTheme(usePrefsStore.getState().theme);

  const unsubscribe = usePrefsStore.subscribe((state, previous) => {
    if (state.theme !== previous.theme) applyTheme(state.theme);
  });

  const mql = window.matchMedia('(prefers-color-scheme: dark)');
  const onChange = () => {
    if (usePrefsStore.getState().theme === 'system') applyTheme('system');
  };
  if (mql.addEventListener) mql.addEventListener('change', onChange);
  else mql.addListener(onChange);

  return () => {
    unsubscribe();
    if (mql.removeEventListener) mql.removeEventListener('change', onChange);
    else mql.removeListener(onChange);
  };
}
