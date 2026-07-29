import { useLang } from '../i18n.jsx';

export default function TagFilter({ tags, active, onChange }) {
  const { t } = useLang();
  if (!tags.length) return null;
  return (
    <div className="tag-filter">
      <button
        className={`tag-chip${!active ? ' active' : ''}`}
        onClick={() => onChange(null)}
        title={t('tips.tagAll')}
      >
        {t('notes.allTag')}
      </button>
      {tags.map((tag) => (
        <button
          key={tag}
          className={`tag-chip${active === tag ? ' active' : ''}`}
          onClick={() => onChange(tag)}
          title={t('tips.tagOne', { tag })}
        >
          #{tag}
        </button>
      ))}
    </div>
  );
}
