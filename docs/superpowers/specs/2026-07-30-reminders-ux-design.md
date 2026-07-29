# Reminders UX — design

**Date:** 2026-07-30
**Scope:** the Telegram reminders flow only. No visual redesign, no changes outside that flow.

## Problem

Three points of friction, all inside the feature this branch adds.

1. **Linking demands a manual reload.** After pressing *Connect Telegram* the app learns nothing
   until the page is refreshed, and the UI says so out loud: "Press Start there, then reload this
   page." Telling the user to reload is an admission that the screen is lying to them.
2. **The time zone defaults to UTC.** A reminder set to 09:00 fires at 09:00 UTC until the user
   finds their own zone among 418 entries. The browser knows the answer and is never asked.
3. **The reminder hint is vague and silent about the past.** It reports a time and nothing else,
   so a note dated last month looks exactly like one dated tomorrow.

## Non-goals

- A reminder badge in the note list. It would mean exposing outbox state through `NoteOut` — a new
  field, an OpenAPI regeneration and tests — which is out of proportion for a visual cue.
- Replacing the 418-entry `<select>` with a typeahead. Native selects already jump to an option as
  you type, which covers the case.
- Anything outside the reminders flow: native confirm dialogs, unsaved-edit protection, list empty
  states, raw API error strings. Real problems, separate work.

---

## 1. Linking without a reload

### Behaviour

Pressing *Connect Telegram* issues the deep link, opens it, and puts the section into a waiting
state: the button is replaced by "Waiting for confirmation in Telegram…" alongside the existing
note that the link is valid for fifteen minutes. The page polls its own settings until the binding
appears, then redraws itself as connected. No refresh, no instruction to refresh.

Polling stops for exactly four reasons:

| reason | what the user sees |
| --- | --- |
| binding appeared | connected state, with the Telegram username |
| two minutes elapsed | "Start does not seem to have been pressed yet" + *Check again* |
| a poll request failed | the error text + *Check again* |
| the page unmounted | nothing; timers are cleared |

A failed poll stops the loop rather than retrying blindly. Polling on through an error would hide a
broken session behind a spinner that never resolves.

*Connect Telegram* is disabled while waiting. Pressing it again would issue a fresh code and
silently invalidate the link the user already has open.

### Structure

A hook, `frontend/src/hooks/useTelegramLink.js`, owns the state machine and the timers.
`Settings.jsx` is already near 270 lines; the page should describe layout, not run a polling loop.
The project already keeps `hooks/useShortcuts.js`, so the location is established.

```
useTelegramLink({ onLinked })
  → { status, error, connect(), recheck() }

status: 'idle' | 'requesting' | 'waiting' | 'linked' | 'timeout' | 'error'
```

- `connect()` — `POST /account/telegram/link`, open the returned URL, start polling.
- `recheck()` — one immediate `GET /account/settings`, reachable from `timeout` and `error`.
- `onLinked(settings)` — called once with the fresh settings so the page can update without a
  second request.
- Cleanup on unmount clears both the interval and the timeout.

Constants: poll every 2000 ms, give up after 120000 ms. Both live in the hook.

`POST /account/telegram/link` failing — 503 when the bot is not configured — lands in `error` with
the server's message, same as a failed poll.

### Tests

`useTelegramLink` via `renderHook`, with `api` stubbed: binding on the third poll reaches `linked`
and calls `onLinked` once; no binding reaches `timeout` and stops polling; a rejected poll reaches
`error` and stops polling; unmounting mid-wait leaves no timer running.

---

## 2. Time zone suggested, never imposed

The governing rule: **do not silently change when someone's notifications arrive.** Detecting the
browser zone and applying it would move every future reminder for an existing account without
asking. So the app suggests and the user decides.

Above the time zone select, when *all* of these hold:

- the stored zone is still the untouched default `UTC`,
- `Intl.DateTimeFormat().resolvedOptions().timeZone` returns something other than `UTC`,
- the suggestion has not been dismissed,

a line appears: "Looks like your time zone is Asia/Bishkek", with *Use it* and a dismiss control.
*Use it* patches the setting; the suggestion then disappears on its own, because the stored zone is
no longer `UTC`. Dismissal is remembered in `localStorage` under `notes_tz_suggestion_dismissed`,
matching the existing `notes_lang` convention — without it, somebody who genuinely wants UTC while
sitting in Bishkek gets nagged forever with no way out.

`resolvedOptions().timeZone` can be absent in exotic runtimes; the suggestion simply does not render
in that case.

### Tests

Stored `UTC` + a different browser zone renders the suggestion; *Use it* sends
`PATCH {timezone}` once; dismissing hides it and it stays hidden after a remount; a stored non-UTC
zone renders nothing.

---

## 3. An honest reminder hint

The hint under the date field currently reports a bare time. It becomes specific:

- **date in the future** — "Reminder on 30 July at 09:00", using the account's chosen zone.
- **date already past** — "This date has already passed."
- **reminders off or Telegram unlinked** — unchanged from today: the reason plus a link to settings.
- **settings failed to load** — unchanged: the existing muted failure line.

The past-date wording deliberately states a fact rather than predicting delivery. A note dated
within the last twenty-four hours still fires, because the worker backfills that window, so "will
not arrive" would be wrong — and reproducing the backfill constant in the frontend would duplicate
a backend value across the boundary, free to drift. Stating that the date has passed is true in
every case and needs nothing from the server.

**How past and future are decided.** Comparing `note_date` against the browser's today is wrong
whenever the account's zone differs from the browser's — around midnight the two disagree, and the
hint would contradict the worker. Both sides of the comparison are taken in the account's zone:

```js
const todayThere = new Date().toLocaleDateString('en-CA', { timeZone: prefs.timezone });
// 'en-CA' yields YYYY-MM-DD, which compares correctly as a string against note_date
```

- `note_date > todayThere` → future.
- `note_date < todayThere` → past.
- equal → compare `reminder_time` against the current time in that zone, obtained the same way
  with `toLocaleTimeString('en-GB', { timeZone, hour12: false })`.

The displayed date is formatted with `toLocaleDateString(lang)` so it follows the interface
language, not the browser's.

The "Saved." confirmation in the same section currently never disappears. It clears after 2500 ms,
with the timer cancelled on unmount and on the next change.

### Tests

A future date renders the date and time; a past date renders the passed-date line; reminders off
renders the settings link; the saved confirmation disappears on a timer.

---

## What this touches

| file | change |
| --- | --- |
| `frontend/src/hooks/useTelegramLink.js` | new — polling state machine |
| `frontend/src/pages/Settings.jsx` | uses the hook; time zone suggestion; saved-message timer |
| `frontend/src/components/NoteEditor.jsx` | precise reminder hint |
| `frontend/src/i18n.jsx` | new strings, EN and RU |
| `frontend/src/styles.css` | waiting state, suggestion row |
| `frontend/src/hooks/useTelegramLink.test.js` | new |
| `frontend/src/pages/Settings.test.jsx` | suggestion, waiting state, saved timer |
| `frontend/src/components/NoteEditor.test.jsx` | new — hint cases |

No backend change. No migration. `openapi.json` unaffected.

## Definition of done

- Linking completes without touching the address bar; the instruction to reload is gone.
- Polling provably stops on success, timeout, error and unmount.
- A UTC account in a non-UTC browser is offered its zone once, applies it in one click, and can
  refuse permanently.
- The hint distinguishes future from past.
- Every new string exists in EN and RU — enforced by the catalogue parity test.
- `npm run lint`, `npm run test` and `npm run build` stay green.
