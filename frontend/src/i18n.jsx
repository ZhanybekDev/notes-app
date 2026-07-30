import { useMemo } from 'react';

import { LANGS, selectLang, usePrefsStore } from './stores/prefsStore.js';

// Re-exported so callers keep importing the language list from the i18n module they already use.
export { LANGS };


export const MESSAGES = {
  en: {
    brand: 'Notes',
    nav: { notes: 'Notes', calendar: 'Calendar', settings: 'Settings', logout: 'Log out' },
    theme: { light: 'Light', dark: 'Dark', system: 'System' },
    lang: { label: { en: 'EN', ru: 'RU' } },
    auth: {
      loginTitle: 'Welcome back',
      loginSubtitle: 'Log in to your notes.',
      registerTitle: 'Create an account',
      registerSubtitle: 'Your notes stay private to you.',
      username: 'Username',
      password: 'Password',
      login: 'Log in',
      create: 'Create account',
      noAccount: 'No account?',
      createOne: 'Create one',
      haveAccount: 'Already have an account?',
      loginLink: 'Log in',
      loginFailed: 'Login failed',
      registerFailed: 'Registration failed',
    },
    notes: {
      search: 'Search notes...',
      new: '+ New',
      allTag: 'all',
      noMatch: 'No notes match.',
      nothingSelected: 'Nothing selected',
      pickOrCreate: 'Pick a note from the list or create a new one.',
      viewActive: 'Active',
      viewArchived: 'Archived',
      selectMode: 'Select',
      cancelSelect: 'Cancel',
      selectAll: 'Select all',
      deleteSelected: 'Delete ({count})',
      confirmBulkDelete: 'Delete {count} note(s)?',
      loadMore: 'Load more',
      of: 'of',
      pinned: 'Pinned',
      archived: 'Archived',
    },
    editor: {
      untitled: 'Untitled note',
      date: 'Date',
      tags: 'Tags',
      tagsPlaceholder: 'work, ideas',
      writeHere: 'Write markdown here...',
      previewEmpty: '_Start typing to see the preview._',
      save: 'Save',
      cancel: 'Cancel',
      delete: 'Delete',
      pin: 'Pin',
      unpin: 'Unpin',
      archive: 'Archive',
      unarchive: 'Unarchive',
      confirmDelete: 'Delete this note?',
      toolbarBold: 'Bold',
      toolbarItalic: 'Italic',
      toolbarLink: 'Link',
      toolbarCode: 'Code',
      toolbarHeading: 'Heading',
      toolbarList: 'List',
      toolbarQuote: 'Quote',
      reminderScheduled: 'Reminder on {date} at {time}',
      reminderPassed: 'That moment has already passed',
      reminderOff: 'Reminders are off',
      reminderSettingsLink: 'Settings',
      reminderUnknown: 'Could not load reminder settings',
    },
    calendar: {
      today: 'Today',
      notesOn: 'Notes on',
      noNotes: 'No notes on this day.',
      prev: 'Previous month',
      next: 'Next month',
      months: ['January','February','March','April','May','June','July','August','September','October','November','December'],
      weekdaysShort: ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'],
    },
    settings: {
      title: 'Settings',
      changePasswordTitle: 'Change password',
      currentPassword: 'Current password',
      newPassword: 'New password',
      submit: 'Update password',
      passwordChanged: 'Password updated.',
      dangerZone: 'Danger zone',
      deleteAccountTitle: 'Delete account',
      deleteAccountHint: 'This permanently removes your account and all your notes.',
      confirmPassword: 'Enter your password to confirm',
      deleteAccount: 'Delete account',
      confirmDelete: 'This action cannot be undone. Proceed?',
      notificationsTitle: 'Telegram reminders',
      notificationsHint: 'Get a Telegram message when a note reaches its date.',
      botNotConfigured:
        'The Telegram bot is not configured on this deployment. Set TELEGRAM_BOT_TOKEN and TELEGRAM_BOT_USERNAME in backend/.env.',
      storageBlocked:
        'Your browser is blocking site storage, so this session and these preferences will be forgotten when the page reloads.',
      timezone: 'Time zone',
      timezoneSuggestion: 'Looks like your time zone is {zone}',
      timezoneSuggestionApply: 'Use it',
      timezoneSuggestionDismiss: 'Dismiss',
      reminderTime: 'Reminder time',
      enableNotifications: 'Send me reminders',
      connectTelegram: 'Connect Telegram',
      disconnectTelegram: 'Disconnect',
      telegramConnected: 'Connected as @{username}',
      telegramConnectedNoUsername: 'Connected',
      telegramNotConnected: 'Not connected yet.',
      linkWaiting: 'Waiting for confirmation in Telegram…',
      linkTimedOut: 'Start does not seem to have been pressed yet.',
      linkRecheck: 'Check again',
      linkExpires: 'The link is valid for 15 minutes.',
      settingsSaved: 'Saved.',
      confirmDisconnect: 'Disconnect Telegram and stop reminders?',
    },
    shortcuts: {
      title: 'Keyboard shortcuts',
      newNote: 'New note',
      focusSearch: 'Focus search',
      saveNote: 'Save note',
      closeModal: 'Close this dialog',
      showHelp: 'Show this help',
      close: 'Close',
    },
    tips: {
      navNotes: 'All your notes',
      navCalendar: 'Your notes laid out by date',
      navSettings: 'Password, reminders, account',
      help: 'Keyboard shortcuts (?)',
      logout: 'Sign out on this device',
      theme: 'Theme: {value} — click to switch',
      language: 'Language: {value} — click to switch',
      newNote: 'Create a note (n)',
      search: 'Search titles and text (/)',
      viewActive: 'Notes you are working with',
      viewArchived: 'Notes you have archived',
      selectMode: 'Pick several notes to delete at once',
      cancelSelect: 'Leave selection mode',
      selectAll: 'Select every note in the list',
      deleteSelected: 'Delete the selected notes permanently',
      loadMore: 'Load the next page of notes',
      tagAll: 'Show notes with any tag',
      tagOne: 'Show only notes tagged #{tag}',
      save: 'Save this note (Cmd/Ctrl+S)',
      cancel: 'Discard unsaved changes',
      deleteNote: 'Delete this note permanently',
      calendarPrev: 'Previous month',
      calendarNext: 'Next month',
      calendarToday: 'Jump back to the current month',
      closeDialog: 'Close (Esc)',
      login: 'Log in and open your notes',
      register: 'Create the account and log in',
      changePassword: 'Change the password for this account',
      deleteAccount: 'Permanently delete the account and every note',
      connectTelegram: 'Open the bot and link this account',
      linkRecheck: 'Ask the server whether the binding arrived',
      timezoneSuggestionApply: 'Set the account to this zone',
      timezoneSuggestionDismiss: 'Hide this suggestion for good',
      disconnectTelegram: 'Stop reminders and forget the chat',
    },
  },
  ru: {
    brand: 'Заметки',
    nav: { notes: 'Заметки', calendar: 'Календарь', settings: 'Настройки', logout: 'Выйти' },
    theme: { light: 'Светлая', dark: 'Тёмная', system: 'Системная' },
    lang: { label: { en: 'EN', ru: 'RU' } },
    auth: {
      loginTitle: 'С возвращением',
      loginSubtitle: 'Войдите в свои заметки.',
      registerTitle: 'Создать аккаунт',
      registerSubtitle: 'Ваши заметки видны только вам.',
      username: 'Имя пользователя',
      password: 'Пароль',
      login: 'Войти',
      create: 'Создать аккаунт',
      noAccount: 'Нет аккаунта?',
      createOne: 'Создать',
      haveAccount: 'Уже есть аккаунт?',
      loginLink: 'Войти',
      loginFailed: 'Не удалось войти',
      registerFailed: 'Не удалось зарегистрироваться',
    },
    notes: {
      search: 'Поиск...',
      new: '+ Новая',
      allTag: 'все',
      noMatch: 'Ничего не найдено.',
      nothingSelected: 'Ничего не выбрано',
      pickOrCreate: 'Выберите заметку из списка или создайте новую.',
      viewActive: 'Активные',
      viewArchived: 'Архив',
      selectMode: 'Выбрать',
      cancelSelect: 'Отмена',
      selectAll: 'Выбрать все',
      deleteSelected: 'Удалить ({count})',
      confirmBulkDelete: 'Удалить {count} заметок?',
      loadMore: 'Загрузить ещё',
      of: 'из',
      pinned: 'Закреплено',
      archived: 'В архиве',
    },
    editor: {
      untitled: 'Без названия',
      date: 'Дата',
      tags: 'Теги',
      tagsPlaceholder: 'работа, идеи',
      writeHere: 'Пишите markdown здесь...',
      previewEmpty: '_Начните печатать, чтобы увидеть превью._',
      save: 'Сохранить',
      cancel: 'Отмена',
      delete: 'Удалить',
      pin: 'Закрепить',
      unpin: 'Открепить',
      archive: 'В архив',
      unarchive: 'Из архива',
      confirmDelete: 'Удалить эту заметку?',
      toolbarBold: 'Жирный',
      toolbarItalic: 'Курсив',
      toolbarLink: 'Ссылка',
      toolbarCode: 'Код',
      toolbarHeading: 'Заголовок',
      toolbarList: 'Список',
      toolbarQuote: 'Цитата',
      reminderScheduled: 'Напоминание {date} в {time}',
      reminderPassed: 'Момент напоминания уже прошёл',
      reminderOff: 'Напоминания выключены',
      reminderSettingsLink: 'Настройки',
      reminderUnknown: 'Не удалось загрузить настройки напоминаний',
    },
    calendar: {
      today: 'Сегодня',
      notesOn: 'Заметки на',
      noNotes: 'На этот день заметок нет.',
      prev: 'Предыдущий месяц',
      next: 'Следующий месяц',
      months: ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'],
      weekdaysShort: ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'],
    },
    settings: {
      title: 'Настройки',
      changePasswordTitle: 'Смена пароля',
      currentPassword: 'Текущий пароль',
      newPassword: 'Новый пароль',
      submit: 'Обновить пароль',
      passwordChanged: 'Пароль обновлён.',
      dangerZone: 'Опасная зона',
      deleteAccountTitle: 'Удалить аккаунт',
      deleteAccountHint: 'Это безвозвратно удалит ваш аккаунт и все ваши заметки.',
      confirmPassword: 'Введите пароль для подтверждения',
      deleteAccount: 'Удалить аккаунт',
      confirmDelete: 'Это действие необратимо. Продолжить?',
      notificationsTitle: 'Напоминания в Telegram',
      notificationsHint: 'Получайте сообщение в Telegram, когда наступает дата заметки.',
      botNotConfigured:
        'Telegram-бот не настроен на этом развёртывании. Задайте TELEGRAM_BOT_TOKEN и TELEGRAM_BOT_USERNAME в backend/.env.',
      storageBlocked:
        'Браузер блокирует хранилище сайта — сессия и эти настройки будут забыты при перезагрузке страницы.',
      timezone: 'Часовой пояс',
      timezoneSuggestion: 'Похоже, ваш часовой пояс — {zone}',
      timezoneSuggestionApply: 'Использовать',
      timezoneSuggestionDismiss: 'Скрыть',
      reminderTime: 'Время напоминания',
      enableNotifications: 'Присылать напоминания',
      connectTelegram: 'Привязать Telegram',
      disconnectTelegram: 'Отвязать',
      telegramConnected: 'Привязан как @{username}',
      telegramConnectedNoUsername: 'Привязан',
      telegramNotConnected: 'Пока не привязан.',
      linkWaiting: 'Ждём подтверждения в Telegram…',
      linkTimedOut: 'Похоже, Start в Telegram ещё не нажат.',
      linkRecheck: 'Проверить ещё раз',
      linkExpires: 'Ссылка действует 15 минут.',
      settingsSaved: 'Сохранено.',
      confirmDisconnect: 'Отвязать Telegram и остановить напоминания?',
    },
    shortcuts: {
      title: 'Горячие клавиши',
      newNote: 'Новая заметка',
      focusSearch: 'Поиск',
      saveNote: 'Сохранить заметку',
      closeModal: 'Закрыть диалог',
      showHelp: 'Показать эту справку',
      close: 'Закрыть',
    },
    tips: {
      navNotes: 'Все ваши заметки',
      navCalendar: 'Заметки, разложенные по датам',
      navSettings: 'Пароль, напоминания, аккаунт',
      help: 'Горячие клавиши (?)',
      logout: 'Выйти из аккаунта на этом устройстве',
      theme: 'Тема: {value} — нажмите, чтобы сменить',
      language: 'Язык: {value} — нажмите, чтобы сменить',
      newNote: 'Создать заметку (n)',
      search: 'Поиск по заголовкам и тексту (/)',
      viewActive: 'Заметки, с которыми вы работаете',
      viewArchived: 'Заметки, убранные в архив',
      selectMode: 'Выбрать несколько заметок, чтобы удалить разом',
      cancelSelect: 'Выйти из режима выбора',
      selectAll: 'Выбрать все заметки в списке',
      deleteSelected: 'Удалить выбранные заметки безвозвратно',
      loadMore: 'Загрузить следующую страницу заметок',
      tagAll: 'Показать заметки с любым тегом',
      tagOne: 'Показать только заметки с тегом #{tag}',
      save: 'Сохранить заметку (Cmd/Ctrl+S)',
      cancel: 'Отменить несохранённые изменения',
      deleteNote: 'Удалить эту заметку безвозвратно',
      calendarPrev: 'Предыдущий месяц',
      calendarNext: 'Следующий месяц',
      calendarToday: 'Вернуться к текущему месяцу',
      closeDialog: 'Закрыть (Esc)',
      login: 'Войти и открыть заметки',
      register: 'Создать аккаунт и войти',
      changePassword: 'Сменить пароль для этого аккаунта',
      deleteAccount: 'Безвозвратно удалить аккаунт и все заметки',
      connectTelegram: 'Открыть бота и привязать этот аккаунт',
      linkRecheck: 'Спросить сервер, дошла ли привязка',
      timezoneSuggestionApply: 'Поставить аккаунту эту зону',
      timezoneSuggestionDismiss: 'Больше не предлагать',
      disconnectTelegram: 'Остановить напоминания и забыть чат',
    },
  },
};

function resolve(dict, path) {
  const parts = path.split('.');
  let node = dict;
  for (const p of parts) {
    if (node == null) return undefined;
    node = node[p];
  }
  return node;
}

function interpolate(str, vars) {
  if (typeof str !== 'string' || !vars) return str;
  return str.replace(/\{(\w+)\}/g, (_, k) => (k in vars ? String(vars[k]) : `{${k}}`));
}

/** Resolve one key for one language, with English as the fallback. */
export function translate(lang, key, vars) {
  const value = resolve(MESSAGES[lang], key);
  if (value === undefined) {
    const fallback = resolve(MESSAGES.en, key);
    return interpolate(fallback ?? key, vars);
  }
  return interpolate(value, vars);
}

/**
 * Same shape as before — `{ lang, setLang, t }` — so none of the 14 call sites change.
 *
 * The two selectors return a string and a stable action, never a fresh object: a selector building
 * `{ lang, setLang, t }` would hand zustand a new reference on every render and turn this into
 * "Maximum update depth exceeded" rather than a wasted render.
 */
export function useLang() {
  const lang = usePrefsStore(selectLang);
  const setLang = usePrefsStore((s) => s.setLang);
  const t = useMemo(() => (key, vars) => translate(lang, key, vars), [lang]);
  return { lang, setLang, t };
}

/**
 * Sets `<html lang>` once and follows changes.
 *
 * Called before the first render for the same reason `initTheme()` is: `subscribe` fires only on a
 * change, so a subscription alone would leave the attribute at its initial value until the user
 * switched languages.
 */
export function initLang() {
  const apply = (lang) => document.documentElement.setAttribute('lang', lang);
  apply(selectLang(usePrefsStore.getState()));
  usePrefsStore.subscribe((state, previous) => {
    if (state.lang !== previous.lang) apply(selectLang(state));
  });
}
