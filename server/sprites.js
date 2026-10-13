import fs from 'node:fs/promises';
import path from 'node:path';
import { DIRS } from './config.js';
import { DEFAULT_EXPRESSIONS, DEFAULT_FALLBACK_EXPRESSION } from '../shared/vn.js';
import { getCharacter } from './cards.js';
import { t } from './i18n.js';
import { listStats, clampStat } from './stats.js';
import { slugify, uniqueSlug } from './vn-common.js';
import { HttpError, readJson, resolveIn, withLock, writeFileAtomic, writeJson } from './util.js';

const LABEL_RE = /^[a-z0-9_-]{1,40}$/;
const FILE_RE = /^[A-Za-z0-9_.-]{1,100}\.(png|jpe?g|webp|gif)$/i;
const MAX_NAME = 60;
const MAX_CUSTOM = 100;
const BAD_ID = /[\\/:*?"<>|\u0000-\u001f]|^\.|[. ]$/;

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

// ---- Rutas

function charDir(charId) {
  if (BAD_ID.test(String(charId ?? ''))) throw new HttpError(400, t('server.common.invalid_name'));
  return resolveIn(DIRS.vnSprites, charId);
}
const configPath = (charId) => path.join(charDir(charId), 'config.json');
const outfitDir = (charId, outfitId) => resolveIn(charDir(charId), outfitId);
const lockKey = (charId) => `vn-sprites:${charId}`;

// ---- Etiquetas y archivos

function sanitizeLabel(s) {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '')
    .slice(0, 40)
    .replace(/[-_]+$/, '');
}

/** Etiqueta a partir del nombre de archivo, como SillyTavern: `Joy-2.PNG`, `joy_3.webp` → `joy`. */
export function deriveLabel(fileName) {
  const base = String(fileName ?? '').replace(/\.[^.]*$/, '').toLowerCase();
  return sanitizeLabel(base.replace(/[\s._-]+\d+$/, '') || base);
}

/** Etiqueta explícita: debe ser válida tal cual y no acabar en `-N` (se confundiría con una variante). */
function explicitLabel(raw) {
  const label = sanitizeLabel(raw);
  if (!LABEL_RE.test(label) || /[-_]\d+$/.test(label)) throw new HttpError(400, t('server.sprites.invalid_label'));
  return label;
}

const variantNumber = (file) => Number(/-(\d+)\.\w+$/.exec(file)?.[1] || 1);

async function statMtime(p) {
  try {
    return Math.round((await fs.stat(p)).mtimeMs);
  } catch {
    return 0;
  }
}

const fileUrl = (charId, outfitId, file, mtime) =>
  `/api/sprites/${encodeURIComponent(charId)}/outfits/${encodeURIComponent(outfitId)}/files/${encodeURIComponent(file)}?v=${mtime}`;

async function listExpressions(charId, outfitId) {
  const dir = outfitDir(charId, outfitId);
  let names = [];
  try {
    names = await fs.readdir(dir);
  } catch {
    return {};
  }
  const expressions = {};
  for (const file of names.filter((n) => FILE_RE.test(n))) {
    const label = deriveLabel(file);
    if (!LABEL_RE.test(label)) continue;
    (expressions[label] ||= []).push({ file, url: fileUrl(charId, outfitId, file, await statMtime(path.join(dir, file))) });
  }
  for (const list of Object.values(expressions)) list.sort((a, b) => variantNumber(a.file) - variantNumber(b.file) || a.file.localeCompare(b.file));
  return Object.fromEntries(Object.entries(expressions).sort(([a], [b]) => a.localeCompare(b)));
}

// ---- Configuración

const defaultOutfit = () => ({ id: 'default', name: t('server.sprites.default_outfit') });

function normalizeConfig(raw) {
  const r = isObj(raw) ? raw : {};
  const seen = new Set();
  const outfits = [];
  for (const o of Array.isArray(r.outfits) ? r.outfits : []) {
    const id = typeof o?.id === 'string' ? o.id : '';
    if (!/^[a-z0-9_-]+$/.test(id) || seen.has(id)) continue;
    seen.add(id);
    outfits.push({ id, name: String(o.name ?? '').trim().slice(0, MAX_NAME) || id });
  }
  const custom = [];
  for (const l of Array.isArray(r.customExpressions) ? r.customExpressions : []) {
    if (typeof l === 'string' && LABEL_RE.test(l) && !DEFAULT_EXPRESSIONS.includes(l) && !custom.includes(l)) custom.push(l);
  }
  const stats = {};
  for (const [k, v] of Object.entries(isObj(r.stats) ? r.stats : {})) if (Number.isFinite(v)) stats[k] = v;
  return {
    defaultOutfit: outfits.some((o) => o.id === r.defaultOutfit) ? r.defaultOutfit : outfits[0]?.id || '',
    fallbackExpression: typeof r.fallbackExpression === 'string' && LABEL_RE.test(r.fallbackExpression) ? r.fallbackExpression : DEFAULT_FALLBACK_EXPRESSION,
    customExpressions: custom.slice(0, MAX_CUSTOM),
    stats,
    outfits,
  };
}

const publicConfig = ({ defaultOutfit: d, fallbackExpression, customExpressions, stats }) => ({ defaultOutfit: d, fallbackExpression, customExpressions, stats });

async function readConfig(charId) {
  const raw = await readJson(configPath(charId), null);
  return raw ? normalizeConfig(raw) : null;
}

const saveConfig = (charId, config) => writeJson(configPath(charId), config);

// Lee la configuración y crea el atuendo por defecto si hace falta. Llamar dentro del lock.
async function ensureConfig(charId) {
  let config = await readConfig(charId);
  if (!config || !config.outfits.length) {
    config = normalizeConfig({ ...config, outfits: [defaultOutfit()], defaultOutfit: 'default' });
    await fs.mkdir(outfitDir(charId, 'default'), { recursive: true });
    await saveConfig(charId, config);
  }
  return config;
}

async function outfitPayload(charId, outfit) {
  return { id: outfit.id, name: outfit.name, expressions: await listExpressions(charId, outfit.id) };
}

async function payload(charId, config) {
  return { charId, config: publicConfig(config), outfits: await Promise.all(config.outfits.map((o) => outfitPayload(charId, o))) };
}

function findOutfit(config, outfitId) {
  const outfit = config.outfits.find((o) => o.id === outfitId);
  if (!outfit) throw new HttpError(404, t('server.sprites.outfit_not_found'));
  return outfit;
}

// Ejecuta `fn(config)` dentro del lock del personaje, tras comprobar que existe. `fn` devuelve el resultado.
async function mutate(charId, fn) {
  await getCharacter(charId);
  return withLock(lockKey(charId), async () => fn(await ensureConfig(charId)));
}

// ---- API pública

export async function getSprites(charId) {
  return mutate(charId, (config) => payload(charId, config));
}

/** Igual que getSprites pero sin crear nada en disco ni comprobar el personaje. */
export async function peekSprites(charId) {
  let config = null;
  try {
    config = await readConfig(charId);
  } catch {
    /* id inválido: estructura vacía */
  }
  if (!config || !config.outfits.length) config = normalizeConfig({ ...config, outfits: [defaultOutfit()], defaultOutfit: 'default' });
  try {
    return await payload(charId, config);
  } catch {
    return { charId, config: publicConfig(config), outfits: config.outfits.map((o) => ({ ...o, expressions: {} })) };
  }
}

/** Valor inicial de una estadística para un personaje (o null si no está configurado). */
export async function initialStatValue(charId, statId) {
  let config = null;
  try {
    config = await readConfig(charId);
  } catch {
    return null;
  }
  const v = config?.stats?.[statId];
  return Number.isFinite(v) ? v : null;
}

export async function deleteSprites(charId) {
  let dir;
  try {
    dir = charDir(charId);
  } catch {
    return;
  }
  await fs.rm(dir, { recursive: true, force: true });
}

export function updateSpriteConfig(charId, body) {
  const b = isObj(body) ? body : {};
  return mutate(charId, async (config) => {
    if (b.defaultOutfit !== undefined) config.defaultOutfit = findOutfit(config, b.defaultOutfit).id;
    if (b.fallbackExpression !== undefined) config.fallbackExpression = explicitLabel(b.fallbackExpression);
    if (b.customExpressions !== undefined) {
      if (!Array.isArray(b.customExpressions)) throw new HttpError(400, t('server.sprites.invalid_label'));
      const labels = b.customExpressions.map(explicitLabel).filter((l) => !DEFAULT_EXPRESSIONS.includes(l));
      config.customExpressions = [...new Set(labels)].slice(0, MAX_CUSTOM);
    }
    if (b.stats !== undefined) {
      const defs = new Map((await listStats()).filter((s) => s.scope === 'character').map((s) => [s.id, s]));
      const stats = {};
      for (const [id, v] of Object.entries(isObj(b.stats) ? b.stats : {})) {
        const def = defs.get(id);
        if (def && v !== null && v !== '' && Number.isFinite(Number(v))) stats[id] = clampStat(def, v);
      }
      config.stats = stats;
    }
    await saveConfig(charId, config);
    return payload(charId, config);
  });
}

function outfitName(raw) {
  const name = String(raw ?? '').trim().slice(0, MAX_NAME);
  if (!name) throw new HttpError(400, t('server.sprites.outfit_name_required'));
  return name;
}

const nameTaken = (config, name, exceptId) => config.outfits.some((o) => o.id !== exceptId && o.name.toLowerCase() === name.toLowerCase());

export function createOutfit(charId, body) {
  const name = outfitName(body?.name);
  return mutate(charId, async (config) => {
    if (nameTaken(config, name)) throw new HttpError(409, t('server.sprites.outfit_name_taken'));
    const id = uniqueSlug(slugify(name, 'outfit'), new Set(config.outfits.map((o) => o.id)));
    const outfit = { id, name };
    await fs.mkdir(outfitDir(charId, id), { recursive: true });
    config.outfits.push(outfit);
    await saveConfig(charId, config);
    return outfitPayload(charId, outfit);
  });
}

export function renameOutfit(charId, outfitId, body) {
  const name = outfitName(body?.name);
  return mutate(charId, async (config) => {
    const outfit = findOutfit(config, outfitId);
    if (nameTaken(config, name, outfit.id)) throw new HttpError(409, t('server.sprites.outfit_name_taken'));
    outfit.name = name;
    await saveConfig(charId, config);
    return outfitPayload(charId, outfit);
  });
}

export function deleteOutfit(charId, outfitId) {
  return mutate(charId, async (config) => {
    const outfit = findOutfit(config, outfitId);
    if (config.outfits.length <= 1) throw new HttpError(400, t('server.sprites.last_outfit'));
    config.outfits = config.outfits.filter((o) => o !== outfit);
    if (config.defaultOutfit === outfit.id) config.defaultOutfit = config.outfits[0].id;
    await saveConfig(charId, config);
    await fs.rm(outfitDir(charId, outfit.id), { recursive: true, force: true });
  });
}

/** Guarda una imagen de sprite. `ext` ya viene validada por sniffing. Devuelve el atuendo actualizado. */
export function addSpriteFile(charId, outfitId, { buf, ext, label, filename }) {
  return mutate(charId, async (config) => {
    const outfit = findOutfit(config, outfitId);
    const finalLabel = label ? explicitLabel(label) : deriveLabel(filename);
    if (!LABEL_RE.test(finalLabel)) throw new HttpError(400, t('server.sprites.invalid_label'));
    const dir = outfitDir(charId, outfit.id);
    await fs.mkdir(dir, { recursive: true });
    const taken = new Set((await fs.readdir(dir)).map((n) => n.replace(/\.[^.]*$/, '').toLowerCase()));
    const stem = uniqueSlug(finalLabel, taken);
    await writeFileAtomic(resolveIn(dir, `${stem}.${ext}`), buf);
    if (!DEFAULT_EXPRESSIONS.includes(finalLabel) && !config.customExpressions.includes(finalLabel) && config.customExpressions.length < MAX_CUSTOM) {
      config.customExpressions.push(finalLabel);
      await saveConfig(charId, config);
    }
    return outfitPayload(charId, outfit);
  });
}

function checkFileName(file) {
  if (!FILE_RE.test(String(file ?? ''))) throw new HttpError(400, t('server.sprites.invalid_file'));
  return file;
}

export function deleteSpriteFile(charId, outfitId, file) {
  checkFileName(file);
  return mutate(charId, async (config) => {
    const outfit = findOutfit(config, outfitId);
    const target = resolveIn(outfitDir(charId, outfit.id), file);
    try {
      await fs.unlink(target);
    } catch {
      throw new HttpError(404, t('server.sprites.file_not_found'));
    }
    return outfitPayload(charId, outfit);
  });
}

/** Ruta absoluta de un archivo de sprite (sin comprobar que exista). */
export function spriteFilePath(charId, outfitId, file) {
  checkFileName(file);
  return resolveIn(outfitDir(charId, outfitId), file);
}

/** Quita una estadística de la configuración de todos los personajes. */
export async function removeStatFromSprites(statId) {
  let dirs = [];
  try {
    dirs = await fs.readdir(DIRS.vnSprites);
  } catch {
    return;
  }
  for (const charId of dirs) {
    await withLock(lockKey(charId), async () => {
      const raw = await readJson(configPath(charId), null);
      if (raw && isObj(raw.stats) && Object.hasOwn(raw.stats, statId)) {
        delete raw.stats[statId];
        await writeJson(configPath(charId), raw);
      }
    }).catch(() => {});
  }
}
