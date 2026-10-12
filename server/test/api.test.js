import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chatpuccino-'));
process.env.DATA_DIR = tmp;

const requests = [];
let lastAuth;
const fake = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    lastAuth = req.headers.authorization;
    if (req.url === '/models') {
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify({ data: [{ id: 'a/free', name: 'Free One', context_length: 8000, pricing: { prompt: '0', completion: '0' } }] }));
    }
    if (req.url === '/auth/key') {
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify({ data: { label: 'test-key', usage: 1 } }));
    }
    requests.push(JSON.parse(body));
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write(': OPENROUTER PROCESSING\n\n');
    for (const t of ['Hola', ' mundo', '!']) res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: t } }] })}\n\n`);
    res.end('data: [DONE]\n\n');
  });
});
await new Promise((r) => fake.listen(0, r));
process.env.OPENROUTER_BASE = `http://127.0.0.1:${fake.address().port}`;

const { createApp } = await import('../index.js');
const { resetThrottle } = await import('../auth.js');
const { embedCard, extractCardText, placeholderPng, isPng } = await import('../png.js');
const { activateEntries, normalizeBook } = await import('../lore.js');

const app = createApp().listen(0);
await new Promise((r) => app.once('listening', r));
const base = `http://127.0.0.1:${app.address().port}/api`;

let cookie = '';
const takeCookie = (res) => {
  const set = res.headers.getSetCookie?.().find((c) => c.startsWith('chatpuccino_session='));
  if (set) cookie = set.split(';')[0];
};

const call = async (method, url, body, headers = {}) => {
  const res = await fetch(base + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  takeCookie(res);
  const text = await res.text();
  return { status: res.status, headers: res.headers, json: text && res.headers.get('content-type')?.includes('json') ? JSON.parse(text) : text };
};

const sse = async (url, body) => {
  const res = await fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify(body) });
  const events = (await res.text()).split('\n\n').filter((l) => l.startsWith('data:')).map((l) => JSON.parse(l.slice(5)));
  return { status: res.status, events };
};

test.after(() => {
  app.close();
  fake.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('auth: protege la API, admin/Admin por defecto, cambio de contraseña y bloqueo', async () => {
  assert.equal((await call('GET', '/characters')).status, 401);
  const me = await call('GET', '/auth/me');
  assert.equal(me.json.authenticated, false);
  assert.equal(me.json.defaultPassword, false);

  assert.equal((await call('POST', '/auth/login', { username: 'admin', password: 'wrong' })).status, 401);
  const ok = await call('POST', '/auth/login', { username: 'ADMIN', password: 'Admin' });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.defaultPassword, true);
  assert.equal((await call('GET', '/characters')).status, 200);

  const oldCookie = cookie;
  assert.equal((await call('POST', '/auth/account', { current: 'nope', password: 'Secreto1' })).status, 403);
  assert.equal((await call('POST', '/auth/account', { current: 'Admin', password: 'Admin' })).status, 400);
  assert.equal((await call('POST', '/auth/account', { current: 'Admin', password: 'abc' })).status, 400);
  const changed = await call('POST', '/auth/account', { current: 'Admin', username: 'jefe', password: 'Secreto1' });
  assert.equal(changed.json.username, 'jefe');
  assert.equal(changed.json.defaultPassword, false);
  assert.equal((await call('GET', '/characters')).status, 200);

  // la sesión anterior deja de ser válida
  const fresh = cookie;
  cookie = oldCookie;
  assert.equal((await call('GET', '/characters')).status, 401);
  cookie = '';
  assert.equal((await call('POST', '/auth/login', { username: 'admin', password: 'Admin' })).status, 401);
  assert.equal((await call('POST', '/auth/login', { username: 'jefe', password: 'Secreto1' })).status, 200);
  assert.notEqual(cookie, fresh);

  // tras varios fallos seguidos se bloquea la IP, incluso con credenciales correctas
  cookie = '';
  for (let i = 0; i < 5; i++) await call('POST', '/auth/login', { username: 'jefe', password: 'mal' });
  const locked = await call('POST', '/auth/login', { username: 'jefe', password: 'Secreto1' });
  assert.equal(locked.status, 429);
  assert.ok(Number(locked.headers.get('retry-after')) > 0);
  resetThrottle();
  assert.equal((await call('POST', '/auth/login', { username: 'jefe', password: 'Secreto1' })).status, 200);

  // desactivar requiere la contraseña; con auth apagado la API es abierta
  assert.equal((await call('POST', '/auth/enabled', { enabled: false, current: 'x' })).status, 403);
  await call('POST', '/auth/enabled', { enabled: false, current: 'Secreto1' });
  const saved = cookie;
  cookie = '';
  assert.equal((await call('GET', '/characters')).status, 200);
  cookie = saved;
  await call('POST', '/auth/enabled', { enabled: true, current: 'Secreto1' });
  cookie = '';
  assert.equal((await call('GET', '/characters')).status, 401);
  await call('POST', '/auth/login', { username: 'jefe', password: 'Secreto1' });
  assert.equal((await call('POST', '/auth/logout')).status, 200);
});

test('PNG: embebe y lee tarjeta (ccv3 y chara)', () => {
  const png = placeholderPng('x', 8, 8);
  assert.ok(isPng(png));
  const out = embedCard(png, { name: 'A' }, { spec: 'chara_card_v3', data: { name: 'Ñandú' } });
  assert.equal(JSON.parse(Buffer.from(extractCardText(out), 'base64').toString('utf8')).data.name, 'Ñandú');
  const again = embedCard(out, { name: 'B' }, { data: { name: 'B' } });
  assert.equal(JSON.parse(Buffer.from(extractCardText(again), 'base64').toString('utf8')).data.name, 'B');
});

test('lorebooks: formato ST y character_book, claves, lógica secundaria y recursión', () => {
  const book = normalizeBook({
    entries: {
      0: { uid: 0, key: ['dragón'], content: 'Los dragones escupen fuego.', order: 10 },
      1: { uid: 1, key: ['castillo'], keysecondary: ['rey'], selectiveLogic: 0, selective: true, content: 'El rey vive en el castillo.' },
      2: { uid: 2, key: ['/^fuego$/i'], content: 'regex nunca coincide', disable: false },
      3: { uid: 3, key: [], constant: true, content: 'Siempre activa' },
      4: { uid: 4, key: ['escupen'], content: 'Recursiva', order: 5 },
    },
  });
  const act = (msgs) => activateEntries(Object.values(book.entries), msgs, { scanDepth: 4, budgetTokens: 1000 }).map((e) => e.uid).sort();
  assert.deepEqual(act(['vi un Dragón']), [0, 3, 4]);
  assert.deepEqual(act(['el castillo']), [3]);
  assert.deepEqual(act(['el castillo del rey']), [1, 3]);
  const v2 = normalizeBook({ entries: [{ keys: ['x'], content: 'c', enabled: false, insertion_order: 7, position: 'after_char' }] });
  assert.equal(v2.entries[0].disable, true);
  assert.equal(v2.entries[0].order, 7);
  assert.equal(v2.entries[0].position, 1);
});

test('ajustes antiguos (apiKey/model) migran a una conexión de OpenRouter', async () => {
  await call('POST', '/auth/login', { username: 'jefe', password: 'Secreto1' });
  const file = path.join(tmp, 'settings.json');
  fs.writeFileSync(file, JSON.stringify({ apiKey: 'sk-or-legacy-123456', model: 'old/model', temperature: 0.5, max_tokens: 123, systemPrompt: 'Habla como pirata' }));
  for (const f of fs.readdirSync(path.join(tmp, 'presets'))) fs.rmSync(path.join(tmp, 'presets', f));
  const s = (await call('GET', '/settings')).json;
  assert.equal(s.ready, true);
  assert.equal(s.model, 'old/model');
  assert.equal(s.temperature, undefined);
  assert.equal(s.connections[0].id, 'openrouter');
  assert.equal(s.connections[0].keyPreview, 'sk-or-l…3456');
  // los ajustes de generación antiguos pasan a un preset "Default"
  assert.deepEqual((await call('GET', '/presets')).json.presets, ['Default']);
  const migrated = (await call('GET', '/presets/Default')).json;
  assert.equal(migrated.temperature, 0.5);
  assert.equal(migrated.openai_max_tokens, 123);
  assert.equal(migrated.prompts.find((p) => p.identifier === 'main').content, 'Habla como pirata');
  await call('PUT', '/settings', { scanDepth: 6 });
  const stored = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(stored.apiKey, undefined);
  assert.equal(stored.temperature, undefined);
  assert.equal(stored.connections[0].apiKey, 'sk-or-legacy-123456');
  fs.rmSync(file);
});

test('flujo completo: conexión, personaje, persona, chat, streaming, swipe, edición', async () => {
  assert.equal((await call('GET', '/settings')).json.ready, false);
  const test1 = await call('POST', '/connections/test', { id: 'openrouter', apiKey: 'sk-or-v1-abcdefghij' });
  assert.match(test1.json.message, /test-key/);
  assert.equal((await call('POST', '/connections/test', { id: 'openrouter' })).status, 400);
  await call('PUT', '/connections/openrouter', { apiKey: 'sk-or-v1-abcdefghij', model: 'a/free' });
  assert.equal((await call('GET', '/connections/openrouter/models')).json[0].id, 'a/free');
  const s = await call('GET', '/settings');
  assert.equal(s.json.ready, true);
  assert.equal(s.json.model, 'a/free');
  assert.equal(JSON.stringify(s.json).includes('abcdefghij'), false);
  const img = `data:image/png;base64,${placeholderPng('t', 16, 16).toString('base64')}`;
  const created = await call('POST', '/characters', { data: { name: 'Luna', description: '{{char}} es una maga.', first_mes: 'Hola {{user}}', alternate_greetings: ['Buenas'], extensions: { world: 'Mundo' } }, image: img });
  assert.equal(created.status, 201);
  assert.equal(created.json.id, 'Luna');

  const imported = await fetch(`${base}/characters/import`, { method: 'POST', headers: { 'Content-Type': 'image/png', Cookie: cookie }, body: fs.readFileSync(path.join(tmp, 'characters', 'Luna.png')) });
  assert.equal(imported.status, 201);
  assert.equal((await imported.json()).id, 'Luna (2)');

  const persona = await call('POST', '/personas', { name: 'Armando', description: 'Aventurero' });
  await call('PUT', '/settings', { defaultPersona: persona.json.id });

  await call('POST', '/lorebooks', { name: 'Mundo', book: { entries: { 0: { uid: 0, key: ['espada'], content: 'La espada Aurora brilla.' } } } });

  const chat = await call('POST', '/chats', { kind: 'c', ownerId: 'Luna' });
  const { file } = chat.json;
  const ref = `/chats/c/Luna/${encodeURIComponent(file)}`;
  const first = await call('GET', ref);
  assert.equal(first.json.messages[0].mes, 'Hola Armando');
  assert.equal(first.json.messages[0].swipes.length, 2);

  await call('POST', `${ref}/messages`, { mes: 'Saco mi espada' });
  const gen = await sse(`${ref}/generate`, {});
  assert.equal(gen.events.filter((e) => e.delta).map((e) => e.delta).join(''), 'Hola mundo!');
  const done = gen.events.at(-1);
  assert.equal(done.done, true);
  assert.equal(done.message.mes, 'Hola mundo!');

  const sent = requests.at(-1);
  assert.equal(sent.model, 'a/free');
  assert.match(sent.messages[0].content, /Luna es una maga/);
  assert.match(sent.messages[0].content, /La espada Aurora/);
  assert.equal(sent.messages.at(-1).content, 'Saco mi espada');

  const sw = await sse(`${ref}/generate`, { swipe: true });
  assert.equal(sw.events.at(-1).message.swipes.length, 2);
  assert.equal(requests.at(-1).messages.at(-1).content, 'Saco mi espada');

  const edited = await call('PATCH', `${ref}/messages/2`, { mes: 'Editado' });
  assert.equal(edited.json.swipes[1], 'Editado');
  await call('POST', `${ref}/messages/2/swipe`, { swipe_id: 0 });
  assert.equal((await call('GET', ref)).json.messages[2].mes, 'Hola mundo!');

  const lines = fs.readFileSync(path.join(tmp, 'chats', 'Luna', `${file}.jsonl`), 'utf8').trim().split('\n');
  assert.equal(lines.length, 4);
  assert.ok(JSON.parse(lines[0]).chat_metadata);

  const list = await call('GET', '/chats');
  assert.equal(list.json.length, 1);

  const second = await call('POST', '/chats', { kind: 'c', ownerId: 'Luna' });
  assert.notEqual(second.json.file, file);
  assert.equal((await call('GET', `/chats/c/Luna/${encodeURIComponent(second.json.file)}`)).json.messages.length, 1);

  assert.equal((await call('GET', '/chats/c/..%2F..%2Fx/y')).status >= 400, true);
});

test('grupos: turno por personaje con prefijos de nombre', async () => {
  await call('POST', '/characters', { data: { name: 'Kai', description: 'Un guerrero', first_mes: 'Yo soy Kai' } });
  const g = await call('POST', '/groups', { name: 'Equipo', members: ['Luna', 'Kai'] });
  assert.equal(g.status, 201);
  const chat = await call('POST', '/chats', { kind: 'g', ownerId: g.json.id });
  const ref = `/chats/g/${g.json.id}/${encodeURIComponent(chat.json.file)}`;
  await call('POST', `${ref}/messages`, { mes: 'Hola a todos' });
  const gen = await sse(`${ref}/generate`, { speakerId: 'Kai' });
  assert.equal(gen.events.at(-1).message.name, 'Kai');
  const prompt = requests.at(-1).messages;
  assert.match(prompt[0].content, /Group members: Luna, Kai/);
  assert.ok(prompt.some((m) => m.role === 'user' && /Armando: Hola a todos/.test(m.content)));
  assert.equal(prompt.at(-1).content, '[Write the next reply only as Kai.]');
  assert.equal((await sse(`${ref}/generate`, { speakerId: 'nadie' })).status, 400);
});

test('conexiones locales, favoritos y cambio de conexión activa', async () => {
  const url = process.env.OPENROUTER_BASE;
  assert.equal((await call('POST', '/connections', { type: 'local', baseUrl: '' })).status, 400);
  const created = await call('POST', '/connections', { type: 'local', name: 'Mi LLM', baseUrl: `${url}/`, model: 'a/free' });
  assert.equal(created.status, 201);
  assert.equal(created.json.baseUrl, url);
  const id = created.json.id;

  assert.match((await call('POST', '/connections/test', { type: 'local', baseUrl: url })).json.message, /1 modelo/);
  assert.equal((await call('POST', '/connections/test', { type: 'local', baseUrl: 'http://127.0.0.1:1' })).status, 502);
  assert.equal((await call('GET', `/connections/${id}/models`)).json[0].id, 'a/free');

  assert.deepEqual((await call('POST', `/connections/${id}/favorites`, { model: 'a/free' })).json.favorites, ['a/free']);
  assert.equal((await call('GET', '/settings')).json.connections.find((c) => c.id === id).favorites[0], 'a/free');
  assert.deepEqual((await call('POST', `/connections/${id}/favorites`, { model: 'a/free' })).json.favorites, []);

  await call('POST', `/connections/${id}/activate`);
  assert.equal((await call('GET', '/settings')).json.activeConnection, id);
  const chat = await call('POST', '/chats', { kind: 'c', ownerId: 'Luna' });
  const ref = `/chats/c/Luna/${encodeURIComponent(chat.json.file)}`;
  await call('POST', `${ref}/messages`, { mes: 'Hola desde local' });
  const gen = await sse(`${ref}/generate`, {});
  assert.equal(gen.events.at(-1).done, true);
  assert.equal(lastAuth, undefined);
  assert.equal(requests.at(-1).model, 'a/free');

  await call('POST', '/connections/openrouter/activate');
  await call('DELETE', `/connections/${id}`);
  const s = (await call('GET', '/settings')).json;
  assert.equal(s.connections.length, 1);
  assert.equal(s.activeConnection, 'openrouter');
  assert.equal((await call('DELETE', '/connections/nope')).status, 404);
});

test('importar chats .jsonl de SillyTavern', async () => {
  const raw = (url, body, headers = {}) =>
    fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', Cookie: cookie, ...headers }, body });
  const st = [
    JSON.stringify({ user_name: 'Ana', character_name: 'Luna', create_date: '2024-1-1', chat_metadata: { persona: 'otra/cosa', note: 1 } }),
    JSON.stringify({ name: 'Luna', is_user: false, is_system: false, send_date: 'June 3, 2024 10:22am', mes: 'Hola *Ana*', swipes: ['Hola *Ana*', 'Buenas'], swipe_id: 1 }),
    JSON.stringify({ name: 'Ana', is_user: true, mes: 'Hola Luna' }),
    'linea corrupta',
  ].join('\n');

  const res = await raw('/chats/import?kind=c&ownerId=Luna', st, { 'X-Filename': encodeURIComponent('Luna - 2024 viejo.jsonl') });
  assert.equal(res.status, 201);
  const { file } = await res.json();
  assert.equal(file, 'Luna - 2024 viejo');
  const imported = (await call('GET', `/chats/c/Luna/${encodeURIComponent(file)}`)).json;
  assert.equal(imported.messages.length, 2);
  assert.equal(imported.messages[0].swipe_id, 1);
  assert.equal(imported.messages[1].swipes[0], 'Hola Luna');
  assert.equal(imported.meta.chat_metadata.persona, undefined);
  assert.equal(imported.meta.chat_metadata.note, 1);
  assert.ok((await call('GET', '/chats')).json.some((c) => c.file === file));

  const again = await raw('/chats/import?kind=c&ownerId=Luna', st, { 'X-Filename': encodeURIComponent('Luna - 2024 viejo.jsonl') });
  assert.equal((await again.json()).file, 'Luna - 2024 viejo (2)');

  // sin cabecera, hacia un grupo
  const noHeader = JSON.stringify({ name: 'Kai', is_user: false, mes: 'Yo' });
  const g = await raw('/chats/import?kind=g&ownerId=Equipo', noHeader, { 'X-Filename': 'g.jsonl' });
  assert.equal(g.status, 201);
  const gj = (await call('GET', `/chats/g/Equipo/g`)).json;
  assert.equal(gj.meta.character_name, 'Equipo');
  assert.equal(gj.messages[0].name, 'Kai');

  assert.equal((await raw('/chats/import?kind=c&ownerId=Luna', 'esto no es un chat')).status, 422);
  assert.equal((await raw('/chats/import?kind=c&ownerId=NoExiste', st)).status, 404);
  assert.equal((await call('POST', '/chats/import?kind=c&ownerId=Luna', { a: 1 })).status, 400);
  assert.equal((await raw('/chats/import?kind=c&ownerId=..', st)).status >= 400, true);
});

test('presets: CRUD, importación estilo SillyTavern, orden y posiciones de prompts', async () => {
  await call('POST', '/auth/login', { username: 'jefe', password: 'Secreto1' });
  assert.equal((await call('POST', '/presets/import', { preset: { foo: 1 } })).status, 422);
  assert.equal((await call('POST', '/presets/import', { preset: [] })).status, 422);

  // preset ST con orden por personaje (100000/100001), prompts propios relativos y uno en el chat
  const st = {
    temp: 1.1,
    genamt: 222,
    max_length: 8000,
    wi_format: '[Lore: {0}]',
    prompts: [
      { identifier: 'main', name: 'Main', role: 'system', content: 'PRINCIPAL para {{char}}' },
      { identifier: 'custom-a', name: 'Estilo', role: 'system', content: 'Escribe en segunda persona.' },
      { identifier: 'custom-b', name: 'Recordatorio', role: 'system', content: 'RECUERDA: {{user}} es humano.', injection_position: 1, injection_depth: 1, injection_order: 5 },
      { identifier: 'custom-off', name: 'Apagado', role: 'system', content: 'NO DEBE APARECER' },
      { identifier: 'worldInfoBefore', name: 'WI', marker: true },
      { identifier: 'chatHistory', name: 'History', marker: true },
      { identifier: 'jailbreak', name: 'PHI', role: 'system', content: 'FINAL' },
    ],
    prompt_order: [
      { character_id: 100000, order: [{ identifier: 'main', enabled: false }] },
      {
        character_id: 100001,
        order: [
          { identifier: 'custom-a', enabled: true },
          { identifier: 'main', enabled: true },
          { identifier: 'worldInfoBefore', enabled: true },
          { identifier: 'custom-off', enabled: false },
          { identifier: 'custom-b', enabled: true },
          { identifier: 'chatHistory', enabled: true },
          { identifier: 'jailbreak', enabled: true },
        ],
      },
    ],
  };
  const imp = await call('POST', '/presets/import', { name: 'Mi/Preset ST', preset: st });
  assert.equal(imp.status, 201);
  const name = imp.json.name;
  assert.equal(name, 'MiPreset ST');
  const got = (await call('GET', `/presets/${encodeURIComponent(name)}`)).json;
  assert.equal(got.temperature, 1.1);
  assert.equal(got.openai_max_tokens, 222);
  assert.equal(got.openai_max_context, 8000);
  assert.deepEqual(got.prompt_order[0].order.map((o) => o.identifier), ['custom-a', 'main', 'worldInfoBefore', 'custom-off', 'custom-b', 'chatHistory', 'jailbreak']);
  assert.equal(got.new_chat_prompt, '[Start a new Chat]');

  // renombrar actualiza el preset activo; uno inexistente no se puede activar
  await call('PUT', '/settings', { activePreset: name });
  const renamed = await call('POST', `/presets/${encodeURIComponent(name)}/rename`, { newName: 'ST renombrado' });
  assert.equal(renamed.json.name, 'ST renombrado');
  assert.equal((await call('GET', '/presets')).json.active, 'ST renombrado');
  assert.equal((await call('PUT', '/settings', { activePreset: 'nope' })).status, 404);

  // el inspector refleja orden, posiciones y prompts apagados
  const chat = await call('POST', '/chats', { kind: 'c', ownerId: 'Luna' });
  const ref = `/chats/c/Luna/${encodeURIComponent(chat.json.file)}`;
  await call('POST', `${ref}/messages`, { mes: 'saco mi espada' });
  const insp = (await call('POST', `${ref}/prompt`, {})).json;
  assert.equal(insp.preset, 'ST renombrado');
  const joined = insp.messages.map((m) => m.content).join('\n---\n');
  assert.ok(!joined.includes('NO DEBE APARECER'));
  assert.ok(joined.indexOf('Escribe en segunda persona.') < joined.indexOf('PRINCIPAL para Luna'));
  assert.match(joined, /\[Lore: La espada Aurora brilla\.\]/);
  const iReminder = insp.messages.findIndex((m) => m.content.startsWith('RECUERDA'));
  assert.equal(iReminder, insp.messages.length - 3, 'profundidad 1: antes del último mensaje del chat; el PHI va después');
  assert.equal(insp.messages[insp.messages.length - 2].content, 'saco mi espada');
  assert.equal(insp.messages.at(-1).content, 'FINAL');

  // exportar mantiene el formato; guardar desde la UI cambia parámetros y orden
  const exported = (await call('GET', '/presets/ST%20renombrado/export')).json;
  assert.equal(exported.prompt_order.length, 2);
  const dup = await call('POST', '/presets', { name: 'ST renombrado', preset: exported });
  assert.equal(dup.json.name, 'ST renombrado (2)');

  const edited = structuredClone(exported);
  edited.temperature = 0.3;
  edited.prompt_order = [{ character_id: 100001, order: edited.prompt_order[1].order.map((o) => (o.identifier === 'custom-a' ? { ...o, enabled: false } : o)) }];
  edited.prompts.push({ identifier: 'nuevo', name: 'Nuevo', role: 'user', content: 'extra' });
  const saved = (await call('PUT', '/presets/ST%20renombrado', edited)).json;
  assert.equal(saved.temperature, 0.3);
  assert.equal(saved.prompt_order[0].order.find((o) => o.identifier === 'nuevo').enabled, false, 'un prompt fuera del orden queda desactivado');
  const insp2 = (await call('POST', `${ref}/prompt`, {})).json;
  assert.ok(!insp2.messages.some((m) => m.content.includes('segunda persona')));

  await call('PUT', '/settings', { activePreset: 'Default' });
  assert.equal((await call('DELETE', '/presets/ST%20renombrado')).status, 204);
  assert.equal((await call('DELETE', '/presets/ST%20renombrado%20(2)')).status, 204);
  assert.equal((await call('DELETE', '/presets/Default')).status, 409);
});

test('presets: los parámetros del preset activo llegan al modelo', async () => {
  await call('POST', '/auth/login', { username: 'jefe', password: 'Secreto1' });
  const def = (await call('GET', '/presets/Default')).json;
  def.temperature = 0.42;
  def.top_k = 33;
  def.openai_max_tokens = 77;
  def.prompts.find((p) => p.identifier === 'jailbreak').content = 'Instrucción final del preset';
  await call('PUT', '/presets/Default', def);
  await call('PUT', '/settings', { activePreset: 'Default' });
  await call('PUT', '/connections/openrouter', { model: 'a/free' });
  await call('POST', '/connections/openrouter/activate');
  const chat = await call('POST', '/chats', { kind: 'c', ownerId: 'Luna' });
  const ref = `/chats/c/Luna/${encodeURIComponent(chat.json.file)}`;
  await call('POST', `${ref}/messages`, { mes: 'hola preset' });
  await sse(`${ref}/generate`, {});
  const body = requests.at(-1);
  assert.equal(body.temperature, 0.42);
  assert.equal(body.top_k, 33);
  assert.equal(body.max_tokens, 77);
  assert.equal(body.messages.at(-1).content, 'Instrucción final del preset');
  assert.equal(body.messages.at(-2).content, 'hola preset');
});
