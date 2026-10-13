import fs from 'node:fs/promises';
import { ASSISTANT_FILE } from './config.js';
import { normalizeBaseUrl } from './providers.js';
import { HttpError, withLock, writeFileAtomic } from './util.js';
import { languages, t, tIn } from './i18n.js';

// Configuración del Asistente de personajes. Se guarda en data/assistant.jsonl: una línea JSON por sección
// ({"section":"connection"}, {"section":"prompts"}, {"section":"sampling"}).

// Los textos por defecto dependen del idioma de la interfaz (locales: server.assistant.prompts.*).
const PROMPT_KEYS = { system: 'server.assistant.prompts.system', image: 'server.assistant.prompts.image' };

/** Prompts por defecto en el idioma de la petición en curso. */
export const defaultPrompts = () => ({ system: t(PROMPT_KEYS.system), image: t(PROMPT_KEYS.image) });

// Un prompt guardado igual al de fábrica de cualquier idioma cuenta como «sin personalizar».
const isDefaultPrompt = (name, value) => languages().some(({ code }) => tIn(code, PROMPT_KEYS[name]) === value);

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

function normalizePrompt(name, value) {
  if (typeof value !== 'string' || isDefaultPrompt(name, value)) return t(PROMPT_KEYS[name]);
  return value.slice(0, MAX_PROMPT);
}

const normalizePrompts = (p = {}) => ({ system: normalizePrompt('system', p.system), image: normalizePrompt('image', p.image) });

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
  const hint = t(c.type === 'local' ? (c.baseUrl ? 'server.settings.hint_model' : 'server.settings.hint_local_url') : c.apiKey ? 'server.settings.hint_model' : 'server.settings.hint_api_key');
  throw new HttpError(400, t('server.assistant.not_ready', { hint }), 'ASSISTANT_NOT_READY');
}

export function publicAssistant(cfg) {
  const { apiKey, ...conn } = cfg.connection;
  return {
    connection: { ...conn, hasKey: Boolean(apiKey), keyPreview: apiKey ? `${apiKey.slice(0, 7)}…${apiKey.slice(-4)}` : '' },
    prompts: cfg.prompts,
    sampling: cfg.sampling,
    defaults: { prompts: defaultPrompts(), sampling: SAMPLING_DEFAULTS },
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

// Campos que se pueden generar; su nombre y descripción (para que el modelo sepa qué debe producir) están en
// server.assistant.fields.<campo>.label/guide y se piden al traducir, no al cargar el módulo.
export const FIELDS = [
  'description',
  'personality',
  'scenario',
  'first_mes',
  'alternate_greeting',
  'mes_example',
  'creator_notes',
  'system_prompt',
  'post_history_instructions',
  'persona_description',
  'image_reading',
];

const CONTEXT_KEYS = ['name', 'tags', 'description', 'personality', 'scenario', 'first_mes', 'mes_example', 'image_reading'];

const clip = (s, n) => {
  const text = String(s ?? '').trim();
  return text.length > n ? `${text.slice(0, n)}…` : text;
};

/** Mensajes para generar o mejorar un campo de una tarjeta o persona. */
export function buildFieldMessages({ prompts, field, mode, text, instructions, context }) {
  const label = t(`server.assistant.fields.${field}.label`);
  const guide = t(`server.assistant.fields.${field}.guide`);
  const ctx = [];
  for (const key of CONTEXT_KEYS) {
    if (key === field) continue;
    const v = Array.isArray(context?.[key]) ? context[key].join(', ') : context?.[key];
    const value = clip(v, 4000);
    if (value) ctx.push(`## ${t(`server.assistant.context.${key}`)}\n${value}`);
  }
  const parts = [
    t('server.assistant.msg.task', { task: t(`server.assistant.modes.${mode}`) }),
    t('server.assistant.msg.field', { label, guide }),
    ctx.length ? t('server.assistant.msg.context', { context: ctx.join('\n\n') }) : '',
    mode === 'generate' ? '' : t('server.assistant.msg.current_text', { text: clip(text, 20000) }),
    instructions?.trim() ? t('server.assistant.msg.instructions', { instructions: clip(instructions, 2000) }) : '',
    t('server.assistant.msg.final'),
  ].filter(Boolean);
  return [
    { role: 'system', content: prompts.system },
    { role: 'user', content: parts.join('\n\n') },
  ];
}
/** Mensajes para leer una imagen (formato multimodal de la API de OpenAI). */
export function buildImageMessages({ prompts, image, name, instructions }) {
  const text = [
    prompts.image,
    name ? t('server.assistant.msg.image_name', { name: clip(name, 200) }) : '',
    instructions?.trim() ? t('server.assistant.msg.image_instructions', { instructions: clip(instructions, 2000) }) : '',
  ]
    .filter(Boolean)
    .join('\n\n');
  return [
    { role: 'system', content: prompts.system },
    { role: 'user', content: [{ type: 'text', text }, { type: 'image_url', image_url: { url: image } }] },
  ];
}

// Algunos modelos envuelven la respuesta en un bloque de código aunque se les pida que no.
export function cleanOutput(text) {
  let out = String(text ?? '').trim();
  const fenced = /^```[a-z]*\n([\s\S]*?)\n?```$/i.exec(out);
  if (fenced) out = fenced[1].trim();
  return out;
}
