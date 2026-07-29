import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

import Settings from './Settings.jsx';
import { LangProvider } from '../i18n.jsx';
import { api } from '../api.js';

const LINKED = {
  timezone: 'Asia/Bishkek',
  reminder_time: '09:00:00',
  notifications_enabled: true,
  telegram_linked: true,
  telegram_username: 'alice_tg',
  bot_configured: true,
};

const UNLINKED = {
  timezone: 'UTC',
  reminder_time: '09:00:00',
  notifications_enabled: false,
  telegram_linked: false,
  telegram_username: null,
  bot_configured: true,
};

function renderSettings() {
  return render(
    <MemoryRouter>
      <LangProvider>
        <Settings />
      </LangProvider>
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('Settings — Telegram reminders', () => {
  it('shows the connected Telegram username', async () => {
    vi.spyOn(api, 'getSettings').mockResolvedValue(LINKED);

    renderSettings();

    expect(await screen.findByText('Connected as @alice_tg')).toBeInTheDocument();
  });

  it('renders the current timezone and reminder time', async () => {
    vi.spyOn(api, 'getSettings').mockResolvedValue(LINKED);

    renderSettings();

    expect(await screen.findByDisplayValue('Asia/Bishkek')).toBeInTheDocument();
    expect(screen.getByDisplayValue('09:00')).toBeInTheDocument();
  });

  it('sends one PATCH per time edit, on blur rather than per keystroke', async () => {
    const user = userEvent.setup();
    vi.spyOn(api, 'getSettings').mockResolvedValue(LINKED);
    const update = vi
      .spyOn(api, 'updateSettings')
      .mockResolvedValue({ ...LINKED, reminder_time: '07:30:00' });

    renderSettings();
    const input = await screen.findByDisplayValue('09:00');
    await user.clear(input);
    await user.type(input, '07:30');
    expect(update).not.toHaveBeenCalled();

    await user.tab();

    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith({ reminder_time: '07:30' });
  });

  it('does not PATCH when the time is left unchanged', async () => {
    const user = userEvent.setup();
    vi.spyOn(api, 'getSettings').mockResolvedValue(LINKED);
    const update = vi.spyOn(api, 'updateSettings').mockResolvedValue(LINKED);

    renderSettings();
    await user.click(await screen.findByDisplayValue('09:00'));
    await user.tab();

    expect(update).not.toHaveBeenCalled();
  });

  it('persists the notifications toggle', async () => {
    const user = userEvent.setup();
    vi.spyOn(api, 'getSettings').mockResolvedValue(UNLINKED);
    const update = vi
      .spyOn(api, 'updateSettings')
      .mockResolvedValue({ ...UNLINKED, notifications_enabled: true });

    renderSettings();
    await user.click(await screen.findByRole('checkbox'));

    expect(update).toHaveBeenCalledWith({ notifications_enabled: true });
    expect(await screen.findByText('Saved.')).toBeInTheDocument();
  });

  it('opens the deep link when connecting', async () => {
    const user = userEvent.setup();
    vi.spyOn(api, 'getSettings').mockResolvedValue(UNLINKED);
    vi.spyOn(api, 'linkTelegram').mockResolvedValue({
      deep_link_url: 'https://t.me/test_bot?start=code123',
      expires_at: '2026-07-29T12:00:00Z',
    });
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);

    renderSettings();
    await user.click(await screen.findByRole('button', { name: 'Connect Telegram' }));

    expect(open).toHaveBeenCalledWith(
      'https://t.me/test_bot?start=code123',
      '_blank',
      'noopener'
    );
  });

  it('explains and disables connecting when the bot is not configured', async () => {
    vi.spyOn(api, 'getSettings').mockResolvedValue({ ...UNLINKED, bot_configured: false });

    renderSettings();

    expect(await screen.findByText(/bot is not configured/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Connect Telegram' })).toBeDisabled();
  });

  it('surfaces a failure instead of silently ignoring it', async () => {
    vi.spyOn(api, 'getSettings').mockRejectedValue(new Error('Unauthorized'));

    renderSettings();

    expect(await screen.findByText('Unauthorized')).toBeInTheDocument();
  });

  it('disconnects after confirmation and refreshes the state', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const getSettings = vi
      .spyOn(api, 'getSettings')
      .mockResolvedValueOnce(LINKED)
      .mockResolvedValueOnce(UNLINKED);
    const unlinkTelegram = vi.spyOn(api, 'unlinkTelegram').mockResolvedValue(null);

    renderSettings();
    await user.click(await screen.findByRole('button', { name: 'Disconnect' }));

    await waitFor(() => expect(unlinkTelegram).toHaveBeenCalled());
    expect(getSettings).toHaveBeenCalledTimes(2);
    expect(await screen.findByText('Not connected yet.')).toBeInTheDocument();
  });

  it('does not disconnect when the confirmation is dismissed', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    vi.spyOn(api, 'getSettings').mockResolvedValue(LINKED);
    const unlinkTelegram = vi.spyOn(api, 'unlinkTelegram').mockResolvedValue(null);

    renderSettings();
    await user.click(await screen.findByRole('button', { name: 'Disconnect' }));

    expect(unlinkTelegram).not.toHaveBeenCalled();
  });
});
