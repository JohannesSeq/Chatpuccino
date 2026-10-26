import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chatpuccino-tts-'));
process.env.DATA_DIR = tmp;

// Servidor de voz falso: API tipo OpenAI (/audio/speech, /audio/voices) y tipo ElevenLabs (/voices, /text-to-speech/:id).
const hits = [];
let failWith = 0;
const AUDIO = Buffer.from('ID3-fake-mp3');
const fake = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    hits.push({ method: req.method, url: req.url, headers: req.headers, body: body ? JSON.parse(body) : null });
    const json = (data, status = 200) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    };
    if (failWith) return json({ error: { message: 'cuota agotada' } }, failWith);
    if (req.url === '/v1/audio/voices') return json({ voices: ['af_bella', 'am_adam'] });
    if (req.url === '/v1/audio/speech') {
      res.writeHead(200, { 'Content-Type': 'audio/mpeg' });
      return res.end(AUDIO);
    }
    if (req.url === '/el/voices') return json({ voices: [{ voice_id: 'v1', name: 'Rachel' }, { voice_id: 'v2', name: 'Adam' }] });
    if (req.url.startsWith('/el/text-to-speech/')) {
      res.writeHead(200, { 'Content-Type': 'audio/mpeg' });
      return res.end(AUDIO);
    }
    return json({ detail: 'Not Found' }, 404);
  });
});
await new Promise((r) => fake.listen(0, r));
const FAKE = `http://127.0.0.1:${fake.address().port}`;
process.env.ELEVENLABS_BASE = `${FAKE}/el`;

const { createApp } = await import('../index.js');
const { narrationSteps, splitRoles, chunkText, cleanForSpeech } = await import('../../shared/tts.js');
const app = createApp().listen(0);
await new Promise((r) => app.once('listening', r));
const base = `http://127.0.0.1:${app.address().port}/api`;

let cookie = '';
const call = async (method, url, body) => {
  const res = await fetch(base + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const set = res.headers.getSetCookie?.().find((c) => c.startsWith('chatpuccino_session='));
  if (set) cookie = set.split(';')[0];
  const buf = Buffer.from(await res.arrayBuffer());
  const type = res.headers.get('content-type') || '';
  return { status: res.status, type, buf, json: type.includes('json') ? JSON.parse(buf.toString('utf8')) : null };
};

test.after(() => {
  app.close();
  fake.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('narración: lo citado lo dicen los personajes y lo demás el narrador', () => {
  const text = '*Sonríe y se acerca.* "¡Hola, viajero!" Luego mira al cielo. "Qué bonito día."';
  assert.deepEqual(narrationSteps(text, { speakerKey: 'char:luna' }), [
    { voice: 'narrator', text: 'Sonríe y se acerca.' },
    { voice: 'char:luna', text: '¡Hola, viajero!' },
    { voice: 'narrator', text: 'Luego mira al cielo.' },
    { voice: 'char:luna', text: 'Qué bonito día.' },
  ]);
  // sin narrador solo se oyen los diálogos (y se unen los que quedan seguidos)
  assert.deepEqual(narrationSteps(text, { speakerKey: 'char:luna', narrator: false }), [{ voice: 'char:luna', text: '¡Hola, viajero! Qué bonito día.' }]);
  // comillas que no son rectas no cuentan como diálogo
  assert.deepEqual(narrationSteps('Dijo “hola” despacio.', { speakerKey: 'char:luna' }), [{ voice: 'narrator', text: 'Dijo “hola” despacio.' }]);
  // una comilla sin cerrar llega hasta el final
  assert.deepEqual(narrationSteps('Grita: "¡Corre!', { speakerKey: 'char:k' }), [{ voice: 'narrator', text: 'Grita:' }, { voice: 'char:k', text: '¡Corre!' }]);
  // sin comillas: todo lo lee el narrador… salvo que se pida lo contrario
  assert.deepEqual(narrationSteps('*Sonríe.* Hola amigo', { speakerKey: 'char:l' }), [{ voice: 'narrator', text: 'Sonríe. Hola amigo' }]);
  assert.deepEqual(narrationSteps('*Sonríe.* Hola amigo', { speakerKey: 'char:l', unquoted: 'speech' }), [{ voice: 'narrator', text: 'Sonríe.' }, { voice: 'char:l', text: 'Hola amigo' }]);
  // mensajes del usuario: sin comillas es su propia frase
  assert.deepEqual(narrationSteps('Hola a todos *saluda*', { kind: 'user', speakerKey: 'user' }), [{ voice: 'user', text: 'Hola a todos' }, { voice: 'narrator', text: 'saluda' }]);
  assert.deepEqual(narrationSteps('Hola a todos', { kind: 'user', speakerKey: 'user', narrator: false }), [{ voice: 'user', text: 'Hola a todos' }]);
  // líneas del narrador del Modo Novela: todo es narración y se quitan las comillas
  assert.deepEqual(narrationSteps('La sala quedó "en silencio".', { kind: 'narrator' }), [{ voice: 'narrator', text: 'La sala quedó en silencio.' }]);
  assert.deepEqual(narrationSteps('La sala quedó en silencio.', { kind: 'narrator', narrator: false }), []);
});

test('narración: nunca se lee información interna ni formato', () => {
  const dirty = '[Luna|joy] "Hola"\n<vn>{"stats":[{"character":"Luna"}]}</vn>';
  assert.ok(!cleanForSpeech(dirty).includes('stats'), 'el bloque de control no se lee');
  assert.ok(!cleanForSpeech('Mira ```js\nconsole.log(1)\n``` esto').includes('console'), 'los bloques de código se omiten');
  assert.ok(cleanForSpeech('Mira ```js\nconsole.log(1)\n``` esto', { skipCode: false }).includes('console'));
  const roles = splitRoles('**Hola** _mundo_ 😀 [web](https://x.y/z) <b>fuerte</b> y https://a.b/c');
  assert.deepEqual(roles, [{ role: 'narrator', text: 'Hola mundo web fuerte y' }]);
  assert.deepEqual(splitRoles('... "—" "¡Ey!"'), [{ role: 'speech', text: '¡Ey!' }], 'los tramos sin letras ni números se descartan');
  assert.deepEqual(narrationSteps('', { speakerKey: 'char:a' }), []);
});

test('narración: trozos de texto cortados en finales de frase', () => {
  assert.deepEqual(chunkText('Una frase. Otra frase más larga que la anterior. Y una tercera!', 30), ['Una frase.', 'Otra frase más larga que la', 'anterior. Y una tercera!']);
  assert.deepEqual(chunkText('corto', 30), ['corto']);
  assert.deepEqual(chunkText('', 30), []);
  const long = chunkText('palabra '.repeat(100), 50);
  assert.ok(long.every((c) => c.length <= 50) && long.join(' ').replace(/\s+/g, ' ').trim() === 'palabra '.repeat(100).trim());
  assert.ok(chunkText('x'.repeat(130), 50).every((c) => c.length <= 50), 'palabras larguísimas también se parten');
});

test('tts: requiere sesión y tiene valores por defecto', async () => {
  assert.equal((await call('GET', '/tts')).status, 401);
  assert.equal((await call('POST', '/auth/login', { username: 'admin', password: 'Admin' })).status, 200);
  const cfg = (await call('GET', '/tts')).json;
  assert.equal(cfg.enabled, false);
  assert.equal(cfg.provider, 'browser');
  assert.equal(cfg.narrator, true);
  assert.equal(cfg.narrateUser, false);
  assert.equal(cfg.openai.hasKey, false);
  assert.deepEqual(cfg.voices.browser, { narrator: '', user: '', default: '', chars: {} });
});

test('tts: guarda la configuración sin devolver las claves y valida los valores', async () => {
  const put = await call('PUT', '/tts', {
    enabled: true,
    provider: 'openai',
    narrator: false,
    unquoted: 'speech',
    volume: 500,
    browser: { rate: 9, pitch: -3 },
    openai: { baseUrl: `${FAKE}/v1/`, apiKey: 'sk-secreto-123', model: 'kokoro', speed: 10 },
    elevenlabs: { apiKey: 'xi-secreto-456', stability: 2 },
    voices: { openai: { narrator: 'am_adam', chars: { luna: 'af_bella', '': 'x' } }, nope: { narrator: 'x' } },
  });
  assert.equal(put.status, 200);
  const c = put.json;
  assert.equal(c.enabled, true);
  assert.equal(c.provider, 'openai');
  assert.equal(c.narrator, false);
  assert.equal(c.unquoted, 'speech');
  assert.equal(c.volume, 100);
  assert.deepEqual(c.browser, { rate: 2, pitch: 0 });
  assert.equal(c.openai.baseUrl, `${FAKE}/v1`);
  assert.equal(c.openai.speed, 4);
  assert.equal(c.openai.hasKey, true);
  assert.equal(c.elevenlabs.stability, 1);
  assert.ok(!JSON.stringify(c).includes('secreto'), 'las claves no vuelven al navegador');
  assert.equal(c.voices.openai.narrator, 'am_adam');
  assert.equal(c.voices.openai.chars.luna, 'af_bella');
  assert.equal(c.voices.nope, undefined);
  assert.ok(fs.readFileSync(path.join(tmp, 'tts.json'), 'utf8').includes('sk-secreto-123'), 'la clave sí se guarda en el servidor');

  // los parches parciales no borran lo demás; una clave vacía conserva la guardada
  const again = (await call('PUT', '/tts', { openai: { model: 'otro', apiKey: '' }, voices: { openai: { chars: { kai: 'am_adam' } } } })).json;
  assert.equal(again.openai.model, 'otro');
  assert.equal(again.openai.hasKey, true);
  assert.deepEqual(again.voices.openai.chars, { luna: 'af_bella', kai: 'am_adam' });
  assert.equal((await call('PUT', '/tts', { provider: 'inventado' })).status, 400);
  assert.equal((await call('PUT', '/tts', { openai: { baseUrl: 'ftp://x' } })).status, 400);
  assert.equal((await call('GET', '/tts')).json.provider, 'openai', 'un parche inválido no cambia nada');
  assert.equal((await call('PUT', '/tts', { openai: { model: 'tts-1', apiKey: '__clear__' } })).json.openai.hasKey, false);
  await call('PUT', '/tts', { openai: { apiKey: 'sk-secreto-123' } });
});

test('tts: voces del servidor, lista manual y valores por defecto', async () => {
  const fromServer = (await call('GET', '/tts/voices?provider=openai')).json;
  assert.equal(fromServer.source, 'server');
  assert.deepEqual(fromServer.voices.map((v) => v.id), ['af_bella', 'am_adam']);
  await call('PUT', '/tts', { openai: { voices: 'uno, dos\ntres' } });
  const manual = (await call('GET', '/tts/voices?provider=openai')).json;
  assert.equal(manual.source, 'manual');
  assert.deepEqual(manual.voices.map((v) => v.id), ['uno', 'dos', 'tres']);
  await call('PUT', '/tts', { openai: { voices: '', baseUrl: 'http://127.0.0.1:1' } });
  const fallback = (await call('GET', '/tts/voices?provider=openai')).json;
  assert.equal(fallback.source, 'default');
  assert.ok(fallback.voices.some((v) => v.id === 'alloy'));
  await call('PUT', '/tts', { openai: { baseUrl: `${FAKE}/v1` } });
  const eleven = (await call('GET', '/tts/voices?provider=elevenlabs')).json;
  assert.deepEqual(eleven.voices, [{ id: 'v1', name: 'Rachel' }, { id: 'v2', name: 'Adam' }]);
  assert.equal((await call('GET', '/tts/voices?provider=raro')).status, 400);
  assert.deepEqual((await call('GET', '/tts/voices?provider=browser')).json.voices, []);
});

test('tts: /speak sintetiza con OpenAI y ElevenLabs y explica los fallos', async () => {
  hits.length = 0;
  await call('PUT', '/tts', { openai: { model: 'kokoro', speed: 1.25 } });
  const ok = await call('POST', '/tts/speak', { text: 'Hola mundo', voice: 'af_bella' });
  assert.equal(ok.status, 200);
  assert.equal(ok.type, 'audio/mpeg');
  assert.deepEqual(ok.buf, AUDIO);
  const hit = hits.find((h) => h.url === '/v1/audio/speech');
  assert.deepEqual(hit.body, { model: 'kokoro', input: 'Hola mundo', voice: 'af_bella', response_format: 'mp3', speed: 1.25 });
  assert.equal(hit.headers.authorization, 'Bearer sk-secreto-123');
  assert.equal((await call('POST', '/tts/speak', { text: 'Hola' })).status, 200, 'sin voz usa la predeterminada');
  assert.equal(hits.at(-1).body.voice, 'alloy');

  await call('PUT', '/tts', { elevenlabs: { apiKey: 'xi-secreto-456', model: 'eleven_turbo_v2', stability: 0.3, similarity: 0.9 } });
  assert.equal((await call('POST', '/tts/speak', { provider: 'elevenlabs', text: 'Hola' })).json.code, 'TTS_NO_VOICE');
  const el = await call('POST', '/tts/speak', { provider: 'elevenlabs', text: 'Hola', voice: 'v1/../x' });
  assert.equal(el.status, 200);
  const elHit = hits.at(-1);
  assert.equal(elHit.url, '/el/text-to-speech/v1%2F..%2Fx', 'la voz se escapa en la ruta');
  assert.equal(elHit.headers['xi-api-key'], 'xi-secreto-456');
  assert.deepEqual(elHit.body, { text: 'Hola', model_id: 'eleven_turbo_v2', voice_settings: { stability: 0.3, similarity_boost: 0.9 } });

  assert.equal((await call('POST', '/tts/speak', { text: '   ' })).status, 400);
  assert.equal((await call('POST', '/tts/speak', { text: 'x'.repeat(4001) })).status, 400);
  assert.equal((await call('POST', '/tts/speak', { provider: 'browser', text: 'Hola' })).status, 400);

  failWith = 401;
  assert.equal((await call('POST', '/tts/speak', { text: 'Hola' })).json.code, 'TTS_AUTH');
  failWith = 429;
  const limited = await call('POST', '/tts/speak', { text: 'Hola' });
  assert.equal(limited.json.code, 'TTS_BAD_RESPONSE');
  assert.ok(limited.json.error.includes('cuota agotada'), 'se muestra el motivo del servicio');
  failWith = 0;
  await call('PUT', '/tts', { openai: { baseUrl: 'http://127.0.0.1:1' } });
  assert.equal((await call('POST', '/tts/speak', { text: 'Hola' })).json.code, 'TTS_UNREACHABLE');
  await call('PUT', '/tts', { openai: { baseUrl: `${FAKE}/v1` } });
});

test('tts: probar la conexión sin guardarla', async () => {
  const stored = (await call('GET', '/tts')).json.openai.baseUrl;
  const ok = await call('POST', '/tts/test', { provider: 'openai', openai: { baseUrl: `${FAKE}/v1`, model: 'm' } });
  assert.equal(ok.json.ok, true);
  assert.equal(ok.json.voices, 2);
  const bad = await call('POST', '/tts/test', { provider: 'openai', openai: { baseUrl: 'http://127.0.0.1:1' } });
  assert.equal(bad.json.code, 'TTS_UNREACHABLE');
  assert.equal((await call('GET', '/tts')).json.openai.baseUrl, stored, 'no se guardó nada');
  assert.equal((await call('POST', '/tts/test', { provider: 'elevenlabs' })).json.voices, 2);
  assert.equal((await call('POST', '/tts/test', { provider: 'browser' })).json.ok, true);
});
