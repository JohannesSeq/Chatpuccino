import { Router } from 'express';
import {
  addSpriteFile,
  createOutfit,
  deleteOutfit,
  deleteSpriteFile,
  getSprites,
  renameOutfit,
  spriteFilePath,
  updateSpriteConfig,
} from '../sprites.js';
import { cascadeWorlds, imageFromBody, rawImageBody, sendImage, uploadFilename } from '../vn-common.js';
import { wrap } from '../util.js';
import { t } from '../i18n.js';

const r = Router();

r.get('/:charId', wrap(async (req, res) => res.json(await getSprites(req.params.charId))));

r.put('/:charId', wrap(async (req, res) => res.json(await updateSpriteConfig(req.params.charId, req.body))));

r.post('/:charId/outfits', wrap(async (req, res) => res.status(201).json(await createOutfit(req.params.charId, req.body))));

r.put('/:charId/outfits/:outfitId', wrap(async (req, res) => res.json(await renameOutfit(req.params.charId, req.params.outfitId, req.body))));

r.delete('/:charId/outfits/:outfitId', wrap(async (req, res) => {
  const { charId, outfitId } = req.params;
  await deleteOutfit(charId, outfitId);
  await cascadeWorlds('detachOutfit', charId, outfitId);
  res.status(204).end();
}));

r.post('/:charId/outfits/:outfitId/files', rawImageBody, wrap(async (req, res) => {
  const { buf, ext } = imageFromBody(req.body);
  const label = typeof req.query.label === 'string' ? req.query.label : '';
  const outfit = await addSpriteFile(req.params.charId, req.params.outfitId, { buf, ext, label, filename: uploadFilename(req) });
  res.json(outfit);
}));

r.delete('/:charId/outfits/:outfitId/files/:file', wrap(async (req, res) => {
  res.json(await deleteSpriteFile(req.params.charId, req.params.outfitId, req.params.file));
}));

r.get('/:charId/outfits/:outfitId/files/:file', wrap(async (req, res) => {
  await sendImage(res, spriteFilePath(req.params.charId, req.params.outfitId, req.params.file), t('server.sprites.file_not_found'));
}));

export default r;
