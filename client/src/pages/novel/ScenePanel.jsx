import React, { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useT } from '../../i18n.jsx';
import { Avatar } from '../../components/ui.jsx';
import { fmtNum } from './vnUtils.js';

function StatValue({ stat, value, label, onCommit }) {
  const { t } = useT();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const cancelled = useRef(false);

  const start = () => {
    cancelled.current = false;
    setDraft(fmtNum(value));
    setEditing(true);
  };
  const commit = () => {
    setEditing(false);
    if (cancelled.current) return;
    const n = Number(draft);
    if (!Number.isFinite(n)) return;
    const v = Math.min(stat.max, Math.max(stat.min, n));
    if (v !== value) onCommit(v);
  };

  if (editing) {
    return (
      <input
        className="vn-stat-input"
        type="number"
        autoFocus
        min={stat.min}
        max={stat.max}
        step="1"
        value={draft}
        aria-label={t('novelview.stats.edit_aria', { stat: stat.name, who: label })}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          else if (e.key === 'Escape') {
            cancelled.current = true;
            e.currentTarget.blur();
          }
        }}
      />
    );
  }
  return (
    <button className="vn-stat-value" onClick={start} title={t('novelview.stats.edit_hint')} aria-label={t('novelview.stats.edit_aria', { stat: stat.name, who: label })}>
      {fmtNum(value)}
      <small>/{fmtNum(stat.max)}</small>
    </button>
  );
}

function StatBar({ stat, value, who, onCommit }) {
  const [open, setOpen] = useState(false);
  const pct = stat.max > stat.min ? Math.min(100, Math.max(0, ((value - stat.min) / (stat.max - stat.min)) * 100)) : 0;
  return (
    <div className="vn-stat" style={{ '--stat-color': stat.color || 'var(--accent)' }}>
      <div className="vn-stat-head">
        {stat.description ? (
          <button className="vn-stat-name" onClick={() => setOpen((o) => !o)} aria-expanded={open} title={stat.description}>
            {stat.name}
          </button>
        ) : (
          <span className="vn-stat-name static">{stat.name}</span>
        )}
        <StatValue stat={stat} value={value} label={who} onCommit={onCommit} />
      </div>
      <div className="vn-stat-track" role="meter" aria-valuemin={stat.min} aria-valuemax={stat.max} aria-valuenow={value} aria-label={`${stat.name} · ${who}`}>
        <i style={{ width: `${pct}%` }} />
      </div>
      {open && stat.description && <p className="vn-stat-desc muted">{stat.description}</p>}
    </div>
  );
}

/**
 * Panel de opciones de la escena (columna derecha en escritorio, hoja inferior en el móvil).
 * Props: world, cast, stats, backgrounds, state, lorebooks, persona, onUpdate(patch) -> Promise,
 * onSetStat(charId|null, statId, value) -> Promise, onEditWorld().
 */
export default function ScenePanel({ world, cast, stats, backgrounds, state, lorebooks, persona, onUpdate, onSetStat, onEditWorld }) {
  const { t } = useT();
  const scene = state?.scene || { background: '', active: [], outfits: {} };
  const activeSet = useMemo(() => new Set(scene.active || []), [scene.active]);
  const onStage = useMemo(() => cast.filter((c) => activeSet.has(c.id)), [cast, activeSet]);
  const charStats = stats.filter((s) => s.scope !== 'world');
  const worldStats = stats.filter((s) => s.scope === 'world');

  const toggle = (id, on) => onUpdate({ active: cast.filter((c) => (c.id === id ? on : activeSet.has(c.id))).map((c) => c.id) });
  const valueOf = (s, charId) => {
    const v = charId ? state?.stats?.characters?.[charId]?.[s.id] : state?.stats?.world?.[s.id];
    return Number.isFinite(v) ? v : s.default;
  };

  return (
    <div className="vn-panel-body">
      <details open className="vn-sec">
        <summary>{t('novelview.panel.scene')}</summary>
        <div className="vn-bg-grid" role="group" aria-label={t('novelview.panel.background')}>
          <button className={`vn-bg-tile none ${scene.background ? '' : 'selected'}`} aria-pressed={!scene.background} onClick={() => onUpdate({ background: '' })}>
            <span>{t('novelview.panel.no_background')}</span>
          </button>
          {backgrounds.map((b) => (
            <button key={b.id} className={`vn-bg-tile ${scene.background === b.id ? 'selected' : ''}`} aria-pressed={scene.background === b.id} onClick={() => onUpdate({ background: b.id })} title={b.description || b.name}>
              <img src={b.url} alt="" loading="lazy" draggable={false} />
              <span>{b.name}</span>
            </button>
          ))}
        </div>
        {backgrounds.length === 0 && (
          <p className="muted vn-small">
            {t('novelview.panel.no_backgrounds')} <Link to="/catalog/fondos">{t('novelview.panel.open_backgrounds')}</Link>
          </p>
        )}
      </details>

      <details open className="vn-sec">
        <summary>{t('novelview.panel.characters')}</summary>
        {cast.length === 0 && <p className="muted vn-small">{t('novelview.panel.no_cast')}</p>}
        {cast.map((c) => {
          const on = activeSet.has(c.id);
          const outfit = scene.outfits?.[c.id] || c.defaultOutfit;
          return (
            <div key={c.id} className={`vn-cast-row ${on ? 'on' : ''}`}>
              <Avatar src={c.avatarUrl} name={c.name} size={40} />
              <strong className="vn-cast-name">{c.name}</strong>
              <label className="vn-switch" title={t('novelview.panel.on_stage')}>
                <input type="checkbox" checked={on} onChange={(e) => toggle(c.id, e.target.checked)} />
                <span>{t('novelview.panel.on_stage')}</span>
              </label>
              <div className="vn-cast-sub">
                {c.outfits?.length > 1 ? (
                  <select value={outfit} aria-label={t('novelview.panel.outfit_aria', { name: c.name })} onChange={(e) => onUpdate({ outfits: { ...(scene.outfits || {}), [c.id]: e.target.value } })}>
                    {c.outfits.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <small className="muted vn-cast-outfit">{c.outfits?.[0]?.name || t('novelview.panel.no_outfits')}</small>
                )}
                <Link className="btn small" to="/catalog/sprites" title={t('novelview.panel.sprites_hint', { name: c.name })}>
                  {t('novelview.panel.sprites')}
                </Link>
              </div>
            </div>
          );
        })}
        <button className="btn small vn-wide-btn" onClick={onEditWorld}>
          {t('novelview.panel.manage')}
        </button>
      </details>

      <details open className="vn-sec">
        <summary>{t('novelview.panel.stats')}</summary>
        {stats.length === 0 && <p className="muted vn-small">{t('novelview.panel.no_stats')}</p>}
        {worldStats.length > 0 && (
          <div className="vn-stat-group">
            <h4>{world.name}</h4>
            {worldStats.map((s) => (
              <StatBar key={s.id} stat={s} value={valueOf(s, null)} who={world.name} onCommit={(v) => onSetStat(null, s.id, v)} />
            ))}
          </div>
        )}
        {charStats.length > 0 &&
          onStage.map((c) => (
            <div key={c.id} className="vn-stat-group">
              <h4>
                <Avatar src={c.avatarUrl} name={c.name} size={22} /> {c.name}
              </h4>
              {charStats.map((s) => (
                <StatBar key={s.id} stat={s} value={valueOf(s, c.id)} who={c.name} onCommit={(v) => onSetStat(c.id, s.id, v)} />
              ))}
            </div>
          ))}
        {charStats.length > 0 && onStage.length === 0 && <p className="muted vn-small">{t('novelview.panel.stats_no_stage')}</p>}
      </details>

      <details className="vn-sec">
        <summary>{t('novelview.panel.world')}</summary>
        <h4>{world.name}</h4>
        <p className="vn-premise">{world.description || <span className="muted">{t('novelview.panel.no_premise')}</span>}</p>
        <dl className="vn-world-meta">
          <dt>{t('novelview.panel.persona')}</dt>
          <dd>{persona?.name || '—'}</dd>
          <dt>{t('novelview.panel.lorebooks')}</dt>
          <dd>{lorebooks?.length ? lorebooks.join(', ') : t('common.none')}</dd>
        </dl>
        <button className="btn small vn-wide-btn" onClick={onEditWorld}>
          {t('novelview.panel.edit_world')}
        </button>
      </details>
    </div>
  );
}
