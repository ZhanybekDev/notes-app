import { describe, expect, it } from 'vitest';
import {
  REMINDER_OFF,
  REMINDER_PASSED,
  REMINDER_SCHEDULED,
  formatNoteDate,
  reminderStatus,
} from './reminderStatus.js';

const linked = {
  timezone: 'Asia/Bishkek',
  reminder_time: '09:00:00',
  notifications_enabled: true,
  telegram_linked: true,
};

// 2026-07-30 04:00 UTC is 10:00 in Bishkek — past 09:00 there, and still 29 July in UTC.
const NOW = new Date('2026-07-30T04:00:00Z');

describe('reminderStatus', () => {
  it('returns nothing without a date or without settings', () => {
    expect(reminderStatus(null, linked, NOW)).toBeNull();
    expect(reminderStatus('2026-08-01', null, NOW)).toBeNull();
  });

  it('reports off when notifications are disabled', () => {
    const prefs = { ...linked, notifications_enabled: false };
    expect(reminderStatus('2026-08-01', prefs, NOW).kind).toBe(REMINDER_OFF);
  });

  it('reports off when Telegram is not linked', () => {
    const prefs = { ...linked, telegram_linked: false };
    expect(reminderStatus('2026-08-01', prefs, NOW).kind).toBe(REMINDER_OFF);
  });

  it('schedules a future date and carries the date and time', () => {
    expect(reminderStatus('2026-08-01', linked, NOW)).toEqual({
      kind: REMINDER_SCHEDULED,
      date: '2026-08-01',
      time: '09:00',
    });
  });

  it('treats an earlier date as passed', () => {
    expect(reminderStatus('2026-07-29', linked, NOW).kind).toBe(REMINDER_PASSED);
  });

  it('treats today as passed once the time has gone by in the account zone', () => {
    expect(reminderStatus('2026-07-30', linked, NOW).kind).toBe(REMINDER_PASSED);
  });

  it('still schedules today when the time is ahead in the account zone', () => {
    const prefs = { ...linked, reminder_time: '23:30:00' };
    expect(reminderStatus('2026-07-30', prefs, NOW).kind).toBe(REMINDER_SCHEDULED);
  });

  it('uses the account zone, not the runtime zone', () => {
    // Same instant, a zone where it is still 29 July: the 30th is then in the future.
    const prefs = { ...linked, timezone: 'Etc/GMT+12' };
    expect(reminderStatus('2026-07-30', prefs, NOW).kind).toBe(REMINDER_SCHEDULED);
  });
});

describe('formatNoteDate', () => {
  it('formats without shifting the day', () => {
    // Day-first is British, not English at large: 'en' resolves to the US order.
    expect(formatNoteDate('2026-07-30', 'ru')).toBe('30 июля');
    expect(formatNoteDate('2026-07-30', 'en')).toBe('July 30');
  });
});
