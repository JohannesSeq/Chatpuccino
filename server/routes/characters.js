import { Router } from 'express';
import {
  characterPngPath,
  createCharacter,
  deleteCharacter,
  exportJson,
  getCharacter,
  importCharacter,
  listCharacters,
  updateCharacter,
} from '../cards.js';
import { deleteSprites } from '../sprites.js';
import { cascadeWorlds } from '../vn-common.js';
import { decodePngDataUrl, safeName, wrap } from '../util.js';

const r = Router();

r.get('/', wrap(async (_req, res) => res.json(await listCharacters())));

r.post('/import', wrap(async (req, res) => {
  const created = Buffer.isBuffer(req.body) ? await importCharacter({ png: req.body }) : await importCharacter({ json: req.body });
  res.status(201).json(created);
}));

r.post('/', wrap(async (req, res) => {
  const { data, image } = req.body || {};
  res.status(201).json(await createCharacter(data, image ? decodePngDataUrl(image) : null));
}));

r.get('/:id', wrap(async (req, res) => res.json(await getCharacter(req.params.id))));

r.put('/:id', wrap(async (req, res) => {
  const { data, image } = req.body || {};
  res.json(await updateCharacter(req.params.id, data, image ? decodePngDataUrl(image) : null));
}));

r.delete('/:id', wrap(async (req, res) => {
  await deleteCharacter(req.params.id);
  await deleteSprites(req.params.id);
  await cascadeWorlds('detachCharacter', req.params.id);
  res.status(204).end();
}));

r.get('/:id/avatar', wrap(async (req, res) => {
  await getCharacter(req.params.id);
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(characterPngPath(req.params.id));
}));

r.get('/:id/export', wrap(async (req, res) => {
  const { data } = await getCharacter(req.params.id);
  const base = safeName(data.name);
  if (req.query.format === 'json') {
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(base)}.json`);
    res.json(exportJson(data));
  } else {
    res.download(characterPngPath(req.params.id), `${base}.png`);
  }
}));

export default r;
