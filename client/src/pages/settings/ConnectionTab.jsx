import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../../api.js';
import { useData } from '../../data.jsx';
import { Field, SearchBox } from '../../components/ui.jsx';

const PARAMS = [
  ['temperature', 'Temperatura', 0, 2, 0.05],
  ['top_p', 'Top P', 0, 1, 0.01],
  ['top_k', 'Top K (0 = desactivado)', 0, 200, 1],
  ['min_p', 'Min P (0 = desactivado)', 0, 1, 0.01],
  ['frequency_penalty', 'Penalización de frecuencia', -2, 2, 0.05],
  ['presence_penalty', 'Penalización de presencia', -2, 2, 0.05],
  ['repetition_penalty', 'Penalización de repetición (1 = ninguna)', 0, 2, 0.05],
  ['max_tokens', 'Máx. tokens de respuesta', 16, 8192, 16],
  ['maxContext', 'Contexto máximo (tokens)', 1024, 2000000, 512],
];

const price = (perToken) => (perToken === 0 ? 'gratis' : `$${(perToken * 1e6).toFixed(2)}/M`);

export default function ConnectionTab() {
  const { settings, refresh, toast } = useData();
  const [keyInput, setKeyInput] = useState('');
  const [keyStatus, setKeyStatus] = useState(null);
  const [busy, setBusy] = useState(false);

  async function saveKey() {
    const key = keyInput.trim();
    if (!key) return;
    setBusy(true);
    setKeyStatus(null);
    try {
      const info = await api.testKey(key);
      await api.saveSettings({ apiKey: key });
      setKeyInput('');
      setKeyStatus({ ok: true, text: `Key válida y guardada${info.label ? ` (${info.label})` : ''}` });
      await refresh('settings');
    } catch (e) {
      setKeyStatus({ ok: false, text: `No se guardó: ${e.message}` });
    } finally {
      setBusy(false);
    }
  }

  async function testSaved() {
    setBusy(true);
    try {
      const info = await api.testKey('');
      setKeyStatus({ ok: true, text: `Conexión correcta${info.label ? ` (${info.label})` : ''}` });
    } catch (e) {
      setKeyStatus({ ok: false, text: e.message });
    } finally {
      setBusy(false);
    }
  }

  async function clearKey() {
    if (!window.confirm('¿Quitar la API key guardada?')) return;
    await api.saveSettings({ apiKey: '__clear__' });
    setKeyStatus(null);
    await refresh('settings');
  }

  return (
    <div className="stack">
      <section className="card">
        <h3>API de OpenRouter</h3>
        <p className="muted">
          Consigue tu key en{' '}
          <a href="https://openrouter.ai/keys" target="_blank" rel="noreferrer">
            openrouter.ai/keys
          </a>
          . Se guarda en el servidor y nunca se vuelve a enviar al navegador.
        </p>
        {settings.hasKey && (
          <p>
            Key guardada: <code>{settings.keyPreview}</code>
          </p>
        )}
        <Field label={settings.hasKey ? 'Reemplazar key' : 'API key'}>
          <input type="password" autoComplete="off" placeholder="sk-or-v1-…" value={keyInput} onChange={(e) => setKeyInput(e.target.value)} />
        </Field>
        <div className="btn-row">
          <button className="btn primary" disabled={busy || !keyInput.trim()} onClick={saveKey}>
            Probar y guardar
          </button>
          {settings.hasKey && (
            <>
              <button className="btn" disabled={busy} onClick={testSaved}>
                Probar conexión
              </button>
              <button className="btn danger" onClick={clearKey}>
                Quitar
              </button>
            </>
          )}
        </div>
        {keyStatus && <p className={keyStatus.ok ? 'ok' : 'err'}>{keyStatus.text}</p>}
      </section>

      <ModelPicker />
      <ParamsCard settings={settings} onSaved={() => refresh('settings')} toast={toast} />
    </div>
  );
}

function ModelPicker() {
  const { settings, refresh, toast } = useData();
  const [models, setModels] = useState(null);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [freeOnly, setFreeOnly] = useState(false);
  const [limit, setLimit] = useState(60);

  const load = () => {
    setError('');
    api.models().then(setModels).catch((e) => setError(e.message));
  };
  useEffect(load, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (models || []).filter((m) => (!q || m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q)) && (!freeOnly || (m.promptPrice === 0 && m.completionPrice === 0)));
  }, [models, query, freeOnly]);

  async function select(id) {
    try {
      await api.saveSettings({ model: id });
      await refresh('settings');
      toast('Modelo seleccionado');
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  return (
    <section className="card">
      <h3>Modelo</h3>
      <p>
        Actual: <strong>{settings.model || 'ninguno seleccionado'}</strong>
      </p>
      {error ? (
        <p className="err">
          {error}{' '}
          <button className="btn small" onClick={load}>
            Reintentar
          </button>
        </p>
      ) : !models ? (
        <p className="muted">Cargando modelos…</p>
      ) : (
        <>
          <SearchBox
            value={query}
            onChange={(v) => {
              setQuery(v);
              setLimit(60);
            }}
            placeholder={`Buscar entre ${models.length} modelos`}
          />
          <label className="check">
            <input type="checkbox" checked={freeOnly} onChange={(e) => setFreeOnly(e.target.checked)} /> Solo gratuitos
          </label>
          <ul className="rows model-list">
            {filtered.slice(0, limit).map((m) => (
              <li key={m.id} className={`row ${settings.model === m.id ? 'active' : ''}`}>
                <button className="row-main" onClick={() => select(m.id)}>
                  <div className="row-text">
                    <strong>{m.name}</strong>
                    <div className="row-sub">
                      {m.id} · {m.context ? `${Math.round(m.context / 1000)}K ctx` : '?'} · {price(m.promptPrice)} entrada · {price(m.completionPrice)} salida
                    </div>
                  </div>
                </button>
              </li>
            ))}
            {!filtered.length && <li className="empty small">Sin resultados</li>}
          </ul>
          {filtered.length > limit && (
            <button className="btn" onClick={() => setLimit((l) => l + 100)}>
              Mostrar más ({filtered.length - limit})
            </button>
          )}
        </>
      )}
    </section>
  );
}

function ParamsCard({ settings, onSaved, toast }) {
  const [draft, setDraft] = useState(() => ({ ...Object.fromEntries(PARAMS.map(([k]) => [k, settings[k]])), systemPrompt: settings.systemPrompt }));
  const set = (k, v) => setDraft((d) => ({ ...d, [k]: v }));

  async function save() {
    try {
      await api.saveSettings(draft);
      toast('Parámetros guardados');
      onSaved();
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  return (
    <section className="card">
      <h3>Generación</h3>
      <div className="grid-2">
        {PARAMS.map(([key, label, min, max, step]) => (
          <Field key={key} label={label}>
            <input type="number" inputMode="decimal" min={min} max={max} step={step} value={draft[key]} onChange={(e) => set(key, e.target.value)} />
          </Field>
        ))}
      </div>
      <Field label="Prompt de sistema" hint="Admite {{char}} y {{user}}. Un prompt propio en la tarjeta del personaje lo reemplaza (usa {{original}} para incluirlo).">
        <textarea rows={6} value={draft.systemPrompt} onChange={(e) => set('systemPrompt', e.target.value)} />
      </Field>
      <div className="btn-row">
        <button className="btn primary" onClick={save}>
          Guardar
        </button>
        <button className="btn" onClick={() => set('systemPrompt', settings.defaultSystemPrompt)}>
          Restaurar prompt
        </button>
      </div>
    </section>
  );
}
