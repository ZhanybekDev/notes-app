import { beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '../api.js';
import { ApiError } from '../api.js';
import { useAccountStore } from './accountStore.js';
import { usePrefsStore } from './prefsStore.js';
import { useUiStore } from './uiStore.js';

const SETTINGS = {
  timezone: 'Asia/Bishkek',
  reminder_time: '09:00:00',
  notifications_enabled: true,
  telegram_linked: true,
  telegram_username: 'alice_tg',
  bot_configured: true,
};

const store = () => useAccountStore.getState();

describe('load', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('serves two callers in the same tick with one request', async () => {
    const get = vi.spyOn(api, 'getSettings').mockResolvedValue(SETTINGS);
    const [a, b] = await Promise.all([store().load(), store().load()]);
    expect(get).toHaveBeenCalledTimes(1);
    expect(a).toEqual(SETTINGS);
    expect(b).toEqual(SETTINGS);
  });

  it('revalidates on the next call instead of trusting the cache', async () => {
    const get = vi
      .spyOn(api, 'getSettings')
      .mockResolvedValueOnce(SETTINGS)
      .mockResolvedValueOnce({ ...SETTINGS, notifications_enabled: false });

    await store().load();
    expect(store().prefs.notifications_enabled).toBe(true);

    // Reminders silenced from the Telegram bot — the tab must notice.
    await store().load();
    expect(get).toHaveBeenCalledTimes(2);
    expect(store().prefs.notifications_enabled).toBe(false);
  });

  it('keeps the cached value visible while revalidating', async () => {
    vi.spyOn(api, 'getSettings').mockResolvedValue(SETTINGS);
    await store().load();
    const second = store().load();
    expect(store().prefs).toEqual(SETTINGS);
    expect(store().status).toBe('ready');
    await second;
  });

  it('reports a first failure as an error state', async () => {
    vi.spyOn(api, 'getSettings').mockRejectedValue(new Error('offline'));
    await store().load();
    expect(store().status).toBe('error');
    expect(store().error).toBe('offline');
    expect(store().prefs).toBeNull();
  });

  it('clears the in-flight slot so a later call can retry', async () => {
    const get = vi.spyOn(api, 'getSettings').mockRejectedValueOnce(new Error('offline'));
    await store().load();
    get.mockResolvedValue(SETTINGS);
    await store().load();
    expect(store().prefs).toEqual(SETTINGS);
    expect(store().inflight).toBeNull();
  });
});

describe('patch', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('stores what the server returned, not what was sent', async () => {
    vi.spyOn(api, 'updateSettings').mockResolvedValue({ ...SETTINGS, timezone: 'UTC' });
    const next = await store().patch({ timezone: 'Europe/Berlin' });
    expect(next.timezone).toBe('UTC');
    expect(store().prefs.timezone).toBe('UTC');
    expect(store().saved).toBe(true);
  });

  it('leaves loaded settings in place when the PATCH fails', async () => {
    vi.spyOn(api, 'getSettings').mockResolvedValue(SETTINGS);
    await store().load();
    vi.spyOn(api, 'updateSettings').mockRejectedValue(new Error('422'));

    const next = await store().patch({ timezone: 'Nowhere/Fake' });
    expect(next).toBeNull();
    expect(store().error).toBe('422');
    expect(store().prefs).toEqual(SETTINGS);
    expect(store().saved).toBe(false);
  });

  it('lets the screen dismiss the saved notice', async () => {
    vi.spyOn(api, 'updateSettings').mockResolvedValue(SETTINGS);
    await store().patch({ notifications_enabled: true });
    expect(store().saved).toBe(true);
    store().clearSaved();
    expect(store().saved).toBe(false);
  });
});

describe('telegram', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('unlinks and refetches the settings that follow from it', async () => {
    const unlink = vi.spyOn(api, 'unlinkTelegram').mockResolvedValue(null);
    vi.spyOn(api, 'getSettings').mockResolvedValue({
      ...SETTINGS,
      telegram_linked: false,
      telegram_username: null,
      notifications_enabled: false,
    });

    const next = await store().unlink();
    expect(unlink).toHaveBeenCalled();
    expect(next.telegram_linked).toBe(false);
    expect(store().prefs.telegram_username).toBeNull();
  });

  it('accepts settings that arrived from the link handshake', () => {
    store().setPrefs(SETTINGS);
    expect(store().prefs).toEqual(SETTINGS);
    expect(store().status).toBe('ready');
  });

  it('reports a failed unlink without dropping what is loaded', async () => {
    vi.spyOn(api, 'getSettings').mockResolvedValue(SETTINGS);
    await store().load();
    vi.spyOn(api, 'unlinkTelegram').mockRejectedValue(new Error('500'));

    expect(await store().unlink()).toBeNull();
    expect(store().error).toBe('500');
    expect(store().prefs).toEqual(SETTINGS);
  });
});


describe('what a save tells the reader', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useUiStore.setState(useUiStore.getInitialState(), true);
    usePrefsStore.setState({ lang: null });
  });

  it('confirms a save politely, not as an alert', async () => {
    vi.spyOn(api, 'updateSettings').mockResolvedValue(SETTINGS);
    await store().patch({ notifications_enabled: true });

    const [toast] = useUiStore.getState().toasts;
    expect(toast.kind).toBe('status');
  });

  it('speaks the language the interface speaks when none was ever chosen', async () => {
    // lang is null by default — "follow the browser" — and jsdom reports en-US. Reading the field
    // raw used to reach MESSAGES[null] and fall through to English no matter what the browser said,
    // which is invisible in English and wrong in Russian.
    vi.spyOn(navigator, 'language', 'get').mockReturnValue('ru-RU');
    vi.spyOn(api, 'updateSettings').mockResolvedValue(SETTINGS);

    await store().patch({ notifications_enabled: true });

    expect(useUiStore.getState().toasts[0].message).toBe('Сохранено.');
  });

  it('follows an explicit choice over the browser', async () => {
    usePrefsStore.setState({ lang: 'ru' });
    vi.spyOn(api, 'updateSettings').mockResolvedValue(SETTINGS);

    await store().patch({ notifications_enabled: true });

    expect(useUiStore.getState().toasts[0].message).toBe('Сохранено.');
  });

  it('says nothing about a 401 — the session redirect already did', async () => {
    vi.spyOn(api, 'updateSettings').mockRejectedValue(new ApiError('Unauthorized', 401));
    await store().patch({ notifications_enabled: true });

    expect(useUiStore.getState().toasts).toEqual([]);
    // The failure is still recorded where the screens read it from.
    expect(store().error).toBe('Unauthorized');
  });
});
