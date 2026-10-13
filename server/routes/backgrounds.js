import { Router } from 'express';
import { backgroundFilePath, createBackground, deleteBackground, listBackgrounds, updateBackground } from '../backgrounds.js';
import { cascadeWorlds, rawImageBody, sendImage, stripExt, uploadFilename } from '../vn-common.js';
import { HttpError, wrap } from '../util.js';
import { t } from '../i18n.js';

const r = Router();

r.get('/', wrap(async (_req, res) => res.json(await listBackgrounds())));

r.post('/', rawImageBody, wrap(async (req, res) => {
  const name = typeof req.query.name === 'string' && req.query.name.trim() ? req.query.name : stripExt(uploadFilename(req));
  const description = typeof req.query.description === 'string' ? req.query.description : '';
  res.status(201).json(await createBackground(req.body, { name, description }));
}));

r.put('/:id', wrap(async (req, res) => res.json(await updateBackground(req.params.id, req.body))));

r.delete('/:id', wrap(async (req, res) => {
  await deleteBackground(req.params.id);
  await cascadeWorlds('detachBackground', req.params.id);
  res.status(204).end();
}));

r.get('/:id/image', wrap(async (req, res) => {
  const file = await backgroundFilePath(req.params.id);
  if (!file) throw new HttpError(404, t('server.backgrounds.not_found'));
  await sendImage(res, file, t('server.backgrounds.not_found'));
}));

export default r;
