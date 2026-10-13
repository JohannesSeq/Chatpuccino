import { STATS_FILE } from './config.js';
import { t } from './i18n.js';
import { slugify, uniqueSlug } from './vn-common.js';
import { HttpError, readJson, withLock, writeJson } from './util.js';

const MAX_NAME = 60;
const MAX_DESCRIPTION = 2000;
const MAX_ABS = 1e9;
export const STAT_SCOPES = ['character', 'world'];

function number(v, fallback) {
  if (v === undefined || v === null || v === '') return fallback;
  const n = Number(v);
  if (!Number.isFinite(n) || Math.abs(n) > MAX_ABS) throw new HttpError(400, t('server.stats.invalid_number'));
  return n;
}

/** Acota `value` al rango de la estadística (si no es un número válido usa el valor por defecto). */
export function clampStat(stat, value) {
  const n = Number(value);
  const v = Number.isFinite(n) ? n : Number(stat.default);
  return Math.round(Math.min(stat.max, Math.max(stat.min, v)) * 100) / 100;
}

/** Valida y normaliza una estadística (lanza 400 si es inválida). El id queda vacío si no viene uno válido. */
export function normalizeStat(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const name = String(r.name ?? '').trim().slice(0, MAX_NAME);
  if (!name) throw new HttpError(400, t('server.stats.name_required'));
  const scope = r.scope === undefined || r.scope === null || r.scope === '' ? 'character' : r.scope;
  if (!STAT_SCOPES.includes(scope)) throw new HttpError(400, t('server.stats.invalid_scope'));
  const min = number(r.min, 0);
  const max = number(r.max, 100);
  if (!(min < max)) throw new HttpError(400, t('server.stats.invalid_range'));
  const color = typeof r.color === 'string' ? r.color.trim() : '';
  if (color && !/^#[0-9a-f]{6}$/i.test(color)) throw new HttpError(400, t('server.stats.invalid_color'));
  const stat = {
    id: typeof r.id === 'string' ? slugify(r.id) : '',
    name,
    description: String(r.description ?? '').trim().slice(0, MAX_DESCRIPTION),
    scope,
    min,
    max,
    default: 0,
    color: color.toLowerCase(),
  };
  stat.default = clampStat(stat, number(r.default, (min + max) / 2));
  return stat;
}

async function readAll() {
  const raw = await readJson(STATS_FILE, []);
  const out = [];
  for (const item of Array.isArray(raw) ? raw : []) {
    try {
      const stat = normalizeStat(item);
      if (stat.id) out.push(stat);
    } catch {
      /* entrada dañada: se omite */
    }
  }
  return out;
}

export const listStats = () => readAll();

export async function getStat(id) {
  const key = String(id ?? '');
  return (await readAll()).find((s) => s.id === key) || null;
}

export function createStat(raw) {
  return withLock('vn-stats', async () => {
    const stat = normalizeStat(raw);
    const all = await readAll();
    stat.id = uniqueSlug(slugify(stat.name, 'stat'), new Set(all.map((s) => s.id)));
    all.push(stat);
    await writeJson(STATS_FILE, all);
    return stat;
  });
}

export function updateStat(id, raw) {
  return withLock('vn-stats', async () => {
    const all = await readAll();
    const i = all.findIndex((s) => s.id === id);
    if (i < 0) throw new HttpError(404, t('server.stats.not_found'));
    const body = raw && typeof raw === 'object' ? raw : {};
    all[i] = { ...normalizeStat({ ...all[i], ...body }), id };
    await writeJson(STATS_FILE, all);
    return all[i];
  });
}

export function deleteStat(id) {
  return withLock('vn-stats', async () => {
    const all = await readAll();
    const next = all.filter((s) => s.id !== id);
    if (next.length === all.length) throw new HttpError(404, t('server.stats.not_found'));
    await writeJson(STATS_FILE, next);
  });
}
