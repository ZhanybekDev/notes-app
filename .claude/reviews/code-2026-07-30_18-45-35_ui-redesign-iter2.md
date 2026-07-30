# Code Review — ui-redesign (iteration 2)

**Timestamp:** 2026-07-30 18:45:35
**Verdict:** `NEEDS_FIX`
**Iteration:** 2 of max 2 → **escalation**
**Review target:** `7792923` — the fix pass for iteration 1's C1–C4 (+659 / −429, 16 files)
**Files reviewed:** 16
**Blocking findings:** 0
**Critical findings:** 2 (both **introduced by the fix pass**)
**Minor findings:** 6
**Hard Rules violations:** 0

---

## Closure check on iteration 1

| # | Iter-1 finding | Status | Evidence |
|---|---|---|---|
| C1 | English toast for `lang: null` | ✅ closed | `accountStore.js:58-60` goes through `selectLang`; `accountStore.test.js` asserts `Сохранено.` for a `ru-RU` browser with `lang: null` **and** for an explicit `ru` |
| C2 | 401 raised a red alert on the login form | ✅ closed | `uiStore.js:69-72` drops `status === 401`; asserted at the store (`uiStore.test.js`) and at the seam (`App.test.jsx:88-104`) |
| C3 | "No notes yet" during the first 300ms | ⚠️ closed for the first paint, **broke the refresh case** → **C5** | `NoteList.jsx:28-30` + deferred-promise test in `Notes.test.jsx` |
| C4 | one day's notes under another day's heading | ⚠️ closed for the failure path, **open for the race path** → **C6** | `Calendar.jsx:64-83` clears before the fetch; test covers the rejection, not the overlap |

Both new Criticals are the same defects re-entering through a door the fix did not close. That is the
argument for one more pass rather than accepting them: the fix pass proved the tests were the missing
part, and each of these needs one more.

---

## Critical Findings

### C5. The empty-result message now blinks on every keystroke

- **Dimension:** D1 Correctness / D2 Integration
- **Where:** `frontend/src/pages/Notes.jsx:52` + `frontend/src/stores/notesStore.js:60` +
  `frontend/src/components/NoteList.jsx:28-30`
- **Problem:** the store decides the status from `items.length`, which conflates "no answer yet" with
  "an answer that was empty":
  ```js
  // stores/notesStore.js:60
  set({ status: get().items.length ? 'ready' : 'loading' });
  ```
  For a non-empty list this is the intended behaviour — the list stays visible while it refreshes. For
  an empty one the next load flips the status to `loading`, the page turns that into `pending`, and the
  new guard in `NoteList` renders **nothing**. Concretely: type `zzz`, get "Nothing found", type one
  more character — the message vanishes and comes back on every keystroke. Same on a tag switch, a tab
  switch, and inside an empty Archive.

  The C3 fix therefore traded a 300ms falsehood for a flicker on a common path, and introduced an
  asymmetry that is hard to justify: a stale *list* survives a refresh, a stale *empty message* does
  not.
- **Evidence:** `NoteList.jsx:28-30`
  ```jsx
  if (pending && !notes.length) {
    return null;
  }
  ```
  `Notes.jsx:52` — `const pending = status === 'idle' || status === 'loading';`
  No test covers a refresh over an empty result, which is why 183 tests pass.
- **Suggested fix:** distinguish "never answered" from "answered, empty". Add `loaded: false` to
  `notesStore`, flip it to `true` on the first settled response, and set `status: 'loading'` only when
  `!loaded`; the page computes `pending = !loaded`. First paint stays blank (C3 stays closed), an empty
  result survives a refresh, and a retry after a failed first load still shows the skeleton. Test:
  render with an empty result, type a character, assert the "Nothing found" text never leaves the DOM.

### C6. `openDay` has no stale-answer guard, so C4 returns as a race

- **Dimension:** D1 Correctness
- **Where:** `frontend/src/pages/Calendar.jsx:64-83`
- **Problem:** the fix drops the previous day's notes before fetching, which closes the *failure*
  path. The *overlap* path is untouched: `openDay` awaits `Promise.all` and writes the result with no
  check that its date is still the selected one. Click day A (slow, several `getNote` calls), then day
  B (fast) — B resolves and renders, then A resolves and overwrites `notesForDay`, leaving A's notes
  under B's heading and `dayStatus: 'ready'` asserting it is fine. Exactly the state the commit
  message claims to have made impossible.

  The month load next to it *does* guard (`let alive = true` … `if (alive)`), and `notesStore` carries
  the ticket pattern for this same problem (`latestRequest`, with a comment explaining that the slowest
  answer otherwise wins). Both precedents were available and neither was applied.
- **Evidence:**
  ```jsx
  const openDay = async (date) => {
    setSelectedDate(date);
    setDayStatus('ready');
    …
    setNotesForDay([]);
    setDayStatus('loading');
    try {
      const fetched = await Promise.all(day.note_ids.map((id) => api.getNote(id)));
      setNotesForDay(fetched);      // no check that `date` is still the open day
      setDayStatus('ready');
    } catch (err) {
      setDayStatus('error');        // same for the failure branch
      reportFailure(err);
    }
  };
  ```
- **Suggested fix:** a ref holding the date of the most recent open (`openRef.current = date` before
  the await, `if (openRef.current !== date) return;` after it, in both branches). Test: make `getNote`
  resolve on a controllable delay, open day A then day B, resolve A last, assert B's notes are on
  screen and A's are not.

---

## Minor Findings

- **M9** `stores/uiStore.js:53` — `slice(-MAX_VISIBLE)` evicts the oldest toast unconditionally,
  which defeats pause-on-hover (the reader can be holding a toast that gets dropped from under them)
  and lets three trivial successes push an error out of the queue. Evicting the oldest *of the same
  kind*, or refusing to evict a hovered toast, matches the WCAG 2.2.1 intent the pause was added for.
- **M10** `stores/uiStore.js:70-71` — `err?.message ?? String(err)` prints `[object Object]` for a
  rejection that is neither an `Error` nor a string. The new test covers the string case only.
- **M11** `components/LoadFailure.jsx` — a component shared by the notes list, the calendar grid and
  one calendar day reads `notes.loadFailedTitle` / `notes.loadFailedHint` / `notes.retry`. The keys now
  misdescribe their scope; `common.*` would match what the component is.
- **M12** `stores/accountStore.test.js:150-153` — the `beforeEach` resets `useUiStore` by hand, but
  `test/setup.js` already calls `resetStores()` after every test. Harmless, and it teaches the next
  reader that the global reset cannot be relied on.
- **M13** *(carried from iter 1, deliberately unfixed)* toast text for ordinary failures is raw server
  English from `api.js:34`, now announced assertively into a possibly-Russian interface. The commit
  message states this and names the reason (needs an error-code contract) — recorded so it is not
  rediscovered as new.
- **M14** `pages/Calendar.jsx:141-146` — while `dayStatus === 'loading'` the day section renders its
  heading over nothing. The list got a skeleton for exactly this gap; the day did not.

---

## Findings by Dimension

Clean: D3 Performance (the added state is per-screen and shallow), D5 Dead Code (the `MESSAGES`
re-export from `i18n.jsx` is load-bearing — `i18n.test.jsx:5` imports it from there), D7 Code Health
(`i18n.jsx` went from 411 lines to 39; `messages.js` holds the catalogue and nothing else), D9 Reuse
(`LoadFailure` removes a three-way duplication; `reportFailure` removes a six-way one), D10 Security.

D11 Test Coverage — 183 tests, 13 new, one per iteration-1 finding. The gap is structural rather than
sloppy: every new test asserts the *reported* symptom, none asserts the neighbouring state transition,
which is where both C5 and C6 live.

---

## Hard Rules Check

No `CLAUDE.md`; criterion is `docs/architecture.md`. All three rules hold, and one improved: the
"stores are headless" claim is now literally true — `messages.js` carries the catalogue and the pure
`translate`, so no store imports a module that exports React hooks. `LoadFailure` is presentational
and takes `onRetry` as a prop. `api.js` remains the only network seam. The doc was updated in the same
commit that changed the behaviour, including the 401 rule and the empty-state rule.

---

## Blast Radius Analysis

Both Criticals are display-level and scoped to two screens: C5 to the notes list whenever a result set
is empty (search, tag filter, archive), C6 to `/calendar` when two days are opened in quick
succession. Neither can corrupt data, leak state across accounts, or break the auth flow — the 401 fix
was verified at the seam. The blast radius of the *fix* pass itself is wider than its findings: moving
372 lines of catalogue out of `i18n.jsx` touches every screen's text, and the parity test plus 183
green tests are what bound that risk.

---

## Verdict Rationale

Iteration 1's four Criticals are genuinely closed, each with a test. Two new ones came in with the
fixes, both re-opening the defect they were meant to close through a path the fix did not consider —
a refresh over an empty result, and two overlapping day requests. Neither is blocking, both are
one-to-five-line fixes with an obvious test, and both are on paths a user hits without trying.

---

## Next Action

⚠️ **Max iterations reached (2).** Per the skill's own limit this stops here and goes to the user.

Not the usual escalation, though: this is not ship-it failing twice on the same finding. The
iteration-1 list is closed and verified; C5 and C6 are new, arrived with the fixes, and are smaller
than what they replaced. The reasonable calls, in order of what I would pick:

1. One more targeted fix pass on C5 + C6 only (with the two tests named above), then stop reviewing.
2. Accept both knowingly — the flicker is cosmetic, the race needs two fast clicks — and record them
   in `SUBMISSION.md` as known caveats rather than leaving them unwritten.

Archives: `code-2026-07-30_18-30-48_ui-redesign-iter1.md`, this file.
