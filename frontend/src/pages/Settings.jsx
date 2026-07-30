import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useLang } from '../i18n.jsx';
import { useTelegramLink } from '../hooks/useTelegramLink.js';
import { useAccountStore } from '../stores/accountStore.js';
import { usePrefsStore } from '../stores/prefsStore.js';
import { useSessionStore } from '../stores/sessionStore.js';

const SAVED_NOTICE_MS = 2500;

function listTimeZones(current) {
  const supported =
    typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];
  return supported.includes(current) ? supported : [current, ...supported];
}

function browserTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

export default function Settings() {
  const { t } = useLang();
  const navigate = useNavigate();

  const prefs = useAccountStore((s) => s.prefs);
  const prefsError = useAccountStore((s) => s.error);
  const prefsSaved = useAccountStore((s) => s.saved);
  const loadPrefs = useAccountStore((s) => s.load);
  const patchStore = useAccountStore((s) => s.patch);
  const unlinkTelegram = useAccountStore((s) => s.unlink);
  const setPrefs = useAccountStore((s) => s.setPrefs);
  const clearError = useAccountStore((s) => s.clearError);
  const clearSaved = useAccountStore((s) => s.clearSaved);

  // Draft of the time input: unsaved keystrokes are this screen's state, not the app's.
  const logout = useSessionStore((s) => s.logout);
  const tzDismissed = usePrefsStore((s) => s.tzSuggestionDismissed);
  const dismissTzSuggestion = usePrefsStore((s) => s.dismissTzSuggestion);

  const [timeDraft, setTimeDraft] = useState('');

  const timeZones = useMemo(() => listTimeZones(prefs?.timezone ?? 'UTC'), [prefs?.timezone]);
  const suggestedZone = useMemo(() => browserTimeZone(), []);
  // Suggest, never apply: changing a stored zone moves every future reminder without asking.
  // 'UTC' is the untouched server default, so anything else means the user has already chosen.
  const showTzSuggestion =
    prefs !== null &&
    prefs.timezone === 'UTC' &&
    Boolean(suggestedZone) &&
    suggestedZone !== 'UTC' &&
    !tzDismissed;

  useEffect(() => {
    // Serves the cached settings straight away and revalidates: the bot can change them behind
    // this tab's back, so a load-once cache would show a stale toggle.
    loadPrefs().then((next) => {
      if (next) setTimeDraft(next.reminder_time.slice(0, 5));
    });
  }, [loadPrefs]);

  const patchPrefs = async (patch) => {
    const next = await patchStore(patch);
    // Only resync the draft when this patch was about the time. Otherwise changing the time
    // zone would quietly discard an edit the user had typed but not yet committed.
    if (next && 'reminder_time' in patch) setTimeDraft(next.reminder_time.slice(0, 5));
  };

  const {
    status: linkStatus,
    error: linkError,
    connect: connectTelegram,
    recheck: recheckTelegram,
  } = useTelegramLink({
    onLinked: (next) => {
      setPrefs(next);
      setTimeDraft(next.reminder_time.slice(0, 5));
    },
  });

  // The confirmation used to sit there for the rest of the session. The timer belongs to the
  // screen: in the store it would outlive both the page and resetStores() in tests.
  useEffect(() => {
    if (!prefsSaved) return undefined;
    const id = setTimeout(clearSaved, SAVED_NOTICE_MS);
    return () => clearTimeout(id);
  }, [prefsSaved, clearSaved]);

  const disconnectTelegram = async () => {
    if (!window.confirm(t('settings.confirmDisconnect'))) return;
    const next = await unlinkTelegram();
    if (next) setTimeDraft(next.reminder_time.slice(0, 5));
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
      logout();
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
            {showTzSuggestion && (
              <div className="tz-suggestion">
                <span>{t('settings.timezoneSuggestion', { zone: suggestedZone })}</span>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => patchPrefs({ timezone: suggestedZone })}
                  title={t('tips.timezoneSuggestionApply')}
                >
                  {t('settings.timezoneSuggestionApply')}
                </button>
                <button
                  type="button"
                  className="link-button"
                  onClick={dismissTzSuggestion}
                  title={t('tips.timezoneSuggestionDismiss')}
                >
                  {t('settings.timezoneSuggestionDismiss')}
                </button>
              </div>
            )}
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
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={disconnectTelegram}
                    title={t('tips.disconnectTelegram')}
                  >
                    {t('settings.disconnectTelegram')}
                  </button>
                </>
              ) : (
                <>
                  {/* The waiting message lives in the notice below, next to the expiry — saying
                      it here as well put the same sentence on screen twice. */}
                  <span className="settings-hint">{t('settings.telegramNotConnected')}</span>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => {
                      clearError();
                      connectTelegram();
                    }}
                    disabled={
                      !prefs.bot_configured ||
                      linkStatus === 'requesting' ||
                      linkStatus === 'waiting'
                    }
                    title={t('tips.connectTelegram')}
                  >
                    {t('settings.connectTelegram')}
                  </button>
                  {(linkStatus === 'timeout' || linkStatus === 'error') && (
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={recheckTelegram}
                      title={t('tips.linkRecheck')}
                    >
                      {t('settings.linkRecheck')}
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        )}

        {linkStatus === 'waiting' && (
          <div className="notice-waiting">
            {t('settings.linkWaiting')} {t('settings.linkExpires')}
          </div>
        )}
        {linkStatus === 'timeout' && (
          <div className="notice-warning">{t('settings.linkTimedOut')}</div>
        )}
        {linkError && <div className="error">{linkError}</div>}
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
          <button type="submit" className="btn btn-primary" title={t('tips.changePassword')}>
            {t('settings.submit')}
          </button>
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
          <button type="submit" className="btn btn-danger" title={t('tips.deleteAccount')}>
            {t('settings.deleteAccount')}
          </button>
        </form>
      </section>
    </div>
  );
}
