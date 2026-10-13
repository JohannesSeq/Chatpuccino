import fs from 'node:fs/promises';
import { DIRS } from './config.js';
import { HttpError, resolveIn, safeName, uniqueName, writeJson, readJson, writeFileAtomic, exists, nowIso } from './util.js';
import { t } from './i18n.js';

const randomId = () => Math.random().toString(36).slice(2, 10);

// ---------- personas ----------
const personaJson = (id) => resolveIn(DIRS.personas, `${id}.json`);
export const personaAvatarPath = (id) => resolveIn(DIRS.personas, `${id}.png`);

export async function listPersonas() {
  const out = [];
  for (const f of (await fs.readdir(DIRS.personas)).filter((f) => f.endsWith('.json'))) {
    const p = await readJson(resolveIn(DIRS.personas, f));
    if (!p) continue;
    const id = f.slice(0, -5);
    let mtime = 0;
    try {
      mtime = (await fs.stat(personaAvatarPath(id))).mtimeMs;
    } catch {
      /* sin avatar */
    }
    out.push({ id, name: p.name || id, description: p.description || '', hasAvatar: mtime > 0, mtime });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

export async function getPersona(id) {
  if (!id) return null;
  const p = await readJson(personaJson(id));
  return p ? { id, name: p.name || id, description: p.description || '' } : null;
}

export async function savePersona(id, { name, description }, imageBuf) {
  const n = String(name ?? '').trim();
  if (!n) throw new HttpError(400, t('server.personas.name_required'));
  let finalId = id;
  if (!finalId) finalId = await uniqueName(DIRS.personas, safeName(n, `persona-${randomId()}`), '.json');
  else if (!(await exists(personaJson(finalId)))) throw new HttpError(404, t('server.personas.not_found'));
  await writeJson(personaJson(finalId), { name: n, description: String(description ?? ''), updated: nowIso() });
  if (imageBuf) await writeFileAtomic(personaAvatarPath(finalId), imageBuf);
  return finalId;
}

export async function deletePersona(id) {
  if (!(await exists(personaJson(id)))) throw new HttpError(404, t('server.personas.not_found'));
  await fs.unlink(personaJson(id));
  await fs.rm(personaAvatarPath(id), { force: true });
}

// ---------- grupos ----------
const groupJson = (id) => resolveIn(DIRS.groups, `${id}.json`);
const REPLY_MODES = ['smart', 'all', 'manual'];

function cleanGroup(id, g) {
  return {
    id,
    name: String(g.name || '').trim(),
    members: [...new Set((Array.isArray(g.members) ? g.members : []).map(String))],
    replyMode: REPLY_MODES.includes(g.replyMode) ? g.replyMode : 'smart',
  };
}

export async function listGroups() {
  const out = [];
  for (const f of (await fs.readdir(DIRS.groups)).filter((f) => f.endsWith('.json'))) {
    const g = await readJson(resolveIn(DIRS.groups, f));
    if (g) out.push(cleanGroup(f.slice(0, -5), g));
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

export async function getGroup(id) {
  const g = await readJson(groupJson(id));
  if (!g) throw new HttpError(404, t('server.groups.not_found'));
  return cleanGroup(id, g);
}

export async function saveGroup(id, body) {
  const g = cleanGroup(id, body);
  if (!g.name) throw new HttpError(400, t('server.groups.name_required'));
  if (g.members.length < 2) throw new HttpError(400, t('server.groups.min_members'));
  if (!id) g.id = await uniqueName(DIRS.groups, safeName(g.name, `grupo-${randomId()}`), '.json');
  else await getGroup(id);
  await writeJson(groupJson(g.id), { name: g.name, members: g.members, replyMode: g.replyMode });
  return g;
}

export async function deleteGroup(id) {
  await getGroup(id);
  await fs.unlink(groupJson(id));
}
