import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { clearToken } from '../auth.js';
import { useLang } from '../i18n.jsx';

export default function Settings() {
  const { lang, t } = useLang();
  const navigate = useNavigate();

  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [pwError, setPwError] = useState(null);
  const [pwOk, setPwOk] = useState(false);

  const [deletePw, setDeletePw] = useState('');
  const [deleteError, setDeleteError] = useState(null);

  const [telegram, setTelegram] = useState(null);
  const [telegramLoading, setTelegramLoading] = useState(true);
  const [telegramSaving, setTelegramSaving] = useState(false);
  const [telegramError, setTelegramError] = useState(null);
  const [telegramSuccess, setTelegramSuccess] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function loadTelegramSettings() {
      setTelegramLoading(true);
      setTelegramError(null);
      try {
        const next = await api.getTelegramSettings();
        if (!cancelled) setTelegram(next);
      } catch (err) {
        if (!cancelled) setTelegramError(err.message);
      } finally {
        if (!cancelled) setTelegramLoading(false);
      }
    }

    loadTelegramSettings();
    return () => {
      cancelled = true;
    };
  }, []);

  const setTelegramState = (next, successMessage = null) => {
    setTelegram(next);
    setTelegramError(null);
    setTelegramSuccess(successMessage);
  };

  const runTelegramAction = async (action, successMessage) => {
    setTelegramSaving(true);
    setTelegramError(null);
    setTelegramSuccess(null);
    try {
      const next = await action();
      setTelegramState(next, successMessage);
    } catch (err) {
      setTelegramError(err.message);
    } finally {
      setTelegramSaving(false);
    }
  };

  const formatTelegramExpiry = (value) => {
    if (!value) return null;
    return new Intl.DateTimeFormat(lang, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value));
  };

  const telegramStatusKey = telegram?.available
    ? telegram.connected
      ? 'settings.telegramStatusConnected'
      : 'settings.telegramStatusDisconnected'
    : 'settings.telegramStatusUnavailable';

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
        <div className="settings-status-row">
          <span
            className={[
              'settings-status-badge',
              telegram?.available ? (telegram.connected ? 'is-success' : 'is-muted') : 'is-warning',
            ].join(' ')}
          >
            {t(telegramStatusKey)}
          </span>
        </div>

        {telegramLoading && <p className="settings-hint">{t('settings.telegramLoading')}</p>}
        {telegramError && <div className="error">{telegramError}</div>}
        {telegramSuccess && <div className="success">{telegramSuccess}</div>}

        {!telegramLoading && telegram && (
          <div className="settings-telegram-box">
            {!telegram.available && (
              <p className="settings-hint">{t('settings.telegramUnavailableHint')}</p>
            )}

            {telegram.available && !telegram.connected && (
              <>
                <p className="settings-hint">{t('settings.telegramDisconnectedHint')}</p>
                {telegram.link_code && (
                  <div className="settings-telegram-instructions">
                    <div>{t('settings.telegramInstruction')}</div>
                    <code className="settings-inline-code">/start {telegram.link_code}</code>
                    {telegram.link_code_expires_at && (
                      <div className="settings-hint">
                        {t('settings.telegramCodeExpires', {
                          expiresAt: formatTelegramExpiry(telegram.link_code_expires_at),
                        })}
                      </div>
                    )}
                  </div>
                )}
                <div className="settings-actions">
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={telegramSaving}
                    onClick={() =>
                      runTelegramAction(
                        () => api.generateTelegramLink(),
                        t('settings.telegramCodeGenerated')
                      )
                    }
                  >
                    {t(telegram.link_code ? 'settings.telegramRefreshCode' : 'settings.telegramGenerateCode')}
                  </button>
                </div>
              </>
            )}

            {telegram.available && telegram.connected && (
              <>
                <p className="settings-hint">
                  {telegram.telegram_username
                    ? t('settings.telegramConnectedAs', { username: `@${telegram.telegram_username}` })
                    : t('settings.telegramConnectedFallback')}
                </p>
                <label className="settings-checkbox">
                  <input
                    type="checkbox"
                    checked={telegram.notifications_enabled}
                    disabled={telegramSaving}
                    onChange={(e) =>
                      runTelegramAction(
                        () => api.updateTelegramSettings(e.target.checked),
                        t('settings.telegramSettingsSaved')
                      )
                    }
                  />
                  <span>{t('settings.telegramEnableNotifications')}</span>
                </label>
                <div className="settings-actions">
                  <button
                    type="button"
                    className="btn btn-danger"
                    disabled={telegramSaving}
                    onClick={() =>
                      runTelegramAction(
                        () => api.unlinkTelegram(),
                        t('settings.telegramUnlinked')
                      )
                    }
                  >
                    {t('settings.telegramUnlink')}
                  </button>
                </div>
              </>
            )}
          </div>
        )}
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
