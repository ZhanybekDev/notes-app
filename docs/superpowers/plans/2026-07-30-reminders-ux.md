# Reminders UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Linking Telegram completes without a page reload, the app offers the browser's time zone instead of leaving UTC, and the reminder hint tells the truth about dates that have gone by.

**Architecture:** Two new frontend units carry the logic. `reminderStatus.js` is a pure function deciding whether a note's reminder is scheduled, already past, or switched off — no React, no locale. `hooks/useTelegramLink.js` owns a small state machine and the polling timers so `Settings.jsx` stays about layout. Everything else is wiring in existing components.

**Tech Stack:** React 18, Vite, vitest + @testing-library/react (`renderHook` is available in v15), the existing `i18n.jsx` catalogue.

## Global Constraints

- Frontend only. No backend change, no migration, `backend/openapi.json` must stay byte-identical.
- Every new string exists in both `en` and `ru`. The catalogue parity test in `i18n.test.jsx` enforces this and will fail otherwise.
- Never change a user's stored time zone without an explicit click. Silently moving when notifications arrive is not an improvement.
- Polling stops on success, timeout, request error, and unmount. It never retries through an error.
- Poll interval 2000 ms; give up after 120000 ms; the saved notice clears after 2500 ms.
- `localStorage` access is wrapped in `try/catch` — private mode throws, and `i18n.jsx` already sets this precedent.
- Run commands from `/Users/mak/Desktop/amz/notes-app-telegram`; the frontend runs inside compose, so tests are `docker compose exec -T frontend npm run test`.

---

### Task 1: Reminder status as a pure decision

**Files:**
- Create: `frontend/src/reminderStatus.js`
- Test: `frontend/src/reminderStatus.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `reminderStatus(noteDate, prefs, now = new Date()) → null | { kind }` where `kind` is one of the exported constants `REMINDER_OFF`, `REMINDER_PASSED`, `REMINDER_SCHEDULED`; the scheduled shape is `{ kind, date, time }` with `date` an ISO `YYYY-MM-DD` string and `time` an `HH:MM` string. Also `formatNoteDate(isoDate, locale) → string`. Task 3 consumes both.

The spec says a past date reads "This date has already passed". One case it did not pin down: today's date whose time has gone by. The date has not passed, but the moment has — so both collapse into a single `REMINDER_PASSED`, worded about the moment rather than the date. True in both cases, and it neither promises nor denies delivery, which matters because the worker still backfills the last 24 hours.

- [ ] **Step 1: Write the failing test**

```js
// frontend/src/reminderStatus.test.js
import { describe, expect, it } from 'vitest';
import {
  REMINDER_OFF,
  REMINDER_PASSED,
  REMINDER_SCHEDULED,
  formatNoteDate,
  reminderStatus,
} from './reminderStatus.js';

const linked = {
  timezone: 'Asia/Bishkek',
  reminder_time: '09:00:00',
  notifications_enabled: true,
  telegram_linked: true,
};

// 2026-07-30 04:00 UTC is 10:00 in Bishkek — past 09:00 there, and still 29 July in UTC.
const NOW = new Date('2026-07-30T04:00:00Z');

describe('reminderStatus', () => {
  it('returns nothing without a date or without settings', () => {
    expect(reminderStatus(null, linked, NOW)).toBeNull();
    expect(reminderStatus('2026-08-01', null, NOW)).toBeNull();
  });

  it('reports off when notifications are disabled', () => {
    const prefs = { ...linked, notifications_enabled: false };
    expect(reminderStatus('2026-08-01', prefs, NOW).kind).toBe(REMINDER_OFF);
  });

  it('reports off when Telegram is not linked', () => {
    const prefs = { ...linked, telegram_linked: false };
    expect(reminderStatus('2026-08-01', prefs, NOW).kind).toBe(REMINDER_OFF);
  });

  it('schedules a future date and carries the date and time', () => {
    expect(reminderStatus('2026-08-01', linked, NOW)).toEqual({
      kind: REMINDER_SCHEDULED,
      date: '2026-08-01',
      time: '09:00',
    });
  });

  it('treats an earlier date as passed', () => {
    expect(reminderStatus('2026-07-29', linked, NOW).kind).toBe(REMINDER_PASSED);
  });

  it('treats today as passed once the time has gone by in the account zone', () => {
    expect(reminderStatus('2026-07-30', linked, NOW).kind).toBe(REMINDER_PASSED);
  });

  it('still schedules today when the time is ahead in the account zone', () => {
    const prefs = { ...linked, reminder_time: '23:30:00' };
    expect(reminderStatus('2026-07-30', prefs, NOW).kind).toBe(REMINDER_SCHEDULED);
  });

  it('uses the account zone, not the runtime zone', () => {
    // Same instant, a zone where it is still 29 July: the 30th is then in the future.
    const prefs = { ...linked, timezone: 'Etc/GMT+12' };
    expect(reminderStatus('2026-07-30', prefs, NOW).kind).toBe(REMINDER_SCHEDULED);
  });
});

describe('formatNoteDate', () => {
  it('formats without shifting the day', () => {
    expect(formatNoteDate('2026-07-30', 'ru')).toBe('30 июля');
    expect(formatNoteDate('2026-07-30', 'en')).toBe('30 July');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker compose exec -T frontend npx vitest run src/reminderStatus.test.js`
Expected: FAIL — cannot resolve `./reminderStatus.js`

- [ ] **Step 3: Write minimal implementation**

```js
// frontend/src/reminderStatus.js
export const REMINDER_OFF = 'off';
export const REMINDER_PASSED = 'passed';
export const REMINDER_SCHEDULED = 'scheduled';

// 'en-CA' renders YYYY-MM-DD, which compares correctly as a plain string against note_date.
const ISO_DATE_LOCALE = 'en-CA';

function todayIn(zone, now) {
  return now.toLocaleDateString(ISO_DATE_LOCALE, { timeZone: zone });
}

function clockIn(zone, now) {
  return now.toLocaleTimeString('en-GB', { timeZone: zone, hour12: false });
}

/**
 * Decide what a note's reminder is doing, from the account's point of view.
 *
 * Both sides of the comparison are taken in the account's zone. Comparing against the browser's
 * today is wrong whenever the two differ: around midnight they disagree and the hint would
 * contradict the worker.
 */
export function reminderStatus(noteDate, prefs, now = new Date()) {
  if (!noteDate || !prefs) return null;
  if (!prefs.notifications_enabled || !prefs.telegram_linked) return { kind: REMINDER_OFF };

  const zone = prefs.timezone;
  const today = todayIn(zone, now);
  if (noteDate < today) return { kind: REMINDER_PASSED };
  if (noteDate === today && prefs.reminder_time <= clockIn(zone, now)) {
    return { kind: REMINDER_PASSED };
  }
  return { kind: REMINDER_SCHEDULED, date: noteDate, time: prefs.reminder_time.slice(0, 5) };
}

/** Build the Date from parts: `new Date('2026-07-30')` is parsed as UTC and can shift a day. */
export function formatNoteDate(isoDate, locale) {
  const [year, month, day] = isoDate.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString(locale, {
    day: 'numeric',
    month: 'long',
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `docker compose exec -T frontend npx vitest run src/reminderStatus.test.js`
Expected: PASS — 9 tests

- [ ] **Step 5: Commit**

```bash
git add frontend/src/reminderStatus.js frontend/src/reminderStatus.test.js
git commit -m "feat: decide reminder status in the account's time zone

Comparing a note's date against the browser's today is wrong whenever the
account sits in a different zone — around midnight the two disagree and the hint
would contradict the worker. Both sides are taken in the account's zone instead.

Today's date with its time already gone is reported as passed alongside earlier
dates: the date has not passed but the moment has, and wording it about the
moment neither promises nor denies delivery, which matters while the worker
still backfills the last 24 hours."
```

---

### Task 2: The linking hook

**Files:**
- Create: `frontend/src/hooks/useTelegramLink.js`
- Test: `frontend/src/hooks/useTelegramLink.test.js`

**Interfaces:**
- Consumes: `api.linkTelegram()` and `api.getSettings()` from `frontend/src/api.js`.
- Produces: `useTelegramLink({ onLinked }) → { status, error, connect, recheck }`. `status` is one of `'idle' | 'requesting' | 'waiting' | 'linked' | 'timeout' | 'error'`. `connect()` and `recheck()` are async and take no arguments. `onLinked` receives the settings object that revealed the binding. Also exports `POLL_INTERVAL_MS` and `POLL_TIMEOUT_MS`. Task 4 consumes all of it.

- [ ] **Step 1: Write the failing test**

```jsx
// frontend/src/hooks/useTelegramLink.test.js
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

import { POLL_TIMEOUT_MS, useTelegramLink } from './useTelegramLink.js';
import { api } from '../api.js';

const UNLINKED = { telegram_linked: false, timezone: 'UTC', reminder_time: '09:00:00' };
const LINKED = { ...UNLINKED, telegram_linked: true, telegram_username: 'alice' };

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(window, 'open').mockImplementation(() => null);
  vi.spyOn(api, 'linkTelegram').mockResolvedValue({
    deep_link_url: 'https://t.me/bot?start=code',
    expires_at: '2026-07-30T12:00:00Z',
  });
});

afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('useTelegramLink', () => {
  it('opens the deep link and waits', async () => {
    vi.spyOn(api, 'getSettings').mockResolvedValue(UNLINKED);
    const { result } = renderHook(() => useTelegramLink({ onLinked: vi.fn() }));

    await result.current.connect();

    expect(window.open).toHaveBeenCalledWith(
      'https://t.me/bot?start=code',
      '_blank',
      'noopener'
    );
    await waitFor(() => expect(result.current.status).toBe('waiting'));
  });

  it('reaches linked once the binding appears and reports it once', async () => {
    const onLinked = vi.fn();
    vi.spyOn(api, 'getSettings')
      .mockResolvedValueOnce(UNLINKED)
      .mockResolvedValueOnce(UNLINKED)
      .mockResolvedValue(LINKED);
    const { result } = renderHook(() => useTelegramLink({ onLinked }));

    await result.current.connect();
    await vi.advanceTimersByTimeAsync(6000);

    expect(result.current.status).toBe('linked');
    expect(onLinked).toHaveBeenCalledTimes(1);
    expect(onLinked).toHaveBeenCalledWith(LINKED);
  });

  it('stops polling once linked', async () => {
    vi.spyOn(api, 'getSettings').mockResolvedValue(LINKED);
    const { result } = renderHook(() => useTelegramLink({ onLinked: vi.fn() }));

    await result.current.connect();
    await vi.advanceTimersByTimeAsync(2000);
    const callsWhenLinked = api.getSettings.mock.calls.length;
    await vi.advanceTimersByTimeAsync(20000);

    expect(api.getSettings.mock.calls.length).toBe(callsWhenLinked);
  });

  it('gives up after the timeout and stops polling', async () => {
    vi.spyOn(api, 'getSettings').mockResolvedValue(UNLINKED);
    const { result } = renderHook(() => useTelegramLink({ onLinked: vi.fn() }));

    await result.current.connect();
    await vi.advanceTimersByTimeAsync(POLL_TIMEOUT_MS + 1000);
    const callsAtTimeout = api.getSettings.mock.calls.length;
    await vi.advanceTimersByTimeAsync(20000);

    expect(result.current.status).toBe('timeout');
    expect(api.getSettings.mock.calls.length).toBe(callsAtTimeout);
  });

  it('stops on a failed poll instead of retrying blindly', async () => {
    vi.spyOn(api, 'getSettings').mockRejectedValue(new Error('Unauthorized'));
    const { result } = renderHook(() => useTelegramLink({ onLinked: vi.fn() }));

    await result.current.connect();
    await vi.advanceTimersByTimeAsync(2000);
    const callsAtError = api.getSettings.mock.calls.length;
    await vi.advanceTimersByTimeAsync(20000);

    expect(result.current.status).toBe('error');
    expect(result.current.error).toBe('Unauthorized');
    expect(api.getSettings.mock.calls.length).toBe(callsAtError);
  });

  it('surfaces a failure to issue the link and never starts polling', async () => {
    vi.spyOn(api, 'getSettings').mockResolvedValue(UNLINKED);
    api.linkTelegram.mockRejectedValue(new Error('Telegram bot is not configured'));
    const { result } = renderHook(() => useTelegramLink({ onLinked: vi.fn() }));

    await result.current.connect();

    expect(result.current.status).toBe('error');
    expect(result.current.error).toBe('Telegram bot is not configured');
    expect(api.getSettings).not.toHaveBeenCalled();
  });

  it('leaves no timer behind when unmounted mid-wait', async () => {
    vi.spyOn(api, 'getSettings').mockResolvedValue(UNLINKED);
    const { result, unmount } = renderHook(() => useTelegramLink({ onLinked: vi.fn() }));

    await result.current.connect();
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    unmount();

    expect(vi.getTimerCount()).toBe(0);
  });

  it('recheck finds a binding without waiting for the next poll', async () => {
    const onLinked = vi.fn();
    vi.spyOn(api, 'getSettings').mockResolvedValue(UNLINKED);
    const { result } = renderHook(() => useTelegramLink({ onLinked }));
    await result.current.connect();
    await vi.advanceTimersByTimeAsync(POLL_TIMEOUT_MS + 1000);
    expect(result.current.status).toBe('timeout');

    api.getSettings.mockResolvedValue(LINKED);
    await result.current.recheck();

    expect(result.current.status).toBe('linked');
    expect(onLinked).toHaveBeenCalledWith(LINKED);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker compose exec -T frontend npx vitest run src/hooks/useTelegramLink.test.js`
Expected: FAIL — cannot resolve `./useTelegramLink.js`

- [ ] **Step 3: Write minimal implementation**

```js
// frontend/src/hooks/useTelegramLink.js
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api.js';

export const POLL_INTERVAL_MS = 2000;
export const POLL_TIMEOUT_MS = 120000;

/**
 * Drive the Telegram linking handshake without asking the user to reload.
 *
 * Binding happens in Telegram, out of the app's sight, so the page asks its own settings endpoint
 * until the answer changes. The loop stops on success, on timeout, on a failed request and on
 * unmount — polling through an error would hide a broken session behind a spinner that never
 * resolves.
 */
export function useTelegramLink({ onLinked }) {
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState(null);
  const intervalRef = useRef(null);
  const timeoutRef = useRef(null);
  const onLinkedRef = useRef(onLinked);

  useEffect(() => {
    onLinkedRef.current = onLinked;
  });

  const stop = useCallback(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    intervalRef.current = null;
    timeoutRef.current = null;
  }, []);

  useEffect(() => stop, [stop]);

  const check = useCallback(async () => {
    try {
      const settings = await api.getSettings();
      if (!settings.telegram_linked) return false;
      stop();
      setStatus('linked');
      onLinkedRef.current?.(settings);
      return true;
    } catch (err) {
      stop();
      setError(err.message);
      setStatus('error');
      return false;
    }
  }, [stop]);

  const connect = useCallback(async () => {
    setError(null);
    setStatus('requesting');
    let url;
    try {
      ({ deep_link_url: url } = await api.linkTelegram());
    } catch (err) {
      setError(err.message);
      setStatus('error');
      return;
    }
    window.open(url, '_blank', 'noopener');
    setStatus('waiting');
    intervalRef.current = setInterval(check, POLL_INTERVAL_MS);
    timeoutRef.current = setTimeout(() => {
      stop();
      setStatus('timeout');
    }, POLL_TIMEOUT_MS);
  }, [check, stop]);

  const recheck = useCallback(async () => {
    setError(null);
    setStatus('waiting');
    const linked = await check();
    // check() has already moved to 'error' if the request failed; leave that alone.
    if (!linked) setStatus((prev) => (prev === 'error' ? prev : 'timeout'));
  }, [check]);

  return { status, error, connect, recheck };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `docker compose exec -T frontend npx vitest run src/hooks/useTelegramLink.test.js`
Expected: PASS — 8 tests

- [ ] **Step 5: Commit**

```bash
git add frontend/src/hooks/useTelegramLink.js frontend/src/hooks/useTelegramLink.test.js
git commit -m "feat: poll for the Telegram binding instead of asking for a reload

Binding happens in Telegram, out of the app's sight, so the page asks its own
settings endpoint until the answer changes. The loop stops on success, timeout,
a failed request and unmount; a failed poll ends it rather than retrying, since
polling through an error hides a broken session behind a spinner that never
resolves.

The timers live in a hook rather than in Settings.jsx, which is already near 270
lines and should describe layout, not run a state machine."
```

---

### Task 3: An honest hint in the editor

**Files:**
- Modify: `frontend/src/components/NoteEditor.jsx` (the `reminderHint` block, currently lines 49-62)
- Modify: `frontend/src/i18n.jsx` (the `editor` branch of both `en` and `ru`)
- Test: `frontend/src/components/NoteEditor.test.jsx` (create)

**Interfaces:**
- Consumes: `reminderStatus`, `formatNoteDate`, `REMINDER_OFF`, `REMINDER_PASSED`, `REMINDER_SCHEDULED` from Task 1.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the failing test**

```jsx
// frontend/src/components/NoteEditor.test.jsx
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
    renderEditor({ note: { note_date: '2026-08-01', title: 'x', content: '', tags: [] }, reminderPrefs: PREFS });

    expect(screen.getByText('Reminder on 1 August at 09:00')).toBeInTheDocument();
  });

  it('says the moment has passed for an earlier date', () => {
    renderEditor({ note: { note_date: '2026-07-29', title: 'x', content: '', tags: [] }, reminderPrefs: PREFS });

    expect(screen.getByText('That moment has already passed')).toBeInTheDocument();
  });

  it('says the moment has passed for today once its time is gone', () => {
    renderEditor({ note: { note_date: '2026-07-30', title: 'x', content: '', tags: [] }, reminderPrefs: PREFS });

    expect(screen.getByText('That moment has already passed')).toBeInTheDocument();
  });

  it('points at settings when reminders are off', () => {
    const prefs = { ...PREFS, notifications_enabled: false };
    renderEditor({ note: { note_date: '2026-08-01', title: 'x', content: '', tags: [] }, reminderPrefs: prefs });

    expect(screen.getByText(/Reminders are off/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Settings' })).toBeInTheDocument();
  });

  it('reports a failed settings fetch', () => {
    renderEditor({
      note: { note_date: '2026-08-01', title: 'x', content: '', tags: [] },
      reminderPrefsFailed: true,
    });

    expect(screen.getByText('Could not load reminder settings')).toBeInTheDocument();
  });

  it('shows no hint when the note has no date', () => {
    renderEditor({ note: { note_date: null, title: 'x', content: '', tags: [] }, reminderPrefs: PREFS });

    expect(screen.queryByText(/Reminder on/)).not.toBeInTheDocument();
    expect(screen.queryByText(/already passed/)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker compose exec -T frontend npx vitest run src/components/NoteEditor.test.jsx`
Expected: FAIL — the hint still renders "Reminder at 09:00"; the new copy is absent

- [ ] **Step 3: Add the strings to both catalogues**

In `frontend/src/i18n.jsx`, inside `en.editor`, replace the line `reminderAt: 'Reminder at {time}',` with:

```js
      reminderScheduled: 'Reminder on {date} at {time}',
      reminderPassed: 'That moment has already passed',
```

Inside `ru.editor`, replace `reminderAt: 'Напоминание в {time}',` with:

```js
      reminderScheduled: 'Напоминание {date} в {time}',
      reminderPassed: 'Момент напоминания уже прошёл',
```

- [ ] **Step 4: Rewrite the hint block**

In `frontend/src/components/NoteEditor.jsx`, add to the imports:

```js
import {
  REMINDER_OFF,
  REMINDER_PASSED,
  REMINDER_SCHEDULED,
  formatNoteDate,
  reminderStatus,
} from '../reminderStatus.js';
```

Change `const { t } = useLang();` to:

```js
  const { lang, t } = useLang();
```

Replace the whole `reminderHint` block (the comment plus the `if/else if` chain) with:

```js
  // One source of truth for the hint, so the failure and success cases cannot both render.
  let reminderHint = null;
  if (reminderPrefsFailed) {
    reminderHint = t('editor.reminderUnknown');
  } else {
    const status = reminderStatus(draft.note_date, reminderPrefs);
    if (status?.kind === REMINDER_SCHEDULED) {
      reminderHint = t('editor.reminderScheduled', {
        date: formatNoteDate(status.date, lang),
        time: status.time,
      });
    } else if (status?.kind === REMINDER_PASSED) {
      reminderHint = t('editor.reminderPassed');
    } else if (status?.kind === REMINDER_OFF) {
      reminderHint = (
        <>
          {t('editor.reminderOff')} <Link to="/settings">{t('editor.reminderSettingsLink')}</Link>
        </>
      );
    }
  }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `docker compose exec -T frontend npm run test`
Expected: PASS — `NoteEditor.test.jsx` 6 tests, and the catalogue parity test in `i18n.test.jsx` still green because both languages changed together

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/NoteEditor.jsx frontend/src/components/NoteEditor.test.jsx frontend/src/i18n.jsx
git commit -m "feat: say when the reminder fires, and when it already has

The hint reported a bare time, so a note dated last month looked exactly like
one dated tomorrow. It now names the day and the time, and for anything already
behind us says so instead.

The passed wording is about the moment rather than the date, which covers
today's date with its time gone by and avoids claiming a reminder will not
arrive — the worker still backfills the last 24 hours, and reproducing that
constant in the frontend would leave a backend value free to drift."
```

---

### Task 4: Linking without a reload, in the page

**Files:**
- Modify: `frontend/src/pages/Settings.jsx`
- Modify: `frontend/src/i18n.jsx` (the `settings` and `tips` branches of both languages)
- Modify: `frontend/src/styles.css`
- Test: `frontend/src/pages/Settings.test.jsx`

**Interfaces:**
- Consumes: `useTelegramLink` from Task 2.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the failing test**

Append inside the existing `describe('Settings — Telegram reminders', ...)` block in `frontend/src/pages/Settings.test.jsx`:

```jsx
  it('waits for the binding and connects without a reload', async () => {
    const user = userEvent.setup();
    vi.spyOn(api, 'getSettings')
      .mockResolvedValueOnce(UNLINKED)
      .mockResolvedValue(LINKED);
    vi.spyOn(api, 'linkTelegram').mockResolvedValue({
      deep_link_url: 'https://t.me/test_bot?start=code123',
      expires_at: '2026-07-30T12:00:00Z',
    });
    vi.spyOn(window, 'open').mockImplementation(() => null);

    renderSettings();
    await user.click(await screen.findByRole('button', { name: 'Connect Telegram' }));

    expect(await screen.findByText(/Waiting for confirmation/)).toBeInTheDocument();
    expect(await screen.findByText('Connected as @alice_tg')).toBeInTheDocument();
  });

  it('disables the connect button while waiting', async () => {
    const user = userEvent.setup();
    vi.spyOn(api, 'getSettings').mockResolvedValue(UNLINKED);
    vi.spyOn(api, 'linkTelegram').mockResolvedValue({
      deep_link_url: 'https://t.me/test_bot?start=code123',
      expires_at: '2026-07-30T12:00:00Z',
    });
    vi.spyOn(window, 'open').mockImplementation(() => null);

    renderSettings();
    const connect = await screen.findByRole('button', { name: 'Connect Telegram' });
    await user.click(connect);

    await waitFor(() => expect(connect).toBeDisabled());
  });

  it('surfaces a failure to issue the link', async () => {
    const user = userEvent.setup();
    vi.spyOn(api, 'getSettings').mockResolvedValue(UNLINKED);
    vi.spyOn(api, 'linkTelegram').mockRejectedValue(new Error('bot is not configured'));

    renderSettings();
    await user.click(await screen.findByRole('button', { name: 'Connect Telegram' }));

    expect(await screen.findByText('bot is not configured')).toBeInTheDocument();
  });

  it('clears the saved confirmation on its own', async () => {
    const user = userEvent.setup();
    vi.spyOn(api, 'getSettings').mockResolvedValue(UNLINKED);
    vi.spyOn(api, 'updateSettings').mockResolvedValue({
      ...UNLINKED,
      notifications_enabled: true,
    });

    renderSettings();
    await user.click(await screen.findByRole('checkbox'));
    const saved = await screen.findByText('Saved.');

    // Real timers on purpose. Fake timers plus userEvent plus Testing Library's async wrapper is
    // a known source of flakes, and 2.5s once is cheaper than a test that fails at random.
    await waitForElementToBeRemoved(saved, { timeout: 4000 });
  });
```

Add `waitForElementToBeRemoved` to the existing `@testing-library/react` import in this file. Leave
the `LINKED` and `UNLINKED` fixtures as they are — Task 5 relies on `LINKED` carrying
`Asia/Bishkek`.

- [ ] **Step 2: Run test to verify it fails**

Run: `docker compose exec -T frontend npx vitest run src/pages/Settings.test.jsx`
Expected: FAIL — no "Waiting for confirmation" text; the saved notice never clears

- [ ] **Step 3: Add the strings to both catalogues**

In `frontend/src/i18n.jsx`, inside `en.settings`, replace the line
`linkOpened: 'Telegram opened. Press Start there, then reload this page.',` with:

```js
      linkWaiting: 'Waiting for confirmation in Telegram…',
      linkTimedOut: 'Start does not seem to have been pressed yet.',
      linkRecheck: 'Check again',
```

Inside `ru.settings`, replace
`linkOpened: 'Telegram открыт. Нажмите Start там и обновите эту страницу.',` with:

```js
      linkWaiting: 'Ждём подтверждения в Telegram…',
      linkTimedOut: 'Похоже, Start в Telegram ещё не нажат.',
      linkRecheck: 'Проверить ещё раз',
```

In `en.tips` add `linkRecheck: 'Ask the server whether the binding arrived',`
and in `ru.tips` add `linkRecheck: 'Спросить сервер, дошла ли привязка',`.

- [ ] **Step 4: Wire the hook into the page**

In `frontend/src/pages/Settings.jsx`, add to the imports:

```js
import { useTelegramLink } from '../hooks/useTelegramLink.js';
```

Add the constant next to `listTimeZones`:

```js
const SAVED_NOTICE_MS = 2500;
```

Delete the `linkNotice` state and the whole `connectTelegram` function. **Also delete the
`setLinkNotice(false)` line inside `disconnectTelegram`** — it is the one remaining reference and
leaving it behind breaks unlinking with a ReferenceError. Then add after `patchPrefs`:

```js
  const {
    status: linkStatus,
    error: linkError,
    connect: connectTelegram,
    recheck: recheckTelegram,
  } = useTelegramLink({
    onLinked: (next) => {
      setPrefs(next);
      setTimeDraft(next.reminder_time.slice(0, 5));
    },
  });

  // The confirmation used to sit there for the rest of the session.
  useEffect(() => {
    if (!prefsSaved) return undefined;
    const id = setTimeout(() => setPrefsSaved(false), SAVED_NOTICE_MS);
    return () => clearTimeout(id);
  }, [prefsSaved]);
```

Replace the not-linked branch of `telegram-status` — the fragment holding `settings.telegramNotConnected` and the connect button — with:

```jsx
                <>
                  <span className="settings-hint">
                    {linkStatus === 'waiting' || linkStatus === 'requesting'
                      ? t('settings.linkWaiting')
                      : t('settings.telegramNotConnected')}
                  </span>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => {
                      setPrefsError(null);
                      connectTelegram();
                    }}
                    disabled={
                      !prefs.bot_configured ||
                      linkStatus === 'requesting' ||
                      linkStatus === 'waiting'
                    }
                    title={t('tips.connectTelegram')}
                  >
                    {t('settings.connectTelegram')}
                  </button>
                  {(linkStatus === 'timeout' || linkStatus === 'error') && (
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={recheckTelegram}
                      title={t('tips.linkRecheck')}
                    >
                      {t('settings.linkRecheck')}
                    </button>
                  )}
                </>
```

Replace the `linkNotice` block below the grid with:

```jsx
        {linkStatus === 'waiting' && (
          <div className="notice-waiting">
            {t('settings.linkWaiting')} {t('settings.linkExpires')}
          </div>
        )}
        {linkStatus === 'timeout' && (
          <div className="notice-warning">{t('settings.linkTimedOut')}</div>
        )}
        {linkError && <div className="error">{linkError}</div>}
```

- [ ] **Step 5: Add the waiting style**

Append to `frontend/src/styles.css`, next to `.notice-warning`:

```css
.notice-waiting {
  background: var(--accent-soft);
  color: var(--accent);
  border: 1px solid var(--accent-ring);
  border-radius: var(--radius-sm);
  padding: 0.6rem 0.8rem;
  font-size: 0.88rem;
  margin-top: 0.75rem;
}
```

- [ ] **Step 6: Confirm nothing still references the removed state**

Run: `docker compose exec -T frontend grep -rn "linkNotice\|linkOpened" src`
Expected: no output. A leftover reference would throw at runtime in a path the tests do not cover.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `docker compose exec -T frontend npm run test`
Expected: PASS — the whole suite, including the parity test

- [ ] **Step 8: Commit**

```bash
git add frontend/src/pages/Settings.jsx frontend/src/pages/Settings.test.jsx frontend/src/i18n.jsx frontend/src/styles.css
git commit -m "feat: finish linking on the page instead of asking for a reload

The section used to tell the user to refresh, which is an admission that the
screen is lying to them. It now waits for the binding and redraws itself, with
Check again offered when the wait times out or a request fails.

Connect is disabled while waiting: pressing it again would issue a fresh code
and silently invalidate the link already open in Telegram.

The saved confirmation, which sat there for the rest of the session, clears
after a couple of seconds."
```

---

### Task 5: Offer the browser's time zone

**Files:**
- Modify: `frontend/src/pages/Settings.jsx`
- Modify: `frontend/src/i18n.jsx` (the `settings` and `tips` branches of both languages)
- Modify: `frontend/src/styles.css`
- Test: `frontend/src/pages/Settings.test.jsx`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the failing test**

Append inside the same `describe` block in `frontend/src/pages/Settings.test.jsx`:

```jsx
  it('offers the browser time zone while the account is still on UTC', async () => {
    vi.spyOn(Intl, 'DateTimeFormat').mockReturnValue({
      resolvedOptions: () => ({ timeZone: 'Asia/Bishkek' }),
    });
    vi.spyOn(api, 'getSettings').mockResolvedValue(UNLINKED);

    renderSettings();

    expect(await screen.findByText(/Asia\/Bishkek/)).toBeInTheDocument();
  });

  it('applies the suggested zone in one click', async () => {
    const user = userEvent.setup();
    vi.spyOn(Intl, 'DateTimeFormat').mockReturnValue({
      resolvedOptions: () => ({ timeZone: 'Asia/Bishkek' }),
    });
    vi.spyOn(api, 'getSettings').mockResolvedValue(UNLINKED);
    const update = vi
      .spyOn(api, 'updateSettings')
      .mockResolvedValue({ ...UNLINKED, timezone: 'Asia/Bishkek' });

    renderSettings();
    await user.click(await screen.findByRole('button', { name: 'Use it' }));

    expect(update).toHaveBeenCalledWith({ timezone: 'Asia/Bishkek' });
  });

  it('stays quiet once the account has a zone of its own', async () => {
    vi.spyOn(Intl, 'DateTimeFormat').mockReturnValue({
      resolvedOptions: () => ({ timeZone: 'Asia/Bishkek' }),
    });
    vi.spyOn(api, 'getSettings').mockResolvedValue(LINKED); // LINKED carries Asia/Bishkek

    renderSettings();
    await screen.findByText('Connected as @alice_tg');

    expect(screen.queryByRole('button', { name: 'Use it' })).not.toBeInTheDocument();
  });

  it('remembers a dismissal', async () => {
    const user = userEvent.setup();
    vi.spyOn(Intl, 'DateTimeFormat').mockReturnValue({
      resolvedOptions: () => ({ timeZone: 'Asia/Bishkek' }),
    });
    vi.spyOn(api, 'getSettings').mockResolvedValue(UNLINKED);

    const { unmount } = renderSettings();
    await user.click(await screen.findByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('button', { name: 'Use it' })).not.toBeInTheDocument();
    unmount();

    renderSettings();
    await screen.findByRole('checkbox');
    expect(screen.queryByRole('button', { name: 'Use it' })).not.toBeInTheDocument();
  });
```

Add `localStorage.clear();` to the existing `beforeEach` in this file so the dismissal does not leak between tests.

- [ ] **Step 2: Run test to verify it fails**

Run: `docker compose exec -T frontend npx vitest run src/pages/Settings.test.jsx`
Expected: FAIL — no "Use it" button exists

- [ ] **Step 3: Add the strings to both catalogues**

In `en.settings` add:

```js
      timezoneSuggestion: 'Looks like your time zone is {zone}',
      timezoneSuggestionApply: 'Use it',
      timezoneSuggestionDismiss: 'Dismiss',
```

In `ru.settings` add:

```js
      timezoneSuggestion: 'Похоже, ваш часовой пояс — {zone}',
      timezoneSuggestionApply: 'Использовать',
      timezoneSuggestionDismiss: 'Скрыть',
```

In `en.tips` add:

```js
      timezoneSuggestionApply: 'Set the account to this zone',
      timezoneSuggestionDismiss: 'Hide this suggestion for good',
```

In `ru.tips` add:

```js
      timezoneSuggestionApply: 'Поставить аккаунту эту зону',
      timezoneSuggestionDismiss: 'Больше не предлагать',
```

- [ ] **Step 4: Implement the suggestion**

In `frontend/src/pages/Settings.jsx`, add next to `listTimeZones`:

```js
const TZ_DISMISS_KEY = 'notes_tz_suggestion_dismissed';

function browserTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

function readDismissed() {
  try {
    return localStorage.getItem(TZ_DISMISS_KEY) === '1';
  } catch {
    return false;
  }
}
```

Add the state next to `timeDraft`:

```js
  const [tzDismissed, setTzDismissed] = useState(readDismissed);
```

Add the derived value next to `timeZones`:

```js
  const suggestedZone = useMemo(() => browserTimeZone(), []);
  // Suggest, never apply: changing a stored zone moves every future reminder without asking.
  // 'UTC' is the untouched server default, so anything else means the user has already chosen.
  const showTzSuggestion =
    prefs !== null &&
    prefs.timezone === 'UTC' &&
    Boolean(suggestedZone) &&
    suggestedZone !== 'UTC' &&
    !tzDismissed;

  const dismissTzSuggestion = () => {
    try {
      localStorage.setItem(TZ_DISMISS_KEY, '1');
    } catch {
      // Private mode; the suggestion simply returns next time.
    }
    setTzDismissed(true);
  };
```

Insert directly above the time zone `<label>` inside `notifications-grid`:

```jsx
            {showTzSuggestion && (
              <div className="tz-suggestion">
                <span>{t('settings.timezoneSuggestion', { zone: suggestedZone })}</span>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => patchPrefs({ timezone: suggestedZone })}
                  title={t('tips.timezoneSuggestionApply')}
                >
                  {t('settings.timezoneSuggestionApply')}
                </button>
                <button
                  type="button"
                  className="link-button"
                  onClick={dismissTzSuggestion}
                  title={t('tips.timezoneSuggestionDismiss')}
                >
                  {t('settings.timezoneSuggestionDismiss')}
                </button>
              </div>
            )}
```

- [ ] **Step 5: Add the style**

Append to `frontend/src/styles.css`:

```css
.tz-suggestion {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  flex-wrap: wrap;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 0.5rem 0.7rem;
  font-size: 0.85rem;
  color: var(--text-muted);
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `docker compose exec -T frontend npm run test`
Expected: PASS — the whole suite

- [ ] **Step 7: Verify the gates and commit**

```bash
docker compose exec -T frontend npm run lint
docker compose exec -T frontend npm run build
git add frontend/src/pages/Settings.jsx frontend/src/pages/Settings.test.jsx frontend/src/i18n.jsx frontend/src/styles.css
git commit -m "feat: offer the browser time zone instead of leaving the account on UTC

A reminder set to 09:00 fired at 09:00 UTC until the user found their own zone
among 418 entries, and the browser knew the answer all along.

Offered, not applied. Detecting the zone and setting it would move every future
reminder for an existing account without asking, so the suggestion appears only
while the stored zone is still the untouched default and can be dismissed for
good — otherwise somebody who genuinely wants UTC while sitting in Bishkek would
be nagged with no way out."
```

---

## Verification after the last task

```bash
docker compose exec -T frontend npm run lint
docker compose exec -T frontend npm run test
docker compose exec -T frontend npm run build
git status --short   # backend/openapi.json must not appear
```

Then walk the flow by hand at <http://localhost:5173/settings>: press **Connect Telegram**, press Start in Telegram, and watch the section become connected without touching the address bar.
