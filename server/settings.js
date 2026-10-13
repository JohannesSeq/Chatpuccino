import { SETTINGS_FILE } from './config.js';
import { listPresets } from './presets.js';
import { HttpError, readJson, withLock, writeJson } from './util.js';
import { t } from './i18n.js';

export const DEFAULTS = {
  scanDepth: 4,
  loreBudget: 2048,
  activeLorebooks: [],
  defaultPersona: '',
  activeConnection: '',
  activePreset: '',
  pinnedChats: [],
};

const NUMERIC = ['scanDepth', 'loreBudget'];

// Ajustes de generación de versiones anteriores: ahora viven en los presets.
const LEGACY_GENERATION_KEYS = ['temperature', 'top_p', 'top_k', 'min_p', 'frequency_penalty', 'presence_penalty', 'repetition_penalty', 'max_tokens', 'maxContext', 'systemPrompt'];

function normalizeConnection(c) {
  return {
    id: String(c.id),
    name: String(c.name || t('server.connections.default_name')),
    type: c.type === 'local' ? 'local' : 'openrouter',
    baseUrl: String(c.baseUrl || ''),
    apiKey: String(c.apiKey || ''),
    model: String(c.model || ''),
    favorites: Array.isArray(c.favorites) ? [...new Set(c.favorites.map(String))] : [],
  };
}

// Ajustes antiguos (apiKey/model sueltos) pasan a ser una conexión de OpenRouter.
function migrate(stored) {
  const s = { ...stored };
  if (!Array.isArray(s.connections)) {
    s.connections = [
      { id: 'openrouter', name: 'OpenRouter', type: 'openrouter', apiKey: s.apiKey || process.env.OPENROUTER_API_KEY || '', model: s.model || '' },
    ];
    s.activeConnection = 'openrouter';
  }
  delete s.apiKey;
  delete s.model;
  for (const k of LEGACY_GENERATION_KEYS) delete s[k];
  s.connections = s.connections.map(normalizeConnection);
  return s;
}

export async function loadSettings() {
  const stored = (await readJson(SETTINGS_FILE, {})) || {};
  const s = { ...DEFAULTS, ...migrate(stored) };
  s.pinnedChats = Array.isArray(s.pinnedChats) ? s.pinnedChats.map(String) : [];
  return s;
}

export function mutateSettings(fn) {
  return withLock(SETTINGS_FILE, async () => {
    const s = await loadSettings();
    const result = await fn(s);
    await writeJson(SETTINGS_FILE, s);
    return result;
  });
}

export const getSettings = loadSettings;

export const chatKey = (kind, ownerId, file) => `${kind}/${ownerId}/${file}`;

// Los chats fijados se guardan aquí (no dentro del .jsonl) para no alterar su fecha ni copiarse con él.
export function setPinned(key, pinned) {
  return mutateSettings((s) => {
    const rest = s.pinnedChats.filter((k) => k !== key);
    s.pinnedChats = pinned ? [...rest, key] : rest;
  });
}

export function activeConnection(s) {
  return s.connections.find((c) => c.id === s.activeConnection) || s.connections[0] || null;
}

export function isReady(c) {
  return Boolean(c && c.model && (c.type === 'local' ? c.baseUrl : c.apiKey));
}

export function publicConnection(c) {
  const { apiKey, ...rest } = c;
  return { ...rest, hasKey: Boolean(apiKey), keyPreview: apiKey ? `${apiKey.slice(0, 7)}…${apiKey.slice(-4)}` : '' };
}

// Lo que falta configurar, para la frase «Falta configurar {hint}» del cliente.
function setupHint(active) {
  if (!active) return t('server.settings.hint_connection');
  if (active.type === 'local') return t(active.baseUrl ? 'server.settings.hint_model' : 'server.settings.hint_local_url');
  return t(active.apiKey ? 'server.settings.hint_model' : 'server.settings.hint_api_key');
}

export function publicSettings(s) {
  const { connections, ...rest } = s;
  const active = activeConnection(s);
  return {
    ...rest,
    connections: connections.map(publicConnection),
    activeConnection: active?.id || '',
    model: active?.model || '',
    ready: isReady(active),
    setupHint: setupHint(active),
  };
}

export function updateSettings(patch) {
  return mutateSettings(async (s) => {
    for (const key of Object.keys(DEFAULTS)) {
      if (!(key in patch)) continue;
      if (NUMERIC.includes(key)) {
        const n = Number(patch[key]);
        if (Number.isFinite(n)) s[key] = n;
      } else if (key === 'pinnedChats') {
        continue; // se gestiona solo con setPinned
      } else if (key === 'activeLorebooks') {
        s[key] = Array.isArray(patch[key]) ? patch[key].map(String) : [];
      } else if (key === 'activeConnection') {
        if (!s.connections.some((c) => c.id === patch[key])) throw new HttpError(404, t('server.connections.not_found'));
        s[key] = patch[key];
      } else if (key === 'activePreset') {
        if (!(await listPresets()).includes(patch[key])) throw new HttpError(404, t('server.presets.not_found'));
        s[key] = patch[key];
      } else {
        s[key] = typeof patch[key] === 'string' ? patch[key] : DEFAULTS[key];
      }
    }
    return s;
  });
}
