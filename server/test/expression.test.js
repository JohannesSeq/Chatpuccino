import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chatpuccino-expression-'));
process.env.DATA_DIR = tmp;

// Modelo falso: responde lo que haya en la cola (o «joy») y guarda las peticiones.
const requests = [];
const replies = [];
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
    const reply = replies.length ? replies.shift() : 'joy';
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: reply } }] })}\n\n`);
    res.end('data: [DONE]\n\n');
  });
});
await new Promise((r) => fake.listen(0, r));
process.env.OPENROUTER_BASE = `http://127.0.0.1:${fake.address().port}`;

const { createApp } = await import('../index.js');
const { parseLabel } = await import('../routes/expression.js');
const { classifyExpression, scoreExpressions } = await import('../../shared/expressions.js');
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
  const text = await res.text();
  return { status: res.status, json: text && res.headers.get('content-type')?.includes('json') ? JSON.parse(text) : text };
};

test.after(() => {
  app.close();
  fake.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('expresión local: reconoce la emoción de mensajes en español e inglés', () => {
  const cases = [
    ['*Sonríe ampliamente.* "¡Qué alegría verte, de verdad!"', 'joy'],
    ['*Frunce el ceño y golpea la mesa.* "¡Maldita sea, estoy furiosa!"', 'anger'],
    ['*Sus ojos se llenan de lágrimas.* "Lo extraño tanto..." Llora en silencio.', 'sadness'],
    ['"¿Qué? No puede ser..." *abre los ojos de golpe, jadea.*', 'surprise'],
    ['*Se sonroja y tartamudea.* "Y-yo... no sé qué decir..."', 'nervousness'],
    ['She sighs and rolls her eyes. "Ugh, really?"', 'annoyance'],
    ['"Thank you so much, I really appreciate it."', 'gratitude'],
    ['*Ríe a carcajadas.* "Jajaja, eso es muy gracioso"', 'amusement'],
    ['*Retrocede aterrada.* "¡Aléjate de mí! Tengo miedo."', 'fear'],
    ['"Lo siento mucho, fue mi culpa. Perdóname."', 'remorse'],
    ['*Looks at the sight of the city.* "Nice view."', 'neutral'],
    ['"Hola."', 'neutral'],
    ['', 'neutral'],
  ];
  for (const [text, want] of cases) assert.equal(classifyExpression(text, null, 'neutral'), want, text);
  assert.deepEqual(scoreExpressions(''), []);
});

test('expresión local: se limita a los sprites que existen y usa emociones parecidas', () => {
  const only = ['neutral', 'joy', 'sadness'];
  assert.equal(classifyExpression('"¡Estoy tan emocionada, no puedo esperar!"', only, 'neutral'), 'joy', 'excitement → joy');
  assert.equal(classifyExpression('Llora desconsolada, devastada.', only, 'neutral'), 'sadness', 'grief → sadness');
  assert.equal(classifyExpression('Se enfurece y grita', ['neutral', 'joy'], 'neutral'), 'neutral', 'nada parecido: el de respaldo');
  assert.equal(classifyExpression('nada de nada', ['neutral'], 'calm'), 'calm');
});

test('expresión IA: la respuesta del modelo se interpreta con tolerancia', () => {
  const labels = ['neutral', 'joy', 'sadness'];
  assert.equal(parseLabel('joy', labels), 'joy');
  assert.equal(parseLabel('  "Sadness".\n', labels), 'sadness');
  assert.equal(parseLabel('Etiqueta: joy (porque sonríe)', labels), 'joy');
  assert.equal(parseLabel('<think>quizá sadness</think>neutral', labels), 'neutral');
  assert.equal(parseLabel('anger', labels), null);
  assert.equal(parseLabel('', labels), null);
});

test('expresión IA: /expression pide la etiqueta al modelo activo', async () => {
  assert.equal((await call('POST', '/expression', { text: 'hola', labels: ['joy'] })).status, 401);
  assert.equal((await call('POST', '/auth/login', { username: 'admin', password: 'Admin' })).status, 200);
  assert.equal((await call('POST', '/expression', { text: 'hola', labels: ['joy'] })).status, 400, 'sin conexión configurada');
  await call('PUT', '/connections/openrouter', { apiKey: 'sk-or-v1-abcdefghij', model: 'a/free' });

  replies.push('Sadness');
  const ok = await call('POST', '/expression', { text: '*Llora en silencio.*', labels: ['neutral', 'joy', 'sadness', 'bad label!'], name: 'Luna' });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.json, { label: 'sadness' });
  const sent = requests.at(-1);
  assert.equal(sent.temperature, 0);
  const prompt = sent.messages.map((m) => m.content).join('\n');
  assert.ok(prompt.includes('Luna') && prompt.includes('neutral, joy, sadness') && prompt.includes('Llora en silencio'));
  assert.ok(!prompt.includes('bad label'), 'las etiquetas inválidas se descartan');

  replies.push('no sé');
  assert.deepEqual((await call('POST', '/expression', { text: 'x', labels: ['joy'] })).json, { label: null });
  assert.equal((await call('POST', '/expression', { text: '   ', labels: ['joy'] })).status, 400);
  assert.equal((await call('POST', '/expression', { text: 'x', labels: [] })).status, 400);
});
