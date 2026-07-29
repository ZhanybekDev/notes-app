# Demo — Telegram reminders in about three minutes

Reproduces the feature end to end on a clean machine. Every command is copy-pasteable.

## 0. Prerequisites

Docker with Compose, and a bot token from [@BotFather](https://t.me/BotFather)
(`/newbot` → display name → username → token).

## 1. Configure and start

```bash
cp backend/.env.example backend/.env
# fill in TELEGRAM_BOT_TOKEN and TELEGRAM_BOT_USERNAME, then:
make up
make seed
```

Confirm the worker picked up the token — note that it arrives via `backend/.env` through
pydantic-settings, so it is *not* in the process environment and `printenv` will show nothing:

```bash
docker compose exec worker python -c \
  "from app.config import settings; print(settings.bot_configured, settings.telegram_bot_username)"
# True maddev_test_bot

docker compose logs worker --tail 3
# ... INFO worker worker started, polling as @<your_bot>
```

## 2. Connect Telegram

1. Open <http://localhost:5173> and log in as `demo` / `demo1234`.
2. Go to **Settings → Telegram reminders**.
3. Set **Time zone** to your own, leave **Reminder time** at `09:00` for now.
4. Press **Connect Telegram** → Telegram opens the bot → press **Start**.
5. The bot replies `Connected to "demo". Reminders will arrive here.`
6. Reload Settings: it shows `Connected as @yourhandle` and the toggle is on.

The worker logs the binding:

```bash
docker compose logs worker --tail 5
# ... INFO worker linked chat 123456789
```

## 3. Make a reminder fire

The seed data includes a note titled **Reminder demo** dated today. Set the reminder time one
minute into the future in Settings, and wait.

```bash
docker compose logs -f worker
```

A real run looks like this — the reconciliation pass picks the note up, then the next pass past the
scheduled instant delivers it:

```
18:08:56  reconciled: materialised=1 cancelled=0 resynced=1
18:10:36  sent reminder 4 for note 6
```

The message arrives in Telegram as plain text: the note title, its date, and an excerpt, in the
language your Telegram client is set to.

Expect up to about a minute of lag. Delivery is checked once per 30-second tick, and the tick waits
behind a long poll that blocks for up to 25 seconds, so the worst case is roughly 55 seconds after
the scheduled instant. In the run above it was 48.

## 4. Prove it is exactly-once

The outbox is the evidence. One row per note per date, and it is already `sent`:

```bash
docker compose exec backend python -c "
from app.db import SessionLocal
from app.models import Reminder
db = SessionLocal()
for r in db.query(Reminder).all():
    print(r.note_id, r.note_date, r.status, 'attempts=%s' % r.attempts)
"
# 9 2026-07-29 sent attempts=1
```

Now try to make it send twice. None of these produce a second message:

- **Wait several more ticks** — `materialize_due` finds the row and leaves it alone.
- **Restart the worker** (`docker compose restart worker`) — state lives in Postgres, not memory.
- **Change your time zone or reminder time** — `resync_pending` updates the existing pending row
  rather than inserting a new one, and a `sent` row is never touched.
- **Move the note's date away and back** — the row for the original date is cancelled and then
  revived only if it had not already been sent.

## 5. Things worth trying

| Action | Expected |
| --- | --- |
| Turn the toggle off before the time arrives | Row goes `cancelled`, nothing is sent |
| Archive the note before the time arrives | Row goes `cancelled` |
| Clear the note's date | Row goes `cancelled` |
| Press **Disconnect** | Binding cleared, reminders switched off, endpoint is idempotent |
| Stop the worker for a day, then start it | Yesterday's reminder is cancelled, not delivered late |
| Remove `backend/.env` and `make up` | Stack starts, worker logs "idle", Settings explains why |

## Notes on time zones

Scheduling converts the note's calendar date plus your reminder time, interpreted in your zone,
into a single UTC instant. Two edge cases are covered by unit tests rather than by hand:

- **Spring forward** — `2026-03-29 02:30` does not exist in `Europe/Berlin`; it resolves to
  `01:30 UTC`.
- **Fall back** — `2026-10-25 02:30` happens twice; it resolves to `00:30 UTC`.

## Recording the walkthrough

Steps 2 and 3 are what a screen recording needs to show: the Settings page with the connect
button, Telegram opening on the bot, the confirmation reply, and then the reminder arriving.
`docker compose logs -f worker` next to the Telegram window makes the causality obvious.
