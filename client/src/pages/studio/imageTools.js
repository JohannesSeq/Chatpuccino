// Herramientas de imagen del Estudio (todo en el navegador, con canvas): sin dependencias externas.

export const dataUrl = (b64, type = 'image/png') => `data:${type};base64,${b64}`;
export const stripDataUrl = (url) => String(url ?? '').replace(/^data:[^;]+;base64,/, '');

export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('No se pudo cargar la imagen'));
    img.src = src;
  });
}

export const blobToDataUrl = (blob) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

/** Dibuja una imagen/canvas en un canvas nuevo, con un lado máximo opcional. */
export function toCanvas(source, maxSide = 0) {
  const sw = source.naturalWidth || source.width;
  const sh = source.naturalHeight || source.height;
  const k = maxSide && Math.max(sw, sh) > maxSide ? maxSide / Math.max(sw, sh) : 1;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(sw * k));
  canvas.height = Math.max(1, Math.round(sh * k));
  canvas.getContext('2d').drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

export async function srcToCanvas(src, maxSide = 0) {
  return toCanvas(await loadImage(src), maxSide);
}

export const canvasToDataUrl = (canvas, type = 'image/png', quality = 0.92) => canvas.toDataURL(type, quality);

export const canvasToBlob = (canvas, type = 'image/png', quality = 0.92) =>
  new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('No se pudo codificar la imagen'))), type, quality));

/** Archivo para subir con api.uploadSprite / api.uploadBackground (necesitan `.name` y `.arrayBuffer()`). */
export async function canvasToFile(canvas, name, type = 'image/png') {
  return new File([await canvasToBlob(canvas, type)], name, { type });
}

/** Fracción de píxeles (0–1) con transparencia apreciable. */
export function transparencyRatio(canvas) {
  const { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
  let n = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] < 250) n++;
  return n / (data.length / 4);
}

/** ¿La imagen tiene un fondo transparente real? (al menos un 2 % de píxeles transparentes). */
export const hasTransparency = (canvas) => transparencyRatio(canvas) > 0.02;

/** Copia sobre un color sólido (Stable Diffusion no entiende la transparencia). */
export function flattenOnColor(canvas, color = '#ffffff') {
  const out = document.createElement('canvas');
  out.width = canvas.width;
  out.height = canvas.height;
  const ctx = out.getContext('2d');
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(canvas, 0, 0);
  return out;
}

/** Devuelve `result` (reescalado si hace falta) con el canal alfa de `alphaSource`: así el resultado conserva la silueta original. */
export function applyAlphaFrom(result, alphaSource) {
  const w = alphaSource.width;
  const h = alphaSource.height;
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const ctx = out.getContext('2d');
  ctx.drawImage(result, 0, 0, w, h);
  const img = ctx.getImageData(0, 0, w, h);
  const alpha = alphaSource.getContext('2d').getImageData(0, 0, w, h).data;
  for (let i = 3; i < img.data.length; i += 4) img.data[i] = alpha[i];
  ctx.putImageData(img, 0, 0);
  return out;
}

/** Color más frecuente (cuantizado) del borde de la imagen: normalmente el del fondo. */
export function estimateBorderColor(canvas) {
  const { width: w, height: h } = canvas;
  const { data } = canvas.getContext('2d').getImageData(0, 0, w, h);
  const counts = new Map();
  const add = (x, y) => {
    const i = (y * w + x) * 4;
    if (data[i + 3] < 128) return;
    const key = ((data[i] >> 4) << 8) | ((data[i + 1] >> 4) << 4) | (data[i + 2] >> 4);
    const e = counts.get(key) || { n: 0, r: 0, g: 0, b: 0 };
    e.n++;
    e.r += data[i];
    e.g += data[i + 1];
    e.b += data[i + 2];
    counts.set(key, e);
  };
  for (let x = 0; x < w; x++) {
    add(x, 0);
    add(x, h - 1);
  }
  for (let y = 1; y < h - 1; y++) {
    add(0, y);
    add(w - 1, y);
  }
  let best = null;
  for (const e of counts.values()) if (!best || e.n > best.n) best = e;
  return best ? [Math.round(best.r / best.n), Math.round(best.g / best.n), Math.round(best.b / best.n)] : [255, 255, 255];
}

export const hexToRgb = (hex) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
export const rgbToHex = ([r, g, b]) => `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;

function boxBlur(src, w, h, r) {
  if (r < 1) return src;
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  const size = r * 2 + 1;
  for (let y = 0; y < h; y++) {
    let sum = 0;
    for (let x = -r; x <= r; x++) sum += src[y * w + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) {
      tmp[y * w + x] = sum / size;
      sum += src[y * w + Math.min(w - 1, x + r + 1)] - src[y * w + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let y = -r; y <= r; y++) sum += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = sum / size;
      sum += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
    }
  }
  return out;
}

/**
 * Quita un fondo de color casi uniforme (el que Stable Diffusion deja con «simple background»).
 * `color`: [r,g,b] (o null = el del borde). `tolerance` 0–100. `feather`: suavizado del borde en píxeles (0–6).
 * `contiguous`: solo borra el fondo conectado con los bordes (conserva, p. ej., el blanco de los ojos).
 * Devuelve un canvas nuevo con transparencia y el borde «limpio» (sin halo del color de fondo).
 */
export function removeBackgroundByColor(canvas, { color = null, tolerance = 30, feather = 1, contiguous = true } = {}) {
  const w = canvas.width;
  const h = canvas.height;
  const ctx = canvas.getContext('2d');
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const bg = color || estimateBorderColor(canvas);
  const thr = Math.max(0, tolerance) * 2.2;
  const thr2 = thr * thr;
  const match = (p) => {
    const i = p * 4;
    if (d[i + 3] < 8) return true;
    const dr = d[i] - bg[0];
    const dg = d[i + 1] - bg[1];
    const db = d[i + 2] - bg[2];
    return dr * dr + dg * dg + db * db <= thr2;
  };

  const isBg = new Uint8Array(w * h);
  if (contiguous) {
    const stack = [];
    const push = (p) => {
      if (!isBg[p] && match(p)) {
        isBg[p] = 1;
        stack.push(p);
      }
    };
    for (let x = 0; x < w; x++) {
      push(x);
      push((h - 1) * w + x);
    }
    for (let y = 0; y < h; y++) {
      push(y * w);
      push(y * w + w - 1);
    }
    while (stack.length) {
      const p = stack.pop();
      const x = p % w;
      if (x > 0) push(p - 1);
      if (x < w - 1) push(p + 1);
      if (p >= w) push(p - w);
      if (p < w * (h - 1)) push(p + w);
    }
  } else {
    for (let p = 0; p < w * h; p++) if (match(p)) isBg[p] = 1;
  }

  // Alfa suave: el fondo vale 1; se desenfoca la máscara para ablandar el contorno.
  let mask = new Float32Array(w * h);
  for (let p = 0; p < mask.length; p++) mask[p] = isBg[p];
  const r = Math.round(Math.min(6, Math.max(0, feather)));
  if (r) mask = boxBlur(mask, w, h, r);
  for (let p = 0; p < mask.length; p++) {
    const i = p * 4;
    const a = isBg[p] ? 0 : Math.round(255 * (1 - mask[p] * (r ? 1.15 : 1)));
    const alpha = Math.max(0, Math.min(255, Math.min(a, d[i + 3])));
    if (alpha > 0 && alpha < 255) {
      // quita del color el aporte del fondo: c = (c − bg·(1 − a)) / a
      const k = alpha / 255;
      for (let c = 0; c < 3; c++) d[i + c] = Math.max(0, Math.min(255, Math.round((d[i + c] - bg[c] * (1 - k)) / k)));
    }
    d[i + 3] = alpha;
  }
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  out.getContext('2d').putImageData(img, 0, 0);
  return out;
}

/** Recorta el espacio transparente que rodea al personaje (deja `padding` píxeles). */
export function trimTransparent(canvas, padding = 8) {
  const w = canvas.width;
  const h = canvas.height;
  const { data } = canvas.getContext('2d').getImageData(0, 0, w, h);
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > 12) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return canvas;
  const x0 = Math.max(0, minX - padding);
  const y0 = Math.max(0, minY - padding);
  const x1 = Math.min(w, maxX + 1 + padding);
  const y1 = Math.min(h, maxY + 1 + padding);
  const out = document.createElement('canvas');
  out.width = x1 - x0;
  out.height = y1 - y0;
  out.getContext('2d').drawImage(canvas, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}

/** Región de la cara (proporciones: cx, rx respecto al ancho; cy, ry respecto al alto) → elipse en píxeles. */
export const regionToEllipse = (region, w, h) => ({ x: region.cx * w, y: region.cy * h, rx: region.rx * w, ry: region.ry * h });

/**
 * Máscara para el inpaint (blanco = se regenera): elipse de la cara + trazos.
 * `strokes` es un canvas del mismo tamaño con los trazos pintados en blanco (añadir) y en rojo (quitar), o null.
 */
export function buildMask(w, h, region, strokes = null) {
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const ctx = out.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w, h);
  if (region) {
    const e = regionToEllipse(region, w, h);
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.ellipse(e.x, e.y, e.rx, e.ry, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  if (strokes) {
    const img = ctx.getImageData(0, 0, w, h);
    const s = strokes.getContext('2d').getImageData(0, 0, w, h).data;
    for (let i = 0; i < s.length; i += 4) {
      if (s[i + 3] < 128) continue;
      const v = s[i + 1] > 128 ? 255 : 0; // blanco (verde alto) añade; rojo quita
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    }
    ctx.putImageData(img, 0, 0);
  }
  return out;
}

/** ¿La máscara tiene algún píxel blanco? */
export function maskHasContent(canvas) {
  const { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
  for (let i = 0; i < data.length; i += 4) if (data[i] > 127) return true;
  return false;
}
