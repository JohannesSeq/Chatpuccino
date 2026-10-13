import { Router } from 'express';
import { createPreset, deletePreset, getActivePreset, getPreset, listPresets, renamePreset, savePreset, validateImport } from '../presets.js';
import { getSettings, mutateSettings } from '../settings.js';
import { HttpError, safeName, wrap } from '../util.js';
import { t } from '../i18n.js';

const r = Router();

const setActiveIfWas = (oldName, newName) =>
  mutateSettings((s) => {
    if (s.activePreset === oldName) s.activePreset = newName;
  });

r.get('/', wrap(async (_req, res) => {
  const { name } = await getActivePreset(await getSettings());
  res.json({ active: name, presets: await listPresets() });
}));

r.post('/', wrap(async (req, res) => {
  const { name, preset } = req.body || {};
  res.status(201).json({ name: await createPreset(name || t('server.presets.default_name'), preset) });
}));

// Acepta el JSON de un preset de SillyTavern (chat completion) tal cual.
r.post('/import', wrap(async (req, res) => {
  const { name, preset } = req.body || {};
  validateImport(preset);
  res.status(201).json({ name: await createPreset(name || preset.name || t('server.presets.imported_name'), preset) });
}));

r.get('/:name', wrap(async (req, res) => res.json(await getPreset(req.params.name))));

r.put('/:name', wrap(async (req, res) => {
  if (!req.body || typeof req.body !== 'object') throw new HttpError(400, t('server.presets.invalid'));
  await savePreset(req.params.name, req.body);
  res.json(await getPreset(req.params.name));
}));

r.post('/:name/rename', wrap(async (req, res) => {
  const name = await renamePreset(req.params.name, req.body?.newName);
  await setActiveIfWas(req.params.name, name);
  res.json({ name });
}));

r.delete('/:name', wrap(async (req, res) => {
  await deletePreset(req.params.name);
  await setActiveIfWas(req.params.name, '');
  res.status(204).end();
}));

r.get('/:name/export', wrap(async (req, res) => {
  const preset = await getPreset(req.params.name);
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(safeName(req.params.name))}.json`);
  res.json(preset);
}));

export default r;
