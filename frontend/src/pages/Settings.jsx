import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { clearToken } from '../auth.js';
import { useLang } from '../i18n.jsx';

// A small, common subset is enough for the demo; the backend accepts any IANA zone.
const TIMEZONES = [
  'UTC',
  'Europe/London',
  'Europe/Berlin',
  'Europe/Moscow',
  'Asia/Ashgabat',
  'Asia/Dubai',
  'Asia/Almaty',
  'Asia/Tokyo',
  'America/New_York',
  'America/Los_Angeles',
];

export default function Settings() {
  const { t } = useLang();
  const navigate = useNavigate();

  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [pwError, setPwError] = useState(null);
  const [pwOk, setPwOk] = useState(false);

  const [deletePw, setDeletePw] = useState('');
  const [deleteError, setDeleteError] = useState(null);

  const [tg, setTg] = useState(null);
  const [tgError, setTgError] = useState(null);
  const [tzSaved, setTzSaved] = useState(false);

  useEffect(() => {
    let active = true;
    api
      .getTelegramStatus()
      .then((s) => active && setTg(s))
      .catch((err) => active && setTgError(err.message));
    return () => {
      active = false;
    };
  }, []);

  const changePassword = async (e) => {
    e.preventDefault();
    setPwError(null);
    setPwOk(false);
    try {
      await api.changePassword(currentPw, newPw);
      setPwOk(true);
      setCurrentPw('');
      setNewPw('');
    } catch (err) {
      setPwError(err.message);
    }
  };

  const deleteAccount = async (e) => {
    e.preventDefault();
    setDeleteError(null);
    if (!window.confirm(t('settings.confirmDelete'))) return;
    try {
      await api.deleteAccount(deletePw);
      clearToken();
      navigate('/login', { replace: true });
    } catch (err) {
      setDeleteError(err.message);
    }
  };

  const linkTelegram = async () => {
    setTgError(null);
    try {
      const status = await api.linkTelegram();
      setTg(status);
      if (status.link_url) window.open(status.link_url, '_blank', 'noopener');
    } catch (err) {
      setTgError(err.message);
    }
  };

  const [refreshing, setRefreshing] = useState(false);
  const refreshStatus = async () => {
    setTgError(null);
    setRefreshing(true);
    try {
      // keep the spin visible briefly even when the request is instant
      const [status] = await Promise.all([
        api.getTelegramStatus(),
        new Promise((r) => setTimeout(r, 600)),
      ]);
      setTg(status);
    } catch (err) {
      setTgError(err.message);
    } finally {
      setRefreshing(false);
    }
  };

  const unlinkTelegram = async () => {
    setTgError(null);
    try {
      await api.unlinkTelegram();
      setTg(await api.getTelegramStatus());
    } catch (err) {
      setTgError(err.message);
    }
  };

  const toggleReminders = async (e) => {
    setTgError(null);
    try {
      setTg(await api.setTelegramReminders(e.target.checked));
    } catch (err) {
      setTgError(err.message);
    }
  };

  const changeTimezone = async (e) => {
    setTgError(null);
    setTzSaved(false);
    try {
      setTg(await api.setTimezone(e.target.value));
      setTzSaved(true);
    } catch (err) {
      setTgError(err.message);
    }
  };

  const [exportError, setExportError] = useState(null);
  const exportAll = async () => {
    setExportError(null);
    try {
      await api.exportAllNotes();
    } catch (err) {
      setExportError(err.message);
    }
  };

  return (
    <div className="settings-page">
      <h1>{t('settings.title')}</h1>

      <section className="settings-card">
        <h2>{t('settings.changePasswordTitle')}</h2>
        <form onSubmit={changePassword}>
          <label>
            {t('settings.currentPassword')}
            <input
              type="password"
              value={currentPw}
              onChange={(e) => setCurrentPw(e.target.value)}
              required
              autoComplete="current-password"
            />
          </label>
          <label>
            {t('settings.newPassword')}
            <input
              type="password"
              value={newPw}
              onChange={(e) => setNewPw(e.target.value)}
              required
              minLength={6}
              autoComplete="new-password"
            />
          </label>
          {pwError && <div className="error">{pwError}</div>}
          {pwOk && <div className="success">{t('settings.passwordChanged')}</div>}
          <button type="submit" className="btn btn-primary">{t('settings.submit')}</button>
        </form>
      </section>

      <section className="settings-card">
        <h2>{t('settings.telegramTitle')}</h2>
        <p className="settings-hint">{t('settings.telegramHint')}</p>

        {tg && !tg.bot_configured && (
          <div className="settings-hint">{t('settings.telegramNotConfigured')}</div>
        )}

        {tg && tg.bot_configured && (
          <div className="telegram-controls">
            <div className="telegram-status">
              <span className={`status-dot${tg.linked ? ' on' : ''}`} />
              {tg.linked ? t('settings.telegramLinked') : t('settings.telegramNotLinked')}
              <button
                type="button"
                className={`icon-btn${refreshing ? ' spinning' : ''}`}
                onClick={refreshStatus}
                disabled={refreshing}
                title={t('settings.telegramRefresh')}
                aria-label={t('settings.telegramRefresh')}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
                  <path d="M21 3v5h-5" />
                  <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
                  <path d="M3 21v-5h5" />
                </svg>
              </button>
            </div>

            {tg.linked ? (
              <button type="button" className="btn btn-danger" onClick={unlinkTelegram}>
                {t('settings.telegramUnlink')}
              </button>
            ) : (
              <button type="button" className="btn btn-primary tg-link-btn" onClick={linkTelegram}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="m22 2-7 20-4-9-9-4Z" />
                  <path d="M22 2 11 13" />
                </svg>
                {t('settings.telegramLink')}
              </button>
            )}

            {tg.link_url && !tg.linked && (
              <div className="telegram-link-hint">
                <p className="settings-hint">{t('settings.telegramLinkHint')}</p>
                <a href={tg.link_url} target="_blank" rel="noreferrer">
                  {tg.link_url}
                </a>
              </div>
            )}

            <label className="telegram-toggle">
              <input
                type="checkbox"
                checked={tg.enabled}
                disabled={!tg.linked}
                onChange={toggleReminders}
              />
              {t('settings.telegramReminders')}
            </label>
          </div>
        )}

        <div className="timezone-control">
          <h3>{t('settings.timezoneTitle')}</h3>
          <p className="settings-hint">{t('settings.timezoneHint')}</p>
          <select
            aria-label={t('settings.timezoneTitle')}
            value={tg?.timezone || 'UTC'}
            onChange={changeTimezone}
            disabled={!tg}
          >
            {(tg && !TIMEZONES.includes(tg.timezone) ? [tg.timezone, ...TIMEZONES] : TIMEZONES).map(
              (z) => (
                <option key={z} value={z}>
                  {z}
                </option>
              ),
            )}
          </select>
          {tzSaved && <div className="success">{t('settings.timezoneSaved')}</div>}
        </div>

        {tgError && <div className="error">{tgError}</div>}
      </section>

      <section className="settings-card">
        <h2>{t('settings.exportTitle')}</h2>
        <p className="settings-hint">{t('settings.exportHint')}</p>
        <button type="button" className="btn btn-primary" onClick={exportAll}>
          {t('settings.exportAll')}
        </button>
        {exportError && <div className="error">{exportError}</div>}
      </section>

      <section className="settings-card danger">
        <h2>{t('settings.dangerZone')}</h2>
        <h3>{t('settings.deleteAccountTitle')}</h3>
        <p className="settings-hint">{t('settings.deleteAccountHint')}</p>
        <form onSubmit={deleteAccount}>
          <label>
            {t('settings.confirmPassword')}
            <input
              type="password"
              value={deletePw}
              onChange={(e) => setDeletePw(e.target.value)}
              required
              autoComplete="current-password"
            />
          </label>
          {deleteError && <div className="error">{deleteError}</div>}
          <button type="submit" className="btn btn-danger">{t('settings.deleteAccount')}</button>
        </form>
      </section>
    </div>
  );
}
