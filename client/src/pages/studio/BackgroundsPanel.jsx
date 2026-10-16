import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { joinPrompts } from '../../../../shared/studio.js';
import { api } from '../../api.js';
import { AiButton } from '../../components/AiAssist.jsx';
import { Field, Lightbox, Menu } from '../../components/ui.jsx';
import { useData } from '../../data.jsx';
import { useDialog } from '../../dialogs.jsx';
import { useT } from '../../i18n.jsx';
import { useGeneration, useStudio } from './StudioContext.jsx';
import { CountStepper, GenerationBar, ImageCard, ResultGrid, SetupNotice, useLocalPref } from './ui.jsx';
import FinalPrompt from './gen/FinalPrompt.jsx';
import QuickSettings, { useQuickSettings } from './gen/QuickSettings.jsx';
import SaveBackgroundDialog from './gen/SaveBackgroundDialog.jsx';
import { countTags, downloadItem, fileSlug, itemSrc, roundTo64 } from './gen/helpers.js';
import '../../styles/studio-gen.css';

const RATIOS = [
  { id: '16:9', a: 16, b: 9 },
  { id: '3:2', a: 3, b: 2 },
  { id: '4:3', a: 4, b: 3 },
  { id: '1:1', a: 1, b: 1 },
  { id: '9:16', a: 9, b: 16 },
];

// Cada proporción conserva aproximadamente los píxeles totales del tamaño del perfil.
function ratioPresets(profile) {
  const area = profile.width * profile.height;
  return RATIOS.map(({ id, a, b }) => ({ id, w: roundTo64(Math.sqrt((area * a) / b)), h: roundTo64(Math.sqrt((area * b) / a)) }));
}

export default function BackgroundsPanel() {
  const { t } = useT();
  const { config, gallery, addImages, removeImage, clearGallery } = useStudio();
  const { toast } = useData();
  const { confirm } = useDialog();
  const navigate = useNavigate();
  const gen = useGeneration();
  const profile = config.profiles.background;
  const qs = useQuickSettings(profile);
  const presets = useMemo(() => ratioPresets(profile), [profile]);
  const [prompt, setPrompt] = useLocalPref('chatpuccino.studio.bg.prompt', '');
  const [extra, setExtra] = useLocalPref('chatpuccino.studio.bg.extra', '');
  const [place, setPlace] = useLocalPref('chatpuccino.studio.bg.place', { name: '', description: '' });
  const [view, setView] = useState(null);
  const [saving, setSaving] = useState(null);

  const items = gallery.background;
  const positive = joinPrompts(profile.prompt, prompt, extra);
  const negative = joinPrompts(profile.negative);
  const label = t('studio.backgrounds.prompt.label');
  const context = { name: place.name, description: place.description, style: profile.prompt };

  async function generate() {
    const userPrompt = joinPrompts(prompt, extra);
    const out = await gen.run((signal) => api.studioGenerate({ kind: 'background', prompt: userPrompt, overrides: qs.overrides }, signal));
    if (out?.images?.length) addImages('background', out.images.map((im) => ({ data: im.data, seed: im.seed, prompt: out.prompt, label: userPrompt })));
  }

  async function clearAll() {
    const ok = await confirm({ title: t('studio.backgrounds.results.clear_title'), message: t('studio.backgrounds.results.clear_message', { count: items.length }), confirmLabel: t('studio.backgrounds.results.clear'), danger: true });
    if (ok) clearGallery('background');
  }

  return (
    <div className="stack">
      {!config.configured && <SetupNotice onGoSettings={() => navigate('/catalog/estudio/config')} />}
      <p className="muted">{t('studio.backgrounds.intro')}</p>

      <section className="card stack">
        <h3>{t('studio.backgrounds.prompt.title')}</h3>
        <Field label={label} hint={t('studio.backgrounds.prompt.hint')} action={<AiButton field="sd_background" label={label} value={prompt} onApply={setPrompt} context={context} />}>
          <textarea rows={4} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder={t('studio.backgrounds.prompt.placeholder')} />
        </Field>
        <p className="field-hint sg-count">{t('studio.backgrounds.prompt.count', { count: countTags(prompt) })}</p>
        <details className="sg-place">
          <summary>{t('studio.backgrounds.place.title')}</summary>
          <p className="field-hint">{t('studio.backgrounds.place.hint')}</p>
          <Field label={t('studio.backgrounds.place.name')}>
            <input value={place.name} onChange={(e) => setPlace({ ...place, name: e.target.value })} maxLength={80} placeholder={t('studio.backgrounds.place.name_placeholder')} />
          </Field>
          <Field label={t('studio.backgrounds.place.description')}>
            <textarea rows={3} value={place.description} onChange={(e) => setPlace({ ...place, description: e.target.value })} placeholder={t('studio.backgrounds.place.description_placeholder')} />
          </Field>
        </details>
        <Field label={t('studio.backgrounds.extra.label')} hint={t('studio.backgrounds.extra.hint')}>
          <textarea rows={2} value={extra} onChange={(e) => setExtra(e.target.value)} placeholder={t('studio.backgrounds.extra.placeholder')} />
        </Field>
      </section>

      <section className="card stack">
        <h3>{t('studio.backgrounds.generate.title')}</h3>
        <QuickSettings qs={qs} presets={presets} />
        <FinalPrompt positive={positive} negative={negative} />
        <div className="btn-row gen-row">
          <CountStepper value={qs.value.batchCount} onChange={(v) => qs.set({ batchCount: v })} disabled={gen.running} />
          <button className="btn primary" onClick={generate} disabled={gen.running || !joinPrompts(prompt, extra)}>
            {gen.running ? t('studio.common.generating') : t('studio.backgrounds.generate.run', { count: qs.value.batchCount })}
          </button>
        </div>
        {!joinPrompts(prompt, extra) && <p className="field-hint">{t('studio.backgrounds.generate.need_prompt')}</p>}
        <GenerationBar gen={gen} />
      </section>

      <section className="card stack">
        <div className="btn-row">
          <h3 className="grow">{t('studio.backgrounds.results.title')}</h3>
          {items.length > 0 && (
            <button className="btn small danger" onClick={clearAll}>
              {t('studio.backgrounds.results.clear')}
            </button>
          )}
        </div>
        {!items.length ? (
          <p className="muted">{t('studio.backgrounds.results.empty')}</p>
        ) : (
          <ResultGrid wide>
            {items.map((item) => (
              <ImageCard key={item.id} item={item} onOpen={() => setView(item)}>
                <button className="btn small primary" onClick={() => setSaving(item)}>
                  {t('studio.backgrounds.actions.save')}
                </button>
                <Menu
                  label={t('studio.backgrounds.actions.more')}
                  items={[
                    { label: t('studio.backgrounds.actions.download'), onClick: () => downloadItem(item, `${fileSlug(item.label, 'background')}-${item.seed ?? item.id}.png`) },
                    { separator: true },
                    { label: t('studio.backgrounds.actions.discard'), danger: true, onClick: () => removeImage('background', item.id) },
                  ]}
                />
              </ImageCard>
            ))}
          </ResultGrid>
        )}
      </section>

      {view && <Lightbox src={itemSrc(view)} name={view.seed != null ? t('studio.backgrounds.results.caption', { seed: view.seed }) : t('studio.backgrounds.results.title')} onClose={() => setView(null)} />}
      {saving && <SaveBackgroundDialog item={saving} onClose={() => setSaving(null)} onSaved={() => toast(t('studio.backgrounds.save.saved'))} />}
    </div>
  );
}
