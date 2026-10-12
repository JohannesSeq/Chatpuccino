import fs from 'node:fs/promises';
import path from 'node:path';
import { DIRS } from './config.js';
import { HttpError, resolveIn, safeName, uniqueName, withLock, writeFileAtomic, nowIso, stamp } from './util.js';
import { applyMacros } from './prompt.js';

export function chatDir(kind, owner) {
  if (kind !== 'c' && kind !== 'g') throw new HttpError(400, 'Tipo de chat inválido');
  return resolveIn(kind === 'c' ? DIRS.chats : DIRS.groupChats, owner);
}

export function chatPath(kind, owner, file) {
  return resolveIn(chatDir(kind, owner), `${file}.jsonl`);
}

export function parseChat(raw) {
  const lines = raw.replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.trim());
  let meta = null;
  const messages = [];
  lines.forEach((line, i) => {
    let o;
    try {
      o = JSON.parse(line);
    } catch {
      return;
    }
    if (!o || typeof o !== 'object') return;
    if (i === 0 && o.mes === undefined && (o.chat_metadata !== undefined || o.user_name !== undefined)) meta = o;
    else if (o.mes !== undefined) messages.push(o);
  });
  meta = meta || { user_name: 'Usuario', character_name: '', create_date: '', chat_metadata: {} };
  meta.chat_metadata = meta.chat_metadata && typeof meta.chat_metadata === 'object' ? meta.chat_metadata : {};
  return { meta, messages };
}

export function serializeChat({ meta, messages }) {
  return [meta, ...messages].map((o) => JSON.stringify(o)).join('\n') + '\n';
}

export async function readChat(kind, owner, file) {
  let raw;
  try {
    raw = await fs.readFile(chatPath(kind, owner, file), 'utf8');
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(404, 'Chat no encontrado');
  }
  return parseChat(raw);
}

// Lectura-modificación-escritura serializada por archivo.
export function mutateChat(kind, owner, file, fn) {
  const p = chatPath(kind, owner, file);
  return withLock(p, async () => {
    const chat = await readChat(kind, owner, file);
    const result = await fn(chat);
    await writeFileAtomic(p, serializeChat(chat));
    return result;
  });
}

export function makeMessage({ name, isUser, mes, characterId, model }) {
  const date = nowIso();
  const msg = {
    name,
    is_user: Boolean(isUser),
    is_system: false,
    send_date: date,
    mes,
    swipes: [mes],
    swipe_id: 0,
    swipe_info: [{ send_date: date, ...(model ? { extra: { model } } : {}) }],
    extra: model ? { api: 'openrouter', model } : {},
  };
  if (characterId) msg.original_avatar = `${characterId}.png`;
  return msg;
}

export async function createChat({ kind, ownerId, ownerName, persona, speaker, speakerId }) {
  const dir = chatDir(kind, ownerId);
  await fs.mkdir(dir, { recursive: true });
  const userName = persona?.name || 'Usuario';
  const file = await uniqueName(dir, safeName(`${ownerName} - ${stamp()}`), '.jsonl');
  const meta = {
    user_name: userName,
    character_name: ownerName,
    create_date: stamp(),
    chat_metadata: { ...(persona?.id ? { persona: persona.id } : {}) },
  };
  const messages = [];
  if (speaker && speaker.first_mes.trim()) {
    const ctx = { char: speaker.name, user: userName };
    const greetings = [speaker.first_mes, ...speaker.alternate_greetings].map((g) => applyMacros(g, ctx));
    const msg = makeMessage({ name: speaker.name, isUser: false, mes: greetings[0], characterId: speakerId });
    msg.swipes = greetings;
    msg.swipe_info = greetings.map(() => ({ send_date: msg.send_date }));
    messages.push(msg);
  }
  await writeFileAtomic(path.join(dir, `${file}.jsonl`), serializeChat({ meta, messages }));
  return file;
}

const summaryCache = new Map();

function summarize(kind, ownerId, file, st, raw) {
  const { meta, messages } = parseChat(raw);
  const last = [...messages].reverse().find((m) => !m.is_system);
  return {
    kind,
    ownerId,
    file,
    title: meta.chat_metadata.title || '',
    createdAt: meta.create_date || '',
    lastMessage: last ? { name: last.name, isUser: Boolean(last.is_user), text: String(last.mes).slice(0, 200) } : null,
    count: messages.length,
    mtime: st.mtimeMs,
  };
}

export async function listAllChats() {
  const out = [];
  for (const [kind, base] of [['c', DIRS.chats], ['g', DIRS.groupChats]]) {
    let owners = [];
    try {
      owners = await fs.readdir(base, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const o of owners) {
      if (!o.isDirectory()) continue;
      const dir = path.join(base, o.name);
      for (const f of await fs.readdir(dir)) {
        if (!f.endsWith('.jsonl')) continue;
        const full = path.join(dir, f);
        try {
          const st = await fs.stat(full);
          const hit = summaryCache.get(full);
          if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) {
            out.push(hit.summary);
            continue;
          }
          const summary = summarize(kind, o.name, f.slice(0, -6), st, await fs.readFile(full, 'utf8'));
          summaryCache.set(full, { mtimeMs: st.mtimeMs, size: st.size, summary });
          out.push(summary);
        } catch {
          /* chat ilegible: se omite */
        }
      }
    }
  }
  return out.sort((a, b) => b.mtime - a.mtime);
}

export async function deleteChat(kind, owner, file) {
  try {
    await fs.unlink(chatPath(kind, owner, file));
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(404, 'Chat no encontrado');
  }
}

export async function deleteGroupChats(groupId) {
  await fs.rm(chatDir('g', groupId), { recursive: true, force: true });
}
