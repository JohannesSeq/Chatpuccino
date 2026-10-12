import { Router } from 'express';
import { getSettings, publicSettings, updateSettings } from '../settings.js';
import { wrap } from '../util.js';

const r = Router();

r.get('/settings', wrap(async (_req, res) => res.json(publicSettings(await getSettings()))));

r.put('/settings', wrap(async (req, res) => res.json(publicSettings(await updateSettings(req.body || {})))));

export default r;
