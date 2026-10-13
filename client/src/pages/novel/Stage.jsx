import React, { useEffect, useMemo, useRef, useState } from 'react';
import { pickSprite } from '../../../../shared/vn.js';
import { useT } from '../../i18n.jsx';
import { expressionFor, seededRand } from './vnUtils.js';

// Imagen con fundido cruzado: la anterior se desvanece mientras entra la nueva.
function FadeImg({ src, className = '' }) {
  const [prev, setPrev] = useState(null);
  const last = useRef(src);
  useEffect(() => {
    if (last.current === src) return undefined;
    setPrev(last.current);
    last.current = src;
    const id = setTimeout(() => setPrev(null), 400);
    return () => clearTimeout(id);
  }, [src]);
  return (
    <>
      {prev && <img className={`${className} vn-fade-out`} src={prev} alt="" draggable={false} />}
      {src && <img key={src} className={`${className} vn-fade-in`} src={src} alt="" draggable={false} />}
    </>
  );
}

function Portrait({ src, name }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  return (
    <div className="vn-portrait">
      {src && !failed ? <img src={src} alt="" draggable={false} onError={() => setFailed(true)} /> : <span>{(name || '?').trim().charAt(0).toUpperCase()}</span>}
    </div>
  );
}

function layout(count) {
  const width = Math.min(58, 118 / Math.max(count, 1));
  const x = (i) => {
    if (count === 1) return 50;
    if (count === 2) return i === 0 ? 28 : 72;
    if (count === 3) return [20, 50, 80][i];
    return ((i + 0.5) / count) * 100;
  };
  return { width, x };
}

const Slot = React.memo(function Slot({ slot, leaving }) {
  return (
    <div className={`vn-slot ${slot.state} ${leaving ? 'leaving' : ''}`} style={{ left: `${slot.x}%`, width: `${slot.width}%` }} data-char={slot.id}>
      <div className="vn-slot-in">{slot.sprite ? <FadeImg src={slot.sprite.url} className="vn-sprite" /> : <Portrait src={slot.avatar} name={slot.name} />}</div>
    </div>
  );
});

/**
 * Escenario: fondo, viñeta y personajes de pie.
 * Props: cast, active (ids en escena, en orden), outfits ({charId: outfitId}), backgroundUrl,
 * line (línea actual {speaker,...} o null), lines (líneas del mensaje), lineIndex, messageKey (semilla de variantes),
 * hidden (no dibuja los personajes: modo "foco en el texto" del móvil).
 */
export default function Stage({ cast, active, outfits, backgroundUrl, line, lines, lineIndex, messageKey, hidden }) {
  const { t } = useT();
  const castMap = useMemo(() => Object.fromEntries(cast.map((c) => [c.id, c])), [cast]);
  const speaker = line?.speaker || null;

  const ids = useMemo(() => {
    const list = (active || []).filter((id) => castMap[id]);
    if (speaker && castMap[speaker] && !list.includes(speaker)) list.push(speaker);
    return list;
  }, [active, castMap, speaker]);

  const slots = useMemo(() => {
    const { width, x } = layout(ids.length);
    return ids.map((id, i) => {
      const c = castMap[id];
      const label = expressionFor(lines || [], lineIndex || 0, id);
      const outfitId = outfits?.[id] || c.defaultOutfit;
      const outfit = c.outfits?.find((o) => o.id === outfitId) || c.outfits?.[0];
      const sprite = outfit ? pickSprite(outfit.expressions, label, c.fallbackExpression, seededRand(`${messageKey}|${id}|${outfit.id}|${label}`)) : null;
      return { id, name: c.name, avatar: c.avatarUrl, sprite, x: x(i), width, state: speaker ? (id === speaker ? 'speaker' : 'dim') : 'narr' };
    });
  }, [ids, castMap, lines, lineIndex, outfits, messageKey, speaker]);

  // Los que salen de escena siguen dibujados un momento para poder desvanecerse.
  const slotsRef = useRef({});
  const prevIds = useRef(ids);
  const [ghosts, setGhosts] = useState([]);
  useEffect(() => {
    const gone = prevIds.current.filter((id) => !ids.includes(id));
    prevIds.current = ids;
    if (gone.length) {
      setGhosts((g) => [...g.filter((x) => !gone.includes(x.id)), ...gone.map((id) => slotsRef.current[id]).filter(Boolean)]);
      setTimeout(() => setGhosts((g) => g.filter((x) => !gone.includes(x.id))), 520);
    }
  }, [ids]);
  useEffect(() => {
    slotsRef.current = Object.fromEntries(slots.map((s) => [s.id, s]));
  }, [slots]);

  const names = slots.map((s) => s.name).join(', ');
  return (
    <div className="vn-stage" role="img" aria-label={names ? t('novelview.stage.aria', { names }) : t('novelview.stage.aria_empty')}>
      <div className="vn-bg">
        <FadeImg src={backgroundUrl} className="vn-bg-img" />
      </div>
      <div className="vn-vignette" />
      {!hidden && (
        <div className="vn-chars">
          {ghosts
            .filter((g) => !ids.includes(g.id))
            .map((g) => (
              <Slot key={`g-${g.id}`} slot={{ ...g, state: 'dim' }} leaving />
            ))}
          {slots.map((s) => (
            <Slot key={s.id} slot={s} />
          ))}
        </div>
      )}
    </div>
  );
}
