import { Router } from 'express';
import {
  generateImages,
  getStudioCharacter,
  inpaintImage,
  loadStudio,
  publicStudio,
  removeBackground,
  saveStudioCharacter,
  studioInterrupt,
  studioOptions,
  studioProgress,
  testStudio,
  toggleStudioFavorite,
  updateStudio,
} from '../studio.js';
import { HttpError, exists, wrap } from '../util.js';
import { STUDIO_FILE } from '../config.js';
import { t } from '../i18n.js';

const r = Router();

const view = async (cfg) => publicStudio(cfg, { configured: await exists(STUDIO_FILE) });

r.get('/', wrap(async (_req, res) => res.json(await view(await loadStudio()))));

r.put('/', wrap(async (req, res) => res.json(await view(await updateStudio(req.body || {})))));

r.post('/favorites', wrap(async (req, res) => {
  const model = String(req.body?.model || '').trim();
  if (!model) throw new HttpError(400, t('server.connections.model_required'));
  res.json({ favorites: await toggleStudioFavorite(model) });
}));

// Prueba una conexión candidata sin guardarla; si no se escribe contraseña nueva usa la guardada.
r.post('/test', wrap(async (req, res) => res.json(await testStudio(req.body || {}))));

r.get('/options', wrap(async (_req, res) => res.json(await studioOptions())));

r.get('/progress', wrap(async (req, res) => res.json(await studioProgress(req.query.preview === '1'))));

r.post('/interrupt', wrap(async (_req, res) => res.json(await studioInterrupt())));

// Si el navegador cancela mientras se genera, se cancela también la tarea en Stable Diffusion.
function cancellable(res) {
  const ac = new AbortController();
  res.on('close', () => {
    if (res.writableEnded) return;
    ac.abort();
    studioInterrupt().catch(() => {});
  });
  return ac.signal;
}

const work = (fn) => wrap(async (req, res) => {
  const signal = cancellable(res);
  try {
    res.json(await fn(req.body || {}, signal));
  } catch (e) {
    if (e.name === 'AbortError') return;
    throw e;
  }
});

r.post('/generate', work(generateImages));
r.post('/inpaint', work(inpaintImage));
r.post('/rembg', work(removeBackground));

r.get('/characters/:id', wrap(async (req, res) => res.json(await getStudioCharacter(req.params.id))));
r.put('/characters/:id', wrap(async (req, res) => res.json(await saveStudioCharacter(req.params.id, req.body || {}))));

export default r;
