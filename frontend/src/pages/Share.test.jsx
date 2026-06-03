import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import { LangProvider } from '../i18n.jsx';

vi.mock('../api.js', () => ({
  ApiError: class ApiError extends Error {},
  api: { getSharedNote: vi.fn() },
}));

import { api } from '../api.js';
import Share from './Share.jsx';

function renderAt(token) {
  return render(
    <LangProvider>
      <MemoryRouter initialEntries={[`/share/${token}`]}>
        <Routes>
          <Route path="/share/:token" element={<Share />} />
        </Routes>
      </MemoryRouter>
    </LangProvider>,
  );
}

beforeEach(() => vi.clearAllMocks());

describe('Share page', () => {
  it('renders a shared note read-only', async () => {
    api.getSharedNote.mockResolvedValue({
      title: 'Hello',
      content: '# Hi there',
      tags: [],
      note_date: '2026-06-03',
      updated_at: '2026-06-03T00:00:00Z',
    });
    renderAt('tok123');
    expect(await screen.findByText('Hello')).toBeInTheDocument();
    expect(screen.getByText('Shared note (read-only)')).toBeInTheDocument();
    expect(api.getSharedNote).toHaveBeenCalledWith('tok123');
  });

  it('shows a not-found message for an invalid token', async () => {
    api.getSharedNote.mockRejectedValue(new Error('404'));
    renderAt('bad');
    expect(
      await screen.findByText('This note is not shared, or the link is invalid.'),
    ).toBeInTheDocument();
  });
});
