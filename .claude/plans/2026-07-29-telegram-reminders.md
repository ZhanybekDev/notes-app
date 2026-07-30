# Plan: Telegram-напоминания по дате заметки

**Goal:** Пользователь привязывает Telegram в настройках и в момент наступления даты заметки получает сообщение от бота — ровно один раз, в своей таймзоне, с переживанием рестарта и retry при сбоях.

**Context:** `note_date` сейчас пассивен — только отображение и фильтрация. Фича вводит в CRUD-приложение первый код, работающий без HTTP-запроса пользователя: фоновый процесс, внешнюю интеграцию и состояние «уже отправлено». В scaffold нет ни планировщика, ни таймзон, ни outbox — всё это создаётся с нуля. Research (`.claude/research/telegram-reminders.md`) подтвердил: новых зависимостей не требуется, `httpx` и `zoneinfo` уже в образе.

**Total estimate:** 3–4.5 часа / 1–2 сессии Claude Code

---

## Phase 1: Привязка Telegram и настройки уведомлений

**Estimate:** 1–1.5 часа

**What changes:**
- `backend/alembic/versions/0003_user_telegram_settings.py` — `revision = "0003"`, `down_revision = "0002"` (ревизии в проекте — простые строки, проверено). На `users`: `timezone` (String(64), NOT NULL, **`server_default='UTC'`**), `reminder_time` (Time, NOT NULL, **`server_default='09:00'`**), `notifications_enabled` (Boolean, NOT NULL, **`server_default=sa.false()`**), `telegram_chat_id` (BigInteger, nullable, unique), **`telegram_username` (String(32), nullable)**, `telegram_linked_at`, `telegram_link_code` (String(43), nullable, unique), `telegram_link_code_expires_at`. `server_default` у всех трёх NOT NULL обязателен — без него `add_column` падает на существующих строках; паттерн взят из `0001_init.py`. Рабочий `downgrade()` — `drop_column` в обратном порядке + снятие constraint'ов.
- `backend/app/models.py` — те же поля на `User`.
- `backend/app/config.py` — `telegram_bot_token: str | None = None`, `telegram_bot_username: str | None = None`. Обязательно nullable: без токена стек должен подниматься. **`field_validator(mode='before')`, приводящий пустую и пробельную строку к `None`.** `.env.example` содержит `TELEGRAM_BOT_TOKEN=` без значения, и скопированный из него `backend/.env` даёт пустую строку, а не отсутствие ключа — без нормализации `is None` возвращает ложный результат и получается тихая деградация. `bot_configured = bool(token and username)` — при заданном токене без username deep-link собрался бы битым.
- `backend/app/telegram.py` — новый модуль. Синхронный клиент на `httpx.Client`: `get_updates(offset, timeout)`, `send_message(chat_id, text)`. Исключения `TelegramNotConfigured` / `TelegramRetryAfter(seconds)` / `TelegramError`. Токен никогда не попадает в текст исключения и в логи. **`parse_mode` не выставляется — сообщения уходят как plain text.** Приложение хранит Markdown, и содержимое заметки почти гарантированно содержит `*`, `_`, `[`, backticks; с включённым `parse_mode` Telegram отвечает 400 на неразобранной разметке, то есть напоминание падало бы именно на реальных заметках, а не на тестовых.
- `backend/app/schemas.py` — `AccountSettingsOut` (timezone, reminder_time, notifications_enabled, telegram_linked, `telegram_username`, bot_configured), `AccountSettingsIn`, `TelegramLinkOut` (deep_link_url, expires_at). `telegram_username` берётся из колонки, которую воркер заполняет из `message.from.username` при `/start` — у поля обязан быть источник, иначе UI показывает вечный пустой плейсхолдер. `chat_id` наружу не отдаётся никогда.
- `backend/app/routers/account.py` — `GET /account/settings`, `PATCH /account/settings`, `POST /account/telegram/link`, `DELETE /account/telegram`. Валидация `timezone` через `zoneinfo.available_timezones()`, `reminder_time` — Pydantic `time`. Привязка чужого уже занятого `telegram_chat_id` (колонка unique) → **явный 409 с внятным текстом**, а не `IntegrityError` в 500.
- `backend/app/telegram_link.py` — **доменная логика привязки, а не `scripts/`**: `issue_link_code(db, user)` и `handle_start_command(db, update) -> LinkOutcome`. Находит юзера по коду с непросроченным TTL → пишет `telegram_chat_id` и `telegram_username` из `message.from.username`, включает уведомления, чистит код. Неизвестный/просроченный код → отказ с внятной причиной. То же обоснование, что и для `reminders.py`: `--cov=app` не видит `scripts/`, и логика, оставленная в воркере, выпадает из-под метрики целиком. Phase 1 обязана следовать этому правилу так же, как Phase 2.
- `backend/scripts/worker.py` — новый процесс, **тонкая обёртка**. Цикл `getUpdates(offset, timeout=25)` → передаёт апдейты в `app/telegram_link.handle_start_command` → отвечает результатом. Никакой доменной логики внутри. Offset пересчитывается как `max(update_id)+1`.

  > **Сброса хвоста на старте (`offset=-1`) нет намеренно.** Обработка `/start` идемпотентна (поиск по коду, просроченный → отказ), поэтому переигрывание безопасно, а вот сброс молча съел бы нажатия, сделанные пока воркер лежал: пользователь жмёт кнопку, ничего не происходит, причины не видно. Telegram хранит неподтверждённые апдейты 24 часа — этого достаточно.

  > **Поллер обязан быть ровно один.** Telegram отдаёт `409 Conflict: terminated by other getUpdates request` при двух одновременных `getUpdates` на один токен — это ограничение самого API, не наша архитектура. Поэтому сервис `worker` держится в одной реплике; горизонтально масштабируется только отправка, за счёт `SKIP LOCKED` в claim, а не опрос.

- `docker-compose.yml` — сервис `worker`: тот же образ backend, `command: python -m scripts.worker`, **одна реплика**, `volumes: ./backend:/app` (как у backend), `environment: DATABASE_URL` + `JWT_SECRET`, `depends_on: db healthy`. **Блока `env_file` и проброса `${TELEGRAM_BOT_TOKEN:-}` в compose быть не должно вообще.**

  > Проверено в живом контейнере: `config.py` объявляет `SettingsConfigDict(env_file=".env")`, WORKDIR — `/app`, а `./backend` смонтирован в `/app`, поэтому **pydantic-settings уже читает `backend/.env` сам**. Запрос из контейнера вернул непустой токен и username `maddev_test_bot` без единой правки compose. (Само значение токена в план не выносится — файл может уехать в форк.)
  >
  > Дублировать это через compose не просто избыточно, а вредно. Отдельно проверено: если переменная перечислена и в `env_file`, и в `environment` как `${TELEGRAM_BOT_TOKEN:-}`, то при отсутствии корневого `.env` интерполяция даёт `""` и **затирает значение из файла** — сервис получает `TELEGRAM_BOT_TOKEN: ""`. Тот же сервис без блока `environment` получает значение из файла. То есть «пробросим обоими способами на всякий случай» ломает ровно тот сценарий, ради которого файл и заводится, и молча: снаружи выглядит как «бот не настроен».
  >
  > А вот `DATABASE_URL` и `JWT_SECRET` воркеру в `environment` **обязательны**: `app.config.Settings` требует `jwt_secret` без дефолта и с валидатором на длину, а дефолт `database_url` указывает на `localhost`, которого в контейнере нет. Без них воркер падает на импорте, если у пользователя нет `backend/.env` — то есть ровно при чистом клоне.

  **`depends_on` мало: на чистом volume воркер стартует одновременно с `alembic upgrade head` в backend и упрётся в отсутствующие таблицы** — поэтому воркер на старте ретраится с backoff, пока схема не появится, а не падает в краш-луп.
- `backend/.env.example` — `TELEGRAM_BOT_TOKEN=`, `TELEGRAM_BOT_USERNAME=`. Плейсхолдер `JWT_SECRET=replace-with-...` в этом файле входит в `_WEAK_JWT_SECRETS` и был бы отвергнут валидатором, но копирование файла безопасно: `environment` в compose перекрывает dotenv (проверено — реальная переменная окружения выигрывает у `.env` в pydantic-settings).
- `backend/scripts/seed.py` — демо-юзеру проставить `timezone`, `reminder_time`.
- `backend/openapi.json` — `make openapi-dump`.
- `frontend/src/api.js` — `getSettings`, `updateSettings`, `linkTelegram`, `unlinkTelegram`.
- `frontend/src/pages/Settings.jsx` — секция «Уведомления»: select таймзоны, поле времени, тумблер уведомлений, кнопка «Привязать Telegram» (открывает deep-link) / «Отвязать», статус привязки. Если `bot_configured=false` — секция показывает явное сообщение «бот не настроен», а не молча ломается. **Список таймзон — `Intl.supportedValuesOf('timeZone')`** (проверено во фронт-рантайме: Node 20, 418 зон), эндпойнт для справочника не нужен; предзаполнение — `Intl.DateTimeFormat().resolvedOptions().timeZone`. Бэкенд валидирует по `zoneinfo` (486 зон) — надмножество, конфликта нет.
- `frontend/src/i18n.jsx` + `frontend/src/styles.css` — строки EN и RU, стили секции.
- `frontend/src/pages/Settings.test.jsx` — новый файл.
- `backend/tests/test_account_settings.py`, `backend/tests/test_telegram_client.py`, `backend/tests/test_telegram_link.py` — новые. Последний тестирует `app/telegram_link.py` напрямую, без запуска цикла воркера.
- `backend/tests/test_auth.py` — прогнать `ruff format`. **На чистом клоне `make lint` уже красный** (`tests/test_auth.py:90`), DoD пункт 3 не выполняется до наших изменений.

**Acceptance criteria:**
- [ ] **Токен из `backend/.env` реально доезжает до воркера** — проверять через `docker compose exec worker python -c "from app.config import settings; print(bool(settings.telegram_bot_token))"`. Именно так, а не через `printenv`: токен приходит из dotenv-файла средствами pydantic-settings и в окружении процесса его нет — `printenv` покажет пустоту на исправной конфигурации
- [ ] `make up` работает **без** токена — backend и worker поднимаются, worker логирует «token not configured, idle» и не падает в краш-луп. Проверять временно переименовав `backend/.env`: на этой машине файл уже существует с рабочим токеном, и без переименования сценарий «без токена» не воспроизводится
- [ ] С токеном: в Settings кнопка открывает `t.me/<bot>?start=<code>`, после `/start` бот отвечает, страница по refresh показывает «привязан» и **выводит telegram-username, полученный из апдейта**
- [ ] `make up` на чистом volume (`make clean` перед этим): воркер переживает гонку с `alembic upgrade head` — ретраится, а не уходит в краш-луп
- [ ] `/start`, нажатый пока воркер лежал, обрабатывается после его старта — сброса хвоста нет, нажатие не теряется
- [ ] Повторный `/start` с тем же кодом после успешной привязки не создаёт второй привязки и не роняет воркер
- [ ] Просроченный код (TTL 15 мин) отклоняется
- [ ] Успешная привязка **включает** `notifications_enabled`, отвязка — выключает и чистит `telegram_chat_id`/`telegram_username`. Решение осознанное и симметричное: иначе пользователь привязывает бота, ничего не получает и не понимает почему; тумблер остаётся доступным для ручного выключения без отвязки
- [ ] Невалидная таймзона → 422, не 500
- [ ] Попытка привязать уже занятый другим юзером Telegram-аккаунт → 409 с внятным текстом, не 500
- [ ] Токен задан, username нет → `bot_configured=false`, UI объясняет причину, битый deep-link не собирается
- [ ] Пустая строка в `TELEGRAM_BOT_TOKEN` (ровно то, что даёт скопированный из `.env.example` файл) трактуется как «не задан» — покрыто тестом
- [ ] `make seed` работает после миграции; `alembic downgrade -1` проходит и `make seed` продолжает работать
- [ ] Каждая новая UI-строка есть в EN и RU
- [ ] `make test` зелёный, backend coverage ≥ 80%; `make lint` зелёный; `openapi.json` не дрейфует

**Implementation outline:**
0. Отдельный worktree от `main` — задача трогает ~25 файлов; в конце squash merge. Ветку вести именно от `main`, не от чужих `feat/telegram-*` в origin.
1. `ruff format` на `tests/test_auth.py` — починить унаследованный красный гейт отдельным первым коммитом.
2. Модель + миграция + `make seed` + прогон `upgrade`/`downgrade`.
3. `config.py` → `telegram.py` (клиент) → тесты клиента на `httpx.MockTransport` (без сети).
4. `app/telegram_link.py` + тесты — вся логика привязки до того, как появится воркер.
5. Эндпойнты в `account.py` + тесты на фикстуре `client` из `conftest.py`.
6. `scripts/worker.py` — тонкий цикл поверх `telegram_link`; тест вызывает одну итерацию с подставным клиентом, не крутит бесконечный цикл.
7. Compose: сервис `worker` с `DATABASE_URL`/`JWT_SECRET`, `.env.example`.
8. Frontend: `api.js` → `Settings.jsx` → i18n EN+RU → `Settings.test.jsx`.
9. `make openapi-dump`, self-review, `make test`, `make lint`.

**Test strategy:**
- Unit: `telegram.py` через `httpx.MockTransport` — успех, 429 с `retry_after`, 5xx, сетевой таймаут, отсутствие `parse_mode` в теле запроса. Разбор `/start` — валидный код, неизвестный, просроченный, `/start` без аргумента, апдейт без `message.from.username` (username в Telegram необязателен — поле остаётся `NULL`, привязка всё равно проходит).
- Integration: 4 эндпойнта на TestClient — авторизация, валидация таймзоны, идемпотентность повторной привязки, чужой код не привязывается к чужому юзеру.
- Manual: поднять стек с реальным токеном от @BotFather, привязать через UI.

---

## Phase 2: Доставка напоминаний через outbox

**Estimate:** 1.5–2 часа

**What changes:**
- `backend/alembic/versions/0004_reminders.py` — `revision = "0004"`, `down_revision = "0003"`. Таблица `reminders`: `id`, `user_id` FK CASCADE, `note_id` FK CASCADE, **`note_date` (Date, NOT NULL) — стабильный occurrence key**, `scheduled_for` (DateTime(timezone=True), изменяемое), `status` (String: `pending`/`sent`/`failed`/`cancelled`), `attempts` (Integer default 0), `last_error` (Text nullable), `sent_at` (nullable), `created_at`. **`UniqueConstraint('note_id', 'note_date')`** — одно напоминание на заметку на дату. Индекс по `(status, scheduled_for)`. Рабочий `downgrade()`.

  > Ключ идемпотентности обязан быть **стабильным**, а не вычисляемым. Если ключом сделать `scheduled_for`, то смена таймзоны или `reminder_time` даёт другое значение → вставляется вторая строка, констрейнт не нарушен, старая остаётся `pending`, и пользователь получает **два** сообщения об одной заметке. `note_date` от настроек не зависит.

- `backend/app/models.py` — модель `Reminder`.
- `backend/app/reminders.py` — новый модуль, чистая доменная логика:
  - `compute_scheduled_for(note_date, tz_name, reminder_time) -> datetime` — `datetime.combine(...)` сразу с `tzinfo=ZoneInfo(tz)` → aware, затем в UTC. Никакой наивной арифметики.
  - `materialize_due(db, now, backfill_window)` — кандидаты отбираются **через `NOT EXISTS`** по `reminders`: заметки с `note_date`, не архивные, юзеров с `notifications_enabled` и привязанным chat_id, в пределах окна backfill (24 ч). `IntegrityError` остаётся, но как **страховка от гонки** (ручной прогон `tick()` параллельно с сервисом, повторный запуск при рестарте), а не как основной механизм — иначе каждые 30 секунд идёт откатывающаяся вставка на каждую уже материализованную заметку, что засоряет логи Postgres и накручивает `xact_rollback`.
  - **Реактивация `cancelled`.** Строка со статусом `cancelled` занимает ключ `(note_id, note_date)`, поэтому `NOT EXISTS` отфильтрует заметку, а повторная вставка упадёт на констрейнте. Сценарий, который иначе ломается насмерть: пользователь сдвинул дату с 1 на 5 августа (строка за 1-е ушла в `cancelled`), потом вернул обратно на 1-е — напоминание не придёт уже никогда. Поэтому материализация работает как upsert по ключу: строки `cancelled` при вернувшихся условиях **возвращаются в `pending`** с пересчитанным `scheduled_for`; `sent` не трогается никогда. Партиальный уникальный индекс (`WHERE status <> 'cancelled'`) как альтернатива отвергнут — это Postgres-специфика, ломающая SQLite-тесты.
  - `resync_pending(db)` — у существующих `pending`-строк пересчитать `scheduled_for` под текущие таймзону и `reminder_time` пользователя (**обновить строку, не вставлять новую**).
  - `cancel_stale(db, now)` — перевести в `cancelled` те `pending`, что перестали быть актуальными: заметка заархивирована, `note_date` изменён или стёрт, пользователь выключил уведомления или отвязал Telegram, либо `scheduled_for` протух за пределы окна backfill (воркер лежал сутки — не надо слать вчерашнее). Без этого шага строка, созданная при одних условиях, выстрелит при других.
  - `claim_batch(db, limit)` — `select(Reminder).where(status='pending', scheduled_for <= now).with_for_update(skip_locked=True)`, с повторной проверкой актуальности через join к `notes`/`users`. На SQLite диалект `SKIP LOCKED` молча игнорирует — проверено, тесты не ломаются.
  - `mark_sent` / `mark_failed(attempts+1, last_error)`; после `MAX_ATTEMPTS` (5) → `failed`, без бесконечных ретраев.
  - `render_message(note)` — заголовок + дата + обрезанный до 300 символов фрагмент, plain text. **Ссылки на заметку в сообщении нет и быть не может:** в `App.jsx` маршруты — `/login`, `/register`, `/notes`, `/calendar`, `/settings`, выбор заметки живёт во внутреннем состоянии `Notes.jsx`, роута `/notes/:id` не существует (проверено). Придумывать URL нельзя — он будет вести в никуда. Добавление deep-link на заметку — отдельная задача, вынесена в out of scope.

  > Вся логика живёт в `app/`, а не в `scripts/`, по измеримой причине: `pytest.ini` задаёт `--cov=app`, поэтому код в `scripts/` **не попадает в покрытие вообще**. Тонкий воркер — не стилистика, а условие того, что метрика что-то значит.
- `backend/scripts/worker.py` — добавить к циклу привязки шаг `tick()`: materialize → resync → cancel_stale → claim → send → mark. Тонкая обёртка над `app/reminders.py`, без доменной логики внутри. Скан не чаще раза в 30 с по `monotonic()`, чтобы частые апдейты не превращались в busy-loop. `TelegramRetryAfter` → уважать `retry_after` буквально, напоминание остаётся `pending`. Graceful shutdown по SIGTERM.
- `backend/scripts/seed.py` — заметка с `note_date = today` уже есть, добавить явно помеченную «для демо напоминания».
- `frontend/src/pages/Notes.jsx` — **грузит настройки и передаёт `reminderHint` пропом**. Фетч живёт на странице, а не в компоненте: `docs/architecture.md` фиксирует правило «`components/*` stay presentational; fetching lives in `pages/*`», а `NoteEditor` — `forwardRef` на чистых props без единого обращения к `api.js` (проверено).
- `frontend/src/components/NoteEditor.jsx` — рядом с полем даты рендерит пришедший пропом `reminderHint`: «напоминание придёт в HH:MM» / «уведомления выключены» со ссылкой в настройки. Компонент остаётся presentational.
- `frontend/src/i18n.jsx` — строки EN и RU.
- `backend/tests/test_reminders.py`, `backend/tests/test_worker_tick.py` — новые.
- `backend/openapi.json` — перегенерировать, если схема изменилась.

**Acceptance criteria:**
- [ ] Заметка с сегодняшней датой у привязанного юзера с включёнными уведомлениями → сообщение приходит в Telegram
- [ ] **Два прогона `tick()` подряд дают ровно одну отправку** — прямой тест на идемпотентность
- [ ] **Конкурентный `claim_batch` не выдаёт одну строку дважды** — тест на уровне БД (два сеанса claim), а не запуском двух воркеров: два поллера на один токен запрещены самим Telegram (`409 Conflict`), поэтому «два воркера» — не поддерживаемый сценарий и проверять надо именно claim
- [ ] Юзер с `notifications_enabled=false` или без `chat_id` не получает ничего и не порождает строк в `reminders`
- [ ] Архивная заметка пропускается
- [ ] Заметка с датой недельной давности не материализуется (окно backfill)
- [ ] Таймзона: юзер в `Asia/Bishkek` с `reminder_time=09:00` получает `scheduled_for = 03:00 UTC` — проверено юнит-тестом
- [ ] **Смена таймзоны или `reminder_time` до отправки обновляет существующую `pending`-строку, а не создаёт вторую** — прямой тест: после смены настроек в `reminders` по-прежнему одна строка на заметку
- [ ] Уже отправленное не переотправляется ни при какой смене настроек
- [ ] Заметка заархивирована / `note_date` изменён или стёрт / уведомления выключены / Telegram отвязан после материализации → `pending` уходит в `cancelled`, сообщение не отправляется
- [ ] `pending` со `scheduled_for` старше окна backfill (воркер лежал сутки) → `cancelled`, а не отправка вчерашнего
- [ ] **Дата сдвинута и возвращена обратно** (1 авг → 5 авг → 1 авг): `cancelled`-строка реактивируется в `pending`, напоминание приходит; дублей не появляется
- [ ] Уже `sent`-строка не реактивируется никогда — возврат даты не порождает повторную отправку
- [ ] 429 от Telegram → напоминание остаётся `pending`, `attempts` растёт, следующий тик повторяет
- [ ] После 5 неудач статус `failed`, воркер живёт дальше
- [ ] Рестарт воркера не теряет и не дублирует напоминания
- [ ] `make test` зелёный, coverage ≥ 80%; `make lint` зелёный; `alembic downgrade -1` работает

**Implementation outline:**
1. Модель `Reminder` + миграция + проверка `upgrade`/`downgrade`.
2. `reminders.py` целиком с юнит-тестами на таймзоны, идемпотентность и отмену — до того, как трогать воркер.
3. `send_message` с обработкой 429/`retry_after` и подсчётом попыток.
4. `tick()` в воркере, склейка materialize → resync → cancel_stale → claim → send.
5. Фетч настроек в `Notes.jsx` + проп `reminderHint` в `NoteEditor.jsx` + i18n EN/RU.
6. Self-review, `make test`, `make lint`, `make openapi-dump`.

**Test strategy:**
- Unit: `compute_scheduled_for` — Bishkek/UTC/отрицательный оффсет, переход DST (двойное и несуществующее локальное время). `materialize_due` — повторный вызов не создаёт дубль, фильтры по archived/enabled/chat_id/окну. `resync_pending` — смена таймзоны и `reminder_time` обновляет строку, число строк не растёт. `cancel_stale` — все пять условий отмены по отдельности.
- Integration: `tick()` с подставным клиентом, считающим вызовы — двойной прогон = одна отправка; смена настроек между тиками = всё равно одна отправка; 429 → повтор; 5 неудач → `failed`.
- Manual: реальный бот, заметка на сегодня, время напоминания сдвинуто на минуту вперёд — записать видео прихода сообщения.

---

## Phase 3: Демо и сопроводительные материалы

**Estimate:** 0.5–1 час

Это не «полировка» — это прямо перечисленные в ТЗ артефакты сдачи («приложи короткое видео», раздел «Что прислать» из 6 пунктов). Без них задание не считается выполненным.

**What changes:**
- `docs/architecture.md` — обновить: сервис `worker` в таблице сервисов и mermaid-диаграмме, `Reminder` в ER-модели, новые эндпойнты в таблице API, новые env-vars. Снять утверждение «backend — no background jobs», заменив на описание отдельного воркера.
- `README.md` — раздел «Telegram reminders»: получение токена у @BotFather, **шаг `cp backend/.env.example backend/.env` и заполнение двух переменных** (иначе неочевидно, что конфиг читается из файла, а не из compose), привязка, поведение без токена. Явно сказать, что без `backend/.env` квик-старт работает как раньше — просто без напоминаний.
- `docs/demo.md` — последовательность команд для воспроизведения демо (поднять стек → сид → привязать → выставить время на минуту вперёд → показать лог воркера и сообщение).
- `docs/media/demo.mp4` — запись экрана: привязка в UI и приход сообщения в Telegram.
- `SUBMISSION.md` — 6 пунктов из ТЗ: ссылка на форк, инструмент и модель, обоснование выбора, замечания по scaffold, что дальше, known caveats.

**Acceptance criteria:**
- [ ] На чистой машине по README можно поднять и получить напоминание, не заглядывая в код
- [ ] `docs/architecture.md` не содержит утверждений, противоречащих коду
- [ ] Видео показывает и привязку, и реальный приход сообщения
- [ ] `SUBMISSION.md` закрывает все 6 пунктов, включая честные caveats
- [ ] Финальный прогон на чистом клоне: `make clean && make up && make seed && make test && make lint` — всё зелёное
- [ ] **Полный цикл миграций** `alembic downgrade base` → `alembic upgrade head` → `make seed` проходит, а не только `downgrade -1` из каждой фазы отдельно

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
| 6 | Для доставки токена в контейнер нужен `env_file` в compose | pydantic-settings в живом контейнере прочитал `/app/.env` | ❌ **не нужен** — `config.py` читает `backend/.env` сам |
| 7 | `openapi.json` проверяется snapshot-тестом на дрейф | `backend/tests/test_openapi.py` | ✅ |
| 8 | Порог покрытия 80% с `--cov-fail-under` | `backend/pytest.ini` | ✅ |
| 9 | Парность EN/RU строк тестом не проверяется — только ручная дисциплина | `frontend/src/i18n.test.jsx` | ✅ не проверяется |
| 10 | `Note.note_date` — `Date` без времени, у `User` таймзоны нет | `backend/app/models.py` | ✅ |
| 11 | Ревизии Alembic — простые строки `0001`/`0002`, имя `0003`/`0004` впишется | `cat alembic/versions/*.py` | ✅ |
| 12 | `0001_init.py` задаёт NOT NULL только с `server_default` — паттерн для 0003 | `cat alembic/versions/0001_init.py` | ✅ |
| 13 | `NoteEditor.jsx` — presentational, fetch делать нельзя | `cat components/NoteEditor.jsx` | ✅ чистые props |
| 14 | `httpx.MockTransport` доступен для тестов клиента | выполнено в контейнере | ✅ |
| 15 | `Intl.supportedValuesOf('timeZone')` есть во фронт-рантайме | `node -e` в контейнере frontend | ✅ Node 20, 418 зон |
| 16 | Пустое значение в dotenv трактуется как «ключа нет» | `docker compose config` + `.env.example` с `TELEGRAM_BOT_TOKEN=` | ❌ **даёт `""`** — отсюда валидатор в `config.py` |
| 17 | Coverage меряет код воркера | `pytest.ini` → `--cov=app`, вывод покрытия | ❌ **`scripts/` вне охвата** — отсюда требование тонкого воркера |
| 18 | Два воркера можно гонять параллельно, как в acceptance criteria | Telegram Bot API + полевые отчёты | ❌ **`409 Conflict`** на втором `getUpdates` — поллер строго один |
| 19 | Воркер стартует уже после применения миграций | `docker-compose.yml`: `alembic upgrade head` живёт в команде backend, worker зависел бы только от `db healthy` | ❌ **гонка на чистом volume** — отсюда ретраи на старте |
| 20 | Токен бота и username получены и проверены | `getMe` → `ok: true`, бот `maddev_test_bot`; лежит в `backend/.env`, покрыт `.gitignore:8` | ✅ внешняя зависимость снята |
| 21 | `env_file` и `environment: ${VAR:-}` вместе безопасны — «продублируем на всякий случай» | `docker compose config` на двух сервисах с раздельными источниками | ❌ **`environment` даёт `""` и затирает файл** — от обоих механизмов в compose отказались |
| 22 | Воркеру хватит того, что унаследуется от образа | `config.py`: `jwt_secret` без дефолта + валидатор; `database_url` по умолчанию `localhost` | ❌ **нужны `DATABASE_URL` и `JWT_SECRET` в `environment`** — иначе падение на импорте при чистом клоне |

---

## Out of scope (явно не делаем)

- Public sharing и export — по решению по scope берём только напоминания
- Webhook вместо long polling (нужен публичный URL; для локального `make up` бессмыслен)
- Повторяющиеся напоминания, снузы, статус «выполнено» у заметки
- Несколько Telegram-аккаунтов на одного пользователя
- Замена in-memory `rate_limit.py` на persistent — отдельная задача, попадёт в «что дальше»
- Оптимизация фильтра по тегам в `notes.py` (тянет все заметки в память) — туда же
- Уведомления по email / push
- Deep-link на конкретную заметку в тексте напоминания — требует роута `/notes/:id`, которого в `App.jsx` нет; отдельная задача

---

## Risks / Unknowns

- ~~**Нужен реальный токен от @BotFather**~~ — **снято.** Токен получен, проверен через `getMe` (бот `maddev_test_bot`), лежит в `backend/.env` под `.gitignore`. Код и тесты всё равно пишутся на моках и токена не требуют. Токен светился в переписке открытым текстом — после сдачи отозвать через `/revoke`.
- **DST-переходы** — локальное время может не существовать или существовать дважды. Митигация: явный юнит-тест на обе ситуации, поведение задокументировано в `docs/demo.md`.
- **Лавина при первом запуске** — все прошлые заметки с датами становятся «просроченными». Митигация: окно backfill 24 часа, покрыто тестом.
- **Покрытие: риск не там, где кажется.** `pytest.ini` меряет `--cov=app`, поэтому `scripts/worker.py` не измеряется вообще, а порог 80% при текущих 94.37% не под угрозой даже при слабом покрытии нового кода (арифметика даёт ~84%). Настоящий риск — уехавшая в `worker.py` логика молча выпадает из-под метрики. Митигация: домен целиком в `app/reminders.py`, `app/telegram.py` и `app/telegram_link.py`, воркер — тонкая обёртка, тестируется одна итерация `tick()`, а не бесконечный цикл.
- **429 стал per-chat с layer 167** — в демо на одного пользователя не проявится, но обработка `retry_after` реализуется сразу, а не «потом».
- **Ветки `feat/telegram-reminders` и `feat/telegram-bot-worker` уже есть в origin** — чужие решения той же задачи. Свою ветку вести от `main`, чтобы решение было независимым.

---

## Открытые решения (за тобой)

- **Два env-var или автоопределение username через `getMe`.** Альтернатива плану: воркер на старте один раз дёргает `getMe`, берёт username оттуда, и `TELEGRAM_BOT_USERNAME` исчезает совсем — одна переменная вместо двух, рассогласовать невозможно. Цена — сетевой вызов на старте и ещё один путь отказа. Оба варианта жизнеспособны; по умолчанию в плане оставлены два env-var.
- **Коммитить ли `.claude/` в ветку задания.** Директории нет в `.gitignore`, значит план, research и ревью уедут в форк. Для задания, где отдельным пунктом просят «чем делал и почему», показанный процесс скорее плюс — но это осознанное решение, а не умолчание.

---

## Golden Rule compliance

- ✅ Каждая фаза production-ready: Phase 1 даёт работающую привязку, Phase 2 — работающую доставку, Phase 3 — сдаваемый пакет
- ✅ Нет stub / MVP / placeholder — миграции, тесты и i18n делаются внутри своей фазы, не откладываются
- ✅ Vertical slices: обе кодовые фазы идут от миграции до UI, а не «сначала все схемы, потом все роутеры»
- ✅ Тесты внутри каждой фазы, отдельной фазы «Tests» нет
- ✅ Нет подготовительной фазы scaffolding — починка унаследованного линта встроена первым шагом Phase 1
- ✅ Claude-scale эстимация в часах, не в днях и спринтах
