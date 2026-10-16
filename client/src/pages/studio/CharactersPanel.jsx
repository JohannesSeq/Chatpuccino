import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { joinPrompts } from '../../../../shared/studio.js';
import { api } from '../../api.js';
import { Menu, Field, Lightbox } from '../../components/ui.jsx';
import { useData } from '../../data.jsx';
import { useDialog } from '../../dialogs.jsx';
import { useT } from '../../i18n.jsx';
import { useGeneration, useStudio } from './StudioContext.jsx';
import { CharacterGate, CountStepper, GenerationBar, ImageCard, ResultGrid, SetupNotice, useLocalPref } from './ui.jsx';
import { canvasToDataUrl, stripDataUrl } from './imageTools.js';
import CharacterPromptCard from './gen/CharacterPromptCard.jsx';
import FinalPrompt from './gen/FinalPrompt.jsx';
import QuickSettings, { useQuickSettings } from './gen/QuickSettings.jsx';
import { useCharacterStudio } from './gen/useCharacterStudio.js';
import { cardPngDataUrl, downloadItem, fileSlug, itemSrc, itemToCanvas } from './gen/helpers.js';
import RemoveBgDialog from './RemoveBgDialog.jsx';
import SaveSpriteDialog from './SaveSpriteDialog.jsx';
import '../../styles/studio-gen.css';

const SIZE_PRESETS = [
  { id: '1:1', w: 512, h: 512 },
  { id: '2:3', w: 512, h: 768 },
  { id: '3:2', w: 768, h: 512 },
  { id: 'XL 2:3', w: 832, h: 1216 },
  { id: 'XL 1:1', w: 1024, h: 1024 },
];

export default function CharactersPanel() {
  const { t } = useT();
  const { config } = useStudio();
  const navigate = useNavigate();
  return (
    <div className="stack">
      {!config.configured && <SetupNotice onGoSettings={() => navigate('/catalog/estudio/config')} />}
      <CharacterGate intro={t('studio.characters.intro')}>{(character) => <CharacterWorkspace key={character.id} character={character} />}</CharacterGate>
    </div>
  );
}

function CharacterWorkspace({ character }) {
  const { t } = useT();
  const { config, gallery, addImages, removeImage, clearGallery, setBase } = useStudio();
  const { toast, refresh } = useData();
  const { confirm } = useDialog();
  const gen = useGeneration();
  const profile = config.profiles.character;
  const cs = useCharacterStudio(character.id);
  const qs = useQuickSettings(profile);
  const [extra, setExtra] = useLocalPref(`chatpuccino.studio.extra.${character.id}`, '');
  const [view, setView] = useState(null);
  const [saveSprite, setSaveSprite] = useState(null);
  const [removeBg, setRemoveBg] = useState(null);
  const [busyId, setBusyId] = useState('');
  const [baseSet, setBaseSet] = useState(false);

  const items = gallery.character.filter((i) => i.charId === character.id);
  const positive = joinPrompts(profile.prompt, cs.prompt, extra);
  const negative = joinPrompts(profile.negative, cs.negative);
  const ready = cs.status.state === 'ready';

  async function generate() {
    setBaseSet(false);
    const out = await gen.run(async (signal) => {
      if (cs.dirty) await cs.save();
      return api.studioGenerate({ kind: 'character', characterId: character.id, prompt: extra, overrides: qs.overrides }, signal);
    });
    if (out?.images?.length) addImages('character', out.images.map((im) => ({ data: im.data, seed: im.seed, prompt: out.prompt, charId: character.id })));
  }

  async function openSaveSprite(item) {
    setBusyId(item.id);
    try {
      setSaveSprite({ item, canvas: await itemToCanvas(item) });
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusyId('');
    }
  }

  async function useAsCard(item) {
    const ok = await confirm({
      title: t('studio.characters.card_image.title'),
      message: t('studio.characters.card_image.message', { name: character.name }),
      confirmLabel: t('studio.characters.card_image.confirm'),
    });
    if (!ok) return;
    setBusyId(item.id);
    try {
      const image = await cardPngDataUrl(item);
      const { data } = await api.character(character.id);
      await api.updateCharacter(character.id, data, image);
      await refresh('characters');
      toast(t('studio.characters.card_image.done'));
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusyId('');
    }
  }

  function useAsBase(item) {
    setBase(character.id, { dataUrl: itemSrc(item), source: item.label === 'nobg' ? 'nobg' : 'generated' });
    setBaseSet(true);
    toast(t('studio.characters.base.done'));
  }

  const applyRemoveBg = (item, canvas) => {
    addImages('character', [{ data: stripDataUrl(canvasToDataUrl(canvas)), seed: item.seed, prompt: item.prompt, charId: character.id, label: 'nobg' }]);
    setRemoveBg(null);
  };

  async function clearAll() {
    const ok = await confirm({ title: t('studio.characters.results.clear_title'), message: t('studio.characters.results.clear_message', { count: items.length }), confirmLabel: t('studio.characters.results.clear'), danger: true });
    if (ok) clearGallery('character', (i) => i.charId === character.id);
  }

  return (
    <>
      <CharacterPromptCard character={character} cs={cs} style={profile.prompt} items={items} />

      <section className="card stack">
        <h3>{t('studio.characters.generate.title')}</h3>
        <Field label={t('studio.characters.generate.extra')} hint={t('studio.characters.generate.extra_hint')}>
          <textarea rows={2} value={extra} onChange={(e) => setExtra(e.target.value)} placeholder={t('studio.characters.generate.extra_placeholder')} />
        </Field>
        <QuickSettings qs={qs} presets={SIZE_PRESETS} />
        <FinalPrompt positive={positive} negative={negative} />
        {cs.dirty && <p className="field-hint">{t('studio.characters.generate.autosave')}</p>}
        <div className="btn-row gen-row">
          <CountStepper value={qs.value.batchCount} onChange={(v) => qs.set({ batchCount: v })} disabled={gen.running} />
          <button className="btn primary" onClick={generate} disabled={gen.running || !ready || !positive.trim()}>
            {gen.running ? t('studio.common.generating') : t('studio.characters.generate.run', { count: qs.value.batchCount })}
          </button>
        </div>
        <GenerationBar gen={gen} />
      </section>

      <section className="card stack">
        <div className="btn-row">
          <h3 className="grow">{t('studio.characters.results.title')}</h3>
          {items.length > 0 && (
            <button className="btn small danger" onClick={clearAll}>
              {t('studio.characters.results.clear')}
            </button>
          )}
        </div>
        {baseSet && (
          <p className="sg-notice" role="status">
            {t('studio.characters.base.notice')} <Link to="/catalog/estudio/expresiones">{t('studio.characters.base.go')}</Link>
          </p>
        )}
        {!items.length ? (
          <p className="muted">{t('studio.characters.results.empty')}</p>
        ) : (
          <ResultGrid>
            {items.map((item) => (
              <ImageCard key={item.id} item={item} onOpen={() => setView(item)} badge={item.label === 'nobg' ? t('studio.characters.results.badge_nobg') : null}>
                <button className="btn small primary" onClick={() => openSaveSprite(item)} disabled={busyId === item.id}>
                  {t('studio.characters.actions.save_sprite')}
                </button>
                <button className="btn small" onClick={() => useAsBase(item)}>
                  {t('studio.characters.actions.use_base')}
                </button>
                <Menu
                  label={t('studio.characters.actions.more')}
                  items={[
                    { label: t('studio.characters.actions.remove_bg'), onClick: () => setRemoveBg(item) },
                    { label: t('studio.characters.actions.use_card'), onClick: () => useAsCard(item) },
                    { label: t('studio.characters.actions.download'), onClick: () => downloadItem(item, `${fileSlug(character.name, 'character')}-${item.seed ?? item.id}.png`) },
                    { separator: true },
                    { label: t('studio.characters.actions.discard'), danger: true, onClick: () => removeImage('character', item.id) },
                  ]}
                />
              </ImageCard>
            ))}
          </ResultGrid>
        )}
      </section>

      {view && <Lightbox src={itemSrc(view)} name={view.seed != null ? t('studio.characters.results.caption', { seed: view.seed }) : character.name} onClose={() => setView(null)} />}
      {saveSprite && <SaveSpriteDialog character={character} canvas={saveSprite.canvas} onClose={() => setSaveSprite(null)} onSaved={() => toast(t('studio.characters.save_sprite.saved'))} />}
      {removeBg && <RemoveBgDialog source={itemSrc(removeBg)} title={t('studio.characters.actions.remove_bg')} onApply={(canvas) => applyRemoveBg(removeBg, canvas)} onClose={() => setRemoveBg(null)} />}
    </>
  );
}
