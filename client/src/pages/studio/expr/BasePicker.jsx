import React, { useMemo, useRef, useState } from 'react';
import { useT } from '../../../i18n.jsx';
import { avatarUrl } from '../../../api.js';
import CanvasView from './CanvasView.jsx';
import RemoveBgDialog from '../RemoveBgDialog.jsx';
import { blobToDataUrl, canvasToDataUrl } from '../imageTools.js';

const urlToDataUrl = async (url) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return blobToDataUrl(await res.blob());
};

/** Elige la imagen base (tarjeta, sprite del atuendo, archivo) y opciones sobre su fondo. */
export default function BasePicker({ character, outfit, base, baseCanvas, transparent, onChange, removeOnSave, setRemoveOnSave, removeMethod, setRemoveMethod }) {
  const { t } = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [showSprites, setShowSprites] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [showBg, setShowBg] = useState(false);
  const fileRef = useRef(null);

  const sprites = useMemo(
    () => Object.entries(outfit?.expressions || {}).flatMap(([label, list]) => list.map((s, i) => ({ label, n: i + 1, count: list.length, url: s.url, file: s.file }))),
    [outfit],
  );

  const load = async (fn, source) => {
    setBusy(true);
    setError('');
    try {
      onChange(await fn(), source);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const fromFile = (file) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError(t('studio.expressions.base.not_image'));
      return;
    }
    load(() => blobToDataUrl(file), 'upload');
  };

  const knownSource = ['card', 'sprite', 'upload', 'generated', 'nobg'].includes(base?.source);
  const sourceLabel = base ? t(`studio.expressions.base.source_${knownSource ? base.source : 'other'}`) : '';

  return (
    <div className="stack">
      <div className="tabs scroll expr-tabs" role="group" aria-label={t('studio.expressions.base.pick')}>
        <button type="button" className={base?.source === 'card' ? 'active' : ''} disabled={busy} onClick={() => load(() => urlToDataUrl(avatarUrl.character(character)), 'card')}>
          {t('studio.expressions.base.card')}
        </button>
        <button type="button" className={showSprites || base?.source === 'sprite' ? 'active' : ''} aria-expanded={showSprites} onClick={() => setShowSprites((s) => !s)}>
          {t('studio.expressions.base.sprite')}
        </button>
        <button type="button" className={base?.source === 'upload' ? 'active' : ''} disabled={busy} onClick={() => fileRef.current?.click()}>
          {t('studio.expressions.base.upload')}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            fromFile(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
      </div>

      {showSprites &&
        (sprites.length ? (
          <div className="expr-thumbs" role="list">
            {sprites.map((s) => (
              <button
                key={s.file}
                type="button"
                role="listitem"
                className="expr-thumb checker"
                disabled={busy}
                title={s.label}
                aria-label={t('studio.expressions.base.use_sprite', { label: s.label })}
                onClick={() => load(() => urlToDataUrl(s.url), 'sprite')}
              >
                <img src={s.url} alt="" loading="lazy" />
                <span>{s.count > 1 ? `${s.label} ${s.n}` : s.label}</span>
              </button>
            ))}
          </div>
        ) : (
          <p className="field-hint">{t('studio.expressions.base.no_sprites')}</p>
        ))}

      <div
        className={`expr-drop ${dragOver ? 'over' : ''}`}
        onDragOver={(e) => {
          if (Array.from(e.dataTransfer?.types || []).includes('Files')) {
            e.preventDefault();
            setDragOver(true);
          }
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          fromFile(e.dataTransfer.files?.[0]);
        }}
      >
        {baseCanvas ? (
          <div className="expr-base">
            <div className="expr-base-preview checker">
              <CanvasView canvas={baseCanvas} label={t('studio.expressions.base.preview_label')} />
            </div>
            <div className="expr-base-info">
              <span className="tag">{sourceLabel}</span>
              <span className="field-hint">{t('studio.expressions.base.size', { w: baseCanvas.width, h: baseCanvas.height })}</span>
              <button type="button" className="btn small" onClick={() => setShowBg(true)}>
                {t('studio.expressions.base.remove_bg')}
              </button>
            </div>
          </div>
        ) : (
          <p className="muted">{busy ? t('common.loading') : t('studio.expressions.base.empty')}</p>
        )}
        <p className="field-hint">{t('studio.expressions.base.drop_hint')}</p>
      </div>
      {error && <p className="err" role="alert">{error}</p>}

      {baseCanvas &&
        (transparent ? (
          <p className="field-hint">{t('studio.expressions.base.transparent_ok')}</p>
        ) : (
          <div className="expr-notice" role="note">
            <strong>{t('studio.expressions.base.opaque_title')}</strong>
            <p>{t('studio.expressions.base.opaque_text')}</p>
            <label className="expr-check">
              <input type="checkbox" checked={removeOnSave} onChange={(e) => setRemoveOnSave(e.target.checked)} />
              <span>{t('studio.expressions.base.remove_on_save')}</span>
            </label>
            {removeOnSave && (
              <label className="field">
                <span className="field-label">{t('studio.expressions.base.remove_method')}</span>
                <select value={removeMethod} onChange={(e) => setRemoveMethod(e.target.value)}>
                  <option value="color">{t('studio.expressions.base.method_color')}</option>
                  <option value="ai">{t('studio.expressions.base.method_ai')}</option>
                </select>
                <span className="field-hint">{t(`studio.expressions.base.method_${removeMethod}_hint`)}</span>
              </label>
            )}
          </div>
        ))}

      {showBg && base && (
        <RemoveBgDialog
          source={base.dataUrl}
          title={t('studio.expressions.base.remove_bg')}
          onClose={() => setShowBg(false)}
          onApply={(canvas) => {
            onChange(canvasToDataUrl(canvas), 'nobg');
            setShowBg(false);
          }}
        />
      )}
    </div>
  );
}
