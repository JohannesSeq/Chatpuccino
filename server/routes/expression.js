import { Router } from 'express';
import { streamChat } from '../providers.js';
import { activeConnection, getSettings, isReady } from '../settings.js';
import { HttpError, wrap } from '../util.js';
import { t } from '../i18n.js';

const r = Router();
const LABEL_RE = /^[a-z0-9_-]{1,40}$/;
const MAX_LABELS = 80;
const MAX_TEXT = 1500;

/** Etiqueta de la lista a la que se refiere la respuesta del modelo (o null). Tolera comillas, mayúsculas y texto alrededor. */
export function parseLabel(text, labels) {
  const s = String(text ?? '')
    .toLowerCase()
    .replace(/<think>[\s\S]*?<\/think>/g, ' ');
  const words = s.split(/[^a-z0-9_-]+/).filter(Boolean);
  // La primera etiqueta que aparece: los modelos responden con ella al principio.
  for (const w of words) if (labels.includes(w)) return w;
  return null;
}

// Pide al modelo activo que elija la expresión (entre las que tiene el personaje) que mejor refleja el mensaje.
r.post('/', wrap(async (req, res) => {
  const text = String(req.body?.text ?? '').trim().slice(-MAX_TEXT);
  const labels = [...new Set((Array.isArray(req.body?.labels) ? req.body.labels : []).filter((l) => typeof l === 'string' && LABEL_RE.test(l)))].slice(0, MAX_LABELS);
  if (!text) throw new HttpError(400, t('server.expression.text_required'));
  if (!labels.length) throw new HttpError(400, t('server.expression.labels_required'));
  const settings = await getSettings();
  const conn = activeConnection(settings);
  if (!conn) throw new HttpError(400, t('server.chats.setup_connection'));
  if (!isReady(conn)) throw new HttpError(400, conn.model ? t('server.chats.connection_incomplete') : t('server.chats.select_model'));
  const ac = new AbortController();
  res.on('close', () => !res.writableEnded && ac.abort());
  const name = String(req.body?.name ?? '').trim().slice(0, 80);
  let out;
  try {
    out = await streamChat({
      conn,
      signal: ac.signal,
      body: {
        model: conn.model,
        messages: [
          { role: 'system', content: t('server.expression.system') },
          { role: 'user', content: t('server.expression.user', { name: name || '?', labels: labels.join(', '), text }) },
        ],
        temperature: 0,
        // Mismo margen que el análisis de estadísticas: los modelos que razonan gastan tokens antes de responder.
        max_tokens: settings.analysisTokens,
      },
      onDelta: () => {},
    });
  } catch (e) {
    if (e.name === 'AbortError') return;
    throw e;
  }
  res.json({ label: parseLabel(out, labels) });
}));

export default r;
