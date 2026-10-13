import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api.js';
import { useData } from '../../data.jsx';
import { useDialog } from '../../dialogs.jsx';
import { useFileDrop } from '../../useFileDrop.js';
import { Icon } from '../../components/Icon.jsx';
import { CharAvatar, Field, Lightbox, SearchBox } from '../../components/ui.jsx';
import { useT } from '../../i18n.jsx';
import { DEFAULT_EXPRESSIONS } from '../../../../shared/vn.js';

const LS_KEY = 'chatpuccino.vn.spriteChar';
const LABEL_RE = /^[a-z0-9_-]{1,32}$/;
const isImage = (f) => f.type.startsWith('image/') || /\.(png|jpe?g|webp|gif|avif)$/i.test(f.name);

const readStored = () => {
  try {
    return localStorage.getItem(LS_KEY) || '';
  } catch {
    return '';
  }
};
const storeChoice = (id) => {
  try {
    localStorage.setItem(LS_KEY, id);
  } catch {
    /* sin almacenamiento local */
  }
};

export default function SpritesLibrary() {
  const { characters } = useData();
  const [charId, setCharId] = useState(readStored);
  const [picking, setPicking] = useState(false);
  const character = characters.find((c) => c.id === charId);

  if (!character || picking) {
    return (
      <CharacterPicker
        characters={characters}
        current={character?.id}
        onCancel={character ? () => setPicking(false) : null}
        onPick={(id) => {
          storeChoice(id);
          setCharId(id);
          setPicking(false);
        }}
      />
    );
  }
  return <SpriteEditor key={character.id} character={character} onChangeCharacter={() => setPicking(true)} />;
}

function CharacterPicker({ characters, current, onPick, onCancel }) {
  const { t } = useT();
  const [query, setQuery] = useState('');
  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return characters.filter((c) => !q || c.name.toLowerCase().includes(q));
  }, [characters, query]);
  return (
    <div className="stack">
      <p className="muted">{t('library.sprites.intro')}</p>
      <div className="btn-row">
        <h3 className="grow">{t('library.sprites.pick_title')}</h3>
        {onCancel && (
          <button className="btn small" onClick={onCancel}>
            {t('common.cancel')}
          </button>
        )}
      </div>
      {characters.length > 0 && <SearchBox value={query} onChange={setQuery} placeholder={t('library.sprites.search')} />}
      <div className="grid-cards">
        {list.map((c) => (
          <button key={c.id} className={`char-card ${c.id === current ? 'selected' : ''}`} onClick={() => onPick(c.id)}>
            <CharAvatar character={c} size={64} />
            <strong>{c.name}</strong>
          </button>
        ))}
      </div>
      {!list.length && (
        <div className="library-empty">
          <strong>{characters.length ? t('library.sprites.no_results') : t('library.sprites.no_characters')}</strong>
        </div>
      )}
    </div>
  );
}

function SpriteEditor({ character, onChangeCharacter }) {
  const { t } = useT();
  const [state, setState] = useState({ status: 'loading', data: null, error: '' });

  const reload = useCallback(async () => {
    try {
      const data = await api.sprites(character.id);
      setState({ status: 'ready', data, error: '' });
      return data;
    } catch (err) {
      setState((s) => (s.data ? { ...s, error: err.message } : { status: 'error', data: null, error: err.message }));
      throw err;
    }
  }, [character.id]);

  useEffect(() => {
    setState({ status: 'loading', data: null, error: '' });
    reload().catch(() => {});
  }, [reload]);

  const apply = useCallback((data) => setState({ status: 'ready', data, error: '' }), []);

  return (
    <div className="stack sprites-page">
      <div className="sprites-char">
        <CharAvatar character={character} size={48} />
        <strong className="grow">{character.name}</strong>
        <button className="btn small" onClick={onChangeCharacter}>
          {t('library.sprites.change_character')}
        </button>
      </div>
      {state.status === 'loading' && <p className="muted" role="status">{t('library.sprites.loading')}</p>}
      {state.status === 'error' && (
        <div className="library-empty">
          <strong className="err">{t('library.sprites.load_error')}</strong>
          <p className="muted">{state.error}</p>
          <button
            className="btn"
            onClick={() => {
              setState({ status: 'loading', data: null, error: '' });
              reload().catch(() => {});
            }}
          >
            {t('library.sprites.retry')}
          </button>
        </div>
      )}
      {state.status === 'ready' && <SpriteWorkspace character={character} data={state.data} reload={reload} apply={apply} />}
    </div>
  );
}

function SpriteWorkspace({ character, data, reload, apply }) {
  const { t } = useT();
  const { stats, toast } = useData();
  const { confirm, prompt } = useDialog();
  const { config, outfits } = data;
  const charId = character.id;

  const [outfitId, setOutfitId] = useState(config.defaultOutfit);
  const outfit = outfits.find((o) => o.id === outfitId) || outfits.find((o) => o.id === config.defaultOutfit) || outfits[0];
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null); // { done, total }
  const [bulkResult, setBulkResult] = useState(null);
  const [preview, setPreview] = useState(null);
  const [over, setOver] = useState(null);
  const slotInput = useRef(null);
  const bulkInput = useRef(null);
  const pickLabel = useRef('');
  const hoverLabel = useRef(null);
  const uploading = useRef(false);

  const defaults = DEFAULT_EXPRESSIONS;
  const customs = config.customExpressions || [];
  const slots = useMemo(() => {
    const known = new Set([...defaults, ...customs]);
    const extra = Object.keys(outfit?.expressions || {}).filter((l) => !known.has(l));
    return [
      ...defaults.map((label) => ({ label, kind: 'default' })),
      ...customs.filter((l) => !defaults.includes(l)).map((label) => ({ label, kind: 'custom' })),
      ...extra.map((label) => ({ label, kind: 'extra' })),
    ];
  }, [defaults, customs, outfit]);
  const filled = slots.filter((s) => outfit?.expressions?.[s.label]?.length).length;

  async function run(fn) {
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  // ---- Outfits
  const addOutfit = () =>
    prompt({ title: t('library.sprites.outfits.add_title'), label: t('library.sprites.outfits.name'), confirmLabel: t('library.sprites.outfits.add') }).then((name) => {
      if (name) {
        run(async () => {
          const created = await api.createOutfit(charId, name);
          await reload();
          if (created?.id) setOutfitId(created.id);
        });
      }
    });

  const renameOutfit = () =>
    prompt({ title: t('library.sprites.outfits.rename_title'), label: t('library.sprites.outfits.name'), defaultValue: outfit.name }).then((name) => {
      if (name && name !== outfit.name) run(async () => {
        await api.renameOutfit(charId, outfit.id, name);
        await reload();
      });
    });

  const removeOutfit = () =>
    confirm({
      title: t('library.sprites.outfits.delete_title'),
      message: t('library.sprites.outfits.delete_message', { name: outfit.name }),
      confirmLabel: t('common.delete'),
      danger: true,
    }).then((ok) => {
      if (ok) run(async () => {
        await api.deleteOutfit(charId, outfit.id);
        const fresh = await reload();
        setOutfitId(fresh.config.defaultOutfit);
      });
    });

  const makeDefault = () =>
    run(async () => {
      apply(await api.saveSprites(charId, { defaultOutfit: outfit.id }));
      toast(t('library.sprites.outfits.default_set'));
    });

  // ---- Subidas (sin recodificar: los sprites conservan su transparencia)
  async function uploadFiles(files, label) {
    if (uploading.current || !outfit) return null;
    const images = files.filter(isImage);
    const result = { ok: 0, failed: [], skipped: files.length - images.length };
    if (!images.length) return result;
    uploading.current = true;
    setProgress({ done: 0, total: images.length });
    for (const [i, file] of images.entries()) {
      try {
        await api.uploadSprite(charId, outfit.id, file, label);
        result.ok++;
      } catch (err) {
        result.failed.push(err.message);
      }
      setProgress({ done: i + 1, total: images.length });
    }
    uploading.current = false;
    setProgress(null);
    await reload().catch((err) => toast(err.message, 'error'));
    return result;
  }

  async function uploadToSlot(files, label) {
    const r = await uploadFiles(files, label);
    if (!r) return;
    if (r.ok) toast(t('library.sprites.upload_done', { count: r.ok, label }));
    r.failed.slice(0, 3).forEach((m) => toast(m, 'error'));
    if (r.skipped && !r.ok && !r.failed.length) toast(t('library.sprites.not_image'), 'error');
  }

  async function uploadBulk(files) {
    setBulkResult(null);
    const r = await uploadFiles(files, '');
    if (r) setBulkResult(r);
  }

  const dragging = useFileDrop((files) => {
    const label = hoverLabel.current;
    hoverLabel.current = null;
    setOver(null);
    if (label) uploadToSlot(files, label);
    else uploadBulk(files);
  }, !preview);

  useEffect(() => {
    if (!dragging) {
      hoverLabel.current = null;
      setOver(null);
    }
  }, [dragging]);

  function slotOver(e, label) {
    if (!Array.from(e.dataTransfer?.types || []).includes('Files')) return;
    hoverLabel.current = label;
    setOver((o) => (o === label ? o : label));
  }
  function slotLeave(e) {
    if (e.currentTarget.contains(e.relatedTarget)) return;
    hoverLabel.current = null;
    setOver(null);
  }

  function pickForSlot(label) {
    pickLabel.current = label;
    slotInput.current.click();
  }

  async function removeVariant(label, file) {
    const ok = await confirm({
      title: t('library.sprites.expressions.delete_title'),
      message: t('library.sprites.expressions.delete_message', { label }),
      confirmLabel: t('common.delete'),
      danger: true,
    });
    if (ok) run(async () => {
      await api.deleteSprite(charId, outfit.id, file);
      await reload();
    });
  }

  // ---- Ajustes del personaje
  const fallback = config.fallbackExpression || 'neutral';
  const fallbackOptions = useMemo(() => {
    const set = new Set(['neutral', fallback]);
    outfits.forEach((o) => Object.keys(o.expressions || {}).forEach((l) => set.add(l)));
    return [...set].sort();
  }, [outfits, fallback]);

  const [custom, setCustom] = useState('');
  const customError = custom && !LABEL_RE.test(custom) ? t('library.sprites.settings.custom_invalid') : custom && slots.some((s) => s.label === custom && s.kind !== 'extra') ? t('library.sprites.settings.custom_exists') : '';

  const saveConfig = (patch, message) =>
    run(async () => {
      apply(await api.saveSprites(charId, patch));
      if (message) toast(message);
    });

  const charStats = stats.filter((s) => s.scope === 'character');
  const [values, setValues] = useState(() => Object.fromEntries(Object.entries(config.stats || {}).map(([k, v]) => [k, String(v)])));
  const [statsError, setStatsError] = useState('');

  function saveStats() {
    const out = {};
    for (const s of charStats) {
      const raw = String(values[s.id] ?? '').trim();
      if (!raw) continue;
      const n = Number(raw);
      if (!Number.isFinite(n) || n < s.min || n > s.max) {
        setStatsError(t('library.sprites.stats.invalid', { name: s.name, min: s.min, max: s.max }));
        return;
      }
      out[s.id] = n;
    }
    setStatsError('');
    saveConfig({ stats: out }, t('library.sprites.stats.saved'));
  }

  return (
    <>
      {preview && <Lightbox src={preview.src} name={preview.name} onClose={() => setPreview(null)} />}
      <input
        ref={slotInput}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          const files = [...e.target.files];
          e.target.value = '';
          uploadToSlot(files, pickLabel.current);
        }}
      />
      <input
        ref={bulkInput}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          const files = [...e.target.files];
          e.target.value = '';
          uploadBulk(files);
        }}
      />

      <section className="card">
        <h3>{t('library.sprites.outfits.title')}</h3>
        <div className="chips wrap outfit-chips" role="group" aria-label={t('library.sprites.outfits.title')}>
          {outfits.map((o) => (
            <button key={o.id} className={`chip plain outfit-chip ${o.id === outfit.id ? 'on' : ''}`} aria-pressed={o.id === outfit.id} onClick={() => setOutfitId(o.id)}>
              {o.id === config.defaultOutfit && <Icon name="star" size={14} />}
              {o.name}
            </button>
          ))}
          <button className="chip plain outfit-chip add" onClick={addOutfit} disabled={busy} aria-label={t('library.sprites.outfits.add')} title={t('library.sprites.outfits.add')}>
            <Icon name="plus" size={16} /> {t('library.sprites.outfits.add')}
          </button>
        </div>
        <div className="btn-row">
          <button className="btn small" onClick={renameOutfit} disabled={busy}>
            <Icon name="edit" size={16} /> {t('library.sprites.outfits.rename')}
          </button>
          <button className="btn small" onClick={makeDefault} disabled={busy || outfit.id === config.defaultOutfit}>
            <Icon name="star" size={16} /> {outfit.id === config.defaultOutfit ? t('library.sprites.outfits.is_default') : t('library.sprites.outfits.make_default')}
          </button>
          <button className="btn small danger" onClick={removeOutfit} disabled={busy || outfits.length <= 1} title={outfits.length <= 1 ? t('library.sprites.outfits.delete_last') : undefined}>
            <Icon name="trash" size={16} /> {t('library.sprites.outfits.delete')}
          </button>
        </div>
        {outfits.length <= 1 && <p className="field-hint">{t('library.sprites.outfits.delete_last')}</p>}
      </section>

      <section className={`card ${dragging ? 'is-dragging' : ''}`}>
        <div className="expr-head">
          <h3 className="grow">{t('library.sprites.expressions.title', { outfit: outfit.name })}</h3>
          <span className="expr-progress-text" aria-live="polite">
            {t('library.sprites.expressions.progress', { done: filled, total: slots.length })}
          </span>
        </div>
        <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={slots.length} aria-valuenow={filled}>
          <span style={{ width: `${slots.length ? (filled / slots.length) * 100 : 0}%` }} />
        </div>
        <p className="field-hint">{t('library.sprites.expressions.hint')}</p>
        {progress && (
          <p className="muted" role="status">
            {t('library.sprites.uploading', { done: progress.done, total: progress.total })}
          </p>
        )}
        <div className="expr-grid">
          {slots.map(({ label, kind }) => {
            const variants = outfit.expressions?.[label] || [];
            const first = variants[0];
            const isFallback = label === fallback;
            return (
              <div
                key={label}
                className={`expr-slot ${variants.length ? 'filled' : ''} ${isFallback ? 'fallback' : ''} ${over === label ? 'over' : ''}`}
                onDragOver={(e) => slotOver(e, label)}
                onDragLeave={slotLeave}
              >
                <div className="expr-slot-head">
                  <strong className="expr-label" title={label}>{label}</strong>
                  <span className="spacer" />
                  <span className="expr-count" title={t('library.sprites.expressions.count', { count: variants.length })}>
                    {variants.length}
                  </span>
                </div>
                {(isFallback || kind !== 'default') && (
                  <div className="expr-tags">
                    {isFallback && (
                      <span className="tag fallback-tag">
                        <Icon name="star" size={11} /> {t('library.sprites.expressions.fallback_tag')}
                      </span>
                    )}
                    {kind === 'custom' && <span className="tag">{t('library.sprites.expressions.custom_tag')}</span>}
                    {kind === 'extra' && <span className="tag">{t('library.sprites.expressions.other_tag')}</span>}
                  </div>
                )}
                <button
                  className="expr-preview checker"
                  onClick={() => (first ? setPreview({ src: first.url, name: `${label} · ${outfit.name}` }) : pickForSlot(label))}
                  disabled={busy || Boolean(progress)}
                  aria-label={first ? t('library.sprites.expressions.preview_aria', { label }) : t('library.sprites.expressions.upload_aria', { label })}
                >
                  {first ? <img src={first.url} alt="" loading="lazy" /> : <Icon name="image" size={30} />}
                </button>
                {variants.length > 0 && (
                  <div className="expr-variants">
                    {variants.map((v, i) => (
                      <div key={v.file} className="expr-variant checker">
                        <button onClick={() => setPreview({ src: v.url, name: `${label} ${i + 1}/${variants.length} · ${outfit.name}` })} aria-label={t('library.sprites.expressions.preview_aria', { label })}>
                          <img src={v.url} alt="" loading="lazy" />
                        </button>
                        <button className="variant-del" onClick={() => removeVariant(label, v.file)} disabled={busy} aria-label={t('library.sprites.expressions.delete_variant_aria', { label, n: i + 1 })} title={t('common.delete')}>
                          <Icon name="close" size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <button className="btn small expr-upload" onClick={() => pickForSlot(label)} disabled={busy || Boolean(progress)}>
                  <Icon name="upload" size={16} /> {variants.length ? t('library.sprites.expressions.add_variant') : t('library.sprites.expressions.upload')}
                </button>
              </div>
            );
          })}
        </div>
      </section>

      <section className={`card bulk-zone ${dragging && !over ? 'over' : ''}`}>
        <h3>{t('library.sprites.bulk.title')}</h3>
        <p className="muted">{t('library.sprites.bulk.hint')}</p>
        <p className="field-hint">{t('library.sprites.bulk.target', { outfit: outfit.name })}</p>
        <div className="btn-row">
          <button className="btn" onClick={() => bulkInput.current.click()} disabled={busy || Boolean(progress)}>
            <Icon name="upload" size={18} />{' '}
            {progress ? t('library.sprites.uploading', { done: progress.done, total: progress.total }) : t('library.sprites.bulk.button')}
          </button>
          <span className="muted">{t('library.sprites.bulk.drop')}</span>
        </div>
        {bulkResult && (
          <div className="bulk-result" role="status">
            <strong>{t('library.sprites.bulk.result', { ok: bulkResult.ok, failed: bulkResult.failed.length })}</strong>
            {bulkResult.skipped > 0 && <p className="field-hint">{t('library.sprites.bulk.skipped', { count: bulkResult.skipped })}</p>}
            {bulkResult.failed.length > 0 && (
              <ul className="bulk-errors">
                {bulkResult.failed.map((m, i) => (
                  <li key={i} className="err">{m}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>

      <section className="card">
        <h3>{t('library.sprites.settings.title')}</h3>
        <Field label={t('library.sprites.settings.fallback')} hint={t('library.sprites.settings.fallback_hint')}>
          <select value={fallback} disabled={busy} onChange={(e) => saveConfig({ fallbackExpression: e.target.value }, t('library.sprites.settings.saved'))}>
            {fallbackOptions.map((l) => (
              <option key={l} value={l}>{l}</option>
            ))}
          </select>
        </Field>
        <Field label={t('library.sprites.settings.custom_title')} hint={t('library.sprites.settings.custom_hint')}>
          <div className="tag-new">
            <input
              value={custom}
              onChange={(e) => setCustom(e.target.value.toLowerCase().trim())}
              placeholder={t('library.sprites.settings.custom_placeholder')}
              autoCapitalize="none"
              autoComplete="off"
              maxLength={32}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && custom && !customError) {
                  e.preventDefault();
                  saveConfig({ customExpressions: [...customs, custom] }, t('library.sprites.settings.saved')).then(() => setCustom(''));
                }
              }}
            />
            <button
              className="btn"
              disabled={busy || !custom || Boolean(customError)}
              onClick={() => saveConfig({ customExpressions: [...customs, custom] }, t('library.sprites.settings.saved')).then(() => setCustom(''))}
            >
              <Icon name="plus" size={16} /> {t('library.sprites.settings.custom_add')}
            </button>
          </div>
        </Field>
        {customError && <span className="field-error" role="alert">{customError}</span>}
        {customs.length > 0 && (
          <div className="tag-list">
            {customs.map((l) => (
              <span key={l} className="tag-chip">
                {l}
                <button onClick={() => saveConfig({ customExpressions: customs.filter((x) => x !== l) }, t('library.sprites.settings.saved'))} disabled={busy} aria-label={t('library.sprites.settings.custom_remove_aria', { label: l })}>
                  <Icon name="close" size={14} />
                </button>
              </span>
            ))}
          </div>
        )}
      </section>

      <section className="card">
        <h3>{t('library.sprites.stats.title')}</h3>
        <p className="muted">{t('library.sprites.stats.hint')}</p>
        {charStats.length === 0 ? (
          <p className="field-hint">
            {t('library.sprites.stats.none')} <Link to="/novel/library/stats">{t('library.sprites.stats.none_link')}</Link>
          </p>
        ) : (
          <>
            <div className="stat-initials">
              {charStats.map((s) => (
                <Field key={s.id} label={`${s.name} (${s.min}–${s.max})`}>
                  <input
                    type="number"
                    inputMode="decimal"
                    step="any"
                    value={values[s.id] ?? ''}
                    placeholder={String(s.default)}
                    onChange={(e) => setValues((v) => ({ ...v, [s.id]: e.target.value }))}
                  />
                </Field>
              ))}
            </div>
            <p className="field-hint">{t('library.sprites.stats.empty_hint')}</p>
            {statsError && <span className="field-error" role="alert">{statsError}</span>}
            <div className="btn-row">
              <button className="btn primary" onClick={saveStats} disabled={busy}>
                {t('common.save')}
              </button>
            </div>
          </>
        )}
      </section>
    </>
  );
}
