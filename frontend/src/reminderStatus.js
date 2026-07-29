export const REMINDER_OFF = 'off';
export const REMINDER_PASSED = 'passed';
export const REMINDER_SCHEDULED = 'scheduled';

// 'en-CA' renders YYYY-MM-DD, which compares correctly as a plain string against note_date.
const ISO_DATE_LOCALE = 'en-CA';

function todayIn(zone, now) {
  return now.toLocaleDateString(ISO_DATE_LOCALE, { timeZone: zone });
}

function clockIn(zone, now) {
  return now.toLocaleTimeString('en-GB', { timeZone: zone, hour12: false });
}

/**
 * Decide what a note's reminder is doing, from the account's point of view.
 *
 * Both sides of the comparison are taken in the account's zone. Comparing against the browser's
 * today is wrong whenever the two differ: around midnight they disagree and the hint would
 * contradict the worker.
 *
 * A date already gone and today with its time gone are both reported as passed. The wording is
 * about the moment rather than the date because it has to hold for either, and because it must
 * not claim the reminder will never arrive — the worker still backfills the last 24 hours.
 */
export function reminderStatus(noteDate, prefs, now = new Date()) {
  if (!noteDate || !prefs) return null;
  if (!prefs.notifications_enabled || !prefs.telegram_linked) return { kind: REMINDER_OFF };

  const zone = prefs.timezone;
  const today = todayIn(zone, now);
  if (noteDate < today) return { kind: REMINDER_PASSED };
  if (noteDate === today && prefs.reminder_time <= clockIn(zone, now)) {
    return { kind: REMINDER_PASSED };
  }
  return { kind: REMINDER_SCHEDULED, date: noteDate, time: prefs.reminder_time.slice(0, 5) };
}

/** Build the Date from parts: `new Date('2026-07-30')` is parsed as UTC and can shift a day. */
export function formatNoteDate(isoDate, locale) {
  const [year, month, day] = isoDate.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString(locale, {
    day: 'numeric',
    month: 'long',
  });
}
