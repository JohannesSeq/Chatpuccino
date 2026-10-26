import { ELEVENLABS_BASE, TTS_FILE } from './config.js';
import { t } from './i18n.js';
import { HttpError, readJson, withLock, writeJson } from './util.js';

// Narración por voz. La configuración (claves incluidas) vive en data/tts.json; el navegador nunca recibe las claves.
// Proveedores: 'browser' (voces del sistema, se sintetiza en el cliente), 'openai' (API de OpenAI o cualquier servidor compatible
// con /audio/speech: Kokoro, openedai-speech, AllTalk, Edge-TTS…) y 'elevenlabs'.

export const PROVIDERS = ['browser', 'openai', 'elevenlabs'];
export const MAX_TEXT = 4000;
const MAX_AUDIO_BYTES = 30 * 1024 * 1024;
const TIMEOUT_MS = 2 * 60 * 1000;
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const str = (v, max, fallback = '') => (typeof v === 'string' ? v.trim().slice(0, max) : fallback);
const bool = (v, fallback) => (typeof v === 'boolean' ? v : fallback);
const num = (v, min, max, fallback) => {
  const n = Number(v);
  if (v === '' || v === null || v === undefined || !Number.isFinite(n)) return fallback;
  return Math.round(Math.min(max, Math.max(min, n)) * 1000) / 1000;
};

export const OPENAI_VOICES = ['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer', 'verse'];

export const DEFAULT_TTS = {
  enabled: false,
  provider: 'browser',
  // lee sola cada respuesta nueva (en el Modo Novela, cada línea al mostrarse)
  autoplay: true,
  narrator: true,
  narrateUser: false,
  // qué hacer con un texto sin comillas: 'narrator' (todo lo lee el narrador) o 'speech' (lo que no va entre *asteriscos* lo dice el personaje)
  unquoted: 'narrator',
  skipCode: true,
  volume: 100,
  browser: { rate: 1, pitch: 1 },
  openai: { baseUrl: 'https://api.openai.com/v1', apiKey: '', model: 'tts-1', speed: 1, voices: '' },
  elevenlabs: { apiKey: '', model: 'eleven_multilingual_v2', stability: 0.5, similarity: 0.75 },
  voices: {
    browser: { narrator: '', user: '', default: '', chars: {} },
    openai: { narrator: '', user: '', default: '', chars: {} },
    elevenlabs: { narrator: '', user: '', default: '', chars: {} },
  },
};

export function normalizeUrl(raw, fallback = '') {
  let s = String(raw ?? '').trim();
  if (!s) return fallback;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s) && !/^https?:\/\//i.test(s)) throw new HttpError(400, t('server.tts.invalid_url'));
  if (!/^https?:\/\//i.test(s)) s = `http://${s}`;
  try {
    const u = new URL(s);
    return `${u.origin}${u.pathname}`.replace(/\/+$/, '');
  } catch {
    throw new HttpError(400, t('server.tts.invalid_url'));
  }
}

function normalizeVoiceMap(raw) {
  const r = isObj(raw) ? raw : {};
  const chars = {};
  for (const [id, voice] of Object.entries(isObj(r.chars) ? r.chars : {})) {
    const v = str(voice, 200);
    if (v && id && id !== '__proto__' && id.length <= 200 && Object.keys(chars).length < 500) chars[id] = v;
  }
  return { narrator: str(r.narrator, 200), user: str(r.user, 200), default: str(r.default, 200), chars };
}

export function normalize(raw = {}) {
  const r = isObj(raw) ? raw : {};
  const d = DEFAULT_TTS;
  const o = isObj(r.openai) ? r.openai : {};
  const e = isObj(r.elevenlabs) ? r.elevenlabs : {};
  const b = isObj(r.browser) ? r.browser : {};
  let baseUrl = d.openai.baseUrl;
  if (typeof o.baseUrl === 'string') {
    try {
      baseUrl = normalizeUrl(o.baseUrl, '');
    } catch {
      baseUrl = '';
    }
  }
  return {
    enabled: bool(r.enabled, d.enabled),
    provider: PROVIDERS.includes(r.provider) ? r.provider : d.provider,
    autoplay: bool(r.autoplay, d.autoplay),
    narrator: bool(r.narrator, d.narrator),
    narrateUser: bool(r.narrateUser, d.narrateUser),
    unquoted: r.unquoted === 'speech' ? 'speech' : 'narrator',
    skipCode: bool(r.skipCode, d.skipCode),
    volume: num(r.volume, 0, 100, d.volume),
    browser: { rate: num(b.rate, 0.5, 2, 1), pitch: num(b.pitch, 0, 2, 1) },
    openai: {
      baseUrl,
      apiKey: typeof o.apiKey === 'string' ? o.apiKey.trim().slice(0, 500) : '',
      model: str(o.model, 100, d.openai.model) || d.openai.model,
      speed: num(o.speed, 0.25, 4, 1),
      voices: str(o.voices, 1000),
    },
    elevenlabs: {
      apiKey: typeof e.apiKey === 'string' ? e.apiKey.trim().slice(0, 500) : '',
      model: str(e.model, 100, d.elevenlabs.model) || d.elevenlabs.model,
      stability: num(e.stability, 0, 1, 0.5),
      similarity: num(e.similarity, 0, 1, 0.75),
    },
    voices: Object.fromEntries(PROVIDERS.map((p) => [p, normalizeVoiceMap(r.voices?.[p])])),
  };
}

export async function loadTts() {
  return normalize(await readJson(TTS_FILE, {}));
}

/** Configuración para el navegador: sin claves (solo si hay una guardada). */
export function publicTts(cfg) {
  const { apiKey: openaiKey, ...openai } = cfg.openai;
  const { apiKey: elevenKey, ...elevenlabs } = cfg.elevenlabs;
  return {
    ...cfg,
    openai: { ...openai, hasKey: Boolean(openaiKey) },
    elevenlabs: { ...elevenlabs, hasKey: Boolean(elevenKey) },
    defaults: { openai: { baseUrl: DEFAULT_TTS.openai.baseUrl, model: DEFAULT_TTS.openai.model }, elevenlabs: { model: DEFAULT_TTS.elevenlabs.model } },
  };
}

// Aplica un parche: las secciones se fusionan; una clave vacía conserva la guardada y '__clear__' la borra.
export function applyPatch(cfg, patch) {
  const p = isObj(patch) ? patch : {};
  const raw = { ...cfg };
  if ('provider' in p && !PROVIDERS.includes(p.provider)) throw new HttpError(400, t('server.tts.invalid_provider'));
  for (const key of ['enabled', 'provider', 'autoplay', 'narrator', 'narrateUser', 'unquoted', 'skipCode', 'volume']) if (key in p) raw[key] = p[key];
  for (const section of ['browser', 'openai', 'elevenlabs']) {
    if (!isObj(p[section])) continue;
    const next = { ...cfg[section], ...p[section] };
    if ('apiKey' in p[section]) {
      const k = p[section].apiKey;
      next.apiKey = k === '__clear__' ? '' : typeof k === 'string' && k.trim() ? k : cfg[section].apiKey;
    }
    if (section === 'openai' && typeof p.openai.baseUrl === 'string') next.baseUrl = normalizeUrl(p.openai.baseUrl);
    delete next.hasKey;
    raw[section] = next;
  }
  if (isObj(p.voices)) {
    raw.voices = { ...cfg.voices };
    for (const prov of PROVIDERS) {
      const v = p.voices[prov];
      if (!isObj(v)) continue;
      raw.voices[prov] = { ...cfg.voices[prov], ...v, chars: isObj(v.chars) ? { ...cfg.voices[prov].chars, ...v.chars } : cfg.voices[prov].chars };
    }
  }
  return normalize(raw);
}

export function updateTts(patch) {
  return withLock(TTS_FILE, async () => {
    const next = applyPatch(await loadTts(), patch);
    await writeJson(TTS_FILE, next);
    return next;
  });
}

// ---------- Proveedores ----------

function detailOf(res, body) {
  try {
    const data = JSON.parse(body);
    const d = data?.detail ?? data?.error ?? data?.message;
    const text = typeof d === 'string' ? d : d?.message || d?.status || JSON.stringify(d ?? data);
    return String(text).slice(0, 300);
  } catch {
    return String(body || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300);
  }
}

async function request(url, init, signal, label) {
  let res;
  try {
    res = await fetch(url, { ...init, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]) : AbortSignal.timeout(TIMEOUT_MS) });
  } catch (e) {
    if (signal?.aborted) throw e;
    if (e?.name === 'TimeoutError') throw new HttpError(504, t('server.tts.timeout'), 'TTS_TIMEOUT');
    throw new HttpError(502, t('server.tts.unreachable', { url: label }), 'TTS_UNREACHABLE');
  }
  if (res.status === 401 || res.status === 403) throw new HttpError(502, t('server.tts.unauthorized'), 'TTS_AUTH');
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    if (res.status === 404) throw new HttpError(502, t('server.tts.api_not_found', { detail: detailOf(res, body) }), 'TTS_NO_API');
    throw new HttpError(502, t('server.tts.bad_response', { status: res.status, detail: detailOf(res, body) }), 'TTS_BAD_RESPONSE');
  }
  return res;
}

const openaiHeaders = (cfg) => ({ 'Content-Type': 'application/json', ...(cfg.openai.apiKey ? { Authorization: `Bearer ${cfg.openai.apiKey}` } : {}) });

async function readAudio(res) {
  const len = Number(res.headers.get('content-length'));
  if (len > MAX_AUDIO_BYTES) throw new HttpError(502, t('server.tts.too_big'), 'TTS_BAD_RESPONSE');
  const buffer = Buffer.from(await res.arrayBuffer());
  if (!buffer.length) throw new HttpError(502, t('server.tts.empty_audio'), 'TTS_EMPTY');
  if (buffer.length > MAX_AUDIO_BYTES) throw new HttpError(502, t('server.tts.too_big'), 'TTS_BAD_RESPONSE');
  const type = (res.headers.get('content-type') || '').split(';')[0].trim();
  return { buffer, type: /^audio\//i.test(type) ? type : 'audio/mpeg' };
}

/** Sintetiza `text` con el proveedor de `cfg` (el navegador no pasa por aquí). Devuelve { buffer, type }. */
export async function synthesize(cfg, { text, voice, provider = cfg.provider }, signal) {
  const input = String(text ?? '').trim();
  if (!input) throw new HttpError(400, t('server.tts.text_required'));
  if (input.length > MAX_TEXT) throw new HttpError(400, t('server.tts.text_too_long', { max: MAX_TEXT }));
  const v = str(voice, 200);
  if (provider === 'openai') {
    const o = cfg.openai;
    if (!o.baseUrl) throw new HttpError(400, t('server.tts.no_url'), 'TTS_NOT_READY');
    const res = await request(`${o.baseUrl}/audio/speech`, { method: 'POST', headers: openaiHeaders(cfg), body: JSON.stringify({ model: o.model, input, voice: v || 'alloy', response_format: 'mp3', speed: o.speed }) }, signal, o.baseUrl);
    return readAudio(res);
  }
  if (provider === 'elevenlabs') {
    const e = cfg.elevenlabs;
    if (!e.apiKey) throw new HttpError(400, t('server.tts.no_key'), 'TTS_NOT_READY');
    if (!v) throw new HttpError(400, t('server.tts.no_voice'), 'TTS_NO_VOICE');
    const body = { text: input, model_id: e.model, voice_settings: { stability: e.stability, similarity_boost: e.similarity } };
    const res = await request(`${ELEVENLABS_BASE}/text-to-speech/${encodeURIComponent(v)}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'audio/mpeg', 'xi-api-key': e.apiKey }, body: JSON.stringify(body) }, signal, 'ElevenLabs');
    return readAudio(res);
  }
  throw new HttpError(400, t('server.tts.browser_only'));
}

function parseVoices(data) {
  const list = Array.isArray(data) ? data : Array.isArray(data?.voices) ? data.voices : Array.isArray(data?.data) ? data.data : [];
  const out = [];
  for (const item of list) {
    const id = typeof item === 'string' ? item : item?.voice_id ?? item?.id ?? item?.name ?? item?.voice;
    if (typeof id !== 'string' || !id.trim() || out.some((x) => x.id === id)) continue;
    out.push({ id: id.trim(), name: typeof item === 'object' && typeof item.name === 'string' && item.name ? item.name : id.trim() });
  }
  return out;
}

const manualVoices = (cfg) => parseVoices(cfg.openai.voices.split(/[,\n;]+/).map((s) => s.trim()).filter(Boolean));

/** Voces del proveedor. `source`: 'server' (las pidió al servidor), 'manual' (lista escrita por el usuario) o 'default'. */
export async function listVoices(cfg, provider = cfg.provider, signal) {
  if (provider === 'elevenlabs') {
    if (!cfg.elevenlabs.apiKey) throw new HttpError(400, t('server.tts.no_key'), 'TTS_NOT_READY');
    const res = await request(`${ELEVENLABS_BASE}/voices`, { headers: { 'xi-api-key': cfg.elevenlabs.apiKey } }, signal, 'ElevenLabs');
    return { voices: parseVoices(await res.json().catch(() => null)), source: 'server' };
  }
  if (provider === 'openai') {
    const manual = manualVoices(cfg);
    if (manual.length) return { voices: manual, source: 'manual' };
    if (cfg.openai.baseUrl) {
      for (const path of ['/audio/voices', '/voices']) {
        try {
          const res = await fetch(`${cfg.openai.baseUrl}${path}`, { headers: openaiHeaders(cfg), signal: AbortSignal.timeout(8000) });
          if (!res.ok) continue;
          const voices = parseVoices(await res.json().catch(() => null));
          if (voices.length) return { voices, source: 'server' };
        } catch {
          /* este servidor no ofrece la lista */
        }
      }
    }
    return { voices: parseVoices(OPENAI_VOICES), source: 'default' };
  }
  return { voices: [], source: 'default' };
}

/** Comprueba una configuración candidata (los campos vacíos usan lo guardado) y devuelve un resumen. */
export async function testTts(cfg, signal) {
  if (cfg.provider === 'browser') return { ok: true, message: t('server.tts.test_browser') };
  if (cfg.provider === 'elevenlabs') {
    const { voices } = await listVoices(cfg, 'elevenlabs', signal);
    return { ok: true, voices: voices.length, message: t('server.tts.test_elevenlabs', { count: voices.length }) };
  }
  const listed = await listVoices(cfg, 'openai', signal);
  const voice = listed.voices[0]?.id || 'alloy';
  const { buffer } = await synthesize(cfg, { text: 'Hola.', voice, provider: 'openai' }, signal);
  return { ok: true, voices: listed.voices.length, bytes: buffer.length, message: t('server.tts.test_openai', { voice }) };
}
