import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api.js';
import { useData } from '../../data.jsx';
import { useT } from '../../i18n.jsx';
import { Icon } from '../../components/Icon.jsx';
import { Menu } from '../../components/ui.jsx';
import { classifyExpression } from '../../../../shared/expressions.js';
import { pickSprite } from '../../../../shared/vn.js';
import { seededRand, useLocalPref } from '../novel/vnUtils.js';
import '../../styles/chat-sprite.css';

// Imagen con fundido cruzado (la anterior se desvanece mientras entra la nueva).
function FadeImg({ src }) {
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
      {prev && <img className="cs-img cs-out" src={prev} alt="" draggable={false} />}
      {src && <img key={src} className="cs-img cs-in" src={src} alt="" draggable={false} />}
    </>
  );
}

// Sprites del personaje (todos sus atuendos); se vuelven a pedir al abrir el panel para ver los cambios del catálogo.
function useCharSprites(charId) {
  const [state, setState] = useState({ id: null, data: null, loading: true });
  useEffect(() => {
    if (!charId) {
      setState({ id: null, data: null, loading: false });
      return undefined;
    }
    let alive = true;
    api
      .sprites(charId)
      .then((data) => alive && setState({ id: charId, data, loading: false }))
      .catch(() => alive && setState({ id: charId, data: null, loading: false }));
    return () => {
      alive = false;
    };
  }, [charId]);
  return state.id === charId ? state : { id: charId, data: null, loading: Boolean(charId) };
}

// Expresiones elegidas por la IA, por mensaje (se conservan mientras la pestaña esté abierta).
const aiCache = new Map();
const NO_TEXT = '';

/**
 * Panel con el sprite del personaje (modo chat).
 * Props: character (tarjeta), text (último mensaje del personaje: de él sale la expresión), canCycle / onCycle(±1) (flechas entre
 * los personajes de un grupo), ai / onToggleAi (detectar la expresión con IA), caption ({ name, html, typing } o null: texto del
 * último mensaje, solo se ve en el móvil), className.
 */
export default function SpritePanel({ character, text = NO_TEXT, canCycle, onCycle, ai, onToggleAi, caption, className = '' }) {
  const { t } = useT();
  const { toast } = useData();
  const charId = character?.id || '';
  const { data, loading } = useCharSprites(charId);
  const [outfitPrefs, setOutfitPrefs] = useLocalPref('chatpuccino.chat.outfits', {});

  const outfits = data?.outfits || [];
  const config = data?.config || {};
  const wanted = outfitPrefs[charId] || config.defaultOutfit;
  const outfit = outfits.find((o) => o.id === wanted) || outfits.find((o) => o.id === config.defaultOutfit) || outfits[0] || null;
  const available = useMemo(() => Object.keys(outfit?.expressions || {}), [outfit]);
  const fallback = config.fallbackExpression || 'neutral';
  const hasSprites = outfits.some((o) => Object.keys(o.expressions || {}).length > 0);

  const local = useMemo(() => classifyExpression(text, available, fallback), [text, available, fallback]);

  const aiKey = `${charId}|${available.join(',')}|${text}`;
  const [aiResult, setAiResult] = useState(null);
  const warned = useRef(false);
  useEffect(() => {
    if (!ai || !text || available.length < 2) return undefined;
    if (aiCache.has(aiKey)) {
      setAiResult({ key: aiKey, label: aiCache.get(aiKey) });
      return undefined;
    }
    const ac = new AbortController();
    api
      .expressionAi({ text, labels: available, name: character?.name }, ac.signal)
      .then((out) => {
        aiCache.set(aiKey, out?.label || null);
        if (aiCache.size > 300) aiCache.delete(aiCache.keys().next().value);
        setAiResult({ key: aiKey, label: out?.label || null });
      })
      .catch((e) => {
        if (e.name === 'AbortError') return;
        aiCache.set(aiKey, null);
        setAiResult({ key: aiKey, label: null });
        if (!warned.current) {
          warned.current = true;
          toast(t('chatsprite.ai_failed', { reason: e.message }), 'error');
        }
      });
    return () => ac.abort();
  }, [ai, aiKey, text, available, character?.name, toast, t]);

  const label = (ai && aiResult?.key === aiKey && aiResult.label) || local;
  const sprite = useMemo(() => (outfit ? pickSprite(outfit.expressions, label, fallback, seededRand(`${charId}|${text.length}|${text.slice(-30)}|${label}`)) : null), [outfit, label, fallback, charId, text]);

  const outfitItems = [
    { header: t('chatsprite.outfit') },
    ...outfits.map((o) => ({ label: o.name, checked: o.id === outfit?.id, onClick: () => setOutfitPrefs((p) => ({ ...p, [charId]: o.id })) })),
  ];

  return (
    <aside className={`chat-sprite ${className}`} aria-label={t('chatsprite.aria', { name: character?.name || '' })}>
      <div className="cs-tools">
        <button type="button" className={`icon-btn cs-ai ${ai ? 'on' : ''}`} onClick={onToggleAi} aria-pressed={ai} aria-label={t('chatsprite.ai')} title={t('chatsprite.ai_hint')}>
          <Icon name="sparkle" size={20} />
        </button>
        {outfits.length > 0 && <Menu items={outfitItems} trigger={<Icon name="outfit" size={22} />} label={t('chatsprite.outfit_button', { name: outfit?.name || '' })} className="cs-outfit" />}
      </div>

      <div className="cs-stage">
        {loading ? (
          <div className="cs-note">{t('common.loading')}</div>
        ) : sprite ? (
          <FadeImg src={sprite.url} />
        ) : (
          <div className="cs-empty">
            {character && <img className="cs-avatar" src={`/api/characters/${encodeURIComponent(character.id)}/avatar?v=${character.mtime || 0}`} alt="" draggable={false} />}
            <p>{hasSprites ? t('chatsprite.no_expression') : t('chatsprite.no_sprites')}</p>
            {!hasSprites && (
              <Link className="btn small" to="/catalog/sprites">
                {t('chatsprite.add_sprites')}
              </Link>
            )}
          </div>
        )}
      </div>

      <div className="cs-foot">
        {canCycle && (
          <button type="button" className="icon-btn" onClick={() => onCycle(-1)} aria-label={t('chatsprite.prev')} title={t('chatsprite.prev')}>
            <Icon name="left" />
          </button>
        )}
        <div className="cs-name">
          <strong>{character?.name}</strong>
          {sprite && <small className="muted">{sprite.label}</small>}
        </div>
        {canCycle && (
          <button type="button" className="icon-btn" onClick={() => onCycle(1)} aria-label={t('chatsprite.next')} title={t('chatsprite.next')}>
            <Icon name="right" />
          </button>
        )}
      </div>

      {caption && (
        <div className="cs-caption" aria-live="polite">
          <div className="cs-caption-name">{caption.name}</div>
          {caption.typing ? (
            <div className="typing">
              <i />
              <i />
              <i />
            </div>
          ) : (
            <div className="text" dangerouslySetInnerHTML={{ __html: caption.html }} />
          )}
        </div>
      )}
    </aside>
  );
}
