import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api.js';
import { fillNames } from '../../shared/names.js';
import { narrationSteps } from '../../shared/tts.js';
import { useData } from './data.jsx';
import { currentLang, useT } from './i18n.jsx';
import { createEngine, supportsBrowserTts } from './ttsEngine.js';
import './styles/voice.css';

const Ctx = createContext(null);

/** Narración por voz: configuración, estado de la reproducción y acciones (`play`, `stop`, `stepsFor`…). */
export const useTts = () => useContext(Ctx);

export function TtsProvider({ children }) {
  const { toast } = useData();
  const { t } = useT();
  const [config, setConfig] = useState(null);
  const [state, setState] = useState({ id: null, status: 'idle' });
  const cfgRef = useRef(null);
  cfgRef.current = config;
  const tRef = useRef(t);
  tRef.current = t;

  const engine = useMemo(
    () =>
      createEngine({
        getConfig: () => cfgRef.current,
        onState: setState,
        onError: (e) => {
          const known = { blocked: 'tts.errors.blocked', unsupported: 'tts.errors.unsupported', playback: 'tts.errors.playback' }[e.code];
          toast(known ? tRef.current(known) : e.message, 'error');
        },
      }),
    [toast],
  );

  const reload = useCallback(
    () =>
      api
        .tts()
        .then(setConfig)
        .catch(() => {}),
    [],
  );
  useEffect(() => {
    reload();
    return () => engine.stop();
  }, [reload, engine]);

  const enabled = Boolean(config?.enabled);
  useEffect(() => {
    if (!enabled) return undefined;
    const unlock = () => engine.unlock();
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, [enabled, engine]);

  const update = useCallback(
    async (patch) => {
      try {
        const next = await api.saveTts(patch);
        setConfig(next);
        return next;
      } catch (e) {
        toast(e.message, 'error');
        return null;
      }
    },
    [toast],
  );

  /** Pasos de narración de un texto. `kind`: 'character' | 'user' | 'narrator'; `names` ({ user, char }) rellena {{user}} y {{char}}. */
  const stepsFor = useCallback((text, { kind = 'character', speakerKey = null, names = null, force = false, unquoted = null } = {}) => {
    const c = cfgRef.current;
    if (!c) return [];
    if (kind === 'user' && !c.narrateUser && !force) return [];
    return narrationSteps(names ? fillNames(text, names) : text, { kind, speakerKey, narrator: c.narrator, unquoted: unquoted || c.unquoted, skipCode: c.skipCode });
  }, []);

  const value = useMemo(
    () => ({
      config,
      enabled,
      // lee solo cada respuesta o línea nueva
      autoplay: enabled && Boolean(config?.autoplay),
      state,
      isActive: (id) => state.id === id,
      play: engine.play,
      enqueue: engine.enqueue,
      stop: engine.stop,
      stepsFor,
      update,
      reload,
    }),
    [config, enabled, state, engine, stepsFor, update, reload],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

const readVoices = () => (supportsBrowserTts() ? window.speechSynthesis.getVoices().map((v) => ({ id: v.voiceURI, name: v.name, lang: v.lang })) : []);

/** Voces instaladas en el sistema (las del idioma de la app primero). Chrome las carga de forma asíncrona. */
export function useBrowserVoices() {
  const [voices, setVoices] = useState(readVoices);
  useEffect(() => {
    if (!supportsBrowserTts()) return undefined;
    const on = () => setVoices(readVoices());
    on();
    window.speechSynthesis.addEventListener('voiceschanged', on);
    return () => window.speechSynthesis.removeEventListener('voiceschanged', on);
  }, []);
  return useMemo(() => {
    const lang = currentLang();
    const rank = (v) => (v.lang.toLowerCase().startsWith(lang) ? 0 : 1);
    return [...voices].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  }, [voices]);
}
