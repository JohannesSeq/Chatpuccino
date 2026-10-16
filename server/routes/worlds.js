import { Router } from 'express';
import { splitControl, streamVisible } from '../../shared/vn.js';
import { streamChat } from '../providers.js';
import { stripSpeakerPrefix } from '../prompt.js';
import { getActivePreset } from '../presets.js';
import { activeConnection, getSettings, isReady } from '../settings.js';
import { samplingParams } from '../sampling.js';
import { reportEmpty } from '../aiDiagnostics.js';
import { startSse } from '../sse.js';
import { HttpError, nowIso, wrap } from '../util.js';
import { t } from '../i18n.js';
import {
  addUserMessage,
  branchWorld,
  buildAnalysisMessages,
  buildSceneMessages,
  copyWorld,
  createWorld,
  currentState,
  deleteMessage,
  deleteSwipe,
  deleteWorld,
  editMessage,
  getWorldDetail,
  listWorlds,
  loadContext,
  parseJsonLoose,
  persistReevaluation,
  persistScene,
  prepareReevaluation,
  readStory,
  readWorld,
  resolvePersona,
  selectSwipe,
  setStatValue,
  stateBefore,
  stateOptions,
  updateWorld,
} from '../worlds.js';

const r = Router();

function requireReady(settings) {
  const conn = activeConnection(settings);
  if (!conn) throw new HttpError(400, t('server.chats.setup_connection'));
  if (!isReady(conn)) throw new HttpError(400, conn.model ? t('server.chats.connection_incomplete') : t('server.chats.select_model'));
  return conn;
}

r.get('/', wrap(async (_req, res) => {
  res.json(await listWorlds());
}));

r.post('/', wrap(async (req, res) => {
  res.status(201).json(await createWorld(req.body));
}));

r.get('/:id', wrap(async (req, res) => {
  res.json(await getWorldDetail(req.params.id));
}));

r.put('/:id', wrap(async (req, res) => {
  res.json(await updateWorld(req.params.id, req.body));
}));

r.delete('/:id', wrap(async (req, res) => {
  await deleteWorld(req.params.id);
  res.status(204).end();
}));

r.post('/:id/messages', wrap(async (req, res) => {
  res.status(201).json(await addUserMessage(req.params.id, req.body?.mes));
}));

r.patch('/:id/messages/:i', wrap(async (req, res) => {
  res.json(await editMessage(req.params.id, req.params.i, req.body?.mes));
}));

r.delete('/:id/messages/:i', wrap(async (req, res) => {
  await deleteMessage(req.params.id, req.params.i);
  res.status(204).end();
}));

r.post('/:id/messages/:i/swipe', wrap(async (req, res) => {
  res.json(await selectSwipe(req.params.id, req.params.i, req.body?.swipe_id));
}));

r.delete('/:id/messages/:i/swipe', wrap(async (req, res) => {
  res.json(await deleteSwipe(req.params.id, req.params.i, req.query.id));
}));

r.post('/:id/branch', wrap(async (req, res) => {
  res.status(201).json(await branchWorld(req.params.id, req.body));
}));

r.post('/:id/copy', wrap(async (req, res) => {
  res.status(201).json(await copyWorld(req.params.id, req.body));
}));

r.patch('/:id/state', wrap(async (req, res) => {
  res.json(await setStatValue(req.params.id, req.body));
}));

// Reúne todo lo necesario para la siguiente generación (escena del narrador o mensaje del usuario).
async function prepare(id, { impersonate = false, speakerId = '', swipe = false, start = false, instruction = '', draft = '' }) {
  const settings = await getSettings();
  const world = await readWorld(id);
  const chat = await readStory(id);
  const c = await loadContext(world);
  const opts = stateOptions(c);

  let history = chat.messages;
  let targetIndex = -1;
  let state;
  if (impersonate) {
    state = currentState(world, chat.messages, opts);
  } else if (swipe) {
    targetIndex = chat.messages.length - 1;
    const last = chat.messages[targetIndex];
    if (!last || last.is_user) throw new HttpError(400, t('server.worlds.nothing_to_regenerate'));
    history = chat.messages.slice(0, -1);
    state = stateBefore(world, chat.messages, targetIndex, opts);
  } else {
    if (start && chat.messages.length) throw new HttpError(409, t('server.worlds.start_not_empty'));
    state = currentState(world, chat.messages, opts);
  }
  if (speakerId && !state.scene.active.includes(speakerId)) throw new HttpError(400, t('server.worlds.invalid_speaker'));

  const persona = await resolvePersona(world, chat, settings);
  const { name: presetName, preset } = await getActivePreset(settings);
  const messages = await buildSceneMessages({
    world,
    settings,
    preset,
    persona,
    cast: c.cast,
    stats: c.stats,
    backgrounds: c.backgrounds,
    state,
    history,
    mode: impersonate ? 'impersonate' : 'scene',
    speakerId: String(speakerId || ''),
    instruction: String(instruction || '').slice(0, 4000),
    start: !impersonate && history.length === 0,
    draft: String(draft || '').slice(0, 4000),
  });
  return { settings, world, c, state, history, targetIndex, persona, preset, presetName, messages };
}

// Inspector de prompt: lo que se enviaría ahora mismo al modelo.
r.post('/:id/prompt', wrap(async (req, res) => {
  const { messages, preset, presetName } = await prepare(req.params.id, req.body || {});
  res.json({ preset: presetName, maxTokens: preset.openai_max_tokens, messages });
}));

const LEADING_TAG = /^\s*\[[^\]\n]{1,60}\]\s*/;

/** Pide al modelo solo los cambios de estadísticas de una escena. Resuelve con { stats } o null si la respuesta no es utilizable. */
async function requestStats({ conn, signal, persona, c, state, script, userMessage, meta, maxTokens }) {
  const text = await streamChat({
    conn,
    signal,
    meta,
    body: {
      model: conn.model,
      messages: buildAnalysisMessages({ persona, cast: c.cast, stats: c.stats, state, scriptText: script, userMessage }),
      temperature: 0.2,
      // Configurable (Ajustes → Presets): los modelos que razonan necesitan margen antes de contestar.
      max_tokens: maxTokens,
    },
    onDelta: () => {},
  });
  const json = parseJsonLoose(text);
  return json && Array.isArray(json.stats) ? { stats: json.stats } : null;
}

// Reevalúa las estadísticas de la última escena (p. ej. cuando falló la consulta de análisis o el modelo se equivocó).
r.post('/:id/reevaluate', wrap(async (req, res) => {
  const settings = await getSettings();
  const conn = requireReady(settings);
  const input = await prepareReevaluation(req.params.id);
  const ac = new AbortController();
  res.on('close', () => !res.writableEnded && ac.abort());
  const meta = {};
  let out;
  try {
    out = await requestStats({ conn, signal: ac.signal, persona: input.persona, c: input.c, state: input.base, script: input.mes, userMessage: input.userMessage, meta, maxTokens: settings.analysisTokens });
  } catch (e) {
    if (e.name === 'AbortError') return;
    throw e;
  }
  if (!out) {
    if (!meta.contentChars) {
      const empty = reportEmpty({ where: 'analysis', conn, meta, maxTokens: settings.analysisTokens });
      throw new HttpError(502, empty.error, empty.code);
    }
    console.warn('[IA] La reevaluación de estadísticas no devolvió un JSON válido.');
    throw new HttpError(502, t('server.worlds.reevaluate_invalid'), 'REEVALUATE_INVALID');
  }
  res.json(await persistReevaluation(req.params.id, { index: input.index, swipeId: input.swipeId, mes: input.mes, control: out }));
}));

r.post('/:id/impersonate', wrap(async (req, res) => {
  const conn = requireReady(await getSettings());
  const { persona, preset, messages } = await prepare(req.params.id, { impersonate: true, draft: req.body?.draft });
  const { ac, send } = startSse(res);

  const meta = {};
  const finish = (text, extra = {}) => {
    const clean = stripSpeakerPrefix(text, persona.name).replace(LEADING_TAG, '').trim();
    if (clean) send({ done: true, text: clean, ...extra });
    else send(reportEmpty({ where: 'world', conn, meta, maxTokens: preset.openai_max_tokens, cleanedEmpty: Boolean(text.trim()) }));
  };
  try {
    const text = await streamChat({
      conn,
      signal: ac.signal,
      meta,
      body: { model: conn.model, messages, ...samplingParams(preset, persona.name, []) },
      onDelta: (delta) => send({ delta }),
    });
    finish(text);
  } catch (e) {
    const partial = e.partial || '';
    if (e.name === 'AbortError') {
      if (partial.trim()) finish(partial, { aborted: true });
    } else if (partial.trim()) {
      finish(partial, { warning: e.message });
    } else {
      send({ error: e.message || t('server.worlds.impersonate_error') });
    }
  } finally {
    res.end();
  }
}));

r.post('/:id/generate', wrap(async (req, res) => {
  const { id } = req.params;
  const body = req.body || {};
  const swipe = Boolean(body.swipe);
  const conn = requireReady(await getSettings());
  const prep = await prepare(id, { speakerId: body.speakerId, swipe, start: Boolean(body.start), instruction: body.instruction });
  const { ac, send } = startSse(res);
  const startedAt = nowIso();

  // Pide solo los cambios de estadísticas cuando el modelo no escribió un bloque de control válido.
  // Si la consulta falla no se pierde la escena: se guarda sin cambios y se avisa para poder reevaluarla.
  let analysisFailed = false;
  const analyze = async (script) => {
    if (!prep.c.stats.length) return null;
    const userMessage = [...prep.history].reverse().find((m) => m.is_user)?.mes || '';
    try {
      const meta = {};
      const maxTokens = prep.settings.analysisTokens;
      const out = await requestStats({ conn, signal: ac.signal, persona: prep.persona, c: prep.c, state: prep.state, script, userMessage, meta, maxTokens });
      if (!out) {
        analysisFailed = true;
        // Solo registro en consola (el usuario ya recibe el aviso de «reevaluar»); ayuda a ver si faltaron tokens.
        if (!meta.contentChars) reportEmpty({ where: 'analysis', conn, meta, maxTokens });
      }
      return out;
    } catch (e) {
      if (e.name !== 'AbortError') {
        analysisFailed = true;
        console.warn(`[IA] Falló el análisis de estadísticas del mundo: ${e.message}`);
      }
      return null;
    }
  };

  const persist = async (raw, { analysis }) => {
    const { script, control } = splitControl(raw);
    if (!script) return null;
    const final = control || (analysis ? await analyze(script) : null);
    return persistScene(id, { script, control: final, model: conn.model, startedAt, swipe, targetIndex: prep.targetIndex });
  };

  let acc = '';
  let sent = 0;
  const meta = {};
  const maxTokens = Math.max(prep.preset.openai_max_tokens || 0, 800);
  try {
    const text = await streamChat({
      conn,
      signal: ac.signal,
      meta,
      // Una escena con varias líneas y el bloque de control necesita más margen que un mensaje de chat.
      body: { model: conn.model, messages: prep.messages, ...samplingParams({ ...prep.preset, openai_max_tokens: Math.max(prep.preset.openai_max_tokens || 0, 800) }, prep.persona.name, []) },
      onDelta: (delta) => {
        acc += delta;
        const visible = streamVisible(acc);
        if (visible.length > sent) {
          send({ delta: visible.slice(sent) });
          sent = visible.length;
        }
      },
    });
    const saved = await persist(text, { analysis: true });
    if (!saved) send(reportEmpty({ where: 'world', conn, meta, maxTokens, cleanedEmpty: Boolean(text.trim()) }));
    else send({ done: true, ...saved, ...(analysisFailed ? { analysisFailed: true } : {}) });
  } catch (e) {
    const partial = e.partial || '';
    let saved = null;
    if (partial.trim()) {
      try {
        saved = await persist(partial, { analysis: false });
      } catch {
        /* el mundo pudo cambiar mientras tanto */
      }
    }
    if (e.name === 'AbortError') {
      if (saved) send({ done: true, aborted: true, ...saved });
    } else if (saved) {
      send({ done: true, warning: e.message, ...saved });
    } else {
      send({ error: e.message || t('server.worlds.generate_error') });
    }
  } finally {
    res.end();
  }
}));

export default r;
