import { AsyncLocalStorage } from 'node:async_hooks';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './config.js';
import { resolve } from '../locales/translate.js';

// Textos del servidor (errores, títulos…) en el idioma que pide el cliente en la cabecera X-Lang.
export const DEFAULT_LANG = 'es';
const DIR = path.join(ROOT, 'locales');

const catalogs = {};
for (const file of fs.readdirSync(DIR)) {
  if (!file.endsWith('.json')) continue;
  try {
    const catalog = JSON.parse(fs.readFileSync(path.join(DIR, file), 'utf8').replace(/^\uFEFF/, ''));
    catalogs[catalog._meta?.code || file.replace(/\.json$/, '')] = catalog;
  } catch (e) {
    console.error(`No se pudo leer el idioma ${file}:`, e.message);
  }
}

const store = new AsyncLocalStorage();

/** Idiomas disponibles: [{ code, name }]. */
export const languages = () => Object.entries(catalogs).map(([code, c]) => ({ code, name: c._meta?.name || code }));
export const hasLanguage = (code) => Object.hasOwn(catalogs, code);
export const currentLang = () => store.getStore()?.lang || DEFAULT_LANG;

export function langMiddleware(req, _res, next) {
  const requested = String(req.get('x-lang') || '');
  store.run({ lang: hasLanguage(requested) ? requested : DEFAULT_LANG }, next);
}

const chain = (lang) => [...new Set([lang, DEFAULT_LANG])];

/** Traduce `key` en el idioma de la petición en curso. */
export const t = (key, params) => resolve(catalogs, chain(currentLang()), key, params);
/** Traduce `key` en un idioma concreto. */
export const tIn = (lang, key, params) => resolve(catalogs, chain(lang), key, params);
