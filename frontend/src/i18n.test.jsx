import { describe, expect, it } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { LangProvider, useLang } from './i18n.jsx';

function Probe() {
  const { lang, setLang, t } = useLang();
  return (
    <div>
      <span data-testid="lang">{lang}</span>
      <span data-testid="title">{t('auth.loginTitle')}</span>
      <span data-testid="count">{t('notes.deleteSelected', { count: 3 })}</span>
      <span data-testid="tg">{t('settings.telegramTitle')}</span>
      <span data-testid="exp">{t('settings.exportAll')}</span>
      <button onClick={() => setLang('ru')}>switch</button>
    </div>
  );
}

describe('i18n', () => {
  it('resolves English strings by default', () => {
    render(
      <LangProvider>
        <Probe />
      </LangProvider>
    );
    expect(screen.getByTestId('lang')).toHaveTextContent('en');
    expect(screen.getByTestId('title')).toHaveTextContent('Welcome back');
  });

  it('interpolates {count} placeholders', () => {
    render(
      <LangProvider>
        <Probe />
      </LangProvider>
    );
    expect(screen.getByTestId('count')).toHaveTextContent('Delete (3)');
  });

  it('switches language and persists to localStorage', async () => {
    const user = userEvent.setup();
    render(
      <LangProvider>
        <Probe />
      </LangProvider>
    );
    await act(() => user.click(screen.getByText('switch')));
    expect(screen.getByTestId('lang')).toHaveTextContent('ru');
    expect(screen.getByTestId('title')).toHaveTextContent('С возвращением');
    expect(localStorage.getItem('notes_lang')).toBe('ru');
  });

  it('has the new telegram + export strings in both EN and RU', async () => {
    const user = userEvent.setup();
    render(
      <LangProvider>
        <Probe />
      </LangProvider>
    );
    expect(screen.getByTestId('tg')).toHaveTextContent('Telegram reminders');
    expect(screen.getByTestId('exp')).toHaveTextContent('Export all (.zip)');
    await act(() => user.click(screen.getByText('switch')));
    expect(screen.getByTestId('tg')).toHaveTextContent('Напоминания в Telegram');
    expect(screen.getByTestId('exp')).toHaveTextContent('Экспортировать всё (.zip)');
  });
});
