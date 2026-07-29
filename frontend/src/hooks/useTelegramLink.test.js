import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

import { POLL_TIMEOUT_MS, useTelegramLink } from './useTelegramLink.js';
import { api } from '../api.js';

const UNLINKED = { telegram_linked: false, timezone: 'UTC', reminder_time: '09:00:00' };
const LINKED = { ...UNLINKED, telegram_linked: true, telegram_username: 'alice' };

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(window, 'open').mockImplementation(() => null);
  vi.spyOn(api, 'linkTelegram').mockResolvedValue({
    deep_link_url: 'https://t.me/bot?start=code',
    expires_at: '2026-07-30T12:00:00Z',
  });
});

afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('useTelegramLink', () => {
  it('opens the deep link and waits', async () => {
    vi.spyOn(api, 'getSettings').mockResolvedValue(UNLINKED);
    const { result } = renderHook(() => useTelegramLink({ onLinked: vi.fn() }));

    await act(() => result.current.connect());

    expect(window.open).toHaveBeenCalledWith(
      'https://t.me/bot?start=code',
      '_blank',
      'noopener'
    );
    // Asserted directly rather than through waitFor: waitFor polls on real time, which never
    // advances while the fake timers this suite needs are installed.
    expect(result.current.status).toBe('waiting');
  });

  it('reaches linked once the binding appears and reports it once', async () => {
    const onLinked = vi.fn();
    vi.spyOn(api, 'getSettings')
      .mockResolvedValueOnce(UNLINKED)
      .mockResolvedValueOnce(UNLINKED)
      .mockResolvedValue(LINKED);
    const { result } = renderHook(() => useTelegramLink({ onLinked }));

    await act(() => result.current.connect());
    await act(() => vi.advanceTimersByTimeAsync(6000));

    expect(result.current.status).toBe('linked');
    expect(onLinked).toHaveBeenCalledTimes(1);
    expect(onLinked).toHaveBeenCalledWith(LINKED);
  });

  it('stops polling once linked', async () => {
    vi.spyOn(api, 'getSettings').mockResolvedValue(LINKED);
    const { result } = renderHook(() => useTelegramLink({ onLinked: vi.fn() }));

    await act(() => result.current.connect());
    await act(() => vi.advanceTimersByTimeAsync(2000));
    const callsWhenLinked = api.getSettings.mock.calls.length;
    await act(() => vi.advanceTimersByTimeAsync(20000));

    expect(api.getSettings.mock.calls.length).toBe(callsWhenLinked);
  });

  it('gives up after the timeout and stops polling', async () => {
    vi.spyOn(api, 'getSettings').mockResolvedValue(UNLINKED);
    const { result } = renderHook(() => useTelegramLink({ onLinked: vi.fn() }));

    await act(() => result.current.connect());
    await act(() => vi.advanceTimersByTimeAsync(POLL_TIMEOUT_MS + 1000));
    const callsAtTimeout = api.getSettings.mock.calls.length;
    await act(() => vi.advanceTimersByTimeAsync(20000));

    expect(result.current.status).toBe('timeout');
    expect(api.getSettings.mock.calls.length).toBe(callsAtTimeout);
  });

  it('stops on a failed poll instead of retrying blindly', async () => {
    vi.spyOn(api, 'getSettings').mockRejectedValue(new Error('Unauthorized'));
    const { result } = renderHook(() => useTelegramLink({ onLinked: vi.fn() }));

    await act(() => result.current.connect());
    await act(() => vi.advanceTimersByTimeAsync(2000));
    const callsAtError = api.getSettings.mock.calls.length;
    await act(() => vi.advanceTimersByTimeAsync(20000));

    expect(result.current.status).toBe('error');
    expect(result.current.error).toBe('Unauthorized');
    expect(api.getSettings.mock.calls.length).toBe(callsAtError);
  });

  it('surfaces a failure to issue the link and never starts polling', async () => {
    vi.spyOn(api, 'getSettings').mockResolvedValue(UNLINKED);
    api.linkTelegram.mockRejectedValue(new Error('Telegram bot is not configured'));
    const { result } = renderHook(() => useTelegramLink({ onLinked: vi.fn() }));

    await act(() => result.current.connect());

    expect(result.current.status).toBe('error');
    expect(result.current.error).toBe('Telegram bot is not configured');
    expect(api.getSettings).not.toHaveBeenCalled();
  });

  it('leaves no timer behind when unmounted mid-wait', async () => {
    vi.spyOn(api, 'getSettings').mockResolvedValue(UNLINKED);
    const { result, unmount } = renderHook(() => useTelegramLink({ onLinked: vi.fn() }));

    await act(() => result.current.connect());
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    unmount();

    expect(vi.getTimerCount()).toBe(0);
  });

  it('recheck finds a binding without waiting for the next poll', async () => {
    const onLinked = vi.fn();
    vi.spyOn(api, 'getSettings').mockResolvedValue(UNLINKED);
    const { result } = renderHook(() => useTelegramLink({ onLinked }));
    await act(() => result.current.connect());
    await act(() => vi.advanceTimersByTimeAsync(POLL_TIMEOUT_MS + 1000));
    expect(result.current.status).toBe('timeout');

    api.getSettings.mockResolvedValue(LINKED);
    await act(() => result.current.recheck());

    expect(result.current.status).toBe('linked');
    expect(onLinked).toHaveBeenCalledWith(LINKED);
  });
});
