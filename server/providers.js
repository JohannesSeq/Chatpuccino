import { OPENROUTER_BASE } from './config.js';
import { HttpError } from './util.js';
import { t } from './i18n.js';

const OR_HEADERS = { 'HTTP-Referer': 'http://localhost:3001', 'X-Title': 'Chatpuccino' };

export const baseOf = (conn) => (conn.type === 'openrouter' ? OPENROUTER_BASE : conn.baseUrl.replace(/\/+$/, ''));

function headersOf(conn, json = false) {
  const h = conn.type === 'openrouter' ? { ...OR_HEADERS } : {};
  if (conn.apiKey) h.Authorization = `Bearer ${conn.apiKey}`;
  if (json) h['Content-Type'] = 'application/json';
  return h;
}

const where = (conn) => (conn.type === 'openrouter' ? 'OpenRouter' : baseOf(conn));

async function request(conn, path, init = {}) {
  try {
    return await fetch(`${baseOf(conn)}${path}`, { ...init, headers: { ...headersOf(conn, Boolean(init.body)), ...init.headers } });
  } catch (e) {
    if (e.name === 'AbortError' || e.name === 'TimeoutError') {
      if (init.signal && !init.signal.reason?.name) throw e;
      throw new HttpError(504, t('server.providers.timeout', { where: where(conn) }));
    }
    throw new HttpError(502, t('server.providers.connect_failed', { where: where(conn), reason: e.cause?.code || e.message }));
  }
}

export function normalizeBaseUrl(raw) {
  let u = String(raw || '').trim();
  if (!u) throw new HttpError(400, t('server.providers.local_url_required'));
  if (!/^https?:\/\//i.test(u)) u = `http://${u}`;
  try {
    return new URL(u).toString().replace(/\/+$/, '');
  } catch {
    throw new HttpError(400, t('server.providers.invalid_url'));
  }
}

const orCache = { at: 0, base: '', data: null };

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export async function listModels(conn) {
  const isOr = conn.type === 'openrouter';
  if (isOr && orCache.data && orCache.base === baseOf(conn) && Date.now() - orCache.at < 10 * 60 * 1000) return orCache.data;
  const res = await request(conn, '/models', { signal: AbortSignal.timeout(15000) });
  if (res.status === 401 || res.status === 403) throw new HttpError(401, t('server.providers.credentials_rejected', { where: where(conn) }));
  if (!res.ok) throw new HttpError(502, t('server.providers.list_models_failed', { where: where(conn), status: res.status }));
  const json = await res.json().catch(() => null);
  const list = Array.isArray(json?.data) ? json.data : Array.isArray(json?.models) ? json.models : Array.isArray(json) ? json : [];
  const data = list
    .map((m) => {
      const id = m.id || m.name || m.model;
      return {
        id,
        name: m.name || id,
        context: num(m.context_length || m.max_model_len || m.context_window),
        promptPrice: num(m.pricing?.prompt),
        completionPrice: num(m.pricing?.completion),
      };
    })
    .filter((m) => m.id)
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  if (isOr) Object.assign(orCache, { at: Date.now(), base: baseOf(conn), data });
  return data;
}

export async function checkConnection(conn) {
  if (conn.type === 'local') {
    const models = await listModels(conn);
    return { ok: true, message: t('server.providers.connected', { url: baseOf(conn), count: models.length }) };
  }
  if (!conn.apiKey) throw new HttpError(400, t('server.providers.no_api_key'));
  const res = await request(conn, '/auth/key', { signal: AbortSignal.timeout(15000) });
  if (res.status === 401 || res.status === 403) throw new HttpError(401, t('server.providers.invalid_key'));
  if (!res.ok) throw new HttpError(502, t('server.providers.openrouter_status', { status: res.status }));
  const info = (await res.json().catch(() => ({}))).data || {};
  return { ok: true, message: info.label ? t('server.providers.key_valid_label', { label: info.label }) : t('server.providers.key_valid') };
}

async function errorFromResponse(conn, res) {
  let detail = '';
  try {
    const j = await res.json();
    detail = j?.error?.message || (typeof j?.error === 'string' ? j.error : '') || JSON.stringify(j).slice(0, 300);
  } catch {
    /* sin cuerpo */
  }
  return new HttpError(res.status === 401 ? 401 : 502, `${where(conn)} (${res.status}): ${detail || res.statusText}`);
}

const textOf = (v) => {
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return v.map((p) => (typeof p === 'string' ? p : p?.text || '')).join('');
  return '';
};

/**
 * Pide una respuesta en streaming y llama a onDelta por cada fragmento. Devuelve el texto completo.
 * Si se pasa `meta` se rellena con datos de diagnóstico (motivo de fin, razonamiento, rechazos, uso…)
 * para poder explicar por qué una respuesta salió vacía (ver aiDiagnostics.js).
 */
export async function streamChat({ conn, body, signal, onDelta, meta = {} }) {
  const startedAt = Date.now();
  Object.assign(meta, { events: 0, contentChars: 0, reasoningChars: 0, finishReason: '', refusal: '', usage: null, responseModel: '', provider: '', id: '', sample: [], nonStream: false });
  const res = await request(conn, '/chat/completions', { method: 'POST', body: JSON.stringify({ ...body, stream: true }), signal });
  meta.status = res.status;
  meta.contentType = res.headers.get('content-type') || '';
  if (!res.ok) throw await errorFromResponse(conn, res);

  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  const note = (json) => {
    meta.id ||= json.id || '';
    meta.responseModel ||= json.model || '';
    meta.provider ||= json.provider || '';
    if (json.usage) meta.usage = json.usage;
    const choice = json.choices?.[0];
    if (choice?.finish_reason) meta.finishReason = choice.finish_reason;
    if (choice?.native_finish_reason && !meta.nativeFinishReason) meta.nativeFinishReason = choice.native_finish_reason;
  };
  const addContent = (delta) => {
    if (!delta) return;
    text += delta;
    meta.contentChars += delta.length;
    onDelta(delta);
  };
  const handleJson = (json) => {
    meta.events += 1;
    if (meta.sample.length < 3) meta.sample.push(JSON.stringify(json).slice(0, 400));
    if (json.error) throw new HttpError(502, `${where(conn)}: ${json.error.message || t('server.providers.generation_error')}`);
    note(json);
    const choice = json.choices?.[0];
    const delta = choice?.delta || choice?.message || {};
    addContent(textOf(delta.content));
    meta.reasoningChars += textOf(delta.reasoning || delta.reasoning_content).length;
    if (delta.refusal) meta.refusal += textOf(delta.refusal);
  };
  const handleLine = (line) => {
    if (!line.startsWith('data:')) return;
    const payload = line.slice(5).trim();
    if (!payload || payload === '[DONE]') return;
    let json;
    try {
      json = JSON.parse(payload);
    } catch {
      return;
    }
    handleJson(json);
  };

  try {
    if (/application\/json/i.test(meta.contentType)) {
      // Algunos servidores ignoran `stream` y responden con la respuesta completa en un JSON.
      meta.nonStream = true;
      handleJson(await res.json());
    } else {
      for await (const chunk of res.body) {
        buffer += decoder.decode(chunk, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop();
        lines.forEach(handleLine);
      }
      handleLine(buffer);
    }
  } catch (e) {
    e.partial = text;
    meta.ms = Date.now() - startedAt;
    throw e;
  }
  meta.ms = Date.now() - startedAt;
  return text;
}
