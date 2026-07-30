import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

import Notes from './Notes.jsx';
import Toaster from '../components/Toaster.jsx';
import { api } from '../api.js';
import { useUiStore } from '../stores/uiStore.js';

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

// <Toaster /> is mounted here for the same reason App.jsx mounts it: failures reach the reader
// through it, so a test rendering the page alone could not see them at all.
function renderNotes() {
  return render(
    <MemoryRouter>
      <Notes />
      <Toaster />
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
    expect(await screen.findByText('Pick a note')).toBeInTheDocument();
  });

  it('claims nothing about the notes until the first answer arrives', async () => {
    let answer;
    list.mockReturnValue(new Promise((resolve) => { answer = resolve; }));
    renderNotes();

    // The skeleton deliberately waits 300ms, and the empty state used to fill that gap by announcing
    // an account with no notes — on every single visit.
    expect(screen.queryByText('No notes yet')).not.toBeInTheDocument();
    expect(screen.queryByText('Nothing found')).not.toBeInTheDocument();

    answer({ items: [], total: 0 });
    expect(await screen.findByText('No notes yet')).toBeInTheDocument();
  });

  it('keeps an empty result on screen while the next query is in flight', async () => {
    list.mockResolvedValue({ items: [], total: 0 });
    renderNotes();
    await screen.findByText('No notes yet');

    await userEvent.type(screen.getByPlaceholderText('Search notes...'), 'z');
    await screen.findByText('Nothing found');

    let answer;
    list.mockReturnValue(new Promise((resolve) => { answer = resolve; }));
    await userEvent.type(screen.getByPlaceholderText('Search notes...'), 'z');

    // An empty result is an answer, and it stays until a newer one arrives. Deciding that from the
    // length of the list instead made this message blink on every keystroke.
    expect(screen.getByText('Nothing found')).toBeInTheDocument();
    await act(async () => { answer({ items: [], total: 0 }); });
    expect(screen.getByText('Nothing found')).toBeInTheDocument();
  });

  it('tells an empty account apart from a search that found nothing', async () => {
    list.mockResolvedValue({ items: [], total: 0 });
    renderNotes();
    expect(await screen.findByText('No notes yet')).toBeInTheDocument();

    await userEvent.type(screen.getByPlaceholderText('Search notes...'), 'zzz');

    // Same empty array from the server, different reason for it — the copy has to say which.
    expect(await screen.findByText('Nothing found')).toBeInTheDocument();
    expect(screen.queryByText('No notes yet')).not.toBeInTheDocument();
  });

  it('names an empty archive as such rather than as an account with no notes', async () => {
    list.mockResolvedValue({ items: [], total: 0 });
    renderNotes();
    await screen.findByText('No notes yet');

    await userEvent.click(screen.getByRole('button', { name: 'Archived' }));
    expect(await screen.findByText('The archive is empty.')).toBeInTheDocument();
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

  it('reports a failed request as an assertive toast', async () => {
    list.mockRejectedValue(new Error('offline'));
    renderNotes();

    const alerts = await screen.findByTestId('toast-region-alert');
    // A rejection carrying no status never reached the server, so the toast says so in the reader's
    // language rather than repeating the browser's word for it.
    expect(alerts).toHaveTextContent('No connection to the server.');
  });

  it('leaves a failure block with a retry in the list, not just a toast', async () => {
    list.mockRejectedValue(new Error('offline'));
    renderNotes();

    // The toast leaves after eight seconds. If nothing replaced the empty list, the screen would
    // then claim the account has no notes.
    expect(await screen.findByText("Couldn't load")).toBeInTheDocument();
    expect(screen.queryByText('No notes yet')).not.toBeInTheDocument();

    list.mockResolvedValue({ items: NOTES, total: NOTES.length });
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Groceries')).toBeInTheDocument();
  });

  it('does not raise a second toast for the same failure on a remount', async () => {
    list.mockRejectedValue(new Error('offline'));
    const { unmount } = renderNotes();
    await screen.findByTestId('toast-region-alert');
    await waitFor(() => expect(useUiStore.getState().toasts).toHaveLength(1));
    unmount();

    // Checking for absent text would pass for the wrong reason — the toast may simply have expired.
    // What matters is that the queue does not grow.
    renderNotes();
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
    expect(useUiStore.getState().toasts).toHaveLength(1);
  });
});
