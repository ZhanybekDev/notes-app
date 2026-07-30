import { useLang } from '../i18n.jsx';
import { usePrefsStore } from '../stores/prefsStore.js';

const ORDER = ['light', 'dark', 'system'];
const ICON = { light: '☀️', dark: '🌙', system: '🖥️' };

export default function ThemeToggle() {
  // Reads the one copy of the preference. It used to keep its own useState snapshot taken at mount,
  // which is the duplication this migration exists to remove.
  const pref = usePrefsStore((s) => s.theme);
  const setTheme = usePrefsStore((s) => s.setTheme);
  const { t } = useLang();

  const cycle = () => setTheme(ORDER[(ORDER.indexOf(pref) + 1) % ORDER.length]);

  const label = t(`theme.${pref}`);

  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={cycle}
      title={t('tips.theme', { value: label })}
      aria-label={t('tips.theme', { value: label })}
    >
      <span className="theme-icon">{ICON[pref]}</span>
      <span className="theme-label">{label}</span>
    </button>
  );
}
