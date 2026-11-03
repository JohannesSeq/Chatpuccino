import { Router } from 'express';
import { createTemplate, deleteTemplate, exportTemplate, getTemplateDetail, importTemplate, listTemplates, updateTemplate } from '../templates.js';
import { readWorld } from '../worlds.js';
import { HttpError, safeName, wrap } from '../util.js';
import { t } from '../i18n.js';

const r = Router();

r.get('/', wrap(async (_req, res) => res.json(await listTemplates())));

// Guarda un mundo existente como plantilla ({ worldId, name? }).
r.post('/', wrap(async (req, res) => {
  const worldId = String(req.body?.worldId ?? '');
  if (!worldId) throw new HttpError(400, t('server.templates.world_required'));
  const world = await readWorld(worldId);
  res.status(201).json(await createTemplate(world, { name: req.body?.name || world.name }));
}));

// Importa un archivo exportado ({ data }).
r.post('/import', wrap(async (req, res) => {
  res.status(201).json(await importTemplate(req.body?.data));
}));

r.get('/:id', wrap(async (req, res) => res.json(await getTemplateDetail(req.params.id))));

r.put('/:id', wrap(async (req, res) => res.json(await updateTemplate(req.params.id, req.body))));

r.delete('/:id', wrap(async (req, res) => {
  await deleteTemplate(req.params.id);
  res.status(204).end();
}));

r.get('/:id/export', wrap(async (req, res) => {
  const data = await exportTemplate(req.params.id);
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(safeName(data.template.name, 'plantilla'))}.world.json`);
  res.json(data);
}));

export default r;
