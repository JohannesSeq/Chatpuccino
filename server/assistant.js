import fs from 'node:fs/promises';
import { ASSISTANT_FILE } from './config.js';
import { normalizeBaseUrl } from './providers.js';
import { HttpError, withLock, writeFileAtomic } from './util.js';

// Configuración del Asistente de personajes. Se guarda en data/assistant.jsonl: una línea JSON por sección
// ({"section":"connection"}, {"section":"prompts"}, {"section":"sampling"}).

export const DEFAULT_PROMPTS = {
  system:
    'Eres un asistente de escritura para creadores de personajes de roleplay (tarjetas de personaje al estilo de SillyTavern). ' +
    'Redactas y mejoras descripciones, personalidades, escenarios, saludos y ejemplos de diálogo de forma clara, evocadora y útil para que un modelo de lenguaje interprete bien al personaje. ' +
    'Respeta los hechos ya establecidos, no introduzcas contradicciones y usa los marcadores {{char}} y {{user}} en lugar de nombres propios cuando sea natural. ' +
    'Escribe en el mismo idioma que el texto o las indicaciones del usuario (español por defecto). ' +
    'Responde únicamente con el texto pedido: sin preámbulos, sin explicaciones y sin encerrarlo entre comillas ni bloques de código.',
  image:
    'Describe con detalle la apariencia física del personaje que aparece en la imagen: edad aparente, complexión, rostro, cabello, ojos, piel, vestimenta, accesorios, postura y rasgos distintivos. ' +
    'Describe solo lo que se ve; no inventes personalidad, nombre ni historia. Escribe en español, en tercera persona y en prosa (uno o dos párrafos), sin encabezados ni listas.',
};

export const SAMPLING_DEFAULTS = {
  temperature: 0.8,
  top_p: 1,
  top_k: 0,
  top_a: 0,
  min_p: 0,
  frequency_penalty: 0,
  presence_penalty: 0,
  repetition_penalty: 1,
  openai_max_tokens: 1000,
};

// [mínimo, máximo] de cada parámetro (los mismos rangos que el editor de presets).
const RANGES = {
  temperature: [0, 2],
  top_p: [0, 1],
  top_k: [0, 200],
  top_a: [0, 1],
  min_p: [0, 1],
  frequency_penalty: [-2, 2],
  presence_penalty: [-2, 2],
  repetition_penalty: [0, 2],
  openai_max_tokens: [16, 32768],
};

export const CONNECTION_DEFAULTS = { type: 'openrouter', baseUrl: '', apiKey: '', model: '', visionModel: '', favorites: [] };

const MAX_PROMPT = 20000;

const clamp = (v, [min, max], fallback) => {
  const n = Number(v);
  return v === '' || v === null || v === undefined || !Number.isFinite(n) ? fallback : Math.min(max, Math.max(min, n));
};

function normalizeConnection(c = {}) {
  return {
    type: c.type === 'local' ? 'local' : 'openrouter',
    baseUrl: String(c.baseUrl || '').trim(),
    apiKey: String(c.apiKey || '').trim(),
    model: String(c.model || '').trim(),
    visionModel: String(c.visionModel || '').trim(),
    favorites: Array.isArray(c.favorites) ? [...new Set(c.favorites.map((m) => String(m).trim()).filter(Boolean))] : [],
  };
}

const normalizePrompts = (p = {}) => ({
  system: typeof p.system === 'string' ? p.system.slice(0, MAX_PROMPT) : DEFAULT_PROMPTS.system,
  image: typeof p.image === 'string' ? p.image.slice(0, MAX_PROMPT) : DEFAULT_PROMPTS.image,
});

function normalizeSampling(s = {}) {
  const out = {};
  for (const [key, def] of Object.entries(SAMPLING_DEFAULTS)) out[key] = clamp(s[key], RANGES[key], def);
  out.openai_max_tokens = Math.round(out.openai_max_tokens);
  return out;
}

function parse(raw) {
  const sections = {};
  for (const line of raw.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const { section, ...rest } = JSON.parse(line);
      if (['connection', 'prompts', 'sampling'].includes(section)) sections[section] = rest;
    } catch {
      /* línea dañada: se ignora y se usan los valores por defecto de esa sección */
    }
  }
  return { connection: normalizeConnection(sections.connection), prompts: normalizePrompts(sections.prompts), sampling: normalizeSampling(sections.sampling) };
}

const serialize = (cfg) =>
  [{ section: 'connection', ...cfg.connection }, { section: 'prompts', ...cfg.prompts }, { section: 'sampling', ...cfg.sampling }].map((o) => JSON.stringify(o)).join('\n') + '\n';

export async function loadAssistant() {
  try {
    return parse(await fs.readFile(ASSISTANT_FILE, 'utf8'));
  } catch {
    return parse('');
  }
}

export function mutateAssistant(fn) {
  return withLock(ASSISTANT_FILE, async () => {
    const cfg = await loadAssistant();
    const result = await fn(cfg);
    await writeFileAtomic(ASSISTANT_FILE, serialize(cfg));
    return result;
  });
}

export function isAssistantReady(cfg, { vision = false } = {}) {
  const c = cfg.connection;
  const model = vision ? c.visionModel || c.model : c.model;
  return Boolean(model && (c.type === 'local' ? c.baseUrl : c.apiKey));
}

/** Conexión lista para usar con providers.js (con el modelo de visión si se pide). */
export function assistantConn(cfg, { vision = false } = {}) {
  const c = cfg.connection;
  return { type: c.type, baseUrl: c.baseUrl, apiKey: c.apiKey, model: vision ? c.visionModel || c.model : c.model };
}

export function requireAssistant(cfg, opts) {
  if (isAssistantReady(cfg, opts)) return assistantConn(cfg, opts);
  const c = cfg.connection;
  const hint = c.type === 'local' ? (c.baseUrl ? 'el modelo' : 'la URL del servidor local') : c.apiKey ? 'el modelo' : 'la API key';
  throw new HttpError(400, `Configura ${hint} del Asistente de personajes (Ajustes → Asistente de personajes).`, 'ASSISTANT_NOT_READY');
}

export function publicAssistant(cfg) {
  const { apiKey, ...conn } = cfg.connection;
  return {
    connection: { ...conn, hasKey: Boolean(apiKey), keyPreview: apiKey ? `${apiKey.slice(0, 7)}…${apiKey.slice(-4)}` : '' },
    prompts: cfg.prompts,
    sampling: cfg.sampling,
    defaults: { prompts: DEFAULT_PROMPTS, sampling: SAMPLING_DEFAULTS },
    ready: isAssistantReady(cfg),
    visionReady: isAssistantReady(cfg, { vision: true }),
  };
}

export function updateAssistant(patch = {}) {
  return mutateAssistant((cfg) => {
    const c = patch.connection;
    if (c && typeof c === 'object') {
      if (c.type !== undefined) cfg.connection.type = c.type === 'local' ? 'local' : 'openrouter';
      if (typeof c.baseUrl === 'string') cfg.connection.baseUrl = c.baseUrl.trim() ? normalizeBaseUrl(c.baseUrl) : '';
      if (typeof c.model === 'string') cfg.connection.model = c.model.trim();
      if (typeof c.visionModel === 'string') cfg.connection.visionModel = c.visionModel.trim();
      if (typeof c.apiKey === 'string') {
        const k = c.apiKey.trim();
        if (k === '__clear__') cfg.connection.apiKey = '';
        else if (k) cfg.connection.apiKey = k;
      }
    }
    if (patch.prompts && typeof patch.prompts === 'object') cfg.prompts = normalizePrompts({ ...cfg.prompts, ...patch.prompts });
    if (patch.sampling && typeof patch.sampling === 'object') cfg.sampling = normalizeSampling({ ...cfg.sampling, ...patch.sampling });
    return cfg;
  });
}

export function toggleAssistantFavorite(model) {
  return mutateAssistant((cfg) => {
    const f = cfg.connection.favorites;
    cfg.connection.favorites = f.includes(model) ? f.filter((m) => m !== model) : [...f, model];
    return cfg.connection.favorites;
  });
}

// ---------- Construcción de peticiones ----------

export const MODES = ['generate', 'improve', 'expand', 'rewrite'];

const MODE_TASK = {
  generate: 'Escribe este campo desde cero a partir del contexto disponible y de las indicaciones.',
  improve: 'Mejora el texto actual: corrige la redacción, la claridad y la coherencia y enriquécelo ligeramente, sin cambiar los hechos ni el tono general.',
  expand: 'Expande el texto actual: añade más detalle y profundidad manteniendo todo lo que ya dice (no elimines información) y el mismo estilo.',
  rewrite: 'Reescribe el texto actual con otras palabras y mejor estilo, conservando íntegros su significado y sus datos.',
};

// Qué es cada campo, para que el modelo sepa qué debe producir.
export const FIELDS = {
  description: ['Descripción', 'Descripción del personaje: quién es, su apariencia, trasfondo, rasgos y cómo se relaciona con los demás. Escrita en tercera persona, usando {{char}}.'],
  personality: ['Personalidad', 'Resumen conciso de la personalidad: rasgos, manías, forma de hablar y valores. Puede ser una lista breve de rasgos.'],
  scenario: ['Escenario', 'Escenario: la situación, el lugar y el contexto en el que empieza la interacción entre {{char}} y {{user}}.'],
  first_mes: ['Primer mensaje', 'Primer mensaje que {{char}} envía al empezar el chat. Debe estar en personaje, invitar a responder y no hablar ni actuar por {{user}}. Acciones entre *asteriscos* y diálogos entre comillas.'],
  alternate_greeting: ['Saludo alternativo', 'Un saludo alternativo para empezar el chat, distinto en situación o tono al primer mensaje pero igualmente en personaje. No hables ni actúes por {{user}}. Acciones entre *asteriscos* y diálogos entre comillas.'],
  mes_example: ['Ejemplos de diálogo', 'Ejemplos de diálogo que muestran la voz del personaje. Cada ejemplo empieza con una línea <START> y alterna líneas «{{user}}: …» y «{{char}}: …».'],
  creator_notes: ['Notas del creador', 'Notas para quien use la tarjeta (no se envían al modelo): de qué trata el personaje, recomendaciones de uso y ajustes sugeridos.'],
  system_prompt: ['Prompt de sistema', 'Prompt de sistema propio de esta tarjeta: instrucciones sobre cómo debe comportarse y escribir el modelo al interpretar a {{char}}.'],
  post_history_instructions: ['Instrucciones posteriores al historial', 'Instrucciones breves que se envían después del historial del chat para reforzar el estilo o las reglas de {{char}}.'],
  persona_description: ['Descripción de la persona', 'Descripción de la persona del usuario (su representación en el roleplay): apariencia, personalidad y trasfondo, usando {{user}}.'],
  image_reading: ['Lectura de imagen', 'Descripción física del personaje a partir de su imagen: edad aparente, complexión, rostro, cabello, ojos, piel, vestimenta y rasgos distintivos.'],
};

const CONTEXT_LABELS = {
  name: 'Nombre',
  tags: 'Etiquetas',
  description: 'Descripción',
  personality: 'Personalidad',
  scenario: 'Escenario',
  first_mes: 'Primer mensaje',
  mes_example: 'Ejemplos de diálogo',
  image_reading: 'Apariencia (lectura de imagen)',
};

const clip = (s, n) => {
  const t = String(s ?? '').trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
};

/** Mensajes para generar o mejorar un campo de una tarjeta o persona. */
export function buildFieldMessages({ prompts, field, mode, text, instructions, context }) {
  const [label, guide] = FIELDS[field];
  const ctx = [];
  for (const [key, title] of Object.entries(CONTEXT_LABELS)) {
    if (key === field) continue;
    const v = Array.isArray(context?.[key]) ? context[key].join(', ') : context?.[key];
    const value = clip(v, 4000);
    if (value) ctx.push(`## ${title}\n${value}`);
  }
  const parts = [
    `Tarea: ${MODE_TASK[mode]}`,
    `Campo: ${label}. ${guide}`,
    ctx.length ? `Contexto del resto de la ficha (solo como referencia):\n\n${ctx.join('\n\n')}` : '',
    mode === 'generate' ? '' : `Texto actual del campo:\n<<<\n${clip(text, 20000)}\n>>>`,
    instructions?.trim() ? `Indicaciones adicionales del usuario: ${clip(instructions, 2000)}` : '',
    'Devuelve únicamente el texto final del campo.',
  ].filter(Boolean);
  return [
    { role: 'system', content: prompts.system },
    { role: 'user', content: parts.join('\n\n') },
  ];
}

/** Mensajes para leer una imagen (formato multimodal de la API de OpenAI). */
export function buildImageMessages({ prompts, image, name, instructions }) {
  const text = [prompts.image, name ? `Nombre del personaje (solo como referencia): ${clip(name, 200)}` : '', instructions?.trim() ? `Indicaciones adicionales: ${clip(instructions, 2000)}` : '']
    .filter(Boolean)
    .join('\n\n');
  return [
    { role: 'system', content: prompts.system },
    { role: 'user', content: [{ type: 'text', text }, { type: 'image_url', image_url: { url: image } }] },
  ];
}

// Algunos modelos envuelven la respuesta en un bloque de código aunque se les pida que no.
export function cleanOutput(text) {
  let t = String(text ?? '').trim();
  const fenced = /^```[a-z]*\n([\s\S]*?)\n?```$/i.exec(t);
  if (fenced) t = fenced[1].trim();
  return t;
}
