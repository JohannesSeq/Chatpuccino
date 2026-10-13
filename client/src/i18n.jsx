import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { resolve } from '../../locales/translate.js';

// Todos los idiomas de /locales/*.json se incluyen solos: añadir un idioma es añadir su archivo JSON.
const modules = import.meta.glob('../../locales/*.json', { eager: true });
const catalogs = {};
for (const [file, mod] of Object.entries(modules)) {
  const catalog = mod.default || mod;
  catalogs[catalog._meta?.code || file.split('/').pop().replace(/\.json$/, '')] = catalog;
}

export const DEFAULT_LANG = 'es';
const PREF_KEY = 'chatpuccino.lang';

export const languages = Object.entries(catalogs).map(([code, c]) => ({ code, name: c._meta?.name || code }));
export const getCatalog = (code) => catalogs[code];

/** Idioma a usar para una preferencia: un código concreto, o 'auto' = el del navegador. */
export function resolveLang(preference) {
  if (preference && preference !== 'auto' && catalogs[preference]) return preference;
  for (const tag of navigator.languages || [navigator.language]) {
    const base = String(tag || '').toLowerCase().split('-')[0];
    if (catalogs[base]) return base;
  }
  return DEFAULT_LANG;
}

function storedPreference() {
  try {
    return localStorage.getItem(PREF_KEY) || 'auto';
  } catch {
    return 'auto';
  }
}

let preference = storedPreference();
let lang = resolveLang(preference);

/** Idioma activo (para cabeceras, formatos de fecha, etc.). */
export const currentLang = () => lang;
/** Código de `Intl` para fechas y números del idioma activo. */
export const currentLocale = () => catalogs[lang]?._meta?.dateLocale || lang;

/** Traduce fuera de componentes (en eventos o utilidades). En componentes usa `useT()` para que se actualicen al cambiar de idioma. */
export const t = (key, params) => resolve(catalogs, [...new Set([lang, DEFAULT_LANG])], key, params);

const Ctx = createContext(null);

export function I18nProvider({ children }) {
  const [state, setState] = useState({ preference, lang });

  const setPreference = useCallback((next) => {
    const value = next && (next === 'auto' || catalogs[next]) ? next : 'auto';
    preference = value;
    lang = resolveLang(value);
    try {
      localStorage.setItem(PREF_KEY, value);
    } catch {
      /* sin almacenamiento local */
    }
    document.documentElement.lang = lang;
    setState((s) => (s.preference === value && s.lang === lang ? s : { preference: value, lang }));
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, []);

  // `t` cambia de identidad con el idioma: lo que dependa de él se recalcula.
  const value = useMemo(
    () => ({ lang: state.lang, preference: state.preference, setPreference, languages, t: (key, params) => resolve(catalogs, [...new Set([state.lang, DEFAULT_LANG])], key, params) }),
    [state, setPreference],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** `{ t, lang, preference, setPreference, languages }` — `t(clave, { parámetros })`. */
export const useT = () => useContext(Ctx);
