import { canvasToBlob, canvasToDataUrl, dataUrl, flattenOnColor, loadImage, toCanvas } from '../imageTools.js';

export const itemSrc = (item) => item.url || dataUrl(item.data);

export const itemToCanvas = async (item) => toCanvas(await loadImage(itemSrc(item)));

export const countTags = (text) => String(text ?? '').split(/,|\n/).filter((s) => s.trim()).length;

const slug = (s) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);

export const fileSlug = (s, fallback = 'image') => slug(s) || fallback;

export function downloadItem(item, name) {
  const a = document.createElement('a');
  a.href = itemSrc(item);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** PNG (data URL) de lado máximo 1024 para la imagen de la tarjeta de un personaje. */
export async function cardPngDataUrl(item) {
  return canvasToDataUrl(toCanvas(await itemToCanvas(item), 1024), 'image/png');
}

/** JPEG de ancho máximo `maxWidth` (los fondos no necesitan transparencia y pesan mucho menos). */
export async function backgroundJpegBlob(item, maxWidth = 1920) {
  const src = await itemToCanvas(item);
  const k = src.width > maxWidth ? maxWidth / src.width : 1;
  const sized = k < 1 ? toCanvas(src, Math.round(Math.max(src.width, src.height) * k)) : src;
  return canvasToBlob(flattenOnColor(sized, '#000000'), 'image/jpeg', 0.9);
}

export const roundTo64 = (n) => Math.min(2048, Math.max(64, Math.round(n / 64) * 64));
