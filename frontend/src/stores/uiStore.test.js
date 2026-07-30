import { beforeEach, describe, expect, it } from 'vitest';

import { resetStores } from './index.js';
import { useUiStore } from './uiStore.js';

const queue = () => useUiStore.getState().toasts;

describe('uiStore', () => {
  beforeEach(() => {
    resetStores();
  });

  it('queues messages in order with the kind the caller asked for', () => {
    useUiStore.getState().notify('saved', 'status');
    useUiStore.getState().notify('offline', 'error');

    expect(queue().map((t) => [t.message, t.kind])).toEqual([
      ['saved', 'status'],
      ['offline', 'error'],
    ]);
  });

  it('collapses a repeat of the same message and renews it instead', () => {
    // Mounting /notes starts two loads at once, so one dropped network arrives twice in a tick.
    const first = useUiStore.getState().notify('offline', 'error');
    const second = useUiStore.getState().notify('offline', 'error');

    expect(second).toBe(first);
    expect(queue()).toHaveLength(1);
    // The repeat is not lost: this counter is what restarts the timer in <Toaster />.
    expect(queue()[0].renewals).toBe(1);
  });

  it('keeps different messages apart even when they arrive together', () => {
    useUiStore.getState().notify('offline', 'error');
    useUiStore.getState().notify('server error', 'error');

    expect(queue()).toHaveLength(2);
  });

  it('dismisses by id and leaves the rest of the queue alone', () => {
    const id = useUiStore.getState().notify('first', 'status');
    useUiStore.getState().notify('second', 'status');

    useUiStore.getState().dismiss(id);

    expect(queue().map((t) => t.message)).toEqual(['second']);
  });

  it('is emptied by resetStores, so one test cannot see another test toast', () => {
    useUiStore.getState().notify('leaking', 'error');
    resetStores();

    expect(queue()).toEqual([]);
  });

  it('defaults to the polite kind when the caller does not say', () => {
    useUiStore.getState().notify('just so you know');

    expect(queue()[0].kind).toBe('status');
  });
});
