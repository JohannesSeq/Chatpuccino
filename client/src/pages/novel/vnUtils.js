import { createElement, useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { findCharacter, parseScript, streamVisible } from '../../../../shared/vn.js';
import { formatRP } from '../../util.js';

/* ---------- preferencias y media queries ---------- */

export function useLocalPref(key, initial) {
  const [value, setValue] = useState(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? initial : JSON.parse(raw);
    } catch {
      return initial;
    }
  });
  const set = useCallback(
    (next) => {
      setValue((prev) => {
        const v = typeof next === 'function' ? next(prev) : next;
        try {
          localStorage.setItem(key, JSON.stringify(v));
        } catch {
          /* sin almacenamiento local */
        }
        return v;
      });
    },
    [key],
  );
  return [value, set];
}

export function useMedia(query) {
  const get = () => typeof window !== 'undefined' && Boolean(window.matchMedia?.(query).matches);
  const [matches, setMatches] = useState(get);
  useEffect(() => {
    const mq = window.matchMedia?.(query);
    if (!mq) return undefined;
    const on = () => setMatches(mq.matches);
    on();
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, [query]);
  return matches;
}

/* ---------- iconos propios (el set común no los trae) ---------- */

const ICONS = {
  history: 'M13 3a9 9 0 00-9 9H1l3.89 3.89.07.14L9 12H6c0-3.87 3.13-7 7-7s7 3.13 7 7-3.13 7-7 7c-1.93 0-3.68-.79-4.94-2.06l-1.42 1.42A8.954 8.954 0 0013 21a9 9 0 000-18zm-1 5v5l4.28 2.54.72-1.21-3.5-2.08V8H12z',
  panel: 'M20 4H4a2 2 0 00-2 2v12a2 2 0 002 2h16a2 2 0 002-2V6a2 2 0 00-2-2zM4 6h10v12H4V6zm12 0h4v12h-4V6z',
  text: 'M3 5h18v2H3V5zm0 4h18v2H3V9zm0 4h18v2H3v-2zm0 4h12v2H3v-2z',
  person: 'M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z',
  skip: 'M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z',
  next: 'M6 18l8.5-6L6 6v12z',
  up: 'M7.41 15.41L12 10.83l4.59 4.58L18 14l-6-6-6 6z',
  down: 'M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6z',
  caret: 'M7 10l5 5 5-5z',
};

export const VnIcon = ({ name, size = 22 }) =>
  createElement('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'currentColor', 'aria-hidden': 'true', focusable: 'false' }, createElement('path', { d: ICONS[name] || ICONS.next, fillRule: 'evenodd' }));

/* ---------- utilidades generales ---------- */

export function nameHue(name) {
  let h = 0;
  for (const ch of name || '?') h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % 360;
}

/** Aleatorio determinista: la misma semilla da siempre el mismo valor (las variantes de sprite no parpadean). */
export function seededRand(seed) {
  let h = 2166136261;
  for (const ch of String(seed)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  const v = (h % 10000) / 10000;
  return () => v;
}

export const isTypingTarget = (el) => {
  if (!el || !el.tagName) return false;
  const tag = el.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable;
};

export const fmtNum = (n) => (Number.isFinite(n) ? String(Math.round(n * 100) / 100) : '0');
export const fmtDelta = (n) => `${n > 0 ? '+' : ''}${fmtNum(n)}`;

/* ---------- guion → líneas ---------- */

// Durante el streaming, la última línea puede traer una etiqueta a medias ("[Lu"): no se muestra.
export function trimPartialTag(text) {
  return String(text ?? '').replace(/(^|\n)[ \t]*\[[^\]\n]*$/, '$1');
}

/** Acumula un delta del streaming (admite tanto trozos como el texto completo hasta ahora). */
export function appendDelta(prev, d) {
  if (prev.length >= 12 && d.length > prev.length && d.startsWith(prev)) return d;
  return prev + d;
}

/** Líneas de un guion: [{ speaker: charId|null, name, expression, text }]. */
export function scriptLines(text, cast, streaming = false) {
  const raw = streaming ? trimPartialTag(streamVisible(text)) : String(text ?? '');
  return parseScript(raw).map((l) => {
    const c = l.speaker ? findCharacter(cast, l.speaker) : null;
    return { speaker: c?.id || null, name: c?.name || l.speaker || '', expression: l.expression || '', text: l.text, unknown: Boolean(l.speaker && !c) };
  });
}

/** Una "beat" por mensaje: { index, kind, swipeId, lines }. */
export function buildBeat(message, index, cast) {
  const swipeId = message.swipe_id ?? 0;
  if (message.is_user) {
    return { index, kind: 'user', swipeId, lines: [{ speaker: null, name: message.name || '', expression: '', text: String(message.mes ?? '').trim(), isUser: true }] };
  }
  const kind = message.is_system ? 'system' : 'assistant';
  const lines = message.is_system ? [] : scriptLines(message.mes, cast);
  return { index, kind, swipeId, lines: lines.length ? lines : [{ speaker: null, name: '', expression: '', text: String(message.mes ?? '').trim() }] };
}

export const buildBeats = (messages, cast) => messages.map((m, i) => buildBeat(m, i, cast));

/** Expresión que debe mostrar `charId` mientras se lee la línea `lineIndex` (la suya, o la última que usó antes en el mensaje). */
export function expressionFor(lines, lineIndex, charId) {
  for (let i = Math.min(lineIndex, lines.length - 1); i >= 0; i--) {
    if (lines[i].speaker === charId && lines[i].expression) return lines[i].expression;
  }
  return 'neutral';
}

/** Escena que corresponde al mensaje `mi`: la vigente para lo último de la historia, la del snapshot para lo anterior. */
export function sceneForMessage(messages, mi, current) {
  let lastSnap = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].extra?.vn?.state?.scene) {
      lastSnap = i;
      break;
    }
  }
  if (mi >= lastSnap) return current;
  for (let i = Math.min(mi, messages.length - 1); i >= 0; i--) {
    const scene = messages[i].extra?.vn?.state?.scene;
    if (scene) return scene;
  }
  return current;
}

/** Cambios de escena (fondo / personajes / vestuario) entre dos escenas, como textos ya traducidos. */
export function sceneDiff(prev, next, { cast, backgrounds, t }) {
  if (!prev || !next) return [];
  const out = [];
  const name = (id) => cast.find((c) => c.id === id)?.name || id;
  if ((prev.background || '') !== (next.background || '') && next.background) {
    const bg = backgrounds.find((b) => b.id === next.background);
    out.push(t('novelview.scene.background_changed', { name: bg?.name || next.background }));
  }
  const entered = (next.active || []).filter((id) => !(prev.active || []).includes(id));
  const left = (prev.active || []).filter((id) => !(next.active || []).includes(id));
  if (entered.length) out.push(t('novelview.scene.entered', { names: entered.map(name).join(', ') }));
  if (left.length) out.push(t('novelview.scene.left', { names: left.map(name).join(', ') }));
  for (const [id, outfit] of Object.entries(next.outfits || {})) {
    if (prev.outfits?.[id] !== outfit && (next.active || []).includes(id)) {
      const label = cast.find((c) => c.id === id)?.outfits.find((o) => o.id === outfit)?.name || outfit;
      out.push(t('novelview.scene.outfit_changed', { name: name(id), outfit: label }));
    }
  }
  return out;
}

/* ---------- máquina de escribir sobre HTML ---------- */

export function htmlVisibleLength(html) {
  let n = 0;
  for (let i = 0; i < html.length; i++) {
    const c = html[i];
    if (c === '<') {
      const j = html.indexOf('>', i);
      if (j < 0) break;
      i = j;
    } else {
      if (c === '&') {
        const j = html.indexOf(';', i);
        if (j > 0 && j - i < 8) i = j;
      }
      n++;
    }
  }
  return n;
}

/** Recorta el HTML a `limit` caracteres visibles cerrando las etiquetas abiertas. */
export function truncateHtml(html, limit) {
  if (!Number.isFinite(limit)) return html;
  let out = '';
  let n = 0;
  const stack = [];
  for (let i = 0; i < html.length; i++) {
    const c = html[i];
    if (c === '<') {
      const j = html.indexOf('>', i);
      if (j < 0) break;
      const tag = html.slice(i, j + 1);
      const m = /^<(\/?)(\w+)/.exec(tag);
      const closing = Boolean(m?.[1]);
      if (n >= limit && !closing) break;
      if (m && m[2].toLowerCase() !== 'br') {
        if (closing) stack.pop();
        else stack.push(m[2]);
      }
      out += tag;
      i = j;
      continue;
    }
    if (n >= limit) break;
    if (c === '&') {
      const j = html.indexOf(';', i);
      if (j > 0 && j - i < 8) {
        out += html.slice(i, j + 1);
        i = j;
        n++;
        continue;
      }
    }
    out += c;
    n++;
  }
  while (stack.length) out += `</${stack.pop()}>`;
  return out;
}

const CHARS_PER_SECOND = 95;

/**
 * Máquina de escribir. `resetKey` reinicia la animación; `instant` muestra todo de golpe.
 * Devuelve { html (parte visible), done, finish() }. Si el texto crece (streaming) sigue escribiendo.
 */
export function useTypewriter(text, resetKey, instant) {
  const full = formatRP(text || '');
  const total = htmlVisibleLength(full);
  const [, force] = useReducer((x) => x + 1, 0);
  const st = useRef({ key: null, n: 0 });
  if (st.current.key !== resetKey) st.current = { key: resetKey, n: instant ? Infinity : 0 };
  if (instant && st.current.n !== Infinity) st.current.n = Infinity;
  const active = st.current.n < total;

  useEffect(() => {
    if (!active) return undefined;
    let raf;
    let last = performance.now();
    const tick = (now) => {
      const cur = st.current;
      cur.n = Math.min(total, cur.n + ((now - last) * CHARS_PER_SECOND) / 1000);
      last = now;
      force();
      if (cur.n < total) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active, total, resetKey]);

  const n = st.current.n;
  const done = n >= total;
  const finish = useCallback(() => {
    st.current.n = Infinity;
    force();
  }, []);
  return { html: done ? full : truncateHtml(full, Math.floor(n)), done, finish };
}
