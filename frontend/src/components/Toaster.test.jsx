import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import Toaster from './Toaster.jsx';
import { resetStores } from '../stores/index.js';
import { useUiStore } from '../stores/uiStore.js';

const notify = (message, kind) => act(() => { useUiStore.getState().notify(message, kind); });

describe('Toaster', () => {
  beforeEach(() => {
    resetStores();
  });

  it('keeps both live regions in the DOM while the queue is empty', () => {
    render(<Toaster />);

    // A region created together with its message is never announced — the screen reader watches
    // regions that already exist. This is the whole reason the containers are permanent.
    expect(screen.getByTestId('toast-region-status')).toBeEmptyDOMElement();
    expect(screen.getByTestId('toast-region-alert')).toBeEmptyDOMElement();
  });

  it('routes an error to the assertive region and a success to the polite one', () => {
    render(<Toaster />);

    notify('offline', 'error');
    notify('saved', 'status');

    expect(screen.getByTestId('toast-region-alert')).toHaveTextContent('offline');
    expect(screen.getByTestId('toast-region-status')).toHaveTextContent('saved');
  });

  it('gives the toasts themselves no role, so the regions do not nest', () => {
    render(<Toaster />);
    notify('offline', 'error');

    // Nested live regions announce twice or not at all.
    expect(screen.getByText('offline').closest('[role]')).toBe(
      screen.getByTestId('toast-region-alert'),
    );
  });

  it('leaves focus where it was when a toast appears', async () => {
    render(
      <>
        <button type="button">outside</button>
        <Toaster />
      </>,
    );
    const outside = screen.getByRole('button', { name: 'outside' });
    outside.focus();

    notify('offline', 'error');

    expect(document.activeElement).toBe(outside);
  });

  it('closes on the close button', async () => {
    const user = userEvent.setup();
    render(<Toaster />);
    notify('saved', 'status');

    await user.click(screen.getByRole('button', { name: 'Dismiss' }));

    expect(screen.queryByText('saved')).not.toBeInTheDocument();
  });

  describe('timers', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('dismisses a success after four seconds and an error after eight', () => {
      render(<Toaster />);
      notify('saved', 'status');
      notify('offline', 'error');

      act(() => { vi.advanceTimersByTime(4000); });
      expect(screen.queryByText('saved')).not.toBeInTheDocument();
      expect(screen.getByText('offline')).toBeInTheDocument();

      act(() => { vi.advanceTimersByTime(4000); });
      expect(screen.queryByText('offline')).not.toBeInTheDocument();
    });

    it('holds the toast while the pointer is over it', () => {
      render(<Toaster />);
      notify('saved', 'status');

      act(() => { vi.advanceTimersByTime(3000); });
      act(() => { fireEvent.mouseOver(screen.getByText('saved').closest('.toast')); });
      act(() => { vi.advanceTimersByTime(10000); });

      // Auto-dismissal without a way to pause it fails WCAG 2.2.1.
      expect(screen.getByText('saved')).toBeInTheDocument();
    });

    it('restarts the countdown when the same message repeats', () => {
      render(<Toaster />);
      notify('offline', 'error');

      act(() => { vi.advanceTimersByTime(7000); });
      notify('offline', 'error');
      act(() => { vi.advanceTimersByTime(7000); });

      // The repeat renewed the toast rather than being dropped, so it is still on screen at 14s.
      expect(screen.getByText('offline')).toBeInTheDocument();
      act(() => { vi.advanceTimersByTime(2000); });
      expect(screen.queryByText('offline')).not.toBeInTheDocument();
    });
  });
});
