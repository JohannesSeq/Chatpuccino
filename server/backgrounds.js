import fs from 'node:fs/promises';
import { BACKGROUNDS_FILE, DIRS } from './config.js';
import { t } from './i18n.js';
import { imageFromBody, slugify, uniqueSlug } from './vn-common.js';
import { HttpError, readJson, resolveIn, withLock, writeFileAtomic, writeJson } from './util.js';

const MAX_NAME = 60;
const MAX_DESCRIPTION = 2000;
const FILE_RE = /^[a-z0-9_-]+\.(png|jpg|webp|gif)$/;

const text = (v, max) => String(v ?? '').trim().slice(0, max);

async function readAll() {
  const raw = await readJson(BACKGROUNDS_FILE, []);
  return (Array.isArray(raw) ? raw : []).filter(
    (b) => b && typeof b.id === 'string' && /^[a-z0-9_-]+$/.test(b.id) && typeof b.file === 'string' && FILE_RE.test(b.file),
  );
}

const publicBg = (b) => ({
  id: b.id,
  name: b.name || b.id,
  description: b.description || '',
  url: `/api/backgrounds/${encodeURIComponent(b.id)}/image?v=${Math.round(b.mtime || 0)}`,
  mtime: Math.round(b.mtime || 0),
});

export async function listBackgrounds() {
  const all = (await readAll()).map(publicBg);
  return all.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

/** Busca un fondo por id o por nombre (sin distinguir mayúsculas). */
export async function getBackground(idOrName) {
  const key = String(idOrName ?? '').trim().toLowerCase();
  if (!key) return null;
  const all = await readAll();
  const found = all.find((b) => b.id === key) || all.find((b) => String(b.name || '').toLowerCase() === key);
  return found ? publicBg(found) : null;
}

/** Ruta absoluta de la imagen de un fondo, o null. */
export async function backgroundFilePath(id) {
  const found = (await readAll()).find((b) => b.id === id);
  return found ? resolveIn(DIRS.vnBackgrounds, found.file) : null;
}

const nameTaken = (all, name, exceptId) => all.some((b) => b.id !== exceptId && String(b.name).toLowerCase() === name.toLowerCase());

export function createBackground(body, { name, description }) {
  const { buf, ext } = imageFromBody(body);
  return withLock('vn-backgrounds', async () => {
    const all = await readAll();
    let finalName = text(name, MAX_NAME) || t('server.backgrounds.default_name');
    const base = finalName;
    for (let n = 2; nameTaken(all, finalName); n++) finalName = `${base.slice(0, MAX_NAME - 6)} (${n})`;
    const id = uniqueSlug(slugify(finalName, 'fondo'), new Set(all.map((b) => b.id)));
    const file = `${id}.${ext}`;
    const dest = resolveIn(DIRS.vnBackgrounds, file);
    await writeFileAtomic(dest, buf);
    const entry = { id, name: finalName, description: text(description, MAX_DESCRIPTION), file, mtime: Math.round((await fs.stat(dest)).mtimeMs) };
    all.push(entry);
    await writeJson(BACKGROUNDS_FILE, all);
    return publicBg(entry);
  });
}

export function updateBackground(id, raw) {
  return withLock('vn-backgrounds', async () => {
    const all = await readAll();
    const entry = all.find((b) => b.id === id);
    if (!entry) throw new HttpError(404, t('server.backgrounds.not_found'));
    const body = raw && typeof raw === 'object' ? raw : {};
    if (body.name !== undefined) {
      const name = text(body.name, MAX_NAME);
      if (!name) throw new HttpError(400, t('server.backgrounds.name_required'));
      if (nameTaken(all, name, id)) throw new HttpError(409, t('server.backgrounds.name_taken'));
      entry.name = name;
    }
    if (body.description !== undefined) entry.description = text(body.description, MAX_DESCRIPTION);
    await writeJson(BACKGROUNDS_FILE, all);
    return publicBg(entry);
  });
}

export function deleteBackground(id) {
  return withLock('vn-backgrounds', async () => {
    const all = await readAll();
    const entry = all.find((b) => b.id === id);
    if (!entry) throw new HttpError(404, t('server.backgrounds.not_found'));
    await writeJson(BACKGROUNDS_FILE, all.filter((b) => b !== entry));
    await fs.rm(resolveIn(DIRS.vnBackgrounds, entry.file), { force: true });
  });
}
