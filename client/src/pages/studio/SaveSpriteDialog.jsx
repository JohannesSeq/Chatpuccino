import React, { useEffect, useMemo, useState } from 'react';
import { DEFAULT_EXPRESSIONS } from '../../../../shared/vn.js';
import { api } from '../../api.js';
import { Field, Modal } from '../../components/ui.jsx';
import { useT } from '../../i18n.jsx';
import { canvasToDataUrl, canvasToFile, hasTransparency, trimTransparent } from './imageTools.js';
import '../../styles/studio-gen.css';

const LABEL_RE = /^[a-z0-9_-]{1,32}$/;
const NEW_OUTFIT = '__new__';
const CUSTOM_LABEL = '__custom__';

/** Guarda un canvas como sprite (PNG) de un atuendo del personaje: nuevo o existente, con su etiqueta de expresión. */
export default function SaveSpriteDialog({ character, canvas, defaultLabel = 'neutral', onClose, onSaved }) {
  const { t } = useT();
  const [state, setState] = useState({ status: 'loading', data: null, error: '' });
  const [outfitId, setOutfitId] = useState('');
  const [newName, setNewName] = useState('');
  const [labelChoice, setLabelChoice] = useState(defaultLabel);
  const [custom, setCustom] = useState(defaultLabel);
  const [trim, setTrim] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    api
      .sprites(character.id)
      .then((data) => {
        if (!live) return;
        setState({ status: 'ready', data, error: '' });
        setOutfitId(data.config?.defaultOutfit || data.outfits[0]?.id || NEW_OUTFIT);
      })
      .catch((e) => live && setState({ status: 'error', data: null, error: e.message }));
    return () => {
      live = false;
    };
  }, [character.id]);

  const transparent = useMemo(() => hasTransparency(canvas), [canvas]);
  const final = useMemo(() => (trim && transparent ? trimTransparent(canvas) : canvas), [trim, transparent, canvas]);
  const preview = useMemo(() => canvasToDataUrl(final), [final]);

  const outfits = state.data?.outfits || [];
  const customs = state.data?.config?.customExpressions || [];
  const labels = useMemo(() => [...new Set([...DEFAULT_EXPRESSIONS, ...customs])], [customs]);
  const isCustom = labelChoice === CUSTOM_LABEL || !labels.includes(labelChoice);
  const label = isCustom ? custom.trim().toLowerCase() : labelChoice;
  const labelValid = LABEL_RE.test(label);
  const outfit = outfits.find((o) => o.id === outfitId);
  const existing = outfit?.expressions?.[label]?.length || 0;
  const creating = outfitId === NEW_OUTFIT;
  const canSave = state.status === 'ready' && labelValid && (!creating || newName.trim()) && !busy;

  async function save() {
    setBusy(true);
    setError('');
    try {
      let target = outfitId;
      if (creating) target = (await api.createOutfit(character.id, newName.trim())).id;
      const result = await api.uploadSprite(character.id, target, await canvasToFile(final, `${label}.png`), label);
      onSaved?.(result);
      onClose();
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }

  return (
    <Modal
      title={t('studio.characters.save_sprite.title', { name: character.name })}
      onClose={onClose}
      footer={
        <>
          <span className="spacer" />
          <button className="btn" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </button>
          <button className="btn primary" onClick={save} disabled={!canSave}>
            {busy ? t('studio.characters.save_sprite.saving') : t('studio.characters.save_sprite.save')}
          </button>
        </>
      }
    >
      <div className="sg-save">
        <div className="sg-save-preview checker">
          <img src={preview} alt={t('studio.characters.save_sprite.preview')} />
        </div>
        <div className="sg-save-form">
          {state.status === 'loading' && <p className="muted" role="status">{t('common.loading')}</p>}
          {state.status === 'error' && <p className="err">{state.error}</p>}
          {state.status === 'ready' && (
            <>
              <Field label={t('studio.characters.save_sprite.outfit')}>
                <select value={outfitId} onChange={(e) => setOutfitId(e.target.value)} disabled={busy}>
                  {outfits.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                  <option value={NEW_OUTFIT}>{t('studio.characters.save_sprite.new_outfit')}</option>
                </select>
              </Field>
              {creating && (
                <Field label={t('studio.characters.save_sprite.new_outfit_name')}>
                  <input value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={60} autoFocus disabled={busy} />
                </Field>
              )}
              <Field label={t('studio.characters.save_sprite.expression')}>
                <select value={isCustom ? CUSTOM_LABEL : labelChoice} onChange={(e) => setLabelChoice(e.target.value)} disabled={busy}>
                  {labels.map((l) => (
                    <option key={l} value={l}>
                      {l}
                      {!creating && outfit?.expressions?.[l]?.length ? ' ✓' : ''}
                    </option>
                  ))}
                  <option value={CUSTOM_LABEL}>{t('studio.characters.save_sprite.custom_label')}</option>
                </select>
              </Field>
              {isCustom && (
                <Field label={t('studio.characters.save_sprite.custom_label_input')} hint={t('studio.characters.save_sprite.custom_hint')}>
                  <input value={custom} onChange={(e) => setCustom(e.target.value)} maxLength={32} placeholder="happy-2" autoFocus disabled={busy} />
                </Field>
              )}
              {label && !labelValid && <p className="err">{t('studio.characters.save_sprite.invalid_label')}</p>}
              {labelValid && existing > 0 && !creating && <p className="sg-warn">{t('studio.characters.save_sprite.exists', { label, count: existing })}</p>}
              {transparent ? (
                <label className="check">
                  <input type="checkbox" checked={trim} onChange={(e) => setTrim(e.target.checked)} disabled={busy} />
                  <span>{t('studio.characters.save_sprite.trim')}</span>
                </label>
              ) : (
                <p className="field-hint">{t('studio.characters.save_sprite.opaque')}</p>
              )}
              <p className="field-hint">
                {final.width}×{final.height}px
              </p>
            </>
          )}
          {error && <p className="err" role="alert">{error}</p>}
        </div>
      </div>
    </Modal>
  );
}
