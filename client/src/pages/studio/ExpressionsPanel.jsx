import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, avatarUrl } from '../../api.js';
import { useData } from '../../data.jsx';
import { Lightbox } from '../../components/ui.jsx';
import { useT } from '../../i18n.jsx';
import { DEFAULT_EXPRESSIONS, DEFAULT_FACE_REGION, joinPrompts } from '../../../../shared/studio.js';
import { CharacterGate, GenerationBar, SetupNotice } from './ui.jsx';
import { useGeneration, useStudio } from './StudioContext.jsx';
import MaskEditor from './MaskEditor.jsx';
import BasePicker from './expr/BasePicker.jsx';
import ExpressionPicker from './expr/ExpressionPicker.jsx';
import QuickSettings from './expr/QuickSettings.jsx';
import ResultsView from './expr/ResultsView.jsx';
import {
  applyAlphaFrom,
  blobToDataUrl,
  buildMask,
  canvasToDataUrl,
  canvasToFile,
  dataUrl,
  flattenOnColor,
  hasTransparency,
  loadImage,
  maskHasContent,
  removeBackgroundByColor,
  srcToCanvas,
  stripDataUrl,
  toCanvas,
} from './imageTools.js';
import '../../styles/studio-expr.css';

const SD_MAX_SIDE = 1024;
// Los resultados guardados se recuerdan mientras dure la sesión (la galería también vive en memoria).
const savedIds = new Set();

const sameRegion = (a, b) => ['cx', 'cy', 'rx', 'ry'].every((k) => Math.abs((a?.[k] ?? 0) - (b?.[k] ?? 0)) < 0.0005);

export default function ExpressionsPanel() {
  const { t } = useT();
  return (
    <CharacterGate intro={t('studio.expressions.intro')}>{(character) => <Workspace key={character.id} character={character} />}</CharacterGate>
  );
}

function Workspace({ character }) {
  const { t } = useT();
  const navigate = useNavigate();
  const { toast } = useData();
  const { config, save, bases, setBase, gallery, addImages, removeImage, clearGallery } = useStudio();
  const gen = useGeneration();
  const profile = config.profiles.expression;
  const base = bases[character.id] || null;

  const [sprites, setSprites] = useState({ status: 'loading', data: null, error: '' });
  const [outfitId, setOutfitId] = useState('');
  const [region, setRegion] = useState(DEFAULT_FACE_REGION);
  const [savedRegion, setSavedRegion] = useState(DEFAULT_FACE_REGION);
  const [baseCanvas, setBaseCanvas] = useState(null);
  const [removeOnSave, setRemoveOnSave] = useState(true);
  const [removeMethod, setRemoveMethod] = useState('color');
  const [selected, setSelected] = useState(() => new Set());
  const [edits, setEdits] = useState({});
  const [extra, setExtra] = useState('');
  const initialSettings = useMemo(
    () => ({
      denoise: profile.inpaint.denoise,
      maskBlur: profile.inpaint.maskBlur,
      fill: profile.inpaint.fill,
      onlyMasked: profile.inpaint.onlyMasked,
      padding: profile.inpaint.padding,
      batchCount: Math.min(4, Math.max(1, profile.batchCount || 1)),
      seed: profile.seed ?? -1,
      flatten: '#ffffff',
    }),
    [profile],
  );
  const [settings, setSettings] = useState(initialSettings);
  const [batch, setBatch] = useState(null);
  const [localError, setLocalError] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(null);
  const [, bump] = useState(0);
  const strokesRef = useRef(null);

  const reloadSprites = useCallback(async () => {
    try {
      const data = await api.sprites(character.id);
      setSprites({ status: 'ready', data, error: '' });
      setOutfitId((cur) => (data.outfits.some((o) => o.id === cur) ? cur : data.outfits[0]?.id || ''));
      return data;
    } catch (e) {
      setSprites((s) => (s.data ? { ...s, error: e.message } : { status: 'error', data: null, error: e.message }));
      return null;
    }
  }, [character.id]);

  useEffect(() => {
    reloadSprites();
  }, [reloadSprites]);

  useEffect(() => {
    let alive = true;
    api
      .studioCharacter(character.id)
      .then((d) => {
        if (!alive || !d?.faceRegion) return;
        setRegion(d.faceRegion);
        setSavedRegion(d.faceRegion);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [character.id]);

  // sin base elegida se parte de la imagen de la tarjeta
  useEffect(() => {
    if (base) return;
    let alive = true;
    fetch(avatarUrl.character(character))
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(blobToDataUrl)
      .then((url) => alive && setBase(character.id, { dataUrl: url, source: 'card' }))
      .catch(() => {});
    return () => {
      alive = false;
    };
    // solo al abrir el panel
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let alive = true;
    if (!base?.dataUrl) {
      setBaseCanvas(null);
      return undefined;
    }
    srcToCanvas(base.dataUrl)
      .then((c) => alive && setBaseCanvas(c))
      .catch((e) => alive && setLocalError(e.message));
    return () => {
      alive = false;
    };
  }, [base?.dataUrl]);

  const work = useMemo(() => (baseCanvas ? toCanvas(baseCanvas, SD_MAX_SIDE) : null), [baseCanvas]);
  const transparent = useMemo(() => (work ? hasTransparency(work) : false), [work]);

  const outfit = sprites.data?.outfits.find((o) => o.id === outfitId) || null;
  const labels = useMemo(() => {
    const customs = (sprites.data?.config?.customExpressions || []).filter((l) => !DEFAULT_EXPRESSIONS.includes(l));
    return [...DEFAULT_EXPRESSIONS.map((label) => ({ label, kind: 'default' })), ...customs.map((label) => ({ label, kind: 'custom' }))];
  }, [sprites.data]);
  const order = useMemo(() => labels.map((l) => l.label), [labels]);
  const existing = useMemo(() => Object.fromEntries(Object.entries(outfit?.expressions || {}).map(([l, v]) => [l, v.length])), [outfit]);

  const items = gallery.expression.filter((i) => i.charId === character.id);
  const busy = gen.running || saving;
  const regionDirty = !sameRegion(region, savedRegion);

  const promptFor = (label) => joinPrompts(edits[label] ?? config.expressionPrompts?.[label] ?? label, extra);

  const removeLocal = (canvas) => removeBackgroundByColor(canvas, { tolerance: 30, feather: 1, contiguous: true });

  const stripBackground = async (canvas, signal) => {
    if (removeMethod !== 'ai') return removeLocal(canvas);
    try {
      const res = await api.studioRemoveBg({ image: stripDataUrl(canvasToDataUrl(canvas)) }, signal);
      return toCanvas(await loadImage(dataUrl(res.image)));
    } catch (e) {
      if (e.name === 'AbortError' || signal.aborted) throw e;
      setNote(t(e.code === 'STUDIO_NO_REMBG' ? 'studio.expressions.generate.rembg_fallback' : 'studio.expressions.generate.rembg_failed'));
      return removeLocal(canvas);
    }
  };

  const generate = async (list) => {
    if (!work || !list.length) return;
    setLocalError('');
    setNote('');
    const mask = buildMask(work.width, work.height, region, strokesRef.current);
    if (!maskHasContent(mask)) {
      setLocalError(t('studio.expressions.generate.no_mask'));
      return;
    }
    const imageUrl = canvasToDataUrl(transparent ? flattenOnColor(work, settings.flatten) : work);
    const maskUrl = canvasToDataUrl(mask);
    const finalize = async (b64, signal) => {
      let c = toCanvas(await loadImage(dataUrl(b64)));
      if (transparent) c = applyAlphaFrom(c, work);
      else if (removeOnSave) c = await stripBackground(c, signal);
      return stripDataUrl(canvasToDataUrl(c));
    };
    await gen.run(async (signal) => {
      for (let i = 0; i < list.length; i++) {
        if (signal.aborted) break;
        const label = list[i];
        setBatch({ index: i + 1, total: list.length, label });
        const res = await api.studioInpaint(
          {
            image: imageUrl,
            mask: maskUrl,
            width: work.width,
            height: work.height,
            characterId: character.id,
            expression: label,
            prompt: promptFor(label),
            overrides: {
              batchCount: settings.batchCount,
              seed: settings.seed,
              inpaint: { denoise: settings.denoise, maskBlur: settings.maskBlur, fill: settings.fill, onlyMasked: settings.onlyMasked, padding: settings.padding },
            },
          },
          signal,
        );
        const out = [];
        for (const im of res.images) out.push({ data: await finalize(im.data, signal), seed: im.seed, prompt: res.prompt, charId: character.id, label });
        addImages('expression', out);
      }
    });
    setBatch(null);
  };

  const uploadItem = async (item) => {
    const canvas = await srcToCanvas(dataUrl(item.data));
    await api.uploadSprite(character.id, outfitId, await canvasToFile(canvas, `${item.label}.png`), item.label);
    savedIds.add(item.id);
  };

  const saveItems = async (list) => {
    if (!outfitId || !list.length) return;
    setSaving(true);
    try {
      for (const it of list) await uploadItem(it);
      toast(t('studio.expressions.results.saved_toast', { count: list.length }));
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      await reloadSprites();
      bump((n) => n + 1);
      setSaving(false);
    }
  };

  const itemsOf = (label) => items.filter((i) => i.label === label);
  const saveFirst = (label) => saveItems(itemsOf(label).slice(0, 1));
  const saveAllFirst = () => {
    const firsts = [];
    for (const label of new Set(items.map((i) => i.label))) {
      const group = itemsOf(label);
      if (!group.some((i) => savedIds.has(i.id))) firsts.push(group[0]);
    }
    return saveItems(firsts);
  };

  const saveRegion = async () => {
    try {
      const d = await api.saveStudioCharacter(character.id, { faceRegion: region });
      setSavedRegion(d?.faceRegion || region);
      toast(t('studio.expressions.mask.saved'));
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  const saveDefault = async (label, text) => {
    try {
      await save({ expressionPrompts: { [label]: text } });
      setEdits((s) => {
        const { [label]: _gone, ...rest } = s;
        return rest;
      });
      toast(t('studio.expressions.pick.saved_default', { label }));
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  const editPrompt = (label, text) =>
    setEdits((s) => {
      if (text === undefined) {
        const { [label]: _gone, ...rest } = s;
        return rest;
      }
      return { ...s, [label]: text };
    });

  const count = selected.size;
  const orderedSelected = order.filter((l) => selected.has(l));
  const noOutfit = sprites.status === 'ready' && !outfit;

  return (
    <div className="stack expr">
      {!config.configured && <SetupNotice onGoSettings={() => navigate('/catalog/estudio/config')} />}

      <section className="card" aria-labelledby="expr-outfit">
        <h3 id="expr-outfit">{t('studio.expressions.outfit.title')}</h3>
        {sprites.status === 'loading' && <p className="muted" role="status">{t('common.loading')}</p>}
        {sprites.status === 'error' && (
          <div className="stack">
            <p className="err">{sprites.error}</p>
            <button className="btn small" onClick={reloadSprites}>
              {t('studio.expressions.retry')}
            </button>
          </div>
        )}
        {noOutfit && <p className="muted">{t('studio.expressions.outfit.none')}</p>}
        {outfit && (
          <>
            <label className="field">
              <span className="field-label">{t('studio.expressions.outfit.label')}</span>
              <select value={outfitId} onChange={(e) => setOutfitId(e.target.value)}>
                {sprites.data.outfits.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="expr-status" role="list" aria-label={t('studio.expressions.outfit.status')}>
              {labels.map(({ label }) => (
                <span key={label} role="listitem" className={`expr-pill ${existing[label] ? 'have' : ''}`}>
                  {existing[label] ? `✓ ${label}${existing[label] > 1 ? ` ×${existing[label]}` : ''}` : label}
                </span>
              ))}
            </div>
          </>
        )}
      </section>

      <section className="card" aria-labelledby="expr-base">
        <h3 id="expr-base">{t('studio.expressions.base.title')}</h3>
        <p className="muted">{t('studio.expressions.base.intro')}</p>
        <BasePicker
          character={character}
          outfit={outfit}
          base={base}
          baseCanvas={baseCanvas}
          transparent={transparent}
          onChange={(url, source) => setBase(character.id, { dataUrl: url, source })}
          removeOnSave={removeOnSave}
          setRemoveOnSave={setRemoveOnSave}
          removeMethod={removeMethod}
          setRemoveMethod={setRemoveMethod}
        />
      </section>

      <section className="card" aria-labelledby="expr-mask">
        <h3 id="expr-mask">{t('studio.expressions.mask.title')}</h3>
        <p className="muted">{t('studio.expressions.mask.intro')}</p>
        {work ? (
          <MaskEditor image={work} region={region} onRegionChange={setRegion} strokesRef={strokesRef} />
        ) : (
          <p className="muted">{t('studio.expressions.mask.need_base')}</p>
        )}
        <div className="btn-row">
          <button className="btn" onClick={saveRegion} disabled={!regionDirty}>
            {t('studio.expressions.mask.save_region')}
          </button>
          {regionDirty && <span className="field-hint">{t('studio.expressions.mask.unsaved')}</span>}
        </div>
      </section>

      <section className="card" aria-labelledby="expr-pick">
        <h3 id="expr-pick">{t('studio.expressions.pick.title')}</h3>
        <ExpressionPicker
          labels={labels}
          selected={selected}
          existing={existing}
          saved={config.expressionPrompts || {}}
          edits={edits}
          onToggle={(l) => setSelected((s) => {
            const n = new Set(s);
            if (n.has(l)) n.delete(l);
            else n.add(l);
            return n;
          })}
          onSelect={(list) => setSelected(new Set(list))}
          onEdit={editPrompt}
          onSaveDefault={saveDefault}
          extra={extra}
          onExtra={setExtra}
        />
        <details className="expr-quick">
          <summary>{t('studio.expressions.quick.title')}</summary>
          <QuickSettings value={settings} onChange={setSettings} onReset={() => setSettings(initialSettings)} />
        </details>
      </section>

      <section className="card" aria-labelledby="expr-gen">
        <h3 id="expr-gen">{t('studio.expressions.generate.title')}</h3>
        <div className="btn-row">
          <button className="btn primary" onClick={() => generate(orderedSelected)} disabled={busy || !work || !count || noOutfit}>
            {t('studio.expressions.generate.button', { count })}
          </button>
          {!count && <span className="field-hint">{t('studio.expressions.generate.none_selected')}</span>}
        </div>
        <GenerationBar gen={gen} label={batch ? t('studio.expressions.generate.progress', { index: batch.index, total: batch.total, label: batch.label }) : undefined} />
        {localError && <p className="err" role="alert">{localError}</p>}
        {note && <p className="field-hint">{note}</p>}
      </section>

      <section className="card" aria-labelledby="expr-results">
        <h3 id="expr-results">{t('studio.expressions.results.title')}</h3>
        <ResultsView
          order={order}
          items={items}
          savedIds={savedIds}
          busy={busy}
          canSave={!!outfit}
          onOpen={(it) => setOpen(it)}
          onSave={(it) => saveItems([it])}
          onRegenerate={(label) => generate([label])}
          onDiscard={(it) => removeImage('expression', it.id)}
          onSaveFirst={saveFirst}
          onSaveAllFirst={saveAllFirst}
          onClear={() => clearGallery('expression', (i) => i.charId === character.id)}
        />
      </section>

      {open && <Lightbox src={dataUrl(open.data)} name={open.label} onClose={() => setOpen(null)} />}
    </div>
  );
}
