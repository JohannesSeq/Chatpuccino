import fs from 'node:fs/promises';
import { getBackground } from './backgrounds.js';
import { listCharacters } from './cards.js';
import { DIRS } from './config.js';
import { t } from './i18n.js';
import { getBookOrNull, listBooks, normalizeBook, saveBook } from './lore.js';
import { peekSprites } from './sprites.js';
import { ensureStat, listStats } from './stats.js';
import { getPersona } from './store.js';
import { HttpError, exists, nowIso, readJson, resolveIn, safeName, withLock, writeJson } from './util.js';
import { slugify, uniqueSlug } from './vn-common.js';

// Plantillas de mundos: la configuración de un mundo (premisa, reparto, estadísticas, lorebooks, fondo…) sin su historia.
// Cada plantilla es data/world-templates/<id>.json. Referencian lo del catálogo por id; al exportar se incluyen las
// definiciones de las estadísticas y el contenido de los lorebooks (los personajes y fondos son imágenes: solo se nombran).

export const TEMPLATE_FORMAT = 'chatpuccino-world-template';
export const TEMPLATE_VERSION = 1;
const LIMITS = { name: 80, description: 8000, list: 200, books: 30, stats: 200 };
const ID_RE = /^[a-z0-9][a-z0-9_-]{0,59}$/;

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const uniq = (list) => [...new Set((Array.isArray(list) ? list : []).filter((x) => typeof x === 'string' && x).map(String))].slice(0, LIMITS.list);
const file = (id) => {
  if (!ID_RE.test(String(id))) throw new HttpError(404, t('server.templates.not_found'));
  return resolveIn(DIRS.worldTemplates, `${id}.json`);
};

/** Normaliza la configuración de una plantilla (sin validar que lo referenciado exista). */
export function cleanTemplate(raw, id, { createdAt, updatedAt } = {}) {
  const r = isObj(raw) ? raw : {};
  const characters = uniq(r.characters);
  const outfits = {};
  for (const [c, o] of Object.entries(isObj(r.outfits) ? r.outfits : {})) if (characters.includes(c) && typeof o === 'string' && o) outfits[c] = o;
  const now = nowIso();
  return {
    id,
    name: String(r.name ?? '').trim().slice(0, LIMITS.name),
    description: String(r.description ?? '').slice(0, LIMITS.description),
    lorebooks: uniq(r.lorebooks),
    statIds: uniq(r.statIds),
    characters,
    active: uniq(r.active).filter((c) => characters.includes(c)),
    background: typeof r.background === 'string' ? r.background : '',
    outfits,
    persona: typeof r.persona === 'string' ? r.persona : '',
    classic: Boolean(r.classic),
    createdAt: createdAt || r.createdAt || now,
    updatedAt: updatedAt || r.updatedAt || createdAt || r.createdAt || now,
  };
}

/** Lo que define a un mundo (sin el nombre): sirve para saber si un mundo es idéntico a su plantilla. */
const signature = (x) =>
  JSON.stringify({
    d: String(x.description ?? '').trim(),
    l: uniq(x.lorebooks).sort(),
    s: uniq(x.statIds).sort(),
    c: uniq(x.characters),
    a: uniq(x.active),
    b: x.background || '',
    o: Object.entries(isObj(x.outfits) ? x.outfits : {}).sort(([a], [b]) => a.localeCompare(b)),
    k: Boolean(x.classic),
    p: x.persona || '',
  });

async function readAllTemplates() {
  let names = [];
  try {
    names = (await fs.readdir(DIRS.worldTemplates)).filter((f) => f.endsWith('.json'));
  } catch {
    return [];
  }
  const out = [];
  for (const f of names) {
    const id = f.slice(0, -5);
    if (!ID_RE.test(id)) continue;
    const raw = await readJson(resolveIn(DIRS.worldTemplates, f));
    if (raw) out.push(cleanTemplate(raw, id));
  }
  return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

async function uniqueName(name, ignoreId = '') {
  const base = String(name || '').trim().slice(0, LIMITS.name) || t('server.templates.default_name');
  const taken = new Set((await readAllTemplates()).filter((x) => x.id !== ignoreId).map((x) => x.name.toLowerCase()));
  let out = base;
  for (let n = 2; taken.has(out.toLowerCase()); n++) out = `${base.slice(0, LIMITS.name - 6)} (${n})`;
  return out;
}

async function newId(name) {
  await fs.mkdir(DIRS.worldTemplates, { recursive: true });
  const taken = new Set((await fs.readdir(DIRS.worldTemplates)).map((n) => n.replace(/\.json$/, '').toLowerCase()));
  return uniqueSlug(slugify(name, 'plantilla'), taken);
}

/** Referencias de una plantilla que ya no existen (o no existen todavía en esta instalación). */
export async function missingRefs(tpl) {
  const [chars, books, stats] = await Promise.all([listCharacters(), listBooks(), listStats()]);
  const haveChars = new Set(chars.map((c) => c.id));
  const haveBooks = new Set(books.map((b) => b.name));
  const haveStats = new Set(stats.map((s) => s.id));
  let background = false;
  if (tpl.background) background = !(await getBackground(tpl.background).catch(() => null));
  let persona = false;
  if (tpl.persona) persona = !(await getPersona(tpl.persona).catch(() => null));
  return {
    characters: tpl.characters.filter((id) => !haveChars.has(id)),
    lorebooks: tpl.lorebooks.filter((n) => !haveBooks.has(n)),
    statIds: tpl.statIds.filter((id) => !haveStats.has(id)),
    background: background ? tpl.background : '',
    persona: persona ? tpl.persona : '',
  };
}

const withMissing = async (tpl) => ({ ...tpl, missing: await missingRefs(tpl) });

export async function listTemplates() {
  return Promise.all((await readAllTemplates()).map(withMissing));
}

export async function getTemplate(id) {
  const raw = await readJson(file(id));
  if (!raw) throw new HttpError(404, t('server.templates.not_found'));
  return cleanTemplate(raw, id);
}

export async function getTemplateDetail(id) {
  return withMissing(await getTemplate(id));
}

/** Guarda una configuración como plantilla nueva (nombre único). */
export function createTemplate(config, { name } = {}) {
  return withLock('world-templates', async () => {
    const finalName = await uniqueName(name || config?.name);
    const id = await newId(finalName);
    const now = nowIso();
    const tpl = cleanTemplate({ ...config, name: finalName }, id, { createdAt: now, updatedAt: now });
    await fs.mkdir(DIRS.worldTemplates, { recursive: true });
    await writeJson(file(id), tpl);
    return tpl;
  });
}

/** Al crear un mundo: guarda su plantilla, salvo que el mundo sea idéntico a la plantilla en la que se basó. Devuelve { id, name } o null. */
export async function autoTemplate(world, basedOnId = '') {
  if (basedOnId) {
    const base = await getTemplate(basedOnId).catch(() => null);
    if (base && signature(base) === signature(world)) return null;
  }
  const tpl = await createTemplate(world, { name: world.name });
  return { id: tpl.id, name: tpl.name };
}

export function updateTemplate(id, body) {
  return withLock('world-templates', async () => {
    const tpl = await getTemplate(id);
    const b = isObj(body) ? body : {};
    if (b.name !== undefined) {
      const name = String(b.name).trim();
      if (!name) throw new HttpError(400, t('server.templates.name_required'));
      if (name.length > LIMITS.name) throw new HttpError(400, t('server.templates.name_too_long', { max: LIMITS.name }));
      const taken = (await readAllTemplates()).some((x) => x.id !== id && x.name.toLowerCase() === name.toLowerCase());
      if (taken) throw new HttpError(409, t('server.templates.name_taken'));
      tpl.name = name;
    }
    if (b.description !== undefined) {
      const description = String(b.description ?? '');
      if (description.length > LIMITS.description) throw new HttpError(400, t('server.templates.description_too_long', { max: LIMITS.description }));
      tpl.description = description;
    }
    tpl.updatedAt = nowIso();
    await writeJson(file(id), tpl);
    return tpl;
  });
}

export async function deleteTemplate(id) {
  const p = file(id);
  if (!(await exists(p))) throw new HttpError(404, t('server.templates.not_found'));
  await fs.unlink(p);
}

/** Atuendos de la plantilla que siguen existiendo para los personajes elegidos (applyConfig rechaza los que no). */
export async function outfitsFor(tpl, characters) {
  const out = {};
  for (const [charId, outfitId] of Object.entries(tpl.outfits)) {
    if (!characters.includes(charId)) continue;
    let list = [];
    try {
      list = (await peekSprites(charId)).outfits || [];
    } catch {
      /* sin sprites */
    }
    if (list.some((o) => o.id === outfitId)) out[charId] = outfitId;
  }
  return out;
}

// ---------- exportar / importar ----------

/** Archivo de exportación: la plantilla, las definiciones de sus estadísticas y el contenido de sus lorebooks. La persona no se exporta. */
export async function exportTemplate(id) {
  const tpl = await getTemplate(id);
  const [allStats, chars] = await Promise.all([listStats(), listCharacters()]);
  const lorebooks = [];
  for (const name of tpl.lorebooks) {
    const book = await getBookOrNull(name);
    if (book) lorebooks.push({ name, book });
  }
  const { id: _id, persona: _persona, createdAt: _c, updatedAt: _u, ...config } = tpl;
  return {
    format: TEMPLATE_FORMAT,
    version: TEMPLATE_VERSION,
    exportedAt: nowIso(),
    template: config,
    stats: allStats.filter((s) => tpl.statIds.includes(s.id)),
    lorebooks,
    // Informativo: los personajes y los fondos son imágenes y no viajan en el archivo (hay que tenerlos con el mismo id).
    characters: tpl.characters.map((cid) => ({ id: cid, name: chars.find((c) => c.id === cid)?.name || cid })),
  };
}

/** Importa un archivo exportado. Crea las estadísticas y lorebooks que falten (nunca pisa los existentes). */
export async function importTemplate(data) {
  if (!isObj(data) || data.format !== TEMPLATE_FORMAT || !isObj(data.template)) throw new HttpError(400, t('server.templates.invalid_file'));
  if (Number(data.version) > TEMPLATE_VERSION) throw new HttpError(400, t('server.templates.newer_version'));
  const cfg = data.template;
  const name = String(cfg.name ?? '').trim();
  if (!name) throw new HttpError(400, t('server.templates.name_required'));

  const created = { stats: 0, lorebooks: 0 };
  const statDefs = (Array.isArray(data.stats) ? data.stats : []).filter(isObj).slice(0, LIMITS.stats);
  for (const def of statDefs) {
    try {
      if ((await ensureStat(def)).created) created.stats++;
    } catch {
      /* definición dañada: se omite y la estadística queda como faltante */
    }
  }
  const lore = (Array.isArray(data.lorebooks) ? data.lorebooks : []).filter((x) => isObj(x) && typeof x.name === 'string' && isObj(x.book)).slice(0, LIMITS.books);
  for (const { name: bookName, book } of lore) {
    const final = safeName(bookName, '');
    if (!final || !uniq(cfg.lorebooks).includes(bookName)) continue;
    if (await getBookOrNull(final)) continue;
    await saveBook(final, normalizeBook(book));
    created.lorebooks++;
  }
  // Los nombres de lorebook se sanean al guardarlos: la plantilla debe apuntar al nombre final.
  const lorebooks = uniq(cfg.lorebooks).map((n) => safeName(n, n));
  const tpl = await createTemplate({ ...cfg, lorebooks, persona: '' }, { name });
  return { template: await withMissing(tpl), created };
}
