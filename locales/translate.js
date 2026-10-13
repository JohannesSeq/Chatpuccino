// Búsqueda, formato y plurales de los textos de `locales/*.json`. Lo usan el cliente y el servidor.

/** Texto en `catalog` para la clave con puntos (`chat.send`), o undefined si no existe. */
export function lookup(catalog, key) {
  let node = catalog;
  for (const part of String(key).split('.')) {
    if (node === null || typeof node !== 'object') return undefined;
    node = node[part];
  }
  return typeof node === 'string' ? node : undefined;
}

/** Sustituye `{nombre}` por params.nombre (los marcadores sin valor se dejan tal cual). */
export function interpolate(text, params) {
  return params ? text.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match)) : text;
}

/**
 * Busca `key` en los idiomas de `langs` por orden (el primero es el actual, luego los de respaldo).
 * Con params.count numérico prueba primero `key_one` (count === 1) o `key_other`.
 * Si no existe en ninguno devuelve la propia clave.
 */
export function resolve(catalogs, langs, key, params) {
  const count = params?.count;
  for (const lang of langs) {
    const catalog = catalogs[lang];
    if (!catalog) continue;
    if (typeof count === 'number') {
      const plural = lookup(catalog, `${key}_${count === 1 ? 'one' : 'other'}`);
      if (plural !== undefined) return interpolate(plural, params);
    }
    const text = lookup(catalog, key);
    if (text !== undefined) return interpolate(text, params);
  }
  return key;
}
