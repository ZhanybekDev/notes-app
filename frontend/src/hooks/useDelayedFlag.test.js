import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useDelayedFlag } from './useDelayedFlag.js';

describe('useDelayedFlag', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('stays down when the wait ends before the delay', () => {
    const { result, rerender } = renderHook(({ active }) => useDelayedFlag(active, 300), {
      initialProps: { active: true },
    });

    act(() => { vi.advanceTimersByTime(200); });
    rerender({ active: false });
    act(() => { vi.advanceTimersByTime(1000); });

    // A skeleton that flashes for 200ms reads as a glitch, so a fast answer shows nothing at all.
    expect(result.current).toBe(false);
  });

  it('rises once the wait outlasts the delay', () => {
    const { result } = renderHook(() => useDelayedFlag(true, 300));

    expect(result.current).toBe(false);
    act(() => { vi.advanceTimersByTime(300); });
    expect(result.current).toBe(true);
  });

  it('starts the delay over on every transition', () => {
    const { result, rerender } = renderHook(({ active }) => useDelayedFlag(active, 300), {
      initialProps: { active: true },
    });

    // Typing in the search box gives loading → ready → loading. Without the reset, time accumulated
    // during the first request would raise the flag in the middle of an already-loaded list.
    act(() => { vi.advanceTimersByTime(250); });
    rerender({ active: false });
    rerender({ active: true });
    act(() => { vi.advanceTimersByTime(100); });

    expect(result.current).toBe(false);
    act(() => { vi.advanceTimersByTime(200); });
    expect(result.current).toBe(true);
  });

  it('drops back down as soon as the wait is over', () => {
    const { result, rerender } = renderHook(({ active }) => useDelayedFlag(active, 300), {
      initialProps: { active: true },
    });

    act(() => { vi.advanceTimersByTime(300); });
    expect(result.current).toBe(true);

    rerender({ active: false });
    expect(result.current).toBe(false);
  });
});
