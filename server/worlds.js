// Modo Novela: capa de datos de los mundos (world.json + story.jsonl), carga de contexto, copias/ramas y limpieza en cascada.
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseScript } from '../shared/vn.js';
import { getBackground, listBackgrounds } from './backgrounds.js';
import { getCharacter, listCharacters } from './cards.js';
import { makeMessage, parseChat, serializeChat } from './chats.js';
import { DIRS } from './config.js';
import { languages, t, tIn } from './i18n.js';
import { peekSprites } from './sprites.js';
import { getSettings } from './settings.js';
import { listStats, clampStat } from './stats.js';
import { getPersona } from './store.js';
import { HttpError, exists, nowIso, readJson, resolveIn, stamp, withLock, writeFileAtomic, writeJson } from './util.js';
import { slugify, uniqueSlug } from './vn-common.js';
import {
  attachedStats,
  currentState,
  lastSnapshot,
  mirrorSwipe,
  sanitizeScene,
  sceneOf,
  sceneToWorld,
  setMessageVn,
  stateBefore,
  applyControl,
} from './worldState.js';

export * from './worldState.js';
export { buildAnalysisMessages, buildSceneMessages } from './worldPrompt.js';

export const LIMITS = { name: 80, description: 8000, message: 50000, list: 200 };

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const uniq = (list) => [...new Set((Array.isArray(list) ? list : []).filter((x) => typeof x === 'string' && x).map(String))].slice(0, LIMITS.list);
const ID_RE = /^[a-z0-9][a-z0-9_-]{0,59}$/;

// ---------- rutas ----------

export function worldDir(id) {
  if (!ID_RE.test(String(id))) throw new HttpError(404, t('server.worlds.not_found'));
  return resolveIn(DIRS.worlds, id);
}
const worldFile = (id) => path.join(worldDir(id), 'world.json');
const storyFile = (id) => path.join(worldDir(id), 'story.jsonl');
const charsDir = (id) => path.join(worldDir(id), 'characters');

// ---------- configuración ----------

async function lorebookNames() {
  try {
    return new Set((await fs.readdir(DIRS.lorebooks)).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)));
  } catch {
    return new Set();
  }
}

function cleanWorld(raw, id, books) {
  const r = isObj(raw) ? raw : {};
  const characters = uniq(r.characters);
  const outfits = {};
  for (const [c, o] of Object.entries(isObj(r.outfits) ? r.outfits : {})) if (characters.includes(c) && typeof o === 'string' && o) outfits[c] = o;
  const now = nowIso();
  const world = {
    id,
    name: String(r.name || id).slice(0, LIMITS.name),
    description: String(r.description ?? '').slice(0, LIMITS.description),
    lorebooks: uniq(r.lorebooks).filter((n) => !books || books.has(n)),
    statIds: uniq(r.statIds),
    characters,
    active: uniq(r.active).filter((c) => characters.includes(c)),
    background: typeof r.background === 'string' ? r.background : '',
    outfits,
    persona: typeof r.persona === 'string' ? r.persona : '',
    createdAt: r.createdAt || now,
    updatedAt: r.updatedAt || r.createdAt || now,
  };
  if (isObj(r.initialStats)) world.initialStats = r.initialStats;
  if (isObj(r.initialScene)) world.initialScene = r.initialScene;
  return world;
}

/** Configuración del mundo tal como la ve el cliente (sin datos internos). */
export function publicWorld(world) {
  const { initialStats, initialScene, ...rest } = world;
  return rest;
}

export async function readWorld(id) {
  const raw = await readJson(worldFile(id));
  if (!raw) throw new HttpError(404, t('server.worlds.not_found'));
  return cleanWorld(raw, id, await lorebookNames());
}

export async function readStory(id) {
  let raw;
  try {
    raw = await fs.readFile(storyFile(id), 'utf8');
  } catch {
    throw new HttpError(404, t('server.worlds.not_found'));
  }
  return parseChat(raw);
}

/** Lectura-modificación-escritura serializada por mundo. `fn({ world, chat, dirty })` marca con dirty.add('world'|'story'|'state') lo que hay que guardar. */
export function mutateWorld(id, fn) {
  return withLock(storyFile(id), async () => {
    const world = await readWorld(id);
    const chat = await readStory(id);
    const ctx = { world, chat, dirty: new Set() };
    const result = await fn(ctx);
    if (ctx.dirty.has('story')) await writeFileAtomic(storyFile(id), serializeChat(chat));
    if (ctx.dirty.has('world')) {
      world.updatedAt = nowIso();
      await writeJson(worldFile(id), world);
    }
    if (ctx.dirty.has('state')) await materialize(world, chat);
    return result;
  });
}

// ---------- contexto (reparto, estadísticas, fondos) ----------

/** Reparto del mundo en el orden del roster: tarjeta + sprites. Los personajes cuya tarjeta ya no existe se omiten. */
export async function loadCast(world) {
  const out = [];
  for (const id of world.characters) {
    let card;
    try {
      card = await getCharacter(id);
    } catch {
      continue;
    }
    let sprites = null;
    try {
      sprites = await peekSprites(id);
    } catch {
      /* sin sprites */
    }
    const outfits = Array.isArray(sprites?.outfits) ? sprites.outfits : [];
    const config = isObj(sprites?.config) ? sprites.config : {};
    out.push({
      id,
      name: card.data.name || id,
      avatarUrl: `/api/characters/${encodeURIComponent(id)}/avatar?v=${card.mtime || 0}`,
      data: card.data,
      defaultOutfit: config.defaultOutfit || outfits[0]?.id || 'default',
      fallbackExpression: config.fallbackExpression || 'neutral',
      outfits,
      initial: isObj(config.stats) ? config.stats : {},
    });
  }
  return out;
}

export async function loadContext(world) {
  const [allStats, backgrounds, cast] = await Promise.all([listStats(), listBackgrounds(), loadCast(world)]);
  return { stats: attachedStats(world, allStats), backgrounds, cast };
}

/** Opciones comunes de currentState/stateBefore para un contexto. */
export const stateOptions = (c) => ({
  cast: c.cast,
  stats: c.stats,
  backgroundIds: c.backgrounds.map((b) => b.id),
  outfits: Object.fromEntries(c.cast.map((x) => [x.id, x.outfits.map((o) => o.id)])),
});

/** Atuendos disponibles por personaje, como espera applyControl. */
export const outfitsOf = (cast) => Object.fromEntries(cast.map((c) => [c.id, c.outfits.map((o) => ({ id: o.id, name: o.name }))]));

export const publicCast = (cast) =>
  cast.map(({ id, name, avatarUrl, defaultOutfit, fallbackExpression, outfits }) => ({ id, name, avatarUrl, defaultOutfit, fallbackExpression, outfits }));

export const publicBackground = (b) => ({ id: b.id, name: b.name, description: b.description, url: b.url });

export async function resolvePersona(world, chat, settings) {
  const id = world.persona || settings.defaultPersona;
  const persona = id ? await getPersona(id) : null;
  return persona || { id: '', name: chat.meta.user_name || t('server.common.default_user_name'), description: '' };
}

// ---------- vista materializada de las estadísticas por personaje ----------

async function materialize(world, chat) {
  const c = await loadContext(world);
  const state = currentState(world, chat.messages, stateOptions(c));
  const dir = charsDir(world.id);
  await fs.mkdir(dir, { recursive: true });
  const keep = new Set();
  for (const ch of c.cast) {
    const file = `${ch.id}.json`;
    keep.add(file);
    await writeJson(resolveIn(dir, file), { id: ch.id, name: ch.name, stats: state.stats.characters[ch.id] || {} });
  }
  for (const f of await fs.readdir(dir)) if (f.endsWith('.json') && !keep.has(f)) await fs.rm(path.join(dir, f), { force: true });
}

// ---------- validación de entrada ----------

async function sizedText(v, max, errKey) {
  const s = String(v ?? '').trim();
  if (s.length > max) throw new HttpError(400, t(errKey, { max }));
  return s;
}

async function validateConfig(body, existing) {
  const b = isObj(body) ? body : {};
  const out = {};
  if (b.name !== undefined || !existing) {
    const name = await sizedText(b.name, LIMITS.name, 'server.worlds.name_too_long');
    if (!name) throw new HttpError(400, t('server.worlds.name_required'));
    out.name = name;
  }
  if (b.description !== undefined) out.description = await sizedText(b.description, LIMITS.description, 'server.worlds.description_too_long');
  if (b.lorebooks !== undefined) {
    const books = await lorebookNames();
    out.lorebooks = uniq(b.lorebooks);
    for (const name of out.lorebooks) if (!books.has(name)) throw new HttpError(400, t('server.worlds.lorebook_not_found', { name }));
  }
  if (b.statIds !== undefined) {
    const known = new Set((await listStats()).map((s) => s.id));
    out.statIds = uniq(b.statIds);
    for (const id of out.statIds) if (!known.has(id)) throw new HttpError(400, t('server.worlds.stat_not_found', { id }));
  }
  if (b.characters !== undefined) {
    const known = new Set((await listCharacters()).map((c) => c.id));
    out.characters = uniq(b.characters);
    for (const id of out.characters) if (!known.has(id)) throw new HttpError(400, t('server.worlds.character_not_found', { id }));
  }
  if (b.persona !== undefined) {
    const id = String(b.persona || '');
    if (id && !(await getPersona(id))) throw new HttpError(404, t('server.personas.not_found'));
    out.persona = id;
  }
  if (b.background !== undefined) {
    const key = String(b.background || '');
    if (key) {
      const bg = await getBackground(key);
      if (!bg) throw new HttpError(400, t('server.worlds.background_not_found', { id: key }));
      out.background = bg.id;
    } else out.background = '';
  }
  if (b.active !== undefined) out.active = uniq(b.active);
  if (b.outfits !== undefined) out.outfits = isObj(b.outfits) ? b.outfits : {};
  return out;
}

/** Aplica un parche ya validado y deja el mundo coherente (activos ⊆ reparto, atuendos existentes). */
async function applyConfig(world, patch) {
  const next = { ...world };
  for (const k of ['name', 'description', 'lorebooks', 'statIds', 'characters', 'persona', 'background']) if (patch[k] !== undefined) next[k] = patch[k];
  if (patch.active !== undefined) {
    if (patch.active.some((id) => !next.characters.includes(id))) throw new HttpError(400, t('server.worlds.active_not_in_roster'));
    next.active = patch.active;
  } else {
    next.active = next.active.filter((id) => next.characters.includes(id));
  }
  const outfits = {};
  const source = patch.outfits !== undefined ? patch.outfits : next.outfits;
  for (const [charId, raw] of Object.entries(source)) {
    if (!next.characters.includes(charId)) {
      if (patch.outfits !== undefined) throw new HttpError(400, t('server.worlds.character_not_found', { id: charId }));
      continue;
    }
    const key = String(raw ?? '').trim();
    if (!key) continue;
    let list = [];
    try {
      list = (await peekSprites(charId)).outfits || [];
    } catch {
      /* sin sprites */
    }
    const found = list.find((o) => o.id === key) || list.find((o) => String(o.name).toLowerCase() === key.toLowerCase());
    if (!found) {
      if (patch.outfits !== undefined) throw new HttpError(400, t('server.worlds.outfit_not_found', { id: key, character: charId }));
      continue;
    }
    outfits[charId] = found.id;
  }
  next.outfits = outfits;
  return next;
}

// ---------- CRUD ----------

async function writeNewWorld(world, meta, messages) {
  await fs.mkdir(worldDir(world.id), { recursive: true });
  await writeFileAtomic(storyFile(world.id), serializeChat({ meta, messages }));
  await writeJson(worldFile(world.id), world);
  await materialize(world, { meta, messages });
}

async function newId(name) {
  await fs.mkdir(DIRS.worlds, { recursive: true });
  const taken = new Set((await fs.readdir(DIRS.worlds)).map((n) => n.toLowerCase()));
  return uniqueSlug(slugify(name, 'mundo'), taken);
}

export async function createWorld(body) {
  const patch = await validateConfig(body, null);
  const now = nowIso();
  const base = cleanWorld({ createdAt: now, updatedAt: now }, 'tmp', null);
  const world = await applyConfig(base, { ...patch, active: patch.active ?? patch.characters ?? [] });
  const id = await newId(world.name);
  world.id = id;
  world.createdAt = world.updatedAt = now;
  const settings = await getSettings();
  const persona = (world.persona && (await getPersona(world.persona))) || (settings.defaultPersona && (await getPersona(settings.defaultPersona))) || null;
  const meta = { user_name: persona?.name || t('server.common.default_user_name'), character_name: world.name, create_date: stamp(), chat_metadata: {} };
  await writeNewWorld(world, meta, []);
  return publicWorld(world);
}

export function updateWorld(id, body) {
  return mutateWorld(id, async (ctx) => {
    const patch = await validateConfig(body, ctx.world);
    const next = await applyConfig(ctx.world, patch);
    Object.assign(ctx.world, next);
    if (patch.name !== undefined) ctx.chat.meta.character_name = next.name;
    if (patch.persona !== undefined) {
      const persona = next.persona ? await getPersona(next.persona) : null;
      if (persona) ctx.chat.meta.user_name = persona.name;
    }
    ctx.dirty.add('world').add('story').add('state');
    return publicWorld(ctx.world);
  });
}

export async function deleteWorld(id) {
  const dir = worldDir(id);
  if (!(await exists(dir))) throw new HttpError(404, t('server.worlds.not_found'));
  await withLock(storyFile(id), () => fs.rm(dir, { recursive: true, force: true }));
}

const summaryCache = new Map();

function lastLineOf(messages) {
  const last = [...messages].reverse().find((m) => !m.is_system);
  if (!last) return null;
  if (last.is_user) return { speaker: last.name || null, text: String(last.mes).slice(0, 200) };
  const lines = parseScript(last.mes);
  const line = lines[lines.length - 1];
  return line ? { speaker: line.speaker, text: line.text.slice(0, 200) } : { speaker: null, text: String(last.mes).slice(0, 200) };
}

export async function listWorlds() {
  let names = [];
  try {
    names = (await fs.readdir(DIRS.worlds, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    return [];
  }
  const bgs = new Map((await listBackgrounds()).map((b) => [b.id, b]));
  const out = [];
  for (const id of names) {
    if (!ID_RE.test(id)) continue;
    try {
      const world = await readWorld(id);
      const file = storyFile(id);
      const st = await fs.stat(file);
      let hit = summaryCache.get(file);
      if (!hit || hit.mtimeMs !== st.mtimeMs || hit.size !== st.size) {
        const { messages } = parseChat(await fs.readFile(file, 'utf8'));
        hit = { mtimeMs: st.mtimeMs, size: st.size, messageCount: messages.length, lastLine: lastLineOf(messages) };
        summaryCache.set(file, hit);
      }
      const bg = bgs.get(world.background);
      out.push({
        id,
        name: world.name,
        description: world.description,
        updatedAt: world.updatedAt,
        messageCount: hit.messageCount,
        lastLine: hit.lastLine,
        background: bg ? { id: bg.id, url: bg.url } : null,
        characters: world.characters,
        active: world.active,
        statIds: world.statIds,
      });
    } catch {
      /* mundo ilegible: se omite */
    }
  }
  return out.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

export async function getWorldDetail(id) {
  const world = await readWorld(id);
  const chat = await readStory(id);
  const c = await loadContext(world);
  const settings = await getSettings();
  return {
    world: publicWorld(world),
    messages: chat.messages,
    state: currentState(world, chat.messages, stateOptions(c)),
    cast: publicCast(c.cast),
    stats: c.stats,
    backgrounds: c.backgrounds.map(publicBackground),
    persona: await resolvePersona(world, chat, settings),
    lorebooks: world.lorebooks,
  };
}

// ---------- mensajes ----------

function messageAt(chat, i) {
  const n = Number(i);
  const msg = Number.isInteger(n) ? chat.messages[n] : undefined;
  if (!msg) throw new HttpError(404, t('server.worlds.message_not_found'));
  return { i: n, msg };
}

function checkText(mes) {
  const text = String(mes ?? '');
  if (!text.trim()) throw new HttpError(400, t('server.worlds.empty_message'));
  if (text.length > LIMITS.message) throw new HttpError(400, t('server.worlds.message_too_long', { max: LIMITS.message }));
  return text;
}

export async function addUserMessage(id, mes) {
  const text = checkText(mes).trim();
  const settings = await getSettings();
  return mutateWorld(id, async (ctx) => {
    const persona = await resolvePersona(ctx.world, ctx.chat, settings);
    const message = makeMessage({ name: persona.name, isUser: true, mes: text });
    ctx.chat.messages.push(message);
    ctx.dirty.add('story').add('world');
    return { index: ctx.chat.messages.length - 1, message };
  });
}

export function editMessage(id, i, mes) {
  const text = checkText(mes);
  return mutateWorld(id, (ctx) => {
    const { msg } = messageAt(ctx.chat, i);
    msg.mes = text;
    if (Array.isArray(msg.swipes)) msg.swipes[msg.swipe_id ?? 0] = text;
    ctx.dirty.add('story');
    return msg;
  });
}

// Si cambió la instantánea que manda (borrado, swipe…), la escena de world.json vuelve a la de la nueva instantánea.
async function syncAfterChange(ctx, before) {
  const after = lastSnapshot(ctx.chat.messages);
  if (JSON.stringify(before?.state ?? null) === JSON.stringify(after?.state ?? null)) return;
  const scene = after?.state.scene ?? ctx.world.initialScene;
  if (scene) {
    const c = await loadContext(ctx.world);
    sceneToWorld(ctx.world, sanitizeScene(scene, stateOptions(c)));
    ctx.dirty.add('world');
  }
  ctx.dirty.add('state');
}

export function deleteMessage(id, i) {
  return mutateWorld(id, async (ctx) => {
    const { i: n } = messageAt(ctx.chat, i);
    const before = lastSnapshot(ctx.chat.messages);
    ctx.chat.messages.splice(n, 1);
    ctx.dirty.add('story');
    await syncAfterChange(ctx, before);
  });
}

export function selectSwipe(id, i, swipeId) {
  return mutateWorld(id, async (ctx) => {
    const { msg } = messageAt(ctx.chat, i);
    const sid = Number(swipeId);
    if (!Array.isArray(msg.swipes) || !Number.isInteger(sid) || sid < 0 || sid >= msg.swipes.length) throw new HttpError(400, t('server.worlds.invalid_swipe'));
    const before = lastSnapshot(ctx.chat.messages);
    msg.swipe_id = sid;
    msg.mes = msg.swipes[sid];
    mirrorSwipe(msg);
    ctx.dirty.add('story');
    await syncAfterChange(ctx, before);
    return msg;
  });
}

export function deleteSwipe(id, i, which) {
  return mutateWorld(id, async (ctx) => {
    const { msg } = messageAt(ctx.chat, i);
    const swipes = Array.isArray(msg.swipes) && msg.swipes.length ? msg.swipes : [msg.mes];
    if (swipes.length < 2) throw new HttpError(409, t('server.worlds.only_variant'));
    const sid = which !== undefined ? Number(which) : msg.swipe_id ?? 0;
    if (!Number.isInteger(sid) || sid < 0 || sid >= swipes.length) throw new HttpError(400, t('server.worlds.invalid_swipe'));
    const before = lastSnapshot(ctx.chat.messages);
    msg.swipes = swipes.filter((_, k) => k !== sid);
    if (Array.isArray(msg.swipe_info)) msg.swipe_info = msg.swipe_info.filter((_, k) => k !== sid);
    msg.swipe_id = Math.max(0, sid - 1);
    msg.mes = msg.swipes[msg.swipe_id];
    mirrorSwipe(msg);
    ctx.dirty.add('story');
    await syncAfterChange(ctx, before);
    return msg;
  });
}

// ---------- estadísticas manuales ----------

/** Edición manual de un valor: se escribe en la instantánea que manda (o en `initialStats` si aún no hay ninguna escena). */
export function setStatValue(id, { character, stat: statId, value } = {}) {
  return mutateWorld(id, async (ctx) => {
    const c = await loadContext(ctx.world);
    const stat = c.stats.find((s) => s.id === String(statId ?? '').trim());
    if (!stat) throw new HttpError(400, t('server.worlds.stat_not_found', { id: String(statId ?? '') }));
    if (value === null || value === '' || !Number.isFinite(Number(value))) throw new HttpError(400, t('server.worlds.invalid_value'));
    const state = currentState(ctx.world, ctx.chat.messages, stateOptions(c));
    if (stat.scope === 'world') {
      state.stats.world[stat.id] = clampStat(stat, value);
    } else {
      const who = c.cast.find((x) => x.id === String(character ?? ''));
      if (!character) throw new HttpError(400, t('server.worlds.character_required'));
      if (!who) throw new HttpError(400, t('server.worlds.character_not_found', { id: String(character) }));
      state.stats.characters[who.id][stat.id] = clampStat(stat, value);
    }
    const snap = lastSnapshot(ctx.chat.messages);
    if (snap) {
      setMessageVn(snap.message, { ...snap.vn, state: { ...snap.state, stats: state.stats } });
      ctx.dirty.add('story');
    } else {
      ctx.world.initialStats = state.stats;
      ctx.dirty.add('world');
    }
    ctx.dirty.add('state');
    return state;
  });
}

// ---------- generación ----------

/** Guarda la escena generada (nuevo mensaje o nuevo swipe del último), actualiza la escena del mundo y la vista materializada. */
export function persistScene(id, { script, control, model, startedAt, swipe = false, targetIndex = -1 }) {
  return mutateWorld(id, async (ctx) => {
    const { world, chat } = ctx;
    const c = await loadContext(world);
    const opts = stateOptions(c);
    let msg;
    let base;
    if (swipe) {
      msg = chat.messages[targetIndex];
      if (!msg || msg.is_user) throw new HttpError(409, t('server.worlds.message_gone'));
      base = stateBefore(world, chat.messages, targetIndex, opts);
    } else {
      base = currentState(world, chat.messages, opts);
      if (!lastSnapshot(chat.messages)) world.initialScene = sceneOf(world);
    }
    const applied = applyControl(control, { cast: c.cast, stats: c.stats, state: base, backgrounds: c.backgrounds, outfits: outfitsOf(c.cast) });
    const vn = { changes: applied.changes, state: applied.state, control: control ?? null };
    const info = { send_date: nowIso(), gen_started: startedAt, gen_finished: nowIso(), extra: { model, vn } };
    let index;
    if (swipe) {
      msg.swipes = Array.isArray(msg.swipes) && msg.swipes.length ? msg.swipes : [msg.mes];
      msg.swipe_info = Array.isArray(msg.swipe_info) ? msg.swipe_info : [];
      while (msg.swipe_info.length < msg.swipes.length) msg.swipe_info.push({});
      msg.swipes.push(script);
      msg.swipe_info.push(info);
      msg.swipe_id = msg.swipes.length - 1;
      msg.mes = script;
      msg.extra = { ...(isObj(msg.extra) ? msg.extra : {}), model, vn };
      index = targetIndex;
    } else {
      msg = makeMessage({ name: world.name, isUser: false, mes: script });
      msg.swipe_info = [{ send_date: msg.send_date, extra: { model, vn } }];
      msg.extra = { model, vn };
      chat.messages.push(msg);
      index = chat.messages.length - 1;
    }
    sceneToWorld(world, applied.scene);
    ctx.dirty.add('story').add('world').add('state');
    return { index, message: msg, changes: applied.changes, state: applied.state, scene: applied.scene };
  });
}

// ---------- ramas y copias ----------

function cloneSuffixPattern() {
  const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const words = languages().flatMap(({ code }) => [tIn(code, 'server.worlds.branch_suffix'), tIn(code, 'server.worlds.copy_suffix')]);
  return new RegExp(` \\((${[...new Set(words)].map(escape).join('|')})\\)$`);
}

async function cloneWorld(id, { count, name, suffix, fromSnapshot }) {
  return withLock(storyFile(id), async () => {
    const world = await readWorld(id);
    const chat = await readStory(id);
    const messages = structuredClone(chat.messages.slice(0, count));
    const base = world.name.replace(cloneSuffixPattern(), '');
    let finalName = String(name ?? '').trim();
    if (finalName.length > LIMITS.name) throw new HttpError(400, t('server.worlds.name_too_long', { max: LIMITS.name }));
    if (!finalName) finalName = `${base.slice(0, LIMITS.name - suffix.length - 3)} (${suffix})`;
    const copy = structuredClone(world);
    copy.id = await newId(finalName);
    copy.name = finalName;
    copy.createdAt = copy.updatedAt = nowIso();
    if (fromSnapshot) {
      const snap = lastSnapshot(messages);
      const scene = snap?.state.scene ?? world.initialScene;
      if (scene) {
        const c = await loadContext(copy);
        sceneToWorld(copy, sanitizeScene(scene, stateOptions(c)));
      }
    }
    const meta = structuredClone(chat.meta);
    meta.character_name = finalName;
    meta.create_date = stamp();
    await writeNewWorld(copy, meta, messages);
    return publicWorld(copy);
  });
}

export async function branchWorld(id, { index, name } = {}) {
  const chat = await readStory(id);
  const n = Number(index);
  if (!Number.isInteger(n) || n < 0 || n >= chat.messages.length) throw new HttpError(400, t('server.worlds.invalid_message'));
  return cloneWorld(id, { count: n + 1, name, suffix: t('server.worlds.branch_suffix'), fromSnapshot: true });
}

export async function copyWorld(id, { name } = {}) {
  const chat = await readStory(id);
  return cloneWorld(id, { count: chat.messages.length, name, suffix: t('server.worlds.copy_suffix'), fromSnapshot: false });
}

// ---------- limpieza en cascada (las invocan las rutas de estadísticas, fondos, sprites y personajes) ----------

async function eachWorld(fn) {
  let names = [];
  try {
    names = (await fs.readdir(DIRS.worlds, { withFileTypes: true })).filter((d) => d.isDirectory() && ID_RE.test(d.name)).map((d) => d.name);
  } catch {
    return;
  }
  for (const id of names) {
    try {
      await mutateWorld(id, fn);
    } catch (e) {
      console.error(`worlds cascade (${id}):`, e.message);
    }
  }
}

// Aplica `fn(state)` a todas las instantáneas de la historia; devuelve true si alguna cambió.
function scrubSnapshots(chat, fn) {
  let changed = false;
  const visit = (vn) => {
    if (isObj(vn?.state) && fn(vn.state)) changed = true;
  };
  for (const m of chat.messages) {
    visit(m.extra?.vn);
    for (const info of Array.isArray(m.swipe_info) ? m.swipe_info : []) visit(info?.extra?.vn);
  }
  return changed;
}

export function detachStat(statId) {
  return eachWorld((ctx) => {
    if (!ctx.world.statIds.includes(statId)) return;
    ctx.world.statIds = ctx.world.statIds.filter((s) => s !== statId);
    ctx.dirty.add('world').add('state');
  });
}

export function detachBackground(bgId) {
  return eachWorld((ctx) => {
    const { world, chat } = ctx;
    if (world.background === bgId) {
      world.background = '';
      ctx.dirty.add('world');
    }
    if (world.initialScene?.background === bgId) {
      world.initialScene.background = '';
      ctx.dirty.add('world');
    }
    const changed = scrubSnapshots(chat, (s) => {
      if (s.scene?.background !== bgId) return false;
      s.scene.background = '';
      return true;
    });
    if (changed) ctx.dirty.add('story');
  });
}

export function detachOutfit(charId, outfitId) {
  return eachWorld((ctx) => {
    const { world, chat } = ctx;
    if (world.outfits[charId] === outfitId) {
      delete world.outfits[charId];
      ctx.dirty.add('world');
    }
    if (world.initialScene?.outfits?.[charId] === outfitId) {
      delete world.initialScene.outfits[charId];
      ctx.dirty.add('world');
    }
    const changed = scrubSnapshots(chat, (s) => {
      if (s.scene?.outfits?.[charId] !== outfitId) return false;
      delete s.scene.outfits[charId];
      return true;
    });
    if (changed) ctx.dirty.add('story');
  });
}

export function detachCharacter(charId) {
  return eachWorld((ctx) => {
    const { world, chat } = ctx;
    const listed = world.characters.includes(charId) || world.active.includes(charId) || charId in world.outfits;
    if (listed) {
      world.characters = world.characters.filter((c) => c !== charId);
      world.active = world.active.filter((c) => c !== charId);
      delete world.outfits[charId];
      ctx.dirty.add('world').add('state');
    }
    if (world.initialStats?.characters?.[charId]) {
      delete world.initialStats.characters[charId];
      ctx.dirty.add('world');
    }
    if (world.initialScene) {
      const s = world.initialScene;
      if (s.active?.includes(charId) || s.outfits?.[charId]) {
        s.active = (s.active || []).filter((c) => c !== charId);
        delete s.outfits?.[charId];
        ctx.dirty.add('world');
      }
    }
    const changed = scrubSnapshots(chat, (s) => {
      let hit = false;
      if (s.scene?.active?.includes(charId)) {
        s.scene.active = s.scene.active.filter((c) => c !== charId);
        hit = true;
      }
      if (s.scene?.outfits?.[charId]) {
        delete s.scene.outfits[charId];
        hit = true;
      }
      if (s.stats?.characters?.[charId]) {
        delete s.stats.characters[charId];
        hit = true;
      }
      return hit;
    });
    if (changed) ctx.dirty.add('story');
  });
}
