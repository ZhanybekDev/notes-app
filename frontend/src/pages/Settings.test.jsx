import { describe, expect, it, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

import Settings from './Settings.jsx';
import { LangProvider } from '../i18n.jsx';

const mocks = vi.hoisted(() => ({
  api: {
    getTelegramSettings: vi.fn(),
    generateTelegramLink: vi.fn(),
    updateTelegramSettings: vi.fn(),
    unlinkTelegram: vi.fn(),
    changePassword: vi.fn(),
    deleteAccount: vi.fn(),
  },
}));

vi.mock('../api.js', () => ({ api: mocks.api }));
vi.mock('../auth.js', () => ({ clearToken: vi.fn() }));

const { api } = mocks;

function renderSettings() {
  return render(
    <MemoryRouter>
      <LangProvider>
        <Settings />
      </LangProvider>
    </MemoryRouter>
  );
}

describe('Settings page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.changePassword.mockResolvedValue({ ok: true });
    api.deleteAccount.mockResolvedValue(null);
  });

  it('renders the Telegram card and loads its initial state', async () => {
    api.getTelegramSettings.mockResolvedValue({
      available: true,
      connected: false,
      telegram_username: null,
      notifications_enabled: false,
      link_code: null,
      link_code_expires_at: null,
    });

    renderSettings();

    expect(screen.getByText('Telegram notifications')).toBeInTheDocument();
    expect(await screen.findByText('Not connected')).toBeInTheDocument();
    expect(screen.getByText('Generate code')).toBeInTheDocument();
  });

  it('shows the unavailable state when the bot is disabled', async () => {
    api.getTelegramSettings.mockResolvedValue({
      available: false,
      connected: false,
      telegram_username: null,
      notifications_enabled: false,
      link_code: null,
      link_code_expires_at: null,
    });

    renderSettings();

    expect(await screen.findByText('Bot unavailable')).toBeInTheDocument();
    expect(
      screen.getByText('Telegram reminders are unavailable until TELEGRAM_BOT_TOKEN is configured.')
    ).toBeInTheDocument();
  });

  it('generates a link code and shows the Telegram instruction', async () => {
    const user = userEvent.setup();
    api.getTelegramSettings.mockResolvedValue({
      available: true,
      connected: false,
      telegram_username: null,
      notifications_enabled: false,
      link_code: null,
      link_code_expires_at: null,
    });
    api.generateTelegramLink.mockResolvedValue({
      available: true,
      connected: false,
      telegram_username: null,
      notifications_enabled: false,
      link_code: 'ABCD1234',
      link_code_expires_at: '2026-06-02T12:15:00Z',
    });

    renderSettings();
    await screen.findByText('Generate code');
    await user.click(screen.getByText('Generate code'));

    expect(api.generateTelegramLink).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('/start ABCD1234')).toBeInTheDocument();
    expect(screen.getByText('New Telegram link code generated.')).toBeInTheDocument();
  });

  it('shows connected state and updates the notification toggle', async () => {
    const user = userEvent.setup();
    api.getTelegramSettings.mockResolvedValue({
      available: true,
      connected: true,
      telegram_username: 'demo_user',
      notifications_enabled: false,
      link_code: null,
      link_code_expires_at: null,
    });
    api.updateTelegramSettings.mockResolvedValue({
      available: true,
      connected: true,
      telegram_username: 'demo_user',
      notifications_enabled: true,
      link_code: null,
      link_code_expires_at: null,
    });

    renderSettings();
    const checkbox = await screen.findByRole('checkbox', { name: 'Enable date reminders' });
    await user.click(checkbox);

    expect(api.updateTelegramSettings).toHaveBeenCalledWith(true);
    await waitFor(() => expect(checkbox).toBeChecked());
    expect(screen.getByText('Telegram reminder settings saved.')).toBeInTheDocument();
  });

  it('unlinks Telegram and updates the rendered state', async () => {
    const user = userEvent.setup();
    api.getTelegramSettings.mockResolvedValue({
      available: true,
      connected: true,
      telegram_username: 'demo_user',
      notifications_enabled: true,
      link_code: null,
      link_code_expires_at: null,
    });
    api.unlinkTelegram.mockResolvedValue({
      available: true,
      connected: false,
      telegram_username: null,
      notifications_enabled: false,
      link_code: null,
      link_code_expires_at: null,
    });

    renderSettings();
    await user.click(await screen.findByText('Unlink Telegram'));

    expect(api.unlinkTelegram).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('Not connected')).toBeInTheDocument();
  });

  it('renders inline Telegram API errors', async () => {
    const user = userEvent.setup();
    api.getTelegramSettings.mockResolvedValue({
      available: true,
      connected: false,
      telegram_username: null,
      notifications_enabled: false,
      link_code: null,
      link_code_expires_at: null,
    });
    api.generateTelegramLink.mockRejectedValue(new Error('boom'));

    renderSettings();
    await user.click(await screen.findByText('Generate code'));

    expect(await screen.findByText('boom')).toBeInTheDocument();
  });

  it('renders the RU Telegram copy through LangProvider', async () => {
    localStorage.setItem('notes_lang', 'ru');
    api.getTelegramSettings.mockResolvedValue({
      available: true,
      connected: false,
      telegram_username: null,
      notifications_enabled: false,
      link_code: null,
      link_code_expires_at: null,
    });

    renderSettings();

    expect(await screen.findByText('Уведомления в Telegram')).toBeInTheDocument();
    expect(screen.getByText('Сгенерировать код')).toBeInTheDocument();
  });
});
