import React from 'react';
import { FALLBACK_SAMPLERS, FALLBACK_SCHEDULERS, FALLBACK_UPSCALERS, INPAINT_FILLS, PARAM_RANGES, PROFILE_KINDS } from '../../../../../shared/studio.js';
import { useT } from '../../../i18n.jsx';
import { SeedField, SliderField } from '../ui.jsx';

const SIZE_PRESETS = [
  { w: 512, h: 512, key: 'square' },
  { w: 512, h: 768, key: 'portrait' },
  { w: 768, h: 512, key: 'landscape' },
  { w: 768, h: 448, key: 'wide' },
  { w: 832, h: 1216, key: 'tall_xl' },
  { w: 1024, h: 1024, key: 'square_xl' },
];

const withCurrent = (list, current) => (current && !list.includes(current) ? [current, ...list] : list);

function Select({ label, value, list, onChange, hint }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {withCurrent(list, value).map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

export function ProfilePicker({ kind, onChange, dirtyKinds }) {
  const { t } = useT();
  return (
    <div className="set-seg" role="radiogroup" aria-label={t('studio.settings.profile.pick')}>
      {PROFILE_KINDS.map((k) => (
        <button key={k} type="button" role="radio" aria-checked={kind === k} className={`btn ${kind === k ? 'primary' : ''}`} onClick={() => onChange(k)}>
          {t(`studio.settings.profile.kinds.${k}`)}
          {dirtyKinds.includes(k) && <i className="set-dot" aria-label={t('studio.settings.unsaved_short')} />}
        </button>
      ))}
    </div>
  );
}

export default function ProfileCard({ kind, onKindChange, dirtyKinds, value: p, onChange, options, onReset }) {
  const { t } = useT();
  const data = options.data;
  const set = (patch) => onChange(patch);
  const setHires = (patch) => onChange({ hires: { ...p.hires, ...patch } });
  const setInpaint = (patch) => onChange({ inpaint: { ...p.inpaint, ...patch } });
  const hiresOn = p.hires.enabled;
  const finalW = Math.round(p.width * p.hires.scale);
  const finalH = Math.round(p.height * p.hires.scale);

  return (
    <section className="card stack set-card" aria-labelledby="set-profile-title">
      <div>
        <h3 id="set-profile-title">{t('studio.settings.profile.title')}</h3>
        <p className="muted set-lead">{t('studio.settings.profile.intro')}</p>
      </div>
      <ProfilePicker kind={kind} onChange={onKindChange} dirtyKinds={dirtyKinds} />
      <p className="muted set-note">{t(`studio.settings.profile.about.${kind}`)}</p>

      <fieldset className="set-group">
        <legend>{t('studio.settings.profile.size')}</legend>
        <div className="set-presets" role="group" aria-label={t('studio.settings.profile.presets')}>
          {SIZE_PRESETS.map((s) => {
            const active = p.width === s.w && p.height === s.h;
            return (
              <button key={s.key} type="button" className={`btn small ${active ? 'primary' : ''}`} aria-pressed={active} onClick={() => set({ width: s.w, height: s.h })} title={t(`studio.settings.profile.preset.${s.key}`)}>
                {s.w}×{s.h}
              </button>
            );
          })}
          <button type="button" className="btn small" onClick={() => set({ width: p.height, height: p.width })} aria-label={t('studio.settings.profile.swap')} title={t('studio.settings.profile.swap')}>
            ↔
          </button>
        </div>
        <div className="set-cols">
          <SliderField label={t('studio.settings.profile.width')} value={p.width} onChange={(v) => set({ width: v })} range={PARAM_RANGES.width} suffix="px" />
          <SliderField label={t('studio.settings.profile.height')} value={p.height} onChange={(v) => set({ height: v })} range={PARAM_RANGES.height} suffix="px" />
        </div>
        <span className="field-hint">{t('studio.settings.profile.size_hint')}</span>
      </fieldset>

      <fieldset className="set-group">
        <legend>{t('studio.settings.profile.sampling')}</legend>
        <div className="set-cols">
          <SliderField label={t('studio.settings.profile.steps')} value={p.steps} onChange={(v) => set({ steps: v })} range={PARAM_RANGES.steps} hint={t('studio.settings.profile.steps_hint')} />
          <SliderField label={t('studio.settings.profile.cfg')} value={p.cfg} onChange={(v) => set({ cfg: v })} range={PARAM_RANGES.cfg} hint={t('studio.settings.profile.cfg_hint')} />
          <SliderField label={t('studio.settings.profile.batch')} value={p.batchCount} onChange={(v) => set({ batchCount: v })} range={PARAM_RANGES.batchCount} hint={t('studio.settings.profile.batch_hint')} />
          <SeedField value={p.seed} onChange={(v) => set({ seed: v })} hint={t('studio.settings.profile.seed_hint')} />
        </div>
        <div className="set-cols">
          <Select label={t('studio.settings.profile.sampler')} value={p.sampler} list={data?.samplers?.length ? data.samplers : FALLBACK_SAMPLERS} onChange={(v) => set({ sampler: v })} />
          <Select label={t('studio.settings.profile.scheduler')} value={p.scheduler} list={data?.schedulers?.length ? data.schedulers : FALLBACK_SCHEDULERS} onChange={(v) => set({ scheduler: v })} />
        </div>
        <label className="set-check">
          <input type="checkbox" checked={p.restoreFaces} onChange={(e) => set({ restoreFaces: e.target.checked })} />
          <span>
            {t('studio.settings.profile.restore_faces')}
            <small className="field-hint">{t('studio.settings.profile.restore_faces_hint')}</small>
          </span>
        </label>
      </fieldset>

      <fieldset className="set-group">
        <legend>{t('studio.settings.hires.title')}</legend>
        <label className="set-check">
          <input type="checkbox" checked={hiresOn} onChange={(e) => setHires({ enabled: e.target.checked })} />
          <span>
            {t('studio.settings.hires.enable')}
            <small className="field-hint">{t('studio.settings.hires.hint')}</small>
          </span>
        </label>
        <div className="set-cols">
          <SliderField label={t('studio.settings.hires.scale')} value={p.hires.scale} onChange={(v) => setHires({ scale: v })} range={PARAM_RANGES.hiresScale} disabled={!hiresOn} suffix="×" />
          <Select label={t('studio.settings.hires.upscaler')} value={p.hires.upscaler} list={data?.upscalers?.length ? data.upscalers : FALLBACK_UPSCALERS} onChange={(v) => setHires({ upscaler: v })} />
          <SliderField label={t('studio.settings.hires.steps')} value={p.hires.steps} onChange={(v) => setHires({ steps: v })} range={PARAM_RANGES.hiresSteps} disabled={!hiresOn} hint={t('studio.settings.hires.steps_hint')} />
          <SliderField label={t('studio.settings.hires.denoise')} value={p.hires.denoise} onChange={(v) => setHires({ denoise: v })} range={PARAM_RANGES.hiresDenoise} disabled={!hiresOn} hint={t('studio.settings.hires.denoise_hint')} />
        </div>
        <p className="set-final" aria-live="polite">
          {hiresOn ? t('studio.settings.hires.final', { from: `${p.width}×${p.height}`, to: `${finalW}×${finalH}` }) : t('studio.settings.hires.final_off', { size: `${p.width}×${p.height}` })}
        </p>
      </fieldset>

      {kind === 'expression' && p.inpaint && (
        <fieldset className="set-group">
          <legend>{t('studio.settings.inpaint.title')}</legend>
          <p className="muted set-note">{t('studio.settings.inpaint.intro')}</p>
          <div className="set-cols">
            <SliderField label={t('studio.settings.inpaint.denoise')} value={p.inpaint.denoise} onChange={(v) => setInpaint({ denoise: v })} range={PARAM_RANGES.denoise} hint={t('studio.settings.inpaint.denoise_hint')} />
            <SliderField label={t('studio.settings.inpaint.mask_blur')} value={p.inpaint.maskBlur} onChange={(v) => setInpaint({ maskBlur: v })} range={PARAM_RANGES.maskBlur} suffix="px" hint={t('studio.settings.inpaint.mask_blur_hint')} />
          </div>
          <div className="field">
            <label className="field">
              <span className="field-label">{t('studio.settings.inpaint.fill')}</span>
              <select value={p.inpaint.fill} onChange={(e) => setInpaint({ fill: e.target.value })}>
                {INPAINT_FILLS.map((f) => (
                  <option key={f} value={f}>
                    {t(`studio.settings.inpaint.fills.${f}`)}
                  </option>
                ))}
              </select>
            </label>
            <ul className="field-hint set-fill-list">
              {INPAINT_FILLS.map((f) => (
                <li key={f} className={f === p.inpaint.fill ? 'current' : ''}>
                  <strong>{t(`studio.settings.inpaint.fills.${f}`)}:</strong> {t(`studio.settings.inpaint.fill_hint.${f}`)}
                </li>
              ))}
            </ul>
          </div>
          <label className="set-check">
            <input type="checkbox" checked={p.inpaint.onlyMasked} onChange={(e) => setInpaint({ onlyMasked: e.target.checked })} />
            <span>
              {t('studio.settings.inpaint.only_masked')}
              <small className="field-hint">{t('studio.settings.inpaint.only_masked_hint')}</small>
            </span>
          </label>
          <SliderField label={t('studio.settings.inpaint.padding')} value={p.inpaint.padding} onChange={(v) => setInpaint({ padding: v })} range={PARAM_RANGES.padding} disabled={!p.inpaint.onlyMasked} suffix="px" hint={t('studio.settings.inpaint.padding_hint')} />
        </fieldset>
      )}

      <div className="btn-row">
        <button type="button" className="btn danger" onClick={onReset}>
          {t('studio.settings.profile.reset')}
        </button>
      </div>
    </section>
  );
}
