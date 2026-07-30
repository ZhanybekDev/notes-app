import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import Calendar from './Calendar.jsx';
import Toaster from '../components/Toaster.jsx';
import { api } from '../api.js';

// The page reads today's date from the clock, so the tests pin it. August 2026 starts on a Saturday,
// which is the interesting case for a Monday-first grid: five leading blanks.
const TODAY = new Date(2026, 7, 12);

const DAYS = [
  { date: '2026-08-03', note_ids: [1, 2] },
  { date: '2026-08-12', note_ids: [3] },
];

function renderCalendar() {
  return render(
    <>
      <Calendar />
      <Toaster />
    </>,
  );
}

describe('Calendar page', () => {
  let calendar;

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true, now: TODAY });
    vi.restoreAllMocks();
    calendar = vi.spyOn(api, 'calendar').mockResolvedValue(DAYS);
  });

  afterEach(() => {
    // Without this a test that moves the clock leaves the next one in the wrong month.
    vi.useRealTimers();
  });

  it('asks for the current month and renders its days with note counts', async () => {
    renderCalendar();

    await waitFor(() => expect(calendar).toHaveBeenCalledWith(2026, 8));
    expect(screen.getByRole('heading', { name: 'August 2026' })).toBeInTheDocument();
    // 31 numbered cells, and a badge only on the two days the server listed.
    expect(document.querySelectorAll('.cal-cell:not(.empty)')).toHaveLength(31);
    await waitFor(() =>
      expect([...document.querySelectorAll('.badge')].map((b) => b.textContent)).toEqual(['2', '1']),
    );
  });

  it('marks today apart from the day the reader picked', async () => {
    renderCalendar();
    await screen.findByRole('heading', { name: 'August 2026' });

    const today = document.querySelector('.cal-cell.today');
    expect(today).toHaveTextContent('12');

    await userEvent.click(document.querySelectorAll('.cal-cell:not(.empty)')[2]);

    // Both states used to be the same accent outline, so a pick looked like today.
    expect(document.querySelector('.cal-cell.selected')).toHaveTextContent('3');
    expect(document.querySelector('.cal-cell.selected')).not.toHaveClass('today');
  });

  it('walks to the neighbouring months and back to today', async () => {
    renderCalendar();
    await waitFor(() => expect(calendar).toHaveBeenCalledWith(2026, 8));

    await userEvent.click(screen.getByRole('button', { name: 'Previous month' }));
    await waitFor(() => expect(calendar).toHaveBeenCalledWith(2026, 7));
    expect(screen.getByRole('heading', { name: 'July 2026' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Next month' }));
    await userEvent.click(screen.getByRole('button', { name: 'Next month' }));
    await waitFor(() => expect(calendar).toHaveBeenCalledWith(2026, 9));

    await userEvent.click(screen.getByRole('button', { name: 'Today' }));
    expect(await screen.findByRole('heading', { name: 'August 2026' })).toBeInTheDocument();
  });

  it('crosses the year boundary in both directions', async () => {
    vi.setSystemTime(new Date(2026, 0, 15));
    renderCalendar();
    await waitFor(() => expect(calendar).toHaveBeenCalledWith(2026, 1));

    await userEvent.click(screen.getByRole('button', { name: 'Previous month' }));
    await waitFor(() => expect(calendar).toHaveBeenCalledWith(2025, 12));
  });

  it('opens a day and lists the notes filed under it', async () => {
    vi.spyOn(api, 'getNote').mockResolvedValue({ id: 3, title: 'Roadmap', content: 'q3 plan' });
    renderCalendar();
    await screen.findByRole('heading', { name: 'August 2026' });

    await userEvent.click(document.querySelector('.cal-cell.today'));

    expect(await screen.findByText('Roadmap')).toBeInTheDocument();
    expect(screen.getByText('q3 plan')).toBeInTheDocument();
  });

  it('says a day is empty rather than showing an empty list', async () => {
    renderCalendar();
    await screen.findByRole('heading', { name: 'August 2026' });

    // The 5th is inside the month but absent from the server's answer.
    await userEvent.click(document.querySelectorAll('.cal-cell:not(.empty)')[4]);

    expect(await screen.findByText('No notes on this day.')).toBeInTheDocument();
  });

  it('never leaves one day notes under another day heading', async () => {
    const getNote = vi.spyOn(api, 'getNote');
    getNote.mockResolvedValue({ id: 3, title: 'Roadmap', content: 'q3 plan' });
    renderCalendar();
    await screen.findByRole('heading', { name: 'August 2026' });

    await userEvent.click(document.querySelector('.cal-cell.today'));
    await screen.findByText('Roadmap');

    // The 3rd has notes too, and this time the server refuses.
    getNote.mockRejectedValue(new Error('offline'));
    await userEvent.click(document.querySelectorAll('.cal-cell:not(.empty)')[2]);

    expect(await screen.findByText("Couldn't load")).toBeInTheDocument();
    expect(screen.queryByText('Roadmap')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /2026-08-03/ })).toBeInTheDocument();

    // The 3rd holds two notes, so the retry has to fetch both.
    getNote.mockImplementation(async (id) => ({ id, title: `Note ${id}`, content: '' }));
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Note 1')).toBeInTheDocument();
    expect(screen.getByText('Note 2')).toBeInTheDocument();
  });

  it('says nothing about the day while its notes are on the way', async () => {
    let answer;
    vi.spyOn(api, 'getNote').mockReturnValue(new Promise((resolve) => { answer = resolve; }));
    renderCalendar();
    await screen.findByRole('heading', { name: 'August 2026' });

    await userEvent.click(document.querySelector('.cal-cell.today'));

    expect(screen.queryByText('No notes on this day.')).not.toBeInTheDocument();
    answer({ id: 3, title: 'Roadmap', content: 'q3' });
    expect(await screen.findByText('Roadmap')).toBeInTheDocument();
  });

  it('ignores a slow day answer once another day is open', async () => {
    const answers = new Map();
    vi.spyOn(api, 'getNote').mockImplementation(
      (id) => new Promise((resolve) => answers.set(id, resolve)),
    );
    renderCalendar();
    await screen.findByRole('heading', { name: 'August 2026' });

    // The 3rd holds two notes, the 12th one. Open the slow day, then the fast one.
    await userEvent.click(document.querySelectorAll('.cal-cell:not(.empty)')[2]);
    await userEvent.click(document.querySelector('.cal-cell.today'));

    await act(async () => { answers.get(3)({ id: 3, title: 'Roadmap', content: '' }); });
    expect(await screen.findByText('Roadmap')).toBeInTheDocument();

    await act(async () => {
      answers.get(1)({ id: 1, title: 'Groceries', content: '' });
      answers.get(2)({ id: 2, title: 'Invoices', content: '' });
    });

    // The 3rd answered last; its notes belong to a heading that is no longer on screen.
    expect(screen.getByText('Roadmap')).toBeInTheDocument();
    expect(screen.queryByText('Groceries')).not.toBeInTheDocument();
    expect(screen.queryByText('Invoices')).not.toBeInTheDocument();
  });

  it('keeps a failed day from being reported by a day nobody is looking at', async () => {
    const getNote = vi.spyOn(api, 'getNote');
    let reject;
    getNote.mockImplementationOnce(() => new Promise((_, r) => { reject = r; }));
    getNote.mockImplementationOnce(() => new Promise(() => {}));
    renderCalendar();
    await screen.findByRole('heading', { name: 'August 2026' });

    await userEvent.click(document.querySelectorAll('.cal-cell:not(.empty)')[2]);
    getNote.mockResolvedValue({ id: 3, title: 'Roadmap', content: '' });
    await userEvent.click(document.querySelector('.cal-cell.today'));
    await screen.findByText('Roadmap');

    await act(async () => { reject(new Error('offline')); });

    // The failure belongs to a day the reader left; it must not replace what they are reading now.
    expect(screen.getByText('Roadmap')).toBeInTheDocument();
    expect(screen.queryByText("Couldn't load")).not.toBeInTheDocument();
  });

  it('replaces the grid with a retry when the month fails to load', async () => {
    calendar.mockRejectedValueOnce(new Error('offline'));
    renderCalendar();

    // An empty grid would be a positive claim that nothing is scheduled this month.
    expect(await screen.findByText("Couldn't load")).toBeInTheDocument();
    expect(document.querySelector('.cal-grid')).toBeNull();
    expect(screen.getByTestId('toast-region-alert')).toHaveTextContent('No connection to the server.');

    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByRole('heading', { name: 'August 2026' })).toBeInTheDocument();
    expect(document.querySelector('.cal-grid')).not.toBeNull();
  });
});
