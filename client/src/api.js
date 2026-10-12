const enc = encodeURIComponent;

// Cualquier 401 (salvo en el login) avisa a la app para volver a la pantalla de acceso.
async function apiFetch(url, init) {
  let res;
  try {
    res = await fetch(url, init);
  } catch {
    throw new Error('No se pudo conectar con el servidor');
  }
  if (res.status === 401 && !url.startsWith('/api/auth/login')) window.dispatchEvent(new Event('auth:expired'));
  return res;
}

async function req(method, url, body) {
  const res = await apiFetch(`/api${url}`, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || `Error ${res.status}`);
  return data;
}

export const chatUrl = ({ kind, ownerId, file }) => `/chats/${kind}/${enc(ownerId)}/${enc(file)}`;
export const chatRoute = chatUrl;

export const avatarUrl = {
  character: (c) => `/api/characters/${enc(c.id)}/avatar?v=${c.mtime || 0}`,
  persona: (p) => (p.hasAvatar ? `/api/personas/${enc(p.id)}/avatar?v=${p.mtime || 0}` : null),
};

async function upload(url, headers, body, label) {
  const res = await apiFetch(url, { method: 'POST', headers, body });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = new Error(`${label}: ${data?.error || res.status}`);
    err.code = data?.code;
    throw err;
  }
  return data;
}

export const api = {
  me: () => req('GET', '/auth/me'),
  login: (username, password) => req('POST', '/auth/login', { username, password }),
  logout: () => req('POST', '/auth/logout'),
  updateAccount: (body) => req('POST', '/auth/account', body),
  revokeSessions: () => req('POST', '/auth/revoke'),
  setAuthEnabled: (enabled, current) => req('POST', '/auth/enabled', { enabled, current }),

  settings: () => req('GET', '/settings'),
  saveSettings: (patch) => req('PUT', '/settings', patch),

  createConnection: (body) => req('POST', '/connections', body),
  updateConnection: (id, body) => req('PUT', `/connections/${enc(id)}`, body),
  deleteConnection: (id) => req('DELETE', `/connections/${enc(id)}`),
  activateConnection: (id) => req('POST', `/connections/${enc(id)}/activate`),
  toggleFavorite: (id, model) => req('POST', `/connections/${enc(id)}/favorites`, { model }),
  connectionModels: (id) => req('GET', `/connections/${enc(id)}/models`),
  testConnection: (body) => req('POST', '/connections/test', body),

  presets: () => req('GET', '/presets'),
  appearance: () => req('GET', '/appearance'),
  saveAppearance: (body) => req('PUT', '/appearance', body),
  uploadWallpaper: async (blob) => upload('/api/appearance/wallpaper', { 'Content-Type': 'application/octet-stream' }, await blob.arrayBuffer(), 'Fondo'),
  deleteWallpaper: () => req('DELETE', '/appearance/wallpaper'),
  preset: (name) => req('GET', `/presets/${enc(name)}`),
  createPreset: (name, preset) => req('POST', '/presets', { name, preset }),
  importPreset: (name, preset) => req('POST', '/presets/import', { name, preset }),
  savePreset: (name, preset) => req('PUT', `/presets/${enc(name)}`, preset),
  renamePreset: (name, newName) => req('POST', `/presets/${enc(name)}/rename`, { newName }),
  deletePreset: (name) => req('DELETE', `/presets/${enc(name)}`),
  inspectPrompt: (ref, body) => req('POST', `${chatUrl(ref)}/prompt`, body),

  characters: () => req('GET', '/characters'),
  character: (id) => req('GET', `/characters/${enc(id)}`),
  createCharacter: (data, image) => req('POST', '/characters', { data, image }),
  updateCharacter: (id, data, image) => req('PUT', `/characters/${enc(id)}`, { data, image }),
  deleteCharacter: (id) => req('DELETE', `/characters/${enc(id)}`),
  async importCharacter(file) {
    if (/\.png$/i.test(file.name) || file.type === 'image/png') {
      return upload('/api/characters/import', { 'Content-Type': 'image/png' }, await file.arrayBuffer(), file.name);
    }
    let json;
    try {
      json = JSON.parse(await file.text());
    } catch {
      throw new Error(`${file.name}: no es un JSON válido`);
    }
    return upload('/api/characters/import', { 'Content-Type': 'application/json' }, JSON.stringify(json), file.name);
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
  async importChat(kind, ownerId, file) {
    return upload(
      `/api/chats/import?kind=${kind}&ownerId=${enc(ownerId)}`,
      { 'Content-Type': 'application/octet-stream', 'X-Filename': enc(file.name) },
      await file.arrayBuffer(),
      file.name,
    );
  },
  chat: (ref) => req('GET', chatUrl(ref)),
  patchChat: (ref, body) => req('PATCH', chatUrl(ref), body),
  deleteChat: (ref) => req('DELETE', chatUrl(ref)),
  addMessage: (ref, mes) => req('POST', `${chatUrl(ref)}/messages`, { mes }),
  editMessage: (ref, i, mes) => req('PATCH', `${chatUrl(ref)}/messages/${i}`, { mes }),
  deleteMessage: (ref, i) => req('DELETE', `${chatUrl(ref)}/messages/${i}`),
  setSwipe: (ref, i, swipe_id) => req('POST', `${chatUrl(ref)}/messages/${i}/swipe`, { swipe_id }),
  deleteSwipe: (ref, i) => req('DELETE', `${chatUrl(ref)}/messages/${i}/swipe`),
  copyChat: (ref, title) => req('POST', `${chatUrl(ref)}/copy`, { title }),
  pinChat: (ref, pinned) => req('POST', `${chatUrl(ref)}/pin`, { pinned }),
  branchChat: (ref, index, title) => req('POST', `${chatUrl(ref)}/branch`, { index, title }),
  chatToGroup: (ref, body) => req('POST', `${chatUrl(ref)}/to-group`, body),
};

/** Genera una respuesta por streaming (SSE sobre fetch). Resuelve con { index, message }. */
export async function generate(ref, body, signal, onDelta) {
  const res = await apiFetch(`/api${chatUrl(ref)}/generate`, {
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
