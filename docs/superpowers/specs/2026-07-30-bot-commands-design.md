# Bot commands — design

**Date:** 2026-07-30
**Scope:** the conversation with the bot. Reading notes and controlling reminders from Telegram.

## Problem

The bot can be linked and it can deliver, and that is all. There is no way to ask it anything. A
user who wants to know what is on today opens the browser; a user who wants the reminders to stop
for a while opens the browser as well, even though the messages they want silenced arrive in
Telegram.

## Commands

| command | does |
| --- | --- |
| `/start [code]` | links the chat, as today |
| `/today` | notes dated today, in the account's zone |
| `/upcoming` | dated notes for the next seven days |
| `/status` | who the chat is linked as, zone, reminder time, whether reminders are on |
| `/pause` | turns notifications off without unlinking |
| `/resume` | turns them back on |
| `/help` | the list above, and the reply to anything unrecognised |

Registered with `setMyCommands` at worker startup, once per supported language, so Telegram shows
the descriptions in the client's own language from its menu button. Registration failing is logged
and ignored: a bot that cannot advertise its menu still answers when asked.

`allowed_updates` stays `["message"]`. Inline buttons would need `callback_query`,
`answerCallbackQuery` and a second router; the native command menu is the affordance Telegram
already gives for exactly this, and it costs no new update type. Buttons earn their keep when the
action targets one object — snooze *this* reminder — which is not what is being asked for here.

## Non-goals

- Creating or editing notes from Telegram. That turns the bot into an input channel and raises its
  own questions — dates, tags, what Markdown means in a chat — none of which this answers.
- Inline keyboards, pagination, snoozing a specific reminder.
- Search. `/today` and `/upcoming` cover "what is on my plate"; full search belongs to the app.

---

## What has to be untangled first

`handle_start_command` currently answers "Open Settings…" to *any* message, because the case "no
`/start` at all" and the case "`/start` with no code" both fall through to the same branch. While
they are conflated there is nowhere to put a command.

Splitting them along the seam that already exists:

- `telegram_link` keeps the account work — issuing a code, redeeming one, unlinking — and stops
  owning prose. `redeem_code(db, *, code, chat_id, telegram_username, language)` returns a
  `LinkResult` (`LINKED`, `UNKNOWN_OR_EXPIRED`, `CHAT_TAKEN`) and, on success, the user.
- `app/bot_commands.py` becomes the single entry point for an update. It parses the command,
  routes it — `/start` included, to `telegram_link` — and turns the outcome into localised text.

The worker loses its remaining decisions: it hands the update over and sends whatever comes back.

This is a refactor of existing code, and it is in scope because the conflation is what blocks the
feature. `LinkOutcome` disappears, replaced by `BotReply(chat_id, text)`.

## Access

Everything except `/start` and `/help` requires a linked chat. An unlinked chat gets the same
invitation to link that `/start` without a code produces — never data, never a hint that an account
exists. Ownership is not checked separately because it cannot be violated: the lookup goes from
`chat_id` to its user, and notes are read from that user.

Messages without text — a photo, a sticker, a forward — are ignored rather than answered with help.
Replying to every sticker with a menu is noise.

## Replies

Plain text, no `parse_mode`, for the same reason reminders use none: the app stores Markdown and
real titles contain characters that make the API reject the message.

```
Сегодня, 30 июля

• Grocery list
• Reminder demo
```

```
Ближайшие 7 дней

• 31 июля — Project kickoff
• 2 августа — Созвон с командой
```

A flat list with the date on each line rather than grouped headings: it truncates cleanly and reads
the same whether one day carries one note or four.

Limits, both to keep a talkative week inside Telegram's message size and to keep the reply
readable: at most 10 entries, with `…и ещё N` when there are more, and titles cut to 80 characters
with an ellipsis.

Empty is stated plainly — "На сегодня заметок нет." — not left as an empty list.

### Pinned so nobody has to guess

- **Archived notes never appear.** They are absent from the app's own lists and would be noise here.
  Notes without a date are outside both commands by definition.
- **`/upcoming` starts after today**, through today + 7 days inclusive, both boundaries taken in the
  account's zone. Today has its own command; repeating it here would make the two overlap.
- **Ordering is `(note_date, id)`** — chronological, and stable for several notes sharing a day.
- **`/status` prints the reminder time as `HH:MM`**, matching what the web form shows, not the
  stored `HH:MM:SS`.
- **`/pause` and `/resume` are idempotent.** Pausing an already-silent account answers the same way
  as pausing a live one; there is nothing useful to say about the difference and a special case
  would only be another branch to get wrong.
- **The "linked chat N" log line moves into `bot_commands`** along with the decision that produced
  it. The worker no longer inspects what came back, so it is no longer the place that can tell.

## Interaction with the outbox

`/pause` writes the same `notifications_enabled = false` the web toggle writes, so `cancel_stale`
retires anything already scheduled. `/resume` sets it back and the next materialisation pass
recreates what is still inside the window. No second mechanism, no new state.

## Structure

| file | responsibility |
| --- | --- |
| `app/bot_commands.py` | new — parse, route, render. Pure over a `Session`; no HTTP. |
| `app/telegram_link.py` | modified — account work only, returns a result rather than prose |
| `app/bot_i18n.py` | modified — command replies and menu descriptions, EN and RU |
| `app/telegram.py` | modified — `set_my_commands(commands, language_code)` |
| `scripts/worker.py` | modified — registers the menu at startup, delegates updates |
| `tests/test_bot_commands.py` | new |
| `tests/test_telegram_link.py`, `tests/test_worker_polling.py` | updated for the new seam |

`bot_commands` lives in `app/` deliberately: `pytest.ini` measures `--cov=app`, and logic parked in
`scripts/` is invisible to the gate.

## Testing

Each command twice — linked and unlinked — plus: an empty day, an empty week, a list longer than
the cap, a title longer than the cut, an unrecognised message, a message with no text at all, and
`/pause` proving that a reminder which would otherwise have gone out does not.

Command descriptions get the same catalogue parity treatment as every other string, through the
existing test in `test_bot_i18n.py`.

## Definition of done

- The menu button in Telegram lists the commands, in the client's language.
- Every command answers correctly for a linked chat and refuses politely for an unlinked one.
- `/pause` silences delivery and `/resume` restores it, verified against the outbox rather than the
  reply text.
- No note belonging to another account is reachable.
- `make test` and `make lint` stay green; backend coverage stays above the threshold.
- `backend/openapi.json` is untouched — none of this is HTTP.
