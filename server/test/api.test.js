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
  assert.equal(list.json[0].personaId, persona.json.id, 'el resumen indica la persona del chat');

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

test('mensajes: eliminar una variante, ramificar y convertir en grupo', async () => {
  await call('POST', '/auth/login', { username: 'jefe', password: 'Secreto1' });
  const chat = await call('POST', '/chats', { kind: 'c', ownerId: 'Luna' });
  const ref = `/chats/c/Luna/${encodeURIComponent(chat.json.file)}`;
  await call('POST', `${ref}/messages`, { mes: 'uno' });
  await call('POST', `${ref}/messages`, { mes: 'dos' });

  // el saludo tiene 2 variantes (principal + alternativa): se puede quitar una pero no la última
  const before = (await call('GET', ref)).json.messages[0];
  assert.equal(before.swipes.length, 2);
  const removed = await call('DELETE', `${ref}/messages/0/swipe`);
  assert.equal(removed.json.swipes.length, 1);
  assert.equal(removed.json.mes, before.swipes[1]);
  assert.equal(removed.json.swipe_id, 0);
  assert.equal((await call('DELETE', `${ref}/messages/0/swipe`)).status, 409);
  assert.equal((await call('DELETE', `${ref}/messages/9/swipe`)).status, 404);

  // quitar una variante concreta con ?id= y mantener la selección coherente
  await call('PATCH', `${ref}/messages/1`, { mes: 'uno' });
  const m = (await call('GET', ref)).json.messages[1];
  assert.equal(m.swipes.length, 1);

  // ramificar hasta el mensaje 1 (inclusive)
  const branch = await call('POST', `${ref}/branch`, { index: 1 });
  assert.equal(branch.status, 201);
  const b = (await call('GET', `/chats/c/Luna/${encodeURIComponent(branch.json.file)}`)).json;
  assert.equal(b.messages.length, 2);
  assert.equal(b.messages[1].mes, 'uno');
  assert.equal(b.meta.chat_metadata.main_chat, chat.json.file);
  assert.match(b.title, /\(rama\)$/);
  assert.equal((await call('GET', ref)).json.messages.length, 3, 'el original no cambia');
  const named = await call('POST', `${ref}/branch`, { index: 0, title: 'Otra historia' });
  assert.equal((await call('GET', `/chats/c/Luna/${encodeURIComponent(named.json.file)}`)).json.title, 'Otra historia');
  assert.equal((await call('POST', `${ref}/branch`, { index: 99 })).status, 400);

  // copiar: duplicado completo e independiente (sin enlace al original)
  const cp = await call('POST', `${ref}/copy`, {});
  assert.equal(cp.status, 201);
  assert.notEqual(cp.json.file, chat.json.file);
  const copied = (await call('GET', `/chats/c/Luna/${encodeURIComponent(cp.json.file)}`)).json;
  assert.equal(copied.messages.length, 3);
  assert.equal(copied.meta.chat_metadata.main_chat, undefined);
  assert.match(copied.title, /\(copia\)$/);
  const cp2 = await call('POST', `/chats/c/Luna/${encodeURIComponent(cp.json.file)}/copy`, { title: 'Mi copia' });
  assert.equal((await call('GET', `/chats/c/Luna/${encodeURIComponent(cp2.json.file)}`)).json.title, 'Mi copia');
  assert.equal((await call('POST', '/chats/c/Luna/noexiste/copy', {})).status, 404);
  assert.equal((await call('GET', ref)).json.messages.length, 3, 'copiar no modifica el original');

  // convertir en grupo: valida miembros y mueve el chat (o lo copia con keepOriginal)
  assert.equal((await call('POST', `${ref}/to-group`, { name: 'Solo', members: [] })).status, 400);
  assert.equal((await call('POST', `${ref}/to-group`, { name: 'X', members: ['Nadie'] })).status, 404);
  assert.equal((await call('POST', '/chats/g/Equipo/x/to-group', { name: 'Y', members: ['Luna'] })).status, 400);
  const keep = await call('POST', `/chats/c/Luna/${encodeURIComponent(named.json.file)}/to-group`, { name: 'Copia', members: ['Kai'], keepOriginal: true });
  assert.equal(keep.status, 201);
  assert.equal((await call('GET', `/chats/c/Luna/${encodeURIComponent(named.json.file)}`)).status, 200, 'se conserva el original');

  const conv = await call('POST', `${ref}/to-group`, { name: 'Dúo', members: ['Kai', 'Luna', 'Kai'], replyMode: 'all' });
  assert.equal(conv.status, 201);
  assert.equal(conv.json.kind, 'g');
  const grp = (await call('GET', `/groups/${encodeURIComponent(conv.json.ownerId)}`)).json;
  assert.deepEqual(grp.members, ['Luna', 'Kai']);
  assert.equal(grp.replyMode, 'all');
  const moved = (await call('GET', `/chats/g/${encodeURIComponent(conv.json.ownerId)}/${encodeURIComponent(conv.json.file)}`)).json;
  assert.equal(moved.messages.length, 3);
  assert.equal(moved.meta.character_name, 'Dúo');
  assert.equal(moved.messages[0].original_avatar, 'Luna.png');
  assert.equal((await call('GET', ref)).status, 404, 'el chat individual se movió al grupo');
});

test('apariencia: valores por defecto, saneado y fondo de pantalla', async () => {
  await call('POST', '/auth/login', { username: 'jefe', password: 'Secreto1' });
  const def = (await call('GET', '/appearance')).json;
  assert.equal(def.mode, 'dark');
  assert.equal(def.uiSize, 15);
  assert.equal(def.hasWallpaper, false);
  assert.equal(def.colors.dark.accent, null);

  const saved = (await call('PUT', '/appearance', {
    mode: 'system',
    colors: { light: { accent: '#AA00FF', mine: 'rojo', theirs: '#12', chat: '#ffffff' } },
    uiFont: 'comic-sans',
    msgFont: 'custom',
    msgFontCustom: 'Fira Code; } body { display:none',
    uiSize: 99,
    msgSize: 'x',
    bubbles: { mineOpacity: 40, theirsOpacity: -5, blur: 300, radius: 10 },
    wallpaper: { blur: 5, dim: 200 },
  })).json;
  assert.equal(saved.mode, 'system');
  assert.equal(saved.colors.light.accent, '#aa00ff');
  assert.equal(saved.colors.light.mine, null);
  assert.equal(saved.colors.light.theirs, null);
  assert.equal(saved.colors.light.chat, '#ffffff');
  assert.equal(saved.uiFont, 'system');
  assert.equal(saved.msgFont, 'custom');
  assert.ok(!/[;{}]/.test(saved.msgFontCustom));
  assert.equal(saved.uiSize, 22);
  assert.equal(saved.msgSize, 15);
  assert.deepEqual(saved.bubbles, { mineOpacity: 40, theirsOpacity: 0, blur: 24, radius: 10 });
  assert.deepEqual(saved.wallpaper, { blur: 5, dim: 90 });
  assert.equal((await call('GET', '/appearance')).json.colors.light.accent, '#aa00ff', 'persiste');

  // fondo de pantalla: solo imágenes; se sirve con sesión
  const put = (body) => fetch(`${base}/appearance/wallpaper`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', Cookie: cookie }, body });
  assert.equal((await put(Buffer.from('no soy una imagen'))).status, 415);
  const ok = await put(placeholderPng('f', 16, 16));
  assert.equal(ok.status, 201);
  const info = await ok.json();
  assert.equal(info.hasWallpaper, true);
  assert.ok(info.wallpaperVersion > 0);
  const img = await fetch(`${base}/appearance/wallpaper`, { headers: { Cookie: cookie } });
  assert.equal(img.status, 200);
  assert.match(img.headers.get('content-type'), /image\/png/);
  assert.equal((await fetch(`${base}/appearance/wallpaper`)).status, 401);
  assert.equal((await call('DELETE', '/appearance/wallpaper')).json.hasWallpaper, false);
  assert.equal((await fetch(`${base}/appearance/wallpaper`, { headers: { Cookie: cookie } })).status, 404);
});

test('chats fijados: se marcan en la lista, no alteran la fecha y se limpian al borrar o mover', async () => {
  await call('POST', '/auth/login', { username: 'jefe', password: 'Secreto1' });
  const a = (await call('POST', '/chats', { kind: 'c', ownerId: 'Luna' })).json;
  const b = (await call('POST', '/chats', { kind: 'c', ownerId: 'Luna' })).json;
  const ra = `/chats/c/Luna/${encodeURIComponent(a.file)}`;
  const find = async (f) => (await call('GET', '/chats')).json.find((c) => c.kind === 'c' && c.file === f);

  assert.equal((await find(a.file)).pinned, false);
  const mtime = (await find(a.file)).mtime;
  assert.equal((await call('POST', `${ra}/pin`, { pinned: true })).json.pinned, true);
  assert.equal((await find(a.file)).pinned, true);
  assert.equal((await find(b.file)).pinned, false);
  assert.equal((await find(a.file)).mtime, mtime, 'fijar no modifica el archivo');
  assert.ok((await call('GET', '/settings')).json.pinnedChats.length >= 1);

  assert.equal((await call('POST', `${ra}/pin`, { pinned: false })).json.pinned, false);
  assert.equal((await find(a.file)).pinned, false);
  assert.equal((await call('POST', '/chats/c/Luna/noexiste/pin', { pinned: true })).status, 404);
  assert.equal((await call('PUT', '/settings', { pinnedChats: ['x'] })).json.pinnedChats.includes('x'), false, 'solo se gestiona con /pin');

  // al copiar no se hereda el pin; al convertir en grupo el pin pasa al chat nuevo; al borrar se limpia
  await call('POST', `${ra}/pin`, { pinned: true });
  const copy = (await call('POST', `${ra}/copy`, {})).json;
  assert.equal((await find(copy.file)).pinned, false);
  const conv = (await call('POST', `${ra}/to-group`, { name: 'Pines', members: ['Kai'] })).json;
  const moved = (await call('GET', '/chats')).json.find((c) => c.kind === 'g' && c.ownerId === conv.ownerId && c.file === conv.file);
  assert.equal(moved.pinned, true);
  assert.equal(await find(a.file), undefined);
  await call('DELETE', `/chats/g/${encodeURIComponent(conv.ownerId)}/${encodeURIComponent(conv.file)}`);
  const pins = (await call('GET', '/settings')).json.pinnedChats;
  assert.equal(pins.some((k) => k.includes(a.file) || k.includes(conv.file)), false);
});

test('impersonar: genera un mensaje como el usuario sin tocar el chat', async () => {
  await call('POST', '/auth/login', { username: 'jefe', password: 'Secreto1' });
  const chat = (await call('POST', '/chats', { kind: 'c', ownerId: 'Luna' })).json;
  const ref = `/chats/c/Luna/${encodeURIComponent(chat.file)}`;
  await call('POST', `${ref}/messages`, { mes: 'Voy a entrar a la torre' });
  const count = (await call('GET', ref)).json.messages.length;

  const res = await sse(`${ref}/impersonate`, { draft: 'Empujo la puerta' });
  assert.equal(res.status, 200);
  assert.equal(res.events.filter((e) => e.delta).map((e) => e.delta).join(''), 'Hola mundo!');
  assert.deepEqual(res.events.at(-1), { done: true, text: 'Hola mundo!' });

  const sent = requests.at(-1);
  const last = sent.messages.at(-1);
  assert.equal(last.role, 'user');
  assert.match(last.content, /point of view of Armando/);
  assert.match(last.content, /Empujo la puerta/);
  assert.deepEqual(sent.stop, ['\nLuna:']);
  assert.ok(sent.messages.some((m) => m.content.includes('Voy a entrar a la torre')));
  assert.equal((await call('GET', ref)).json.messages.length, count, 'no se guarda nada en el chat');

  // sin borrador no se pide continuar nada
  await sse(`${ref}/impersonate`, {});
  assert.doesNotMatch(requests.at(-1).messages.at(-1).content, /Begin your reply/);

  // en grupos se detiene ante cualquier miembro
  const g = (await call('POST', '/chats', { kind: 'g', ownerId: 'Equipo' })).json;
  await sse(`/chats/g/Equipo/${encodeURIComponent(g.file)}/impersonate`, {});
  assert.deepEqual(requests.at(-1).stop, ['\nLuna:', '\nKai:']);

  assert.equal((await sse('/chats/c/Luna/noexiste/impersonate', {})).status, 404);
});

test('asistente de personajes: configuración en JSONL, generación por campo y lectura de imagen', async () => {
  const def = (await call('GET', '/assistant')).json;
  assert.equal(def.ready, false);
  assert.equal(def.sampling.temperature, 0.8);
  assert.ok(def.prompts.system.includes('roleplay'));
  const early = await call('POST', '/assistant/generate', { field: 'description', mode: 'generate' });
  assert.equal(early.status, 400);
  assert.equal(early.json.code, 'ASSISTANT_NOT_READY');

  const put = await call('PUT', '/assistant', {
    connection: { type: 'openrouter', apiKey: 'sk-or-assistant-1234567890', model: 'asst/model', visionModel: 'asst/vision' },
    prompts: { system: 'SISTEMA PROPIO' },
    sampling: { temperature: 5, top_k: 40, openai_max_tokens: 321 },
  });
  assert.equal(put.status, 200);
  assert.equal(put.json.ready, true);
  assert.equal(put.json.connection.hasKey, true);
  assert.ok(!JSON.stringify(put.json).includes('sk-or-assistant-1234567890'), 'la key no vuelve al navegador');
  assert.equal(put.json.sampling.temperature, 2, 'el muestreo se limita a su rango');

  // Todo se guarda en un .jsonl: una línea por sección
  const lines = fs.readFileSync(path.join(tmp, 'assistant.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(lines.map((l) => l.section), ['connection', 'prompts', 'sampling']);
  assert.equal(lines[0].model, 'asst/model');
  assert.equal(lines[1].system, 'SISTEMA PROPIO');
  assert.equal(lines[2].top_k, 40);

  // Mejorar un campo: usa su propia conexión, prompt de sistema y muestreo
  const gen = await sse('/assistant/generate', {
    field: 'description',
    mode: 'improve',
    text: 'Una maga.',
    instructions: 'más misteriosa',
    context: { name: 'Luna', tags: ['maga'], personality: 'Serena', description: 'NO DEBE REPETIRSE' },
  });
  assert.equal(gen.events.at(-1).done, true);
  assert.equal(gen.events.at(-1).text, 'Hola mundo!');
  const body = requests.at(-1);
  assert.equal(body.model, 'asst/model');
  assert.equal(body.messages[0].content, 'SISTEMA PROPIO');
  const user = body.messages[1].content;
  for (const s of ['Mejora el texto actual', 'Una maga.', 'más misteriosa', 'Luna', 'Serena']) assert.ok(user.includes(s), `incluye «${s}»`);
  assert.ok(!user.includes('NO DEBE REPETIRSE'), 'el campo editado no se repite como contexto');
  assert.equal(body.temperature, 2);
  assert.equal(body.top_k, 40);
  assert.equal(body.max_tokens, 321);
  assert.equal(body.stop, undefined);
  assert.equal(lastAuth, 'Bearer sk-or-assistant-1234567890');

  // Generar desde cero no envía texto actual; mejorar sin texto es un error
  await sse('/assistant/generate', { field: 'first_mes', mode: 'generate', context: { name: 'Kai' } });
  const scratch = requests.at(-1).messages[1].content;
  assert.ok(scratch.includes('desde cero') && !scratch.includes('Texto actual del campo'));
  assert.equal((await call('POST', '/assistant/generate', { field: 'scenario', mode: 'expand', text: '  ' })).status, 400);
  assert.equal((await call('POST', '/assistant/generate', { field: 'nope', mode: 'generate' })).status, 400);

  // Lectura de imagen: modelo de visión y mensaje multimodal
  const tiny = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const img = await sse('/assistant/describe-image', { image: tiny, name: 'Luna' });
  assert.equal(img.events.at(-1).done, true);
  const vb = requests.at(-1);
  assert.equal(vb.model, 'asst/vision');
  const parts = vb.messages[1].content;
  assert.ok(parts[0].text.includes('apariencia física'));
  assert.equal(parts[1].image_url.url, tiny);
  assert.equal((await call('POST', '/assistant/describe-image', { image: 'http://x/y.png' })).status, 400);

  // Favoritos, lista de modelos y prueba de conexión
  assert.deepEqual((await call('POST', '/assistant/favorites', { model: 'a/free' })).json.favorites, ['a/free']);
  assert.deepEqual((await call('POST', '/assistant/favorites', { model: 'a/free' })).json.favorites, []);
  assert.equal((await call('GET', '/assistant/models')).json[0].id, 'a/free');
  assert.ok((await call('POST', '/assistant/test', {})).json.message.includes('test-key'), 'usa la key guardada si no se escribe otra');

  // Es independiente de la conexión del roleplay
  const rp = (await call('GET', '/settings')).json;
  assert.ok(rp.connections.every((c) => c.model !== 'asst/model'));

  // Sin modelo de visión se usa el principal; quitar la key deja de estar listo
  await call('PUT', '/assistant', { connection: { visionModel: '' } });
  await sse('/assistant/describe-image', { image: tiny });
  assert.equal(requests.at(-1).model, 'asst/model');
  assert.equal((await call('PUT', '/assistant', { connection: { apiKey: '__clear__' } })).json.ready, false);

  const anon = await fetch(`${base}/assistant`);
  assert.equal(anon.status, 401);
});

test('asistente: campos de mundos, lorebooks y estadísticas con su contexto', async () => {
  await call('PUT', '/assistant', { connection: { type: 'openrouter', apiKey: 'sk-or-fields-1234567890', model: 'asst/model' } });
  const ask = async (body) => {
    const res = await sse('/assistant/generate', body);
    assert.equal(res.events.at(-1).done, true);
    return requests.at(-1).messages[1].content;
  };

  const world = await ask({ field: 'world_description', mode: 'generate', context: { name: 'La Torre', cast: 'Luna: maga', stats: 'Afecto', lorebooks: 'Torre Norte' } });
  for (const s of ['Luna: maga', 'Afecto', 'Torre Norte', 'La Torre']) assert.ok(world.includes(s), `contexto del mundo: ${s}`);

  const keys = await ask({ field: 'lorebook_entry_keys', mode: 'generate', context: { name: 'Mundo', entry_title: 'Espada Aurora', entry_content: 'Una espada de luz.', entry_keys: 'IGNORADA' } });
  assert.ok(keys.includes('Espada Aurora') && keys.includes('Una espada de luz.'), 'título y contenido de la entrada como contexto');
  assert.ok(keys.includes('IGNORADA'), 'las palabras clave actuales también se envían como contexto cuando no son el campo editado');

  const stat = await ask({ field: 'stat_description', mode: 'improve', text: 'Mide el cariño', context: { name: 'Afecto', scope: 'Por personaje', range: '0 a 100' } });
  for (const s of ['Mide el cariño', 'Por personaje', '0 a 100']) assert.ok(stat.includes(s), `estadística: ${s}`);

  for (const field of ['lorebook_description', 'lorebook_entry', 'lorebook_entry_title']) await ask({ field, mode: 'generate', context: { name: 'Mundo' } });
  await call('PUT', '/assistant', { connection: { apiKey: '__clear__' } });
});

test('importar PNG sin datos de personaje devuelve código NO_CARD (para crearlo desde la imagen)', async () => {
  await call('POST', '/auth/login', { username: 'jefe', password: 'Secreto1' });
  const plain = await fetch(`${base}/characters/import`, { method: 'POST', headers: { 'Content-Type': 'image/png', Cookie: cookie }, body: placeholderPng('x', 8, 8) });
  assert.equal(plain.status, 422);
  assert.equal((await plain.json()).code, 'NO_CARD');
  const bad = await fetch(`${base}/characters/import`, { method: 'POST', headers: { 'Content-Type': 'image/png', Cookie: cookie }, body: Buffer.from('no es png') });
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).code, undefined);
});

test('idioma del servidor: X-Lang cambia los errores y los prompts por defecto del asistente', async () => {
  await call('POST', '/auth/login', { username: 'jefe', password: 'Secreto1' });

  // Errores: español por defecto o con un idioma desconocido, inglés con X-Lang: en
  const anon = async (lang) => {
    const res = await fetch(`${base}/characters`, { headers: lang ? { 'X-Lang': lang } : {} });
    return { status: res.status, error: (await res.json()).error };
  };
  assert.deepEqual(await anon(), { status: 401, error: 'Inicia sesión para continuar' });
  assert.deepEqual(await anon('en'), { status: 401, error: 'Sign in to continue' });
  assert.deepEqual(await anon('xx'), { status: 401, error: 'Inicia sesión para continuar' }, 'idioma desconocido: vuelve al español');
  assert.equal((await call('GET', '/characters/NoExiste')).json.error, 'Personaje no encontrado');
  const en = await call('GET', '/characters/NoExiste', null, { 'X-Lang': 'en' });
  assert.equal(en.status, 404);
  assert.equal(en.json.error, 'Character not found');
  assert.equal((await call('GET', '/characters/NoExiste', null, { 'X-Lang': 'xx' })).json.error, 'Personaje no encontrado');

  // Prompts por defecto del asistente: en el idioma de la petición
  const es = (await call('GET', '/assistant')).json;
  const english = (await call('GET', '/assistant', null, { 'X-Lang': 'en' })).json;
  assert.ok(es.defaults.prompts.system.includes('asistente de escritura'));
  assert.ok(english.defaults.prompts.system.includes('writing assistant'));
  assert.ok(english.defaults.prompts.image.includes('physical appearance'));
  assert.ok((await call('GET', '/assistant', null, { 'X-Lang': 'xx' })).json.defaults.prompts.system.includes('asistente de escritura'));

  // Un prompt personalizado no se toca; el de fábrica de otro idioma se muestra en el idioma actual
  assert.equal(english.prompts.system, 'SISTEMA PROPIO');
  assert.equal(es.prompts.system, 'SISTEMA PROPIO');
  assert.equal(english.prompts.image, english.defaults.prompts.image, 'la imagen estaba guardada con el valor por defecto en español');

  const reset = await call('PUT', '/assistant', { prompts: { system: es.defaults.prompts.system } });
  assert.equal(reset.json.prompts.system, es.defaults.prompts.system);
  assert.equal((await call('GET', '/assistant', null, { 'X-Lang': 'en' })).json.prompts.system, english.defaults.prompts.system);
  assert.equal((await call('GET', '/assistant')).json.prompts.system, es.defaults.prompts.system);

  // Se deja personalizado como lo encontraron los demás tests
  await call('PUT', '/assistant', { prompts: { system: 'SISTEMA PROPIO' } });
  assert.equal((await call('GET', '/assistant', null, { 'X-Lang': 'en' })).json.prompts.system, 'SISTEMA PROPIO');
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
