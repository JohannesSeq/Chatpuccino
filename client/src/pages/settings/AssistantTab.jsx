import React, { useEffect, useState } from 'react';
import { api } from '../../api.js';
import { useData } from '../../data.jsx';
import { SAMPLERS } from '../../samplers.js';
import { Field } from '../../components/ui.jsx';
import { LOCAL_SERVERS, ModelPicker } from './ConnectionTab.jsx';

// El contexto máximo no aplica aquí: el asistente solo envía el texto del campo y un resumen de la ficha.
const ASSISTANT_SAMPLERS = SAMPLERS.filter(([key]) => key !== 'openai_max_context');

export default function AssistantTab() {
  const { toast } = useData();
  const [cfg, setCfg] = useState(null);

  useEffect(() => {
    api.assistant().then(setCfg).catch((e) => toast(e.message, 'error'));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!cfg) return <p className="muted">Cargando…</p>;
  const conn = cfg.connection;

  async function selectModel(model) {
    try {
      setCfg(await api.saveAssistant({ connection: { model } }));
      toast('Modelo seleccionado');
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  async function toggleFavorite(model) {
    try {
      await api.toggleAssistantFavorite(model);
      setCfg(await api.assistant());
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  return (
    <div className="stack">
      <section className="card">
        <h3>Configuración de Asistente de personajes</h3>
        <p className="muted">
          El asistente es la IA que te ayuda a crear personajes y personas: genera, mejora, expande o reescribe cada bloque de texto (botón ✨) y lee la imagen del personaje para describir su aspecto. Tiene su propia conexión, prompt y muestreo, independientes
          de los del roleplay. Todo se guarda en <code>data/assistant.jsonl</code>.
        </p>
        <p>
          Estado:{' '}
          {cfg.ready ? <span className="tag ok-tag">Listo</span> : <span className="tag">Falta configurar {conn.type === 'local' ? (conn.baseUrl ? 'el modelo' : 'la URL del servidor') : conn.hasKey ? 'el modelo' : 'la API key'}</span>}
        </p>
      </section>

      <ConnectionCard conn={conn} onSaved={setCfg} />

      <ModelPicker conn={conn} title="Modelo del asistente" loadModels={api.assistantModels} onSelect={selectModel} onToggleFavorite={toggleFavorite} />

      <VisionCard conn={conn} onSaved={setCfg} />

      <PromptsCard cfg={cfg} onSaved={setCfg} />
    </div>
  );
}

function ConnectionCard({ conn, onSaved }) {
  const { toast } = useData();
  const [type, setType] = useState(conn.type);
  const [baseUrl, setBaseUrl] = useState(conn.baseUrl);
  const [apiKey, setApiKey] = useState('');
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const isLocal = type === 'local';

  async function test() {
    setBusy(true);
    setStatus(null);
    try {
      setStatus({ ok: true, text: (await api.testAssistant({ type, baseUrl, apiKey })).message });
    } catch (e) {
      setStatus({ ok: false, text: e.message });
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    setBusy(true);
    try {
      // Cambiar de proveedor invalida los modelos elegidos.
      const patch = { type, baseUrl, apiKey, ...(type !== conn.type ? { model: '', visionModel: '' } : {}) };
      onSaved(await api.saveAssistant({ connection: patch }));
      setApiKey('');
      toast('Conexión del asistente guardada');
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function clearKey() {
    try {
      onSaved(await api.saveAssistant({ connection: { apiKey: '__clear__' } }));
      toast('API key eliminada');
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  return (
    <section className="card">
      <h3>Conexión</h3>
      <div className="tabs">
        <button className={!isLocal ? 'active' : ''} onClick={() => setType('openrouter')}>
          OpenRouter
        </button>
        <button className={isLocal ? 'active' : ''} onClick={() => setType('local')}>
          Servidor local
        </button>
      </div>
      {isLocal && (
        <>
          <Field label="URL del servidor" hint="Se abre desde la máquina donde corre Chatpuccino, no desde tu navegador. Debe terminar en /v1.">
            <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="http://localhost:1234/v1" autoCapitalize="none" />
          </Field>
          <div className="chips wrap">
            {LOCAL_SERVERS.map(([label, url]) => (
              <button key={label} className="chip plain" onClick={() => setBaseUrl(url)}>
                {label}
              </button>
            ))}
          </div>
        </>
      )}
      <Field
        label={isLocal ? 'API key (opcional)' : conn.type === 'openrouter' && conn.hasKey ? `API key guardada: ${conn.keyPreview}` : 'API key'}
        hint={isLocal ? 'Solo si tu servidor la exige.' : conn.hasKey ? 'Déjalo vacío para conservar la actual.' : 'Consíguela en openrouter.ai/keys. Se guarda en el servidor y no vuelve al navegador.'}
      >
        <input type="password" autoComplete="off" placeholder={isLocal ? '' : 'sk-or-v1-…'} value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
      </Field>
      <div className="btn-row">
        <button className="btn" disabled={busy} onClick={test}>
          Probar
        </button>
        <button className="btn primary" disabled={busy || (isLocal && !baseUrl.trim())} onClick={save}>
          Guardar conexión
        </button>
        {conn.hasKey && (
          <button className="btn small danger" onClick={clearKey}>
            Quitar API key guardada
          </button>
        )}
      </div>
      {status && <p className={status.ok ? 'ok' : 'err'}>{status.text}</p>}
    </section>
  );
}

function VisionCard({ conn, onSaved }) {
  const { toast } = useData();
  const [model, setModel] = useState(conn.visionModel);
  const options = [...new Set([conn.model, ...conn.favorites].filter(Boolean))];

  async function save(value) {
    try {
      onSaved(await api.saveAssistant({ connection: { visionModel: value } }));
      setModel(value);
      toast(value ? 'Modelo de visión guardado' : 'Se usará el modelo del asistente');
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  return (
    <section className="card">
      <h3>Lectura de imagen</h3>
      <Field label="Modelo con visión (opcional)" hint="Debe aceptar imágenes. Si lo dejas vacío, la lectura de imagen usa el modelo del asistente (que entonces debe tener visión).">
        <div className="inline">
          <input list="assistant-vision-models" value={model} onChange={(e) => setModel(e.target.value)} placeholder={conn.model || 'id-del-modelo'} autoCapitalize="none" />
          <datalist id="assistant-vision-models">
            {options.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
          <button className="btn" disabled={model.trim() === conn.visionModel} onClick={() => save(model.trim())}>
            Guardar
          </button>
        </div>
      </Field>
    </section>
  );
}

function PromptsCard({ cfg, onSaved }) {
  const { toast } = useData();
  const [prompts, setPrompts] = useState(cfg.prompts);
  const [sampling, setSampling] = useState(cfg.sampling);
  const [busy, setBusy] = useState(false);
  const dirty = JSON.stringify([prompts, sampling]) !== JSON.stringify([cfg.prompts, cfg.sampling]);

  async function save() {
    setBusy(true);
    try {
      const saved = await api.saveAssistant({ prompts, sampling });
      onSaved(saved);
      setPrompts(saved.prompts);
      setSampling(saved.sampling);
      toast('Prompts y muestreo guardados');
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <section className="card">
        <h3>Prompts</h3>
        <Field label="Prompt de sistema" hint="Se envía en cada petición del asistente (generar, mejorar, expandir, reescribir y lectura de imagen).">
          <textarea rows={8} value={prompts.system} onChange={(e) => setPrompts({ ...prompts, system: e.target.value })} />
        </Field>
        <button className="btn small" disabled={prompts.system === cfg.defaults.prompts.system} onClick={() => setPrompts({ ...prompts, system: cfg.defaults.prompts.system })}>
          Restablecer
        </button>
        <Field label="Instrucción de lectura de imagen" hint="Qué debe describir el modelo al leer la imagen de un personaje.">
          <textarea rows={5} value={prompts.image} onChange={(e) => setPrompts({ ...prompts, image: e.target.value })} />
        </Field>
        <button className="btn small" disabled={prompts.image === cfg.defaults.prompts.image} onClick={() => setPrompts({ ...prompts, image: cfg.defaults.prompts.image })}>
          Restablecer
        </button>
      </section>

      <section className="card">
        <h3>Muestreo</h3>
        <div className="grid-2">
          {ASSISTANT_SAMPLERS.map(([key, label, min, max, step]) => (
            <Field key={key} label={label}>
              <input type="number" inputMode="decimal" min={min} max={max} step={step} value={sampling[key]} onChange={(e) => setSampling({ ...sampling, [key]: e.target.value })} />
            </Field>
          ))}
        </div>
        <div className="btn-row">
          <button className="btn" onClick={() => setSampling(cfg.defaults.sampling)} disabled={JSON.stringify(sampling) === JSON.stringify(cfg.defaults.sampling)}>
            Valores por defecto
          </button>
        </div>
      </section>

      <div className="btn-row">
        <button className="btn primary" disabled={busy || !dirty} onClick={save}>
          Guardar prompts y muestreo
        </button>
        {dirty && <span className="muted">Hay cambios sin guardar</span>}
      </div>
    </>
  );
}
