const enc = encodeURIComponent;

async function req(method, url, body) {
  let res;
  try {
    res = await fetch(`/api${url}`, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error('No se pudo conectar con el servidor');
  }
  if (res.status === 204) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || `Error ${res.status}`);
  return data;
}

export const chatUrl = ({ kind, ownerId, file }) => `/chats/${kind}/${enc(ownerId)}/${enc(file)}`;
export const chatRoute = ({ kind, ownerId, file }) => `/chats/${kind}/${enc(ownerId)}/${enc(file)}`;

export const avatarUrl = {
  character: (c) => `/api/characters/${enc(c.id)}/avatar?v=${c.mtime || 0}`,
  persona: (p) => (p.hasAvatar ? `/api/personas/${enc(p.id)}/avatar?v=${p.mtime || 0}` : null),
};

export const api = {
  settings: () => req('GET', '/settings'),
  saveSettings: (patch) => req('PUT', '/settings', patch),
  models: () => req('GET', '/models'),
  testKey: (apiKey) => req('POST', '/openrouter/test', { apiKey }),

  characters: () => req('GET', '/characters'),
  character: (id) => req('GET', `/characters/${enc(id)}`),
  createCharacter: (data, image) => req('POST', '/characters', { data, image }),
  updateCharacter: (id, data, image) => req('PUT', `/characters/${enc(id)}`, { data, image }),
  deleteCharacter: (id) => req('DELETE', `/characters/${enc(id)}`),
  async importCharacter(file) {
    const isPng = /\.png$/i.test(file.name) || file.type === 'image/png';
    let res;
    if (isPng) {
      res = await fetch('/api/characters/import', { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: await file.arrayBuffer() });
    } else {
      let json;
      try {
        json = JSON.parse(await file.text());
      } catch {
        throw new Error(`${file.name}: no es un JSON válido`);
      }
      res = await fetch('/api/characters/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(json) });
    }
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(`${file.name}: ${data?.error || res.status}`);
    return data;
  },

  personas: () => req('GET', '/personas'),
  createPersona: (body) => req('POST', '/personas', body),
  updatePersona: (id, body) => req('PUT', `/personas/${enc(id)}`, body),
  deletePersona: (id) => req('DELETE', `/personas/${enc(id)}`),

  groups: () => req('GET', '/groups'),
  createGroup: (body) => req('POST', '/groups', body),
  updateGroup: (id, body) => req('PUT', `/groups/${enc(id)}`, body),
  deleteGroup: (id) => req('DELETE', `/groups/${enc(id)}`),

  lorebooks: () => req('GET', '/lorebooks'),
  lorebook: (name) => req('GET', `/lorebooks/${enc(name)}`),
  createLorebook: (name, book) => req('POST', '/lorebooks', { name, book }),
  saveLorebook: (name, book) => req('PUT', `/lorebooks/${enc(name)}`, book),
  renameLorebook: (name, newName) => req('POST', `/lorebooks/${enc(name)}/rename`, { newName }),
  deleteLorebook: (name) => req('DELETE', `/lorebooks/${enc(name)}`),

  chats: () => req('GET', '/chats'),
  createChat: (kind, ownerId, personaId) => req('POST', '/chats', { kind, ownerId, personaId }),
  chat: (ref) => req('GET', chatUrl(ref)),
  patchChat: (ref, body) => req('PATCH', chatUrl(ref), body),
  deleteChat: (ref) => req('DELETE', chatUrl(ref)),
  addMessage: (ref, mes) => req('POST', `${chatUrl(ref)}/messages`, { mes }),
  editMessage: (ref, i, mes) => req('PATCH', `${chatUrl(ref)}/messages/${i}`, { mes }),
  deleteMessage: (ref, i) => req('DELETE', `${chatUrl(ref)}/messages/${i}`),
  setSwipe: (ref, i, swipe_id) => req('POST', `${chatUrl(ref)}/messages/${i}/swipe`, { swipe_id }),
};

/** Genera una respuesta por streaming (SSE sobre fetch). Resuelve con { index, message }. */
export async function generate(ref, body, signal, onDelta) {
  const res = await fetch(`/api${chatUrl(ref)}/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.error || `Error ${res.status}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let result = null;
  const handle = (block) => {
    const line = block.split('\n').find((l) => l.startsWith('data:'));
    if (!line) return;
    const evt = JSON.parse(line.slice(5));
    if (evt.delta) onDelta(evt.delta);
    else if (evt.error) throw new Error(evt.error);
    else if (evt.done) result = evt;
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split('\n\n');
    buffer = blocks.pop();
    blocks.forEach(handle);
  }
  if (buffer.trim()) handle(buffer);
  return result;
}
