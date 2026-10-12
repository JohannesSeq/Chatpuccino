import React, { useMemo, useRef, useState } from 'react';
import { Icon } from './Icon.jsx';

const MAX_LEN = 40;
const same = (a, b) => a.toLowerCase() === b.toLowerCase();

// Etiquetas como chips: se eligen de las que ya existen (dropdown) o se crean nuevas con «+».
export default function TagPicker({ value, onChange, options = [] }) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef(null);

  const known = useMemo(() => {
    const out = [];
    for (const t of [...options, ...value]) if (t && !out.some((o) => same(o, t))) out.push(t);
    return out.sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));
  }, [options, value]);
  const available = known.filter((t) => !value.some((v) => same(v, t)));

  const add = (names) => {
    const next = [...value];
    for (const raw of names) {
      const name = raw.trim().slice(0, MAX_LEN);
      if (!name || next.some((t) => same(t, name))) continue;
      next.push(known.find((t) => same(t, name)) || name);
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
          {value.map((t) => (
            <span key={t} className="tag-chip">
              {t}
              <button type="button" onClick={() => onChange(value.filter((v) => v !== t))} aria-label={`Quitar la etiqueta ${t}`}>
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
          aria-label="Elegir una etiqueta existente"
        >
          <option value="">{available.length ? 'Elegir etiqueta…' : known.length ? 'Ya usas todas las etiquetas' : 'Aún no hay etiquetas'}</option>
          {available.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <button type="button" className="icon-btn tag-add" onClick={() => (adding ? setAdding(false) : openAdd())} aria-label="Crear etiqueta nueva" aria-expanded={adding} title="Crear etiqueta nueva">
          <Icon name={adding ? 'close' : 'plus'} />
        </button>
      </div>
      {adding && (
        <div className="tag-new">
          <input
            ref={inputRef}
            value={draft}
            maxLength={MAX_LEN * 4}
            placeholder="Nueva etiqueta"
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
            Añadir
          </button>
        </div>
      )}
    </div>
  );
}
