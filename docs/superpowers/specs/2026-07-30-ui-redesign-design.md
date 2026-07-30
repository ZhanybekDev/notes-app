# Design — UI redesign: strict and responsive

**Date:** 2026-07-30
**Status:** shipped. Approved section by section before implementation, then updated to record what was
actually built — including four decisions the code forced that the approved version got wrong. The
divergences are listed at the end rather than quietly folded in.

## The complaint, narrowed

The report was "не особо нравится". Asked to place it, the answer was two of four
possibilities: the interface **looks cheap** and **feels dead**. Structure and navigation are fine;
the mobile layout is not a concern. That removes a redesign of the screens and a responsive rework
from scope, and points the work at visual system and feedback.

## What the code says

Read before deciding, so the design argues with facts rather than taste:

- **Colour tokens exist and are decent** — 72 declarations, about 36 names across two themes. The
  problem is not the absence of tokens.
- **No spacing or type scale.** Padding is written by eye: `0.6rem 0.8rem` in one rule,
  `0.5rem 0.7rem` in its neighbour, `1.25rem` two blocks down. Sizes land on `0.88rem` and `0.85rem`
  — a half-pixel apart, which reads as carelessness rather than intent.
- **One breakpoint** (`max-width: 820px`) that stacks the grid and hides two labels.
- **`styles.css` is 1068 lines appended tail-first**, 204 rule blocks. `.notice-waiting` and
  `.tz-suggestion` sit *after* the media query, because that is where the last edit landed.
- **Accent used as a fill, not a highlight.** `--accent-soft` backs hints and notices, so several
  regions compete at once.
- **Four shadow levels plus a radial-gradient page background plus a translucent header.** Depth is
  applied everywhere, which is what makes a flat interface look expensive by comparison.

## Direction

**Strict and calm.** Near-monochrome surfaces, a single accent applied as a point rather than a
field, borders instead of shadows, more air. Radii tighten. The reference feel is Linear or Notion:
little in that register reads as cheap.

**Constraint: no new dependencies.** Hand-written CSS and CSS animations. The project is a fork
submitted for review, `zustand` was already a visible addition, and a second one would need its own
defence.

**Scope: all five screens.** A polished `/notes` beside an untouched `/settings` still reads cheap —
inconsistency is the thing that produces the impression.

## Section 1 — token system and stylesheet structure

**Files.** `styles.css` becomes an entry point importing `styles/tokens.css`, `base.css`,
`components.css`, `screens.css`, `motion.css`. The single import in `main.jsx` stays as it is. This
is not tidying: rules currently land wherever the last edit ended, and the next one would land there
too.

**Order matters and is load-bearing.** `motion.css` comes last **and** uses `!important`. Later
position only wins at equal specificity, and a class like `.toast.error` outranks a universal
selector, so ordering alone would leave `prefers-reduced-motion` silently not working — silently,
because no test can see it.

**Spacing.** Eight steps, `--space-1…8` = 4/8/12/16/24/32/48/64. No number outside the scale appears
in `padding`, `margin` or `gap`. Broken rhythm reads as cheap earlier than colour does.

**Typography.** Seven sizes, `--text-xs` … `--text-2xl` = 12/13/14/16/20/24/30; three weights
(400/500/600); two line heights (1.25 for headings, 1.55 for prose).

**Palette.** The radial gradient goes; surfaces become flat. Greys are rebuilt with a cool tint and
legible steps: background → surface → raised surface → border → strong border. The accent is
desaturated to a calm indigo and used at points only — primary button, selected note, focus ring.

**Depth and radii.** Four shadow levels collapse to one, kept for overlays and toasts; everything
else separates with borders. Radii go from 6/10/14 to 4/6/10, **plus a `--radius-pill: 999px`**:
five rules genuinely want a pill, and rounding them to 10px would change what chips and badges are.

**Focus and dark theme.** One `--focus-ring` token applied through `:focus-visible` on every
interactive element — there is no such system today. The dark theme redeclares the same tokens under
`[data-theme="dark"]` and owns **zero** rules of its own, so it cannot fall behind the light one. The
one rule it did own — a darker modal backdrop — became a `--backdrop` token.

## Section 2 — the feedback layer

**Toasts.** A fifth store, `uiStore`, holds the queue: `toasts: []`, `notify(message, kind)`,
`dismiss(id)`. A `<Toaster />` mounted in `App.jsx` owns the dismissal timers — that direction and
not the reverse, because this session's code review already established that a `setTimeout` in a
store outlives both the page and `resetStores()` and hands the next test someone else's state. The
store keeps the fact; the screen keeps how long it lives.

**Two permanent live regions, not one.** A region created together with its message is never
announced — a screen reader watches regions that already exist — and putting the role on the toast
inside a region container gives nested live regions, which announce twice or not at all. So empty
`role="status"` and `role="alert"` containers wait in the DOM and a toast joins whichever matches its
kind, carrying no role itself. Both sit inside one positioned parent, so the split is invisible to
the eye: it exists for the screen reader. Focus is never moved (WCAG 4.1.3), and auto-dismissal comes
with a close button and a pause on hover and focus (WCAG 2.2.1) — 4s for successes, 8s for failures.

**One message, one toast.** Mounting `/notes` starts two loads at once, so one dropped network
arrives twice in a tick. A repeat of the same text and kind is collapsed, but not discarded: it bumps
a `renewals` counter the timer effect is keyed on, restarting the countdown without the banner
unmounting. Discarding it would let the first toast expire while the thing it reports is still true.
The queue is capped at four; eviction skips whatever the reader is holding and spends a polite
message before a failure.

**Not everything becomes a toast.** Background and transient failures — a list that would not load,
a settings PATCH that failed, an unlink that broke — go to a toast. Errors about the form the user is
looking at right now — wrong password on sign-in, a weak new password, the account-deletion
confirmation — stay inline next to the field. A toast saying "wrong password" is worse than text
under the input: it leaves while the user is still reading.

**A 401 is not an error.** `api.js` answers it by ending the session, and the redirect to the login
form is the feedback. `reportFailure` drops it; otherwise every expiry would put an untranslated
"Unauthorized" alert on the form the reader was just sent to.

**What a failure says.** A message the server sent is passed through — its answer is more specific
than anything the client could invent. A rejection carrying no status never reached the server, so it
gets our own translated sentence instead of the browser's "Failed to fetch"; anything with no usable
message at all gets a written one instead of `[object Object]`.

**An event is not a state.** The toast reports and leaves; what stays on screen is the area's own
state. `notesStore` gains `status: 'idle' | 'loading' | 'ready' | 'error'` to carry it, and a failed
load renders `<LoadFailure />` with a retry — in the notes list, the month grid and one opened day.
Without that, a failure would render as "no notes yet", and eight seconds later nothing on screen
would disagree.

**Empty states are claims, and there are four of them.** "Nothing matches" (a query with no results),
"the archive is empty", "no notes yet" (there genuinely are none) and "could not load" stopped sharing
one message. A claim is only made once an answer exists: while the first request is in flight the area
stays blank rather than announcing an empty account.

**Transitions, CSS only.** List items and the editor pane enter through `@keyframes`; the toast
slides in; buttons and rows transition on hover and active. 120–180 ms — faster reads as instant,
slower irritates on repeated clicks. Everything sits under
`@media (prefers-reduced-motion: reduce)` with animations zeroed: a notes app has no business making
anyone unwell.

**States, completely.** `hover`, `focus-visible`, `active`, `disabled` on every interactive element;
`selected` and `checked` on list rows. These exist selectively today, which is the source of "does
not answer when I click".

## Section 3 — the five screens

- **`/notes`** — the bulk of the work. List density on the scale; `.note-item` gets legible
  `selected` / `hover` / `checked`; the date pill and tags stop competing with the title, which they
  currently match in weight. The editor pane becomes a flat surface with a border instead of a
  shadow, and the markdown toolbar attaches to the field rather than floating as its own block. The
  empty state is rewritten — today it states that nothing is selected without suggesting what to do.
- **`/settings`** — three cards (reminders, password, danger zone) get identical inner spacing and
  one way of rendering a heading with its hint. The danger zone splits into explanation and action;
  as a red frame alone it reads as an error rather than a section.
- **`/calendar`** — grid on tokens, cells of one size, and `today` / `past` / `future` / `selected` /
  `has-notes` stop being five shades of one saturation. The day's note list reuses the density of the
  main list so the screen does not look like it came from a different app.
- **`/login`, `/register`** — the cheapest-looking place today: a centred card with a shadow on a
  gradient. They go flat, with the accent on the button only. This is also the first thing a reviewer
  of the fork sees.
- **Header** — the translucent `rgba(255,255,255,0.75)` goes with the gradient; a flat surface with a
  bottom border and a legible active nav item remains.

## Section 4 — every request shows itself

Added after the three approved sections, from an audit of all 47 `async` sites: error handling was
already everywhere, and the missing half was visible progress. A button that does nothing until the
answer arrives reads as dead and gets pressed again.

**Areas** show a skeleton shaped like what is coming — the notes list, the settings card, the month
grid, the notes of one opened day — and show it only after 300 ms. A skeleton that flashes for 80 ms
reads as a glitch, so a fast answer shows nothing at all; the timer resets on every transition,
because typing gives loading → ready → loading and accumulated time would raise a skeleton over an
already-loaded list.

**Actions** show it on the button that started them. The domain stores carry a `busy` tag naming the
request in flight (`'save'`, `'remove'`, `'pin'`, `'archive'`, `'bulk'`, `'more'`, `'patch'`,
`'unlink'`) rather than a boolean, because a screen has several buttons and only the pressed one
should spin. `<BusyButton>` disables itself, sets `aria-busy` and puts the spinner **over** its own
label: a button that grows under the cursor that just pressed it is worse than no indicator.

**The same tag refuses a second call.** A disabled button is not enough on its own — keyboard, a slow
paint, or a caller that is not a button all get past it — so the guard sits in the store too. The
double-save that used to create two notes has a test.

## Out of scope

- Screen structure and navigation — named as fine.
- Mobile layout beyond what the token work gives for free.
- Component markup where CSS is enough.
- New dependencies of any kind, including animation and CSS frameworks.
- The debounce on search, note deep links, and everything else already listed as out of scope in the
  zustand plan.
- Translating server error text. `detail` strings stay English, so a Russian interface can still hear
  one English sentence from a toast. Fixing it needs an error-code contract with the backend, not a
  frontend patch; recorded in `SUBMISSION.md` rather than left unnamed.

## Testing

**What tests can and cannot see.** `vite.config.js:19` sets `css: false`, so vitest never processes a
stylesheet: no test can verify the visual work. The automatic net for the stylesheet move is
`npm run build` plus the size of the built CSS against a baseline; the rest is eyes in a browser.

Everything else is tested. The suite went 142 → 201: `uiStore` (queue, dedupe, cap, held toasts, the
401 rule, message classification), `<Toaster />` (permanent regions, kind routing, focus not moving,
pause, renewal) on fake timers, `useDelayedFlag` on both sides of 300 ms, the four empty states, the
failure block and its retry on two screens, busy tags and the double-submit guard, and `Calendar`,
which had no tests at all before this work.

Tests that asserted inline error text for background failures were rewritten to assert a toast, never
deleted. One changed meaning rather than wording: "does not carry a stale error into the next visit"
asserted absent text, which with toasts would pass for the wrong reason — the toast may simply have
expired — so it asserts the queue does not grow.

## Risks

- **"Strict and calm" is taste, and it is only visible in a browser.** Mitigation: the first commit
  is tokens plus `/login` — the smallest screen. If the character is wrong we learn it after ten
  minutes rather than five hours.
- **Text changes will break tests that assert copy.** Expected, and the rule is to rewrite them; the
  zustand work already established that deleting an awkward test is not an option.
- **Every EN string needs its RU pair.** The project's own `i18n.test.jsx` enforces key parity, so a
  one-sided addition fails the suite rather than shipping.

## Divergences from the approved design

Four things the code forced, recorded because a spec that quietly matches whatever shipped is worth
nothing:

1. **A fifth stylesheet, `motion.css`, and `!important` inside it.** The approved version had four
   files and assumed import order was enough to zero animations. It is not — specificity beats order —
   and the failure would have been invisible.
2. **`--radius-pill`.** The approved radii were 4/6/10 with no exception; five rules turned out to
   need 999px, and rounding them would have changed what a chip is.
3. **`loaded` next to `status`.** `status` alone conflated "no answer yet" with "an answer that was
   empty", which made the empty-result message blink on every keystroke. An empty answer is still an
   answer.
4. **Section 4 did not exist.** The approved design covered failure but not progress. The audit that
   produced it found the reverse of what was expected: error handling was complete, indicators were
   missing everywhere.

Two further corrections came out of code review rather than implementation: the settings toast read
the language as `prefsStore.lang` and so spoke English to everyone who never touched the toggle
(`selectLang` exists for exactly this), and the calendar's day fetch had no stale-answer guard, so two
quick clicks filed one day's notes under another's heading.

## Estimate

Planned: 4–6 hours, four or five commits. Actual: four phase commits plus three rounds of review
fixes and the progress layer — eight commits, and the review rounds found four defects in the shipped
work that a green 170-test suite had not.
