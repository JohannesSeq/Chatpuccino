import React, { useMemo, useRef, useState } from 'react';
import { currentLocale, useT } from '../i18n.jsx';
import { Icon } from './Icon.jsx';

const MAX_LEN = 40;
const same = (a, b) => a.toLowerCase() === b.toLowerCase();

// Etiquetas como chips: se eligen de las que ya existen (dropdown) o se crean nuevas con «+».
export default function TagPicker({ value, onChange, options = [] }) {
  const { t, lang } = useT();
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef(null);

  const known = useMemo(() => {
    const out = [];
    for (const tag of [...options, ...value]) if (tag && !out.some((o) => same(o, tag))) out.push(tag);
    return out.sort((a, b) => a.localeCompare(b, currentLocale(), { sensitivity: 'base' }));
  }, [options, value, lang]);
  const available = known.filter((tag) => !value.some((v) => same(v, tag)));

  const add = (names) => {
    const next = [...value];
    for (const raw of names) {
      const name = raw.trim().slice(0, MAX_LEN);
      if (!name || next.some((tag) => same(tag, name))) continue;
      next.push(known.find((tag) => same(tag, name)) || name);
    }
    if (next.length !== value.length) onChange(next);
  };

  const commit = () => {
    add(draft.split(','));
    setDraft('');
    setAdding(false);
  };

  const openAdd = () => {
    setAdding(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  return (
    <div className="tag-picker">
      {value.length > 0 && (
        <div className="tag-list">
          {value.map((tag) => (
            <span key={tag} className="tag-chip">
              {tag}
              <button type="button" onClick={() => onChange(value.filter((v) => v !== tag))} aria-label={t('tags.remove_aria', { name: tag })}>
                <Icon name="close" size={14} />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="tag-controls">
        <select
          value=""
          disabled={!available.length}
          onChange={(e) => {
            add([e.target.value]);
            e.target.value = '';
          }}
          aria-label={t('tags.choose_aria')}
        >
          <option value="">{available.length ? t('tags.choose') : known.length ? t('tags.all_used') : t('tags.none_yet')}</option>
          {available.map((tag) => (
            <option key={tag} value={tag}>
              {tag}
            </option>
          ))}
        </select>
        <button type="button" className="icon-btn tag-add" onClick={() => (adding ? setAdding(false) : openAdd())} aria-label={t('tags.create')} aria-expanded={adding} title={t('tags.create')}>
          <Icon name={adding ? 'close' : 'plus'} />
        </button>
      </div>
      {adding && (
        <div className="tag-new">
          <input
            ref={inputRef}
            value={draft}
            maxLength={MAX_LEN * 4}
            placeholder={t('tags.new_placeholder')}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commit();
              } else if (e.key === 'Escape') {
                e.stopPropagation();
                setDraft('');
                setAdding(false);
              }
            }}
          />
          <button type="button" className="btn primary small" onClick={commit} disabled={!draft.trim()}>
            {t('common.add')}
          </button>
        </div>
      )}
    </div>
  );
}
