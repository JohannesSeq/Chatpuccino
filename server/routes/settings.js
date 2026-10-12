import { Router } from 'express';
import { getActivePreset } from '../presets.js';
import { getSettings, publicSettings, updateSettings } from '../settings.js';
import { wrap } from '../util.js';

const r = Router();

// `activePreset` siempre es el nombre real del preset en uso (aunque aún no se haya elegido uno).
async function withActivePreset(s) {
  return { ...publicSettings(s), activePreset: (await getActivePreset(s)).name };
}

r.get('/settings', wrap(async (_req, res) => res.json(await withActivePreset(await getSettings()))));

r.put('/settings', wrap(async (req, res) => res.json(await withActivePreset(await updateSettings(req.body || {})))));

export default r;
