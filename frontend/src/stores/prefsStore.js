import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { read, remove, write } from './safeStorage.js';

export const LANGS = ['en', 'ru'];
export const THEMES = ['light', 'dark', 'system'];

// The same three keys the app has always used, so nobody's language or theme resets on deploy.
export const KEYS = {
  lang: 'notes_lang',
  theme: 'notes_theme',
  tzSuggestionDismissed: 'notes_tz_suggestion_dismissed',
};

/**
 * `persist` owns exactly one storage entry per store — one `name`, one value — so three legacy keys
 * do not fit its model at all. This adapter fans out instead: it assembles state from three reads
 * and writes it back to three keys, each holding the bare value it held before (`ru`, `dark`, `1`).
 *
 * Anything unrecognised is ignored rather than trusted, which is also how the old code behaved.
 */
const prefsStorage = {
  getItem: () => {
    const lang = read(KEYS.lang);
    const theme = read(KEYS.theme);
    const dismissed = read(KEYS.tzSuggestionDismissed);

    const state = {};
    if (LANGS.includes(lang)) state.lang = lang;
    if (THEMES.includes(theme)) state.theme = theme;
    if (dismissed === '1') state.tzSuggestionDismissed = true;

    return Object.keys(state).length > 0 ? { state, version: 0 } : null;
  },
  setItem: (_name, value) => {
    const { lang, theme, tzSuggestionDismissed } = value.state;
    // Only a language the user actually picked is written. Persisting the browser-derived default
    // would freeze it: someone whose browser later switches languages would keep the old one
    // forever, which is not how this behaved before the migration.
    if (lang) write(KEYS.lang, lang);
    write(KEYS.theme, theme);
    if (tzSuggestionDismissed) write(KEYS.tzSuggestionDismissed, '1');
    else remove(KEYS.tzSuggestionDismissed);
  },
  removeItem: () => {
    remove(KEYS.lang);
    remove(KEYS.theme);
    remove(KEYS.tzSuggestionDismissed);
  },
};

/**
 * Language of the browser, when we speak it.
 *
 * Not a constant `'en'`: a Russian-speaking visitor with empty storage used to get Russian, and
 * losing that would only ever be noticed by the people it affects.
 */
export function browserLang() {
  const browser = (navigator.language || 'en').slice(0, 2);
  return LANGS.includes(browser) ? browser : 'en';
}

/**
 * The language in force: what the user chose, or the browser's when they never did.
 *
 * Returns a string, so it is safe as a selector — an object built here would hand zustand a new
 * reference on every render.
 */
export const selectLang = (state) => state.lang ?? browserLang();

export const usePrefsStore = create(
  persist(
    (set) => ({
      // null means "never chosen" — read through `selectLang`, which falls back to the browser.
      lang: null,
      theme: 'system',
      tzSuggestionDismissed: false,

      setLang: (lang) => {
        if (LANGS.includes(lang)) set({ lang });
      },
      setTheme: (theme) => {
        if (THEMES.includes(theme)) set({ theme });
      },
      dismissTzSuggestion: () => set({ tzSuggestionDismissed: true }),
    }),
    {
      name: 'notes_prefs',
      storage: prefsStorage,
      partialize: ({ lang, theme, tzSuggestionDismissed }) => ({
        lang,
        theme,
        tzSuggestionDismissed,
      }),
    },
  ),
);
