import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chatpuccino-studio-'));
process.env.DATA_DIR = tmp;

// Servidor falso con la API de AUTOMATIC1111.
const hits = [];
let authSeen;
let missing = new Set();
const PNG_B64 = Buffer.from('fake-image').toString('base64');
const fake = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    authSeen = req.headers.authorization;
    const url = req.url.split('?')[0];
    hits.push({ method: req.method, url: req.url, body: body ? JSON.parse(body) : null });
    const json = (data, status = 200) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    };
    if (missing.has(url)) return json({ detail: 'Not Found' }, 404);
    switch (url) {
      case '/sdapi/v1/sd-models': return json([{ title: 'modelA.safetensors [abc]', model_name: 'modelA' }, { title: 'modelB.ckpt [def]', model_name: 'modelB' }]);
      case '/sdapi/v1/sd-vae': return json([{ model_name: 'vaeX' }]);
      case '/sdapi/v1/samplers': return json([{ name: 'Euler a' }, { name: 'DPM++ 2M' }]);
      case '/sdapi/v1/schedulers': return json([{ name: 'karras', label: 'Karras' }]);
      case '/sdapi/v1/upscalers': return json([{ name: 'None' }, { name: 'ESRGAN_4x' }]);
      case '/sdapi/v1/latent-upscale-modes': return json([{ name: 'Latent' }]);
      case '/sdapi/v1/options': return json({ sd_model_checkpoint: 'modelA.safetensors [abc]' });
      case '/sdapi/v1/txt2img':
      case '/sdapi/v1/img2img': {
        const n = JSON.parse(body).n_iter || 1;
        return json({ images: Array.from({ length: n }, () => PNG_B64), info: JSON.stringify({ all_seeds: Array.from({ length: n }, (_, i) => 100 + i) }) });
      }
      case '/sdapi/v1/progress': return json({ progress: 0.5, eta_relative: 3, state: { sampling_step: 10, sampling_steps: 20, job: 'job1' }, current_image: PNG_B64 });
      case '/sdapi/v1/interrupt': return json({});
      case '/rembg': return json({ image: PNG_B64 });
      default: return json({ detail: 'Not Found' }, 404);
    }
  });
});
await new Promise((r) => fake.listen(0, r));
const SD = `http://127.0.0.1:${fake.address().port}`;

const { createApp } = await import('../index.js');
const { placeholderPng } = await import('../png.js');
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
const last = (url) => [...hits].reverse().find((h) => h.url.startsWith(url));

test.after(() => {
  app.close();
  fake.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('estudio: requiere sesión y tiene valores por defecto', async () => {
  assert.equal((await call('GET', '/studio')).status, 401);
  assert.equal((await call('POST', '/auth/login', { username: 'admin', password: 'Admin' })).status, 200);
  const cfg = (await call('GET', '/studio')).json;
  assert.equal(cfg.connection.baseUrl, 'http://127.0.0.1:7860');
  assert.equal(cfg.profiles.character.width, 512);
  assert.equal(cfg.profiles.background.width, 768);
  assert.equal(cfg.profiles.expression.inpaint.fill, 'original');
  assert.equal(cfg.expressionPrompts.joy, cfg.defaults.expressionPrompts.joy);
  assert.equal(Object.keys(cfg.expressionPrompts).length, 28);
});

test('estudio: guarda la conexión sin devolver la contraseña y valida rangos', async () => {
  const put = await call('PUT', '/studio', {
    connection: { baseUrl: `${SD}/sdapi/v1/`, user: 'ana', pass: 'secreto-123' },
    model: { checkpoint: 'modelB.ckpt [def]', clipSkip: 99 },
    profiles: { character: { width: 99999, steps: 0, cfg: 'x', sampler: 'DPM++ 2M', prompt: 'red hair, 1girl', hires: { enabled: true, scale: 9 } }, expression: { inpaint: { fill: 'nope', denoise: 5, onlyMasked: false } } },
  });
  assert.equal(put.status, 200);
  const c = put.json;
  assert.equal(c.connection.baseUrl, SD);
  assert.equal(c.connection.hasPass, true);
  assert.ok(!JSON.stringify(c).includes('secreto-123'), 'la contraseña no vuelve al navegador');
  assert.equal(c.model.clipSkip, 12);
  assert.equal(c.profiles.character.width, 2048);
  assert.equal(c.profiles.character.steps, 1);
  assert.equal(c.profiles.character.cfg, 7, 'valor no numérico → el de fábrica');
  assert.equal(c.profiles.character.hires.scale, 4);
  assert.equal(c.profiles.expression.inpaint.fill, 'original');
  assert.equal(c.profiles.expression.inpaint.denoise, 1);
  assert.equal(c.profiles.expression.inpaint.onlyMasked, false);
  assert.equal(c.profiles.background.height, 448, 'los demás perfiles no cambian');
  const onDisk = JSON.parse(fs.readFileSync(path.join(tmp, 'studio', 'config.json'), 'utf8'));
  assert.equal(onDisk.connection.pass, 'secreto-123');
  assert.equal((await call('PUT', '/studio', { connection: { baseUrl: 'ftp://x' } })).status, 400);
  assert.equal((await call('PUT', '/studio', { connection: { baseUrl: '' } })).json.ready, false);
  await call('PUT', '/studio', { connection: { baseUrl: SD } });
  assert.equal((await call('PUT', '/studio', { expressionPrompts: { joy: 'giggling' } })).json.expressionPrompts.joy, 'giggling');
  assert.equal((await call('PUT', '/studio', { expressionPrompts: { joy: '' } })).json.expressionPrompts.joy, c.defaults.expressionPrompts.joy);
});

test('estudio: prueba de conexión y listas de opciones', async () => {
  const ok = await call('POST', '/studio/test', {});
  assert.equal(ok.status, 200);
  assert.equal(ok.json.models, 2);
  assert.equal(authSeen, `Basic ${Buffer.from('ana:secreto-123').toString('base64')}`);
  const opts = (await call('GET', '/studio/options')).json;
  assert.deepEqual(opts.models, ['modelA.safetensors [abc]', 'modelB.ckpt [def]']);
  assert.deepEqual(opts.vaes, ['vaeX']);
  assert.deepEqual(opts.samplers, ['Euler a', 'DPM++ 2M']);
  assert.deepEqual(opts.schedulers, ['Karras']);
  assert.deepEqual(opts.upscalers, ['Latent', 'ESRGAN_4x']);
  assert.equal(opts.current, 'modelA.safetensors [abc]');

  missing = new Set(['/sdapi/v1/samplers', '/sdapi/v1/schedulers']);
  const partial = (await call('GET', '/studio/options')).json;
  assert.ok(partial.samplers.includes('Euler a') && partial.samplers.length > 2, 'sin lista de muestreadores se usan los habituales');
  missing = new Set(['/sdapi/v1/sd-models']);
  const broken = await call('POST', '/studio/test', {});
  assert.equal(broken.status, 502);
  assert.match(broken.json.error, /--api/);
  assert.equal(broken.json.code, 'STUDIO_NO_API');
  missing = new Set();
  const dead = await call('POST', '/studio/test', { baseUrl: 'http://127.0.0.1:1' });
  assert.equal(dead.status, 502);
  assert.equal(dead.json.code, 'STUDIO_UNREACHABLE');
  assert.equal((await call('POST', '/studio/test', { baseUrl: 'nada://' })).status, 400);
});

test('estudio: genera personajes (txt2img) combinando perfil, personaje y petición', async () => {
  await call('POST', '/characters', { data: { name: 'Luna', description: 'maga', first_mes: 'hola' }, image: `data:image/png;base64,${placeholderPng('L', 8, 8).toString('base64')}` });
  const defaults = (await call('GET', '/studio/characters/Luna')).json;
  assert.equal(defaults.prompt, '');
  assert.ok(defaults.faceRegion.cx > 0);
  assert.equal((await call('GET', '/studio/characters/Nadie')).status, 404);
  const saved = await call('PUT', '/studio/characters/Luna', { prompt: 'blue hair, big eyes, RED HAIR', negative: 'extra arms', faceRegion: { cx: 2, ry: 0 } });
  assert.equal(saved.json.faceRegion.cx, 1);
  assert.equal(saved.json.faceRegion.ry, 0.02);
  assert.equal(saved.json.faceRegion.cy, 0.24, 'lo que no se envía se conserva');

  const gen = await call('POST', '/studio/generate', { kind: 'character', characterId: 'Luna', prompt: 'smiling, red hair', overrides: { batchCount: 3, seed: 7, width: 640 } });
  assert.equal(gen.status, 200);
  assert.equal(gen.json.images.length, 3);
  assert.deepEqual(gen.json.images.map((i) => i.seed), [100, 101, 102]);
  assert.equal(gen.json.images[0].data, PNG_B64);
  const sent = last('/sdapi/v1/txt2img').body;
  assert.equal(sent.prompt, 'red hair, 1girl, blue hair, big eyes, smiling', 'perfil + personaje + petición, sin repetir etiquetas');
  assert.ok(sent.negative_prompt.endsWith('extra arms'));
  assert.equal(sent.width, 640);
  assert.equal(sent.height, 768);
  assert.equal(sent.seed, 7);
  assert.equal(sent.n_iter, 3);
  assert.equal(sent.sampler_name, 'DPM++ 2M');
  assert.equal(sent.enable_hr, true);
  assert.equal(sent.hr_scale, 4);
  assert.equal(sent.override_settings.sd_model_checkpoint, 'modelB.ckpt [def]');
  assert.equal(sent.override_settings.CLIP_stop_at_last_layers, 12);
  assert.equal(sent.save_images, false);

  const bg = await call('POST', '/studio/generate', { kind: 'background', prompt: 'castle, night' });
  assert.equal(bg.status, 200);
  const bgSent = last('/sdapi/v1/txt2img').body;
  assert.equal(bgSent.width, 768);
  assert.equal(bgSent.enable_hr, false);
  assert.ok(bgSent.prompt.includes('scenery') && bgSent.prompt.endsWith('castle, night'));
  assert.equal((await call('POST', '/studio/generate', { kind: 'expression', prompt: 'x' })).status, 400);
  await call('PUT', '/studio', { profiles: { background: { prompt: '' } } });
  assert.equal((await call('POST', '/studio/generate', { kind: 'background' })).status, 400, 'sin ningún prompt');
});

test('estudio: inpaint de expresiones con máscara', async () => {
  const img = `data:image/png;base64,${PNG_B64}`;
  const out = await call('POST', '/studio/inpaint', {
    image: img,
    mask: PNG_B64,
    characterId: 'Luna',
    expression: 'joy',
    prompt: 'happy, big smile',
    width: 701,
    height: 1100,
    overrides: { inpaint: { denoise: 0.4, maskBlur: 12, fill: 'noise' } },
  });
  assert.equal(out.status, 200);
  assert.equal(out.json.expression, 'joy');
  const sent = last('/sdapi/v1/img2img').body;
  assert.deepEqual(sent.init_images, [PNG_B64], 'el prefijo data: se quita');
  assert.equal(sent.mask, PNG_B64);
  assert.equal(sent.denoising_strength, 0.4);
  assert.equal(sent.mask_blur, 12);
  assert.equal(sent.inpainting_fill, 2);
  assert.equal(sent.inpaint_full_res, false, 'se guardó onlyMasked=false en la prueba de configuración');
  assert.equal(sent.width, 704, 'tamaño de la imagen redondeado a múltiplos de 8');
  assert.equal(sent.height, 1104);
  assert.ok(sent.prompt.includes('blue hair') && sent.prompt.endsWith('happy, big smile'));
  assert.equal(sent.include_init_images, false);

  await call('PUT', '/studio', { profiles: { expression: { inpaint: { onlyMasked: true, fill: 'original' } } } });
  await call('POST', '/studio/inpaint', { image: PNG_B64, mask: PNG_B64, prompt: 'sad' });
  const full = last('/sdapi/v1/img2img').body;
  assert.equal(full.inpaint_full_res, true);
  assert.equal(full.inpainting_fill, 1);
  assert.equal(full.width, 512, 'recorte a la resolución del perfil');

  const bad = (body) => call('POST', '/studio/inpaint', { prompt: 'x', ...body }).then((r) => r.status);
  assert.equal(await bad({ image: 'no es base64!', mask: PNG_B64 }), 400);
  assert.equal(await bad({ image: PNG_B64 }), 400);
  assert.equal(await bad({ image: PNG_B64, mask: PNG_B64, expression: '../x' }), 400);
});

test('estudio: quitar fondo (rembg), progreso e interrupción', async () => {
  const rm = await call('POST', '/studio/rembg', { image: `data:image/png;base64,${PNG_B64}`, model: 'u2net' });
  assert.equal(rm.json.image, PNG_B64);
  const sent = last('/rembg').body;
  assert.equal(sent.input_image, PNG_B64);
  assert.equal(sent.model, 'u2net');
  assert.equal((await call('POST', '/studio/rembg', {})).status, 400);
  missing = new Set(['/rembg']);
  const none = await call('POST', '/studio/rembg', { image: PNG_B64 });
  assert.equal(none.json.code, 'STUDIO_NO_REMBG');
  missing = new Set();

  const p = (await call('GET', '/studio/progress')).json;
  assert.equal(p.progress, 0.5);
  assert.equal(p.step, 10);
  assert.equal(p.steps, 20);
  assert.equal(p.preview, '');
  assert.ok(last('/sdapi/v1/progress').url.includes('skip_current_image=true'));
  assert.equal((await call('GET', '/studio/progress?preview=1')).json.preview, PNG_B64);
  assert.equal((await call('POST', '/studio/interrupt')).json.ok, true);
});

test('estudio: favoritos, cascada al borrar el personaje y asistente de prompts', async () => {
  assert.deepEqual((await call('POST', '/studio/favorites', { model: 'modelA' })).json.favorites, ['modelA']);
  assert.deepEqual((await call('POST', '/studio/favorites', { model: 'modelA' })).json.favorites, []);
  assert.ok(fs.existsSync(path.join(tmp, 'studio', 'characters', 'Luna.json')));
  assert.equal((await call('DELETE', '/characters/Luna')).status, 204);
  assert.ok(!fs.existsSync(path.join(tmp, 'studio', 'characters', 'Luna.json')));
  // sin asistente configurado los campos nuevos existen pero piden configuración
  const res = await call('POST', '/assistant/generate', { field: 'sd_character', mode: 'generate', context: { name: 'Luna' } });
  assert.equal(res.status, 400);
  assert.equal(res.json.code, 'ASSISTANT_NOT_READY');
  const bad = await call('POST', '/assistant/generate', { field: 'sd_nope', mode: 'generate' });
  assert.equal(bad.status, 400);

  const { buildFieldMessages, buildImageMessages } = await import('../assistant.js');
  const prompts = { system: 'SISTEMA DE ESCRITURA', image: 'DESCRIBE' };
  const field = buildFieldMessages({ prompts, field: 'sd_character', mode: 'generate', text: '', instructions: '', context: { name: 'Luna', style: 'masterpiece, best quality', description: 'Una maga de pelo azul' } });
  assert.ok(field[0].content.includes('Stable Diffusion') && !field[0].content.includes('SISTEMA DE ESCRITURA'), 'los prompts de imagen usan su propio mensaje de sistema');
  assert.ok(field[1].content.includes('masterpiece, best quality') && field[1].content.includes('pelo azul') && field[1].content.includes('etiquetas'));
  const plain = buildFieldMessages({ prompts, field: 'description', mode: 'generate', text: '', instructions: '', context: {} });
  assert.equal(plain[0].content, 'SISTEMA DE ESCRITURA');
  const sd = buildImageMessages({ prompts, image: 'data:image/png;base64,AAAA', name: 'Luna', instructions: '', purpose: 'sd' });
  assert.ok(sd[0].content.includes('Stable Diffusion'));
  assert.ok(sd[1].content[0].text.includes('Stable Diffusion') && !sd[1].content[0].text.includes('DESCRIBE'));
  assert.equal(buildImageMessages({ prompts, image: 'data:image/png;base64,AAAA', name: '', instructions: '' })[1].content[0].text, 'DESCRIBE');
});
