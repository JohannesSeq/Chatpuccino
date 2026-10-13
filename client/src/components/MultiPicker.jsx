import React from 'react';
import { Icon } from './Icon.jsx';

/**
 * Selector múltiple con desplegable + chips (como las etiquetas, pero solo entre opciones existentes).
 * options: [{ id, label, sub? }]; value: [id]. Los textos los pasa quien lo usa (ya traducidos).
 */
export default function MultiPicker({ value, onChange, options, placeholder, noneLeft, removeLabel, ariaLabel, chipClass = '' }) {
  const byId = new Map(options.map((o) => [o.id, o]));
  const available = options.filter((o) => !value.includes(o.id));
  return (
    <div className="tag-picker multi-picker">
      {value.length > 0 && (
        <div className="tag-list">
          {value.map((id) => {
            const o = byId.get(id);
            const label = o?.label ?? id;
            return (
              <span key={id} className={`tag-chip ${o ? '' : 'missing'} ${chipClass}`} title={o?.sub || undefined}>
                {label}
                <button type="button" onClick={() => onChange(value.filter((v) => v !== id))} aria-label={removeLabel ? removeLabel(label) : undefined}>
                  <Icon name="close" size={14} />
                </button>
              </span>
            );
          })}
        </div>
      )}
      <div className="tag-controls">
        <select
          value=""
          disabled={!available.length}
          aria-label={ariaLabel}
          onChange={(e) => {
            if (e.target.value) onChange([...value, e.target.value]);
            e.target.value = '';
          }}
        >
          <option value="">{available.length ? placeholder : noneLeft}</option>
          {available.map((o) => (
            <option key={o.id} value={o.id}>
              {o.sub ? `${o.label} — ${o.sub}` : o.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
