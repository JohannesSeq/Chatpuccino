import React, { useEffect, useState } from 'react';
import { api } from '../../api.js';
import { useData } from '../../data.jsx';
import { SAMPLERS } from '../../samplers.js';
import { Field } from '../../components/ui.jsx';
import { useT } from '../../i18n.jsx';
import { LOCAL_SERVERS, ModelPicker } from './ConnectionTab.jsx';

// El contexto máximo no aplica aquí: el asistente solo envía el texto del campo y un resumen de la ficha.
const ASSISTANT_SAMPLERS = SAMPLERS.filter(([key]) => key !== 'openai_max_context');

export default function AssistantTab() {
  const { t } = useT();
  const { toast } = useData();
  const [cfg, setCfg] = useState(null);

  useEffect(() => {
    api.assistant().then(setCfg).catch((e) => toast(e.message, 'error'));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!cfg) return <p className="muted">{t('common.loading')}</p>;
  const conn = cfg.connection;

  async function selectModel(model) {
    try {
      setCfg(await api.saveAssistant({ connection: { model } }));
      toast(t('assistant.model_selected'));
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
        <h3>{t('assistant.title')}</h3>
        <p className="muted">
          {t('assistant.intro_before')}
          <code>data/assistant.jsonl</code>
          {t('assistant.intro_after')}
        </p>
        <p>
          {t('assistant.status')}{' '}
          {cfg.ready ? (
            <span className="tag ok-tag">{t('assistant.ready')}</span>
          ) : (
            <span className="tag">{conn.type === 'local' ? (conn.baseUrl ? t('assistant.missing_model') : t('assistant.missing_url')) : conn.hasKey ? t('assistant.missing_model') : t('assistant.missing_key')}</span>
          )}
        </p>
      </section>

      <ConnectionCard conn={conn} onSaved={setCfg} />

      <ModelPicker conn={conn} title={t('assistant.model_title')} loadModels={api.assistantModels} onSelect={selectModel} onToggleFavorite={toggleFavorite} />

      <VisionCard conn={conn} onSaved={setCfg} />

      <PromptsCard cfg={cfg} onSaved={setCfg} />
    </div>
  );
}

function ConnectionCard({ conn, onSaved }) {
  const { t } = useT();
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
      toast(t('assistant.connection.saved'));
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function clearKey() {
    try {
      onSaved(await api.saveAssistant({ connection: { apiKey: '__clear__' } }));
      toast(t('connection.key_removed'));
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  return (
    <section className="card">
      <h3>{t('assistant.connection.title')}</h3>
      <div className="tabs">
        <button className={!isLocal ? 'active' : ''} onClick={() => setType('openrouter')}>
          OpenRouter
        </button>
        <button className={isLocal ? 'active' : ''} onClick={() => setType('local')}>
          {t('connection.local_server')}
        </button>
      </div>
      {isLocal && (
        <>
          <Field label={t('connection.url_label')} hint={t('connection.url_hint')}>
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
        label={isLocal ? t('connection.api_key_optional') : conn.type === 'openrouter' && conn.hasKey ? t('connection.api_key_saved', { preview: conn.keyPreview }) : t('connection.api_key')}
        hint={isLocal ? t('connection.api_key_hint_local') : conn.hasKey ? t('connection.api_key_hint_keep') : t('connection.api_key_hint_new')}
      >
        <input type="password" autoComplete="off" placeholder={isLocal ? '' : 'sk-or-v1-…'} value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
      </Field>
      <div className="btn-row">
        <button className="btn" disabled={busy} onClick={test}>
          {t('common.test')}
        </button>
        <button className="btn primary" disabled={busy || (isLocal && !baseUrl.trim())} onClick={save}>
          {t('assistant.connection.save')}
        </button>
        {conn.hasKey && (
          <button className="btn small danger" onClick={clearKey}>
            {t('connection.clear_key')}
          </button>
        )}
      </div>
      {status && <p className={status.ok ? 'ok' : 'err'}>{status.text}</p>}
    </section>
  );
}

function VisionCard({ conn, onSaved }) {
  const { t } = useT();
  const { toast } = useData();
  const [model, setModel] = useState(conn.visionModel);
  const options = [...new Set([conn.model, ...conn.favorites].filter(Boolean))];

  async function save(value) {
    try {
      onSaved(await api.saveAssistant({ connection: { visionModel: value } }));
      setModel(value);
      toast(value ? t('assistant.vision.saved') : t('assistant.vision.fallback'));
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  return (
    <section className="card">
      <h3>{t('assistant.vision.title')}</h3>
      <Field label={t('assistant.vision.label')} hint={t('assistant.vision.hint')}>
        <div className="inline">
          <input list="assistant-vision-models" value={model} onChange={(e) => setModel(e.target.value)} placeholder={conn.model || t('connection.picker.manual_placeholder')} autoCapitalize="none" />
          <datalist id="assistant-vision-models">
            {options.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
          <button className="btn" disabled={model.trim() === conn.visionModel} onClick={() => save(model.trim())}>
            {t('common.save')}
          </button>
        </div>
      </Field>
    </section>
  );
}

function PromptsCard({ cfg, onSaved }) {
  const { t } = useT();
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
      toast(t('assistant.prompts.saved'));
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <section className="card">
        <h3>{t('assistant.prompts.title')}</h3>
        <Field label={t('assistant.prompts.system_label')} hint={t('assistant.prompts.system_hint')}>
          <textarea rows={8} value={prompts.system} onChange={(e) => setPrompts({ ...prompts, system: e.target.value })} />
        </Field>
        <button className="btn small" disabled={prompts.system === cfg.defaults.prompts.system} onClick={() => setPrompts({ ...prompts, system: cfg.defaults.prompts.system })}>
          {t('common.reset')}
        </button>
        <Field label={t('assistant.prompts.image_label')} hint={t('assistant.prompts.image_hint')}>
          <textarea rows={5} value={prompts.image} onChange={(e) => setPrompts({ ...prompts, image: e.target.value })} />
        </Field>
        <button className="btn small" disabled={prompts.image === cfg.defaults.prompts.image} onClick={() => setPrompts({ ...prompts, image: cfg.defaults.prompts.image })}>
          {t('common.reset')}
        </button>
      </section>

      <section className="card">
        <h3>{t('assistant.sampling.title')}</h3>
        <div className="grid-2">
          {ASSISTANT_SAMPLERS.map(([key, min, max, step]) => (
            <Field key={key} label={t(`samplers.${key}`)}>
              <input type="number" inputMode="decimal" min={min} max={max} step={step} value={sampling[key]} onChange={(e) => setSampling({ ...sampling, [key]: e.target.value })} />
            </Field>
          ))}
        </div>
        <div className="btn-row">
          <button className="btn" onClick={() => setSampling(cfg.defaults.sampling)} disabled={JSON.stringify(sampling) === JSON.stringify(cfg.defaults.sampling)}>
            {t('assistant.sampling.defaults')}
          </button>
        </div>
      </section>

      <div className="btn-row">
        <button className="btn primary" disabled={busy || !dirty} onClick={save}>
          {t('assistant.save_all')}
        </button>
        {dirty && <span className="muted">{t('assistant.unsaved')}</span>}
      </div>
    </>
  );
}
