import { OPENROUTER_BASE } from './config.js';
import { HttpError } from './util.js';

const HEADERS = {
  'HTTP-Referer': 'http://localhost:3001',
  'X-Title': 'Aberracion',
};

let modelsCache = { at: 0, data: null };

export async function listModels() {
  if (modelsCache.data && Date.now() - modelsCache.at < 10 * 60 * 1000) return modelsCache.data;
  let res;
  try {
    res = await fetch(`${OPENROUTER_BASE}/models`, { headers: HEADERS });
  } catch (e) {
    throw new HttpError(502, `No se pudo conectar con OpenRouter: ${e.message}`);
  }
  if (!res.ok) throw new HttpError(502, `OpenRouter respondió ${res.status} al listar modelos`);
  const json = await res.json();
  const data = (json.data || [])
    .map((m) => ({
      id: m.id,
      name: m.name || m.id,
      context: m.context_length || 0,
      promptPrice: Number(m.pricing?.prompt) || 0,
      completionPrice: Number(m.pricing?.completion) || 0,
      description: (m.description || '').slice(0, 300),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  modelsCache = { at: Date.now(), data };
  return data;
}

export async function checkKey(apiKey) {
  let res;
  try {
    res = await fetch(`${OPENROUTER_BASE}/auth/key`, { headers: { ...HEADERS, Authorization: `Bearer ${apiKey}` } });
  } catch (e) {
    throw new HttpError(502, `No se pudo conectar con OpenRouter: ${e.message}`);
  }
  if (res.status === 401 || res.status === 403) throw new HttpError(401, 'La API key no es válida');
  if (!res.ok) throw new HttpError(502, `OpenRouter respondió ${res.status}`);
  const json = await res.json();
  return json.data || {};
}

async function errorFromResponse(res) {
  let detail = '';
  try {
    const j = await res.json();
    detail = j?.error?.message || JSON.stringify(j).slice(0, 300);
  } catch {
    /* sin cuerpo */
  }
  return new HttpError(res.status === 401 ? 401 : 502, `OpenRouter (${res.status}): ${detail || res.statusText}`);
}

/** Pide una respuesta en streaming y llama a onDelta por cada fragmento. Devuelve el texto completo. */
export async function streamChat({ apiKey, body, signal, onDelta }) {
  let res;
  try {
    res = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
      method: 'POST',
      headers: { ...HEADERS, Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, stream: true }),
      signal,
    });
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw new HttpError(502, `No se pudo conectar con OpenRouter: ${e.message}`);
  }
  if (!res.ok) throw await errorFromResponse(res);

  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
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
    if (json.error) throw new HttpError(502, `OpenRouter: ${json.error.message || 'error durante la generación'}`);
    const delta = json.choices?.[0]?.delta?.content;
    if (delta) {
      text += delta;
      onDelta(delta);
    }
  };

  try {
    for await (const chunk of res.body) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop();
      lines.forEach(handleLine);
    }
    handleLine(buffer);
  } catch (e) {
    e.partial = text;
    throw e;
  }
  return text;
}
