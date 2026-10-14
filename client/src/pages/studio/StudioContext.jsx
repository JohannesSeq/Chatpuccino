import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../api.js';

// Estado compartido del Estudio de imágenes: configuración del servidor, listas de opciones de Stable Diffusion,
// galerías de imágenes generadas (solo en memoria: son grandes) y la imagen base elegida para las expresiones.

const Ctx = createContext(null);
export const useStudio = () => useContext(Ctx);

const GALLERY_LIMIT = 40;
let counter = 0;
export const newImageId = () => `img-${Date.now().toString(36)}-${counter++}`;

export function StudioProvider({ children }) {
  const [config, setConfig] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [options, setOptions] = useState({ status: 'idle', data: null, error: '' });
  const [gallery, setGallery] = useState({ character: [], expression: [], background: [] });
  const [bases, setBases] = useState({});
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const reload = useCallback(async () => {
    try {
      const c = await api.studio();
      setConfig(c);
      setLoadError('');
      return c;
    } catch (e) {
      setLoadError(e.message);
      throw e;
    }
  }, []);

  useEffect(() => {
    reload().catch(() => {});
  }, [reload]);

  /** Guarda un parche de la configuración (conexión, modelo, perfiles…) y devuelve la configuración pública resultante. */
  const save = useCallback(async (patch) => {
    const c = await api.saveStudio(patch);
    setConfig(c);
    return c;
  }, []);

  /** Carga (o recarga) las listas de modelos, muestreadores y reescaladores del servidor de Stable Diffusion. */
  const loadOptions = useCallback(async (force = false) => {
    if (!force && optionsRef.current.status === 'ready') return optionsRef.current.data;
    setOptions((o) => ({ ...o, status: 'loading', error: '' }));
    try {
      const data = await api.studioOptions();
      setOptions({ status: 'ready', data, error: '' });
      return data;
    } catch (e) {
      setOptions({ status: 'error', data: null, error: e.message });
      return null;
    }
  }, []);

  const addImages = useCallback((kind, items) => {
    const stamped = items.map((it) => ({ id: newImageId(), kind, createdAt: Date.now(), ...it }));
    setGallery((g) => ({ ...g, [kind]: [...stamped, ...g[kind]].slice(0, GALLERY_LIMIT) }));
    return stamped;
  }, []);
  const removeImage = useCallback((kind, id) => setGallery((g) => ({ ...g, [kind]: g[kind].filter((i) => i.id !== id) })), []);
  const clearGallery = useCallback((kind, filter) => setGallery((g) => ({ ...g, [kind]: filter ? g[kind].filter((i) => !filter(i)) : [] })), []);

  /** Imagen base de un personaje para generar expresiones: { dataUrl, source: 'generated' | 'nobg' | 'upload' | … }. */
  const setBase = useCallback((charId, base) => setBases((b) => ({ ...b, [charId]: base })), []);
  const clearBase = useCallback((charId) => setBases((b) => {
    const { [charId]: _removed, ...rest } = b;
    return rest;
  }), []);

  const value = useMemo(
    () => ({ config, loadError, reload, save, options, loadOptions, gallery, addImages, removeImage, clearGallery, bases, setBase, clearBase }),
    [config, loadError, reload, save, options, loadOptions, gallery, addImages, removeImage, clearGallery, bases, setBase, clearBase],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/**
 * Ejecuta una generación mostrando su progreso (consulta /studio/progress cada ~1 s mientras dura).
 * `run(fn)`: fn(signal) → promesa; resuelve con su resultado o null si falla/cancela (el error queda en `error`).
 * `cancel()` aborta la petición y pide a Stable Diffusion que interrumpa la tarea.
 */
export function useGeneration() {
  const [state, setState] = useState({ running: false, progress: null, error: '', code: '' });
  const abortRef = useRef(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      abortRef.current?.abort();
    };
  }, []);

  const run = useCallback(async (fn) => {
    const ac = new AbortController();
    abortRef.current = ac;
    setState({ running: true, progress: null, error: '', code: '' });
    const poll = async () => {
      try {
        const p = await api.studioProgress();
        if (mounted.current && abortRef.current === ac) setState((s) => (s.running ? { ...s, progress: p } : s));
      } catch {
        /* el progreso es opcional */
      }
    };
    const timer = setInterval(poll, 1000);
    try {
      return await fn(ac.signal);
    } catch (e) {
      if (e.name !== 'AbortError' && mounted.current) setState((s) => ({ ...s, error: e.message, code: e.code || '' }));
      return null;
    } finally {
      clearInterval(timer);
      if (abortRef.current === ac) abortRef.current = null;
      if (mounted.current) setState((s) => ({ ...s, running: false, progress: null }));
    }
  }, []);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    api.studioInterrupt().catch(() => {});
  }, []);
  const clearError = useCallback(() => setState((s) => ({ ...s, error: '', code: '' })), []);

  return { ...state, run, cancel, clearError };
}
