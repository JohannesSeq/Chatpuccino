import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chatpuccino-vn-'));
process.env.DATA_DIR = tmp;

const { createApp } = await import('../index.js');
const { placeholderPng } = await import('../png.js');
const { getSprites, peekSprites, initialStatValue, deleteSprites } = await import('../sprites.js');
const { getBackground, listBackgrounds } = await import('../backgrounds.js');
const { getStat, clampStat } = await import('../stats.js');

const app = createApp().listen(0);
await new Promise((r) => app.once('listening', r));
const base = `http://127.0.0.1:${app.address().port}/api`;

let cookie = '';
const call = async (method, url, body, headers = {}) => {
  const res = await fetch(base + url, {
    method,
    headers: { ...(body !== undefined && !Buffer.isBuffer(body) ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers },
    body: body === undefined ? undefined : Buffer.isBuffer(body) ? body : JSON.stringify(body),
  });
  const raw = Buffer.from(await res.arrayBuffer());
  const isJson = res.headers.get('content-type')?.includes('json');
  return { status: res.status, headers: res.headers, raw, json: isJson && raw.length ? JSON.parse(raw.toString('utf8')) : null };
};
const upload = (url, buf, headers = {}) => call('POST', url, buf, { 'Content-Type': 'application/octet-stream', ...headers });

test.after(() => {
  app.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const png = placeholderPng('Test');
const jpg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32, 1)]);
const gif = Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(32, 1)]);

test('requiere sesión', async () => {
  for (const url of ['/stats', '/backgrounds', '/sprites/Luna']) assert.equal((await call('GET', url)).status, 401);
  const login = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'Admin' }) });
  assert.equal(login.status, 200);
  cookie = login.headers.getSetCookie().find((c) => c.startsWith('chatpuccino_session=')).split(';')[0];
});

test('estadísticas: CRUD, validación y ids únicos', async () => {
  assert.deepEqual((await call('GET', '/stats')).json, []);
  const a = await call('POST', '/stats', { name: ' Afecto ', description: ' cuánto te quiere ', scope: 'character', min: 0, max: 100, default: 150, color: '#FF8800' });
  assert.equal(a.status, 201);
  assert.deepEqual(a.json, { id: 'afecto', name: 'Afecto', description: 'cuánto te quiere', scope: 'character', min: 0, max: 100, default: 100, color: '#ff8800' });
  const b = await call('POST', '/stats', { name: 'Afecto', scope: 'world' });
  assert.equal(b.json.id, 'afecto-2');
  assert.equal(b.json.default, 50);
  assert.equal(b.json.color, '');
  const c = await call('POST', '/stats', { name: 'Afecto', scope: 'world', min: -10, max: 10 });
  assert.equal(c.json.id, 'afecto-3');
  assert.equal(c.json.default, 0);
  assert.equal((await call('POST', '/stats', { name: 'Peligro' })).json.scope, 'character');

  for (const bad of [
    { name: '' },
    { name: 'x', scope: 'galaxy' },
    { name: 'x', min: 10, max: 10 },
    { name: 'x', min: 'abc' },
    { name: 'x', color: 'red' },
  ]) assert.equal((await call('POST', '/stats', bad)).status, 400, JSON.stringify(bad));

  const upd = await call('PUT', '/stats/afecto', { name: 'Cariño', max: 10, default: 5 });
  assert.equal(upd.status, 200);
  assert.equal(upd.json.id, 'afecto');
  assert.equal(upd.json.name, 'Cariño');
  assert.equal(upd.json.max, 10);
  assert.equal(upd.json.description, 'cuánto te quiere');
  assert.equal((await call('PUT', '/stats/afecto', { max: -5 })).status, 400);
  assert.equal((await call('PUT', '/stats/nope', { name: 'x' })).status, 404);
  assert.equal((await getStat('afecto')).name, 'Cariño');
  assert.equal(await getStat('nope'), null);
  assert.equal(clampStat(upd.json, 99), 10);
  assert.equal(clampStat(upd.json, 'x'), 5);

  assert.equal((await call('DELETE', '/stats/afecto-3')).status, 204);
  assert.equal((await call('DELETE', '/stats/afecto-3')).status, 404);
  assert.deepEqual((await call('GET', '/stats')).json.map((s) => s.id), ['afecto', 'afecto-2', 'peligro']);
});

test('fondos: subir, listar, editar, servir y borrar', async () => {
  const bad = await upload('/backgrounds?name=x', Buffer.from('esto no es una imagen'));
  assert.equal(bad.status, 415);
  assert.equal((await upload('/backgrounds?name=x', Buffer.alloc(0))).status, 400);
  assert.equal((await call('POST', '/backgrounds', { name: 'x' })).status, 400);

  const up = await upload(`/backgrounds?name=${encodeURIComponent('Bosque Mágico')}&description=${encodeURIComponent('Árboles')}`, png);
  assert.equal(up.status, 201);
  const bg = up.json;
  assert.equal(bg.id, 'bosque-magico');
  assert.equal(bg.name, 'Bosque Mágico');
  assert.equal(bg.description, 'Árboles');
  assert.match(bg.url, /^\/api\/backgrounds\/bosque-magico\/image\?v=\d+$/);

  // nombre desde X-Filename (URL-encoded, sin extensión) y fondos duplicados
  const fromHeader = await upload('/backgrounds', jpg, { 'X-Filename': encodeURIComponent('Playa al atardecer.jpg') });
  assert.equal(fromHeader.json.name, 'Playa al atardecer');
  const dup = await upload('/backgrounds?name=bosque%20m%C3%A1gico', gif);
  assert.equal(dup.status, 201);
  assert.notEqual(dup.json.id, 'bosque-magico');
  assert.notEqual(dup.json.name.toLowerCase(), 'bosque mágico');

  const list = await call('GET', '/backgrounds');
  assert.equal(list.json.length, 3);
  assert.deepEqual(Object.keys(list.json[0]).sort(), ['description', 'id', 'mtime', 'name', 'url']);
  assert.equal((await getBackground('BOSQUE MÁGICO')).id, 'bosque-magico');
  assert.equal((await getBackground('playa-al-atardecer')).name, 'Playa al atardecer');
  assert.equal(await getBackground('nada'), null);

  const img = await call('GET', '/backgrounds/bosque-magico/image');
  assert.equal(img.status, 200);
  assert.equal(img.headers.get('content-type'), 'image/png');
  assert.match(img.headers.get('cache-control'), /private, max-age=3600/);
  assert.ok(img.raw.equals(png));
  assert.equal((await call('GET', '/backgrounds/playa-al-atardecer/image')).headers.get('content-type'), 'image/jpeg');
  assert.equal((await call('GET', '/backgrounds/nope/image')).status, 404);
  assert.equal((await call('GET', '/backgrounds/..%2F..%2Fstats/image')).status, 404);

  const put = await call('PUT', '/backgrounds/bosque-magico', { name: 'Bosque', description: 'Nuevo' });
  assert.equal(put.json.name, 'Bosque');
  assert.equal(put.json.description, 'Nuevo');
  assert.equal(put.json.id, 'bosque-magico');
  assert.equal((await call('PUT', '/backgrounds/bosque-magico', { name: '  ' })).status, 400);
  assert.equal((await call('PUT', '/backgrounds/bosque-magico', { name: 'playa AL atardecer' })).status, 409);
  assert.equal((await call('PUT', '/backgrounds/nope', { name: 'x' })).status, 404);

  assert.equal((await call('DELETE', '/backgrounds/bosque-magico')).status, 204);
  assert.equal((await call('DELETE', '/backgrounds/bosque-magico')).status, 404);
  assert.equal((await call('GET', '/backgrounds/bosque-magico/image')).status, 404);
  assert.equal((await listBackgrounds()).length, 2);
  assert.ok(!fs.existsSync(path.join(tmp, 'vn', 'backgrounds', 'bosque-magico.png')));
});

const makeChar = async (name) => {
  const res = await call('POST', '/characters', { data: { name, description: 'Test' } });
  assert.equal(res.status, 201);
  return res.json.id;
};

test('sprites: atuendo por defecto, 404 y rutas peligrosas', async () => {
  assert.equal((await call('GET', '/sprites/NoExiste')).status, 404);
  assert.ok(!fs.existsSync(path.join(tmp, 'vn', 'sprites', 'NoExiste')));

  const id = await makeChar('Luna');
  const peek = await peekSprites(id);
  assert.equal(peek.outfits[0].id, 'default');
  assert.ok(!fs.existsSync(path.join(tmp, 'vn', 'sprites', id)), 'peek no crea nada');

  const res = await call('GET', `/sprites/${id}`);
  assert.equal(res.status, 200);
  assert.deepEqual(res.json, {
    charId: id,
    config: { defaultOutfit: 'default', fallbackExpression: 'neutral', customExpressions: [], stats: {} },
    outfits: [{ id: 'default', name: res.json.outfits[0].name, expressions: {} }],
  });
  assert.ok(fs.existsSync(path.join(tmp, 'vn', 'sprites', id, 'default')));
  assert.equal((await getSprites(id)).outfits.length, 1);

  for (const evil of ['..', '%2e%2e', '..%2F..%2Fsettings', '..%5Csecret', 'a%3Ab']) {
    const r = await call('GET', `/sprites/${evil}`);
    assert.ok([400, 404].includes(r.status), `${evil} → ${r.status}`);
  }
  assert.equal((await call('GET', `/sprites/${id}/outfits/..%2F..%2F/files/x.png`)).status, 400);
  assert.equal((await call('GET', `/sprites/${id}/outfits/default/files/config.json`)).status, 400);
  assert.equal((await call('GET', `/sprites/${id}/outfits/default/files/..%2Fconfig.json`)).status, 400);
  assert.equal((await call('GET', `/sprites/${id}/outfits/default/files/nada.png`)).status, 404);
  assert.equal((await call('POST', `/sprites/${id}/outfits`, { name: '   ' })).status, 400);
});

test('sprites: atuendos (crear, renombrar, borrar)', async () => {
  const id = await makeChar('Kai');
  await call('GET', `/sprites/${id}`);

  const created = await call('POST', `/sprites/${id}/outfits`, { name: 'Traje de gala' });
  assert.equal(created.status, 201);
  assert.deepEqual(created.json, { id: 'traje-de-gala', name: 'Traje de gala', expressions: {} });
  assert.equal((await call('POST', `/sprites/${id}/outfits`, { name: 'traje de GALA' })).status, 409);
  const second = await call('POST', `/sprites/${id}/outfits`, { name: 'Traje de gala!' });
  assert.equal(second.json.id, 'traje-de-gala-2');

  const renamed = await call('PUT', `/sprites/${id}/outfits/traje-de-gala`, { name: 'Gala' });
  assert.equal(renamed.json.id, 'traje-de-gala');
  assert.equal(renamed.json.name, 'Gala');
  assert.equal((await call('PUT', `/sprites/${id}/outfits/nope`, { name: 'x' })).status, 404);

  assert.equal((await call('PUT', `/sprites/${id}`, { defaultOutfit: 'traje-de-gala' })).json.config.defaultOutfit, 'traje-de-gala');
  assert.equal((await call('PUT', `/sprites/${id}`, { defaultOutfit: 'nope' })).status, 404);

  assert.equal((await call('DELETE', `/sprites/${id}/outfits/traje-de-gala`)).status, 204);
  let state = (await call('GET', `/sprites/${id}`)).json;
  assert.equal(state.config.defaultOutfit, 'default', 'defaultOutfit se corrige');
  assert.deepEqual(state.outfits.map((o) => o.id), ['default', 'traje-de-gala-2']);
  assert.ok(!fs.existsSync(path.join(tmp, 'vn', 'sprites', id, 'traje-de-gala')));

  assert.equal((await call('DELETE', `/sprites/${id}/outfits/default`)).status, 204);
  assert.equal((await call('DELETE', `/sprites/${id}/outfits/traje-de-gala-2`)).status, 400, 'el último no se puede borrar');
  state = (await call('GET', `/sprites/${id}`)).json;
  assert.equal(state.outfits.length, 1);
  assert.equal(state.config.defaultOutfit, 'traje-de-gala-2');
});

test('sprites: archivos, etiquetas y variantes', async () => {
  const id = await makeChar('Hada');
  const files = `/sprites/${id}/outfits/default/files`;
  await call('GET', `/sprites/${id}`);

  const first = await upload(`${files}?label=joy`, png, { 'X-Filename': 'cualquiera.png' });
  assert.equal(first.status, 200);
  assert.deepEqual(Object.keys(first.json.expressions), ['joy']);
  assert.equal(first.json.expressions.joy[0].file, 'joy.png');
  assert.match(first.json.expressions.joy[0].url, new RegExp(`^/api/sprites/${id}/outfits/default/files/joy\\.png\\?v=\\d+$`));

  // etiqueta derivada del nombre (SillyTavern): Joy-2.PNG → joy; variantes numeradas
  const second = await upload(files, jpg, { 'X-Filename': encodeURIComponent('Joy-2.PNG') });
  assert.deepEqual(second.json.expressions.joy.map((f) => f.file), ['joy.png', 'joy-2.jpg']);
  const third = await upload(files, gif, { 'X-Filename': 'joy_3.webp' });
  assert.deepEqual(third.json.expressions.joy.map((f) => f.file), ['joy.png', 'joy-2.jpg', 'joy-3.gif']);

  const sad = await upload(files, png, { 'X-Filename': 'Sadness.png' });
  assert.deepEqual(Object.keys(sad.json.expressions), ['joy', 'sadness']);

  // etiqueta propia → se añade a customExpressions; las de SillyTavern no
  const custom = await upload(`${files}?label=Sleepy`, png);
  assert.ok(custom.json.expressions.sleepy);
  let state = (await call('GET', `/sprites/${id}`)).json;
  assert.deepEqual(state.config.customExpressions, ['sleepy']);
  assert.deepEqual(Object.keys(state.outfits[0].expressions), ['joy', 'sadness', 'sleepy']);

  // errores
  assert.equal((await upload(`${files}?label=joy`, Buffer.from('no es una imagen'))).status, 415);
  assert.equal((await upload(`${files}?label=${encodeURIComponent('../x')}`, png)).status, 200, 'la etiqueta se sanea, nunca sale de la carpeta');
  assert.equal((await upload(`${files}?label=joy-2`, png)).status, 400);
  assert.equal((await upload(files, png)).status, 400, 'sin etiqueta ni nombre');
  assert.equal((await upload(`/sprites/${id}/outfits/nope/files?label=joy`, png)).status, 404);
  assert.equal((await upload(`/sprites/NoExiste/outfits/default/files?label=joy`, png)).status, 404);

  // servir y borrar
  const img = await call('GET', `${files}/joy-2.jpg`);
  assert.equal(img.status, 200);
  assert.equal(img.headers.get('content-type'), 'image/jpeg');
  assert.match(img.headers.get('cache-control'), /private, max-age=3600/);
  assert.ok(img.raw.equals(jpg));
  const del = await call('DELETE', `${files}/joy-2.jpg`);
  assert.deepEqual(del.json.expressions.joy.map((f) => f.file), ['joy.png', 'joy-3.gif']);
  assert.equal((await call('DELETE', `${files}/joy-2.jpg`)).status, 404);
  assert.equal((await call('DELETE', `${files}/..%2F..%2Fconfig.json`)).status, 400);
  assert.equal((await call('DELETE', `${files}/config.json`)).status, 400);
  assert.ok(fs.existsSync(path.join(tmp, 'vn', 'sprites', id, 'config.json')));
  // al subir otra variante se reutiliza el hueco libre más bajo
  const again = await upload(`${files}?label=joy`, png);
  assert.deepEqual(again.json.expressions.joy.map((f) => f.file), ['joy.png', 'joy-2.png', 'joy-3.gif']);
});

test('sprites: configuración, estadísticas iniciales y borrado de personaje', async () => {
  const id = await makeChar('Mago');
  const stats = (await call('GET', '/stats')).json;
  assert.ok(stats.find((s) => s.id === 'afecto-2' && s.scope === 'world'));
  assert.ok(stats.find((s) => s.id === 'peligro' && s.scope === 'character'));
  await call('POST', '/stats', { name: 'Confianza', min: 0, max: 10 });

  const put = await call('PUT', `/sprites/${id}`, {
    fallbackExpression: 'Joy',
    customExpressions: ['sleepy', 'Sleepy', 'joy', 'wink'],
    stats: { peligro: 500, confianza: 4, 'afecto-2': 7, inexistente: 3, afecto: 'x' },
  });
  assert.equal(put.status, 200);
  assert.equal(put.json.config.fallbackExpression, 'joy');
  assert.deepEqual(put.json.config.customExpressions, ['sleepy', 'wink']);
  assert.deepEqual(put.json.config.stats, { peligro: 100, confianza: 4 });
  assert.equal(await initialStatValue(id, 'confianza'), 4);
  assert.equal(await initialStatValue(id, 'afecto'), null);
  assert.equal(await initialStatValue('SinDatos', 'confianza'), null);

  assert.equal((await call('PUT', `/sprites/${id}`, { fallbackExpression: 'no valido!' })).status, 200, 'se sanea');
  assert.equal((await call('PUT', `/sprites/${id}`, { fallbackExpression: '***' })).status, 400);
  assert.equal((await call('PUT', `/sprites/NoExiste`, { fallbackExpression: 'joy' })).status, 404);

  // borrar una estadística la quita de las configuraciones
  assert.equal((await call('DELETE', '/stats/confianza')).status, 204);
  assert.deepEqual((await call('GET', `/sprites/${id}`)).json.config.stats, { peligro: 100 });

  // borrar el personaje borra sus sprites
  await upload(`/sprites/${id}/outfits/default/files?label=joy`, png);
  assert.ok(fs.existsSync(path.join(tmp, 'vn', 'sprites', id)));
  assert.equal((await call('DELETE', `/characters/${id}`)).status, 204);
  assert.ok(!fs.existsSync(path.join(tmp, 'vn', 'sprites', id)));
  await deleteSprites(id);
});
