import { describe, expect, it } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { MESSAGES, initLang, useLang } from './i18n.jsx';
import { usePrefsStore } from './stores/prefsStore.js';

function Probe() {
  const { lang, setLang, t } = useLang();
  return (
    <div>
      <span data-testid="lang">{lang}</span>
      <span data-testid="title">{t('auth.loginTitle')}</span>
      <span data-testid="count">{t('notes.deleteSelected', { count: 3 })}</span>
      <button onClick={() => setLang('ru')}>switch</button>
    </div>
  );
}

describe('i18n', () => {
  it('resolves English strings by default', () => {
    render(<Probe />);
    expect(screen.getByTestId('lang')).toHaveTextContent('en');
    expect(screen.getByTestId('title')).toHaveTextContent('Welcome back');
  });

  it('interpolates {count} placeholders', () => {
    render(<Probe />);
    expect(screen.getByTestId('count')).toHaveTextContent('Delete (3)');
  });

  it('switches language and persists to localStorage', async () => {
    const user = userEvent.setup();
    render(<Probe />);
    await act(() => user.click(screen.getByText('switch')));
    expect(screen.getByTestId('lang')).toHaveTextContent('ru');
    expect(screen.getByTestId('title')).toHaveTextContent('С возвращением');
    expect(localStorage.getItem('notes_lang')).toBe('ru');
  });
});

describe('translation catalogue', () => {
  const paths = (node, prefix = '') =>
    Object.entries(node).flatMap(([key, value]) =>
      value && typeof value === 'object' && !Array.isArray(value)
        ? paths(value, `${prefix}${key}.`)
        : [`${prefix}${key}`]
    );

  it('has the same keys in every language', () => {
    // The Definition of Done asks for every string in EN and RU, and nothing enforced it: a
    // forgotten translation silently fell through to English at runtime.
    const en = paths(MESSAGES.en);
    const ru = paths(MESSAGES.ru);

    expect(new Set(ru)).toEqual(new Set(en));
  });

  it('leaves no translation blank', () => {
    const blank = Object.entries(MESSAGES).flatMap(([lang, catalogue]) =>
      paths(catalogue)
        .filter((key) => {
          const value = key.split('.').reduce((node, part) => node[part], catalogue);
          return typeof value === 'string' && !value.trim();
        })
        .map((key) => `${lang}.${key}`)
    );

    expect(blank).toEqual([]);
  });
});

describe('initLang', () => {
  it('sets <html lang> before anything changes', () => {
    usePrefsStore.setState({ lang: 'ru' });
    document.documentElement.removeAttribute('lang');

    initLang();

    expect(document.documentElement.getAttribute('lang')).toBe('ru');
  });

  it('follows a later switch', () => {
    initLang();
    expect(document.documentElement.getAttribute('lang')).toBe('en');

    usePrefsStore.getState().setLang('ru');
    expect(document.documentElement.getAttribute('lang')).toBe('ru');
  });
});
