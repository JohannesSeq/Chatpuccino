import fs from 'node:fs/promises';
import { DIRS, SETTINGS_FILE } from './config.js';
import { HttpError, exists, readJson, resolveIn, safeName, uniqueName, withLock, writeJson } from './util.js';
import { t } from './i18n.js';

export const DEFAULT_SYSTEM_PROMPT =
  "Write {{char}}'s next reply in a fictional roleplay chat between {{char}} and {{user}}. Stay in character and write in a natural, immersive instant-messaging style. Never write dialogue, actions or thoughts for {{user}}. Reply in the same language {{user}} writes in.";

// Prompts "marcador": su contenido sale de la tarjeta, la persona, el lorebook o el chat.
export const MARKERS = {
  charDescription: 'Character Description',
  charPersonality: 'Character Personality',
  scenario: 'Scenario',
  personaDescription: 'Persona Description',
  worldInfoBefore: 'World Info (before)',
  worldInfoAfter: 'World Info (after)',
  dialogueExamples: 'Chat Examples',
  chatHistory: 'Chat History',
};

export const PARAM_DEFAULTS = {
  temperature: 0.9,
  top_p: 1,
  top_k: 0,
  top_a: 0,
  min_p: 0,
  frequency_penalty: 0,
  presence_penalty: 0,
  repetition_penalty: 1,
  openai_max_context: 16000,
  openai_max_tokens: 400,
};

// Valores por defecto de SillyTavern para campos que un preset importado no traiga.
const ST_TEXT_DEFAULTS = {
  new_chat_prompt: '[Start a new Chat]',
  new_group_chat_prompt: '[Start a new group chat. Group members: {{group}}]',
  new_example_chat_prompt: '[Example Chat]',
  group_nudge_prompt: '[Write the next reply only as {{char}}.]',
  impersonation_prompt:
    "[Write your next reply from the point of view of {{user}}, using the preceding context so far as references. Write only {{user}}'s reply; do not write anything as {{char}}.]",
  wi_format: '{0}',
  scenario_format: '{{scenario}}',
  personality_format: '{{personality}}',
};

const ROLES = ['system', 'user', 'assistant'];
const ORDER_IDS = [100000, 100001];

const marker = (identifier) => ({ identifier, name: MARKERS[identifier], system_prompt: true, marker: true });

function defaultPrompts() {
  return [
    { identifier: 'main', name: 'Main Prompt', system_prompt: true, role: 'system', content: DEFAULT_SYSTEM_PROMPT },
    { identifier: 'nsfw', name: 'Auxiliary Prompt', system_prompt: true, role: 'system', content: '' },
    marker('dialogueExamples'),
    { identifier: 'jailbreak', name: 'Post-History Instructions', system_prompt: true, role: 'system', content: '' },
    marker('chatHistory'),
    marker('worldInfoAfter'),
    marker('worldInfoBefore'),
    {
      identifier: 'enhanceDefinitions',
      name: 'Enhance Definitions',
      system_prompt: true,
      role: 'system',
      content: "If you have more knowledge of {{char}}, add to the character's lore and personality to enhance them but keep the Character Sheet's definitions absolute.",
    },
    marker('charDescription'),
    marker('charPersonality'),
    marker('scenario'),
    marker('personaDescription'),
  ];
}

const DEFAULT_ORDER = [
  ['main', true],
  ['worldInfoBefore', true],
  ['personaDescription', true],
  ['charDescription', true],
  ['charPersonality', true],
  ['scenario', true],
  ['enhanceDefinitions', false],
  ['nsfw', true],
  ['worldInfoAfter', true],
  ['dialogueExamples', true],
  ['chatHistory', true],
  ['jailbreak', true],
].map(([identifier, enabled]) => ({ identifier, enabled }));

const num = (v, fallback) => (v !== undefined && v !== null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : fallback);
const text = (v, fallback) => (typeof v === 'string' ? v : fallback);

function normalizePrompt(p, index) {
  const identifier = String(p.identifier ?? `prompt-${index}`);
  return {
    ...p,
    identifier,
    name: String(p.name ?? identifier),
    role: ROLES.includes(p.role) ? p.role : 'system',
    content: typeof p.content === 'string' ? p.content : '',
    marker: Boolean(p.marker) || identifier in MARKERS,
    system_prompt: Boolean(p.system_prompt),
    injection_position: p.injection_position === 1 ? 1 : 0,
    injection_depth: num(p.injection_depth, 4),
    injection_order: num(p.injection_order, 100),
    injection_trigger: Array.isArray(p.injection_trigger) ? p.injection_trigger.map(String) : [],
    forbid_overrides: Boolean(p.forbid_overrides),
  };
}

// SillyTavern guarda el orden por personaje (100000 = global, 100001 = usuario). Aquí se usa uno solo.
function pickOrder(raw) {
  const list = Array.isArray(raw.prompt_order) ? raw.prompt_order : [];
  if (list.length && list[0]?.identifier !== undefined) return list;
  const pick = list.find((o) => o?.character_id === 100001) || list.find((o) => o?.character_id === 100000) || list[0];
  return Array.isArray(pick?.order) ? pick.order : null;
}

function normalizeOrder(rawOrder, prompts) {
  const known = new Set(prompts.map((p) => p.identifier));
  const seen = new Set();
  const order = [];
  for (const o of rawOrder || []) {
    const identifier = String(o?.identifier ?? '');
    if (!known.has(identifier) || seen.has(identifier)) continue;
    seen.add(identifier);
    order.push({ identifier, enabled: o.enabled !== false });
  }
  if (!rawOrder) {
    for (const o of DEFAULT_ORDER) {
      if (!known.has(o.identifier) || seen.has(o.identifier)) continue;
      seen.add(o.identifier);
      order.push({ ...o });
    }
  }
  // Un prompt que no esté en el orden queda desactivado, salvo el historial, que nunca debe perderse.
  for (const p of prompts) if (!seen.has(p.identifier)) order.push({ identifier: p.identifier, enabled: p.identifier === 'chatHistory' });
  return order;
}

export function normalizePreset(raw, { builtin = false } = {}) {
  const src = raw && typeof raw === 'object' ? { ...raw } : {};
  // Presets de completado de texto / antiguos usan otros nombres.
  if (src.temperature === undefined && src.temp !== undefined) src.temperature = src.temp;
  if (src.repetition_penalty === undefined && src.rep_pen !== undefined) src.repetition_penalty = src.rep_pen;
  if (src.openai_max_tokens === undefined && src.genamt !== undefined) src.openai_max_tokens = src.genamt;
  if (src.openai_max_context === undefined && src.max_length !== undefined) src.openai_max_context = src.max_length;

  const preset = { ...src };
  for (const [k, d] of Object.entries(PARAM_DEFAULTS)) preset[k] = num(src[k], d);
  for (const [k, d] of Object.entries(ST_TEXT_DEFAULTS)) preset[k] = text(src[k], d);
  if (builtin) {
    preset.scenario_format = 'Scenario: {{scenario}}';
    preset.personality_format = "{{char}}'s personality: {{personality}}";
  }
  preset.squash_system_messages = src.squash_system_messages === undefined ? builtin : Boolean(src.squash_system_messages);

  const rawPrompts = Array.isArray(src.prompts) ? src.prompts : defaultPrompts();
  const seen = new Set();
  preset.prompts = rawPrompts
    .filter((p) => p && typeof p === 'object')
    .map(normalizePrompt)
    .filter((p) => !seen.has(p.identifier) && seen.add(p.identifier));

  const order = normalizeOrder(pickOrder(src), preset.prompts);
  preset.prompt_order = ORDER_IDS.map((character_id) => ({ character_id, order: order.map((o) => ({ ...o })) }));
  delete preset.temp;
  delete preset.rep_pen;
  delete preset.genamt;
  delete preset.max_length;
  return preset;
}

export const getOrder = (preset) => preset.prompt_order[0].order;

export function buildDefaultPreset(legacy = {}) {
  const raw = {
    temperature: legacy.temperature,
    top_p: legacy.top_p,
    top_k: legacy.top_k,
    min_p: legacy.min_p,
    frequency_penalty: legacy.frequency_penalty,
    presence_penalty: legacy.presence_penalty,
    repetition_penalty: legacy.repetition_penalty,
    openai_max_tokens: legacy.max_tokens,
    openai_max_context: legacy.maxContext,
    prompts: defaultPrompts().map((p) => (p.identifier === 'main' && typeof legacy.systemPrompt === 'string' && legacy.systemPrompt ? { ...p, content: legacy.systemPrompt } : p)),
  };
  return normalizePreset(raw, { builtin: true });
}

// ---------- almacenamiento ----------

const presetPath = (name) => resolveIn(DIRS.presets, `${name}.json`);

async function names() {
  return (await fs.readdir(DIRS.presets)).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5));
}

// Si no hay ningún preset se crea "Default" a partir de los ajustes de generación antiguos (si existen).
function ensureDefault() {
  return withLock('presets-init', async () => {
    if ((await names()).length) return;
    const legacy = (await readJson(SETTINGS_FILE, {})) || {};
    await writeJson(presetPath('Default'), buildDefaultPreset(legacy));
  });
}

export async function listPresets() {
  await ensureDefault();
  return (await names()).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

export async function getPreset(name) {
  await ensureDefault();
  const raw = await readJson(presetPath(name));
  if (!raw) throw new HttpError(404, t('server.presets.not_found'));
  return normalizePreset(raw);
}

export async function getActivePreset(settings) {
  const all = await listPresets();
  const name = all.includes(settings.activePreset) ? settings.activePreset : all.includes('Default') ? 'Default' : all[0];
  return { name, preset: await getPreset(name) };
}

export async function savePreset(name, raw) {
  if (!(await exists(presetPath(name)))) throw new HttpError(404, t('server.presets.not_found'));
  await writeJson(presetPath(name), normalizePreset(raw));
}

export async function createPreset(name, raw) {
  await ensureDefault();
  const final = await uniqueName(DIRS.presets, safeName(name, 'Preset'), '.json');
  await writeJson(presetPath(final), raw ? normalizePreset(raw) : buildDefaultPreset());
  return final;
}

export function validateImport(raw) {
  const looksLikePreset = raw && typeof raw === 'object' && !Array.isArray(raw) && (Array.isArray(raw.prompts) || ['temperature', 'temp', 'openai_max_context', 'genamt'].some((k) => raw[k] !== undefined));
  if (!looksLikePreset) throw new HttpError(422, t('server.presets.not_a_preset'));
}

export async function deletePreset(name) {
  const all = await listPresets();
  if (!all.includes(name)) throw new HttpError(404, t('server.presets.not_found'));
  if (all.length < 2) throw new HttpError(409, t('server.presets.keep_one'));
  await fs.unlink(presetPath(name));
}

export async function renamePreset(name, newName) {
  const target = safeName(newName, '');
  if (!target) throw new HttpError(400, t('server.common.invalid_name'));
  if (target === name) return name;
  if (!(await exists(presetPath(name)))) throw new HttpError(404, t('server.presets.not_found'));
  if (await exists(presetPath(target))) throw new HttpError(409, t('server.presets.name_taken'));
  await fs.rename(presetPath(name), presetPath(target));
  return target;
}
