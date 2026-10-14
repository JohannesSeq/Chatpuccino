import React, { useCallback, useState } from 'react';
import { PARAM_RANGES } from '../../../../../shared/studio.js';
import { useT } from '../../../i18n.jsx';
import { SeedField, SliderField } from '../ui.jsx';

const KEYS = ['width', 'height', 'steps', 'cfg', 'batchCount', 'seed'];

/**
 * Ajustes rápidos solo para una tanda: valores del perfil + los cambios locales (`overrides`),
 * que son lo único que se envía al servidor (así los cambios posteriores del perfil siguen aplicándose al resto).
 */
export function useQuickSettings(profile) {
  const [overrides, setOverrides] = useState({});
  const value = {};
  for (const k of KEYS) value[k] = overrides[k] ?? profile[k];
  const set = useCallback(
    (patch) =>
      setOverrides((o) => {
        const next = { ...o, ...patch };
        for (const k of Object.keys(patch)) if (patch[k] === profile[k]) delete next[k];
        return next;
      }),
    [profile],
  );
  const reset = useCallback(() => setOverrides({}), []);
  return { value, overrides, set, reset, changed: Object.keys(overrides).length > 0 };
}

/** `presets`: [{ id, w, h }] (los textos son relaciones de aspecto o medidas, no necesitan traducción). */
export default function QuickSettings({ qs, presets = [] }) {
  const { t } = useT();
  const { value, set, reset, changed } = qs;
  return (
    <details className="sg-quick">
      <summary>
        {t('studio.characters.quick.title')}
        {changed && <span className="sg-dot" title={t('studio.characters.quick.modified')} aria-label={t('studio.characters.quick.modified')} />}
      </summary>
      <p className="field-hint">{t('studio.characters.quick.hint')}</p>
      {presets.length > 0 && (
        <div className="sg-presets" role="group" aria-label={t('studio.characters.quick.presets')}>
          {presets.map((p) => {
            const on = value.width === p.w && value.height === p.h;
            return (
              <button key={p.id} type="button" className={`sg-chip ${on ? 'on' : ''}`} aria-pressed={on} onClick={() => set({ width: p.w, height: p.h })}>
                {p.id}
                <small>
                  {p.w}×{p.h}
                </small>
              </button>
            );
          })}
          <button type="button" className="sg-chip" onClick={() => set({ width: value.height, height: value.width })} aria-label={t('studio.characters.quick.swap')} title={t('studio.characters.quick.swap')}>
            ↔
          </button>
        </div>
      )}
      <div className="studio-cols">
        <SliderField label={t('studio.characters.quick.width')} value={value.width} range={PARAM_RANGES.width} onChange={(v) => set({ width: v })} suffix="px" />
        <SliderField label={t('studio.characters.quick.height')} value={value.height} range={PARAM_RANGES.height} onChange={(v) => set({ height: v })} suffix="px" />
        <SliderField label={t('studio.characters.quick.steps')} value={value.steps} range={PARAM_RANGES.steps} onChange={(v) => set({ steps: v })} />
        <SliderField label={t('studio.characters.quick.cfg')} value={value.cfg} range={PARAM_RANGES.cfg} onChange={(v) => set({ cfg: v })} />
        <SliderField label={t('studio.characters.quick.batch')} value={value.batchCount} range={PARAM_RANGES.batchCount} onChange={(v) => set({ batchCount: v })} />
        <SeedField value={value.seed} onChange={(v) => set({ seed: v })} />
      </div>
      <div className="btn-row">
        <button type="button" className="btn small" onClick={reset} disabled={!changed}>
          {t('studio.characters.quick.reset')}
        </button>
      </div>
    </details>
  );
}
