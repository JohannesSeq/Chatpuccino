import { Router } from 'express';
import { createStat, deleteStat, listStats, updateStat } from '../stats.js';
import { removeStatFromSprites } from '../sprites.js';
import { cascadeWorlds } from '../vn-common.js';
import { wrap } from '../util.js';

const r = Router();

r.get('/', wrap(async (_req, res) => res.json(await listStats())));

r.post('/', wrap(async (req, res) => res.status(201).json(await createStat(req.body))));

r.put('/:id', wrap(async (req, res) => res.json(await updateStat(req.params.id, req.body))));

r.delete('/:id', wrap(async (req, res) => {
  await deleteStat(req.params.id);
  await removeStatFromSprites(req.params.id);
  await cascadeWorlds('detachStat', req.params.id);
  res.status(204).end();
}));

export default r;
