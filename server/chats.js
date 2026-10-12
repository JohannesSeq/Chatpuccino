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

function normalizeImported(m, ownerName) {
  const mes = String(m.mes ?? '');
  const swipes = Array.isArray(m.swipes) && m.swipes.length ? m.swipes.map((s) => String(s ?? '')) : [mes];
  const swipeId = Number.isInteger(m.swipe_id) && m.swipe_id >= 0 && m.swipe_id < swipes.length ? m.swipe_id : 0;
  const isUser = Boolean(m.is_user);
  return {
    ...m,
    name: String(m.name || (isUser ? 'Usuario' : ownerName)),
    is_user: isUser,
    is_system: Boolean(m.is_system),
    send_date: m.send_date ?? nowIso(),
    mes,
    swipes,
    swipe_id: swipeId,
    swipe_info: Array.isArray(m.swipe_info) ? m.swipe_info : [],
    extra: m.extra && typeof m.extra === 'object' ? m.extra : {},
  };
}

export async function importChat({ kind, ownerId, ownerName, raw, filename }) {
  const { meta, messages } = parseChat(raw);
  if (!messages.length) throw new HttpError(422, 'El archivo no contiene mensajes de chat (¿es un .jsonl válido?)');
  meta.character_name = meta.character_name || ownerName;
  meta.user_name = meta.user_name || messages.find((m) => m.is_user)?.name || 'Usuario';
  // La persona de otra instalación no existe aquí; se usará la predeterminada.
  delete meta.chat_metadata.persona;

  const dir = chatDir(kind, ownerId);
  await fs.mkdir(dir, { recursive: true });
  const base = safeName(String(filename).replace(/\.jsonl?$/i, ''), `${ownerName} - importado`);
  const file = await uniqueName(dir, base, '.jsonl');
  await writeFileAtomic(path.join(dir, `${file}.jsonl`), serializeChat({ meta, messages: messages.map((m) => normalizeImported(m, ownerName)) }));
  return file;
}

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
    personaId: meta.chat_metadata.persona || '',
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

// Copia el chat hasta el mensaje `index` (inclusive) como un chat nuevo enlazado al original.
async function cloneChat({ kind, owner, file, chat, count, title, suffix, link }) {
  const dir = chatDir(kind, owner);
  const meta = structuredClone(chat.meta);
  const base = String(meta.chat_metadata.title || meta.create_date || file).replace(/ \((rama|copia)\)$/, '');
  meta.create_date = stamp();
  if (link) meta.chat_metadata.main_chat = file;
  else delete meta.chat_metadata.main_chat;
  meta.chat_metadata.title = String(title || '').trim() || `${base} (${suffix})`;
  const name = await uniqueName(dir, safeName(`${meta.character_name || owner} - ${stamp()}`), '.jsonl');
  await writeFileAtomic(path.join(dir, `${name}.jsonl`), serializeChat({ meta, messages: structuredClone(chat.messages.slice(0, count)) }));
  return name;
}

// Copia el chat hasta el mensaje `index` (inclusive) como un chat nuevo enlazado al original.
export function branchChat({ kind, owner, file, chat, index, title }) {
  return cloneChat({ kind, owner, file, chat, count: index + 1, title, suffix: 'rama', link: true });
}

// Duplica el chat completo como un chat independiente.
export function copyChat({ kind, owner, file, chat, title }) {
  return cloneChat({ kind, owner, file, chat, count: chat.messages.length, title, suffix: 'copia', link: false });
}

// Escribe un chat individual dentro de la carpeta de un grupo, marcando quién dijo cada mensaje.
export async function writeChatToGroup({ chat, file, group, characterId, characterName }) {
  const dir = chatDir('g', group.id);
  await fs.mkdir(dir, { recursive: true });
  const meta = structuredClone(chat.meta);
  meta.character_name = group.name;
  const messages = chat.messages.map((m) =>
    !m.is_user && !m.is_system && !m.original_avatar && m.name === characterName ? { ...m, original_avatar: `${characterId}.png` } : m,
  );
  const name = await uniqueName(dir, safeName(file), '.jsonl');
  await writeFileAtomic(path.join(dir, `${name}.jsonl`), serializeChat({ meta, messages }));
  return name;
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
