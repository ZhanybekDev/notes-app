# Demo - Telegram reminder really sends

Reproducible command sequence proving the bot delivers a reminder when a note's
date arrives. Takes ~2 minutes. A screen recording of this exact flow accompanies
the submission.

## 0. Get a bot token (once)

In Telegram, talk to **@BotFather** -> `/newbot` -> follow prompts -> copy the token.

## 1. Configure + boot

Create a local `.env` in the repo root (gitignored - never committed):

```bash
cat > .env <<'EOF'
TELEGRAM_BOT_TOKEN=<your-token-from-botfather>
TELEGRAM_BOT_USERNAME=<your_bot_username>
REMINDER_INTERVAL_SECONDS=20
EOF

make up      # db + backend + worker + frontend
make seed    # demo / demo1234, incl. a "Grocery list" note dated TODAY
```

Confirm the worker picked up the token (no token -> it logs "reminder worker idle"):

```bash
docker compose logs worker | tail -5
# ... worker INFO worker started; reminder interval=20s
```

## 2. Link a Telegram chat

1. Open http://localhost:5173 , log in as `demo` / `demo1234`.
2. Go to **Settings -> Telegram reminders -> Link Telegram**.
3. Open the shown `https://t.me/<bot>?start=<code>` link and press **Start**
   (or send the bot `/start <code>`).

The worker captures your chat via `getUpdates`, binds it, and enables reminders:

```bash
docker compose logs worker | grep -iE "sent|linked"
docker compose exec db psql -U postgres -d notes \
  -c "select username, telegram_chat_id is not null as linked, telegram_enabled from users;"
#  demo | t | t
```

## 3. Receive the reminder

The seeded "Grocery list" note is dated today, so on the next ~20s tick the bot
sends a real message to your chat:

```
Reminder: Grocery list
Date: <today>

- milk
- bread
- eggs
```

## 4. Verify idempotency (no double send)

Leave it running a few minutes. The worker ticks every 20s but the message arrives
exactly once - the `reminders_sent` ledger has a single row and the claim-first
write means the `UNIQUE(note_id, note_date)` constraint gates delivery itself:

```bash
docker compose exec db psql -U postgres -d notes \
  -c "select note_id, note_date, sent_at from reminders_sent;"
# exactly one row; no second Telegram message
```

## 5. Toggle off / on

In Settings, uncheck **Send reminders** -> the next tick sends nothing
(`telegram_enabled = false`). Re-check to resume.
