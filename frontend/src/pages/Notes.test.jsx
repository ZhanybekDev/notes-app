import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

import Notes from './Notes.jsx';
import { api } from '../api.js';

const NOTES = [
  { id: 1, title: 'Groceries', content: 'milk', tags: ['home'], note_date: null },
  { id: 2, title: 'Roadmap', content: 'q3', tags: ['work'], note_date: '2026-08-01' },
];

const SETTINGS = {
  timezone: 'UTC',
  reminder_time: '09:00:00',
  notifications_enabled: false,
  telegram_linked: false,
  telegram_username: null,
  bot_configured: true,
};

function renderNotes() {
  return render(
    <MemoryRouter>
      <Notes />
    </MemoryRouter>,
  );
}

describe('Notes page on the store', () => {
  let list;

  beforeEach(() => {
    vi.restoreAllMocks();
    list = vi.spyOn(api, 'listNotes').mockResolvedValue({ items: NOTES, total: NOTES.length });
    vi.spyOn(api, 'tags').mockResolvedValue(['home', 'work']);
    vi.spyOn(api, 'getSettings').mockResolvedValue(SETTINGS);
  });

  it('renders the loaded notes', async () => {
    renderNotes();
    expect(await screen.findByText('Groceries')).toBeInTheDocument();
    expect(screen.getByText('Roadmap')).toBeInTheDocument();
  });

  it('shows the empty state until a note is picked', async () => {
    renderNotes();
    expect(await screen.findByText('Nothing selected')).toBeInTheDocument();
  });

  it('opens the editor on the picked note', async () => {
    renderNotes();
    await userEvent.click(await screen.findByText('Roadmap'));
    expect(await screen.findByDisplayValue('Roadmap')).toBeInTheDocument();
  });

  it('asks the server once per typed character and keeps the input in sync', async () => {
    renderNotes();
    await screen.findByText('Groceries');
    expect(list).toHaveBeenCalledTimes(1);

    const search = screen.getByPlaceholderText('Search notes...');
    await userEvent.type(search, 'abc');

    // Three keystrokes, three requests — no debounce today, and no doubled reload either.
    await waitFor(() => expect(list).toHaveBeenCalledTimes(4));
    expect(search).toHaveValue('abc');
    expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'abc', offset: 0 }));
  });

  it('requests archived notes when the tab changes', async () => {
    renderNotes();
    await screen.findByText('Groceries');
    await userEvent.click(screen.getByRole('button', { name: 'Archived' }));
    await waitFor(() =>
      expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ archived: true })),
    );
  });

  it('filters by tag through the store', async () => {
    renderNotes();
    await screen.findByText('Groceries');
    await userEvent.click(screen.getByRole('button', { name: '#work' }));
    await waitFor(() =>
      expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ tag: 'work' })),
    );
  });

  it('enters bulk mode and keeps the delete button disabled until something is checked', async () => {
    renderNotes();
    await screen.findByText('Groceries');
    await userEvent.click(screen.getByRole('button', { name: 'Select' }));

    const deleteButton = screen.getByRole('button', { name: /Delete/ });
    expect(deleteButton).toBeDisabled();

    await userEvent.click(screen.getByText('Groceries'));
    expect(deleteButton).toBeEnabled();
  });

  it('bulk-deletes only after the confirmation is accepted', async () => {
    const bulk = vi.spyOn(api, 'bulkDelete').mockResolvedValue(null);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderNotes();
    await screen.findByText('Groceries');

    await userEvent.click(screen.getByRole('button', { name: 'Select' }));
    await userEvent.click(screen.getByText('Groceries'));
    await userEvent.click(screen.getByRole('button', { name: /Delete/ }));
    expect(confirm).toHaveBeenCalled();
    expect(bulk).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    await userEvent.click(screen.getByRole('button', { name: /Delete/ }));
    await waitFor(() => expect(bulk).toHaveBeenCalledWith([1]));
  });

  it('shows a failed request as a page error', async () => {
    list.mockRejectedValue(new Error('offline'));
    renderNotes();
    expect(await screen.findByText('offline')).toBeInTheDocument();
  });
});
