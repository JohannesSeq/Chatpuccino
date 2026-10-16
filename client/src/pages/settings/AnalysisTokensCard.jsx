import React, { useEffect, useState } from 'react';
import { api } from '../../api.js';
import { useData } from '../../data.jsx';
import { Field } from '../../components/ui.jsx';
import { useT } from '../../i18n.jsx';

// Mismos límites que server/settings.js (ANALYSIS_TOKENS).
const MIN = 100;
const MAX = 8000;
const STEP = 50;
const DEFAULT = 800;
const clamp = (n) => Math.min(MAX, Math.max(MIN, Math.round(n)));

// Modo Novela: tokens máximos de la consulta que evalúa las estadísticas de cada escena. Es un ajuste global (no del preset).
export default function AnalysisTokensCard() {
  const { t } = useT();
  const { settings, refresh, toast } = useData();
  const saved = settings?.analysisTokens ?? DEFAULT;
  const [value, setValue] = useState(saved);
  const [busy, setBusy] = useState(false);

  useEffect(() => setValue(saved), [saved]);

  const valid = Number.isFinite(Number(value)) && value !== '';
  const dirty = valid && clamp(Number(value)) !== saved;

  async function save() {
    setBusy(true);
    try {
      await api.saveSettings({ analysisTokens: clamp(Number(value)) });
      await refresh('settings');
      toast(t('presets.analysis.saved'));
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <h3>{t('presets.analysis.title')}</h3>
      <p className="muted">{t('presets.analysis.intro')}</p>
      <Field label={t('presets.analysis.label')} hint={t('presets.analysis.hint', { min: MIN, max: MAX, default: DEFAULT })}>
        <div className="analysis-row">
          <input type="range" min={MIN} max={MAX} step={STEP} value={valid ? clamp(Number(value)) : DEFAULT} onChange={(e) => setValue(Number(e.target.value))} aria-label={t('presets.analysis.label')} />
          <input type="number" inputMode="numeric" min={MIN} max={MAX} step={STEP} value={value} onChange={(e) => setValue(e.target.value)} aria-label={t('presets.analysis.label')} />
        </div>
      </Field>
      <div className="btn-row">
        <button className="btn primary" onClick={save} disabled={!dirty || busy}>
          {t('common.save')}
        </button>
        <button className="btn" onClick={() => setValue(DEFAULT)} disabled={busy || Number(value) === DEFAULT}>
          {t('presets.analysis.reset', { default: DEFAULT })}
        </button>
      </div>
    </section>
  );
}
