import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { clearToken } from '../auth.js';
import { useLang } from '../i18n.jsx';

function listTimeZones(current) {
  const supported =
    typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];
  return supported.includes(current) ? supported : [current, ...supported];
}

export default function Settings() {
  const { t } = useLang();
  const navigate = useNavigate();

  const [prefs, setPrefs] = useState(null);
  const [prefsError, setPrefsError] = useState(null);
  const [prefsSaved, setPrefsSaved] = useState(false);
  const [linkNotice, setLinkNotice] = useState(false);
  const [timeDraft, setTimeDraft] = useState('');

  const timeZones = useMemo(() => listTimeZones(prefs?.timezone ?? 'UTC'), [prefs?.timezone]);

  useEffect(() => {
    let cancelled = false;
    api
      .getSettings()
      .then((data) => {
        if (cancelled) return;
        setPrefs(data);
        setTimeDraft(data.reminder_time.slice(0, 5));
      })
      .catch((err) => {
        if (!cancelled) setPrefsError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const patchPrefs = async (patch) => {
    setPrefsError(null);
    setPrefsSaved(false);
    try {
      const next = await api.updateSettings(patch);
      setPrefs(next);
      // Only resync the draft when this patch was about the time. Otherwise changing the time
      // zone would quietly discard an edit the user had typed but not yet committed.
      if ('reminder_time' in patch) setTimeDraft(next.reminder_time.slice(0, 5));
      setPrefsSaved(true);
    } catch (err) {
      setPrefsError(err.message);
    }
  };

  const connectTelegram = async () => {
    setPrefsError(null);
    setLinkNotice(false);
    try {
      const { deep_link_url: url } = await api.linkTelegram();
      window.open(url, '_blank', 'noopener');
      setLinkNotice(true);
    } catch (err) {
      setPrefsError(err.message);
    }
  };

  const disconnectTelegram = async () => {
    if (!window.confirm(t('settings.confirmDisconnect'))) return;
    setPrefsError(null);
    setLinkNotice(false);
    try {
      await api.unlinkTelegram();
      const next = await api.getSettings();
      setPrefs(next);
      setTimeDraft(next.reminder_time.slice(0, 5));
    } catch (err) {
      setPrefsError(err.message);
    }
  };

  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [pwError, setPwError] = useState(null);
  const [pwOk, setPwOk] = useState(false);

  const [deletePw, setDeletePw] = useState('');
  const [deleteError, setDeleteError] = useState(null);

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

  return (
    <div className="settings-page">
      <h1>{t('settings.title')}</h1>

      <section className="settings-card">
        <h2>{t('settings.notificationsTitle')}</h2>
        <p className="settings-hint">{t('settings.notificationsHint')}</p>

        {prefs === null && prefsError === null && <div className="settings-hint">…</div>}
        {prefs !== null && !prefs.bot_configured && (
          <div className="notice-warning">{t('settings.botNotConfigured')}</div>
        )}

        {prefs !== null && (
          <div className="notifications-grid">
            <label>
              {t('settings.timezone')}
              <select
                value={prefs.timezone}
                onChange={(e) => patchPrefs({ timezone: e.target.value })}
              >
                {timeZones.map((zone) => (
                  <option key={zone} value={zone}>
                    {zone}
                  </option>
                ))}
              </select>
            </label>

            <label>
              {t('settings.reminderTime')}
              {/* Committed on blur, not on change: typing 07:30 fires onChange for the hour and
                  again for the minute, which would send two PATCHes for one edit. */}
              <input
                type="time"
                value={timeDraft}
                onChange={(e) => setTimeDraft(e.target.value)}
                onBlur={() => {
                  if (timeDraft && timeDraft !== prefs.reminder_time.slice(0, 5)) {
                    patchPrefs({ reminder_time: timeDraft });
                  } else if (!timeDraft) {
                    setTimeDraft(prefs.reminder_time.slice(0, 5));
                  }
                }}
              />
            </label>

            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={prefs.notifications_enabled}
                onChange={(e) => patchPrefs({ notifications_enabled: e.target.checked })}
              />
              {t('settings.enableNotifications')}
            </label>

            <div className="telegram-status">
              {prefs.telegram_linked ? (
                <>
                  <span className="badge-linked">
                    {prefs.telegram_username
                      ? t('settings.telegramConnected', { username: prefs.telegram_username })
                      : t('settings.telegramConnectedNoUsername')}
                  </span>
                  <button type="button" className="btn btn-ghost" onClick={disconnectTelegram}>
                    {t('settings.disconnectTelegram')}
                  </button>
                </>
              ) : (
                <>
                  <span className="settings-hint">{t('settings.telegramNotConnected')}</span>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={connectTelegram}
                    disabled={!prefs.bot_configured}
                  >
                    {t('settings.connectTelegram')}
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        {linkNotice && (
          <div className="success">
            {t('settings.linkOpened')} {t('settings.linkExpires')}
          </div>
        )}
        {prefsSaved && <div className="success">{t('settings.settingsSaved')}</div>}
        {prefsError && <div className="error">{prefsError}</div>}
      </section>

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
