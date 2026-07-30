import { act, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import SharedNote from './SharedNote.jsx';
import Toaster from '../components/Toaster.jsx';
import { ApiError } from '../api.js';
import { useSessionStore } from '../stores/sessionStore.js';
import { useUiStore } from '../stores/uiStore.js';

const NOTE = {
  title: 'Roadmap',
  content: '# Q3\n\nship it',
  tags: ['work'],
  note_date: '2026-08-01',
  updated_at: '2026-07-30T10:00:00Z',
};

function renderShared(token = 'tok') {
  return render(
    <MemoryRouter initialEntries={[`/s/${token}`]}>
      <Routes>
        <Route path="/s/:token" element={<SharedNote />} />
      </Routes>
      <Toaster />
    </MemoryRouter>,
  );
}

describe('SharedNote', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders the note for a reader with no session', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => NOTE,
    });

    renderShared('abc123');

    expect(await screen.findByText('Roadmap')).toBeInTheDocument();
    expect(screen.getByText('ship it')).toBeInTheDocument();
    expect(screen.getByText('#work')).toBeInTheDocument();

    // No Authorization header on this path: the reader may have no account at all.
    const [, init] = fetchMock.mock.calls[0];
    expect(init?.headers?.Authorization).toBeUndefined();
  });

  it('says the link does not work, without saying why', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ detail: 'Note not found' }),
    });

    renderShared();

    // The server answers a revoked link, an archived note and a made-up token identically;
    // repeating the distinction here would undo it.
    expect(await screen.findByText('This link does not work')).toBeInTheDocument();
  });

  it('does not end the session of a reader who happens to be signed in', async () => {
    useSessionStore.getState().login('jwt');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({}),
    });

    renderShared();
    await screen.findByText('This link does not work');

    // api.js signs the user out on any 401 from the private path. A public link must not be able
    // to do that to whoever opened it.
    expect(useSessionStore.getState().token).toBe('jwt');
    expect(useUiStore.getState().toasts).toEqual([]);
  });

  it('shows nothing for the first 300ms, then a skeleton', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.spyOn(globalThis, 'fetch').mockReturnValue(new Promise(() => {}));

    renderShared();

    expect(document.querySelectorAll('.skeleton').length).toBe(0);
    await act(async () => { vi.advanceTimersByTime(300); });
    expect(document.querySelectorAll('.skeleton').length).toBeGreaterThan(0);
  });

  it('reports a network failure as the same page, not as a toast', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new ApiError('Failed to fetch', undefined));

    renderShared();

    expect(await screen.findByText('This link does not work')).toBeInTheDocument();
  });
});
