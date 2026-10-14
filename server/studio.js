import fs from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import { DIRS, STUDIO_FILE } from './config.js';
import { getCharacter } from './cards.js';
import { t } from './i18n.js';
import { HttpError, readJson, resolveIn, withLock, writeJson } from './util.js';
import {
  DEFAULT_CONNECTION,
  DEFAULT_EXPRESSION_PROMPTS,
  DEFAULT_FACE_REGION,
  DEFAULT_MODEL,
  DEFAULT_PROFILES,
  FALLBACK_SAMPLERS,
  FALLBACK_SCHEDULERS,
  FALLBACK_UPSCALERS,
  INPAINT_FILLS,
  PARAM_RANGES,
  PROFILE_KINDS,
  joinPrompts,
} from '../shared/studio.js';

// Estudio de imágenes: conexión con un servidor de Stable Diffusion (API de AUTOMATIC1111 / Forge / SD.Next).
// La configuración vive en data/studio/config.json y los datos por personaje en data/studio/characters/<id>.json.

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const MAX_PROMPT = 8000;
const MAX_B64 = 45_000_000;
const REQUEST_TIMEOUT_MS = 20 * 60 * 1000;
const LABEL_RE = /^[a-z0-9_-]{1,40}$/;

// ---------- Normalización ----------

function num(value, key, fallback) {
  const [min, max, step] = PARAM_RANGES[key];
  const n = Number(value);
  if (value === '' || value === null || value === undefined || !Number.isFinite(n)) return fallback;
  const clamped = Math.min(max, Math.max(min, n));
  return step >= 1 ? Math.round(clamped) : Math.round(clamped * 1e4) / 1e4;
}
const str = (v, max, fallback = '') => (typeof v === 'string' ? v.trim().slice(0, max) : fallback);
const text = (v, fallback = '') => (typeof v === 'string' ? v.slice(0, MAX_PROMPT) : fallback);

export function normalizeBaseUrl(raw) {
  let s = String(raw ?? '').trim();
  if (!s) return '';
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s) && !/^https?:\/\//i.test(s)) throw new HttpError(400, t('server.studio.invalid_url'));
  if (!/^https?:\/\//i.test(s)) s = `http://${s}`;
  let u;
  try {
    u = new URL(s);
  } catch {
    throw new HttpError(400, t('server.studio.invalid_url'));
  }
  if (!/^https?:$/.test(u.protocol)) throw new HttpError(400, t('server.studio.invalid_url'));
  return `${u.origin}${u.pathname}`.replace(/\/+$/, '').replace(/\/sdapi\/v1$/i, '');
}

function normalizeConnection(c = {}) {
  let baseUrl = DEFAULT_CONNECTION.baseUrl;
  if (typeof c.baseUrl === 'string') {
    try {
      baseUrl = normalizeBaseUrl(c.baseUrl);
    } catch {
      baseUrl = '';
    }
  }
  return { baseUrl, user: str(c.user, 200), pass: typeof c.pass === 'string' ? c.pass.slice(0, 500) : '' };
}

function normalizeModel(m = {}) {
  return {
    checkpoint: str(m.checkpoint, 300),
    vae: str(m.vae, 300),
    clipSkip: num(m.clipSkip, 'clipSkip', DEFAULT_MODEL.clipSkip),
    favorites: Array.isArray(m.favorites) ? [...new Set(m.favorites.map((x) => str(x, 300)).filter(Boolean))].slice(0, 200) : [],
  };
}

export function normalizeProfile(kind, raw = {}) {
  const d = DEFAULT_PROFILES[kind];
  const r = isObj(raw) ? raw : {};
  const h = isObj(r.hires) ? r.hires : {};
  const profile = {
    width: num(r.width, 'width', d.width),
    height: num(r.height, 'height', d.height),
    steps: num(r.steps, 'steps', d.steps),
    cfg: num(r.cfg, 'cfg', d.cfg),
    sampler: str(r.sampler, 60, d.sampler) || d.sampler,
    scheduler: str(r.scheduler, 60, d.scheduler) || d.scheduler,
    seed: num(r.seed, 'seed', d.seed),
    batchCount: num(r.batchCount, 'batchCount', d.batchCount),
    hires: {
      enabled: typeof h.enabled === 'boolean' ? h.enabled : d.hires.enabled,
      scale: num(h.scale, 'hiresScale', d.hires.scale),
      upscaler: str(h.upscaler, 100, d.hires.upscaler) || d.hires.upscaler,
      steps: num(h.steps, 'hiresSteps', d.hires.steps),
      denoise: num(h.denoise, 'hiresDenoise', d.hires.denoise),
    },
    restoreFaces: typeof r.restoreFaces === 'boolean' ? r.restoreFaces : d.restoreFaces,
    prompt: text(r.prompt, d.prompt),
    negative: text(r.negative, d.negative),
  };
  if (kind === 'expression') {
    const i = isObj(r.inpaint) ? r.inpaint : {};
    const di = d.inpaint;
    profile.inpaint = {
      denoise: num(i.denoise, 'denoise', di.denoise),
      maskBlur: num(i.maskBlur, 'maskBlur', di.maskBlur),
      fill: INPAINT_FILLS.includes(i.fill) ? i.fill : di.fill,
      onlyMasked: typeof i.onlyMasked === 'boolean' ? i.onlyMasked : di.onlyMasked,
      padding: num(i.padding, 'padding', di.padding),
    };
  }
  return profile;
}

function normalizeExpressionPrompts(raw) {
  const out = {};
  for (const [label, value] of Object.entries(isObj(raw) ? raw : {})) {
    if (!LABEL_RE.test(label)) continue;
    const v = text(value).trim();
    if (v && v !== DEFAULT_EXPRESSION_PROMPTS[label]) out[label] = v;
  }
  return out;
}

function normalize(raw = {}) {
  const profiles = {};
  for (const kind of PROFILE_KINDS) profiles[kind] = normalizeProfile(kind, raw.profiles?.[kind]);
  return {
    connection: normalizeConnection(raw.connection),
    model: normalizeModel(raw.model),
    profiles,
    expressionPrompts: normalizeExpressionPrompts(raw.expressionPrompts),
  };
}

// ---------- Configuración ----------

export async function loadStudio() {
  return normalize(await readJson(STUDIO_FILE, {}));
}

export function publicStudio(cfg, { configured = false } = {}) {
  const { pass, ...conn } = cfg.connection;
  return {
    connection: { ...conn, hasPass: Boolean(pass) },
    model: cfg.model,
    profiles: cfg.profiles,
    expressionPrompts: { ...DEFAULT_EXPRESSION_PROMPTS, ...cfg.expressionPrompts },
    defaults: { connection: DEFAULT_CONNECTION, model: DEFAULT_MODEL, profiles: DEFAULT_PROFILES, expressionPrompts: DEFAULT_EXPRESSION_PROMPTS, faceRegion: DEFAULT_FACE_REGION },
    ready: Boolean(cfg.connection.baseUrl),
    // true cuando el usuario ya guardó la configuración alguna vez (si no, se muestra la pantalla de configuración primero)
    configured,
  };
}

export function updateStudio(patch = {}) {
  return withLock(STUDIO_FILE, async () => {
    const cfg = await loadStudio();
    const raw = { ...cfg };
    const c = patch.connection;
    if (isObj(c)) {
      const next = { ...cfg.connection };
      if (typeof c.baseUrl === 'string') {
        if (c.baseUrl.trim()) next.baseUrl = normalizeBaseUrl(c.baseUrl);
        else next.baseUrl = '';
      }
      if (typeof c.user === 'string') next.user = c.user;
      if (typeof c.pass === 'string') {
        if (c.pass === '__clear__') next.pass = '';
        else if (c.pass) next.pass = c.pass;
      }
      raw.connection = next;
    }
    if (isObj(patch.model)) raw.model = { ...cfg.model, ...patch.model };
    if (isObj(patch.profiles)) {
      raw.profiles = { ...cfg.profiles };
      for (const kind of PROFILE_KINDS) {
        if (!isObj(patch.profiles[kind])) continue;
        const p = patch.profiles[kind];
        raw.profiles[kind] = { ...cfg.profiles[kind], ...p, hires: { ...cfg.profiles[kind].hires, ...(isObj(p.hires) ? p.hires : {}) }, ...(kind === 'expression' ? { inpaint: { ...cfg.profiles.expression.inpaint, ...(isObj(p.inpaint) ? p.inpaint : {}) } } : {}) };
      }
    }
    if (isObj(patch.expressionPrompts)) raw.expressionPrompts = { ...cfg.expressionPrompts, ...patch.expressionPrompts };
    const next = normalize(raw);
    await writeJson(STUDIO_FILE, next);
    return next;
  });
}

export function toggleStudioFavorite(model) {
  return withLock(STUDIO_FILE, async () => {
    const cfg = await loadStudio();
    const f = cfg.model.favorites;
    cfg.model.favorites = f.includes(model) ? f.filter((m) => m !== model) : [...f, model];
    await writeJson(STUDIO_FILE, cfg);
    return cfg.model.favorites;
  });
}

// ---------- Datos por personaje ----------

const BAD_ID = /[\\/:*?"<>|\u0000-\u001f]|^\.|[. ]$/;
const charFile = (id) => {
  if (BAD_ID.test(String(id ?? ''))) throw new HttpError(400, t('server.common.invalid_name'));
  return resolveIn(DIRS.studioCharacters, `${id}.json`);
};

function normalizeCharacter(raw = {}) {
  const r = isObj(raw) ? raw : {};
  const f = isObj(r.faceRegion) ? r.faceRegion : {};
  const n = (v, min, max, d) => (Number.isFinite(Number(v)) && v !== '' && v !== null ? Math.min(max, Math.max(min, Number(v))) : d);
  return {
    prompt: text(r.prompt),
    negative: text(r.negative),
    faceRegion: {
      cx: n(f.cx, 0, 1, DEFAULT_FACE_REGION.cx),
      cy: n(f.cy, 0, 1, DEFAULT_FACE_REGION.cy),
      rx: n(f.rx, 0.02, 0.5, DEFAULT_FACE_REGION.rx),
      ry: n(f.ry, 0.02, 0.5, DEFAULT_FACE_REGION.ry),
    },
  };
}

export async function getStudioCharacter(id) {
  await getCharacter(id);
  return normalizeCharacter(await readJson(charFile(id), {}));
}

export async function saveStudioCharacter(id, patch = {}) {
  await getCharacter(id);
  const file = charFile(id);
  return withLock(file, async () => {
    const cur = normalizeCharacter(await readJson(file, {}));
    const next = normalizeCharacter({ ...cur, ...patch, faceRegion: { ...cur.faceRegion, ...(isObj(patch.faceRegion) ? patch.faceRegion : {}) } });
    await fs.mkdir(DIRS.studioCharacters, { recursive: true });
    await writeJson(file, next);
    return next;
  });
}

export async function deleteStudioCharacter(id) {
  try {
    await fs.rm(charFile(id), { force: true });
  } catch {
    /* nada que borrar */
  }
}

// ---------- Cliente HTTP de Stable Diffusion ----------

/** Petición HTTP(S) sin el tiempo límite de 5 min de fetch: generar una imagen puede tardar mucho. */
function rawRequest(conn, urlPath, { method = 'GET', json, signal, timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    let url;
    try {
      url = new URL(`${conn.baseUrl}${urlPath}`);
    } catch {
      return reject(new HttpError(400, t('server.studio.invalid_url')));
    }
    const body = json === undefined ? null : Buffer.from(JSON.stringify(json));
    const headers = { Accept: 'application/json' };
    if (body) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = body.length;
    }
    if (conn.user || conn.pass) headers.Authorization = `Basic ${Buffer.from(`${conn.user}:${conn.pass}`).toString('base64')}`;
    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.request(url, { method, headers, signal, timeout: timeoutMs }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let data = raw;
        try {
          data = raw ? JSON.parse(raw) : null;
        } catch {
          /* respuesta que no es JSON (p. ej. una página de error) */
        }
        resolve({ status: res.statusCode || 0, data });
      });
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })));
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function detailOf(data) {
  if (!data) return '';
  if (typeof data === 'string') return data.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300);
  const d = data.detail ?? data.error ?? data.errors ?? data.message;
  if (Array.isArray(d)) return d.map((x) => x?.msg || JSON.stringify(x)).join('; ').slice(0, 300);
  return typeof d === 'string' ? d.slice(0, 300) : JSON.stringify(d ?? data).slice(0, 300);
}

/** Llama a la API de Stable Diffusion y traduce los fallos habituales a mensajes comprensibles. */
export async function sdRequest(conn, urlPath, opts = {}) {
  if (!conn?.baseUrl) throw new HttpError(400, t('server.studio.no_url'), 'STUDIO_NOT_READY');
  let res;
  try {
    res = await rawRequest(conn, urlPath, opts);
  } catch (e) {
    if (e.name === 'AbortError' || e instanceof HttpError) throw e;
    if (e.code === 'ETIMEDOUT') throw new HttpError(504, t('server.studio.timeout'));
    throw new HttpError(502, t('server.studio.unreachable', { url: conn.baseUrl }), 'STUDIO_UNREACHABLE');
  }
  if (res.status === 401 || res.status === 403) throw new HttpError(502, t('server.studio.unauthorized'), 'STUDIO_AUTH');
  if (res.status === 404) throw new HttpError(502, t('server.studio.api_not_found'), 'STUDIO_NO_API');
  if (res.status < 200 || res.status >= 300) throw new HttpError(502, t('server.studio.bad_response', { status: res.status, detail: detailOf(res.data) }));
  return res.data;
}

export async function requireStudio() {
  const cfg = await loadStudio();
  if (!cfg.connection.baseUrl) throw new HttpError(400, t('server.studio.no_url'), 'STUDIO_NOT_READY');
  return cfg;
}

export async function testStudio(candidate) {
  const stored = (await loadStudio()).connection;
  const conn = {
    baseUrl: normalizeBaseUrl(candidate?.baseUrl || stored.baseUrl),
    user: typeof candidate?.user === 'string' ? candidate.user : stored.user,
    pass: typeof candidate?.pass === 'string' && candidate.pass ? candidate.pass : stored.pass,
  };
  const models = await sdRequest(conn, '/sdapi/v1/sd-models', { timeoutMs: 15000 });
  const count = Array.isArray(models) ? models.length : 0;
  return { ok: true, models: count, message: t('server.studio.connected', { count }) };
}

const names = (list, key = 'name') => (Array.isArray(list) ? list.map((x) => (typeof x === 'string' ? x : x?.[key])).filter((x) => typeof x === 'string' && x) : []);
const uniq = (list) => [...new Set(list)];

/** Modelos, VAE, muestreadores y reescaladores del servidor; si alguna lista falla se usan valores razonables. */
export async function studioOptions() {
  const { connection: conn } = await requireStudio();
  const get = (p) => sdRequest(conn, p, { timeoutMs: 15000 });
  const [models, vaes, samplers, schedulers, upscalers, latent, options] = await Promise.allSettled([
    get('/sdapi/v1/sd-models'),
    get('/sdapi/v1/sd-vae'),
    get('/sdapi/v1/samplers'),
    get('/sdapi/v1/schedulers'),
    get('/sdapi/v1/upscalers'),
    get('/sdapi/v1/latent-upscale-modes'),
    get('/sdapi/v1/options'),
  ]);
  const ok = (r) => (r.status === 'fulfilled' ? r.value : null);
  if (models.status === 'rejected') throw models.reason;
  const upscale = uniq([...names(ok(latent)), ...names(ok(upscalers)).filter((n) => n !== 'None')]);
  return {
    models: uniq(names(ok(models), 'title')),
    vaes: uniq(names(ok(vaes), 'model_name')),
    samplers: names(ok(samplers)).length ? names(ok(samplers)) : FALLBACK_SAMPLERS,
    schedulers: names(ok(schedulers), 'label').length ? names(ok(schedulers), 'label') : FALLBACK_SCHEDULERS,
    upscalers: upscale.length ? upscale : FALLBACK_UPSCALERS,
    current: typeof ok(options)?.sd_model_checkpoint === 'string' ? ok(options).sd_model_checkpoint : '',
  };
}

// ---------- Generación ----------

const stripB64 = (value, label) => {
  const s = String(value ?? '');
  const m = /^data:image\/(?:png|jpe?g|webp);base64,/i.exec(s);
  const b64 = m ? s.slice(m[0].length) : s;
  if (!b64 || b64.length > MAX_B64 || !/^[A-Za-z0-9+/=\r\n]+$/.test(b64)) throw new HttpError(400, t(label === 'mask' ? 'server.studio.invalid_mask' : 'server.studio.invalid_image'));
  return b64.replace(/\s+/g, '');
};

function overridesFor(model) {
  const o = { CLIP_stop_at_last_layers: model.clipSkip };
  if (model.checkpoint) o.sd_model_checkpoint = model.checkpoint;
  if (model.vae) o.sd_vae = model.vae;
  return o;
}

function commonPayload(profile, model, prompt, negative) {
  return {
    prompt,
    negative_prompt: negative,
    seed: profile.seed,
    steps: profile.steps,
    cfg_scale: profile.cfg,
    sampler_name: profile.sampler,
    ...(profile.scheduler && profile.scheduler !== 'Automatic' ? { scheduler: profile.scheduler } : {}),
    restore_faces: profile.restoreFaces,
    batch_size: 1,
    n_iter: profile.batchCount,
    send_images: true,
    save_images: false,
    override_settings: overridesFor(model),
    override_settings_restore_afterwards: false,
  };
}

/** Une el prompt del perfil, el del personaje y el de la petición (sin repetir etiquetas). */
async function composePrompts(cfg, kind, body, profile) {
  const char = body.characterId ? await getStudioCharacter(body.characterId) : null;
  return {
    prompt: joinPrompts(profile.prompt, char?.prompt, body.prompt),
    negative: joinPrompts(profile.negative, char?.negative, body.negative),
    char,
  };
}

function profileFor(cfg, kind, body) {
  const base = cfg.profiles[kind];
  const o = isObj(body.overrides) ? body.overrides : {};
  return normalizeProfile(kind, {
    ...base,
    ...o,
    hires: { ...base.hires, ...(isObj(o.hires) ? o.hires : {}) },
    ...(kind === 'expression' ? { inpaint: { ...base.inpaint, ...(isObj(o.inpaint) ? o.inpaint : {}) } } : {}),
  });
}

function collect(result, extra) {
  const images = Array.isArray(result?.images) ? result.images.filter((x) => typeof x === 'string' && x) : [];
  if (!images.length) throw new HttpError(502, t('server.studio.no_images'));
  let info = {};
  try {
    info = typeof result.info === 'string' ? JSON.parse(result.info) : isObj(result.info) ? result.info : {};
  } catch {
    /* info no es JSON */
  }
  const seeds = Array.isArray(info.all_seeds) ? info.all_seeds : [];
  return {
    images: images.slice(0, 16).map((data, i) => ({ data, seed: Number.isFinite(seeds[i]) ? seeds[i] : null })),
    ...extra,
  };
}

const kindOf = (body, allowed) => {
  const kind = body.kind;
  if (!allowed.includes(kind)) throw new HttpError(400, t('server.studio.invalid_kind'));
  return kind;
};

/** txt2img: personajes y fondos. */
export async function generateImages(body, signal) {
  const cfg = await requireStudio();
  const kind = kindOf(body, ['character', 'background']);
  const profile = profileFor(cfg, kind, body);
  const { prompt, negative } = await composePrompts(cfg, kind, body, profile);
  if (!prompt) throw new HttpError(400, t('server.studio.empty_prompt'));
  const payload = {
    ...commonPayload(profile, cfg.model, prompt, negative),
    width: profile.width,
    height: profile.height,
    enable_hr: profile.hires.enabled,
    ...(profile.hires.enabled
      ? { hr_scale: profile.hires.scale, hr_upscaler: profile.hires.upscaler, hr_second_pass_steps: profile.hires.steps, denoising_strength: profile.hires.denoise }
      : {}),
  };
  const result = await sdRequest(cfg.connection, '/sdapi/v1/txt2img', { method: 'POST', json: payload, signal });
  return collect(result, { prompt, negative, kind });
}

const roundTo = (n, m) => Math.max(m, Math.round(n / m) * m);

/** img2img con máscara: cambia solo la zona enmascarada (expresiones de un personaje). */
export async function inpaintImage(body, signal) {
  const cfg = await requireStudio();
  const profile = profileFor(cfg, 'expression', body);
  const label = body.expression === undefined || body.expression === '' ? '' : String(body.expression);
  if (label && !LABEL_RE.test(label)) throw new HttpError(400, t('server.studio.invalid_expression'));
  const { prompt, negative } = await composePrompts(cfg, 'expression', body, profile);
  if (!prompt) throw new HttpError(400, t('server.studio.empty_prompt'));
  const init = stripB64(body.image, 'image');
  const mask = stripB64(body.mask, 'mask');
  const ip = profile.inpaint;
  const w = Number(body.width);
  const h = Number(body.height);
  const size = Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0 ? { width: Math.min(2048, roundTo(w, 8)), height: Math.min(2048, roundTo(h, 8)) } : { width: profile.width, height: profile.height };
  const payload = {
    ...commonPayload(profile, cfg.model, prompt, negative),
    init_images: [init],
    mask,
    mask_blur: ip.maskBlur,
    inpainting_fill: { fill: 0, original: 1, noise: 2, nothing: 3 }[ip.fill],
    inpaint_full_res: ip.onlyMasked,
    inpaint_full_res_padding: ip.padding,
    inpainting_mask_invert: 0,
    resize_mode: 0,
    denoising_strength: ip.denoise,
    include_init_images: false,
    // «Solo la zona enmascarada» regenera ese recorte a la resolución del perfil; si no, a la de la imagen completa.
    ...(ip.onlyMasked ? { width: profile.width, height: profile.height } : size),
  };
  const result = await sdRequest(cfg.connection, '/sdapi/v1/img2img', { method: 'POST', json: payload, signal });
  return collect(result, { prompt, negative, kind: 'expression', expression: label });
}

/** Quita el fondo con la extensión rembg de Stable Diffusion (stable-diffusion-webui-rembg). */
export async function removeBackground(body, signal) {
  const cfg = await requireStudio();
  const image = stripB64(body.image, 'image');
  const model = str(body.model, 60, 'isnet-anime') || 'isnet-anime';
  let result;
  try {
    result = await sdRequest(cfg.connection, '/rembg', {
      method: 'POST',
      json: { input_image: image, model, return_mask: false, alpha_matting: false },
      signal,
    });
  } catch (e) {
    if (e.code === 'STUDIO_NO_API') throw new HttpError(502, t('server.studio.rembg_missing'), 'STUDIO_NO_REMBG');
    throw e;
  }
  if (typeof result?.image !== 'string' || !result.image) throw new HttpError(502, t('server.studio.no_images'));
  return { image: result.image };
}

export async function studioProgress(preview) {
  const { connection } = await requireStudio();
  const p = await sdRequest(connection, `/sdapi/v1/progress?skip_current_image=${preview ? 'false' : 'true'}`, { timeoutMs: 10000 });
  const state = isObj(p?.state) ? p.state : {};
  return {
    progress: Number.isFinite(p?.progress) ? Math.min(1, Math.max(0, p.progress)) : 0,
    eta: Number.isFinite(p?.eta_relative) ? Math.max(0, p.eta_relative) : null,
    step: Number.isFinite(state.sampling_step) ? state.sampling_step : null,
    steps: Number.isFinite(state.sampling_steps) ? state.sampling_steps : null,
    job: typeof state.job === 'string' ? state.job : '',
    preview: preview && typeof p?.current_image === 'string' ? p.current_image : '',
  };
}

export async function studioInterrupt() {
  const { connection } = await requireStudio();
  await sdRequest(connection, '/sdapi/v1/interrupt', { method: 'POST', json: {}, timeoutMs: 10000 });
  return { ok: true };
}
