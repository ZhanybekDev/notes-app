import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

import { LangProvider } from '../i18n.jsx';

vi.mock('../api.js', () => ({
  ApiError: class ApiError extends Error {},
  api: {
    getTelegramStatus: vi.fn(),
    linkTelegram: vi.fn(),
    unlinkTelegram: vi.fn(),
    setTelegramReminders: vi.fn(),
    setTimezone: vi.fn(),
    exportAllNotes: vi.fn(),
    changePassword: vi.fn(),
    deleteAccount: vi.fn(),
  },
}));

import { api } from '../api.js';
import Settings from './Settings.jsx';

function renderSettings() {
  return render(
    <LangProvider>
      <MemoryRouter>
        <Settings />
      </MemoryRouter>
    </LangProvider>,
  );
}

const status = (over = {}) => ({
  linked: false,
  enabled: false,
  timezone: 'UTC',
  bot_configured: true,
  link_url: null,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('Settings - Telegram', () => {
  it('renders the telegram section', async () => {
    api.getTelegramStatus.mockResolvedValue(status());
    renderSettings();
    expect(await screen.findByText('Telegram reminders')).toBeInTheDocument();
  });

  it('shows a not-configured message when the bot is off', async () => {
    api.getTelegramStatus.mockResolvedValue(status({ bot_configured: false }));
    renderSettings();
    expect(
      await screen.findByText('The Telegram bot is not configured on the server.'),
    ).toBeInTheDocument();
  });

  it('links telegram and reveals the deep link', async () => {
    api.getTelegramStatus.mockResolvedValue(status());
    api.linkTelegram.mockResolvedValue(status({ link_url: 'https://t.me/bot?start=abc' }));
    renderSettings();
    const user = userEvent.setup();
    await user.click(await screen.findByText('Link Telegram'));
    expect(api.linkTelegram).toHaveBeenCalled();
    expect(await screen.findByText('https://t.me/bot?start=abc')).toBeInTheDocument();
  });

  it('toggles reminders when linked', async () => {
    api.getTelegramStatus.mockResolvedValue(status({ linked: true }));
    api.setTelegramReminders.mockResolvedValue(status({ linked: true, enabled: true }));
    renderSettings();
    await screen.findByText('Telegram linked');
    const user = userEvent.setup();
    await user.click(screen.getByRole('checkbox'));
    expect(api.setTelegramReminders).toHaveBeenCalledWith(true);
  });

  it('changes the timezone', async () => {
    api.getTelegramStatus.mockResolvedValue(status());
    api.setTimezone.mockResolvedValue(status({ timezone: 'Europe/London' }));
    renderSettings();
    const select = await screen.findByLabelText('Timezone');
    const user = userEvent.setup();
    await user.selectOptions(select, 'Europe/London');
    expect(api.setTimezone).toHaveBeenCalledWith('Europe/London');
  });

  it('triggers a full export', async () => {
    api.getTelegramStatus.mockResolvedValue(status());
    renderSettings();
    const user = userEvent.setup();
    await user.click(await screen.findByText('Export all (.zip)'));
    expect(api.exportAllNotes).toHaveBeenCalled();
  });
});
