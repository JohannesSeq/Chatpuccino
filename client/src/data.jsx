import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api.js';
import { useT } from './i18n.jsx';
import { applyAppearance, cacheAppearance, loadCachedAppearance, withDefaults } from './theme.js';

const Ctx = createContext(null);
export const useData = () => useContext(Ctx);

const LOADERS = {
  settings: api.settings,
  characters: api.characters,
  personas: api.personas,
  groups: api.groups,
  lorebooks: api.lorebooks,
  chats: api.chats,
  appearance: api.appearance,
  // Modo Novela
  worlds: api.worlds,
  stats: api.stats,
  backgrounds: api.backgrounds,
};

export function DataProvider({ children }) {
  const [state, setState] = useState({ settings: null, characters: [], personas: [], groups: [], lorebooks: [], chats: [], appearance: loadCachedAppearance(), worlds: [], stats: [], backgrounds: [] });
  const [ready, setReady] = useState(false);
  const [toasts, setToasts] = useState([]);
  const toastId = useRef(0);
  const { setPreference } = useT();

  // La apariencia guardada en el servidor manda; la copia local solo evita el parpadeo al abrir.
  useEffect(() => {
    applyAppearance(state.appearance);
    cacheAppearance(state.appearance);
    setPreference(state.appearance.language);
  }, [state.appearance, setPreference]);

  const toast = useCallback((message, kind = 'info') => {
    const id = ++toastId.current;
    setToasts((t) => [...t, { id, message, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 6000 : 3000);
  }, []);

  const refresh = useCallback(
    async (...keys) => {
      const list = keys.length ? keys : Object.keys(LOADERS);
      const results = await Promise.allSettled(list.map((k) => LOADERS[k]()));
      setState((prev) => {
        const next = { ...prev };
        results.forEach((r, i) => {
          if (r.status === 'fulfilled') next[list[i]] = r.value;
        });
        return next;
      });
      const failed = results.find((r) => r.status === 'rejected');
      if (failed) toast(failed.reason.message, 'error');
    },
    [toast],
  );

  useEffect(() => {
    refresh().then(() => setReady(true));
  }, [refresh]);

  const setAppearance = useCallback(
    (update) => setState((s) => ({ ...s, appearance: withDefaults(typeof update === 'function' ? update(s.appearance) : update) })),
    [],
  );

  const value = useMemo(() => {
    const charById = Object.fromEntries(state.characters.map((c) => [c.id, c]));
    const groupById = Object.fromEntries(state.groups.map((g) => [g.id, g]));
    return { ...state, charById, groupById, ready, refresh, toast, setAppearance };
  }, [state, ready, refresh, toast, setAppearance]);

  return (
    <Ctx.Provider value={value}>
      {children}
      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            {t.message}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
