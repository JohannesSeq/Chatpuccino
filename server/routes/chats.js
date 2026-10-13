import { Router } from 'express';
import { getCharacter } from '../cards.js';
import {
  branchChat,
  chatPath,
  copyChat,
  createChat,
  deleteChat,
  importChat,
  listAllChats,
  makeMessage,
  mutateChat,
  readChat,
  writeChatToGroup,
} from '../chats.js';
import { streamChat } from '../providers.js';
import { buildPrompt, stripSpeakerPrefix } from '../prompt.js';
import { estimateTokens } from '../lore.js';
import { getActivePreset } from '../presets.js';
import { activeConnection, chatKey, getSettings, isReady, setPinned } from '../settings.js';
import { samplingParams } from '../sampling.js';
import { startSse } from '../sse.js';
import { getGroup, getPersona, saveGroup } from '../store.js';
import { HttpError, wrap, nowIso } from '../util.js';

const r = Router();

async function resolvePersona(meta, settings) {
  const id = meta.chat_metadata?.persona || settings.defaultPersona;
  const persona = id ? await getPersona(id) : null;
  return persona || { id: '', name: meta.user_name || 'Usuario', description: '' };
}

async function loadOwner(kind, ownerId) {
  if (kind === 'c') {
    const c = await getCharacter(ownerId);
    return { name: c.data.name, members: [{ id: ownerId, ...c.data }], group: null };
  }
  const group = await getGroup(ownerId);
  const members = [];
  for (const id of group.members) {
    try {
      members.push({ id, ...(await getCharacter(id)).data });
    } catch {
      /* miembro eliminado */
    }
  }
  if (!members.length) throw new HttpError(409, 'Ningún miembro del grupo existe ya');
  return { name: group.name, members, group };
}

r.get('/', wrap(async (_req, res) => {
  const [chats, settings] = await Promise.all([listAllChats(), getSettings()]);
  const pins = new Set(settings.pinnedChats);
  res.json(chats.map((c) => ({ ...c, pinned: pins.has(chatKey(c.kind, c.ownerId, c.file)) })));
}));

// Importa un .jsonl (formato SillyTavern) como chat nuevo de un personaje o grupo.
r.post('/import', wrap(async (req, res) => {
  const { kind, ownerId } = req.query;
  if (!Buffer.isBuffer(req.body)) throw new HttpError(400, 'Envía el archivo como application/octet-stream');
  const owner = await loadOwner(kind, ownerId);
  let filename = String(req.headers['x-filename'] || '');
  try {
    filename = decodeURIComponent(filename);
  } catch {
    /* se usa tal cual */
  }
  const file = await importChat({ kind, ownerId, ownerName: owner.name, raw: req.body.toString('utf8'), filename });
  res.status(201).json({ kind, ownerId, file });
}));

r.post('/', wrap(async (req, res) => {
  const { kind, ownerId, personaId } = req.body || {};
  const settings = await getSettings();
  const persona = (personaId && (await getPersona(personaId))) || (settings.defaultPersona && (await getPersona(settings.defaultPersona))) || null;
  const owner = await loadOwner(kind, ownerId);
  const first = owner.members[0];
  const file = await createChat({ kind, ownerId, ownerName: owner.name, persona, speaker: first, speakerId: first.id });
  res.status(201).json({ kind, ownerId, file });
}));

r.get('/:kind/:owner/:file', wrap(async (req, res) => {
  const { kind, owner, file } = req.params;
  const chat = await readChat(kind, owner, file);
  const persona = await resolvePersona(chat.meta, await getSettings());
  res.json({ meta: chat.meta, messages: chat.messages, persona, title: chat.meta.chat_metadata.title || '' });
}));

r.patch('/:kind/:owner/:file', wrap(async (req, res) => {
  const { kind, owner, file } = req.params;
  const { title, personaId } = req.body || {};
  await mutateChat(kind, owner, file, async (chat) => {
    if (typeof title === 'string') {
      if (title.trim()) chat.meta.chat_metadata.title = title.trim();
      else delete chat.meta.chat_metadata.title;
    }
    if (typeof personaId === 'string') {
      const persona = personaId ? await getPersona(personaId) : null;
      if (personaId && !persona) throw new HttpError(404, 'Persona no encontrada');
      if (persona) {
        chat.meta.chat_metadata.persona = persona.id;
        chat.meta.user_name = persona.name;
      } else {
        delete chat.meta.chat_metadata.persona;
      }
    }
  });
  res.json({ ok: true });
}));

r.delete('/:kind/:owner/:file', wrap(async (req, res) => {
  await deleteChat(req.params.kind, req.params.owner, req.params.file);
  await setPinned(chatKey(req.params.kind, req.params.owner, req.params.file), false);
  res.status(204).end();
}));

r.get('/:kind/:owner/:file/export', wrap(async (req, res) => {
  const { kind, owner, file } = req.params;
  await readChat(kind, owner, file);
  res.download(chatPath(kind, owner, file), `${file}.jsonl`);
}));

r.post('/:kind/:owner/:file/messages', wrap(async (req, res) => {
  const { kind, owner, file } = req.params;
  const mes = String(req.body?.mes ?? '').trim();
  if (!mes) throw new HttpError(400, 'El mensaje está vacío');
  const settings = await getSettings();
  const out = await mutateChat(kind, owner, file, async (chat) => {
    const persona = await resolvePersona(chat.meta, settings);
    const msg = makeMessage({ name: persona.name, isUser: true, mes });
    chat.messages.push(msg);
    return { index: chat.messages.length - 1, message: msg };
  });
  res.status(201).json(out);
}));

function messageAt(chat, req) {
  const i = Number(req.params.i);
  const msg = chat.messages[i];
  if (!Number.isInteger(i) || !msg) throw new HttpError(404, 'Mensaje no encontrado');
  return { i, msg };
}

r.patch('/:kind/:owner/:file/messages/:i', wrap(async (req, res) => {
  const mes = String(req.body?.mes ?? '');
  if (!mes.trim()) throw new HttpError(400, 'El mensaje está vacío');
  const out = await mutateChat(req.params.kind, req.params.owner, req.params.file, (chat) => {
    const { msg } = messageAt(chat, req);
    msg.mes = mes;
    if (Array.isArray(msg.swipes)) msg.swipes[msg.swipe_id ?? 0] = mes;
    return msg;
  });
  res.json(out);
}));

r.delete('/:kind/:owner/:file/messages/:i', wrap(async (req, res) => {
  await mutateChat(req.params.kind, req.params.owner, req.params.file, (chat) => {
    const { i } = messageAt(chat, req);
    chat.messages.splice(i, 1);
  });
  res.status(204).end();
}));

r.post('/:kind/:owner/:file/messages/:i/swipe', wrap(async (req, res) => {
  const out = await mutateChat(req.params.kind, req.params.owner, req.params.file, (chat) => {
    const { msg } = messageAt(chat, req);
    const id = Number(req.body?.swipe_id);
    if (!Array.isArray(msg.swipes) || !Number.isInteger(id) || id < 0 || id >= msg.swipes.length) throw new HttpError(400, 'Swipe inválido');
    msg.swipe_id = id;
    msg.mes = msg.swipes[id];
    return msg;
  });
  res.json(out);
}));

// Elimina una variante (swipe) sin borrar el mensaje; por defecto la que se está mostrando.
r.delete('/:kind/:owner/:file/messages/:i/swipe', wrap(async (req, res) => {
  const out = await mutateChat(req.params.kind, req.params.owner, req.params.file, (chat) => {
    const { msg } = messageAt(chat, req);
    const swipes = Array.isArray(msg.swipes) && msg.swipes.length ? msg.swipes : [msg.mes];
    if (swipes.length < 2) throw new HttpError(409, 'Es la única variante: elimina el mensaje completo.');
    const id = req.query.id !== undefined ? Number(req.query.id) : msg.swipe_id ?? 0;
    if (!Number.isInteger(id) || id < 0 || id >= swipes.length) throw new HttpError(400, 'Variante inválida');
    msg.swipes = swipes.filter((_, k) => k !== id);
    if (Array.isArray(msg.swipe_info)) msg.swipe_info = msg.swipe_info.filter((_, k) => k !== id);
    msg.swipe_id = Math.max(0, id - 1);
    msg.mes = msg.swipes[msg.swipe_id];
    return msg;
  });
  res.json(out);
}));

// Ramifica: copia el chat hasta un mensaje (inclusive) en un chat nuevo.
r.post('/:kind/:owner/:file/branch', wrap(async (req, res) => {
  const { kind, owner, file } = req.params;
  const index = Number(req.body?.index);
  const chat = await readChat(kind, owner, file);
  if (!Number.isInteger(index) || index < 0 || index >= chat.messages.length) throw new HttpError(400, 'Mensaje inválido');
  const newFile = await branchChat({ kind, owner, file, chat, index, title: req.body?.title });
  res.status(201).json({ kind, ownerId: owner, file: newFile });
}));

// Fija o desfija un chat en la lista.
r.post('/:kind/:owner/:file/pin', wrap(async (req, res) => {
  const { kind, owner, file } = req.params;
  await readChat(kind, owner, file);
  const pinned = Boolean(req.body?.pinned);
  await setPinned(chatKey(kind, owner, file), pinned);
  res.json({ pinned });
}));

// Duplica el chat completo (sin enlace con el original).
r.post('/:kind/:owner/:file/copy', wrap(async (req, res) => {
  const { kind, owner, file } = req.params;
  const chat = await readChat(kind, owner, file);
  const newFile = await copyChat({ kind, owner, file, chat, title: req.body?.title });
  res.status(201).json({ kind, ownerId: owner, file: newFile });
}));

// Convierte un chat individual en un grupo nuevo (el personaje original + los elegidos).
r.post('/:kind/:owner/:file/to-group', wrap(async (req, res) => {
  const { kind, owner, file } = req.params;
  if (kind !== 'c') throw new HttpError(400, 'Solo los chats individuales se pueden convertir en grupo');
  const { name, members, replyMode, keepOriginal } = req.body || {};
  const original = await getCharacter(owner);
  const extra = [...new Set((Array.isArray(members) ? members : []).map(String))].filter((id) => id !== owner);
  for (const id of extra) await getCharacter(id);
  const chat = await readChat(kind, owner, file);
  const group = await saveGroup(null, { name, members: [owner, ...extra], replyMode });
  const newFile = await writeChatToGroup({ chat, file, group, characterId: owner, characterName: original.data.name });
  const wasPinned = (await getSettings()).pinnedChats.includes(chatKey(kind, owner, file));
  if (!keepOriginal) {
    await deleteChat(kind, owner, file);
    await setPinned(chatKey(kind, owner, file), false);
  }
  if (wasPinned) await setPinned(chatKey('g', group.id, newFile), true);
  res.status(201).json({ kind: 'g', ownerId: group.id, file: newFile });
}));

// Reúne todo lo necesario para la siguiente respuesta: quién habla, el historial y el prompt final del preset activo.
async function prepareGeneration({ kind, owner, file }, { speakerId, swipe, impersonate = false, draft = '' }) {
  const settings = await getSettings();
  const chat = await readChat(kind, owner, file);
  const ownerInfo = await loadOwner(kind, owner);
  const isGroup = kind === 'g';

  let history = chat.messages;
  let targetIndex = -1;
  let speaker;
  if (impersonate) {
    speaker = ownerInfo.members[0];
  } else if (swipe) {
    targetIndex = chat.messages.length - 1;
    const last = chat.messages[targetIndex];
    if (!last || last.is_user) throw new HttpError(400, 'No hay una respuesta que regenerar');
    history = chat.messages.slice(0, -1);
    speaker = isGroup
      ? ownerInfo.members.find((m) => `${m.id}.png` === last.original_avatar) || ownerInfo.members.find((m) => m.name === last.name)
      : ownerInfo.members[0];
  } else {
    speaker = isGroup ? ownerInfo.members.find((m) => m.id === speakerId) : ownerInfo.members[0];
  }
  if (!speaker) throw new HttpError(400, 'Personaje que responde no válido');

  const persona = await resolvePersona(chat.meta, settings);
  const { name: presetName, preset } = await getActivePreset(settings);
  const prompt = await buildPrompt({
    settings,
    preset,
    speaker,
    members: isGroup ? ownerInfo.members : null,
    persona,
    userName: persona.name,
    history,
    trigger: swipe ? 'swipe' : 'normal',
    impersonate,
    draft,
  });
  return { settings, isGroup, speaker, targetIndex, persona, preset, presetName, prompt };
}

// Inspector de prompt: lo que se enviaría ahora mismo al modelo.
r.post('/:kind/:owner/:file/prompt', wrap(async (req, res) => {
  const { prompt, preset, presetName, speaker } = await prepareGeneration(req.params, req.body || {});
  const messages = prompt.map((m) => ({ ...m, tokens: estimateTokens(m.content) }));
  res.json({ preset: presetName, speaker: speaker.name, maxTokens: preset.openai_max_tokens, messages, totalTokens: messages.reduce((n, m) => n + m.tokens, 0) });
}));

function requireReady(settings) {
  const conn = activeConnection(settings);
  if (!conn) throw new HttpError(400, 'Configura una conexión (Ajustes → Conexión y modelo).');
  if (!isReady(conn)) {
    throw new HttpError(400, conn.model ? 'La conexión activa está incompleta (Ajustes → Conexión y modelo).' : 'Selecciona un modelo (Ajustes → Conexión y modelo).');
  }
  return conn;
}

// Impersonar: el modelo escribe un mensaje como el usuario. Solo se devuelve el texto; no se guarda nada en el chat.
r.post('/:kind/:owner/:file/impersonate', wrap(async (req, res) => {
  const conn = requireReady(await getSettings());
  const draft = String(req.body?.draft ?? '').slice(0, 4000);
  const { speaker, persona, preset, prompt, isGroup } = await prepareGeneration(req.params, { impersonate: true, draft });
  const owner = await loadOwner(req.params.kind, req.params.owner);
  // Que el modelo no continúe escribiendo por los personajes.
  const stop = (isGroup ? owner.members : [speaker]).slice(0, 4).map((m) => `\n${m.name}:`);
  const { ac, send } = startSse(res);

  let streamed = '';
  const finish = (text, extra = {}) => {
    const clean = stripSpeakerPrefix(text, persona.name).trim();
    if (clean) send({ done: true, text: clean, ...extra });
    else send({ error: 'El modelo devolvió una respuesta vacía.' });
  };
  try {
    streamed = await streamChat({
      conn,
      signal: ac.signal,
      body: { model: conn.model, messages: prompt, ...samplingParams(preset, persona.name, stop) },
      onDelta: (delta) => send({ delta }),
    });
    finish(streamed);
  } catch (e) {
    const partial = e.partial || '';
    if (e.name === 'AbortError') {
      if (partial.trim()) finish(partial, { aborted: true });
    } else if (partial.trim()) {
      finish(partial, { warning: e.message });
    } else {
      send({ error: e.message || 'Error al generar el mensaje' });
    }
  } finally {
    res.end();
  }
}));

r.post('/:kind/:owner/:file/generate', wrap(async (req, res) => {
  const { kind, owner, file } = req.params;
  const { swipe } = req.body || {};
  const conn = requireReady(await getSettings());

  const { isGroup, speaker, targetIndex, persona, preset, prompt } = await prepareGeneration(req.params, req.body || {});

  const { ac, send } = startSse(res);

  const startedAt = nowIso();
  const persist = async (raw) => {
    const text = (isGroup ? stripSpeakerPrefix(raw, speaker.name) : raw).trim();
    if (!text) return null;
    return mutateChat(kind, owner, file, (c) => {
      const info = { send_date: nowIso(), gen_started: startedAt, gen_finished: nowIso(), extra: { model: conn.model } };
      if (swipe) {
        const m = c.messages[targetIndex];
        if (!m) throw new HttpError(409, 'El mensaje ya no existe');
        m.swipes = Array.isArray(m.swipes) && m.swipes.length ? m.swipes : [m.mes];
        m.swipe_info = Array.isArray(m.swipe_info) ? m.swipe_info : [];
        while (m.swipe_info.length < m.swipes.length) m.swipe_info.push({});
        m.swipes.push(text);
        m.swipe_info.push(info);
        m.swipe_id = m.swipes.length - 1;
        m.mes = text;
        return { index: targetIndex, message: m };
      }
      const m = makeMessage({ name: speaker.name, isUser: false, mes: text, characterId: speaker.id, model: conn.model });
      c.messages.push(m);
      return { index: c.messages.length - 1, message: m };
    });
  };

  try {
    const text = await streamChat({
      conn,
      signal: ac.signal,
      body: { model: conn.model, messages: prompt, ...samplingParams(preset, persona.name) },
      onDelta: (delta) => send({ delta }),
    });
    const saved = await persist(text);
    if (!saved) send({ error: 'El modelo devolvió una respuesta vacía.' });
    else send({ done: true, ...saved });
  } catch (e) {
    const partial = e.partial || '';
    let saved = null;
    if (partial.trim()) {
      try {
        saved = await persist(partial);
      } catch {
        /* el chat pudo cambiar mientras tanto */
      }
    }
    if (e.name === 'AbortError') {
      if (saved) send({ done: true, aborted: true, ...saved });
    } else if (saved) {
      send({ done: true, warning: e.message, ...saved });
    } else {
      send({ error: e.message || 'Error al generar la respuesta' });
    }
  } finally {
    res.end();
  }
}));

export default r;
