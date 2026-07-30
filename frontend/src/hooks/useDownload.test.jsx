import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useDownload } from './useDownload.js';
import { ApiError } from '../api.js';
import { useUiStore } from '../stores/uiStore.js';

describe('useDownload', () => {
  let click;

  beforeEach(() => {
    vi.restoreAllMocks();
    click = vi.fn();
    // jsdom implements neither, so these are assigned rather than spied on: there is nothing to
    // spy on. The browser's own behaviour — pinning the blob until the URL is revoked — is the
    // reason the hook revokes at all, and that is what these assertions stand in for.
    URL.createObjectURL = vi.fn(() => 'blob:fake');
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(click);
  });

  it('saves the blob under the name the server chose', async () => {
    const blob = new Blob(['# note'], { type: 'text/markdown' });
    const { result } = renderHook(() => useDownload());

    await act(async () => {
      await result.current.download(async () => ({ blob, filename: 'Планы.md' }));
    });

    expect(URL.createObjectURL).toHaveBeenCalledWith(blob);
    expect(click).toHaveBeenCalled();
  });

  it('defers revoking the blob past the tick that clicked', async () => {
    // Asserted through the scheduling rather than through a timer: `act` flushes pending timers, so
    // a fake-timer version of this test passes against the broken code it is meant to catch.
    const schedule = vi.spyOn(globalThis, 'setTimeout');
    const { result } = renderHook(() => useDownload());

    await act(async () => {
      await result.current.download(async () => ({ blob: new Blob(['x']), filename: 'a.md' }));
    });

    // click() starts the download asynchronously; invalidating the blob in the same tick cancels it
    // outright in Firefox and Safari, and passes in Chrome — which is how it would have shipped.
    expect(schedule).toHaveBeenCalledWith(expect.any(Function), 0);

    // And it does still happen: the object URL pins the blob, and a whole account is not small.
    await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:fake'));
  });

  it('leaves no anchor behind in the document', async () => {
    const { result } = renderHook(() => useDownload());

    await act(async () => {
      await result.current.download(async () => ({ blob: new Blob(['x']), filename: 'a.md' }));
    });

    expect(document.querySelectorAll('a[download]')).toHaveLength(0);
  });

  it('reports a failed download and stops being busy', async () => {
    const { result } = renderHook(() => useDownload());

    await act(async () => {
      await result.current.download(async () => {
        throw new ApiError('server error', 500);
      });
    });

    await waitFor(() => expect(useUiStore.getState().toasts).toHaveLength(1));
    expect(useUiStore.getState().toasts[0].message).toBe('server error');
    expect(result.current.busy).toBe(false);
  });

  it('refuses a second download while the first is running', async () => {
    let finish;
    const request = vi.fn().mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const { result } = renderHook(() => useDownload());

    act(() => { result.current.download(request); });
    await waitFor(() => expect(result.current.busy).toBe(true));
    await act(async () => { await result.current.download(request); });

    expect(request).toHaveBeenCalledTimes(1);
    await act(async () => { finish({ blob: new Blob(['x']), filename: 'a.md' }); });
  });
});
