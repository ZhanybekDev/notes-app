# Отчет: архитектурные и кодовые антипаттерны

Дата аудита: 2026-06-05  
Репозиторий: `notes-app`

## 1. Область аудита

Проверены:

- архитектура из `docs/architecture.md`;
- backend: `backend/app/**`, Alembic-миграции, тесты, `Dockerfile`/compose-окружение;
- frontend: `frontend/src/**`, Vite/ESLint/Vitest-конфигурация;
- delivery/devops: `docker-compose.yml`, `Makefile`, наличие CI/CD-конфигураций.

Заявленная архитектура: небольшой full-stack notes app в одном репозитории, 3 сервиса (`frontend`, `backend`, `db`), backend как единственный владелец базы, frontend как SPA с единым сетевым слоем `api.js`.

Основные атрибуты качества под риском: поддерживаемость, масштабируемость запросов, надежность dev/prod-поведения, тестовая детерминированность, безопасность auth-поведения при горизонтальном масштабировании.

## 2. Краткая карта доказательств

| Зона                | Наблюдения                                                                                                                                                            |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Сервисы             | `docker-compose.yml`: `db`, `backend`, `frontend`; backend зависит от healthcheck БД; frontend зависит от backend.                                                    |
| Backend boundaries  | `app/main.py` только монтирует middleware/router; `app/db.py` владеет engine/session; `routers/*` напрямую работают с ORM, что явно описано в `docs/architecture.md`. |
| Data ownership      | Только backend обращается к PostgreSQL. Признаков shared database между сервисами нет.                                                                                |
| Frontend boundaries | Только `frontend/src/api.js` вызывает `fetch`; страницы импортируют `api`, компоненты в основном презентационные.                                                     |
| Tests               | Backend pytest с покрытием `--cov-fail-under=80`; frontend Vitest. Есть один timing-sensitive тест с `time.sleep`.                                                    |
| Delivery            | Есть Makefile и docker-compose для локального запуска, но `.github/` или другая CI/CD-конфигурация не обнаружена.                                                     |

## 3. Findings summary

| ID  | Домен        | Антипаттерн / сигнал                                                           | Уверенность | Серьезность | Почему важно                                                                                                       |
| --- | ------------ | ------------------------------------------------------------------------------ | ----------- | ----------- | ------------------------------------------------------------------------------------------------------------------ |
| A1  | Architecture | Слабый сигнал God Controller / Active Script в backend routers                 | Medium      | Moderate    | Роутеры смешивают HTTP, бизнес-правила, ORM-запросы и транзакции; рост функциональности усложнит изменения.        |
| A2  | Architecture | Документационный drift                                                         | Medium      | Minor       | Архитектурный документ частично расходится с compose/API; это снижает доверие к документации как к контракту.      |
| A3  | Architecture | Distributed Monolith / Shared DB не подтверждены                               | High        | None        | Сервисов мало, shared DB между сервисами нет; текущая архитектура соответствует масштабу.                          |
| C1  | Backend/DB   | In-memory tag filter и tags endpoint как потенциально неограниченные full scan | High        | Major       | `/notes?tag=...` и `/tags` читают все заметки пользователя в память; pagination применяется после выборки.         |
| C2  | Frontend/API | Chatty API / N+1 при открытии дня календаря                                    | High        | Moderate    | UI получает список `note_ids`, затем делает `GET /notes/{id}` для каждой заметки.                                  |
| C3  | Backend      | In-memory rate limiter                                                         | High        | Moderate    | Лимиты auth зависят от процесса, сбрасываются при рестарте и не работают корректно при нескольких backend replica. |
| C4  | Frontend     | Fragile timing workaround через `setTimeout` для shortcuts                     | Medium      | Moderate    | Глобальные actions в `App.jsx` зависят от задержки 30 ms после навигации.                                          |
| C5  | Testing      | Flaky-test signal через `time.sleep`                                           | High        | Minor       | Тест порядка закрепления зависит от времени, а не от контролируемых timestamp/factory.                             |
| C6  | Frontend     | Inline styles / markup leakage                                                 | High        | Minor       | Есть локальные inline styles в компонентах; пока мало, но нарушает единый styling boundary.                        |
| C7  | Frontend     | I18n словари и runtime provider в одном файле                                  | Medium      | Minor       | `i18n.jsx` содержит и большой словарь, и контекст, и resolver; усложняет масштабирование переводов.                |
| C8  | DevOps       | Нет явной CI/CD и rollback strategy                                            | Medium      | Moderate    | `Makefile` автоматизирует локальные команды, но pipeline/release safety не закреплены в репозитории.               |
| C9  | Database     | Index strategy без composite/query-plan evidence                               | Low         | Minor       | Индексы есть, но нет EXPLAIN/нагрузочных критериев; важный list query сортирует/фильтрует по нескольким полям.     |

## 4. Подробные findings

### A1. Backend routers как слабый сигнал God Controller / Active Script

- Гипотеза: роутеры выполняют слишком много ролей: HTTP boundary, авторизация, бизнес-правила, запросы к БД, транзакции.
- Доказательства:
  - `backend/app/routers/notes.py` содержит list/search/tag filtering/calendar/bulk/archive/pin CRUD в одном файле на 248 строк.
  - `notes.py:55-97` строит query, считает total, сортирует и применяет pagination.
  - `notes.py:100-248` содержит create/update/delete/archive/pin/unpin и прямые вызовы `db.commit()`/`db.refresh()`.
  - `account.py:18-50` и `auth.py:20-51` также напрямую управляют ORM и транзакциями.
- Контрдоказательства:
  - Для небольшого приложения это осознанное архитектурное правило: `docs/architecture.md` прямо говорит, что `routers/*` — единственное место, где можно напрямую вызывать ORM.
  - `main.py`, `config.py`, `db.py`, `schemas.py`, `auth.py`, `deps.py` имеют чистые границы и маленький размер.
- Воздействие: при добавлении сложных workflows роутеры станут трудно тестировать изолированно; бизнес-правила будут размазываться по HTTP handlers.
- Уверенность: Medium.
- Серьезность: Moderate.
- Рекомендация: не делать большой rewrite. Ввести application/service слой только для растущих workflows: `NotesService.list_notes`, `NotesService.archive`, `AccountService.change_password`. Сохранить routers как HTTP adapters.

### A2. Документационный drift

- Гипотеза: часть архитектурной документации расходится с текущим состоянием репозитория.
- Доказательства:
  - `docs/architecture.md` указывает Postgres порт `5432`, а `docker-compose.yml:8-9` публикует `5433:5432`.
  - `docs/architecture.md` в API surface для `GET /notes` перечисляет `limit`/`offset`, `archived`, `q`, `tag`, но код поддерживает еще `date_from` и `date_to` (`notes.py:47-48`, `notes.py:63-66`).
  - В `backend/app/rate_limit.py` появился rate limiting, но в `docs/architecture.md` backend packages не отражают этот модуль.
- Контрдоказательства:
  - Основная структура сервисов, data ownership и frontend/backend boundaries в документации соответствуют коду.
- Воздействие: документация перестает быть точным source of truth; onboarding и архитектурные проверки могут опираться на устаревшие данные.
- Уверенность: Medium.
- Серьезность: Minor.
- Рекомендация: обновлять `docs/architecture.md` вместе с изменениями API/infra; добавить короткий checklist в PR-процесс: “API/port/module docs updated?”.

### A3. Distributed Monolith / Shared Database не подтверждены

- Проверка:
  - Только backend обращается к DB (`app/db.py`, `SessionLocal`, ORM usage в backend routers/scripts/tests).
  - Frontend ходит через `api.js`; прямой `fetch` найден только в `frontend/src/api.js:26`.
  - Нет нескольких backend-сервисов, нет cross-service shared schema, нет request chain между микросервисами.
- Решение: это не distributed monolith. Для текущего масштаба three-service compose — приемлемая и простая архитектура.
- Уверенность: High.

### C1. In-memory tag filter и tags endpoint как потенциально неограниченные full scan

- Антипаттерн: database/query anti-pattern — фильтрация и агрегация в памяти вместо queryable model/read model.
- Доказательства:
  - `notes.py:68-82`: при `tag` код вызывает `query.all()`, затем фильтрует `[n for n in query.all() if needle in (n.tags or [])]`, сортирует и применяет `items = candidates[offset : offset + limit]` уже в Python.
  - `tags.py:15-20`: endpoint `/tags` читает `Note.tags` всех заметок пользователя и строит set в Python.
  - `models.py:28`: tags хранятся как `JSON`; отдельной таблицы тегов нет по дизайну.
- Контрдоказательства:
  - Документация явно фиксирует JSON-array tags и отсутствие `tags` table “by design”.
  - Для маленького single-user app это допустимый компромисс.
- Воздействие: pagination перестает ограничивать объем чтения при `tag`; рост числа заметок пользователя приведет к лишней памяти/CPU и долгим ответам. Поиск по тегам невозможно эффективно индексировать переносимо между SQLite tests и PostgreSQL.
- Уверенность: High.
- Серьезность: Major.
- Рекомендация:
  1. Ввести верхние продуктовые ограничения или явный warning в docs, если ожидаются малые объемы.
  2. Для роста — нормализовать `note_tags(note_id, user_id, tag)` или добавить PostgreSQL JSONB + GIN индекс, сохранив SQLite-compatible fallback в тестах.
  3. Минимальный промежуточный шаг: отдельный `tags` read model или materialized table, обновляемый при create/update/delete note.

### C2. Chatty API / N+1 при открытии дня календаря

- Антипаттерн: chatty frontend/backend interaction.
- Доказательства:
  - `backend/app/routers/notes.py:119-143` endpoint `/notes/calendar` возвращает только `note_ids`.
  - `frontend/src/pages/Calendar.jsx:52-65` при открытии дня выполняет `Promise.all(day.note_ids.map((id) => api.getNote(id)))`.
- Контрдоказательства:
  - Для малого числа заметок в день это работает и переиспользует существующий `GET /notes/{id}`.
- Воздействие: один click может создать N HTTP-запросов; при 20 заметках в день это 20 round-trip, больше latency и нагрузка на backend.
- Уверенность: High.
- Серьезность: Moderate.
- Рекомендация: изменить контракт calendar endpoint на включение минимальных данных (`id`, `title`, `content_preview`, `tags`) или добавить bulk endpoint `GET /notes?date_from=...&date_to=...` и использовать его в Calendar.

### C3. In-memory rate limiter

- Антипаттерн: stateful singleton в процессе для security-control.
- Доказательства:
  - `rate_limit.py:8-10`: `_attempts: dict[str, deque[float]] = defaultdict(deque)` хранится в памяти процесса.
  - `auth.py:20-51` и `account.py:18-50` используют этот limiter для register/login/change-password/delete-account.
  - `docker-compose.yml:31-32` запускает uvicorn с `--reload`, что в dev может перезапускать процесс и сбрасывать состояние.
- Контрдоказательства:
  - Для локального dev и single-instance backend это простой и понятный защитный слой.
- Воздействие: при горизонтальном масштабировании лимиты не общие между replica; при рестарте лимиты сбрасываются. Это security risk для production.
- Уверенность: High.
- Серьезность: Moderate.
- Рекомендация: оставить как dev fallback, но для production вынести attempts в Redis/PostgreSQL с TTL, либо поставить rate limit на ingress/API gateway. Добавить `settings.rate_limit_backend` и health/metrics для limiter.

### C4. Fragile timing workaround через `setTimeout` в shortcuts

- Антипаттерн: timing-dependent UI coordination.
- Доказательства:
  - `frontend/src/App.jsx:71-79`: после `navigate('/notes')` вызывается `setTimeout(..., 30)` для выполнения `newNote`/`focusSearch` через `pendingActionRef`.
  - `Notes.jsx:53-62` регистрирует actions через effect; корректность зависит от того, успеет ли компонент смонтироваться за 30 ms.
- Контрдоказательства:
  - На локальной dev-машине при простом routing это, вероятно, стабильно.
- Воздействие: потенциально flaky UX при медленном рендере, Suspense/lazy loading или изменении routing. Сложно тестировать и поддерживать.
- Уверенность: Medium.
- Серьезность: Moderate.
- Рекомендация: заменить timing на declarative intent: хранить `pendingShortcutAction` в state/location state, передавать в `Notes`, исполнять action в `useEffect` после mount и сбрасывать. Альтернатива — глобальный context для command bus с подтверждением регистрации handler.

### C5. Timing-sensitive backend test

- Антипаттерн: flaky test signal.
- Доказательства:
  - `backend/tests/test_pin.py:1` импортирует `time`.
  - `backend/tests/test_pin.py:16` и `:18` используют `time.sleep(0.01)` для различения `updated_at`.
- Контрдоказательства:
  - Тест маленький и обычно пройдет; sleep короткий.
- Воздействие: тест зависит от разрешения timestamp, скорости среды и поведения SQLite/SQLAlchemy defaults. В CI может стать flaky.
- Уверенность: High.
- Серьезность: Minor.
- Рекомендация: контролировать timestamp явно через factory/patch `_now`/database values или сортировать тестовые данные по deterministic id там, где это часть контракта.

### C6. Inline styles / styling boundary leakage

- Антипаттерн: inline styles overuse — пока слабый локальный вариант, не системная проблема.
- Доказательства:
  - `NoteList.jsx:14-15` использует inline `style` для empty state.
  - `Notes.jsx:222`, `Calendar.jsx:96`, `Calendar.jsx:123` содержат inline styles для spacing/color.
- Контрдоказательства:
  - Количество примеров небольшое; основная стилизация вынесена в `styles.css`.
- Воздействие: усложняет поддержку темизации и дизайн-системы, если паттерн распространится.
- Уверенность: High.
- Серьезность: Minor.
- Рекомендация: вынести эти стили в классы (`empty-state--compact`, `error--spaced`, `muted-text`) и включить stylelint/ESLint rule только если проблема начнет расти.

### C7. I18n словари и provider в одном файле

- Антипаттерн: слабый сигнал God Module / mixed responsibility.
- Доказательства:
  - `frontend/src/i18n.jsx` содержит `MESSAGES` для EN/RU (`i18n.jsx:6-199`), localStorage/browser language detection (`201-210`), resolver/interpolation (`212-225`) и React Context Provider (`227-262`).
- Контрдоказательства:
  - Файл 262 строки, не критически большой; для двух языков текущий вариант прост.
- Воздействие: при добавлении языков/страниц файл станет горячей точкой конфликтов и будет сложнее валидировать completeness переводов.
- Уверенность: Medium.
- Серьезность: Minor.
- Рекомендация: вынести словари в `locales/en.js`, `locales/ru.js`; оставить provider/resolver в `i18n.jsx`; добавить тест полноты ключей между языками.

### C8. Нет явной CI/CD и rollback strategy

- Антипаттерн: manual delivery / missing release safety.
- Доказательства:
  - `.github/**/*` не найден.
  - `Makefile` содержит локальные targets `test`, `lint`, `migrate`, `openapi-dump`, но они требуют уже запущенный docker-compose (`docker compose exec ...`).
  - Поиск rollback/canary/blue-green/metrics/trace почти не дает результатов; есть только healthcheck БД и `/healthz` backend.
- Контрдоказательства:
  - Проект может быть учебным/локальным; production delivery может быть вне репозитория.
- Воздействие: качество зависит от ручного запуска команд; нет автоматической проверки OpenAPI drift, lint, backend/frontend tests перед merge/deploy; нет зафиксированного recovery path.
- Уверенность: Medium.
- Серьезность: Moderate.
- Рекомендация: добавить минимальный CI workflow: backend tests+ruff, frontend tests+eslint+build, OpenAPI snapshot drift. Для production — задокументировать rollback: image tags, migration rollback policy, DB backup/restore.

### C9. Index strategy без composite/query-plan evidence

- Антипаттерн: слабый сигнал “index strategy by intuition”.
- Доказательства:
  - Миграции создают одиночные индексы: `ix_notes_user_id`, `ix_notes_note_date`, `ix_notes_archived_at`, `ix_notes_pinned_at` (`0001_init.py:59-60`, `0002_archive_pin.py:27-28`).
  - Основной query `list_notes` фильтрует `user_id`, `archived_at`, иногда date range, сортирует `pinned_at`, `updated_at`, `id` (`notes.py:55-97`).
  - Нет EXPLAIN/ANALYZE notes или performance tests в репозитории.
- Контрдоказательства:
  - Для маленького приложения текущие индексы достаточны; composite index может быть преждевременной оптимизацией.
- Воздействие: при росте данных возможны медленные list queries; одиночные индексы могут не покрыть частый фильтр `user_id + archived_at + pinned_at/updated_at`.
- Уверенность: Low.
- Серьезность: Minor.
- Рекомендация: не добавлять индексы вслепую. Для PostgreSQL снять `EXPLAIN (ANALYZE, BUFFERS)` для `GET /notes` active/archived/date query; при подтверждении добавить composite index, например по `(user_id, archived_at, pinned_at, updated_at, id)` с учетом реального плана.

## 5. Что проверено, но не классифицировано как антипаттерн

- **Big Ball of Mud**: не подтвержден. Есть понятные backend/frontend boundaries, единый `api.js`, отдельные `db/config/auth/deps/schemas`.
- **Shared Database**: не подтвержден. База принадлежит backend; frontend не имеет прямого DB-доступа.
- **Lava Flow**: не подтвержден. В app-коде не найдено TODO/FIXME/HACK/legacy debt markers.
- **Array index as key**: в `Calendar.jsx` используется `key={i}` для сетки календаря (`null` placeholders и дни месяца). Это приемлемый локальный trade-off, потому что сетка детерминированно пересоздается при смене месяца, а элементы не являются пользовательски редактируемым списком.
- **Missing input validation**: не подтвержден. Backend использует Pydantic schemas (`schemas.py`) и FastAPI query validation (`Query(ge/le)`).

## 6. Корневые причины

- **Осознанная простота для малого приложения**: прямой ORM в роутерах и JSON tags снижают начальную сложность, но создают точки роста риска.
- **Нет production-readiness контура**: compose/Makefile хороши для dev, но нет CI, rollback, distributed rate-limit storage, metrics/traces.
- **Read model для календаря/тегов не сформирован**: текущие API удобны для начальной функциональности, но приводят к full scan и N+1.
- **UI command routing сделан императивно**: shortcuts пересекают route boundary через ref + timeout вместо declarative state/event model.

## 7. Приоритетная дорожная карта remediation

### Immediate stabilizers (1-2 дня)

1. Обновить `docs/architecture.md`: порт Postgres, `date_from/date_to`, `rate_limit.py`, текущий API surface.
2. Убрать `time.sleep` из `test_pin.py` через контролируемые timestamps или deterministic ordering.
3. Заменить inline styles на CSS-классы в `NoteList`, `Notes`, `Calendar`.
4. Добавить CI minimum workflow: backend ruff+pytest, frontend eslint+vitest+build, OpenAPI drift test.

### Near-term refactors (3-7 дней)

1. Исправить calendar N+1: endpoint с note summaries или использование date-filtered `/notes`.
2. Вынести shortcut command flow из `setTimeout` в declarative pending action state/context.
3. Вынести i18n словари из provider-файла и добавить тест полноты переводов.
4. Начать выделять `NotesService` для list/calendar/tag workflows без изменения публичного API.

### Longer-term modernization (по мере роста данных/production)

1. Пересмотреть модель тегов: normalized `note_tags` или PostgreSQL JSONB + GIN, если объем заметок растет.
2. Заменить in-memory rate limiter на Redis/PostgreSQL/ingress-based limiter.
3. Ввести query-plan review для hot paths (`GET /notes`, `/tags`, `/calendar`) и добавить composite indexes только после EXPLAIN.
4. Зафиксировать release/rollback policy: image tagging, migration rollback, backup/restore, smoke checks.

## 8. Unknowns / что нужно для более сильного подтверждения

- Реальные объемы данных: максимальное число заметок и тегов на пользователя.
- Production topology: будет ли несколько backend replica, какой ingress/proxy используется.
- Наличие внешнего CI/CD вне репозитория.
- Runtime telemetry: latency по `/notes`, `/tags`, `/notes/calendar`, DB query plans.
- Product expectations: нужна ли calendar view с большим количеством заметок в день или это редкий сценарий.
