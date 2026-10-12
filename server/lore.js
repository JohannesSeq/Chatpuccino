import fs from 'node:fs/promises';
import { DIRS } from './config.js';
import { HttpError, resolveIn, safeName, uniqueName, writeJson, readJson, exists } from './util.js';

export const estimateTokens = (s) => Math.ceil((s || '').length / 3.5);

const POSITIONS = { before_char: 0, after_char: 1 };

export function defaultEntry(uid) {
  return {
    uid,
    key: [],
    keysecondary: [],
    comment: '',
    content: '',
    constant: false,
    vectorized: false,
    selective: true,
    selectiveLogic: 0,
    addMemo: true,
    order: 100,
    position: 0,
    disable: false,
    excludeRecursion: false,
    preventRecursion: false,
    delayUntilRecursion: false,
    probability: 100,
    useProbability: true,
    depth: 4,
    group: '',
    groupOverride: false,
    groupWeight: 100,
    scanDepth: null,
    caseSensitive: null,
    matchWholeWords: null,
    useGroupScoring: null,
    automationId: '',
    role: 0,
    sticky: null,
    cooldown: null,
    delay: null,
    displayIndex: uid,
  };
}

const toList = (v) => (Array.isArray(v) ? v.map((s) => String(s).trim()).filter(Boolean) : typeof v === 'string' ? v.split(',').map((s) => s.trim()).filter(Boolean) : []);

function normalizeEntry(raw, uid) {
  const e = { ...defaultEntry(uid), ...raw };
  // Entrada estilo character_book (V2): keys / secondary_keys / enabled / insertion_order
  if (raw.keys !== undefined || raw.insertion_order !== undefined || raw.enabled !== undefined) {
    const x = raw.extensions || {};
    e.key = toList(raw.keys);
    e.keysecondary = toList(raw.secondary_keys);
    e.comment = raw.comment ?? raw.name ?? '';
    e.order = raw.insertion_order ?? e.order;
    e.disable = raw.enabled === false;
    e.selective = raw.selective ?? e.selective;
    e.position = typeof raw.position === 'string' ? POSITIONS[raw.position] ?? 0 : x.position ?? e.position;
    e.depth = x.depth ?? e.depth;
    e.probability = x.probability ?? e.probability;
    e.selectiveLogic = x.selectiveLogic ?? e.selectiveLogic;
    e.excludeRecursion = x.exclude_recursion ?? e.excludeRecursion;
    e.preventRecursion = x.prevent_recursion ?? e.preventRecursion;
    e.role = x.role ?? e.role;
    e.scanDepth = x.scan_depth ?? e.scanDepth;
    e.caseSensitive = raw.case_sensitive ?? x.case_sensitive ?? e.caseSensitive;
    e.matchWholeWords = x.match_whole_words ?? e.matchWholeWords;
    delete e.keys;
    delete e.secondary_keys;
    delete e.enabled;
    delete e.insertion_order;
    delete e.extensions;
    delete e.name;
    delete e.id;
    delete e.case_sensitive;
  }
  e.uid = uid;
  e.key = toList(e.key);
  e.keysecondary = toList(e.keysecondary);
  e.content = typeof e.content === 'string' ? e.content : '';
  e.comment = typeof e.comment === 'string' ? e.comment : '';
  e.order = Number.isFinite(Number(e.order)) ? Number(e.order) : 100;
  e.position = Number.isFinite(Number(e.position)) ? Number(e.position) : 0;
  return e;
}

// Acepta World Info de SillyTavern (entries como objeto o arreglo) o character_book V2.
export function normalizeBook(raw) {
  if (!raw || typeof raw !== 'object') throw new HttpError(400, 'Lorebook inválido');
  const list = Array.isArray(raw.entries) ? raw.entries : Object.values(raw.entries || {});
  const entries = {};
  list.forEach((entry, i) => {
    if (!entry || typeof entry !== 'object') return;
    const uid = Number.isInteger(entry.uid) && entries[entry.uid] === undefined ? entry.uid : (Number.isInteger(entry.id) && entries[entry.id] === undefined ? entry.id : i);
    let finalUid = uid;
    while (entries[finalUid] !== undefined) finalUid++;
    entries[finalUid] = normalizeEntry(entry, finalUid);
  });
  const book = { ...raw, entries };
  if (typeof book.name !== 'string') delete book.name;
  return book;
}

function matchKey(text, rawKey, entry) {
  const key = rawKey.trim();
  if (!key) return false;
  const re = /^\/(.+)\/([a-z]*)$/s.exec(key);
  if (re) {
    try {
      return new RegExp(re[1], re[2]).test(text);
    } catch {
      return false;
    }
  }
  const cs = entry.caseSensitive === true;
  const hay = cs ? text : text.toLowerCase();
  const needle = cs ? key : key.toLowerCase();
  if (entry.matchWholeWords === true) {
    const esc = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?<![\\p{L}\\p{N}_])${esc}(?![\\p{L}\\p{N}_])`, 'u').test(hay);
  }
  return hay.includes(needle);
}

function entryMatches(entry, text) {
  const hit = (k) => matchKey(text, k, entry);
  if (!entry.key.some(hit)) return false;
  if (!entry.selective || entry.keysecondary.length === 0) return true;
  const hits = entry.keysecondary.filter(hit).length;
  switch (entry.selectiveLogic) {
    case 1:
      return hits < entry.keysecondary.length; // NOT ALL
    case 2:
      return hits === 0; // NOT ANY
    case 3:
      return hits === entry.keysecondary.length; // AND ALL
    default:
      return hits > 0; // AND ANY
  }
}

/**
 * @param entries entradas normalizadas (de uno o varios lorebooks)
 * @param messages textos recientes, el más nuevo al final
 */
export function activateEntries(entries, messages, { scanDepth = 4, budgetTokens = 2048, maxRecursion = 3 } = {}) {
  const candidates = entries.filter((e) => !e.disable && e.content.trim());
  const active = new Map();
  const scanFor = (e) => messages.slice(-(Number.isInteger(e.scanDepth) && e.scanDepth > 0 ? e.scanDepth : scanDepth)).join('\n');
  const passes = (e) => !(e.useProbability !== false && e.probability < 100 && Math.random() * 100 >= e.probability);

  for (const e of candidates) {
    if (e.delayUntilRecursion) continue;
    if (e.constant || (e.key.length && entryMatches(e, scanFor(e)))) {
      if (passes(e)) active.set(e, true);
    }
  }

  let recursionText = [...active.keys()].filter((e) => !e.preventRecursion).map((e) => e.content).join('\n');
  for (let pass = 0; pass < maxRecursion && recursionText; pass++) {
    const fresh = [];
    for (const e of candidates) {
      if (active.has(e) || e.excludeRecursion || !e.key.length) continue;
      if (entryMatches(e, recursionText) && passes(e)) fresh.push(e);
    }
    if (!fresh.length) break;
    fresh.forEach((e) => active.set(e, true));
    recursionText = fresh.filter((e) => !e.preventRecursion).map((e) => e.content).join('\n');
  }

  // Presupuesto: las de mayor `order` tienen prioridad; la inserción final va en orden ascendente.
  const byPriority = [...active.keys()].sort((a, b) => b.order - a.order);
  const kept = [];
  let used = 0;
  for (const e of byPriority) {
    const cost = estimateTokens(e.content);
    if (used + cost > budgetTokens && kept.length) continue;
    used += cost;
    kept.push(e);
  }
  return kept.sort((a, b) => a.order - b.order);
}

// ---------- almacenamiento ----------

const bookPath = (name) => resolveIn(DIRS.lorebooks, `${name}.json`);

export async function listBooks() {
  const files = (await fs.readdir(DIRS.lorebooks)).filter((f) => f.endsWith('.json'));
  const out = [];
  for (const f of files) {
    const book = await readJson(resolveIn(DIRS.lorebooks, f));
    if (!book) continue;
    const entries = Array.isArray(book.entries) ? book.entries : Object.values(book.entries || {});
    out.push({ name: f.slice(0, -5), entryCount: entries.length, description: book.description || '' });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

export async function getBook(name) {
  const book = await readJson(bookPath(name));
  if (!book) throw new HttpError(404, 'Lorebook no encontrado');
  return normalizeBook(book);
}

export async function getBookOrNull(name) {
  try {
    return await getBook(name);
  } catch {
    return null;
  }
}

export async function saveBook(name, raw) {
  await writeJson(bookPath(name), normalizeBook(raw));
}

export async function createBook(name, raw = { entries: {} }) {
  const final = await uniqueName(DIRS.lorebooks, safeName(name, 'Lorebook'), '.json');
  await saveBook(final, raw);
  return final;
}

export async function deleteBook(name) {
  if (!(await exists(bookPath(name)))) throw new HttpError(404, 'Lorebook no encontrado');
  await fs.unlink(bookPath(name));
}

export async function renameBook(name, newName) {
  const target = safeName(newName, '');
  if (!target) throw new HttpError(400, 'Nombre inválido');
  if (target === name) return name;
  if (await exists(bookPath(target))) throw new HttpError(409, 'Ya existe un lorebook con ese nombre');
  await fs.rename(bookPath(name), bookPath(target));
  return target;
}
