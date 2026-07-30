import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, waitForElementToBeRemoved } from '@testing-library/react';
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
  // The time zone suggestion remembers its dismissal; without this it leaks between tests.
  localStorage.clear();
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
  it('waits for the binding and connects without a reload', async () => {
    const user = userEvent.setup();
    vi.spyOn(api, 'getSettings').mockResolvedValueOnce(UNLINKED).mockResolvedValue(LINKED);
    vi.spyOn(api, 'linkTelegram').mockResolvedValue({
      deep_link_url: 'https://t.me/test_bot?start=code123',
      expires_at: '2026-07-30T12:00:00Z',
    });
    vi.spyOn(window, 'open').mockImplementation(() => null);

    renderSettings();
    await user.click(await screen.findByRole('button', { name: 'Connect Telegram' }));

    expect(await screen.findByText(/Waiting for confirmation/)).toBeInTheDocument();
    // The first poll lands 2s in, past findByText's default one-second patience.
    expect(
      await screen.findByText('Connected as @alice_tg', {}, { timeout: 5000 })
    ).toBeInTheDocument();
  });

  it('disables the connect button while waiting', async () => {
    const user = userEvent.setup();
    vi.spyOn(api, 'getSettings').mockResolvedValue(UNLINKED);
    vi.spyOn(api, 'linkTelegram').mockResolvedValue({
      deep_link_url: 'https://t.me/test_bot?start=code123',
      expires_at: '2026-07-30T12:00:00Z',
    });
    vi.spyOn(window, 'open').mockImplementation(() => null);

    renderSettings();
    const connect = await screen.findByRole('button', { name: 'Connect Telegram' });
    await user.click(connect);

    await waitFor(() => expect(connect).toBeDisabled());
  });

  it('surfaces a failure to issue the link', async () => {
    const user = userEvent.setup();
    vi.spyOn(api, 'getSettings').mockResolvedValue(UNLINKED);
    vi.spyOn(api, 'linkTelegram').mockRejectedValue(new Error('bot is not configured'));

    renderSettings();
    await user.click(await screen.findByRole('button', { name: 'Connect Telegram' }));

    expect(await screen.findByText('bot is not configured')).toBeInTheDocument();
  });

  it('clears the saved confirmation on its own', async () => {
    const user = userEvent.setup();
    vi.spyOn(api, 'getSettings').mockResolvedValue(UNLINKED);
    vi.spyOn(api, 'updateSettings').mockResolvedValue({
      ...UNLINKED,
      notifications_enabled: true,
    });

    renderSettings();
    await user.click(await screen.findByRole('checkbox'));
    const saved = await screen.findByText('Saved.');

    // Real timers on purpose. Fake timers plus userEvent plus Testing Library's async wrapper is
    // a known source of flakes, and 2.5s once is cheaper than a test that fails at random.
    await waitForElementToBeRemoved(saved, { timeout: 4000 });
  });
  it('offers the browser time zone while the account is still on UTC', async () => {
    vi.spyOn(Intl, 'DateTimeFormat').mockReturnValue({
      resolvedOptions: () => ({ timeZone: 'Asia/Bishkek' }),
    });
    vi.spyOn(api, 'getSettings').mockResolvedValue(UNLINKED);

    renderSettings();

    // Matched on the whole sentence: the zone name alone also appears among the select options.
    expect(
      await screen.findByText('Looks like your time zone is Asia/Bishkek')
    ).toBeInTheDocument();
  });

  it('applies the suggested zone in one click', async () => {
    const user = userEvent.setup();
    vi.spyOn(Intl, 'DateTimeFormat').mockReturnValue({
      resolvedOptions: () => ({ timeZone: 'Asia/Bishkek' }),
    });
    vi.spyOn(api, 'getSettings').mockResolvedValue(UNLINKED);
    const update = vi
      .spyOn(api, 'updateSettings')
      .mockResolvedValue({ ...UNLINKED, timezone: 'Asia/Bishkek' });

    renderSettings();
    await user.click(await screen.findByRole('button', { name: 'Use it' }));

    expect(update).toHaveBeenCalledWith({ timezone: 'Asia/Bishkek' });
  });

  it('stays quiet once the account has a zone of its own', async () => {
    vi.spyOn(Intl, 'DateTimeFormat').mockReturnValue({
      resolvedOptions: () => ({ timeZone: 'Asia/Bishkek' }),
    });
    vi.spyOn(api, 'getSettings').mockResolvedValue(LINKED);

    renderSettings();
    await screen.findByText('Connected as @alice_tg');

    expect(screen.queryByRole('button', { name: 'Use it' })).not.toBeInTheDocument();
  });

  it('remembers a dismissal', async () => {
    const user = userEvent.setup();
    vi.spyOn(Intl, 'DateTimeFormat').mockReturnValue({
      resolvedOptions: () => ({ timeZone: 'Asia/Bishkek' }),
    });
    vi.spyOn(api, 'getSettings').mockResolvedValue(UNLINKED);

    const { unmount } = renderSettings();
    await user.click(await screen.findByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('button', { name: 'Use it' })).not.toBeInTheDocument();
    unmount();

    renderSettings();
    await screen.findByRole('checkbox');
    expect(screen.queryByRole('button', { name: 'Use it' })).not.toBeInTheDocument();
  });
});

describe('Settings — shared with the rest of the app', () => {
  it('renders from the cached settings on a second visit, with no loading placeholder', async () => {
    vi.spyOn(api, 'getSettings').mockResolvedValue(LINKED);

    const { unmount } = renderSettings();
    await screen.findByDisplayValue('Asia/Bishkek');
    unmount();

    renderSettings();

    // Nothing is awaited here on purpose: the store already holds the settings, so the screen has
    // them on its very first render instead of showing the "…" placeholder again.
    expect(screen.queryByText('…')).not.toBeInTheDocument();
    expect(screen.getByDisplayValue('Asia/Bishkek')).toBeInTheDocument();
  });

  it('picks up a change made outside the tab, such as /pause in the bot', async () => {
    const get = vi
      .spyOn(api, 'getSettings')
      .mockResolvedValueOnce(LINKED)
      .mockResolvedValue({ ...LINKED, notifications_enabled: false });

    const { unmount } = renderSettings();
    expect(await screen.findByRole('checkbox')).toBeChecked();
    unmount();

    renderSettings();
    await waitFor(() => expect(screen.getByRole('checkbox')).not.toBeChecked());
    expect(get).toHaveBeenCalledTimes(2);
  });
});
