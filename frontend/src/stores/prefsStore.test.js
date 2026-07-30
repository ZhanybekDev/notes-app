import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { KEYS, usePrefsStore } from './prefsStore.js';

const store = () => usePrefsStore.getState();

describe('preferences land in the legacy keys, one value each', () => {
  it('writes bare values, not a JSON envelope', () => {
    store().setLang('ru');
    store().setTheme('dark');
    store().dismissTzSuggestion();

    expect(localStorage.getItem(KEYS.lang)).toBe('ru');
    expect(localStorage.getItem(KEYS.theme)).toBe('dark');
    expect(localStorage.getItem(KEYS.tzSuggestionDismissed)).toBe('1');
    // Three entries, not one — persist's single-name model does not survive here.
    expect(localStorage.getItem('notes_prefs')).toBeNull();
  });

  it('hydrates from what the previous version left behind', () => {
    localStorage.setItem(KEYS.lang, 'ru');
    localStorage.setItem(KEYS.theme, 'dark');
    localStorage.setItem(KEYS.tzSuggestionDismissed, '1');

    usePrefsStore.persist.rehydrate();

    expect(store().lang).toBe('ru');
    expect(store().theme).toBe('dark');
    expect(store().tzSuggestionDismissed).toBe(true);
  });

  it('ignores stored values it does not recognise', () => {
    localStorage.setItem(KEYS.lang, 'kk');
    localStorage.setItem(KEYS.theme, 'neon');

    usePrefsStore.persist.rehydrate();

    expect(store().lang).toBe('en');
    expect(store().theme).toBe('system');
  });

  it('clears the dismissal key rather than writing a falsy value', () => {
    store().dismissTzSuggestion();
    expect(localStorage.getItem(KEYS.tzSuggestionDismissed)).toBe('1');

    usePrefsStore.setState({ tzSuggestionDismissed: false });
    expect(localStorage.getItem(KEYS.tzSuggestionDismissed)).toBeNull();
  });
});

describe('defaults', () => {
  const original = navigator.language;

  afterEach(() => {
    Object.defineProperty(navigator, 'language', { value: original, configurable: true });
  });

  function reloadWithLanguage(language) {
    Object.defineProperty(navigator, 'language', { value: language, configurable: true });
    // The default is computed when the module initialises, so the module has to be re-imported.
    vi.resetModules();
    return import('./prefsStore.js');
  }

  it('follows the browser language when nothing is stored', async () => {
    const { usePrefsStore: fresh } = await reloadWithLanguage('ru-RU');
    expect(fresh.getState().lang).toBe('ru');
  });

  it('falls back to English for a language we do not have', async () => {
    const { usePrefsStore: fresh } = await reloadWithLanguage('de-DE');
    expect(fresh.getState().lang).toBe('en');
  });

  it('rejects a language outside the catalogue', () => {
    store().setLang('kk');
    expect(store().lang).toBe('en');
  });
});

describe('storage the browser refuses', () => {
  let warn;

  beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const boom = () => {
      throw new DOMException('denied', 'SecurityError');
    };
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(boom);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(boom);
  });

  it('keeps language and theme in memory instead of breaking the app', () => {
    expect(() => usePrefsStore.persist.rehydrate()).not.toThrow();
    expect(() => store().setLang('ru')).not.toThrow();
    expect(() => store().setTheme('dark')).not.toThrow();

    expect(store().lang).toBe('ru');
    expect(store().theme).toBe('dark');
    expect(warn).toHaveBeenCalled();
  });
});
