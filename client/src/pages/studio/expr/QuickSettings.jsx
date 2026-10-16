import React from 'react';
import { useT } from '../../../i18n.jsx';
import { INPAINT_FILLS, PARAM_RANGES } from '../../../../../shared/studio.js';
import { SeedField, SliderField } from '../ui.jsx';

/** Ajustes rápidos del inpaint solo para esta tanda. */
export default function QuickSettings({ value, onChange, onReset }) {
  const { t } = useT();
  const set = (patch) => onChange({ ...value, ...patch });
  return (
    <div className="stack">
      <div className="studio-cols">
        <SliderField label={t('studio.expressions.quick.denoise')} value={value.denoise} onChange={(v) => set({ denoise: v })} range={PARAM_RANGES.denoise} hint={t('studio.expressions.quick.denoise_hint')} />
        <SliderField label={t('studio.expressions.quick.mask_blur')} value={value.maskBlur} onChange={(v) => set({ maskBlur: v })} range={PARAM_RANGES.maskBlur} suffix="px" />
        <SliderField label={t('studio.expressions.quick.batch')} value={value.batchCount} onChange={(v) => set({ batchCount: v })} range={[1, 8, 1]} hint={t('studio.expressions.quick.batch_hint')} />
        <SeedField value={value.seed} onChange={(v) => set({ seed: v })} />
      </div>
      <label className="field">
        <span className="field-label">{t('studio.expressions.quick.fill')}</span>
        <select value={value.fill} onChange={(e) => set({ fill: e.target.value })}>
          {INPAINT_FILLS.map((f) => (
            <option key={f} value={f}>
              {t(`studio.expressions.quick.fill_${f}`)}
            </option>
          ))}
        </select>
        <span className="field-hint">{t(`studio.expressions.quick.fill_${value.fill}_hint`)}</span>
      </label>
      <label className="expr-check">
        <input type="checkbox" checked={value.onlyMasked} onChange={(e) => set({ onlyMasked: e.target.checked })} />
        <span>
          {t('studio.expressions.quick.only_masked')}
          <small className="field-hint">{t('studio.expressions.quick.only_masked_hint')}</small>
        </span>
      </label>
      {value.onlyMasked && <SliderField label={t('studio.expressions.quick.padding')} value={value.padding} onChange={(v) => set({ padding: v })} range={PARAM_RANGES.padding} suffix="px" />}
      <label className="field">
        <span className="field-label">{t('studio.expressions.quick.flatten')}</span>
        <input type="color" className="expr-color" value={value.flatten} onChange={(e) => set({ flatten: e.target.value })} />
        <span className="field-hint">{t('studio.expressions.quick.flatten_hint')}</span>
      </label>
      <div className="btn-row">
        <button type="button" className="btn small" onClick={onReset}>
          {t('studio.expressions.quick.reset')}
        </button>
      </div>
    </div>
  );
}
