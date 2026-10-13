import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chatpuccino-worlds-'));
process.env.DATA_DIR = tmp;

// Mientras los fragmentos de locales/_parts no se hayan fusionado en es.json/en.json, el servidor los lee fusionados en memoria.
{
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const realRead = fs.readFileSync;
  const merge = (a, b) => {
    for (const [k, v] of Object.entries(b)) a[k] = v && typeof v === 'object' && a[k] && typeof a[k] === 'object' ? merge(a[k], v) : v;
    return a;
  };
  fs.readFileSync = function patched(file, ...rest) {
    const text = realRead.call(this, file, ...rest);
    const m = /locales[\\/](es|en)\.json$/.exec(String(file));
    const part = m && path.join(root, 'locales', '_parts', `worlds.${m[1]}.json`);
    if (!part || !fs.existsSync(part)) return text;
    return JSON.stringify(merge(JSON.parse(String(text).replace(/^\uFEFF/, '')), JSON.parse(realRead.call(this, part, 'utf8'))));
  };
  process.on('exit', () => {
    fs.readFileSync = realRead;
  });
}

// Modelo falso programable: cada petición consume la siguiente respuesta de la cola (o la de por defecto) y la emite en trozos pequeños.
const requests = [];
const replies = [];
const DEFAULT_REPLY = '[Luna|joy] "Hola!"\n[Narrator] Sonríe.\n<vn>{"stats":[{"character":"Luna","stat":"affection","change":5,"reason":"x"}],"scene":{"background":"Ciudad"}}</vn>';
const fake = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    if (req.url === '/models') {
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify({ data: [{ id: 'a/free', name: 'Free One', context_length: 8000, pricing: { prompt: '0', completion: '0' } }] }));
    }
    if (req.url === '/auth/key') {
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify({ data: { label: 'test-key', usage: 1 } }));
    }
    requests.push(JSON.parse(body));
    const reply = replies.length ? replies.shift() : DEFAULT_REPLY;
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    for (let i = 0; i < reply.length; i += 4) res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: reply.slice(i, i + 4) } }] })}\n\n`);
    res.end('data: [DONE]\n\n');
  });
});
await new Promise((r) => fake.listen(0, r));
process.env.OPENROUTER_BASE = `http://127.0.0.1:${fake.address().port}`;

const { createApp } = await import('../index.js');
const { placeholderPng } = await import('../png.js');
const W = await import('../worlds.js');
const { splitControl, streamVisible } = await import('../../shared/vn.js');

const app = createApp().listen(0);
await new Promise((r) => app.once('listening', r));
const base = `http://127.0.0.1:${app.address().port}/api`;

let cookie = '';
const call = async (method, url, body, headers = {}) => {
  const res = await fetch(base + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const set = res.headers.getSetCookie?.().find((c) => c.startsWith('chatpuccino_session='));
  if (set) cookie = set.split(';')[0];
  const text = await res.text();
  return { status: res.status, json: text && res.headers.get('content-type')?.includes('json') ? JSON.parse(text) : text };
};

const sse = async (url, body, headers = {}) => {
  const res = await fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie, ...headers }, body: JSON.stringify(body) });
  const status = res.status;
  const text = await res.text();
  if (!text.startsWith('data:')) return { status, events: [], json: text ? JSON.parse(text) : null };
  const events = text.split('\n\n').filter((l) => l.startsWith('data:')).map((l) => JSON.parse(l.slice(5)));
  return { status, events, done: events.find((e) => e.done), deltas: events.filter((e) => e.delta).map((e) => e.delta), error: events.find((e) => e.error) };
};

const png = placeholderPng('t', 16, 16);
const upload = (url, headers = {}) =>
  fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', Cookie: cookie, ...headers }, body: png });

const systemOf = (req) => req.messages.find((m) => m.role === 'system').content;
const worldFile = (id, ...rest) => path.join(tmp, 'worlds', id, ...rest);
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const get = async (id) => (await call('GET', `/worlds/${id}`)).json;

test.after(() => {
  app.close();
  fake.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

// ---------- funciones puras ----------

const AFF = { id: 'affection', name: 'Affection', description: 'Afecto', scope: 'character', min: 0, max: 100, default: 50 };
const DANGER = { id: 'danger', name: 'Danger', description: 'Peligro', scope: 'world', min: 0, max: 100, default: 10 };
const LUNA = { id: 'Luna', name: 'Luna Marina', initial: { affection: 80 } };
const KAI = { id: 'Kai', name: 'Kai' };
const pureWorld = { id: 'w', name: 'W', statIds: ['affection', 'danger'], characters: ['Luna', 'Kai'], active: ['Luna'], background: 'bosque', outfits: {}, persona: '' };
const pureCtx = (state) => ({
  cast: [LUNA, KAI],
  stats: [AFF, DANGER],
  state,
  backgrounds: [{ id: 'bosque', name: 'Bosque' }, { id: 'ciudad', name: 'Ciudad' }],
  outfits: { Luna: [{ id: 'default', name: 'Default' }, { id: 'formal', name: 'Gala' }], Kai: [{ id: 'default', name: 'Default' }] },
});

test('estado puro: defaultState, applyControl (resolución, topes, clamp, escena)', () => {
  const s0 = W.defaultState(pureWorld, [LUNA, KAI], [AFF, DANGER]);
  assert.equal(s0.stats.characters.Luna.affection, 80, 'valor inicial del sprite');
  assert.equal(s0.stats.characters.Kai.affection, 50);
  assert.equal(s0.stats.world.danger, 10);
  assert.deepEqual(s0.scene, { background: 'bosque', outfits: {}, active: ['Luna'] });

  const r = W.applyControl(
    {
      stats: [
        { character: 'luna', stat: 'AFFECTION', change: 5, reason: 'ok' },
        { character: 'Kai', stat: 'Affection', change: -90 }, // tope 25
        { character: 'Luna', stat: 'affection', change: 50 }, // 85 + 25 → clamp 100
        { stat: 'Danger', change: '+3' },
        { character: 'Nadie', stat: 'affection', change: 3 },
        { character: 'Luna', stat: 'inexistente', change: 3 },
        { character: 'Luna', stat: 'affection', change: 0 },
        { character: 'Luna', stat: 'affection' },
        'basura',
      ],
      scene: { background: 'CIUDAD', outfits: { Luna: 'Gala', Kai: 'zzz' }, enter: ['kai', 'Fantasma'], exit: ['Luna'] },
    },
    pureCtx(s0),
  );
  assert.deepEqual(
    r.changes.map((c) => [c.character, c.stat, c.from, c.to, c.delta]),
    [['Luna', 'affection', 80, 85, 5], ['Kai', 'affection', 50, 25, -25], ['Luna', 'affection', 85, 100, 15], [null, 'danger', 10, 13, 3]],
  );
  assert.equal(r.changes[0].characterName, 'Luna Marina');
  assert.equal(r.changes[0].scope, 'character');
  assert.equal(r.changes[3].scope, 'world');
  assert.equal(r.changes[0].reason, 'ok');
  assert.deepEqual(r.scene, { background: 'ciudad', outfits: { Luna: 'formal' }, active: ['Kai'] });
  assert.equal(r.state.stats.characters.Luna.affection, 100);
  assert.equal(s0.stats.characters.Luna.affection, 80, 'no muta el estado anterior');

  const none = W.applyControl({ stats: 'x', scene: { background: 'nada', enter: 5 } }, pureCtx(s0));
  assert.deepEqual(none.changes, []);
  assert.deepEqual(none.scene, s0.scene);
  assert.deepEqual(W.applyControl(null, pureCtx(s0)).changes, []);
});

test('estado puro: streamVisible oculta el bloque y splitControl lo separa', () => {
  const text = '[Luna|joy] Hola\n<vn>{"stats":[]}</vn>';
  let acc = '';
  let seen = '';
  for (const ch of text) {
    acc += ch;
    const vis = streamVisible(acc);
    assert.ok(vis.length >= seen.length, 'monótono');
    seen = vis;
  }
  assert.equal(seen, '[Luna|joy] Hola\n');
  const { script, control } = splitControl(text);
  assert.equal(script, '[Luna|joy] Hola');
  assert.deepEqual(control, { stats: [] });
  assert.equal(splitControl('x <vn>{rota').control, null);
});

test('estado puro: currentState/stateBefore con swipes y relleno perezoso', () => {
  const snap = (aff, bg) => ({ changes: [], control: null, state: { stats: { world: { danger: 20 }, characters: { Luna: { affection: aff } } }, scene: { background: bg, outfits: {}, active: ['Luna'] } } });
  const msg = (vns, id) => ({
    is_user: false, mes: 'x', swipes: vns.map(() => 'x'), swipe_id: id,
    swipe_info: vns.map((vn) => ({ extra: { vn } })), extra: { vn: vns[id] },
  });
  const user = { is_user: true, mes: 'hola', extra: {} };
  const messages = [msg([snap(60, 'ciudad')], 0), user, msg([snap(30, 'bosque'), snap(90, 'ciudad')], 1)];
  const opts = { cast: [LUNA, KAI], stats: [AFF, DANGER] };
  const cur = W.currentState(pureWorld, messages, opts);
  assert.equal(cur.stats.characters.Luna.affection, 90);
  assert.equal(cur.stats.characters.Kai.affection, 50, 'relleno con el valor por defecto');
  assert.equal(cur.stats.world.danger, 20);
  assert.equal(cur.scene.background, 'bosque', 'la escena sale de world.json');
  messages[2].swipe_id = 0;
  assert.equal(W.currentState(pureWorld, messages, opts).stats.characters.Luna.affection, 30);
  const before = W.stateBefore(pureWorld, messages, 2, opts);
  assert.equal(before.stats.characters.Luna.affection, 60);
  assert.equal(before.scene.background, 'ciudad');
  const first = W.stateBefore(pureWorld, messages, 0, opts);
  assert.equal(first.stats.characters.Luna.affection, 80);
  // estadísticas y personajes desasociados desaparecen de la vista
  const view = W.currentState(pureWorld, messages, { cast: [KAI], stats: [AFF] });
  assert.deepEqual(view.stats, { world: {}, characters: { Kai: { affection: 50 } } });
  assert.equal(W.currentState(pureWorld, [], opts).stats.characters.Luna.affection, 80);
});

// ---------- preparación ----------

test('preparación: login, conexión, personajes, estadísticas, fondos, sprites', async () => {
  assert.equal((await call('GET', '/worlds')).status, 401);
  assert.equal((await call('POST', '/auth/login', { username: 'admin', password: 'Admin' })).status, 200);
  await call('PUT', '/connections/openrouter', { apiKey: 'sk-or-v1-abcdefghij', model: 'a/free' });
  const img = `data:image/png;base64,${png.toString('base64')}`;
  for (const [name, description, extra] of [
    ['Luna', '{{char}} es una maga.', { personality: 'Amable', mes_example: '<START>\n{{char}}: Hola' }],
    ['Kai', 'Un guerrero', {}],
    ['Mira', 'Una ladrona', {}],
  ]) {
    assert.equal((await call('POST', '/characters', { data: { name, description, first_mes: 'x', ...extra }, image: img })).status, 201);
  }
  const persona = await call('POST', '/personas', { name: 'Armando', description: 'Aventurero valiente' });
  await call('PUT', '/settings', { defaultPersona: persona.json.id });
  await call('POST', '/lorebooks', { name: 'Mundo', book: { entries: { 0: { uid: 0, key: ['espada'], content: 'La espada Aurora brilla.' } } } });

  assert.equal((await call('POST', '/stats', { name: 'Affection', description: 'Afecto hacia el jugador', scope: 'character', min: 0, max: 100, default: 50 })).status, 201);
  assert.equal((await call('POST', '/stats', { name: 'Danger', description: 'Peligro del entorno', scope: 'world', min: 0, max: 100, default: 10 })).status, 201);
  for (const [name, description] of [['Bosque', 'Un bosque oscuro'], ['Ciudad', 'Una ciudad medieval']]) {
    const res = await upload(`/backgrounds?name=${encodeURIComponent(name)}&description=${encodeURIComponent(description)}`);
    assert.equal(res.status, 201);
  }
  await call('GET', '/sprites/Luna');
  assert.equal((await upload('/sprites/Luna/outfits/default/files?label=joy')).status, 200);
  const outfit = await call('POST', '/sprites/Luna/outfits', { name: 'Formal' });
  assert.equal(outfit.json.id, 'formal');
});

let world;
const WID = () => world.id;

test('CRUD de mundos y validación', async () => {
  const bad = (body, status = 400) => call('POST', '/worlds', body).then((r) => assert.equal(r.status, status, JSON.stringify(body)));
  await bad({});
  await bad({ name: 'x'.repeat(81) });
  await bad({ name: 'M', description: 'x'.repeat(8001) });
  await bad({ name: 'M', lorebooks: ['NoExiste'] });
  await bad({ name: 'M', statIds: ['nope'] });
  await bad({ name: 'M', characters: ['Nadie'] });
  await bad({ name: 'M', characters: ['Luna'], active: ['Kai'] });
  await bad({ name: 'M', background: 'nada' });
  await bad({ name: 'M', persona: 'nadie' }, 404);

  const created = await call('POST', '/worlds', {
    name: 'Mi Mundo ñandú', description: 'Un reino con {{user}} y magia.', lorebooks: ['Mundo'], statIds: ['affection', 'danger'],
    characters: ['Luna', 'Kai', 'Mira'], active: ['Luna', 'Kai'], background: 'bosque',
  });
  assert.equal(created.status, 201);
  world = created.json;
  assert.equal(world.id, 'mi-mundo-nandu');
  assert.deepEqual(world.active, ['Luna', 'Kai']);
  assert.equal(world.background, 'bosque');
  assert.equal(world.initialScene, undefined);
  assert.equal((await call('POST', '/worlds', { name: 'Mi Mundo ñandú' })).json.id, 'mi-mundo-nandu-2');
  await call('DELETE', '/worlds/mi-mundo-nandu-2');
  assert.equal((await call('GET', '/worlds/mi-mundo-nandu-2')).status, 404);
  assert.equal((await call('GET', '/worlds/..%2F..%2Fx')).status, 404);
  assert.equal((await call('GET', '/worlds/NoExiste')).status, 404);

  const detail = await get(WID());
  assert.deepEqual(detail.cast.map((c) => c.id), ['Luna', 'Kai', 'Mira']);
  assert.equal(detail.cast[0].avatarUrl.startsWith('/api/characters/Luna/avatar'), true);
  assert.equal(detail.cast[0].fallbackExpression, 'neutral');
  assert.deepEqual(detail.cast[0].outfits.map((o) => o.id).sort(), ['default', 'formal']);
  assert.equal(detail.cast[0].outfits.find((o) => o.id === 'default').expressions.joy.length, 1);
  assert.deepEqual(detail.stats.map((s) => s.id), ['affection', 'danger']);
  assert.deepEqual(detail.backgrounds.map((b) => b.id).sort(), ['bosque', 'ciudad']);
  assert.ok(detail.backgrounds[0].url.startsWith('/api/backgrounds/'));
  assert.equal(detail.persona.name, 'Armando');
  assert.deepEqual(detail.lorebooks, ['Mundo']);
  assert.equal(detail.state.stats.characters.Luna.affection, 50);
  assert.equal(detail.state.stats.world.danger, 10);
  assert.deepEqual(detail.state.scene, { background: 'bosque', outfits: {}, active: ['Luna', 'Kai'] });
  assert.deepEqual(readJson(worldFile(WID(), 'characters', 'Luna.json')), { id: 'Luna', name: 'Luna', stats: { affection: 50 } });

  const list = (await call('GET', '/worlds')).json;
  assert.equal(list.length, 1);
  assert.equal(list[0].messageCount, 0);
  assert.equal(list[0].lastLine, null);
  assert.deepEqual(list[0].background.id, 'bosque');

  // actualización: lorebook inexistente → 400; quitar un personaje lo quita de active/outfits
  assert.equal((await call('PUT', `/worlds/${WID()}`, { lorebooks: ['Nada'] })).status, 400);
  assert.equal((await call('PUT', `/worlds/${WID()}`, { outfits: { Luna: 'zzz' } })).status, 400);
  assert.equal((await call('PUT', `/worlds/${WID()}`, { active: ['Luna', 'Fantasma'] })).status, 400);
  const withOutfit = await call('PUT', `/worlds/${WID()}`, { outfits: { Luna: 'Formal' } });
  assert.deepEqual(withOutfit.json.outfits, { Luna: 'formal' });
  const trimmed = await call('PUT', `/worlds/${WID()}`, { characters: ['Luna', 'Kai'] });
  assert.deepEqual(trimmed.json.characters, ['Luna', 'Kai']);
  await call('PUT', `/worlds/${WID()}`, { characters: ['Luna', 'Kai', 'Mira'], outfits: {}, active: ['Luna', 'Kai'] });
  // lorebooks desconocidos se descartan al leer
  const raw = readJson(worldFile(WID(), 'world.json'));
  raw.lorebooks = ['Mundo', 'Borrado'];
  fs.writeFileSync(worldFile(WID(), 'world.json'), JSON.stringify(raw));
  assert.deepEqual((await get(WID())).world.lorebooks, ['Mundo']);
});

// ---------- generación ----------

test('start: escena inicial con bloque de control retenido, prompt y estado persistidos', async () => {
  requests.length = 0;
  const gen = await sse(`/worlds/${WID()}/generate`, { start: true });
  assert.equal(gen.status, 200);
  assert.equal(gen.error, undefined);
  const shown = gen.deltas.join('');
  assert.equal(shown.includes('<'), false, 'el bloque <vn> nunca se filtra');
  assert.equal(shown.trim(), '[Luna|joy] "Hola!"\n[Narrator] Sonríe.');
  const { done } = gen;
  assert.equal(done.index, 0);
  assert.equal(done.message.mes, '[Luna|joy] "Hola!"\n[Narrator] Sonríe.');
  assert.equal(done.message.name, world.name);
  assert.equal(done.changes.length, 1);
  assert.deepEqual(
    { ...done.changes[0], reason: undefined },
    { scope: 'character', character: 'Luna', characterName: 'Luna', stat: 'affection', statName: 'Affection', from: 50, to: 55, delta: 5, reason: undefined },
  );
  assert.equal(done.state.stats.characters.Luna.affection, 55);
  assert.equal(done.scene.background, 'ciudad');
  assert.equal(done.message.extra.vn.state.scene.background, 'ciudad');
  assert.equal(done.message.swipe_info[0].extra.vn.changes.length, 1);
  assert.equal(done.message.swipe_info[0].extra.model, 'a/free');
  assert.deepEqual(done.message.extra.vn.control.scene, { background: 'Ciudad' });

  const stored = await get(WID());
  assert.equal(stored.world.background, 'ciudad');
  assert.equal(stored.messages.length, 1);
  assert.equal(stored.state.stats.characters.Luna.affection, 55);
  assert.deepEqual(readJson(worldFile(WID(), 'characters', 'Luna.json')).stats, { affection: 55 });
  assert.deepEqual(readJson(worldFile(WID(), 'characters', 'Kai.json')).stats, { affection: 50 });
  const lines = fs.readFileSync(worldFile(WID(), 'story.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(lines[0].character_name, world.name);
  assert.equal(lines[0].user_name, 'Armando');
  assert.equal(lines.length, 2);
  assert.equal(lines[1].mes.includes('<vn>'), false);

  // prompt: premisa, tarjetas en escena, jugador, fuera de escena, estadísticas, expresiones, atuendos, fondos y contrato <vn>
  const req = requests[0];
  assert.equal(req.stop, undefined);
  assert.equal(req.max_tokens > 0, true);
  const sys = systemOf(req);
  assert.match(sys, /narrador y director de juego/);
  assert.match(sys, /Un reino con Armando y magia\./);
  assert.match(sys, /Luna es una maga\./);
  assert.match(sys, /Personalidad: Amable/);
  assert.match(sys, /Un guerrero/);
  assert.equal(sys.includes('Una ladrona'), false, 'solo las tarjetas de los personajes en escena');
  assert.match(sys, /fuera de escena\n[^\n]*Mira/);
  assert.match(sys, /Armando/);
  assert.match(sys, /Aventurero valiente/);
  assert.match(sys, /Affection \(id: affection; una por personaje; rango 0–100\): Afecto hacia el jugador/);
  assert.match(sys, /- Luna: Affection 50/);
  assert.match(sys, /- Kai: Affection 50/);
  assert.match(sys, /- Mundo \(compartidas\): Danger 10/);
  assert.match(sys, /DEBEN influir/);
  assert.match(sys, /- Luna: joy/);
  assert.match(sys, /- Kai: admiration, amusement/);
  assert.match(sys, /Luna: actual «[^»]+»; disponibles: [^\n]*Formal/);
  assert.match(sys, /- bosque: Bosque — Un bosque oscuro/);
  assert.match(sys, /Fondo actual: Bosque/);
  assert.match(sys, /<vn>\{"stats"/);
  assert.equal(sys.includes('La espada Aurora'), false);
  assert.match(req.messages.at(-1).content, /escena inicial/);
  assert.equal(req.messages.at(-1).role, 'user');
  assert.equal(req.messages.filter((m) => m.role === 'system').length, 1);

  // una segunda generación inicial no está permitida
  assert.equal((await sse(`/worlds/${WID()}/generate`, { start: true })).status, 409);
});

test('mensaje del usuario + generate con speakerId, instrucción, lorebook, topes y cambios de escena', async () => {
  requests.length = 0;
  assert.equal((await call('POST', `/worlds/${WID()}/messages`, { mes: '  ' })).status, 400);
  const added = await call('POST', `/worlds/${WID()}/messages`, { mes: 'Saco mi espada' });
  assert.equal(added.status, 201);
  assert.equal(added.json.index, 1);
  assert.equal(added.json.message.name, 'Armando');
  assert.equal(added.json.message.is_user, true);

  replies.push('[Luna|anger] "¡No!"\n<vn>{"stats":[{"character":"Luna","stat":"affection","change":-70,"reason":"cap"},{"stat":"danger","change":20}],"scene":{"background":"bosque","enter":["Mira"],"exit":["Kai"],"outfits":{"Luna":"Formal"}}}</vn>');
  assert.equal((await sse(`/worlds/${WID()}/generate`, { speakerId: 'Mira' })).status, 400);
  const gen = await sse(`/worlds/${WID()}/generate`, { speakerId: 'Luna', instruction: 'Hazlo corto' });
  assert.equal(gen.done.index, 2);
  assert.deepEqual(gen.done.changes.map((c) => [c.stat, c.from, c.to]), [['affection', 55, 30], ['danger', 10, 30]]);
  assert.deepEqual(gen.done.scene, { background: 'bosque', outfits: { Luna: 'formal' }, active: ['Luna', 'Mira'] });
  const w = (await get(WID())).world;
  assert.equal(w.background, 'bosque');
  assert.deepEqual(w.active, ['Luna', 'Mira']);
  assert.deepEqual(w.outfits, { Luna: 'formal' });

  const req = requests[0];
  assert.match(systemOf(req), /La espada Aurora brilla\./);
  const roles = req.messages.map((m) => m.role);
  assert.deepEqual(roles, ['system', 'assistant', 'user', 'user']);
  assert.equal(req.messages[1].content.includes('<vn>'), false);
  assert.match(req.messages.at(-1).content, /Luna es quien habla primero/);
  assert.match(req.messages.at(-1).content, /Hazlo corto/);
  // la nota del director no se guarda
  assert.equal(JSON.stringify((await get(WID())).messages).includes('Hazlo corto'), false);
});

test('swipe: regenera el último mensaje desde el estado anterior', async () => {
  requests.length = 0;
  replies.push('[Luna|joy] "Ok"\n<vn>{"stats":[{"character":"Luna","stat":"affection","change":4}]}</vn>');
  const gen = await sse(`/worlds/${WID()}/generate`, { swipe: true });
  assert.equal(gen.done.index, 2);
  assert.equal(gen.done.message.swipes.length, 2);
  assert.equal(gen.done.message.swipe_id, 1);
  assert.deepEqual(gen.done.changes.map((c) => [c.from, c.to]), [[55, 59]]);
  assert.equal(gen.done.state.stats.world.danger, 10, 'el peligro vuelve al valor anterior al mensaje');
  // el prompt describe el estado anterior (Kai en escena, Luna con 55)
  const sys = systemOf(requests[0]);
  assert.match(sys, /- Luna: Affection 55/);
  assert.match(sys, /Kai/);
  assert.equal(sys.includes('Una ladrona'), false);
  assert.equal(requests[0].messages.some((m) => m.content === '[Luna|anger] "¡No!"'), false, 'el mensaje regenerado no va en el historial');
  // sin escena nueva: la escena vuelve a la del mensaje anterior
  const detail = await get(WID());
  assert.equal(detail.world.background, 'ciudad');
  assert.deepEqual(detail.world.active, ['Luna', 'Kai']);
  assert.equal(detail.state.stats.characters.Luna.affection, 59);
  assert.equal(readJson(worldFile(WID(), 'characters', 'Luna.json')).stats.affection, 59);

  // seleccionar el swipe 0 restaura estadísticas y escena de esa variante
  const sel = await call('POST', `/worlds/${WID()}/messages/2/swipe`, { swipe_id: 0 });
  assert.equal(sel.json.swipe_id, 0);
  assert.equal(sel.json.extra.vn.state.stats.characters.Luna.affection, 30);
  const d0 = await get(WID());
  assert.equal(d0.state.stats.characters.Luna.affection, 30);
  assert.equal(d0.world.background, 'bosque');
  assert.deepEqual(d0.world.active, ['Luna', 'Mira']);
  assert.equal(readJson(worldFile(WID(), 'characters', 'Luna.json')).stats.affection, 30);
  assert.equal((await call('POST', `/worlds/${WID()}/messages/2/swipe`, { swipe_id: 9 })).status, 400);

  // borrar el swipe actual deja el otro seleccionado
  const del = await call('DELETE', `/worlds/${WID()}/messages/2/swipe`);
  assert.equal(del.json.swipes.length, 1);
  assert.equal(del.json.mes, '[Luna|joy] "Ok"');
  assert.equal(del.json.extra.vn.state.stats.characters.Luna.affection, 59);
  assert.equal((await get(WID())).world.background, 'ciudad');
  assert.equal((await call('DELETE', `/worlds/${WID()}/messages/2/swipe`)).status, 409);
});

test('análisis de respaldo cuando falta el bloque de control', async () => {
  requests.length = 0;
  await call('POST', `/worlds/${WID()}/messages`, { mes: 'Hola' });
  replies.push('[Luna|joy] "Gracias por la ayuda."');
  replies.push('```json\n{"stats":[{"character":"Luna","stat":"affection","change":3,"reason":"amable"}]}\n```');
  const gen = await sse(`/worlds/${WID()}/generate`, {});
  assert.equal(requests.length, 2);
  assert.equal(requests[1].max_tokens, 400);
  assert.equal(requests[1].stream, true);
  assert.match(requests[1].messages[1].content, /Gracias por la ayuda/);
  assert.match(requests[1].messages[1].content, /Luna: Affection 59/);
  assert.deepEqual(gen.done.changes.map((c) => [c.stat, c.from, c.to, c.reason]), [['affection', 59, 62, 'amable']]);
  assert.deepEqual(gen.done.message.extra.vn.control, { stats: [{ character: 'Luna', stat: 'affection', change: 3, reason: 'amable' }] });

  // bloque dañado + análisis fallido (basura) → sin cambios
  requests.length = 0;
  await call('POST', `/worlds/${WID()}/messages`, { mes: 'Otra vez' });
  replies.push('[Luna] "Hm."\n<vn>{rota</vn>');
  replies.push('no sé');
  const gen2 = await sse(`/worlds/${WID()}/generate`, {});
  assert.equal(requests.length, 2);
  assert.deepEqual(gen2.done.changes, []);
  assert.equal(gen2.done.message.mes, '[Luna] "Hm."');
  assert.equal(gen2.done.state.stats.characters.Luna.affection, 62);

  // un bloque válido sin cambios no dispara el análisis
  requests.length = 0;
  await call('POST', `/worlds/${WID()}/messages`, { mes: 'Y ahora' });
  replies.push('[Kai] "Basta."\n<vn>{}</vn>');
  await sse(`/worlds/${WID()}/generate`, {});
  assert.equal(requests.length, 1);

  // sin estadísticas adjuntas tampoco hay análisis
  const plain = (await call('POST', '/worlds', { name: 'Sin stats', characters: ['Luna'], active: ['Luna'] })).json;
  requests.length = 0;
  replies.push('[Luna] "Hola."');
  const g3 = await sse(`/worlds/${plain.id}/generate`, {});
  assert.equal(requests.length, 1);
  assert.equal(g3.done.changes.length, 0);
  assert.equal(systemOf(requests[0]).includes('Estadísticas'), false);
  assert.equal(systemOf(requests[0]).includes('<vn>'), true, 'aún puede mover la escena');
  await call('DELETE', `/worlds/${plain.id}`);

  // idioma de las instrucciones
  requests.length = 0;
  await sse(`/worlds/${WID()}/generate`, { swipe: true }, { 'X-Lang': 'en' });
  assert.match(systemOf(requests[0]), /narrator and game master/);
  assert.match(systemOf(requests[0]), /Current scene/);
});

test('edición y borrado de mensajes restauran el estado', async () => {
  const before = await get(WID());
  const n = before.messages.length;
  assert.equal((await call('PATCH', `/worlds/${WID()}/messages/1`, { mes: '' })).status, 400);
  assert.equal((await call('PATCH', `/worlds/${WID()}/messages/1`, { mes: 'Saco mi daga' })).json.mes, 'Saco mi daga');
  assert.equal((await call('PATCH', `/worlds/${WID()}/messages/99`, { mes: 'x' })).status, 404);
  assert.equal((await call('POST', `/worlds/${WID()}/messages`, { mes: 'x'.repeat(50001) })).status, 400);
  assert.equal((await call('DELETE', `/worlds/${WID()}/messages/99`)).status, 404);
  const list = (await call('GET', '/worlds')).json[0];
  assert.equal(list.messageCount, n);
  assert.deepEqual(list.lastLine, { speaker: null, text: 'Sonríe.' });

  // borra el último mensaje (Kai): vuelve el estado del anterior y la escena de su instantánea
  await call('PUT', `/worlds/${WID()}`, { background: 'bosque' });
  assert.equal((await call('DELETE', `/worlds/${WID()}/messages/${n - 1}`)).status, 204);
  assert.equal((await call('DELETE', `/worlds/${WID()}/messages/${n - 2}`)).status, 204);
  const after = await get(WID());
  assert.equal(after.messages.length, n - 2);
  assert.equal(after.world.background, 'ciudad', 'la escena vuelve a la del último mensaje con instantánea');
  assert.equal(after.state.stats.characters.Luna.affection, 62);
  // borrar hasta vaciar vuelve a los valores por defecto y a la escena inicial
  for (let i = after.messages.length - 1; i >= 0; i--) await call('DELETE', `/worlds/${WID()}/messages/${i}`);
  const empty = await get(WID());
  assert.equal(empty.messages.length, 0);
  assert.equal(empty.state.stats.characters.Luna.affection, 50);
  assert.equal(empty.world.background, 'bosque');
  assert.deepEqual(empty.world.active, ['Luna', 'Kai']);
  assert.deepEqual(empty.world.outfits, {});
});

// ---------- ramas, copias, estado manual ----------

let branched;
test('rama (estado y escena rebobinados), copia y edición manual de estadísticas', async () => {
  requests.length = 0;
  replies.push('[Luna|joy] "Uno"\n<vn>{"stats":[{"character":"Luna","stat":"affection","change":10}],"scene":{"background":"ciudad"}}</vn>');
  await sse(`/worlds/${WID()}/generate`, { start: true });
  await call('POST', `/worlds/${WID()}/messages`, { mes: 'Siguiente' });
  replies.push('[Luna|joy] "Dos"\n<vn>{"stats":[{"character":"Luna","stat":"affection","change":10}],"scene":{"background":"bosque","enter":["Mira"]}}</vn>');
  await sse(`/worlds/${WID()}/generate`, {});
  const full = await get(WID());
  assert.equal(full.messages.length, 3);
  assert.equal(full.state.stats.characters.Luna.affection, 70);
  assert.equal(full.world.background, 'bosque');

  assert.equal((await call('POST', `/worlds/${WID()}/branch`, { index: 9 })).status, 400);
  const br = await call('POST', `/worlds/${WID()}/branch`, { index: 0, name: 'Rama uno' });
  assert.equal(br.status, 201);
  branched = br.json;
  assert.equal(branched.name, 'Rama uno');
  assert.notEqual(branched.id, WID());
  assert.equal(branched.background, 'ciudad');
  assert.deepEqual(branched.active, ['Luna', 'Kai']);
  const bd = await get(branched.id);
  assert.equal(bd.messages.length, 1);
  assert.equal(bd.state.stats.characters.Luna.affection, 60);
  assert.equal(readJson(worldFile(branched.id, 'characters', 'Luna.json')).stats.affection, 60);
  assert.equal((await get(WID())).messages.length, 3, 'el original no cambia');
  const suffix = (await call('POST', `/worlds/${WID()}/branch`, { index: 1 })).json;
  assert.match(suffix.name, /\(rama\)$/);
  const again = (await call('POST', `/worlds/${suffix.id}/branch`, { index: 0 })).json;
  assert.match(again.name, /^Mi Mundo ñandú \(rama\)$/, 'no acumula sufijos');
  await call('DELETE', `/worlds/${suffix.id}`);
  await call('DELETE', `/worlds/${again.id}`);

  const cp = await call('POST', `/worlds/${WID()}/copy`, {});
  assert.equal(cp.status, 201);
  assert.match(cp.json.name, /\(copia\)$/);
  const cd = await get(cp.json.id);
  assert.equal(cd.messages.length, 3);
  assert.equal(cd.world.background, 'bosque');
  assert.deepEqual(cd.world.active, ['Luna', 'Kai', 'Mira']);
  assert.equal(cd.state.stats.characters.Luna.affection, 70);
  await call('DELETE', `/worlds/${cp.json.id}`);

  // edición manual (game master)
  assert.equal((await call('PATCH', `/worlds/${WID()}/state`, { stat: 'nope', value: 1 })).status, 400);
  assert.equal((await call('PATCH', `/worlds/${WID()}/state`, { stat: 'affection', value: 1 })).status, 400);
  assert.equal((await call('PATCH', `/worlds/${WID()}/state`, { character: 'Zzz', stat: 'affection', value: 1 })).status, 400);
  assert.equal((await call('PATCH', `/worlds/${WID()}/state`, { character: 'Luna', stat: 'affection', value: 'abc' })).status, 400);
  const patched = await call('PATCH', `/worlds/${WID()}/state`, { character: 'Luna', stat: 'affection', value: 77 });
  assert.equal(patched.json.stats.characters.Luna.affection, 77);
  assert.equal(patched.json.stats.characters.Kai.affection, 50);
  assert.equal((await get(WID())).state.stats.characters.Luna.affection, 77);
  assert.equal((await get(WID())).messages[2].extra.vn.state.stats.characters.Luna.affection, 77);
  assert.equal(readJson(worldFile(WID(), 'characters', 'Luna.json')).stats.affection, 77);
  assert.equal((await call('PATCH', `/worlds/${WID()}/state`, { character: 'Luna', stat: 'affection', value: 500 })).json.stats.characters.Luna.affection, 100);
  assert.equal((await call('PATCH', `/worlds/${WID()}/state`, { stat: 'danger', value: 42 })).json.stats.world.danger, 42);

  // sin escenas todavía: se guarda en initialStats y manda sobre los valores por defecto
  const fresh = (await call('POST', '/worlds', { name: 'Fresco', characters: ['Luna'], active: ['Luna'], statIds: ['affection', 'danger'] })).json;
  const p2 = await call('PATCH', `/worlds/${fresh.id}/state`, { stat: 'danger', value: 40 });
  assert.equal(p2.json.stats.world.danger, 40);
  assert.equal((await get(fresh.id)).state.stats.world.danger, 40);
  assert.equal((await get(fresh.id)).world.initialStats, undefined);
  await call('DELETE', `/worlds/${fresh.id}`);
});

// ---------- impersonar ----------

test('impersonar escribe el mensaje del usuario sin guardar nada', async () => {
  requests.length = 0;
  const count = (await get(WID())).messages.length;
  replies.push('Armando: [Armando] Desenvaino con cautela.');
  const res = await sse(`/worlds/${WID()}/impersonate`, { draft: 'Desenvaino' });
  assert.equal(res.done.text, 'Desenvaino con cautela.');
  assert.ok(res.deltas.length > 0);
  assert.equal(requests[0].stop, undefined);
  const sys = systemOf(requests[0]);
  assert.match(sys, /Eres Armando, el jugador/);
  assert.equal(sys.includes('<vn>'), false);
  assert.match(requests[0].messages.at(-1).content, /Desenvaino/);
  assert.equal((await get(WID())).messages.length, count);
  assert.equal((await call('POST', `/worlds/${WID()}/impersonate`, {}, { Cookie: '' })).status, 401);
});

// ---------- limpieza en cascada ----------

test('cascadas: estadística, fondo, atuendo y personaje', async () => {
  await call('PUT', `/worlds/${WID()}`, { outfits: { Luna: 'formal' } });
  const msgsBefore = (await get(WID())).messages.length;

  // estadística
  assert.equal((await call('DELETE', '/stats/danger')).status, 204);
  await W.detachStat('danger');
  let d = await get(WID());
  assert.deepEqual(d.world.statIds, ['affection']);
  assert.deepEqual(d.stats.map((s) => s.id), ['affection']);
  assert.deepEqual(d.state.stats.world, {});
  requests.length = 0;
  await sse(`/worlds/${WID()}/generate`, { swipe: true });
  assert.equal(systemOf(requests[0]).includes('Danger'), false);
  assert.equal(d.messages.length, msgsBefore);

  // atuendo
  assert.equal((await call('DELETE', '/sprites/Luna/outfits/formal')).status, 204);
  await W.detachOutfit('Luna', 'formal');
  d = await get(WID());
  assert.deepEqual(d.world.outfits, {});

  // fondo (también en las instantáneas)
  assert.equal((await call('DELETE', '/backgrounds/ciudad')).status, 204);
  await W.detachBackground('ciudad');
  d = await get(branched.id);
  assert.equal(d.world.background, '');
  assert.equal(d.messages[0].extra.vn.state.scene.background, '');
  d = await get(WID());
  assert.equal(d.world.background, '', 'la última escena generada usaba la ciudad');
  assert.equal(d.messages.every((m) => !m.extra?.vn || m.extra.vn.state.scene.background !== 'ciudad'), true);

  // personaje
  assert.ok(fs.existsSync(worldFile(WID(), 'characters', 'Mira.json')));
  await call('DELETE', '/characters/Mira');
  await W.detachCharacter('Mira');
  d = await get(WID());
  assert.deepEqual(d.world.characters, ['Luna', 'Kai']);
  assert.deepEqual(d.world.active, ['Luna', 'Kai']);
  assert.equal(fs.existsSync(worldFile(WID(), 'characters', 'Mira.json')), false);
  assert.equal(d.messages.every((m) => !m.extra?.vn || !m.extra.vn.state.scene.active.includes('Mira')), true);
  await W.detachCharacter('Luna');
  d = await get(WID());
  assert.deepEqual(d.world.characters, ['Kai']);
  assert.deepEqual(Object.keys(d.state.stats.characters), ['Kai']);
});

test('mundos: eliminar y 401 sin cookie', async () => {
  assert.equal((await call('DELETE', `/worlds/${WID()}`)).status, 204);
  assert.equal((await call('DELETE', `/worlds/${branched.id}`)).status, 204);
  assert.equal((await call('GET', '/worlds')).json.length, 0);
  const saved = cookie;
  cookie = '';
  assert.equal((await call('GET', '/worlds')).status, 401);
  assert.equal((await call('POST', '/worlds/x/generate', {})).status, 401);
  cookie = saved;
});
