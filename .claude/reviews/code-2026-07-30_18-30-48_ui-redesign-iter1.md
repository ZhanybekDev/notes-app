# Code Review — ui-redesign (iteration 1)

**Timestamp:** 2026-07-30 18:30:48
**Verdict:** `NEEDS_FIX`
**Iteration:** 1 of max 2
**Review target:** `50e494a..HEAD` — four shipped phases (`6aff75a`, `18b5e0f`, `d91c26d`, `ebf74cb`)
**Files reviewed:** 27 (+2246 / −1115)
**Blocking findings:** 0
**Critical findings:** 4
**Minor findings:** 8
**Hard Rules violations:** 0 (no `CLAUDE.md` in project — criterion is `docs/architecture.md`)

Working tree is clean; the review reads the committed range, not `git diff`.

---

## Files Reviewed

| File | Changes | Read importers? |
|---|---|---|
| `stores/uiStore.js` | +55 (new) | ✅ `stores/index.js`, `Toaster.jsx`, `notesStore`, `accountStore`, `Calendar.jsx` |
| `stores/notesStore.js` | +21 / −6 | ✅ `Notes.jsx` (only consumer of `status`) |
| `stores/accountStore.js` | +11 | ✅ `Notes.jsx`, `Settings.jsx`; `prefsStore.selectLang` compared |
| `components/Toaster.jsx` | +82 (new) | ✅ `App.jsx`, `Notes.test.jsx`, `Calendar.test.jsx` |
| `components/NoteList.jsx` | +37 / −8 | ✅ `Notes.jsx` — sole caller, all four new props passed |
| `components/Skeleton.jsx` | +25 (new) | ✅ `Notes.jsx` (`SkeletonList`), `Settings.jsx` (`Skeleton`) |
| `hooks/useDelayedFlag.js` | +24 (new) | ✅ `Notes.jsx` |
| `pages/Notes.jsx` | +36 / −14 | ✅ `App.jsx` |
| `pages/Calendar.jsx` | +30 / −8 | ✅ `App.jsx` |
| `pages/Settings.jsx` | +9 / −2 | ✅ 22 existing tests still assert `'Saved.'` |
| `api.js` | unchanged | ✅ read for the 401 contract (`ApiError.status`) |
| `styles/*` (5 files) | +1425 / −1074 | n/a — `styles.css` is the only importer |
| tests (5 files) | +373 / −13 | — |
| `docs/architecture.md`, `SUBMISSION.md` | +60 / −4 | — |

---

## Findings by Dimension

### D1. Correctness

**C1**, **C3**, **C4** below.

### D2. Integration

**C2** below — the new reporting path intersects `api.js`'s 401 contract, which the change did not
account for.

### D4. Error Handling

`report()` in `notesStore` and `notify()` in `accountStore` fire on *every* rejection with no
discrimination by status code. See **C2**.

### D5. Dead Code

`notesStore.error` is now written by six call sites and read by **no UI code** (`Notes.jsx` dropped
its selector in `d91c26d`). The store tests still assert it and `docs/architecture.md` calls it "the
source of truth", so this is a deliberate retention — recorded as **M4**, not as dead code.

### D11. Test Coverage

170 tests pass, 25 new. The gaps are listed as **M7** and **M8**; none of the four Criticals is
covered by a test, which is why they survived a green suite.

### D12. Maintainability

**M5** — a code comment that describes the layout mechanism incorrectly.

---

## Critical Findings

### C1. The settings-saved toast is English for every user who never touched the language toggle

- **Dimension:** D1 Correctness / D2 Integration
- **Where:** `frontend/src/stores/accountStore.js:61`
- **Problem:** the toast reads the language as `usePrefsStore.getState().lang`. That field is `null`
  until the user explicitly picks a language — the documented default. `translate(null, …)` looks up
  `MESSAGES[null]`, gets `undefined`, and falls through to the English fallback in
  `i18n.jsx:358-364`. So a reader whose browser is Russian, who never opened the language toggle,
  sees the entire UI in Russian and one English `Saved.` toast.
- **Evidence:**
  ```js
  // stores/accountStore.js:61
  notify(translate(usePrefsStore.getState().lang, 'settings.settingsSaved'), 'status');
  ```
  ```js
  // stores/prefsStore.js:71-77
  export const selectLang = (state) => state.lang ?? browserLang();
  …
  // null means "never chosen" — read through `selectLang`, which falls back to the browser.
  lang: null,
  ```
  `accountStore.js:61` is the only place in the codebase that reads `.lang` raw for translation;
  `i18n.jsx:383` and `i18n.jsx:401-403` both go through `selectLang`.
- **Suggested fix:** `translate(selectLang(usePrefsStore.getState()), 'settings.settingsSaved')`,
  importing `selectLang` alongside `usePrefsStore`. Add a test that sets `lang: null` and asserts the
  toast text follows the browser language.

### C2. A 401 now puts a red "Unauthorized" alert on the login screen

- **Dimension:** D2 Integration / D4 Error Handling
- **Where:** `frontend/src/stores/notesStore.js` (`report`, 6 call sites),
  `frontend/src/stores/accountStore.js:37`, `frontend/src/pages/Calendar.jsx:50`
- **Problem:** `api.js:28-30` treats 401 as a lifecycle event — it logs out and throws
  `ApiError('Unauthorized', 401)`. Every store catch now converts that rejection into an
  `role="alert"` toast. `<Toaster />` is mounted in `App.jsx` outside the routes, so it survives the
  redirect: an expired token means the user lands on the login form with an assertive, untranslated
  "Unauthorized" banner for eight seconds. Same for a logout performed in another tab followed by any
  request from this one. Before this change the 401 path was silent, because the banner lived in the
  page that unmounted.
- **Evidence:**
  ```js
  // api.js:28-30
  if (res.status === 401) {
    useSessionStore.getState().logout();
    throw new ApiError('Unauthorized', 401);
  }
  ```
  ```js
  // stores/notesStore.js — no discrimination by status
  function report(message) {
    useUiStore.getState().notify(message, 'error');
  }
  ```
  `App.test.jsx:69-85` asserts the logout happens but nothing asserts the absence of a toast, which
  is why the suite is green.
- **Suggested fix:** the reporters take the error, not the string, and skip status 401 —
  `if (err.status === 401) return;` — since the session redirect is the feedback. `ApiError` already
  carries `.status`, so no plumbing is needed. Add an assertion in `App.test.jsx`'s 401 block that
  `useUiStore.getState().toasts` stays empty.

### C3. Every visit to /notes claims "No notes yet" for the first 300ms

- **Dimension:** D1 Correctness
- **Where:** `frontend/src/pages/Notes.jsx:52-54` + `frontend/src/components/NoteList.jsx:30-49`
- **Problem:** the empty state is chosen by `!notes.length` alone. On mount `status` is `idle`, then
  `loading`; `useDelayedFlag` deliberately withholds the skeleton for 300ms; `failed` is false. In
  that window `NoteList` renders with an empty array and prints **"No notes yet · Press + New to
  write the first one."** — the exact false statement phase 2 was written to eliminate, now shown on
  every page load and again for 300ms after every retry. The 300ms skeleton delay makes it worse, not
  better: it guarantees a visible gap where the empty state is the only thing on screen.
- **Evidence:**
  ```jsx
  // pages/Notes.jsx:52-54
  const failed = status === 'error';
  const showSkeleton = useDelayedFlag(status === 'loading');
  ```
  ```jsx
  // components/NoteList.jsx:30
  if (!notes.length) {   // no notion of "not asked yet" or "asking"
  ```
- **Suggested fix:** the empty branches require a settled load. Either pass the status down (a
  `loaded` / `pending` prop next to `filtered`, page-computed, keeping the component presentational)
  or render nothing from `Notes.jsx` while `status` is `idle`/`loading` and the list is empty. A test
  belongs on it: assert that the empty copy is absent before the request resolves.

### C4. A failed day fetch on /calendar leaves the previous day's notes under the new date

- **Dimension:** D1 Correctness / D4 Error Handling
- **Where:** `frontend/src/pages/Calendar.jsx:59-72`
- **Problem:** `openDay` sets `selectedDate` first, then fetches. If the fetch rejects, `notesForDay`
  keeps whatever the previously opened day returned, and the heading now reads the new date. The
  toast reports the failure and leaves after eight seconds; what remains is a section titled
  "Notes on 2026-08-05" listing the notes of 2026-08-03. This is the same failure class the phase-3
  design was built around ("the toast shows the event, the screen shows the state") — closed for the
  month grid, missed one function below.
- **Evidence:**
  ```jsx
  const openDay = async (date) => {
    setSelectedDate(date);
    …
    try {
      const fetched = await Promise.all(day.note_ids.map((id) => api.getNote(id)));
      setNotesForDay(fetched);
    } catch (err) {
      useUiStore.getState().notify(err.message, 'error');   // notesForDay untouched
    }
  };
  ```
- **Suggested fix:** clear `notesForDay` before the fetch (or in the catch) and give the day section
  its own failure branch with a retry, the way the grid has one. Cover it in `Calendar.test.jsx`:
  open a day successfully, open a second day whose `getNote` rejects, assert the first day's titles
  are gone.

---

## Hard Rules Check

No `CLAUDE.md` and no `.claude/rules/` in this project; the standing criterion for this repository is
`docs/architecture.md`. Its three rules hold:

- **Presentational `components/*`** — `NoteList` gained four props and still imports no store;
  `failed`/`onRetry` are computed in `Notes.jsx`. `Toaster` and `Skeleton` are the exception the doc
  already allows for hosts (`Toaster` reads `uiStore` because it *is* the toast host, and it is
  documented as such in the same commit).
- **`api.js` the only network seam** — unchanged; `Calendar.jsx` is a page and calls `api`.
- **No direct `localStorage` in business code** — untouched by this range.
- **New store registered in `resetStores()` and documented** — both done (`stores/index.js:10`,
  `docs/architecture.md`).

---

## Minor Findings

- **M1** `styles/components.css:527` — toasts are `z-index: 60`, `.modal-backdrop` is `z-index: 100`
  (`:371`). An error raised while `HelpOverlay` is open renders behind the backdrop: announced, never
  seen.
- **M2** `stores/uiStore.js:38-52` — the queue is unbounded. Dedupe is by exact text, so N distinct
  server messages stack N banners with no cap and no scroll.
- **M3** `stores/uiStore.js:39` — dedupe matches on `message` only, ignoring `kind`. A status message
  whose text equals a queued error renews the error instead of appearing politely.
- **M4** `stores/notesStore.js` — `error` is written by six actions and read by no component since
  `d91c26d`. Deliberate (tests and `architecture.md` treat it as the source of truth), but a reader a
  month from now will look for its consumer and find none. Worth one sentence in the store's
  docstring.
- **M5** `styles/components.css:519-521` — the comment claims the regions are "`display: contents` in
  effect via flex on the parent". They are ordinary flex children, which has a real consequence the
  comment obscures: the polite region always sits above the assertive one, so a new error appears
  *below* an older success rather than in arrival order.
- **M6** `stores/accountStore.js:3-4` — a store now imports `i18n.jsx`, a module that also exports
  React hooks, into a layer `architecture.md` describes as headless. `translate` itself is pure, so
  nothing breaks; extracting the pure catalogue would keep the layering claim literally true.
- **M7** no test asserts the settings success toast lands in `role="status"`, which is one of the
  phase-3 acceptance criteria. `Toaster.test.jsx` covers kind routing generically with a synthetic
  message.
- **M8** toast text is raw server English (`detail.detail` or `res.statusText` from `api.js:34`).
  Previously it sat in a banner; now it is announced assertively by screen readers in a UI that may
  be Russian. Pre-existing, but this change raises its prominence.

---

## Blast Radius Analysis

The four Criticals are all in the response layer, not the design system: the CSS work (1425 lines
across five new files) has no findings, and its risk was mechanical loss, which the build and the CSS
size check bound. **C2** is the widest — it fires on the normal session-expiry path for every user
and touches the auth flow. **C3** is on the default render path of the main screen. **C1** affects
the default language configuration, i.e. most users. **C4** is scoped to one interaction on
`/calendar`. None can corrupt data or leak state across accounts; all four are the app stating
something untrue to the reader, which is precisely the axis this plan claimed to fix.

---

## Verdict Rationale

Four Critical findings, none blocking: the code ships and works, but it tells the reader three
untrue things (an English toast in a Russian UI, "no notes yet" during every load, another day's
notes under today's heading) and one unnecessary one (a red "Unauthorized" on the login form). Three
of the four are the same class the plan was written to eliminate, which is the strongest argument for
fixing them now rather than accepting them: the phase spent its budget on exactly this axis. All
four have one-to-few-line fixes and a natural test each.

---

## Next Action

**NEEDS_FIX** → ship-it iteration 2 with C1–C4 as the task, each with the test named in its
Suggested fix. M1 and M5 are cheap enough to fold in; M2–M4 and M6–M8 are separate decisions, not
blockers.
