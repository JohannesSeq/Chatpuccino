import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aberracion-'));
process.env.DATA_DIR = tmp;

const requests = [];
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
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write(': OPENROUTER PROCESSING\n\n');
    for (const t of ['Hola', ' mundo', '!']) res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: t } }] })}\n\n`);
    res.end('data: [DONE]\n\n');
  });
});
await new Promise((r) => fake.listen(0, r));
process.env.OPENROUTER_BASE = `http://127.0.0.1:${fake.address().port}`;

const { createApp } = await import('../index.js');
const { embedCard, extractCardText, placeholderPng, isPng } = await import('../png.js');
const { activateEntries, normalizeBook } = await import('../lore.js');

const app = createApp().listen(0);
await new Promise((r) => app.once('listening', r));
const base = `http://127.0.0.1:${app.address().port}/api`;

const call = async (method, url, body) => {
  const res = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  return { status: res.status, json: text && res.headers.get('content-type')?.includes('json') ? JSON.parse(text) : text };
};

const sse = async (url, body) => {
  const res = await fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const events = (await res.text()).split('\n\n').filter((l) => l.startsWith('data:')).map((l) => JSON.parse(l.slice(5)));
  return { status: res.status, events };
};

test.after(() => {
  app.close();
  fake.close();
  fs.rmSync(tmp, { recursive: true, force: true });
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

test('flujo completo: ajustes, personaje, persona, chat, streaming, swipe, edición', async () => {
  assert.equal((await call('POST', '/openrouter/test', { apiKey: 'sk-or-v1-abcdefghij' })).json.label, 'test-key');
  assert.equal((await call('GET', '/models')).json[0].id, 'a/free');
  const s = await call('PUT', '/settings', { apiKey: 'sk-or-v1-abcdefghij', model: 'a/free' });
  assert.equal(s.json.hasKey, true);
  assert.equal(s.json.apiKey, undefined);

  const img = `data:image/png;base64,${placeholderPng('t', 16, 16).toString('base64')}`;
  const created = await call('POST', '/characters', { data: { name: 'Luna', description: '{{char}} es una maga.', first_mes: 'Hola {{user}}', alternate_greetings: ['Buenas'], extensions: { world: 'Mundo' } }, image: img });
  assert.equal(created.status, 201);
  assert.equal(created.json.id, 'Luna');

  const imported = await fetch(`${base}/characters/import`, { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: fs.readFileSync(path.join(tmp, 'characters', 'Luna.png')) });
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
  assert.match(prompt[0].content, /Participants: Luna, Kai/);
  assert.match(prompt.at(-1).content, /Armando: Hola a todos/);
  assert.equal((await sse(`${ref}/generate`, { speakerId: 'nadie' })).status, 400);
});
