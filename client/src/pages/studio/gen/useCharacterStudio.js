import { useCallback, useEffect, useState } from 'react';
import { api } from '../../../api.js';

/** Datos de Stable Diffusion del personaje (prompt, negativo) y los de su tarjeta (para dar contexto al asistente). */
export function useCharacterStudio(id) {
  const [status, setStatus] = useState({ state: 'loading', error: '' });
  const [saved, setSaved] = useState({ prompt: '', negative: '' });
  const [prompt, setPrompt] = useState('');
  const [negative, setNegative] = useState('');
  const [card, setCard] = useState(null);
  const [saving, setSaving] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    setStatus({ state: 'loading', error: '' });
    Promise.all([api.studioCharacter(id), api.character(id).catch(() => null)])
      .then(([studio, full]) => {
        if (!live) return;
        setSaved({ prompt: studio.prompt, negative: studio.negative });
        setPrompt(studio.prompt);
        setNegative(studio.negative);
        setCard(full?.data || null);
        setStatus({ state: 'ready', error: '' });
      })
      .catch((e) => live && setStatus({ state: 'error', error: e.message }));
    return () => {
      live = false;
    };
  }, [id, attempt]);

  const dirty = status.state === 'ready' && (prompt !== saved.prompt || negative !== saved.negative);

  const save = useCallback(async () => {
    setSaving(true);
    try {
      const r = await api.saveStudioCharacter(id, { prompt, negative });
      setSaved({ prompt: r.prompt, negative: r.negative });
      return r;
    } finally {
      setSaving(false);
    }
  }, [id, prompt, negative]);

  const revert = useCallback(() => {
    setPrompt(saved.prompt);
    setNegative(saved.negative);
  }, [saved]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  return { status, prompt, setPrompt, negative, setNegative, card, dirty, saving, save, revert, retry };
}
