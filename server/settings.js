import { SETTINGS_FILE } from './config.js';
import { HttpError, readJson, withLock, writeJson } from './util.js';

export const DEFAULT_SYSTEM_PROMPT =
  "Write {{char}}'s next reply in a fictional roleplay chat between {{char}} and {{user}}. Stay in character and write in a natural, immersive instant-messaging style. Never write dialogue, actions or thoughts for {{user}}. Reply in the same language {{user}} writes in.";

export const DEFAULTS = {
  temperature: 0.9,
  top_p: 1,
  top_k: 0,
  min_p: 0,
  frequency_penalty: 0,
  presence_penalty: 0,
  repetition_penalty: 1,
  max_tokens: 400,
  maxContext: 16000,
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
  scanDepth: 4,
  loreBudget: 2048,
  activeLorebooks: [],
  defaultPersona: '',
  activeConnection: '',
};

const NUMERIC = ['temperature', 'top_p', 'top_k', 'min_p', 'frequency_penalty', 'presence_penalty', 'repetition_penalty', 'max_tokens', 'maxContext', 'scanDepth', 'loreBudget'];

function normalizeConnection(c) {
  return {
    id: String(c.id),
    name: String(c.name || 'Conexión'),
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
  s.connections = s.connections.map(normalizeConnection);
  return s;
}

export async function loadSettings() {
  const stored = (await readJson(SETTINGS_FILE, {})) || {};
  return { ...DEFAULTS, ...migrate(stored) };
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

export function publicSettings(s) {
  const { connections, ...rest } = s;
  const active = activeConnection(s);
  return {
    ...rest,
    connections: connections.map(publicConnection),
    activeConnection: active?.id || '',
    model: active?.model || '',
    ready: isReady(active),
    setupHint: !active ? 'una conexión' : active.type === 'local' ? (active.baseUrl ? 'el modelo' : 'la URL del servidor local') : active.apiKey ? 'el modelo' : 'la API key',
    defaultSystemPrompt: DEFAULT_SYSTEM_PROMPT,
  };
}

export function updateSettings(patch) {
  return mutateSettings((s) => {
    for (const key of Object.keys(DEFAULTS)) {
      if (!(key in patch)) continue;
      if (NUMERIC.includes(key)) {
        const n = Number(patch[key]);
        if (Number.isFinite(n)) s[key] = n;
      } else if (key === 'activeLorebooks') {
        s[key] = Array.isArray(patch[key]) ? patch[key].map(String) : [];
      } else if (key === 'activeConnection') {
        if (!s.connections.some((c) => c.id === patch[key])) throw new HttpError(404, 'Conexión no encontrada');
        s[key] = patch[key];
      } else {
        s[key] = typeof patch[key] === 'string' ? patch[key] : DEFAULTS[key];
      }
    }
    return s;
  });
}
