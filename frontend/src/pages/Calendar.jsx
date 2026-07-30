import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import LoadFailure from '../components/LoadFailure.jsx';
import { SkeletonList, SkeletonMonth } from '../components/Skeleton.jsx';
import { useDelayedFlag } from '../hooks/useDelayedFlag.js';
import { useLang } from '../i18n.jsx';
import { reportFailure } from '../stores/uiStore.js';

function monthMatrix(year, month) {
  const first = new Date(year, month - 1, 1);
  const startWeekday = (first.getDay() + 6) % 7; // Monday-first
  const daysInMonth = new Date(year, month, 0).getDate();
  const cells = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

function iso(year, month, day) {
  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${year}-${mm}-${dd}`;
}

function todayIso() {
  const d = new Date();
  return iso(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

export default function Calendar() {
  const { t } = useLang();
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [days, setDays] = useState([]);
  const [notesForDay, setNotesForDay] = useState([]);
  const [selectedDate, setSelectedDate] = useState(null);
  // A failed month has no day badges, so without its own state the grid would read as "no notes this
  // month" — and once the toast leaves, nothing on screen would say otherwise.
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [reloads, setReloads] = useState(0);
  // The opened day has its own lifecycle: its notes are fetched one by one, and that can fail while
  // the month around it loaded fine.
  const [dayStatus, setDayStatus] = useState('ready'); // ready | loading | error
  // Which day the reader is looking at right now. A day holds several notes, fetched one request per
  // note, so opening two days in a row leaves two flights racing — and without this the slower one
  // wins and files its notes under the other day's heading.
  const openRef = useRef(null);

  useEffect(() => {
    let alive = true;
    setFailed(false);
    setLoading(true);
    api
      .calendar(year, month)
      .then((d) => {
        if (!alive) return;
        setDays(d);
        setLoading(false);
      })
      .catch((e) => {
        if (!alive) return;
        setFailed(true);
        setLoading(false);
        reportFailure(e);
      });
    return () => { alive = false; };
  }, [year, month, reloads]);

  // Same rule as the notes list: a skeleton that flashes for 80ms reads as a glitch, so a fast answer
  // shows nothing at all.
  const showDaySkeleton = useDelayedFlag(dayStatus === 'loading');
  const showMonthSkeleton = useDelayedFlag(loading);

  const counts = useMemo(() => {
    const m = new Map();
    for (const d of days) m.set(d.date, d.note_ids.length);
    return m;
  }, [days]);

  const openDay = async (date) => {
    setSelectedDate(date);
    openRef.current = date;
    setDayStatus('ready');
    const day = days.find((d) => d.date === date);
    if (!day) {
      setNotesForDay([]);
      return;
    }
    // Dropped before the fetch, not after: keeping them would leave the previous day's notes sitting
    // under this day's heading for as long as the request takes — and permanently if it fails.
    setNotesForDay([]);
    setDayStatus('loading');
    try {
      const fetched = await Promise.all(day.note_ids.map((id) => api.getNote(id)));
      if (openRef.current !== date) return;
      setNotesForDay(fetched);
      setDayStatus('ready');
    } catch (err) {
      if (openRef.current !== date) return;
      setDayStatus('error');
      reportFailure(err);
    }
  };

  const prev = () => {
    if (month === 1) { setYear(year - 1); setMonth(12); }
    else setMonth(month - 1);
  };
  const next = () => {
    if (month === 12) { setYear(year + 1); setMonth(1); }
    else setMonth(month + 1);
  };
  const goToday = () => {
    const d = new Date();
    setYear(d.getFullYear());
    setMonth(d.getMonth() + 1);
  };

  const cells = monthMatrix(year, month);
  const todayStr = todayIso();
  const monthName = t('calendar.months')[month - 1];
  const weekdays = t('calendar.weekdaysShort');

  return (
    <div className="calendar-page">
      <header className="cal-header">
        <h2>{monthName} {year}</h2>
        <div className="cal-nav">
          <button onClick={prev} title={t('tips.calendarPrev')} aria-label={t('calendar.prev')}>‹</button>
          <button onClick={goToday} title={t('tips.calendarToday')}>{t('calendar.today')}</button>
          <button onClick={next} title={t('tips.calendarNext')} aria-label={t('calendar.next')}>›</button>
        </div>
      </header>
      {failed ? (
        <LoadFailure onRetry={() => setReloads((n) => n + 1)} />
      ) : loading ? (
        // Same rule as everywhere else: nothing is claimed until an answer exists, and a grid with no
        // badges is a claim that the month is empty. After 300ms the shape appears without the numbers.
        showMonthSkeleton ? <SkeletonMonth weekdays={weekdays} /> : null
      ) : (
      <div className="cal-grid">
        {weekdays.map((w) => <div key={w} className="cal-weekday">{w}</div>)}
        {cells.map((day, i) => {
          if (day === null) return <div key={i} className="cal-cell empty" />;
          const date = iso(year, month, day);
          const count = counts.get(date) || 0;
          const isToday = date === todayStr;
          const isPast = date < todayStr;
          const cls = [
            'cal-cell',
            count ? 'has-notes' : '',
            isToday ? 'today' : isPast ? 'past' : 'future',
            selectedDate === date ? 'selected' : '',
          ].filter(Boolean).join(' ');
          return (
            <div key={i} className={cls} onClick={() => openDay(date)}>
              <span className="day-num">{day}</span>
              {count > 0 && <span className="badge">{count}</span>}
            </div>
          );
        })}
      </div>
      )}
      {selectedDate && (
        <div className="day-notes">
          <h3>{t('calendar.notesOn')} {selectedDate}</h3>
          {dayStatus === 'error' ? (
            <LoadFailure onRetry={() => openDay(selectedDate)} />
          ) : dayStatus === 'loading' ? (
            showDaySkeleton ? <SkeletonList rows={2} /> : null
          ) : notesForDay.length === 0 ? (
            <p className="day-notes-empty">{t('calendar.noNotes')}</p>
          ) : (
            <ul>
              {notesForDay.map((n) => (
                <li key={n.id}>
                  <strong>{n.title}</strong>
                  {n.content && <span className="note-preview">{n.content.slice(0, 120)}{n.content.length > 120 ? '…' : ''}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
