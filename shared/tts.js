// Narración por voz: decide QUÉ se lee y con QUÉ voz (cliente y pruebas del servidor comparten este código).
//
// Regla base: el texto entre comillas rectas "así" lo dice el personaje; lo que queda fuera (acciones, descripción…) lo lee el narrador,
// que se puede desactivar. Nunca se lee la información interna: etiquetas del guion como [Luna|joy] o [Narrator], el bloque <vn>…</vn>,
// bloques de código, HTML ni emojis.

export const NARRATOR_VOICE = 'narrator';
export const USER_VOICE = 'user';
export const charVoice = (id) => `char:${id}`;

const WORDY = /[\p{L}\p{N}]/u;
const FENCE = /```[\s\S]*?(?:```|$)/g;
const EMOJI = /[\p{Extended_Pictographic}\uFE0F\u200D]/gu;

/** Quita todo lo que no debe pronunciarse (conserva las comillas y los asteriscos, que sirven para repartir las voces). */
export function cleanForSpeech(text, { skipCode = true } = {}) {
  let s = String(text ?? '');
  s = s.replace(/<vn>[\s\S]*?(?:<\/vn>|$)/gi, ' ');
  if (skipCode) s = s.replace(FENCE, ' ').replace(/`([^`\n]*)`/g, '$1');
  return s
    .replace(/<\/?[a-z][^>\n]{0,200}>/gi, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]\n]+)\]\([^)\n]*\)/g, '$1')
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(EMOJI, '')
    .replace(/\r/g, '');
}

// Marcas de formato que no se pronuncian.
const stripMarks = (s) =>
  s
    .replace(/\*+/g, '')
    .replace(/~~/g, '')
    .replace(/(^|\n)[ \t]*(#{1,6}|>)[ \t]+/g, '$1')
    .replace(/(^|[\s(])_+([^_\s][^_\n]*?)_+(?=$|[\s).,;:!?])/g, '$1$2')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();

// Alterna `inside` cada vez que aparece `mark`; un cierre que falta deja el resto dentro.
function splitBy(s, mark) {
  const parts = [];
  let inside = false;
  let buf = '';
  for (const ch of s) {
    if (ch === mark) {
      parts.push({ inside, text: buf });
      buf = '';
      inside = !inside;
    } else buf += ch;
  }
  parts.push({ inside, text: buf });
  return parts;
}

/**
 * Reparte un texto en tramos: [{ role: 'narrator' | 'speech', text }].
 * - Con comillas rectas: lo citado es `speech`, el resto `narrator`.
 * - Sin ninguna comilla: todo es `narrator`, salvo que `unquotedSpeech` sea true; entonces lo que NO está entre *asteriscos* es
 *   `speech` y lo que sí está es `narrator` (convención de SillyTavern).
 * - `allNarrator`: todo es narración (líneas del narrador del Modo Novela); las comillas solo se quitan.
 */
export function splitRoles(text, { skipCode = true, unquotedSpeech = false, allNarrator = false } = {}) {
  const s = cleanForSpeech(text, { skipCode });
  let raw;
  if (allNarrator) raw = [{ role: 'narrator', text: s.replace(/"/g, '') }];
  else if (s.includes('"')) raw = splitBy(s, '"').map((p) => ({ role: p.inside ? 'speech' : 'narrator', text: p.text }));
  else if (unquotedSpeech) raw = splitBy(s, '*').map((p) => ({ role: p.inside ? 'narrator' : 'speech', text: p.text }));
  else raw = [{ role: 'narrator', text: s }];

  const out = [];
  for (const part of raw) {
    const clean = stripMarks(part.text);
    if (!WORDY.test(clean)) continue;
    const last = out.at(-1);
    if (last && last.role === part.role) last.text += ` ${clean}`;
    else out.push({ role: part.role, text: clean });
  }
  return out;
}

/**
 * Pasos de narración de un texto: [{ voice, text }], donde `voice` es 'narrator' o la clave de voz de quien habla
 * (`char:<id>` o 'user'). `kind`: 'character' | 'user' | 'narrator' (línea del narrador).
 * `narrator: false` omite todo lo que leería el narrador.
 */
export function narrationSteps(text, { kind = 'character', speakerKey = null, narrator = true, unquoted = 'narrator', skipCode = true } = {}) {
  const roles = splitRoles(text, {
    skipCode,
    allNarrator: kind === 'narrator',
    // Lo que escribe el usuario sin comillas es su propia frase; el resto depende del ajuste.
    unquotedSpeech: kind === 'user' || unquoted === 'speech',
  });
  const steps = [];
  for (const r of roles) {
    const voice = r.role === 'narrator' ? NARRATOR_VOICE : speakerKey;
    if (!voice || (voice === NARRATOR_VOICE && !narrator)) continue;
    const last = steps.at(-1);
    if (last && last.voice === voice) last.text += ` ${r.text}`;
    else steps.push({ voice, text: r.text });
  }
  return steps;
}

/** Parte un texto en trozos de como mucho `max` caracteres, cortando en finales de frase (y si no, en espacios). */
export function chunkText(text, max = 250) {
  const s = String(text ?? '').trim();
  if (!s) return [];
  if (s.length <= max) return [s];
  // Sin lookbehind (los Safari antiguos no lo admiten): se marca el corte tras cada final de frase.
  const sentences = s.replace(/([.!?…。！？]+)\s+/g, '$1\u0000').split(/\u0000|\n+/).filter(Boolean);
  const chunks = [];
  let cur = '';
  const push = () => {
    if (cur) chunks.push(cur);
    cur = '';
  };
  for (let sentence of sentences) {
    while (sentence.length > max) {
      let cut = sentence.lastIndexOf(' ', max);
      if (cut < max * 0.4) cut = max;
      push();
      chunks.push(sentence.slice(0, cut).trim());
      sentence = sentence.slice(cut).trim();
    }
    if (!sentence) continue;
    if (cur && cur.length + 1 + sentence.length > max) push();
    cur = cur ? `${cur} ${sentence}` : sentence;
  }
  push();
  return chunks;
}
