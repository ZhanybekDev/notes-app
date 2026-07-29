import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { setToken } from '../auth.js';
import { useLang } from '../i18n.jsx';

export default function Login() {
  const { t } = useLang();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const navigate = useNavigate();

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    try {
      const { access_token } = await api.login(username, password);
      setToken(access_token);
      navigate('/notes', { replace: true });
    } catch (err) {
      setError(err.message || t('auth.loginFailed'));
    }
  };

  return (
    <div className="auth-shell">
      <div className="auth">
        <h1>{t('auth.loginTitle')}</h1>
        <p className="auth-subtitle">{t('auth.loginSubtitle')}</p>
        <form onSubmit={submit}>
          <label>
            {t('auth.username')}
            <input value={username} onChange={(e) => setUsername(e.target.value)} required autoFocus />
          </label>
          <label>
            {t('auth.password')}
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </label>
          {error && <div className="error">{error}</div>}
          <button type="submit" title={t('tips.login')}>{t('auth.login')}</button>
        </form>
        <p>{t('auth.noAccount')} <Link to="/register">{t('auth.createOne')}</Link></p>
      </div>
    </div>
  );
}
