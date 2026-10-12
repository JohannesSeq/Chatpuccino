import { Router } from 'express';
import { HttpError, wrap } from '../util.js';
import { checkConnection, listModels, normalizeBaseUrl } from '../providers.js';
import { loadSettings, mutateSettings, publicConnection } from '../settings.js';

const r = Router();
const randomId = () => `c${Math.random().toString(36).slice(2, 9)}`;

function find(s, id) {
  const c = s.connections.find((x) => x.id === id);
  if (!c) throw new HttpError(404, 'Conexión no encontrada');
  return c;
}

r.get('/', wrap(async (_req, res) => {
  const s = await loadSettings();
  res.json({ active: s.activeConnection, connections: s.connections.map(publicConnection) });
}));

r.post('/', wrap(async (req, res) => {
  const { name, type, baseUrl, apiKey, model } = req.body || {};
  const conn = await mutateSettings((s) => {
    const isLocal = type === 'local';
    const c = {
      id: randomId(),
      name: String(name || '').trim() || (isLocal ? 'Servidor local' : 'OpenRouter'),
      type: isLocal ? 'local' : 'openrouter',
      baseUrl: isLocal ? normalizeBaseUrl(baseUrl) : '',
      apiKey: String(apiKey || '').trim(),
      model: String(model || '').trim(),
      favorites: [],
    };
    s.connections.push(c);
    if (!s.connections.some((x) => x.id === s.activeConnection)) s.activeConnection = c.id;
    return c;
  });
  res.status(201).json(publicConnection(conn));
}));

r.put('/:id', wrap(async (req, res) => {
  const body = req.body || {};
  const conn = await mutateSettings((s) => {
    const c = find(s, req.params.id);
    if (typeof body.name === 'string' && body.name.trim()) c.name = body.name.trim();
    if (c.type === 'local' && typeof body.baseUrl === 'string') c.baseUrl = normalizeBaseUrl(body.baseUrl);
    if (typeof body.model === 'string') c.model = body.model.trim();
    if (typeof body.apiKey === 'string') {
      const k = body.apiKey.trim();
      if (k === '__clear__') c.apiKey = '';
      else if (k) c.apiKey = k;
    }
    return c;
  });
  res.json(publicConnection(conn));
}));

r.delete('/:id', wrap(async (req, res) => {
  await mutateSettings((s) => {
    find(s, req.params.id);
    s.connections = s.connections.filter((c) => c.id !== req.params.id);
    if (s.activeConnection === req.params.id) s.activeConnection = s.connections[0]?.id || '';
  });
  res.status(204).end();
}));

r.post('/:id/activate', wrap(async (req, res) => {
  await mutateSettings((s) => {
    find(s, req.params.id);
    s.activeConnection = req.params.id;
  });
  res.json({ ok: true });
}));

r.post('/:id/favorites', wrap(async (req, res) => {
  const model = String(req.body?.model || '').trim();
  if (!model) throw new HttpError(400, 'Falta el modelo');
  const favorites = await mutateSettings((s) => {
    const c = find(s, req.params.id);
    c.favorites = c.favorites.includes(model) ? c.favorites.filter((m) => m !== model) : [...c.favorites, model];
    return c.favorites;
  });
  res.json({ favorites });
}));

r.get('/:id/models', wrap(async (req, res) => {
  res.json(await listModels(find(await loadSettings(), req.params.id)));
}));

// Prueba una conexión guardada o datos candidatos (sin guardarlos).
r.post('/test', wrap(async (req, res) => {
  const { id, type, baseUrl, apiKey } = req.body || {};
  const stored = id ? find(await loadSettings(), id) : null;
  const t = stored?.type || (type === 'local' ? 'local' : 'openrouter');
  const candidate = {
    type: t,
    baseUrl: t === 'local' ? normalizeBaseUrl(baseUrl || stored?.baseUrl) : '',
    apiKey: String(apiKey || '').trim() || stored?.apiKey || '',
  };
  res.json(await checkConnection(candidate));
}));

export default r;
