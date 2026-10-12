import { Router } from 'express';
import { deleteWallpaper, findWallpaper, getAppearance, saveAppearance, saveWallpaper } from '../appearance.js';
import { HttpError, wrap } from '../util.js';

const r = Router();

r.get('/', wrap(async (_req, res) => res.json(await getAppearance())));

r.put('/', wrap(async (req, res) => res.json(await saveAppearance(req.body))));

r.get('/wallpaper', wrap(async (_req, res) => {
  const wp = await findWallpaper();
  if (!wp) throw new HttpError(404, 'No hay fondo de pantalla');
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(wp.path);
}));

r.post('/wallpaper', wrap(async (req, res) => {
  if (!Buffer.isBuffer(req.body)) throw new HttpError(400, 'Envía la imagen como application/octet-stream');
  res.status(201).json(await saveWallpaper(req.body));
}));

r.delete('/wallpaper', wrap(async (_req, res) => res.json(await deleteWallpaper())));

export default r;
