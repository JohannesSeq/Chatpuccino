import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../api.js';
import { Modal } from '../../components/ui.jsx';
import { useT } from '../../i18n.jsx';
import CanvasView from './expr/CanvasView.jsx';
import { SliderField } from './ui.jsx';
import { canvasToDataUrl, dataUrl, estimateBorderColor, hexToRgb, loadImage, removeBackgroundByColor, rgbToHex, srcToCanvas, stripDataUrl, toCanvas, trimTransparent } from './imageTools.js';
import '../../styles/studio-expr.css';

const PREVIEW_SIDE = 768;
const AI_SIDE = 2048;
export const REMBG_MODELS = ['isnet-anime', 'u2net', 'u2netp', 'u2net_human_seg', 'silueta', 'isnet-general-use'];

/** Quita el fondo de una imagen (data URL o canvas), por color (local) o con rembg en el servidor de Stable Diffusion. */
export default function RemoveBgDialog({ source, title, onApply, onClose }) {
  const { t } = useT();
  const [full, setFull] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [method, setMethod] = useState('color');
  const [view, setView] = useState('result');
  const [tolerance, setTolerance] = useState(30);
  const [feather, setFeather] = useState(1);
  const [contiguous, setContiguous] = useState(true);
  const [auto, setAuto] = useState(true);
  const [color, setColor] = useState('#ffffff');
  const [picking, setPicking] = useState(false);
  const [model, setModel] = useState(REMBG_MODELS[0]);
  const [trim, setTrim] = useState(false);
  const [preview, setPreview] = useState(null);
  const [ai, setAi] = useState({ busy: false, canvas: null, error: '', code: '' });
  const [applying, setApplying] = useState(false);
  const abortRef = useRef(null);

  useEffect(() => {
    let alive = true;
    setFull(null);
    setLoadError('');
    setPreview(null);
    setAi({ busy: false, canvas: null, error: '', code: '' });
    (async () => {
      try {
        const c = typeof source === 'string' ? await srcToCanvas(source) : toCanvas(source);
        if (alive) setFull(c);
      } catch (e) {
        if (alive) setLoadError(e.message);
      }
    })();
    return () => {
      alive = false;
    };
  }, [source]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const small = useMemo(() => (full ? toCanvas(full, PREVIEW_SIDE) : null), [full]);
  const autoColor = useMemo(() => (small ? estimateBorderColor(small) : [255, 255, 255]), [small]);
  const aiSmall = useMemo(() => (ai.canvas ? toCanvas(ai.canvas, PREVIEW_SIDE) : null), [ai.canvas]);
  const pickedColor = () => (auto ? null : hexToRgb(color) || [255, 255, 255]);

  useEffect(() => {
    if (!small || method !== 'color') return undefined;
    const timer = setTimeout(() => setPreview(removeBackgroundByColor(small, { color: auto ? null : hexToRgb(color) || [255, 255, 255], tolerance, feather, contiguous })), 120);
    return () => clearTimeout(timer);
  }, [small, method, auto, color, tolerance, feather, contiguous]);

  const pick = useCallback(
    (x, y) => {
      if (!picking || !small) return;
      const [r, g, b] = small.getContext('2d').getImageData(x, y, 1, 1).data;
      setColor(rgbToHex([r, g, b]));
      setAuto(false);
      setPicking(false);
    },
    [picking, small],
  );

  const runAi = async () => {
    if (!full) return;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setAi({ busy: true, canvas: null, error: '', code: '' });
    try {
      const body = { image: stripDataUrl(canvasToDataUrl(toCanvas(full, AI_SIDE))), model };
      const res = await api.studioRemoveBg(body, ac.signal);
      const img = await loadImage(dataUrl(res.image));
      if (!ac.signal.aborted) setAi({ busy: false, canvas: toCanvas(img), error: '', code: '' });
    } catch (e) {
      if (e.name !== 'AbortError') setAi({ busy: false, canvas: null, error: e.message, code: e.code || '' });
    }
  };

  const cancelAi = () => {
    abortRef.current?.abort();
    setAi((a) => ({ ...a, busy: false }));
  };

  const apply = async () => {
    if (!full) return;
    setApplying(true);
    try {
      // deja que el navegador pinte el estado «aplicando» antes del cálculo pesado
      await new Promise((r) => setTimeout(r, 30));
      let out = method === 'ai' ? ai.canvas : removeBackgroundByColor(full, { color: pickedColor(), tolerance, feather, contiguous });
      if (!out) return;
      if (trim) out = trimTransparent(out);
      onApply(out);
    } finally {
      setApplying(false);
    }
  };

  const noResult = method === 'ai' && !ai.canvas;
  const shown = view === 'original' ? small : method === 'color' ? preview || small : aiSmall || small;
  const canApply = !!full && !applying && (method === 'color' || !!ai.canvas);
  const swatch = auto ? rgbToHex(autoColor) : color;

  return (
    <Modal
      wide
      title={title || t('studio.removebg.title')}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className="btn primary" onClick={apply} disabled={!canApply}>
            {applying ? t('studio.removebg.applying') : t('studio.removebg.apply')}
          </button>
        </>
      }
    >
      {loadError ? (
        <p className="err">{t('studio.removebg.load_error', { error: loadError })}</p>
      ) : !full ? (
        <p className="muted">{t('common.loading')}</p>
      ) : (
        <div className="removebg">
          <div className="removebg-preview">
            <div className="tabs" role="radiogroup" aria-label={t('studio.removebg.view')}>
              {['result', 'original'].map((v) => (
                <button key={v} type="button" role="radio" aria-checked={view === v} className={view === v ? 'active' : ''} onClick={() => setView(v)}>
                  {t(`studio.removebg.view_${v}`)}
                </button>
              ))}
            </div>
            <div className="expr-stage checker">
              <CanvasView
                canvas={shown}
                picking={picking && method === 'color'}
                onPick={method === 'color' ? pick : undefined}
                label={t(view === 'original' || noResult ? 'studio.removebg.view_original' : 'studio.removebg.view_result')}
              />
            </div>
            {noResult && view === 'result' && <p className="field-hint">{t('studio.removebg.ai_first')}</p>}
            <p className="field-hint">{t('studio.removebg.size', { w: full.width, h: full.height })}</p>
          </div>

          <div className="removebg-controls">
            <div className="tabs" role="radiogroup" aria-label={t('studio.removebg.method')}>
              {['color', 'ai'].map((m) => (
                <button key={m} type="button" role="radio" aria-checked={method === m} className={method === m ? 'active' : ''} onClick={() => setMethod(m)}>
                  {t(`studio.removebg.method_${m}`)}
                </button>
              ))}
            </div>

            {method === 'color' ? (
              <div className="stack">
                <p className="field-hint">{t('studio.removebg.color_hint')}</p>
                <SliderField label={t('studio.removebg.tolerance')} value={tolerance} onChange={setTolerance} range={[0, 100, 1]} hint={t('studio.removebg.tolerance_hint')} />
                <SliderField label={t('studio.removebg.feather')} value={feather} onChange={setFeather} range={[0, 6, 1]} suffix="px" />
                <label className="expr-check">
                  <input type="checkbox" checked={contiguous} onChange={(e) => setContiguous(e.target.checked)} />
                  <span>
                    {t('studio.removebg.contiguous')}
                    <small className="field-hint">{t('studio.removebg.contiguous_hint')}</small>
                  </span>
                </label>
                <div className="field">
                  <span className="field-label">{t('studio.removebg.bg_color')}</span>
                  <div className="btn-row">
                    <label className="expr-check">
                      <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
                      <span>{t('studio.removebg.color_auto')}</span>
                    </label>
                    <input type="color" className="expr-color" value={swatch} disabled={auto} onChange={(e) => setColor(e.target.value)} aria-label={t('studio.removebg.bg_color')} />
                    <button type="button" className={`btn small ${picking ? 'primary' : ''}`} aria-pressed={picking} onClick={() => setPicking((p) => !p)}>
                      {t('studio.removebg.eyedropper')}
                    </button>
                  </div>
                  <span className="field-hint">{picking ? t('studio.removebg.eyedropper_active') : t('studio.removebg.eyedropper_hint')}</span>
                </div>
              </div>
            ) : (
              <div className="stack">
                <p className="field-hint">{t('studio.removebg.ai_hint')}</p>
                <label className="field">
                  <span className="field-label">{t('studio.removebg.ai_model')}</span>
                  <select value={model} onChange={(e) => setModel(e.target.value)} disabled={ai.busy}>
                    {REMBG_MODELS.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                  <span className="field-hint">{t('studio.removebg.ai_model_hint')}</span>
                </label>
                <div className="btn-row">
                  <button type="button" className="btn primary" onClick={runAi} disabled={ai.busy}>
                    {ai.busy ? t('studio.removebg.ai_running') : ai.canvas ? t('studio.removebg.ai_again') : t('studio.removebg.ai_run')}
                  </button>
                  {ai.busy && (
                    <button type="button" className="btn" onClick={cancelAi}>
                      {t('common.cancel')}
                    </button>
                  )}
                </div>
                {ai.canvas && !ai.busy && <p className="field-hint">{t('studio.removebg.ai_done')}</p>}
                {ai.error && ai.code === 'STUDIO_NO_REMBG' && (
                  <div className="expr-notice" role="alert">
                    <strong>{t('studio.removebg.no_rembg_title')}</strong>
                    <p>{t('studio.removebg.no_rembg_text')}</p>
                    <button type="button" className="btn small" onClick={() => setMethod('color')}>
                      {t('studio.removebg.use_local')}
                    </button>
                  </div>
                )}
                {ai.error && ai.code !== 'STUDIO_NO_REMBG' && (
                  <p className="err" role="alert">
                    {ai.error}
                  </p>
                )}
              </div>
            )}

            <label className="expr-check">
              <input type="checkbox" checked={trim} onChange={(e) => setTrim(e.target.checked)} />
              <span>
                {t('studio.removebg.trim')}
                <small className="field-hint">{t('studio.removebg.trim_hint')}</small>
              </span>
            </label>
          </div>
        </div>
      )}
    </Modal>
  );
}
