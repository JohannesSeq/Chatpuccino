import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useT } from '../../i18n.jsx';
import { DEFAULT_FACE_REGION } from '../../../../shared/studio.js';
import CanvasView from './expr/CanvasView.jsx';
import { SliderField } from './ui.jsx';
import { buildMask } from './imageTools.js';
import '../../styles/studio-expr.css';

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
const round3 = (v) => Math.round(v * 1000) / 1000;

/**
 * Editor de la máscara de inpaint: elipse de la cara (sliders + arrastre) más trazos con pincel/goma.
 * `image` = canvas base; `region` = {cx,cy,rx,ry}; `strokesRef.current` queda con un canvas del tamaño de `image`
 * (blanco = añadir, rojo = quitar) listo para `buildMask(w, h, region, strokesRef.current)`.
 */
export default function MaskEditor({ image, region, onRegionChange, strokesRef, defaultRegion = DEFAULT_FACE_REGION }) {
  const { t } = useT();
  const [tool, setTool] = useState('move');
  const [brush, setBrush] = useState(40);
  const [rev, setRev] = useState(0);
  const [cursor, setCursor] = useState(null);
  const stageRef = useRef(null);
  const overlayRef = useRef(null);
  const frame = useRef(0);
  const drag = useRef(null);
  const paint = useRef(null);
  const w = image?.width || 1;
  const h = image?.height || 1;

  // los trazos viven en un canvas del tamaño de la imagen y se reinician si esta cambia de tamaño
  useEffect(() => {
    if (!image) return;
    const cur = strokesRef.current;
    if (!cur || cur.width !== image.width || cur.height !== image.height) {
      const c = document.createElement('canvas');
      c.width = image.width;
      c.height = image.height;
      strokesRef.current = c;
      setRev((r) => r + 1);
    }
  }, [image, strokesRef]);

  useEffect(() => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      const el = overlayRef.current;
      if (!el || !image) return;
      el.width = image.width;
      el.height = image.height;
      const mask = buildMask(image.width, image.height, region, strokesRef.current);
      const src = mask.getContext('2d').getImageData(0, 0, mask.width, mask.height);
      const out = el.getContext('2d').createImageData(mask.width, mask.height);
      for (let i = 0; i < src.data.length; i += 4) {
        if (src.data[i] > 127) {
          out.data[i] = 255;
          out.data[i + 1] = 60;
          out.data[i + 2] = 80;
          out.data[i + 3] = 120;
        }
      }
      el.getContext('2d').putImageData(out, 0, 0);
    });
    return () => cancelAnimationFrame(frame.current);
  }, [image, region, rev, strokesRef]);

  const toImage = useCallback(
    (e) => {
      const rect = stageRef.current.getBoundingClientRect();
      return { x: ((e.clientX - rect.left) / rect.width) * w, y: ((e.clientY - rect.top) / rect.height) * h, k: rect.width / w };
    },
    [w, h],
  );

  const setField = (key, pct) => onRegionChange({ ...region, [key]: round3(pct / 100) });

  // arrastrar la elipse
  const startDrag = (e) => {
    if (tool !== 'move') return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, region };
  };
  const moveDrag = (e) => {
    const d = drag.current;
    if (!d) return;
    const rect = stageRef.current.getBoundingClientRect();
    onRegionChange({
      ...d.region,
      cx: round3(clamp(d.region.cx + (e.clientX - d.x) / rect.width, 0, 1)),
      cy: round3(clamp(d.region.cy + (e.clientY - d.y) / rect.height, 0, 1)),
    });
  };
  const endDrag = () => {
    drag.current = null;
  };

  // pincel y goma
  const stroke = (from, to, color) => {
    const ctx = strokesRef.current.getContext('2d');
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = brush;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(to.x, to.y, brush / 2, 0, Math.PI * 2);
    ctx.fill();
  };
  const startPaint = (e) => {
    if (tool === 'move' || !strokesRef.current) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = toImage(e);
    paint.current = { last: p, color: tool === 'add' ? '#ffffff' : '#ff0000' };
    stroke(p, p, paint.current.color);
    setRev((r) => r + 1);
  };
  const movePaint = (e) => {
    if (tool !== 'move') {
      const rect = stageRef.current.getBoundingClientRect();
      setCursor({ x: e.clientX - rect.left, y: e.clientY - rect.top, size: (brush * rect.width) / w });
    }
    const s = paint.current;
    if (!s) return;
    const p = toImage(e);
    stroke(s.last, p, s.color);
    s.last = p;
    setRev((r) => r + 1);
  };
  const endPaint = () => {
    paint.current = null;
  };

  const clearStrokes = () => {
    const c = strokesRef.current;
    if (c) c.getContext('2d').clearRect(0, 0, c.width, c.height);
    setRev((r) => r + 1);
  };

  const painting = tool !== 'move';
  const stageStyle = { '--ar': w / h };
  const pct = (v) => Math.round(v * 100);

  return (
    <div className="mask-editor">
      <div className="mask-stage-wrap">
        <div
          ref={stageRef}
          className={`mask-stage checker ${painting ? 'painting' : ''}`}
          style={stageStyle}
          onPointerDown={startPaint}
          onPointerMove={movePaint}
          onPointerUp={endPaint}
          onPointerCancel={endPaint}
          onPointerLeave={() => setCursor(null)}
        >
          <CanvasView canvas={image} className="mask-base" label={t('studio.expressions.mask.image_label')} />
          <canvas ref={overlayRef} className="expr-canvas mask-overlay" aria-hidden="true" />
          <div
            className={`mask-ellipse ${tool === 'move' ? 'movable' : ''}`}
            aria-hidden="true"
            style={{
              left: `${(region.cx - region.rx) * 100}%`,
              top: `${(region.cy - region.ry) * 100}%`,
              width: `${region.rx * 200}%`,
              height: `${region.ry * 200}%`,
            }}
            onPointerDown={startDrag}
            onPointerMove={moveDrag}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          />
          {painting && cursor && (
            <span
              className="mask-cursor"
              aria-hidden="true"
              style={{ left: cursor.x, top: cursor.y, width: cursor.size, height: cursor.size }}
            />
          )}
        </div>
        <p className="field-hint">{t('studio.expressions.mask.legend')}</p>
      </div>

      <div className="mask-controls">
        <div className="tabs" role="radiogroup" aria-label={t('studio.expressions.mask.tool')}>
          {['move', 'add', 'remove'].map((id) => (
            <button key={id} type="button" role="radio" aria-checked={tool === id} className={tool === id ? 'active' : ''} onClick={() => setTool(id)}>
              {t(`studio.expressions.mask.tool_${id}`)}
            </button>
          ))}
        </div>
        <p className="field-hint">{t(`studio.expressions.mask.tool_${tool}_hint`)}</p>
        <SliderField label={t('studio.expressions.mask.brush')} value={brush} onChange={setBrush} range={[4, 200, 1]} suffix="px" disabled={!painting} />
        <div className="studio-cols">
          <SliderField label={t('studio.expressions.mask.cx')} value={pct(region.cx)} onChange={(v) => setField('cx', v)} range={[0, 100, 1]} suffix="%" />
          <SliderField label={t('studio.expressions.mask.cy')} value={pct(region.cy)} onChange={(v) => setField('cy', v)} range={[0, 100, 1]} suffix="%" />
          <SliderField label={t('studio.expressions.mask.rx')} value={pct(region.rx)} onChange={(v) => setField('rx', v)} range={[1, 100, 1]} suffix="%" />
          <SliderField label={t('studio.expressions.mask.ry')} value={pct(region.ry)} onChange={(v) => setField('ry', v)} range={[1, 100, 1]} suffix="%" />
        </div>
        <div className="btn-row">
          <button type="button" className="btn small" onClick={() => onRegionChange({ ...defaultRegion })}>
            {t('studio.expressions.mask.reset_region')}
          </button>
          <button type="button" className="btn small" onClick={clearStrokes}>
            {t('studio.expressions.mask.clear_strokes')}
          </button>
        </div>
      </div>
    </div>
  );
}
