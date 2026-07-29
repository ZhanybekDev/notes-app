import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import NoteEditor from './NoteEditor.jsx';
import { LangProvider } from '../i18n.jsx';

const PREFS = {
  timezone: 'Asia/Bishkek',
  reminder_time: '09:00:00',
  notifications_enabled: true,
  telegram_linked: true,
  bot_configured: true,
};

function renderEditor(props) {
  return render(
    <MemoryRouter>
      <LangProvider>
        <NoteEditor note={null} onSave={vi.fn()} {...props} />
      </LangProvider>
    </MemoryRouter>
  );
}

const note = (note_date) => ({ note_date, title: 'x', content: '', tags: [] });

beforeEach(() => {
  // 2026-07-30 04:00 UTC is 10:00 in Bishkek — past the 09:00 reminder there.
  // Only Date is faked: faking setTimeout too would interfere with Testing Library.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-07-30T04:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('NoteEditor reminder hint', () => {
  it('names the day and time for a future date', () => {
    renderEditor({ note: note('2026-08-01'), reminderPrefs: PREFS });

    expect(screen.getByText('Reminder on August 1 at 09:00')).toBeInTheDocument();
  });

  it('says the moment has passed for an earlier date', () => {
    renderEditor({ note: note('2026-07-29'), reminderPrefs: PREFS });

    expect(screen.getByText('That moment has already passed')).toBeInTheDocument();
  });

  it('says the moment has passed for today once its time is gone', () => {
    renderEditor({ note: note('2026-07-30'), reminderPrefs: PREFS });

    expect(screen.getByText('That moment has already passed')).toBeInTheDocument();
  });

  it('points at settings when reminders are off', () => {
    const prefs = { ...PREFS, notifications_enabled: false };
    renderEditor({ note: note('2026-08-01'), reminderPrefs: prefs });

    expect(screen.getByText(/Reminders are off/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Settings' })).toBeInTheDocument();
  });

  it('reports a failed settings fetch', () => {
    renderEditor({ note: note('2026-08-01'), reminderPrefsFailed: true });

    expect(screen.getByText('Could not load reminder settings')).toBeInTheDocument();
  });

  it('shows no hint when the note has no date', () => {
    renderEditor({ note: note(null), reminderPrefs: PREFS });

    expect(screen.queryByText(/Reminder on/)).not.toBeInTheDocument();
    expect(screen.queryByText(/already passed/)).not.toBeInTheDocument();
  });
});
