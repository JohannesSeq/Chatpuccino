import React, { useMemo, useState } from 'react';
import { PARAM_RANGES } from '../../../../../shared/studio.js';
import { useT } from '../../../i18n.jsx';
import { SliderField } from '../ui.jsx';

export default function ModelCard({ value, onChange, favorites, options, onReload, onToggleFavorite, onAddManual }) {
  const { t } = useT();
  const [manual, setManual] = useState('');
  const [busy, setBusy] = useState(false);
  const data = options.data;
  const loading = options.status === 'loading';
  const failed = options.status === 'error';

  const groups = useMemo(() => {
    const listed = data?.models || [];
    const favs = [...favorites];
    const rest = listed.filter((m) => !favorites.includes(m));
    const known = new Set([...favs, ...rest]);
    return { favs, rest, orphan: value.checkpoint && !known.has(value.checkpoint) ? value.checkpoint : '' };
  }, [data, favorites, value.checkpoint]);

  const vaes = useMemo(() => {
    const list = data?.vaes || [];
    return value.vae && !list.includes(value.vae) ? [value.vae, ...list] : list;
  }, [data, value.vae]);

  const isFav = Boolean(value.checkpoint) && favorites.includes(value.checkpoint);

  const guarded = async (fn) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  const addManual = () => {
    const name = manual.trim();
    if (!name) return;
    guarded(async () => {
      await onAddManual(name);
      setManual('');
    });
  };

  return (
    <section className="card stack set-card" aria-labelledby="set-model-title">
      <div>
        <h3 id="set-model-title">{t('studio.settings.model.title')}</h3>
        <p className="muted set-lead">{t('studio.settings.model.intro')}</p>
      </div>

      {failed && (
        <div className="set-alert" role="alert">
          <p className="err">{t('studio.settings.model.load_error', { error: options.error })}</p>
          <p className="muted">{t('studio.settings.model.load_error_hint')}</p>
        </div>
      )}

      <div className="field">
        <label className="field">
          <span className="field-label">{t('studio.settings.model.checkpoint')}</span>
          <span className="set-row">
            <select className="grow" value={value.checkpoint} onChange={(e) => onChange({ checkpoint: e.target.value })} disabled={loading}>
              <option value="">{data?.current ? t('studio.settings.model.server_current', { name: data.current }) : t('studio.settings.model.server_default')}</option>
              {groups.orphan && <option value={groups.orphan}>{groups.orphan}</option>}
              {groups.favs.length > 0 && (
                <optgroup label={`★ ${t('studio.settings.model.favorites')}`}>
                  {groups.favs.map((m) => (
                    <option key={m} value={m}>
                      ★ {m}
                    </option>
                  ))}
                </optgroup>
              )}
              {groups.rest.length > 0 && (
                <optgroup label={t('studio.settings.model.all_models')}>
                  {groups.rest.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
            <button type="button" className={`btn icon-btn ${isFav ? 'primary' : ''}`} disabled={!value.checkpoint || busy} aria-pressed={isFav} aria-label={isFav ? t('studio.settings.model.unfavorite') : t('studio.settings.model.favorite')} title={isFav ? t('studio.settings.model.unfavorite') : t('studio.settings.model.favorite')} onClick={() => guarded(() => onToggleFavorite(value.checkpoint))}>
              {isFav ? '★' : '☆'}
            </button>
            <button type="button" className="btn icon-btn" onClick={onReload} disabled={loading} aria-label={t('studio.settings.model.reload')} title={t('studio.settings.model.reload')}>
              ↻
            </button>
          </span>
        </label>
        <span className="field-hint" role="status">
          {loading ? t('common.loading') : data ? t('studio.settings.model.count', { count: data.models.length }) : ''}
        </span>
      </div>

      {favorites.length > 0 && (
        <div className="set-chips" role="group" aria-label={t('studio.settings.model.favorites')}>
          {favorites.map((m) => (
            <span key={m} className={`set-chip ${m === value.checkpoint ? 'active' : ''}`}>
              <button type="button" className="set-chip-main" onClick={() => onChange({ checkpoint: m })} title={m}>
                ★ {m}
              </button>
              <button type="button" className="set-chip-x" aria-label={`${t('studio.settings.model.unfavorite')}: ${m}`} onClick={() => guarded(() => onToggleFavorite(m))} disabled={busy}>
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="field">
        <label className="field">
          <span className="field-label">{t('studio.settings.model.manual')}</span>
          <span className="set-row">
            <input
              className="grow"
              type="text"
              value={manual}
              spellCheck={false}
              placeholder={t('studio.settings.model.manual_placeholder')}
              onChange={(e) => setManual(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addManual();
                }
              }}
            />
            <button type="button" className="btn icon-btn" onClick={addManual} disabled={!manual.trim() || busy} aria-label={t('studio.settings.model.manual_add')} title={t('studio.settings.model.manual_add')}>
              +
            </button>
          </span>
        </label>
        <span className="field-hint">{t('studio.settings.model.manual_hint')}</span>
      </div>

      <div className="set-cols">
        <div className="field">
          <label className="field">
            <span className="field-label">{t('studio.settings.model.vae')}</span>
            <select value={value.vae} onChange={(e) => onChange({ vae: e.target.value })}>
              <option value="">{t('studio.settings.model.vae_auto')}</option>
              {vaes.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </label>
        </div>
        <SliderField label={t('studio.settings.model.clip_skip')} value={value.clipSkip} onChange={(v) => onChange({ clipSkip: v })} range={PARAM_RANGES.clipSkip} hint={t('studio.settings.model.clip_skip_hint')} />
      </div>
    </section>
  );
}
