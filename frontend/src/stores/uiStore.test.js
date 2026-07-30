import { beforeEach, describe, expect, it } from 'vitest';

import { ApiError } from '../api.js';
import { resetStores } from './index.js';
import { reportFailure, useUiStore } from './uiStore.js';

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

  it('keeps a polite message and an error apart even with identical text', () => {
    useUiStore.getState().notify('busy', 'error');
    useUiStore.getState().notify('busy', 'status');

    // Matching on text alone would have renewed the error and given the polite one its eight seconds.
    expect(queue().map((t) => t.kind)).toEqual(['error', 'status']);
  });

  it('keeps the stack from growing without bound', () => {
    for (let i = 0; i < 7; i++) useUiStore.getState().notify(`message ${i}`, 'error');

    expect(queue()).toHaveLength(4);
    expect(queue()[0].message).toBe('message 3');
  });

  it('defaults to the polite kind when the caller does not say', () => {
    useUiStore.getState().notify('just so you know');

    expect(queue()[0].kind).toBe('status');
  });
});


describe('reportFailure', () => {
  beforeEach(() => {
    resetStores();
  });

  it('shows an ordinary failure as an alert', () => {
    reportFailure(new ApiError('server error', 500));

    expect(queue()).toEqual([
      expect.objectContaining({ message: 'server error', kind: 'error' }),
    ]);
  });

  it('stays quiet on a 401', () => {
    // api.js answers a 401 by ending the session; the redirect to the login form is the feedback.
    // A toast would land on that form saying "Unauthorized" in English, whatever the interface speaks.
    reportFailure(new ApiError('Unauthorized', 401));

    expect(queue()).toEqual([]);
  });

  it('survives something that is not an Error at all', () => {
    reportFailure('plain string');

    expect(queue()[0].message).toBe('plain string');
  });
});
