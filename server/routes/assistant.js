import { Router } from 'express';
import {
  FIELDS,
  MODES,
  buildFieldMessages,
  buildImageMessages,
  cleanOutput,
  loadAssistant,
  publicAssistant,
  requireAssistant,
  toggleAssistantFavorite,
  updateAssistant,
} from '../assistant.js';
import { checkConnection, listModels, normalizeBaseUrl, streamChat } from '../providers.js';
import { samplingParams } from '../sampling.js';
import { startSse } from '../sse.js';
import { HttpError, wrap } from '../util.js';
import { t } from '../i18n.js';

const r = Router();

const IMAGE_RE = /^data:image\/(?:png|jpe?g|webp|gif);base64,/i;
const MAX_IMAGE_CHARS = 8_000_000;

r.get('/', wrap(async (_req, res) => res.json(publicAssistant(await loadAssistant()))));

r.put('/', wrap(async (req, res) => res.json(publicAssistant(await updateAssistant(req.body || {})))));

r.get('/models', wrap(async (_req, res) => {
  const { connection } = await loadAssistant();
  if (connection.type === 'local' && !connection.baseUrl) throw new HttpError(400, t('server.assistant.local_url_required'));
  res.json(await listModels(connection));
}));

r.post('/favorites', wrap(async (req, res) => {
  const model = String(req.body?.model || '').trim();
  if (!model) throw new HttpError(400, t('server.connections.model_required'));
  res.json({ favorites: await toggleAssistantFavorite(model) });
}));

// Prueba datos candidatos (sin guardarlos); si no se escribe una key nueva usa la guardada.
r.post('/test', wrap(async (req, res) => {
  const { connection: stored } = await loadAssistant();
  const { type, baseUrl, apiKey } = req.body || {};
  const connType = type === 'local' ? 'local' : 'openrouter';
  res.json(
    await checkConnection({
      type: connType,
      baseUrl: connType === 'local' ? normalizeBaseUrl(baseUrl || stored.baseUrl) : '',
      apiKey: String(apiKey || '').trim() || (stored.type === connType ? stored.apiKey : ''),
    }),
  );
}));

// Envía la petición al modelo y devuelve el texto por SSE (delta / done / error). Nada se guarda en el servidor.
async function runAssistant(res, { conn, messages, sampling }) {
  const { ac, send } = startSse(res);
  const finish = (text, extra = {}) => {
    const clean = cleanOutput(text);
    if (clean) send({ done: true, text: clean, ...extra });
    else send({ error: t('server.common.empty_response') });
  };
  try {
    const text = await streamChat({
      conn,
      signal: ac.signal,
      body: { model: conn.model, messages, ...samplingParams(sampling) },
      onDelta: (delta) => send({ delta }),
    });
    finish(text);
  } catch (e) {
    const partial = e.partial || '';
    if (e.name === 'AbortError') {
      if (partial.trim()) finish(partial, { aborted: true });
    } else if (partial.trim()) {
      finish(partial, { warning: e.message });
    } else {
      send({ error: e.message || t('server.assistant.generate_error') });
    }
  } finally {
    res.end();
  }
}

r.post('/generate', wrap(async (req, res) => {
  const { field, mode = 'generate', text = '', instructions = '', context = {} } = req.body || {};
  if (!FIELDS.includes(field)) throw new HttpError(400, t('server.assistant.invalid_field'));
  if (!MODES.includes(mode)) throw new HttpError(400, t('server.assistant.invalid_mode'));
  if (mode !== 'generate' && !String(text).trim()) throw new HttpError(400, t('server.assistant.no_text_to_improve'));
  const cfg = await loadAssistant();
  const conn = requireAssistant(cfg);
  const messages = buildFieldMessages({ prompts: cfg.prompts, field, mode, text: String(text), instructions: String(instructions), context });
  await runAssistant(res, { conn, messages, sampling: cfg.sampling });
}));

r.post('/describe-image', wrap(async (req, res) => {
  const { image, name = '', instructions = '' } = req.body || {};
  if (typeof image !== 'string' || !IMAGE_RE.test(image)) throw new HttpError(400, t('server.assistant.invalid_image'));
  if (image.length > MAX_IMAGE_CHARS) throw new HttpError(413, t('server.assistant.image_too_large'));
  const cfg = await loadAssistant();
  const conn = requireAssistant(cfg, { vision: true });
  const messages = buildImageMessages({ prompts: cfg.prompts, image, name: String(name), instructions: String(instructions) });
  await runAssistant(res, { conn, messages, sampling: cfg.sampling });
}));

export default r;
