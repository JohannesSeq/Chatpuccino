// Comprueba los idiomas de /locales: mismas claves y marcadores en todos, y que las claves usadas en el código existan.
//   node scripts/check-i18n.mjs            comprueba (incluye los fragmentos de locales/_parts/)
//   node scripts/check-i18n.mjs --write    fusiona locales/_parts/ en los idiomas y borra los fragmentos
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOCALES = path.join(ROOT, 'locales');
const PARTS = path.join(LOCALES, '_parts');
const write = process.argv.includes('--write');
const BASE = 'es';

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
const errors = [];
const warnings = [];

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

// Fusión profunda; si dos fragmentos definen la misma clave con distinto texto es un error.
function merge(target, source, trail, origin) {
  for (const [k, v] of Object.entries(source)) {
    const here = [...trail, k].join('.');
    if (isObj(v)) {
      if (target[k] !== undefined && !isObj(target[k])) errors.push(`${origin}: «${here}» es un grupo pero ya existe como texto`);
      else merge((target[k] ??= {}), v, [...trail, k], origin);
    } else if (typeof v === 'string') {
      if (isObj(target[k])) errors.push(`${origin}: «${here}» es un texto pero ya existe como grupo`);
      else if (target[k] !== undefined && target[k] !== v) errors.push(`${origin}: «${here}» está definida dos veces con textos distintos`);
      else target[k] = v;
    } else errors.push(`${origin}: «${here}» debe ser un texto o un grupo`);
  }
  return target;
}

function sorted(obj) {
  const out = {};
  const keys = Object.keys(obj).sort((a, b) => (a === '_meta' ? -1 : b === '_meta' ? 1 : a.localeCompare(b)));
  for (const k of keys) out[k] = isObj(obj[k]) ? sorted(obj[k]) : obj[k];
  return out;
}

const flatten = (obj, trail = []) => Object.entries(obj).flatMap(([k, v]) => (isObj(v) ? flatten(v, [...trail, k]) : [[[...trail, k].join('.'), v]]));
const placeholders = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
const baseKey = (key) => key.replace(/_(one|other)$/, '');

// ---- Cargar idiomas y fragmentos
const langFiles = fs.readdirSync(LOCALES).filter((f) => f.endsWith('.json'));
const catalogs = {};
for (const f of langFiles) catalogs[f.replace(/\.json$/, '')] = readJson(path.join(LOCALES, f));

const partFiles = fs.existsSync(PARTS) ? fs.readdirSync(PARTS).filter((f) => f.endsWith('.json')) : [];
for (const f of partFiles) {
  const m = /^(.+)\.([a-z]{2,3}(?:-[A-Za-z]+)?)\.json$/.exec(f);
  if (!m || !catalogs[m[2]]) {
    errors.push(`_parts/${f}: el nombre debe ser <área>.<idioma>.json con un idioma existente`);
    continue;
  }
  try {
    merge(catalogs[m[2]], readJson(path.join(PARTS, f)), [], `_parts/${f}`);
  } catch (e) {
    errors.push(`_parts/${f}: JSON no válido (${e.message})`);
  }
}

// ---- Paridad entre idiomas
const flat = Object.fromEntries(Object.entries(catalogs).map(([lang, c]) => [lang, new Map(flatten(c).filter(([k]) => !k.startsWith('_meta.')))]));
for (const lang of Object.keys(catalogs)) {
  const meta = catalogs[lang]._meta;
  if (!meta?.code || !meta?.name || !meta?.dateLocale) errors.push(`${lang}.json: falta _meta.code, _meta.name o _meta.dateLocale`);
  for (const [key, text] of flat[BASE] ?? []) {
    if (lang === BASE) continue;
    const other = flat[lang].get(key);
    if (other === undefined) errors.push(`${lang}: falta «${key}»`);
    else if (placeholders(other) !== placeholders(text)) errors.push(`${lang}: «${key}» tiene otros marcadores ({…}) que en ${BASE}`);
  }
  for (const key of flat[lang].keys()) if (!flat[BASE]?.has(key)) errors.push(`${lang}: «${key}» no existe en ${BASE}`);
}

// ---- Claves usadas en el código
const SOURCES = ['client/src', 'server'].map((d) => path.join(ROOT, d));
const files = [];
for (const d of SOURCES) {
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name !== 'node_modules' && e.name !== 'test') walk(p);
      } else if (/\.(jsx?|mjs)$/.test(e.name)) files.push(p);
    }
  })(d);
}

const used = new Map();
const dynamic = [];
const CALL = /(?<![\w.$])(?:t|tIn|translate)\(\s*(?:[a-z]+,\s*)?(['"`])((?:(?!\1).)*)\1/g;
for (const file of files) {
  const src = fs.readFileSync(file, 'utf8');
  for (const m of src.matchAll(CALL)) {
    const key = m[2];
    if (key.includes('${')) dynamic.push(`${path.relative(ROOT, file)}: ${key}`);
    else if (/^[\w-]+(\.[\w-]+)+$/.test(key)) used.set(key, (used.get(key) || new Set()).add(path.relative(ROOT, file)));
  }
}
for (const [key, where] of used) {
  const has = flat[BASE]?.has(key) || flat[BASE]?.has(`${key}_one`) || flat[BASE]?.has(`${key}_other`);
  if (!has) errors.push(`clave usada pero inexistente «${key}» (${[...where].join(', ')})`);
}
const usedBases = new Set([...used.keys()]);
const prefixes = dynamic.map((d) => d.split(': ')[1].split('${')[0]);
const unused = [...(flat[BASE]?.keys() ?? [])].map(baseKey).filter((k, i, a) => a.indexOf(k) === i).filter((k) => !usedBases.has(k) && !prefixes.some((p) => k.startsWith(p)));

// ---- Resultado
if (write && !errors.length) {
  for (const [lang, c] of Object.entries(catalogs)) fs.writeFileSync(path.join(LOCALES, `${lang}.json`), `${JSON.stringify(sorted(c), null, 2)}\n`);
  for (const f of partFiles) fs.rmSync(path.join(PARTS, f));
  console.log(`Fusionados ${partFiles.length} fragmentos.`);
}
if (process.argv.includes('--unused') && unused.length) warnings.push(`claves sin uso estático (pueden usarse de forma dinámica): ${unused.length}\n  ${unused.slice(0, 80).join('\n  ')}`);
for (const w of warnings) console.warn(`aviso: ${w}`);
if (errors.length) {
  console.error(`\n${errors.length} problema(s):\n${errors.map((e) => `  - ${e}`).join('\n')}`);
  process.exit(1);
}
const total = flat[BASE]?.size ?? 0;
console.log(`i18n OK: ${Object.keys(catalogs).join(', ')} · ${total} textos · ${used.size} claves usadas estáticamente · ${dynamic.length} dinámicas`);
