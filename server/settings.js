import { SETTINGS_FILE } from './config.js';
import { readJson, writeJson } from './util.js';

export const DEFAULT_SYSTEM_PROMPT =
  "Write {{char}}'s next reply in a fictional roleplay chat between {{char}} and {{user}}. Stay in character and write in a natural, immersive instant-messaging style. Never write dialogue, actions or thoughts for {{user}}. Reply in the same language {{user}} writes in.";

export const DEFAULTS = {
  apiKey: '',
  model: '',
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
};

export async function getSettings() {
  const stored = (await readJson(SETTINGS_FILE, {})) || {};
  const s = { ...DEFAULTS, ...stored };
  if (!s.apiKey && process.env.OPENROUTER_API_KEY) s.apiKey = process.env.OPENROUTER_API_KEY;
  return s;
}

export function publicSettings(s) {
  const { apiKey, ...rest } = s;
  return { ...rest, hasKey: Boolean(apiKey), keyPreview: apiKey ? `${apiKey.slice(0, 7)}…${apiKey.slice(-4)}` : '' };
}

const NUMERIC = ['temperature', 'top_p', 'top_k', 'min_p', 'frequency_penalty', 'presence_penalty', 'repetition_penalty', 'max_tokens', 'maxContext', 'scanDepth', 'loreBudget'];

export async function updateSettings(patch) {
  const current = (await readJson(SETTINGS_FILE, {})) || {};
  const next = { ...current };
  for (const key of Object.keys(DEFAULTS)) {
    if (!(key in patch)) continue;
    if (key === 'apiKey') {
      const v = String(patch.apiKey ?? '').trim();
      if (v === '__clear__') delete next.apiKey;
      else if (v) next.apiKey = v;
    } else if (NUMERIC.includes(key)) {
      const n = Number(patch[key]);
      if (Number.isFinite(n)) next[key] = n;
    } else if (key === 'activeLorebooks') {
      next[key] = Array.isArray(patch[key]) ? patch[key].map(String) : [];
    } else {
      next[key] = typeof patch[key] === 'string' ? patch[key] : DEFAULTS[key];
    }
  }
  await writeJson(SETTINGS_FILE, next);
  return getSettings();
}
