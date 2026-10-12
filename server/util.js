import fs from 'node:fs/promises';
import path from 'node:path';

export class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function safeName(name, fallback = 'sin-nombre') {
  const s = String(name ?? '')
    .normalize('NFC')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .replace(/[. ]+$/, '')
    .slice(0, 80);
  return s || fallback;
}

// Resuelve `name` dentro de `dir` y rechaza cualquier intento de salir de la carpeta.
export function resolveIn(dir, name) {
  const base = path.resolve(dir);
  const p = path.resolve(base, String(name ?? ''));
  if (path.dirname(p) !== base) throw new HttpError(400, 'Nombre inválido');
  return p;
}

export async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

export async function readJson(p, fallback = null) {
  try {
    const raw = await fs.readFile(p, 'utf8');
    return JSON.parse(raw.replace(/^\uFEFF/, ''));
  } catch {
    return fallback;
  }
}

export async function writeFileAtomic(p, data) {
  const tmp = `${p}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, data);
  await fs.rename(tmp, p);
}

export function writeJson(p, obj) {
  return writeFileAtomic(p, JSON.stringify(obj, null, 2));
}

const locks = new Map();
export function withLock(key, fn) {
  const prev = locks.get(key) || Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  locks.set(key, next);
  next
    .finally(() => {
      if (locks.get(key) === next) locks.delete(key);
    })
    .catch(() => {});
  return next;
}

export async function uniqueName(dir, base, ext) {
  let name = base;
  let n = 2;
  while (await exists(path.join(dir, name + ext))) name = `${base} (${n++})`;
  return name;
}

export const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export function decodePngDataUrl(dataUrl) {
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl || '');
  if (!m) throw new HttpError(400, 'La imagen debe ser PNG (data URL).');
  return Buffer.from(m[1], 'base64');
}

export const nowIso = () => new Date().toISOString();

export function stamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}@${p(d.getHours())}h${p(d.getMinutes())}m${p(d.getSeconds())}s`;
}
