# Code Review — sharing-export (iteration 1)

**Timestamp:** 2026-07-30 21:26:43
**Verdict:** `NEEDS_FIX`
**Iteration:** 1 of max 2
**Review target:** `26d9df9` (public sharing) and `f7f30bb` (export) — 26 files, +1929 / −13
**Blocking findings:** 0
**Critical findings:** 4
**Minor findings:** 6
**Hard Rules violations:** 1

Two of the four Criticals were confirmed by running the code, not by reading it. The other two are
confirmed by construction and the verification method is stated in each.

---

## Files Reviewed

| File | Changes | Read importers? |
|---|---|---|
| `app/export.py` | +107 (new) | ✅ `routers/notes.py`, executed against real input |
| `app/routers/notes.py` | +120 / −15 | ✅ route order checked against `/calendar` precedent |
| `app/routers/public.py` | +48 (new) | ✅ `main.py`; only unauthenticated read in the app |
| `app/rate_limit.py` | +30 | ✅ `routers/auth.py`, `conftest.py` reset fixtures |
| `app/schemas.py`, `app/models.py`, `alembic/versions/0007_*` | +40 | ✅ migration vs model compared |
| `frontend/src/api.js` | +70 | ✅ three call paths now: private, public, download |
| `frontend/src/components/ShareControl.jsx` | +95 (new) | ✅ `NoteEditor.jsx` — the mount site is the finding |
| `frontend/src/hooks/useDownload.js` | +38 (new) | ✅ `NoteEditor.jsx`, `Settings.jsx` |
| `frontend/src/pages/SharedNote.jsx` | +75 (new) | ✅ `App.jsx` route, outside RequireAuth |
| tests (5 files) | +430 | — |

---

## Critical Findings

### C1. Two notes can land in the zip under one filename, and one silently wins

- **Dimension:** D1 Correctness / D6 Blast Radius
- **Where:** `backend/app/export.py:65-88` (`filenames_for`)
- **Problem:** collisions are settled by appending the note id, which produces a name that another
  note can hold legitimately. A note titled `Meeting-1` collides with the disambiguated name of a
  note titled `Meeting`.
- **Evidence:** executed against the shipped function:
  ```
  filenames_for([N(1,'Meeting'), N(2,'Meeting-1'), N(3,'Meeting')])
  → {1: 'Meeting-1.md', 2: 'Meeting-1.md', 3: 'Meeting-3.md'}
  ```
  `zipfile` writes both entries with a `UserWarning` nobody sees, and every extraction tool keeps
  the last one. **An export loses a note.** That is the single thing an export must never do, and it
  is silent at every step: no error, no warning in the response, a zip that opens fine.
- **Suggested fix:** `filenames_for` tracks the names it has already handed out, not just the slugs:
  if `f"{slug}-{id}.md"` is taken, keep appending a discriminator until it is not. Test with exactly
  the triple above — it is short, and it is the case the current implementation gets wrong.

### C2. The share control shows the previous note's link after switching notes

- **Dimension:** D1 Correctness / D2 Integration
- **Where:** `frontend/src/components/ShareControl.jsx:22` mounted at
  `frontend/src/components/NoteEditor.jsx:102`
- **Problem:** the control seeds its state from props once — `useState(initialToken ?? null)` — and
  the editor renders it at the same position for every note, with no `key`. React reuses the
  instance, so the state survives the switch. Open a shared note, then click an unshared one: the
  control says **Link is live**, offers Revoke, and **Copy link copies the other note's URL**.
  Revoke then fires against the new note's id and reports success for a link it never had.
- **Evidence:** by construction, not execution — the state initialiser runs only on mount, and
  `NoteEditor.jsx:102` passes no `key`:
  ```jsx
  {note && <ShareControl noteId={note.id} token={note.share_token} />}
  ```
  Nothing in the eight `ShareControl` tests renders it twice with different props, which is why the
  suite is green.
- **Suggested fix:** `key={note.id}` at the mount site, which is the whole fix and reads as the
  intent ("this control belongs to this note"). Add a test that rerenders the editor with a second
  note and asserts the control offers **Share** again.

### C3. The object URL is revoked in the same tick as the click

- **Dimension:** D1 Correctness / D6 Blast Radius
- **Where:** `frontend/src/hooks/useDownload.js:24-28`
- **Problem:** `anchor.click()` starts the download asynchronously; `URL.revokeObjectURL(url)` on the
  very next line can invalidate the blob before the browser has read it. Chrome tolerates it; Firefox
  and Safari have historically cancelled the download outright. The failure mode is the worst kind —
  nothing happens, no error, and it happens on somebody else's browser.
- **Evidence:**
  ```js
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
  ```
  jsdom implements neither method, so the test asserts only that revoke was *called* — it locks in
  the risky ordering rather than protecting against it.
- **Suggested fix:** revoke on a later tick (`setTimeout(() => URL.revokeObjectURL(url), 0)`) and
  make the test assert the ordering rather than the call.

### C4. The public rate limiter grows a permanent entry per client address

- **Dimension:** D6 Failure Mode / D10 Security
- **Where:** `backend/app/rate_limit.py:11-19, 51-72`
- **Problem:** `_public_hits` is a `defaultdict(deque)` keyed by client IP, appended on **every**
  public read, and never emptied outside tests. The auth limiter it sits next to only grows on failed
  attempts and is cleared on success; this one grows on traffic, and the endpoint feeding it is the
  only one in the app that needs no credentials. A scan from many addresses leaves one deque per
  address, permanently.
- **Evidence:** `reset_auth_rate_limits()` is the only caller that clears it, and its only callers
  are `tests/conftest.py:54,71`. Nothing prunes during a request.
- **Suggested fix:** drop the key when its deque empties after the window sweep — three lines inside
  the function that already walks the deque. Test: one request, advance past the window, one more
  request, assert the dict has one key rather than two stale ones.

---

## Hard Rules Violations

### H1. Two components now do their own fetching

- **Rule source:** `docs/architecture.md:142` — "Frontend `components/*` stay presentational;
  fetching lives in `pages/*`", restated at `:126`.
- **Where:** `frontend/src/components/ShareControl.jsx:4` (`import { api }`, three calls) and
  `frontend/src/components/NoteEditor.jsx:6-7` (`api.exportNote` through `useDownload`).
- **Violation:** both are `components/*` and both call the network directly. This is the rule the
  zustand work enforced deliberately — `NoteList` got `failed`/`onRetry`/`filtered` as props rather
  than reading a store, and the reason was written down at the time.
- **Suggested fix:** two honest options, and the choice belongs to the author rather than to me:
  either hoist the calls to `Notes.jsx`/`Settings.jsx` and pass handlers down, matching how every
  other component in this codebase works; or amend the rule in `docs/architecture.md` to carve out
  self-contained widgets that own one endpoint, and say why. What is not acceptable is the current
  state, where the document says one thing and two files do another.

---

## Minor Findings

- **M1** `app/routers/notes.py:203-240` — the export loads every matching row with `.all()` before
  zipping, so the memory claim in the commit message ("an account with thousands of notes does not
  decide how much memory the process uses") covers the archive but not the row set. `yield_per` or
  batching would make it true; as written, 10k notes are materialised as ORM objects first.
- **M2** `frontend/src/pages/SharedNote.jsx` — the API response carries `X-Robots-Tag: noindex`, but
  a crawler indexes the SPA route `/s/:token`, which is served as an HTML shell with no such meta
  tag. The header protects the JSON nobody crawls.
- **M3** `frontend/src/components/ShareControl.jsx:58-63` — when the clipboard is refused, the link
  is shown in a toast that auto-dismisses after 4 seconds. That fallback exists precisely for the
  reader who has to select and copy it by hand, and four seconds is not enough time to do so.
- **M4** `app/schemas.py` — `PublicNoteOut` exposes `updated_at`, which tells a link holder when the
  note was last touched. Defensible, and there is a test pinning the field set, but the decision is
  recorded nowhere in prose.
- **M5** `app/routers/public.py:38` — the token is matched with plain SQL equality, which is not
  constant-time. With 256 bits of entropy and a per-IP throttle this is theoretical; recorded so it
  is not rediscovered as new.
- **M6** `ShareOut.shared_at` is returned and never read by the UI. Either the owner should see when
  a link went live, or the field is speculative.

---

## Findings by Dimension

Clean: **D3 Performance** apart from M1 (the zip streams, the share lookup is a single indexed
equality, the listing refactor added no queries), **D5 Dead Code** apart from M6, **D9 Reuse**
(`_visible_notes` removed a real duplication and the listing's own tests prove the extraction was
behaviour-preserving), **D11 Test Coverage** in breadth — 26 new backend tests and 23 frontend ones,
including the route-order trap and the path-traversal cases, which is why the remaining defects are
all in states the tests never construct: a second note, a second render, a second IP.

---

## Blast Radius Analysis

C1 is the serious one: an export that loses a note is a data-loss bug in the one feature whose entire
purpose is getting data out, and it is silent. C2 is a privacy-shaped bug rather than a leak — the
control copies a link the owner does own, but for a note they were not looking at, and the link
itself is real and live. C3 makes the whole export feature a no-op on browsers this project has never
been opened in. C4 is a slow unauthenticated resource leak. Nothing here can cross accounts: ownership
is enforced by `_own_note_or_404` on every share and export path, and the public read resolves a
token to exactly one note.

---

## Verdict Rationale

Four Criticals, one Hard Rules violation, none blocking. Two were found by running the code, and the
two found by reading it are both "the state survives something the tests never do" — a second note in
the editor, a second address at the limiter. The features work as demonstrated; they break on the
second instance of things, which is the shape of defect this session has now produced three rounds
in a row.

---

## Next Action

**NEEDS_FIX** → ship-it iteration 2 on C1–C4 with the test named in each, plus a decision on H1: hoist
the two components' fetching into their pages, or amend the documented rule and say why. M1–M6 are
separate calls, not blockers.
