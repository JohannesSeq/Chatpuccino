import fs from 'node:fs/promises';
import path from 'node:path';
import { DATA } from './config.js';
import { HttpError, readJson, writeFileAtomic, writeJson } from './util.js';

const FILE = path.join(DATA, 'appearance.json');
const WALLPAPER_EXTS = ['jpg', 'png', 'webp', 'gif'];
const FONTS = ['system', 'humanist', 'rounded', 'serif', 'mono', 'handwritten', 'custom'];
const COLOR_KEYS = ['accent', 'mine', 'theirs', 'chat'];

export const DEFAULT_APPEARANCE = {
  mode: 'dark',
  // null = usar el color por defecto del modo
  colors: {
    dark: { accent: null, mine: null, theirs: null, chat: null },
    light: { accent: null, mine: null, theirs: null, chat: null },
  },
  uiFont: 'system',
  msgFont: 'system',
  uiFontCustom: '',
  msgFontCustom: '',
  uiSize: 15,
  msgSize: 15,
  bubbles: { mineOpacity: 100, theirsOpacity: 100, blur: 0, radius: 12 },
  wallpaper: { blur: 0, dim: 30 },
};

const clamp = (v, min, max, fallback) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};
const hex = (v) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v.trim()) ? v.trim().toLowerCase() : null);
const font = (v) => (FONTS.includes(v) ? v : 'system');
// Nombres de familia tipográfica: solo caracteres inofensivos para poder usarlos en CSS.
const family = (v) => (typeof v === 'string' ? v.replace(/[^\p{L}\p{N}\s,'"-]/gu, '').trim().slice(0, 80) : '');

export function normalizeAppearance(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const d = DEFAULT_APPEARANCE;
  const colors = {};
  for (const mode of ['dark', 'light']) {
    colors[mode] = Object.fromEntries(COLOR_KEYS.map((k) => [k, hex(r.colors?.[mode]?.[k])]));
  }
  return {
    mode: ['dark', 'light', 'system'].includes(r.mode) ? r.mode : d.mode,
    colors,
    uiFont: font(r.uiFont),
    msgFont: font(r.msgFont),
    uiFontCustom: family(r.uiFontCustom),
    msgFontCustom: family(r.msgFontCustom),
    uiSize: clamp(r.uiSize, 12, 22, d.uiSize),
    msgSize: clamp(r.msgSize, 12, 28, d.msgSize),
    bubbles: {
      mineOpacity: clamp(r.bubbles?.mineOpacity, 0, 100, 100),
      theirsOpacity: clamp(r.bubbles?.theirsOpacity, 0, 100, 100),
      blur: clamp(r.bubbles?.blur, 0, 24, 0),
      radius: clamp(r.bubbles?.radius, 2, 28, 12),
    },
    wallpaper: {
      blur: clamp(r.wallpaper?.blur, 0, 24, 0),
      dim: clamp(r.wallpaper?.dim, 0, 90, 30),
    },
  };
}

function sniffImage(buf) {
  if (buf.length < 12) return null;
  if (buf.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  if (buf.toString('ascii', 0, 3) === 'GIF') return 'gif';
  return null;
}

const wallpaperPath = (ext) => path.join(DATA, `wallpaper.${ext}`);

export async function findWallpaper() {
  for (const ext of WALLPAPER_EXTS) {
    try {
      const st = await fs.stat(wallpaperPath(ext));
      return { path: wallpaperPath(ext), version: Math.round(st.mtimeMs) };
    } catch {
      /* siguiente extensión */
    }
  }
  return null;
}

export async function getAppearance() {
  const wp = await findWallpaper();
  return { ...normalizeAppearance(await readJson(FILE, {})), hasWallpaper: Boolean(wp), wallpaperVersion: wp?.version ?? 0 };
}

export async function saveAppearance(raw) {
  await writeJson(FILE, normalizeAppearance(raw));
  return getAppearance();
}

async function removeWallpaperFiles() {
  await Promise.all(WALLPAPER_EXTS.map((ext) => fs.rm(wallpaperPath(ext), { force: true })));
}

export async function saveWallpaper(buf) {
  const ext = sniffImage(buf);
  if (!ext) throw new HttpError(415, 'El fondo debe ser una imagen PNG, JPG, WebP o GIF');
  await removeWallpaperFiles();
  await writeFileAtomic(wallpaperPath(ext), buf);
  return getAppearance();
}

export async function deleteWallpaper() {
  await removeWallpaperFiles();
  return getAppearance();
}
