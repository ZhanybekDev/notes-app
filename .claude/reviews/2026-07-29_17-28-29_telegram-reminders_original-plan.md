# Plan: Telegram-напоминания по дате заметки

**Goal:** Пользователь привязывает Telegram в настройках и в момент наступления даты заметки получает сообщение от бота — ровно один раз, в своей таймзоне, с переживанием рестарта и retry при сбоях.

**Context:** `note_date` сейчас пассивен — только отображение и фильтрация. Фича вводит в CRUD-приложение первый код, работающий без HTTP-запроса пользователя: фоновый процесс, внешнюю интеграцию и состояние «уже отправлено». В scaffold нет ни планировщика, ни таймзон, ни outbox — всё это создаётся с нуля. Research (`.claude/research/telegram-reminders.md`) подтвердил: новых зависимостей не требуется, `httpx` и `zoneinfo` уже в образе.

**Total estimate:** 3–4.5 часа / 1–2 сессии Claude Code

---

## Phase 1: Привязка Telegram и настройки уведомлений

**Estimate:** 1–1.5 часа

**What changes:**
- `backend/alembic/versions/0003_user_telegram_settings.py` — на `users`: `timezone` (String(64), NOT NULL, default `'UTC'`), `reminder_time` (Time, NOT NULL, default `09:00`), `notifications_enabled` (Boolean, NOT NULL, default `false`), `telegram_chat_id` (BigInteger, nullable, unique), `telegram_linked_at`, `telegram_link_code` (String(43), nullable, unique), `telegram_link_code_expires_at`. Рабочий `downgrade()` — `drop_column` в обратном порядке + снятие constraint'ов.
- `backend/app/models.py` — те же поля на `User`.
- `backend/app/config.py` — `telegram_bot_token: str | None = None`, `telegram_bot_username: str | None = None`. Обязательно nullable: без токена стек должен подниматься.
- `backend/app/telegram.py` — новый модуль. Синхронный клиент на `httpx.Client`: `get_updates(offset, timeout)`, `send_message(chat_id, text)`. Исключения `TelegramNotConfigured` / `TelegramRetryAfter(seconds)` / `TelegramError`. Токен никогда не попадает в текст исключения и в логи.
- `backend/app/schemas.py` — `AccountSettingsOut` (timezone, reminder_time, notifications_enabled, telegram_linked, telegram_username_hint, bot_configured), `AccountSettingsIn`, `TelegramLinkOut` (deep_link_url, expires_at).
- `backend/app/routers/account.py` — `GET /account/settings`, `PATCH /account/settings`, `POST /account/telegram/link`, `DELETE /account/telegram`. Валидация `timezone` через `zoneinfo.available_timezones()`, `reminder_time` — Pydantic `time`.
- `backend/scripts/worker.py` — новый процесс. Цикл `getUpdates(offset, timeout=25)`, разбор `/start <code>`: находит юзера по коду с непросроченным TTL → пишет `telegram_chat_id`, чистит код, отвечает подтверждающим сообщением. Неизвестный/просроченный код → вежливый отказ. Offset пересчитывается как `max(update_id)+1`; на старте — сброс хвоста через `offset=-1`.
- `docker-compose.yml` — сервис `worker` (тот же образ backend, `command: python -m scripts.worker`, `depends_on: db healthy`), проброс `TELEGRAM_BOT_TOKEN`/`TELEGRAM_BOT_USERNAME` в backend и worker через `${VAR:-}`, `env_file` с `required: false` на `backend/.env`.
- `backend/.env.example` — `TELEGRAM_BOT_TOKEN=`, `TELEGRAM_BOT_USERNAME=`.
- `backend/scripts/seed.py` — демо-юзеру проставить `timezone`, `reminder_time`.
- `backend/openapi.json` — `make openapi-dump`.
- `frontend/src/api.js` — `getSettings`, `updateSettings`, `linkTelegram`, `unlinkTelegram`.
- `frontend/src/pages/Settings.jsx` — секция «Уведомления»: select таймзоны, поле времени, тумблер уведомлений, кнопка «Привязать Telegram» (открывает deep-link) / «Отвязать», статус привязки. Если `bot_configured=false` — секция показывает явное сообщение «бот не настроен», а не молча ломается.
- `frontend/src/i18n.jsx` + `frontend/src/styles.css` — строки EN и RU, стили секции.
- `frontend/src/pages/Settings.test.jsx` — новый файл.
- `backend/tests/test_account_settings.py`, `backend/tests/test_telegram_client.py`, `backend/tests/test_worker_link.py` — новые.
- `backend/tests/test_auth.py` — прогнать `ruff format`. **На чистом клоне `make lint` уже красный** (`tests/test_auth.py:90`), DoD пункт 3 не выполняется до наших изменений.

**Acceptance criteria:**
- [ ] `make up` работает **без** `TELEGRAM_BOT_TOKEN` — backend и worker поднимаются, worker логирует «token not configured, idle» и не падает в краш-луп
- [ ] С токеном: в Settings кнопка открывает `t.me/<bot>?start=<code>`, после `/start` бот отвечает, страница по refresh показывает «привязан»
- [ ] Повторный `/start` с тем же кодом после успешной привязки не создаёт второй привязки и не роняет воркер
- [ ] Просроченный код (TTL 15 мин) отклоняется
- [ ] Отвязка чистит `telegram_chat_id` и выключает уведомления
- [ ] Невалидная таймзона → 422, не 500
- [ ] `make seed` работает после миграции; `alembic downgrade -1` проходит и `make seed` продолжает работать
- [ ] Каждая новая UI-строка есть в EN и RU
- [ ] `make test` зелёный, backend coverage ≥ 80%; `make lint` зелёный; `openapi.json` не дрейфует

**Implementation outline:**
1. `ruff format` на `tests/test_auth.py` — починить унаследованный красный гейт отдельным первым коммитом.
2. Модель + миграция + `make seed` + прогон `upgrade`/`downgrade`.
3. `config.py` → `telegram.py` (клиент) → тесты клиента на `httpx.MockTransport` (без сети).
4. Эндпойнты в `account.py` + тесты на фикстуре `client` из `conftest.py`.
5. `scripts/worker.py` — цикл привязки; тест вызывает одну итерацию с подставным клиентом, не крутит бесконечный цикл.
6. Compose: сервис `worker`, env-vars, `.env.example`.
7. Frontend: `api.js` → `Settings.jsx` → i18n EN+RU → `Settings.test.jsx`.
8. `make openapi-dump`, self-review, `make test`, `make lint`.

**Test strategy:**
- Unit: `telegram.py` через `httpx.MockTransport` — успех, 429 с `retry_after`, 5xx, сетевой таймаут. Разбор `/start` — валидный код, неизвестный, просроченный, `/start` без аргумента.
- Integration: 4 эндпойнта на TestClient — авторизация, валидация таймзоны, идемпотентность повторной привязки, чужой код не привязывается к чужому юзеру.
- Manual: поднять стек с реальным токеном от @BotFather, привязать через UI.

---

## Phase 2: Доставка напоминаний через outbox

**Estimate:** 1.5–2 часа

**What changes:**
- `backend/alembic/versions/0004_reminders.py` — таблица `reminders`: `id`, `user_id` FK CASCADE, `note_id` FK CASCADE, `scheduled_for` (DateTime(timezone=True)), `status` (String: `pending`/`sent`/`failed`), `attempts` (Integer default 0), `last_error` (Text nullable), `sent_at` (nullable), `created_at`. **`UniqueConstraint('note_id', 'scheduled_for')`** — это и есть гарантия «не уйдёт дважды». Индекс по `(status, scheduled_for)`. Рабочий `downgrade()`.
- `backend/app/models.py` — модель `Reminder`.
- `backend/app/reminders.py` — новый модуль, чистая доменная логика:
  - `compute_scheduled_for(note_date, tz_name, reminder_time) -> datetime` — `datetime.combine(...).replace(tzinfo=ZoneInfo(tz))` → aware, затем в UTC. Никакой наивной арифметики.
  - `materialize_due(db, now, backfill_window)` — по заметкам с `note_date`, не архивным, юзеров с `notifications_enabled` и привязанным chat_id; вставляет строку в своей транзакции, `IntegrityError` → откат и пропуск (диалект-агностично, без `ON CONFLICT`). Заметки старше окна backfill (24 ч) не материализуются — иначе первый запуск шлёт лавину за всю историю.
  - `claim_batch(db, limit)` — `select(Reminder).where(status='pending', scheduled_for <= now).with_for_update(skip_locked=True)`. На SQLite диалект молча игнорирует — проверено, тесты не ломаются.
  - `mark_sent` / `mark_failed(attempts+1, last_error)`; после `MAX_ATTEMPTS` (5) → `failed`, без бесконечных ретраев.
  - `render_message(note)` — заголовок + дата + обрезанный до 300 символов фрагмент.
- `backend/scripts/worker.py` — добавить к циклу привязки шаг `tick()`: materialize → claim → send → mark. Скан не чаще раза в 30 с по `monotonic()`, чтобы частые апдейты не превращались в busy-loop. `TelegramRetryAfter` → уважать `retry_after` буквально, напоминание остаётся `pending`. Graceful shutdown по SIGTERM.
- `backend/scripts/seed.py` — заметка с `note_date = today` уже есть, добавить явно помеченную «для демо напоминания».
- `frontend/src/components/NoteEditor.jsx` — рядом с полем даты подсказка «напоминание придёт в HH:MM» / «уведомления выключены» со ссылкой в настройки. Только чтение состояния, без новых эндпойнтов.
- `frontend/src/i18n.jsx` — строки EN и RU.
- `backend/tests/test_reminders.py`, `backend/tests/test_worker_tick.py` — новые.
- `backend/openapi.json` — перегенерировать, если схема изменилась.

**Acceptance criteria:**
- [ ] Заметка с сегодняшней датой у привязанного юзера с включёнными уведомлениями → сообщение приходит в Telegram
- [ ] **Два прогона `tick()` подряд дают ровно одну отправку** — прямой тест на идемпотентность
- [ ] Два параллельных воркера не отправляют дубль (claim через `SKIP LOCKED`)
- [ ] Юзер с `notifications_enabled=false` или без `chat_id` не получает ничего и не порождает строк в `reminders`
- [ ] Архивная заметка пропускается
- [ ] Заметка с датой недельной давности не материализуется (окно backfill)
- [ ] Таймзона: юзер в `Asia/Bishkek` с `reminder_time=09:00` получает `scheduled_for = 03:00 UTC` — проверено юнит-тестом
- [ ] Смена таймзоны пользователем до отправки сдвигает время; уже отправленное не переотправляется
- [ ] 429 от Telegram → напоминание остаётся `pending`, `attempts` растёт, следующий тик повторяет
- [ ] После 5 неудач статус `failed`, воркер живёт дальше
- [ ] Рестарт воркера не теряет и не дублирует напоминания
- [ ] `make test` зелёный, coverage ≥ 80%; `make lint` зелёный; `alembic downgrade -1` работает

**Implementation outline:**
1. Модель `Reminder` + миграция + проверка `upgrade`/`downgrade`.
2. `reminders.py` целиком с юнит-тестами на таймзоны и идемпотентность — до того, как трогать воркер.
3. `send_message` с обработкой 429/`retry_after` и подсчётом попыток.
4. `tick()` в воркере, склейка materialize → claim → send.
5. Подсказка в `NoteEditor.jsx` + i18n EN/RU.
6. Self-review, `make test`, `make lint`, `make openapi-dump`.

**Test strategy:**
- Unit: `compute_scheduled_for` — Bishkek/UTC/отрицательный оффсет, переход DST (двойное и несуществующее локальное время). `materialize_due` — повторный вызов не создаёт дубль, фильтры по archived/enabled/chat_id/окну.
- Integration: `tick()` с подставным клиентом, считающим вызовы — двойной прогон = одна отправка; 429 → повтор; 5 неудач → `failed`.
- Manual: реальный бот, заметка на сегодня, время напоминания сдвинуто на минуту вперёд — записать видео прихода сообщения.

---

## Phase 3: Демо и сопроводительные материалы

**Estimate:** 0.5–1 час

Это не «полировка» — это прямо перечисленные в ТЗ артефакты сдачи («приложи короткое видео», раздел «Что прислать» из 6 пунктов). Без них задание не считается выполненным.

**What changes:**
- `docs/architecture.md` — обновить: сервис `worker` в таблице сервисов и mermaid-диаграмме, `Reminder` в ER-модели, новые эндпойнты в таблице API, новые env-vars. Снять утверждение «backend — no background jobs», заменив на описание отдельного воркера.
- `README.md` — раздел «Telegram reminders»: получение токена у @BotFather, `TELEGRAM_BOT_TOKEN`/`TELEGRAM_BOT_USERNAME`, привязка, поведение без токена.
- `docs/demo.md` — последовательность команд для воспроизведения демо (поднять стек → сид → привязать → выставить время на минуту вперёд → показать лог воркера и сообщение).
- `docs/media/demo.mp4` — запись экрана: привязка в UI и приход сообщения в Telegram.
- `SUBMISSION.md` — 6 пунктов из ТЗ: ссылка на форк, инструмент и модель, обоснование выбора, замечания по scaffold, что дальше, known caveats.

**Acceptance criteria:**
- [ ] На чистой машине по README можно поднять и получить напоминание, не заглядывая в код
- [ ] `docs/architecture.md` не содержит утверждений, противоречащих коду
- [ ] Видео показывает и привязку, и реальный приход сообщения
- [ ] `SUBMISSION.md` закрывает все 6 пунктов, включая честные caveats
- [ ] Финальный прогон на чистом клоне: `make up && make seed && make test && make lint` — всё зелёное

**Test strategy:**
- Manual: `make clean` → `make up` → `make seed` → пройти README как посторонний человек.

---

## Assumptions (проверено)

| # | Assumption | Проверка | Статус |
|---|---|---|---|
| 1 | `httpx` уже в зависимостях — новый HTTP-клиент не нужен | `docker compose exec backend python -c "import httpx"` | ✅ 0.28.1 |
| 2 | `zoneinfo` работает в `python:3.11-slim`, tzdata на месте | `available_timezones()` в контейнере | ✅ 486 зон |
| 3 | `FOR UPDATE SKIP LOCKED` не ломает тесты на SQLite | `select(...).with_for_update(skip_locked=True)` на sqlite | ✅ игнорируется молча |
| 4 | Baseline тестов зелёный | `make test` | ✅ 31 + 9, cov 94.37% |
| 5 | Baseline линта **красный** до наших изменений | `make lint` | ❌ `tests/test_auth.py:90` |
| 6 | Compose умеет `env_file: required: false` | `docker compose version` | ✅ v2.40.3 |
| 7 | `openapi.json` проверяется snapshot-тестом на дрейф | `backend/tests/test_openapi.py` | ✅ |
| 8 | Порог покрытия 80% с `--cov-fail-under` | `backend/pytest.ini` | ✅ |
| 9 | Парность EN/RU строк тестом не проверяется — только ручная дисциплина | `frontend/src/i18n.test.jsx` | ✅ не проверяется |
| 10 | `Note.note_date` — `Date` без времени, у `User` таймзоны нет | `backend/app/models.py` | ✅ |

---

## Out of scope (явно не делаем)

- Public sharing и export — по решению по scope берём только напоминания
- Webhook вместо long polling (нужен публичный URL; для локального `make up` бессмыслен)
- Повторяющиеся напоминания, снузы, статус «выполнено» у заметки
- Несколько Telegram-аккаунтов на одного пользователя
- Замена in-memory `rate_limit.py` на persistent — отдельная задача, попадёт в «что дальше»
- Оптимизация фильтра по тегам в `notes.py` (тянет все заметки в память) — туда же
- Уведомления по email / push

---

## Risks / Unknowns

- **Нужен реальный токен от @BotFather** — блокирует ручную проверку и видео. Митигация: код и все тесты пишутся на моках и не требуют токена; получение токена — отдельный ручной шаг перед Phase 3. Это единственная внешняя зависимость плана.
- **DST-переходы** — локальное время может не существовать или существовать дважды. Митигация: явный юнит-тест на обе ситуации, поведение задокументировано в `docs/demo.md`.
- **Лавина при первом запуске** — все прошлые заметки с датами становятся «просроченными». Митигация: окно backfill 24 часа, покрыто тестом.
- **Покрытие ≥80%** — воркер и клиент это заметный объём нового кода. Митигация: воркер разбит на `tick()` и цикл, тестируется одна итерация, а не бесконечный цикл.
- **429 стал per-chat с layer 167** — в демо на одного пользователя не проявится, но обработка `retry_after` реализуется сразу, а не «потом».
- **Ветки `feat/telegram-reminders` и `feat/telegram-bot-worker` уже есть в origin** — чужие решения той же задачи. Свою ветку вести от `main`, чтобы решение было независимым.

---

## Golden Rule compliance

- ✅ Каждая фаза production-ready: Phase 1 даёт работающую привязку, Phase 2 — работающую доставку, Phase 3 — сдаваемый пакет
- ✅ Нет stub / MVP / placeholder — миграции, тесты и i18n делаются внутри своей фазы, не откладываются
- ✅ Vertical slices: обе кодовые фазы идут от миграции до UI, а не «сначала все схемы, потом все роутеры»
- ✅ Тесты внутри каждой фазы, отдельной фазы «Tests» нет
- ✅ Нет подготовительной фазы scaffolding — починка унаследованного линта встроена первым шагом Phase 1
- ✅ Claude-scale эстимация в часах, не в днях и спринтах
