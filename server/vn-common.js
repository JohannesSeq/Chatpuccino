// Utilidades comunes de las bibliotecas del Modo Novela (estadísticas, fondos y sprites).
import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { t } from './i18n.js';
import { HttpError } from './util.js';

export const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
export const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'webp', 'gif'];

// Cuerpo binario crudo de cualquier tipo (el parser global solo cubre image/png y octet-stream).
export const rawImageBody = express.raw({ type: () => true, limit: '16mb' });

export function sniffImage(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return null;
  if (buf.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  if (buf.toString('ascii', 0, 3) === 'GIF') return 'gif';
  return null;
}

/** Valida el cuerpo crudo de una subida de imagen y devuelve { buf, ext }. */
export function imageFromBody(body) {
  if (!Buffer.isBuffer(body) || !body.length) throw new HttpError(400, t('server.vnassets.send_octet_stream'));
  if (body.length > MAX_IMAGE_BYTES) throw new HttpError(413, t('server.vnassets.too_large'));
  const ext = sniffImage(body);
  if (!ext) throw new HttpError(415, t('server.vnassets.bad_format'));
  return { buf: body, ext };
}

/** Nombre de archivo de la cabecera X-Filename (URL-encoded), sin carpetas. */
export function uploadFilename(req) {
  const raw = String(req.get('x-filename') || '');
  let name = raw;
  try {
    name = decodeURIComponent(raw);
  } catch {
    /* se usa tal cual */
  }
  return name.split(/[\\/]/).pop().trim();
}

export const stripExt = (name) => String(name ?? '').replace(/\.[A-Za-z0-9]{1,5}$/, '');

/** Slug en minúsculas [a-z0-9_-] a partir de un texto libre. */
export function slugify(text, fallback = '') {
  const s = String(text ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '')
    .slice(0, 40)
    .replace(/[-_]+$/, '');
  return s || fallback;
}

/** `base`, o `base-2`, `base-3`… hasta encontrar uno que no esté en `taken`. */
export function uniqueSlug(base, taken) {
  let id = base;
  let n = 2;
  while (taken.has(id)) id = `${base}-${n++}`;
  return id;
}

/** Envía una imagen con su tipo correcto y caché privada (las URLs llevan ?v=mtime). */
export async function sendImage(res, file, notFoundMessage) {
  try {
    await fs.access(file);
  } catch {
    throw new HttpError(404, notFoundMessage);
  }
  res.sendFile(path.basename(file), {
    root: path.dirname(file),
    cacheControl: false,
    headers: { 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff' },
  });
}

/** Llama a una función de server/worlds.js (limpieza en cascada) si el módulo existe. */
export async function cascadeWorlds(fnName, ...args) {
  let mod;
  try {
    mod = await import('./worlds.js');
  } catch (e) {
    if (e?.code !== 'ERR_MODULE_NOT_FOUND') console.error(`worlds.js: ${e.message}`);
    return;
  }
  try {
    await mod[fnName]?.(...args);
  } catch (e) {
    console.error(`worlds.${fnName}:`, e);
  }
}
