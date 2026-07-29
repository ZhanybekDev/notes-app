import { LANGS, useLang } from '../i18n.jsx';

const FLAGS = { en: '🇬🇧', ru: '🇷🇺' };

export default function LanguageToggle() {
  const { lang, setLang, t } = useLang();

  const cycle = () => {
    const next = LANGS[(LANGS.indexOf(lang) + 1) % LANGS.length];
    setLang(next);
  };

  return (
    <button
      type="button"
      className="lang-toggle"
      onClick={cycle}
      title={t('tips.language', { value: t(`lang.label.${lang}`) })}
      aria-label={t('tips.language', { value: t(`lang.label.${lang}`) })}
    >
      <span className="theme-icon">{FLAGS[lang]}</span>
      <span className="lang-label">{t(`lang.label.${lang}`)}</span>
    </button>
  );
}
