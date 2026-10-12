import { Router } from 'express';
import { getSettings, publicSettings, updateSettings, DEFAULT_SYSTEM_PROMPT } from '../settings.js';
import { checkKey, listModels } from '../openrouter.js';
import { HttpError, wrap } from '../util.js';

const r = Router();

r.get('/settings', wrap(async (_req, res) => {
  res.json({ ...publicSettings(await getSettings()), defaultSystemPrompt: DEFAULT_SYSTEM_PROMPT });
}));

r.put('/settings', wrap(async (req, res) => {
  const s = await updateSettings(req.body || {});
  res.json({ ...publicSettings(s), defaultSystemPrompt: DEFAULT_SYSTEM_PROMPT });
}));

r.get('/models', wrap(async (_req, res) => {
  res.json(await listModels());
}));

// Verifica la key guardada (o una candidata enviada en el cuerpo) sin guardarla.
r.post('/openrouter/test', wrap(async (req, res) => {
  const candidate = String(req.body?.apiKey || '').trim();
  const key = candidate || (await getSettings()).apiKey;
  if (!key) throw new HttpError(400, 'No hay API key para probar');
  const info = await checkKey(key);
  res.json({ ok: true, label: info.label || '', usage: info.usage ?? null, limit: info.limit ?? null, isFreeTier: info.is_free_tier ?? null });
}));

export default r;
