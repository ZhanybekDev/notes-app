# Design — UI redesign: strict and responsive

**Date:** 2026-07-30
**Status:** approved (three sections, section by section)

## The complaint, narrowed

The report was "не особо нравится". Asked to place it, the answer was two of four
possibilities: the interface **looks cheap** and **feels dead**. Structure and navigation are fine;
the mobile layout is not a concern. That removes a redesign of the screens and a responsive rework
from scope, and points the work at visual system and feedback.

## What the code says

Read before deciding, so the design argues with facts rather than taste:

- **Colour tokens exist and are decent** — 35 custom properties, dark theme included. The problem is
  not the absence of tokens.
- **No spacing or type scale.** Padding is written by eye: `0.6rem 0.8rem` in one rule,
  `0.5rem 0.7rem` in its neighbour, `1.25rem` two blocks down. Sizes land on `0.88rem` and `0.85rem`
  — a half-pixel apart, which reads as carelessness rather than intent.
- **One breakpoint** (`max-width: 820px`) that stacks the grid and hides two labels.
- **`styles.css` is 1068 lines appended tail-first.** `.notice-waiting` and `.tz-suggestion` sit
  *after* the media query, because that is where the last edit landed.
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
`components.css`, `screens.css`. The single import in `main.jsx` stays as it is. This is not tidying:
rules currently land wherever the last edit ended, and the next one would land there too.

**Spacing.** Eight steps, `--space-1…8` = 4/8/12/16/24/32/48/64. No number outside the scale appears
in `padding`, `margin` or `gap`. Broken rhythm reads as cheap earlier than colour does.

**Typography.** Seven sizes, `--text-xs…3xl` = 12/13/14/16/20/24/30; three weights (400/500/600);
two line heights (1.25 for headings, 1.55 for prose).

**Palette.** The radial gradient goes; surfaces become flat. Greys are rebuilt with a cool tint and
legible steps: background → surface → raised surface → border → strong border. The accent is
desaturated to a calm indigo and used at points only — primary button, selected note, focus ring.

**Depth and radii.** Four shadow levels collapse to one, kept for overlays and toasts; everything
else separates with borders. Radii go from 6/10/14 to 4/6/10.

**Focus and dark theme.** One `--focus-ring` token applied through `:focus-visible` on every
interactive element — there is no such system today. The dark theme redeclares the same tokens under
`[data-theme="dark"]` and owns no rules of its own, so it cannot fall behind the light one.

## Section 2 — the feedback layer

**Toasts.** A fifth store, `uiStore`, holds the queue: `toasts: []`, `notify(message, kind)`,
`dismiss(id)`. A `<Toaster />` mounted in `App.jsx` owns the dismissal timers — that direction and
not the reverse, because this session's code review already established that a `setTimeout` in a
store outlives both the page and `resetStores()` and hands the next test someone else's state. The
store keeps the fact; the screen keeps how long it lives.

**Not everything becomes a toast.** Background and transient failures — a list that would not load,
a settings PATCH that failed, an unlink that broke — go to a toast. Errors about the form the user is
looking at right now — wrong password on sign-in, a weak new password, the account-deletion
confirmation — stay inline next to the field. A toast saying "wrong password" is worse than text
under the input: it leaves while the user is still reading.

**Skeletons need state that does not exist.** `notesStore` knows `items` and `error`, so "loading"
and "empty" are the same thing to it — hence the empty list that flashes before data arrives. It
gains `status: 'idle' | 'loading' | 'ready' | 'error'`, matching `accountStore`. Skeletons: three
note rows, the editor card, the settings block. Separately, "nothing matches" (a search with no
results) and "no notes yet" (there are genuinely none) stop sharing one message.

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

## Out of scope

- Screen structure and navigation — named as fine.
- Mobile layout beyond what the token work gives for free.
- Component markup where CSS is enough.
- New dependencies of any kind, including animation and CSS frameworks.
- The debounce on search, note deep links, and everything else already listed as out of scope in the
  zustand plan.

## Testing

The existing 142 tests stay green. Tests that assert inline error text for background failures move
to asserting a toast — rewritten, not deleted. New tests: `uiStore` queue and `dismiss`; `<Toaster />`
rendering and auto-dismissal on fake timers; a skeleton visible at `status === 'loading'` and gone
after; "nothing matches" against "no notes yet".

## Risks

- **"Strict and calm" is taste, and it is only visible in a browser.** Mitigation: the first commit
  is tokens plus `/login` — the smallest screen. If the character is wrong we learn it after ten
  minutes rather than five hours.
- **Text changes will break tests that assert copy.** Expected, and the rule is to rewrite them; the
  zustand work already established that deleting an awkward test is not an option.
- **Every EN string needs its RU pair.** The project's own `i18n.test.jsx` enforces key parity, so a
  one-sided addition fails the suite rather than shipping.

## Estimate

4–6 hours, four or five commits, starting with tokens and `/login`.
