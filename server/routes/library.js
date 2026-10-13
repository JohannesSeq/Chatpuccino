import { Router } from 'express';
import { createBook, deleteBook, getBook, listBooks, renameBook, saveBook } from '../lore.js';
import {
  deleteGroup,
  deletePersona,
  getGroup,
  listGroups,
  listPersonas,
  personaAvatarPath,
  savePersona,
  saveGroup,
} from '../store.js';
import { deleteGroupChats } from '../chats.js';
import { getSettings, updateSettings } from '../settings.js';
import { decodePngDataUrl, exists, safeName, wrap, HttpError } from '../util.js';
import { t } from '../i18n.js';

export const personas = Router();
personas.get('/', wrap(async (_req, res) => res.json(await listPersonas())));
personas.post('/', wrap(async (req, res) => {
  const { image, ...body } = req.body || {};
  const id = await savePersona(null, body, image ? decodePngDataUrl(image) : null);
  res.status(201).json({ id });
}));
personas.put('/:id', wrap(async (req, res) => {
  const { image, ...body } = req.body || {};
  await savePersona(req.params.id, body, image ? decodePngDataUrl(image) : null);
  res.json({ id: req.params.id });
}));
personas.delete('/:id', wrap(async (req, res) => {
  await deletePersona(req.params.id);
  const s = await getSettings();
  if (s.defaultPersona === req.params.id) await updateSettings({ defaultPersona: '' });
  res.status(204).end();
}));
personas.get('/:id/avatar', wrap(async (req, res) => {
  const p = personaAvatarPath(req.params.id);
  if (!(await exists(p))) throw new HttpError(404, t('server.library.no_avatar'));
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(p);
}));

export const groups = Router();
groups.get('/', wrap(async (_req, res) => res.json(await listGroups())));
groups.post('/', wrap(async (req, res) => res.status(201).json(await saveGroup(null, req.body || {}))));
groups.put('/:id', wrap(async (req, res) => res.json(await saveGroup(req.params.id, req.body || {}))));
groups.delete('/:id', wrap(async (req, res) => {
  await deleteGroup(req.params.id);
  await deleteGroupChats(req.params.id);
  res.status(204).end();
}));
groups.get('/:id', wrap(async (req, res) => res.json(await getGroup(req.params.id))));

async function replaceActive(oldName, newName) {
  const s = await getSettings();
  if (!s.activeLorebooks.includes(oldName)) return;
  const next = s.activeLorebooks.filter((n) => n !== oldName);
  if (newName) next.push(newName);
  await updateSettings({ activeLorebooks: next });
}

export const lorebooks = Router();
lorebooks.get('/', wrap(async (_req, res) => res.json(await listBooks())));
lorebooks.post('/', wrap(async (req, res) => {
  const { name, book } = req.body || {};
  const final = await createBook(name || t('server.lore.default_name'), book || { entries: {} });
  res.status(201).json({ name: final });
}));
lorebooks.get('/:name', wrap(async (req, res) => res.json(await getBook(req.params.name))));
lorebooks.put('/:name', wrap(async (req, res) => {
  await getBook(req.params.name);
  await saveBook(req.params.name, req.body);
  res.json(await getBook(req.params.name));
}));
lorebooks.post('/:name/rename', wrap(async (req, res) => {
  const name = await renameBook(req.params.name, req.body?.newName);
  await replaceActive(req.params.name, name);
  res.json({ name });
}));
lorebooks.delete('/:name', wrap(async (req, res) => {
  await deleteBook(req.params.name);
  await replaceActive(req.params.name, null);
  res.status(204).end();
}));
lorebooks.get('/:name/export', wrap(async (req, res) => {
  const book = await getBook(req.params.name);
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(safeName(req.params.name))}.json`);
  res.json(book);
}));
