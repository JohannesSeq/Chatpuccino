// Motor de estado del Modo Novela: funciones puras (sin disco) sobre estadísticas, escena e instantáneas de los mensajes.
// Las estadísticas son autoritativas en las instantáneas `extra.vn.state` de los mensajes; la escena, en world.json.
import { findCharacter } from '../shared/vn.js';
import { clampStat } from './stats.js';

export const MAX_DELTA_RATIO = 0.25;

const clone = (o) => JSON.parse(JSON.stringify(o));
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const round2 = (n) => Math.round(n * 100) / 100;
const finite = (v) => v !== null && v !== '' && v !== undefined && Number.isFinite(Number(v));
const norm = (s) => String(s ?? '').trim().toLowerCase();

/** Fondos y atuendos de una escena, tal como los guarda world.json. */
export function sceneOf(world) {
  return {
    background: typeof world.background === 'string' ? world.background : '',
    outfits: isObj(world.outfits) ? { ...world.outfits } : {},
    active: Array.isArray(world.active) ? [...world.active] : [],
  };
}

/** Estadísticas adjuntas al mundo (en el orden de `statIds`) a partir de la biblioteca completa. */
export function attachedStats(world, allStats) {
  return (world.statIds || []).map((id) => allStats.find((s) => s.id === id)).filter(Boolean);
}

/**
 * Escena válida: descarta personajes, fondos y atuendos que ya no existen.
 * `castIds` (obligatorio), `backgroundIds` y `outfits` ({ charId: [outfitId] }) son opcionales; si faltan no se comprueban.
 */
export function sanitizeScene(scene, { castIds, backgroundIds, outfits } = {}) {
  const src = isObj(scene) ? scene : {};
  const ids = castIds ? new Set(castIds) : null;
  const out = { background: typeof src.background === 'string' ? src.background : '', outfits: {}, active: [] };
  if (backgroundIds && out.background && !backgroundIds.includes(out.background)) out.background = '';
  for (const [charId, outfitId] of Object.entries(isObj(src.outfits) ? src.outfits : {})) {
    if (ids && !ids.has(charId)) continue;
    if (typeof outfitId !== 'string' || !outfitId) continue;
    if (outfits?.[charId] && !outfits[charId].includes(outfitId)) continue;
    out.outfits[charId] = outfitId;
  }
  for (const id of Array.isArray(src.active) ? src.active : []) {
    if (typeof id === 'string' && (!ids || ids.has(id)) && !out.active.includes(id)) out.active.push(id);
  }
  return out;
}

const initialOf = (c, statId) => (isObj(c?.initial) && finite(c.initial[statId]) ? Number(c.initial[statId]) : undefined);

/** Valores iniciales de las estadísticas (los de `world.initialStats` mandan sobre los de sprites y los por defecto). */
function defaultStats(world, cast, stats) {
  const initial = isObj(world.initialStats) ? world.initialStats : {};
  const out = { world: {}, characters: {} };
  for (const stat of stats) {
    if (stat.scope === 'world') {
      const v = initial.world?.[stat.id];
      out.world[stat.id] = clampStat(stat, finite(v) ? Number(v) : stat.default);
    } else {
      for (const c of cast) {
        const own = initial.characters?.[c.id]?.[stat.id];
        const v = finite(own) ? Number(own) : initialOf(c, stat.id) ?? stat.default;
        (out.characters[c.id] ??= {})[stat.id] = clampStat(stat, v);
      }
    }
  }
  return out;
}

/**
 * Estado inicial: valores por defecto de las estadísticas adjuntas (`stats`) para el reparto (`cast` = [{ id, name, initial? }])
 * y la escena actual de `world`.
 */
export function defaultState(world, cast, stats, scene = sceneOf(world)) {
  return { stats: defaultStats(world, cast, stats), scene: clone(scene) };
}

/** Rellena con valores por defecto lo que falte en `raw` y descarta estadísticas y personajes que ya no están adjuntos. */
export function fillStats(raw, world, cast, stats) {
  const base = defaultStats(world, cast, stats);
  const src = isObj(raw) ? raw : {};
  const out = { world: {}, characters: {} };
  for (const stat of stats) {
    if (stat.scope === 'world') {
      const v = src.world?.[stat.id];
      out.world[stat.id] = finite(v) ? clampStat(stat, v) : base.world[stat.id];
    } else {
      for (const c of cast) {
        const v = src.characters?.[c.id]?.[stat.id];
        (out.characters[c.id] ??= {})[stat.id] = finite(v) ? clampStat(stat, v) : base.characters[c.id][stat.id];
      }
    }
  }
  return out;
}

/** Datos `vn` del swipe seleccionado de un mensaje (o los espejados en `extra`). */
export function swipeVn(msg) {
  const info = Array.isArray(msg?.swipe_info) ? msg.swipe_info[msg.swipe_id ?? 0] : null;
  const vn = info?.extra?.vn ?? msg?.extra?.vn;
  return isObj(vn) ? vn : null;
}

/** Último mensaje del asistente (antes de `end`) con instantánea de estado: { index, message, vn, state } o null. */
export function lastSnapshot(messages, end = messages.length) {
  for (let i = Math.min(end, messages.length) - 1; i >= 0; i--) {
    const m = messages[i];
    if (!m || m.is_user || m.is_system) continue;
    const vn = swipeVn(m);
    if (isObj(vn?.state) && isObj(vn.state.stats)) return { index: i, message: m, vn, state: vn.state };
  }
  return null;
}

/** Estado actual: estadísticas de la última instantánea (rellenadas) y la escena de world.json. */
export function currentState(world, messages, { cast = [], stats = [], backgroundIds, outfits } = {}) {
  const snap = lastSnapshot(messages);
  const castIds = cast.map((c) => c.id);
  return {
    stats: fillStats(snap?.state.stats, world, cast, stats),
    scene: sanitizeScene(sceneOf(world), { castIds, backgroundIds, outfits }),
  };
}

/** Estado justo ANTES del mensaje `index` (para regenerar un swipe desde las estadísticas y la escena correctas). */
export function stateBefore(world, messages, index, { cast = [], stats = [], backgroundIds, outfits } = {}) {
  const snap = lastSnapshot(messages, index);
  const castIds = cast.map((c) => c.id);
  const scene = snap?.state.scene ?? world.initialScene ?? sceneOf(world);
  return { stats: fillStats(snap?.state.stats, world, cast, stats), scene: sanitizeScene(scene, { castIds, backgroundIds, outfits }) };
}

/** Lo que la escena guardada en una instantánea aporta a world.json. */
export function sceneToWorld(world, scene) {
  world.background = scene.background || '';
  world.outfits = { ...scene.outfits };
  world.active = [...scene.active];
  return world;
}

const findByIdOrName = (list, key) => {
  const k = norm(key);
  return k ? list.find((x) => norm(x.id) === k) || list.find((x) => norm(x.name) === k) || null : null;
};

const asList = (v) => (Array.isArray(v) ? v : typeof v === 'string' && v.trim() ? [v] : []);

/**
 * Valida y aplica un bloque de control del modelo sobre el estado anterior.
 * ctx: { cast: [{ id, name }] (reparto), stats: [stat] (adjuntas), state (anterior), backgrounds: [{ id, name }], outfits: { charId: [{ id, name }] } }
 * Devuelve { changes, state, scene }; lo inválido se ignora en silencio.
 */
export function applyControl(control, ctx) {
  const { cast = [], stats = [], backgrounds = [], outfits = {} } = ctx;
  const next = clone(ctx.state);
  next.stats = isObj(next.stats) ? next.stats : { world: {}, characters: {} };
  next.stats.world = isObj(next.stats.world) ? next.stats.world : {};
  next.stats.characters = isObj(next.stats.characters) ? next.stats.characters : {};
  next.scene = sanitizeScene(next.scene, { castIds: cast.map((c) => c.id) });
  const ctrl = isObj(control) ? control : {};
  const changes = [];

  for (const entry of Array.isArray(ctrl.stats) ? ctrl.stats : []) {
    if (!isObj(entry)) continue;
    const stat = findByIdOrName(stats, entry.stat ?? entry.id);
    const raw = entry.change ?? entry.delta;
    if (!stat || !finite(raw)) continue;
    let who = null;
    if (stat.scope !== 'world') {
      who = findCharacter(cast, entry.character ?? entry.char ?? entry.who);
      if (!who) continue;
    }
    const bag = who ? (next.stats.characters[who.id] ??= {}) : next.stats.world;
    const from = finite(bag[stat.id]) ? clampStat(stat, bag[stat.id]) : clampStat(stat, stat.default);
    const cap = (stat.max - stat.min) * MAX_DELTA_RATIO;
    let delta = Math.max(-cap, Math.min(cap, Number(raw)));
    if (Number.isInteger(stat.min) && Number.isInteger(stat.max)) {
      const r = Math.round(delta);
      delta = Math.abs(r) <= cap ? r : Math.trunc(delta);
    } else {
      delta = round2(delta);
    }
    const to = clampStat(stat, from + delta);
    if (to === from) continue;
    bag[stat.id] = to;
    changes.push({
      scope: who ? 'character' : 'world',
      character: who ? who.id : null,
      characterName: who ? who.name : null,
      stat: stat.id,
      statName: stat.name,
      from,
      to,
      delta: round2(to - from),
      reason: String(entry.reason ?? '').trim().slice(0, 200),
    });
  }

  const sc = isObj(ctrl.scene) ? ctrl.scene : {};
  if (typeof sc.background === 'string') {
    const bg = findByIdOrName(backgrounds, sc.background);
    if (bg) next.scene.background = bg.id;
  }
  if (isObj(sc.outfits)) {
    for (const [name, outfitName] of Object.entries(sc.outfits)) {
      const who = findCharacter(cast, name);
      const outfit = who && findByIdOrName(outfits[who.id] || [], outfitName);
      if (outfit) next.scene.outfits[who.id] = outfit.id;
    }
  }
  for (const name of asList(sc.enter)) {
    const who = findCharacter(cast, name);
    if (who && !next.scene.active.includes(who.id)) next.scene.active.push(who.id);
  }
  for (const name of asList(sc.exit)) {
    const who = findCharacter(cast, name);
    if (who) next.scene.active = next.scene.active.filter((id) => id !== who.id);
  }
  return { changes, state: next, scene: next.scene };
}

/** Extrae el primer objeto JSON de la respuesta de un modelo (con o sin ```json). */
export function parseJsonLoose(text) {
  const s = String(text ?? '');
  const a = s.indexOf('{');
  const b = s.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try {
    const v = JSON.parse(s.slice(a, b + 1));
    return isObj(v) ? v : null;
  } catch {
    return null;
  }
}

/**
 * Opciones del Modo clásico a partir de la respuesta del modelo: acepta `{"choices":[…]}`, un arreglo suelto o
 * elementos `{ "text": … }`; recorta, quita numeración y duplicados y deja como mucho `CHOICES_MAX`.
 */
export const CHOICES_MAX = 3;
export const CHOICE_CHARS = 400;

export function parseChoices(text) {
  const s = String(text ?? '');
  let list = parseJsonLoose(s);
  list = list?.choices ?? list?.options ?? list?.opciones;
  if (!Array.isArray(list)) {
    const a = s.indexOf('[');
    const b = s.lastIndexOf(']');
    list = null;
    if (a >= 0 && b > a) {
      try {
        list = JSON.parse(s.slice(a, b + 1));
      } catch {
        list = null;
      }
    }
  }
  if (!Array.isArray(list)) return [];
  const out = [];
  const seen = new Set();
  for (const item of list) {
    const raw = typeof item === 'string' ? item : isObj(item) ? item.text ?? item.choice ?? item.option ?? item.mes ?? '' : '';
    const choice = String(raw)
      .replace(/^\s*(?:\d+[.)]|[-•*])\s+/, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, CHOICE_CHARS);
    const key = norm(choice);
    if (!choice || seen.has(key)) continue;
    seen.add(key);
    out.push(choice);
    if (out.length >= CHOICES_MAX) break;
  }
  return out;
}

/** Guarda `vn` en el swipe seleccionado de un mensaje y lo refleja en `msg.extra.vn`. */
export function setMessageVn(msg, vn) {
  const id = msg.swipe_id ?? 0;
  msg.swipe_info = Array.isArray(msg.swipe_info) ? msg.swipe_info : [];
  while (msg.swipe_info.length <= id) msg.swipe_info.push({});
  const info = (msg.swipe_info[id] = isObj(msg.swipe_info[id]) ? msg.swipe_info[id] : {});
  info.extra = { ...(isObj(info.extra) ? info.extra : {}), vn };
  msg.extra = { ...(isObj(msg.extra) ? msg.extra : {}), vn };
}

/** Tras cambiar `swipe_id`, refleja los datos del swipe seleccionado en `msg.extra`. */
export function mirrorSwipe(msg) {
  const info = Array.isArray(msg.swipe_info) ? msg.swipe_info[msg.swipe_id ?? 0] : null;
  const extra = { ...(isObj(msg.extra) ? msg.extra : {}) };
  delete extra.vn;
  if (info?.extra?.model) extra.model = info.extra.model;
  if (info?.extra?.vn) extra.vn = info.extra.vn;
  msg.extra = extra;
}
