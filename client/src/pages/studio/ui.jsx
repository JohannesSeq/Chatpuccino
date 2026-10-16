import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useData } from '../../data.jsx';
import { useT } from '../../i18n.jsx';
import { CharAvatar, SearchBox } from '../../components/ui.jsx';
import { dataUrl } from './imageTools.js';

const clampNum = (v, min, max) => Math.min(max, Math.max(min, v));
const decimals = (step) => (String(step).split('.')[1] || '').length;

/**
 * Parámetro numérico con barra deslizante y cuadro numérico.
 * `range` = [min, max, step] (p. ej. PARAM_RANGES.steps de shared/studio.js); `format(v)` cambia cómo se muestra el valor.
 */
export function SliderField({ label, value, onChange, range, hint, disabled, suffix = '' }) {
  const [min, max, step] = range;
  const [draft, setDraft] = useState(null);
  const shown = draft ?? String(value ?? '');
  const commit = (raw) => {
    setDraft(null);
    const n = Number(raw);
    if (raw === '' || !Number.isFinite(n)) return;
    onChange(Number(clampNum(n, min, max).toFixed(decimals(step))));
  };
  return (
    <div className={`slider-field ${disabled ? 'disabled' : ''}`}>
      <div className="slider-head">
        <span className="field-label">{label}</span>
        <span className="slider-num">
          <input
            type="number"
            min={min}
            max={max}
            step={step}
            value={shown}
            disabled={disabled}
            aria-label={label}
            onChange={(e) => {
              setDraft(e.target.value);
              const n = Number(e.target.value);
              if (e.target.value !== '' && Number.isFinite(n) && n >= min && n <= max) onChange(n);
            }}
            onBlur={(e) => commit(e.target.value)}
          />
          {suffix && <small>{suffix}</small>}
        </span>
      </div>
      <input type="range" min={min} max={max} step={step} value={clampNum(Number(value) || min, min, max)} disabled={disabled} aria-label={label} onChange={(e) => onChange(Number(e.target.value))} />
      {hint && <span className="field-hint">{hint}</span>}
    </div>
  );
}

/** Cantidad de imágenes a generar: − [n] + junto al botón Generar (comparte valor con el ajuste rápido de la tanda). */
export function CountStepper({ value, onChange, min = 1, max = 16, label, disabled }) {
  const { t } = useT();
  const shown = label ?? t('studio.common.count_label');
  const clamp = (n) => Math.min(max, Math.max(min, Math.round(n)));
  const [draft, setDraft] = useState(null);
  const commit = (raw) => {
    setDraft(null);
    const n = Number(raw);
    if (raw !== '' && Number.isFinite(n)) onChange(clamp(n));
  };
  return (
    <div className="count-stepper" role="group" aria-label={shown}>
      <span className="field-label">{shown}</span>
      <span className="count-controls">
        <button type="button" className="btn small" onClick={() => onChange(clamp(value - 1))} disabled={disabled || value <= min} aria-label={t('studio.common.count_less')}>
          −
        </button>
        <input
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          value={draft ?? value}
          disabled={disabled}
          aria-label={shown}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && commit(e.currentTarget.value)}
        />
        <button type="button" className="btn small" onClick={() => onChange(clamp(value + 1))} disabled={disabled || value >= max} aria-label={t('studio.common.count_more')}>
          +
        </button>
      </span>
    </div>
  );
}

/** Semilla: número (-1 = aleatoria) con botón para volver a «aleatoria». */
export function SeedField({ value, onChange, label, hint }) {
  const { t } = useT();
  return (
    <label className="field seed-field">
      <span className="field-label">{label ?? t('studio.common.seed')}</span>
      <span className="seed-row">
        <input type="number" min={-1} max={4294967295} step={1} value={value} onChange={(e) => onChange(e.target.value === '' ? -1 : Math.round(Number(e.target.value)))} />
        <button type="button" className="btn small" onClick={() => onChange(-1)} disabled={value === -1} title={t('studio.common.seed_random_hint')}>
          {t('studio.common.seed_random')}
        </button>
      </span>
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

/** Barra de estado de una generación: progreso, paso actual y botón de cancelar. `gen` viene de useGeneration(). */
export function GenerationBar({ gen, label }) {
  const { t } = useT();
  if (!gen.running && !gen.error) return null;
  const p = gen.progress;
  const pct = p ? Math.round(p.progress * 100) : 0;
  return (
    <div className="gen-bar" role="status" aria-live="polite">
      {gen.running && (
        <>
          <div className="gen-bar-row">
            <span className="grow">
              {label || t('studio.common.generating')}
              {p?.steps ? ` · ${t('studio.common.step', { step: p.step ?? 0, steps: p.steps })}` : ''}
              {p?.eta ? ` · ${t('studio.common.eta', { seconds: Math.ceil(p.eta) })}` : ''}
            </span>
            <button type="button" className="btn small" onClick={gen.cancel}>
              {t('common.cancel')}
            </button>
          </div>
          <div className="gen-track" aria-hidden="true">
            <i className={p ? '' : 'indeterminate'} style={p ? { width: `${pct}%` } : undefined} />
          </div>
        </>
      )}
      {gen.error && !gen.running && (
        <p className="err gen-error">{gen.error}</p>
      )}
    </div>
  );
}

/** Imagen de resultado (base64 PNG) sobre cuadrícula de transparencia; `children` son sus acciones. */
export function ImageCard({ item, onOpen, children, badge, selected }) {
  const { t } = useT();
  return (
    <figure className={`studio-card ${selected ? 'selected' : ''}`}>
      <button type="button" className="studio-img checker" onClick={onOpen} aria-label={t('studio.common.open_image')}>
        <img src={item.url || dataUrl(item.data)} alt="" loading="lazy" />
        {badge && <span className="studio-badge">{badge}</span>}
      </button>
      {children && <figcaption className="studio-actions">{children}</figcaption>}
    </figure>
  );
}

export const ResultGrid = ({ children, wide }) => <div className={`studio-grid ${wide ? 'wide' : ''}`}>{children}</div>;

const LS_CHAR = 'chatpuccino.studio.char';
const readChar = () => {
  try {
    return localStorage.getItem(LS_CHAR) || '';
  } catch {
    return '';
  }
};

/** Elige un personaje (la elección se recuerda) y pinta `children(character, changeButton)` cuando hay uno. */
export function CharacterGate({ intro, children }) {
  const { t } = useT();
  const { characters } = useData();
  const [charId, setCharId] = useState(readChar);
  const [picking, setPicking] = useState(false);
  const [query, setQuery] = useState('');
  const character = characters.find((c) => c.id === charId);
  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return characters.filter((c) => !q || c.name.toLowerCase().includes(q));
  }, [characters, query]);

  const pick = (id) => {
    try {
      localStorage.setItem(LS_CHAR, id);
    } catch {
      /* sin almacenamiento local */
    }
    setCharId(id);
    setPicking(false);
  };

  if (!character || picking) {
    return (
      <div className="stack">
        {intro && <p className="muted">{intro}</p>}
        <div className="btn-row">
          <h3 className="grow">{t('studio.common.pick_character')}</h3>
          {character && (
            <button className="btn small" onClick={() => setPicking(false)}>
              {t('common.cancel')}
            </button>
          )}
        </div>
        {characters.length > 0 && <SearchBox value={query} onChange={setQuery} placeholder={t('studio.common.search_characters')} />}
        <div className="grid-cards">
          {list.map((c) => (
            <button key={c.id} className={`char-card ${c.id === charId ? 'selected' : ''}`} onClick={() => pick(c.id)}>
              <CharAvatar character={c} size={64} />
              <strong>{c.name}</strong>
            </button>
          ))}
        </div>
        {!list.length && (
          <div className="library-empty">
            <strong>{characters.length ? t('studio.common.no_results') : t('studio.common.no_characters')}</strong>
          </div>
        )}
      </div>
    );
  }
  return (
    <div className="stack">
      <div className="sprites-char">
        <CharAvatar character={character} size={48} />
        <strong className="grow">{character.name}</strong>
        <button className="btn small" onClick={() => setPicking(true)}>
          {t('studio.common.change_character')}
        </button>
      </div>
      {children(character)}
    </div>
  );
}

/** Aviso cuando aún no se ha configurado el servidor (o falta el modelo). */
export function SetupNotice({ onGoSettings }) {
  const { t } = useT();
  return (
    <div className="card studio-notice">
      <strong>{t('studio.common.not_configured_title')}</strong>
      <p className="muted">{t('studio.common.not_configured_text')}</p>
      <button className="btn primary" onClick={onGoSettings}>
        {t('studio.common.go_settings')}
      </button>
    </div>
  );
}

/** Mantiene un valor en localStorage (p. ej. preferencias de cada panel). */
export function useLocalPref(key, initial) {
  const [value, setValue] = useState(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? initial : JSON.parse(raw);
    } catch {
      return initial;
    }
  });
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* sin almacenamiento local */
    }
  }, [key, value]);
  return [value, setValue];
}
