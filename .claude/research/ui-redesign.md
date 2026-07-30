# Research — ui-redesign

**Timestamp:** 2026-07-30
**Task classification:** new-pattern (design-token system) + new-feature (feedback layer)
**Research triggered:** yes — оценка выше двух часов, вводится слой, которого в проекте нет

## Summary

Шкалы, которые я собирался ввести, совпадают с индустриальной практикой 2026 года почти дословно —
это подтверждение, а не новость. Настоящая ценность research в трёх местах: скелетоны вредны на
быстрых ответах, live-регион для тостов обязан существовать в DOM **до** появления сообщения, а
автозакрытие тоста конфликтует с WCAG 2.2.1. Все три меняют дизайн, а не украшают его.

## Current best practices (2026)

- **Именование токенов** — `category/role/variant`: `color/background/subtle`, `spacing/gap/md`,
  `radius/md`. Ролевые имена (`button/primary`), а не описательные (`button/blue`).
- **Шкала отступов** — база 4px: 4/8/12/16/24/32/48/64. Ровно то, что заложено в спеку.
- **Радиусы** — ступени 0/4/8/12 и `9999` для пилюль.
- **Двухуровневая иерархия** — примитивы (сырые значения) и семантика (роли); компонент связывается
  с семантикой, никогда напрямую с примитивом цвета.

## Pitfalls, которые меняют дизайн

### 1. Скелетон на быстром ответе делает хуже, чем ничего

По текущим рекомендациям NN/g скелетон помогает **только** на интервале 400 мс — 3 с. Ниже 400 мс
уместен маленький инлайновый индикатор, а мелькнувший и исчезнувший скелетон читается как глюк.
`api.listNotes` на локальном стеке отвечает быстрее 400 мс почти всегда.

**Решение для плана:** скелетон появляется **с задержкой 300 мс** — если ответ пришёл раньше,
пользователь не видит ничего. Это не оптимизация, а условие того, что скелетон не сделает интерфейс
хуже. Реализуется примитивом `useDelayedFlag(active, 300)`.

### 2. Live-регион должен существовать в DOM заранее

Браузер начинает следить за областью в момент построения дерева доступности. Контейнер, созданный в
тот же момент, что и сообщение, скринридер не объявит. Значит `<Toaster />` рендерит **постоянный**
пустой контейнер, а не появляется вместе с первым тостом.

Плюс: `role="status"` (вежливо) для информационных, `role="alert"` (настойчиво) для ошибок; фокус на
тост **не переводить** — это прямое нарушение WCAG 4.1.3 и дезориентирует.

### 3. Автозакрытие конфликтует с WCAG 2.2.1 (Timing Adjustable)

Тост, который сам уезжает, может исчезнуть раньше, чем его дочитают — особенно при увеличении экрана.

**Решение для плана:** у каждого тоста кнопка закрытия, пауза таймера при `hover` и `focus`,
и разная длительность: 4 с для успеха, 8 с для ошибки. Ошибку, которую не успели прочитать, всегда
можно найти — она осталась в состоянии стора.

## Ready-made solutions

Не рассматривались: ограничение «без новых зависимостей» задано пользователем до research.
Отмечу для полноты, что `react-hot-toast` и `sonner` закрыли бы слой тостов за один импорт, включая
пункты 2 и 3 выше; цена — зависимость в форке на сдачу. Решение принято в пользу своих ~60 строк.

## Existing code in project

- `frontend/src/styles.css:1-45` — 35 цветовых токенов, радиусы 6/10/14, четыре уровня тени. Шкал
  отступов и типографики нет.
- `frontend/src/styles.css:1040` — единственный медиа-запрос, после него дописаны ещё два блока.
- `frontend/src/stores/accountStore.js:9` — `status: idle|loading|ready|error`, готовый образец для
  `notesStore`.
- `frontend/src/pages/Settings.jsx:170` — плейсхолдер `…`, который заменяется скелетоном.
- `frontend/src/i18n.test.jsx` — тест на парность ключей EN/RU: любая новая строка обязана
  появиться в двух каталогах, иначе сборка тестов красная.
- `frontend/src/stores/index.js` — реестр `resetStores()`, куда обязан попасть новый `uiStore`.

## Recommendation

**Подход:** свои токены и свой слой отклика, но с тремя поправками из pitfalls — задержка скелетона,
постоянный live-регион, управляемое автозакрытие. Без них слой «оживления» ухудшил бы доступность и
добавил мельканий.

**Не делаем:** библиотеки тостов и анимаций (ограничение пользователя), генераторы токенов и
Figma-пайплайны (в проекте нет дизайн-файла), Tailwind v4 (переписал бы всю разметку).

## Sources

- [CSS Design Token Generator: Build a Complete Design System (2026)](https://cssawwwards.com/blog/css-design-tokens-guide-2026)
- [Design Tokens That Scale in 2026](https://www.maviklabs.com/blog/design-tokens-tailwind-v4-2026/)
- [Skeleton Screens vs Loading Spinners: When to Use Each](https://www.onething.design/post/skeleton-screens-vs-loading-spinners)
- [Skeleton loading screen design — LogRocket](https://blog.logrocket.com/ux-design/skeleton-loading-screen-design/)
- [Accessible notifications with ARIA Live Regions — Sara Soueidan](https://www.sarasoueidan.com/blog/accessible-notifications-with-aria-live-regions-part-1/)
- [Toast Notification Accessibility Guide](https://designsystemproblems.com/accessibility-compliance/toast-notification-accessibility/)
- [Defining 'Toast' Messages — Adrian Roselli](http://adrianroselli.com/2020/01/defining-toast-messages.html)
