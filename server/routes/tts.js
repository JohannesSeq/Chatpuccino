import { Router } from 'express';
import { applyPatch, listVoices, loadTts, publicTts, synthesize, testTts, updateTts, PROVIDERS } from '../tts.js';
import { HttpError, wrap } from '../util.js';
import { t } from '../i18n.js';

const r = Router();

// Si el navegador corta la petición (p. ej. al pasar a la siguiente línea), se cancela también la síntesis.
const cancellable = (res) => {
  const ac = new AbortController();
  res.on('close', () => {
    if (!res.writableEnded) ac.abort();
  });
  return ac.signal;
};

const providerOf = (value, fallback) => {
  const p = value ?? fallback;
  if (!PROVIDERS.includes(p)) throw new HttpError(400, t('server.tts.invalid_provider'));
  return p;
};

const guard = (fn) => wrap(async (req, res) => {
  try {
    await fn(req, res);
  } catch (e) {
    if (e.name === 'AbortError') return;
    throw e;
  }
});

r.get('/', wrap(async (_req, res) => res.json(publicTts(await loadTts()))));

r.put('/', wrap(async (req, res) => res.json(publicTts(await updateTts(req.body || {})))));

r.get('/voices', guard(async (req, res) => {
  const cfg = await loadTts();
  res.json(await listVoices(cfg, providerOf(req.query.provider, cfg.provider), cancellable(res)));
}));

// Prueba una configuración candidata sin guardarla (las claves vacías usan las guardadas).
r.post('/test', guard(async (req, res) => {
  const stored = await loadTts();
  const cfg = applyPatch(stored, { ...(req.body || {}), voices: undefined });
  res.json(await testTts(cfg, cancellable(res)));
}));

r.post('/speak', guard(async (req, res) => {
  const cfg = await loadTts();
  const provider = providerOf(req.body?.provider, cfg.provider);
  const { buffer, type } = await synthesize(cfg, { text: req.body?.text, voice: req.body?.voice, provider }, cancellable(res));
  res.setHeader('Content-Type', type);
  res.setHeader('Cache-Control', 'no-store');
  res.send(buffer);
}));

export default r;
