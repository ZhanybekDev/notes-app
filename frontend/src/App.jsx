import { useCallback, useRef, useState } from 'react';
import { Navigate, NavLink, Route, Routes, useNavigate } from 'react-router-dom';
import Login from './pages/Login.jsx';
import Register from './pages/Register.jsx';
import Notes from './pages/Notes.jsx';
import Calendar from './pages/Calendar.jsx';
import Settings from './pages/Settings.jsx';
import SharedNote from './pages/SharedNote.jsx';
import ThemeToggle from './components/ThemeToggle.jsx';
import LanguageToggle from './components/LanguageToggle.jsx';
import HelpOverlay from './components/HelpOverlay.jsx';
import Toaster from './components/Toaster.jsx';
import { useSessionStore } from './stores/sessionStore.js';
import { useLang } from './i18n.jsx';
import { useShortcuts } from './hooks/useShortcuts.js';

// Reading the token through the store makes this reactive: a logout anywhere — this tab, another
// tab, a 401 from any request — redirects instead of waiting for the next unrelated render.
function RequireAuth({ children }) {
  const signedIn = useSessionStore((s) => Boolean(s.token));
  return signedIn ? children : <Navigate to="/login" replace />;
}

function Header({ onShowHelp }) {
  const navigate = useNavigate();
  const { t } = useLang();
  const signedIn = useSessionStore((s) => Boolean(s.token));
  const logoutSession = useSessionStore((s) => s.logout);
  const linkClass = ({ isActive }) => `nav-link${isActive ? ' active' : ''}`;

  const brand = (
    <div className="brand">
      <span className="brand-mark">N</span>
      <span>{t('brand')}</span>
    </div>
  );

  if (!signedIn) {
    return (
      <nav className="nav">
        {brand}
        <div className="nav-spacer" />
        <LanguageToggle />
        <ThemeToggle />
      </nav>
    );
  }

  const logout = () => {
    logoutSession();
    navigate('/login', { replace: true });
  };

  return (
    <nav className="nav">
      {brand}
      <NavLink to="/notes" className={linkClass} title={t('tips.navNotes')}>{t('nav.notes')}</NavLink>
      <NavLink to="/calendar" className={linkClass} title={t('tips.navCalendar')}>{t('nav.calendar')}</NavLink>
      <NavLink to="/settings" className={linkClass} title={t('tips.navSettings')}>{t('nav.settings')}</NavLink>
      <div className="nav-spacer" />
      <button
        className="link-button help-btn"
        onClick={onShowHelp}
        title={t('tips.help')}
        aria-label={t('tips.help')}
      >
        ?
      </button>
      <LanguageToggle />
      <ThemeToggle />
      <button className="link-button" onClick={logout} title={t('tips.logout')}>{t('nav.logout')}</button>
    </nav>
  );
}

export default function App() {
  const navigate = useNavigate();
  const signedIn = useSessionStore((s) => Boolean(s.token));
  const [helpOpen, setHelpOpen] = useState(false);
  const pendingActionRef = useRef({});

  const setPendingAction = useCallback((name, handler) => {
    pendingActionRef.current[name] = handler;
  }, []);

  const handlers = {
    onNewNote: () => {
      navigate('/notes');
      setTimeout(() => pendingActionRef.current.newNote?.(), 30);
    },
    onFocusSearch: () => {
      navigate('/notes');
      setTimeout(() => pendingActionRef.current.focusSearch?.(), 30);
    },
    onSave: () => pendingActionRef.current.save?.(),
    onShowHelp: () => setHelpOpen(true),
    onEscape: () => setHelpOpen(false),
  };

  useShortcuts(handlers);

  return (
    <div className="app">
      <Header onShowHelp={() => setHelpOpen(true)} />
      <main>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          {/* No RequireAuth: a share link is opened by people who have no account here. */}
          <Route path="/s/:token" element={<SharedNote />} />
          <Route path="/notes" element={<RequireAuth><Notes registerAction={setPendingAction} /></RequireAuth>} />
          <Route path="/calendar" element={<RequireAuth><Calendar /></RequireAuth>} />
          <Route path="/settings" element={<RequireAuth><Settings /></RequireAuth>} />
          <Route path="*" element={<Navigate to={signedIn ? '/notes' : '/login'} replace />} />
        </Routes>
      </main>
      <HelpOverlay open={helpOpen} onClose={() => setHelpOpen(false)} />
      <Toaster />
    </div>
  );
}
