// Utilidades del Modo Novela compartidas por el cliente y el servidor.
// Formato del guion que escribe el modelo (una "línea" por personaje; varias líneas por mensaje):
//
//   [Luna|joy] *Sonríe.* "¡Bienvenido!"
//   [Kai|surprise] "¿Se conocen?"
//   [Narrator] La sala quedó en silencio.
//   <vn>{"stats":[{"character":"Luna","stat":"affection","change":3,"reason":"…"}],"scene":{"background":"bosque"}}</vn>
//
// El bloque <vn>…</vn> final es de control (no se muestra al usuario).

// Lista de expresiones de SillyTavern (clasificador de emociones por defecto).
export const DEFAULT_EXPRESSIONS = [
  'admiration', 'amusement', 'anger', 'annoyance', 'approval', 'caring', 'confusion', 'curiosity', 'desire', 'disappointment',
  'disapproval', 'disgust', 'embarrassment', 'excitement', 'fear', 'gratitude', 'grief', 'joy', 'love', 'nervousness',
  'optimism', 'pride', 'realization', 'relief', 'remorse', 'sadness', 'surprise', 'neutral',
];

export const DEFAULT_FALLBACK_EXPRESSION = 'neutral';

// Longitud máxima de la descripción de una estadística (es una regla que se envía entera a la IA).
export const STAT_DESCRIPTION_MAX = 8000;

const NARRATOR_NAMES = new Set(['narrator', 'narration', 'narrador', 'narradora', 'narración', 'narracion', 'system', 'sistema']);
export const isNarrator = (name) => !name || NARRATOR_NAMES.has(String(name).trim().toLowerCase());

const TAG = /^[ \t]*\[([^\]|\n]{1,60}?)(?:\|([^\]\n]{0,40}))?\][ \t]*/;

/**
 * Separa el texto del guion en líneas: [{ speaker, expression, text }].
 * `speaker` es el nombre tal como lo escribió el modelo (null = narrador). Las líneas sin etiqueta
 * continúan la anterior; si no hay ninguna anterior son narración.
 */
export function parseScript(text) {
  const lines = [];
  let current = null;
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const m = TAG.exec(raw);
    if (m) {
      const name = m[1].trim();
      current = { speaker: isNarrator(name) ? null : name, expression: (m[2] || '').trim().toLowerCase(), text: raw.slice(m[0].length) };
      lines.push(current);
    } else if (current) {
      current.text += `\n${raw}`;
    } else if (raw.trim()) {
      current = { speaker: null, expression: '', text: raw };
      lines.push(current);
    }
  }
  return lines.map((l) => ({ ...l, text: l.text.trim() })).filter((l) => l.text);
}

const CONTROL_OPEN = '<vn>';

/**
 * Separa el guion del bloque de control. Devuelve { script, control, raw }:
 * `control` es el objeto JSON (o null si no hay bloque o no es válido) y `raw` el texto del bloque.
 */
export function splitControl(text) {
  const s = String(text ?? '');
  const start = s.search(/<vn>/i);
  if (start < 0) return { script: s.trim(), control: null, raw: '' };
  const script = s.slice(0, start).trim();
  const rest = s.slice(start + CONTROL_OPEN.length);
  const end = rest.search(/<\/vn>/i);
  const raw = (end < 0 ? rest : rest.slice(0, end)).trim();
  let control = null;
  try {
    const json = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    const parsed = JSON.parse(json);
    control = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    /* bloque dañado o incompleto */
  }
  return { script, control, raw };
}

/** Parte visible de un texto en streaming: oculta el bloque de control (y un posible inicio de `<vn>`). */
export function streamVisible(text) {
  const s = String(text ?? '');
  const open = s.search(/<vn/i);
  if (open >= 0) return s.slice(0, open);
  for (let n = Math.min(3, s.length); n > 0; n--) {
    if (CONTROL_OPEN.slice(0, n).toLowerCase() === s.slice(-n).toLowerCase()) return s.slice(0, -n);
  }
  return s;
}

/** Busca el personaje de `cast` ([{ id, name }]) al que se refiere `name` (sin distinguir mayúsculas, acepta solo el nombre de pila). */
export function findCharacter(cast, name) {
  const n = String(name ?? '').trim().toLowerCase();
  if (!n) return null;
  return (
    cast.find((c) => c.name.toLowerCase() === n || c.id.toLowerCase() === n) ||
    cast.find((c) => c.name.toLowerCase().split(/\s+/)[0] === n) ||
    cast.find((c) => n.split(/\s+/)[0] === c.name.toLowerCase().split(/\s+/)[0]) ||
    null
  );
}

/**
 * Elige el archivo de sprite para una expresión, igual que SillyTavern:
 * expresión pedida → expresión de respaldo → neutral → cualquiera → null (se usa el avatar del personaje).
 * `expressions` es { etiqueta: [{ file, url }] }; entre las variantes de una etiqueta se elige una al azar con `rand`.
 */
export function pickSprite(expressions, label, fallback = DEFAULT_FALLBACK_EXPRESSION, rand = Math.random) {
  const exprs = expressions || {};
  const has = (l) => Array.isArray(exprs[l]) && exprs[l].length > 0;
  const chosen = [String(label || '').toLowerCase(), fallback, DEFAULT_FALLBACK_EXPRESSION].find((l) => l && has(l)) || Object.keys(exprs).find(has);
  if (!chosen) return null;
  const variants = exprs[chosen];
  return { label: chosen, ...variants[Math.floor(rand() * variants.length)] };
}
