import { currentLang, t } from './i18n.jsx';

const enc = encodeURIComponent;

// Cualquier 401 (salvo en el login) avisa a la app para volver a la pantalla de acceso.
async function apiFetch(url, init) {
  let res;
  try {
    res = await fetch(url, { ...init, headers: { ...init?.headers, 'X-Lang': currentLang() } });
  } catch {
    throw new Error(t('api.connect_error'));
  }
  if (res.status === 401 && !url.startsWith('/api/auth/login')) window.dispatchEvent(new Event('auth:expired'));
  return res;
}

async function req(method, url, body, signal) {
  const res = await apiFetch(`/api${url}`, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal,
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = new Error(data?.error || t('api.http_error', { status: res.status }));
    err.code = data?.code;
    throw err;
  }
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

  assistant: () => req('GET', '/assistant'),
  saveAssistant: (patch) => req('PUT', '/assistant', patch),
  assistantModels: () => req('GET', '/assistant/models'),
  toggleAssistantFavorite: (model) => req('POST', '/assistant/favorites', { model }),
  testAssistant: (body) => req('POST', '/assistant/test', body),

  presets: () => req('GET', '/presets'),
  appearance: () => req('GET', '/appearance'),
  saveAppearance: (body) => req('PUT', '/appearance', body),
  uploadWallpaper: async (blob) => upload('/api/appearance/wallpaper', { 'Content-Type': 'application/octet-stream' }, await blob.arrayBuffer(), t('api.wallpaper_label')),
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
      throw new Error(t('api.invalid_json', { name: file.name }));
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

  // ---- Modo Novela: estadísticas globales, fondos, sprites de personajes y mundos (ver el contrato en vn-spec) ----
  stats: () => req('GET', '/stats'),
  createStat: (body) => req('POST', '/stats', body),
  updateStat: (id, body) => req('PUT', `/stats/${enc(id)}`, body),
  deleteStat: (id) => req('DELETE', `/stats/${enc(id)}`),

  backgrounds: () => req('GET', '/backgrounds'),
  async uploadBackground(blob, name, description = '') {
    return upload(`/api/backgrounds?name=${enc(name)}&description=${enc(description)}`, { 'Content-Type': 'application/octet-stream', 'X-Filename': enc(name) }, await blob.arrayBuffer(), name);
  },
  updateBackground: (id, body) => req('PUT', `/backgrounds/${enc(id)}`, body),
  deleteBackground: (id) => req('DELETE', `/backgrounds/${enc(id)}`),

  sprites: (charId) => req('GET', `/sprites/${enc(charId)}`),
  saveSprites: (charId, patch) => req('PUT', `/sprites/${enc(charId)}`, patch),
  createOutfit: (charId, name) => req('POST', `/sprites/${enc(charId)}/outfits`, { name }),
  renameOutfit: (charId, outfitId, name) => req('PUT', `/sprites/${enc(charId)}/outfits/${enc(outfitId)}`, { name }),
  deleteOutfit: (charId, outfitId) => req('DELETE', `/sprites/${enc(charId)}/outfits/${enc(outfitId)}`),
  // Sin `label` la expresión se deduce del nombre del archivo, como en SillyTavern (joy.png, joy-2.png…).
  async uploadSprite(charId, outfitId, file, label = '') {
    return upload(
      `/api/sprites/${enc(charId)}/outfits/${enc(outfitId)}/files${label ? `?label=${enc(label)}` : ''}`,
      { 'Content-Type': 'application/octet-stream', 'X-Filename': enc(file.name) },
      await file.arrayBuffer(),
      file.name,
    );
  },
  deleteSprite: (charId, outfitId, file) => req('DELETE', `/sprites/${enc(charId)}/outfits/${enc(outfitId)}/files/${enc(file)}`),

  // ---- Estudio de imágenes (Stable Diffusion) ----
  studio: () => req('GET', '/studio'),
  saveStudio: (patch) => req('PUT', '/studio', patch),
  testStudio: (body) => req('POST', '/studio/test', body),
  studioOptions: () => req('GET', '/studio/options'),
  toggleStudioFavorite: (model) => req('POST', '/studio/favorites', { model }),
  studioProgress: () => req('GET', '/studio/progress'),
  studioInterrupt: () => req('POST', '/studio/interrupt'),
  // Devuelven { images: [{ data (base64 PNG), seed }], prompt, negative }; `signal` cancela también la tarea en Stable Diffusion.
  studioGenerate: (body, signal) => req('POST', '/studio/generate', body, signal),
  studioInpaint: (body, signal) => req('POST', '/studio/inpaint', body, signal),
  studioRemoveBg: (body, signal) => req('POST', '/studio/rembg', body, signal),
  studioCharacter: (id) => req('GET', `/studio/characters/${enc(id)}`),
  saveStudioCharacter: (id, patch) => req('PUT', `/studio/characters/${enc(id)}`, patch),

  worlds: () => req('GET', '/worlds'),
  createWorld: (body) => req('POST', '/worlds', body),
  world: (id) => req('GET', `/worlds/${enc(id)}`),
  updateWorld: (id, body) => req('PUT', `/worlds/${enc(id)}`, body),
  deleteWorld: (id) => req('DELETE', `/worlds/${enc(id)}`),
  addWorldMessage: (id, mes) => req('POST', `/worlds/${enc(id)}/messages`, { mes }),
  editWorldMessage: (id, i, mes) => req('PATCH', `/worlds/${enc(id)}/messages/${i}`, { mes }),
  deleteWorldMessage: (id, i) => req('DELETE', `/worlds/${enc(id)}/messages/${i}`),
  setWorldSwipe: (id, i, swipe_id) => req('POST', `/worlds/${enc(id)}/messages/${i}/swipe`, { swipe_id }),
  deleteWorldSwipe: (id, i) => req('DELETE', `/worlds/${enc(id)}/messages/${i}/swipe`),
  branchWorld: (id, index, name) => req('POST', `/worlds/${enc(id)}/branch`, { index, name }),
  copyWorld: (id, name) => req('POST', `/worlds/${enc(id)}/copy`, { name }),
  setWorldStat: (id, body) => req('PATCH', `/worlds/${enc(id)}/state`, body),
  // Vuelve a pedir al modelo los cambios de estadísticas de la última escena. Resuelve con { index, message, changes, state }.
  reevaluateWorld: (id, signal) => req('POST', `/worlds/${enc(id)}/reevaluate`, {}, signal),
};

/** Lee un stream SSE de eventos {delta}/{done}/{error}. Resuelve con el evento final `done`. */
async function stream(path, body, signal, onDelta) {
  const res = await apiFetch(`/api${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    const err = new Error(data?.error || t('api.http_error', { status: res.status }));
    err.code = data?.code;
    throw err;
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
    else if (evt.error) {
      const err = new Error(evt.error);
      err.code = evt.code;
      err.reason = evt.reason;
      err.details = evt.details;
      if (evt.code === 'EMPTY_RESPONSE') console.warn(`[IA] Respuesta vacía (${evt.reason}):`, evt.details);
      throw err;
    }
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

/** Genera la respuesta de un personaje. Resuelve con { index, message }. */
export const generate = (ref, body, signal, onDelta) => stream(`${chatUrl(ref)}/generate`, body, signal, onDelta);

/** Pide al modelo un mensaje escrito como el usuario. Resuelve con { text }; no guarda nada en el chat. */
export const impersonate = (ref, body, signal, onDelta) => stream(`${chatUrl(ref)}/impersonate`, body, signal, onDelta);

/** Modo Novela: genera la siguiente escena. Resuelve con el evento `done` ({ index, message, changes, state }). */
export const worldGenerate = (id, body, signal, onDelta) => stream(`/worlds/${enc(id)}/generate`, body, signal, onDelta);

/** Modo Novela: el modelo escribe la respuesta del usuario. Resuelve con { text }. */
export const worldImpersonate = (id, body, signal, onDelta) => stream(`/worlds/${enc(id)}/impersonate`, body, signal, onDelta);

/** Asistente de personajes: genera o mejora el texto de un campo. Resuelve con { text }. */
export const assistantGenerate = (body, signal, onDelta) => stream('/assistant/generate', body, signal, onDelta);

/** Asistente de personajes: describe la apariencia física de una imagen (data URL). Resuelve con { text }. */
export const assistantDescribeImage = (body, signal, onDelta) => stream('/assistant/describe-image', body, signal, onDelta);
