import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import BusyButton from '../components/BusyButton.jsx';
import { useSessionStore } from '../stores/sessionStore.js';
import { useLang } from '../i18n.jsx';

export default function Register() {
  const { t } = useLang();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();
  const login = useSessionStore((s) => s.login);

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await api.register(username, password);
      const { access_token } = await api.login(username, password);
      login(access_token);
      navigate('/notes', { replace: true });
    } catch (err) {
      setError(err.message || t('auth.registerFailed'));
      // Only on failure: a success navigates away, and clearing the flag first would flash the
      // button back to life under the reader's cursor on the way out.
      setSubmitting(false);
    }
  };

  return (
    <div className="auth-shell">
      <div className="auth">
        <h1>{t('auth.registerTitle')}</h1>
        <p className="auth-subtitle">{t('auth.registerSubtitle')}</p>
        <form onSubmit={submit}>
          <label>
            {t('auth.username')}
            <input value={username} onChange={(e) => setUsername(e.target.value)} required minLength={3} autoFocus />
          </label>
          <label>
            {t('auth.password')}
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} />
          </label>
          {error && <div className="error">{error}</div>}
          <BusyButton type="submit" busy={submitting} title={t('tips.register')}>
            {t('auth.create')}
          </BusyButton>
        </form>
        <p>{t('auth.haveAccount')} <Link to="/login">{t('auth.loginLink')}</Link></p>
      </div>
    </div>
  );
}
