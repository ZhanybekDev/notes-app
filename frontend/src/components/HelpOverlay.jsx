import { useLang } from '../i18n.jsx';

const IS_MAC = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform);
const MOD = IS_MAC ? '⌘' : 'Ctrl';

const SHORTCUTS = [
  { keys: ['N'], i18n: 'shortcuts.newNote' },
  { keys: ['/'], i18n: 'shortcuts.focusSearch' },
  { keys: [MOD, 'S'], i18n: 'shortcuts.saveNote' },
  { keys: ['?'], i18n: 'shortcuts.showHelp' },
  { keys: ['Esc'], i18n: 'shortcuts.closeModal' },
];

export default function HelpOverlay({ open, onClose }) {
  const { t } = useLang();
  if (!open) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <header className="modal-header">
          <h2>{t('shortcuts.title')}</h2>
          <button
            className="btn btn-ghost"
            onClick={onClose}
            title={t('tips.closeDialog')}
            aria-label={t('tips.closeDialog')}
          >
            ✕
          </button>
        </header>
        <ul className="shortcuts">
          {SHORTCUTS.map((s) => (
            <li key={s.i18n}>
              <span>{t(s.i18n)}</span>
              <span className="kbd-group">
                {s.keys.map((k) => <kbd key={k}>{k}</kbd>)}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
