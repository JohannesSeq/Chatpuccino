import fs from 'node:fs/promises';
import path from 'node:path';
import { DIRS } from './config.js';
import { embedCard, extractCardText, placeholderPng, isPng } from './png.js';
import { HttpError, resolveIn, safeName, uniqueName, writeFileAtomic, exists, nowIso } from './util.js';

const str = (v) => (typeof v === 'string' ? v : v == null ? '' : String(v));
const strArr = (v) => (Array.isArray(v) ? v.map(str).filter((s) => s !== '') : []);

// Normaliza cualquier variante (V1 plano, V2 o V3) a los campos de `data` de chara_card_v2.
export function normalizeCardData(raw) {
  const src = raw && typeof raw.data === 'object' && raw.data && (raw.spec || raw.data.name !== undefined) ? raw.data : raw || {};
  const ext = { ...(typeof src.extensions === 'object' && src.extensions ? src.extensions : {}) };
  if (src.talkativeness !== undefined && ext.talkativeness === undefined) ext.talkativeness = src.talkativeness;
  if (src.fav !== undefined && ext.fav === undefined) ext.fav = src.fav;
  if (src.world !== undefined && ext.world === undefined) ext.world = src.world;
  const data = {
    ...src,
    name: str(src.name).trim(),
    description: str(src.description),
    personality: str(src.personality),
    scenario: str(src.scenario),
    first_mes: str(src.first_mes),
    mes_example: str(src.mes_example),
    creator_notes: str(src.creator_notes ?? src.creatorcomment),
    system_prompt: str(src.system_prompt),
    post_history_instructions: str(src.post_history_instructions),
    alternate_greetings: strArr(src.alternate_greetings),
    tags: strArr(src.tags),
    creator: str(src.creator),
    character_version: str(src.character_version),
    extensions: ext,
  };
  if (src.character_book && typeof src.character_book === 'object') data.character_book = src.character_book;
  else delete data.character_book;
  delete data.spec;
  delete data.spec_version;
  delete data.creatorcomment;
  delete data.talkativeness;
  delete data.fav;
  delete data.world;
  delete data.avatar;
  delete data.chat;
  delete data.create_date;
  return data;
}

export function buildPayloads(data) {
  const v2 = {
    name: data.name,
    description: data.description,
    personality: data.personality,
    scenario: data.scenario,
    first_mes: data.first_mes,
    mes_example: data.mes_example,
    creatorcomment: data.creator_notes,
    avatar: 'none',
    chat: `${data.name} - ${nowIso()}`,
    talkativeness: String(data.extensions?.talkativeness ?? '0.5'),
    fav: Boolean(data.extensions?.fav),
    tags: data.tags,
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data,
    create_date: nowIso(),
  };
  const v3 = { spec: 'chara_card_v3', spec_version: '3.0', data };
  return { v2, v3 };
}

const cache = new Map();

async function readCardFile(file) {
  const st = await fs.stat(file);
  const hit = cache.get(file);
  if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit;
  let data = null;
  try {
    const text = extractCardText(await fs.readFile(file));
    if (text) data = normalizeCardData(JSON.parse(Buffer.from(text, 'base64').toString('utf8')));
  } catch {
    data = null;
  }
  const entry = { mtimeMs: st.mtimeMs, size: st.size, data };
  cache.set(file, entry);
  return entry;
}

const pngPath = (id) => resolveIn(DIRS.characters, `${id}.png`);

export async function listCharacters() {
  const files = (await fs.readdir(DIRS.characters)).filter((f) => f.toLowerCase().endsWith('.png'));
  const out = [];
  for (const f of files) {
    try {
      const { data, mtimeMs } = await readCardFile(path.join(DIRS.characters, f));
      if (!data) continue;
      out.push({
        id: f.slice(0, -4),
        name: data.name || f.slice(0, -4),
        description: data.description.slice(0, 160),
        tags: data.tags,
        creator: data.creator,
        hasBook: Boolean(data.character_book),
        mtime: mtimeMs,
      });
    } catch {
      /* archivo ilegible: se omite */
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

export async function getCharacter(id) {
  const file = pngPath(id);
  if (!(await exists(file))) throw new HttpError(404, 'Personaje no encontrado');
  const { data, mtimeMs } = await readCardFile(file);
  if (!data) throw new HttpError(422, 'El PNG no contiene datos de personaje');
  return { id, data, mtime: mtimeMs };
}

export function characterPngPath(id) {
  return pngPath(id);
}

async function writeCard(id, data, imageBuf) {
  let png = imageBuf;
  if (!png) {
    try {
      png = await fs.readFile(pngPath(id));
    } catch {
      png = placeholderPng(data.name);
    }
  }
  if (!isPng(png)) throw new HttpError(400, 'La imagen no es un PNG válido');
  const { v2, v3 } = buildPayloads(data);
  await writeFileAtomic(pngPath(id), embedCard(png, v2, v3));
  cache.delete(pngPath(id));
}

export async function createCharacter(rawData, imageBuf) {
  const data = normalizeCardData(rawData);
  if (!data.name) throw new HttpError(400, 'El personaje necesita un nombre');
  const id = await uniqueName(DIRS.characters, safeName(data.name), '.png');
  await writeCard(id, data, imageBuf);
  return getCharacter(id);
}

export async function updateCharacter(id, rawData, imageBuf) {
  await getCharacter(id);
  const data = normalizeCardData(rawData);
  if (!data.name) throw new HttpError(400, 'El personaje necesita un nombre');
  await writeCard(id, data, imageBuf);
  return getCharacter(id);
}

export async function deleteCharacter(id) {
  const file = pngPath(id);
  if (!(await exists(file))) throw new HttpError(404, 'Personaje no encontrado');
  await fs.unlink(file);
  cache.delete(file);
  await fs.rm(resolveIn(DIRS.chats, id), { recursive: true, force: true });
}

export async function importCharacter({ png, json }) {
  if (png) {
    if (!isPng(png)) throw new HttpError(400, 'El archivo no es un PNG válido');
    const text = extractCardText(png);
    if (!text) throw new HttpError(422, 'El PNG no contiene datos de personaje (chara/ccv3)', 'NO_CARD');
    let parsed;
    try {
      parsed = JSON.parse(Buffer.from(text, 'base64').toString('utf8'));
    } catch {
      throw new HttpError(422, 'Los metadatos del PNG están corruptos');
    }
    return createCharacter(parsed, png);
  }
  if (!json || typeof json !== 'object') throw new HttpError(400, 'Archivo de personaje inválido');
  return createCharacter(json, null);
}

export function exportJson(data) {
  return buildPayloads(data).v2;
}
