# Research — zustand-migration

**Timestamp:** 2026-07-30
**Task classification:** add-library / new-pattern
**Research triggered:** yes

## Summary

Zustand 5.0.14 (MIT, ноль зависимостей, peer `react >=18.0.0`) встаёт в проект без конфликтов —
React 18.3.1 уже стоит. Главный технический риск версии 5 — не установка, а селекторы: v5 работает
через `useSyncExternalStore`, и селектор, возвращающий новый объект, уводит компонент в
`Maximum update depth exceeded`. Отдельно стоит зафиксировать честную рамку: индустрия 2026 года
считает серверные данные (заметки, теги, настройки) не тем, что кладут в client-state библиотеку —
для них берут TanStack Query. Мы кладём, потому что задача сформулирована как «переезд на zustand»,
и цена решения — ручная инвалидация после мутаций.

## Current best practices (2026)

- **Разделять server state и client state.** TanStack Query — для всего, что пришло с API
  (кеш, рефетч, мутации, оптимистичные апдейты); zustand — для глобального клиентского состояния
  (сессия, сайдбар, тема). Прямая цитата из обзоров: «Never store server data in client state
  libraries… duplicating in Zustand creates synchronization bugs».
- **Селекторы обязательны всегда**, даже для стора с одним полем: подписка идёт ровно на то, что
  вернул селектор, сравнение — строгим равенством.
- **Slice pattern** для нескольких доменов: либо один стор, собранный из слайсов, либо один стор на
  файл. Официальная рекомендация — один стор на файл, слайсы общаются через `get()`.
- **Действия внутри стора, а не в компонентах** — компонент вызывает `store.load()`, а не собирает
  `set` вручную.

## Ready-made solutions

### zustand 5.0.14 (npm)
- **Maintenance:** активный, pmndrs; версия 5 — текущая мажорная
- **License:** MIT
- **Deps:** нет; peer — `react >=18` (optional), `immer`/`use-sync-external-store` опциональны
- **Fit:** high — React 18.3.1 в проекте, бандл минимальный, API не требует провайдера

### TanStack Query (рассмотрен, не берём)
- **Fit for our case:** high по существу задачи, но это **вторая** зависимость сверх запрошенной и
  переписывание всех фетчей. Отвергнут по scope, а не по качеству; зафиксирован как «что дальше».

## Common pitfalls

1. **Селектор, возвращающий объект, без `useShallow`** — в v5 это не «лишний ререндер», а краш
   `Maximum update depth exceeded`. Номер один среди поломок при переходе на v5. Лечение:
   `useShallow` вокруг селектора или отдельные селекторы на каждое поле.
2. **Стор — синглтон на процесс тестов.** Без сброса состояние течёт из теста в тест. Официальный
   рецепт — мок `__mocks__/zustand.js`, собирающий reset-функции; проверенный API внутри:
   `store.setState(store.getInitialState(), true)`.
3. **Серверные данные в сторе** требуют ручной инвалидации: после каждой мутации кто-то должен
   позвать перезагрузку списка, иначе UI расходится с БД.
4. **`persist` и гидратация** — состояние из localStorage приезжает синхронно для обычного
   storage, но тесты должны чистить и localStorage, и сам стор.

## Existing code in project

- `frontend/src/api.js:12` — единственный модуль с `fetch`, обёртка `request()`; 401 → `clearToken()`
- `frontend/src/auth.js` — токен в `localStorage`, импортируется из 5 файлов (`api.js`, `App.jsx`,
  `Login.jsx`, `Register.jsx`, `Settings.jsx`); `isAuthenticated()` читается на рендере и не
  реактивен
- `frontend/src/i18n.jsx:351` — единственный React Context в проекте (`LangContext`), обёртка нужна
  в 5 файлах, из них 4 — тесты
- `frontend/src/theme.js` — не Context, а модуль, ставящий `data-theme` на `<html>`
- `frontend/src/pages/Notes.jsx:12-26` — 13 `useState`, включая `reminderPrefs`
- `frontend/src/pages/Settings.jsx:37-41` — свой `useState` на те же настройки: `api.getSettings()`
  дёргается **дважды** на двух страницах, общего кеша нет
- Тесты мокают API через `vi.spyOn(api, 'getSettings')` — не `vi.mock`, а точечный спай (53 теста в
  7 файлах)

## Recommendation

**Подход:** adopt zustand 5, один стор на домен в `src/stores/`, асинхронные действия внутри
сторов, селекторы по полям (`useShallow` только там, где объект неизбежен). Локальное состояние
(черновики форм, год/месяц календаря) остаётся в `useState` — это и есть best practice, а не
недоделка.

**Почему:** проект просил zustand; при этом реальная боль здесь не в «нет глобального стора», а в
двух конкретных вещах, которые стор закрывает: настройки грузятся дважды на разных страницах, и
`isAuthenticated()` не реактивен.

**Не делаем:** TanStack Query (вторая зависимость, переписывание всех фетчей), immer (объекты
плоские), devtools middleware (Redux DevTools ради четырёх сторов).

## Sources

- [zustand — npm registry](https://registry.npmjs.org/zustand/latest) — 5.0.14, MIT, peer react >=18
- [zustand: docs/learn/guides/testing.md](https://github.com/pmndrs/zustand) — рецепт сброса,
  `store.setState(store.getInitialState(), true)`
- [Migrating to v5 — pmndrs/zustand](https://github.com/pmndrs/zustand/blob/main/docs/migrations/migrating-to-v5.md)
- [useShallow — Zustand docs](https://zustand.docs.pmnd.rs/reference/hooks/use-shallow)
- [Working with Zustand — TkDodo](https://tkdodo.eu/blog/working-with-zustand)
- [Separating Concerns with Zustand and TanStack Query](https://volodymyrrudyi.com/blog/separating-concerns-with-zustand-and-tanstack-query/)
- [React State Management in 2026](https://ncctcr.com/blog/react-state-management-2026)
