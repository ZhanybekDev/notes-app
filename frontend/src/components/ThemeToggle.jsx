import { useState } from 'react';
import { getThemePref, setThemePref } from '../theme.js';
import { useLang } from '../i18n.jsx';

const ORDER = ['light', 'dark', 'system'];
const ICON = { light: '☀️', dark: '🌙', system: '🖥️' };

export default function ThemeToggle() {
  const [pref, setPref] = useState(getThemePref());
  const { t } = useLang();

  const cycle = () => {
    const next = ORDER[(ORDER.indexOf(pref) + 1) % ORDER.length];
    setPref(next);
    setThemePref(next);
  };

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
