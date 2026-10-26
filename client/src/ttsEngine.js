import { ttsSpeak } from './api.js';
import { chunkText } from '../../shared/tts.js';
import { currentLang } from './i18n.jsx';

// Motor de narración del navegador: reproduce una cola de pasos [{ voice, text }] con las voces del sistema o con el audio
// que sintetiza el servidor (OpenAI-compatible / ElevenLabs), pidiendo el siguiente trozo mientras suena el actual.

const SILENT_WAV = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';

export const supportsBrowserTts = () => typeof window !== 'undefined' && 'speechSynthesis' in window && typeof window.SpeechSynthesisUtterance !== 'undefined';

const fail = (code) => Object.assign(new Error(code), { code });

/** Voz concreta (id del proveedor, '' = la predeterminada) para una clave: 'narrator', 'user' o 'char:<id>'. */
export function resolveVoice(cfg, key) {
  const map = cfg.voices?.[cfg.provider] || {};
  let own = '';
  if (key === 'narrator') own = map.narrator;
  else if (key === 'user') own = map.user;
  else if (String(key).startsWith('char:')) own = map.chars?.[String(key).slice(5)];
  return own || map.default || '';
}

export function createEngine({ getConfig, onState, onError }) {
  let token = 0;
  let audio = null;
  let ctl = null;
  let finishStep = null;
  let unlocked = false;
  let running = false;
  const pending = []; // narraciones en cola (respuestas que llegan mientras suena la anterior)
  let utterance = null; // referencia viva: si el recolector la libera, Chrome deja de avisar de que terminó

  const getAudio = () => {
    if (!audio) audio = new Audio();
    return audio;
  };

  function stop() {
    token += 1;
    running = false;
    pending.length = 0;
    ctl?.abort();
    ctl = null;
    if (supportsBrowserTts()) window.speechSynthesis.cancel();
    if (audio) {
      audio.onended = null;
      audio.onerror = null;
      audio.pause();
      audio.removeAttribute('src');
    }
    const end = finishStep;
    finishStep = null;
    end?.();
    onState({ id: null, status: 'idle' });
  }

  // Los navegadores móviles solo dejan reproducir tras un gesto: se «prepara» el audio en la primera pulsación.
  function unlock() {
    if (unlocked) return;
    unlocked = true;
    try {
      const a = getAudio();
      a.src = SILENT_WAV;
      a.play().catch(() => {});
    } catch {
      /* sin audio */
    }
    try {
      if (supportsBrowserTts()) window.speechSynthesis.speak(new window.SpeechSynthesisUtterance(''));
    } catch {
      /* sin síntesis */
    }
  }

  function speakBrowser(item, cfg, my, id) {
    return new Promise((resolve) => {
      const u = new window.SpeechSynthesisUtterance(item.text);
      const voice = item.voice ? window.speechSynthesis.getVoices().find((v) => v.voiceURI === item.voice) : null;
      if (voice) {
        u.voice = voice;
        u.lang = voice.lang;
      } else u.lang = currentLang();
      u.rate = cfg.browser.rate;
      u.pitch = cfg.browser.pitch;
      u.volume = cfg.volume / 100;
      let done = false;
      const end = () => {
        if (done) return;
        done = true;
        if (finishStep === end) finishStep = null;
        resolve();
      };
      u.onstart = () => my === token && onState({ id, status: 'playing' });
      u.onend = end;
      u.onerror = end;
      finishStep = end;
      utterance = u;
      window.speechSynthesis.speak(u);
    });
  }

  function playUrl(url, cfg, my, id) {
    return new Promise((resolve, reject) => {
      const a = getAudio();
      let done = false;
      const end = (err) => {
        if (done) return;
        done = true;
        a.onended = null;
        a.onerror = null;
        if (finishStep === end) finishStep = null;
        if (err) reject(err);
        else resolve();
      };
      a.onended = () => end();
      a.onerror = () => end(my === token ? fail('playback') : null);
      finishStep = end;
      a.volume = cfg.volume / 100;
      a.src = url;
      a.play().then(
        () => my === token && onState({ id, status: 'playing' }),
        (e) => end(my === token && e?.name === 'NotAllowedError' ? fail('blocked') : null),
      );
    });
  }

  async function run(steps, id) {
    const cfg = getConfig();
    if (!cfg || !steps?.length) return;
    const my = ++token;
    const max = cfg.provider === 'browser' ? 220 : 900;
    const queue = steps.flatMap((s) => {
      const voice = resolveVoice(cfg, s.voice);
      return chunkText(s.text, max).map((text) => ({ text, voice }));
    });
    if (!queue.length) return;
    running = true;
    onState({ id, status: 'loading' });
    ctl = new AbortController();
    const { signal } = ctl;
    try {
      if (cfg.provider === 'browser') {
        if (!supportsBrowserTts()) throw fail('unsupported');
        for (const item of queue) {
          if (my !== token) return;
          await speakBrowser(item, cfg, my, id);
        }
      } else {
        const fetchAt = (i) => {
          const p = ttsSpeak({ provider: cfg.provider, text: queue[i].text, voice: queue[i].voice }, signal).then((blob) => URL.createObjectURL(blob));
          p.catch(() => {});
          return p;
        };
        let next = fetchAt(0);
        for (let i = 0; i < queue.length; i += 1) {
          const url = await next;
          if (my !== token) {
            URL.revokeObjectURL(url);
            return;
          }
          if (i + 1 < queue.length) next = fetchAt(i + 1);
          try {
            await playUrl(url, cfg, my, id);
          } finally {
            URL.revokeObjectURL(url);
          }
          if (my !== token) return;
        }
      }
    } catch (e) {
      if (my === token && e?.name !== 'AbortError') onError(e);
    } finally {
      if (my === token) {
        ctl = null;
        running = false;
        onState({ id: null, status: 'idle' });
        const nextJob = pending.shift();
        if (nextJob) run(nextJob.steps, nextJob.id);
      }
    }
  }

  /** Reproduce `steps` ([{ voice, text }]) cortando lo que sonara. `id` identifica lo que suena. */
  function play(steps, id) {
    stop();
    return run(steps, id);
  }

  /** Como `play`, pero si ya suena algo espera a que termine en vez de cortarlo. */
  function enqueue(steps, id) {
    if (!steps?.length) return Promise.resolve();
    if (running) {
      pending.push({ steps, id });
      return Promise.resolve();
    }
    return run(steps, id);
  }

  return { play, enqueue, stop, unlock };
}
