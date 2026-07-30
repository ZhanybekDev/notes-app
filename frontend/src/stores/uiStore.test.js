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

  it('spends a polite message before a failure when it needs room', () => {
    useUiStore.getState().notify('offline', 'error');
    for (let i = 0; i < 3; i++) useUiStore.getState().notify(`saved ${i}`, 'status');
    useUiStore.getState().notify('one more', 'status');

    // Three "Saved." notices must not push out the one thing that needed attention.
    expect(queue().map((toast) => toast.message)).toEqual([
      'offline', 'saved 1', 'saved 2', 'one more',
    ]);
  });

  it('never takes a toast the reader is holding', () => {
    const held = useUiStore.getState().notify('being read', 'status');
    useUiStore.getState().hold(held);
    for (let i = 0; i < 5; i++) useUiStore.getState().notify(`later ${i}`, 'status');

    expect(queue().map((toast) => toast.message)).toContain('being read');
  });

  it('lets the stack exceed the cap rather than steal what is held', () => {
    for (let i = 0; i < 4; i++) {
      const id = useUiStore.getState().notify(`held ${i}`, 'status');
      useUiStore.getState().hold(id);
    }
    useUiStore.getState().notify('newcomer', 'status');

    expect(queue()).toHaveLength(5);
  });

  it('forgets a toast is held once it is dismissed', () => {
    const id = useUiStore.getState().notify('being read', 'status');
    useUiStore.getState().hold(id);
    useUiStore.getState().dismiss(id);

    expect(useUiStore.getState().held.has(id)).toBe(false);
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

  it('says what a rejection with no status really means', () => {
    // fetch rejecting is the network, and its own wording ("Failed to fetch") tells the reader
    // nothing. A message that came from the server is passed through instead — see the test above.
    reportFailure(new TypeError('Failed to fetch'));

    expect(queue()[0].message).toBe('No connection to the server.');
  });

  it('falls back to our own words for something with no message at all', () => {
    reportFailure({ detail: 'nested somewhere' });

    expect(queue()[0].message).toBe('Something went wrong.');
  });
});
