import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../api.js';
import { useData } from '../../data.jsx';
import { useT } from '../../i18n.jsx';
import { Field, SearchBox } from '../../components/ui.jsx';
import { Icon } from '../../components/Icon.jsx';
import { useBrowserVoices, useTts } from '../../tts.jsx';
import { supportsBrowserTts } from '../../ttsEngine.js';
import { charVoice, NARRATOR_VOICE, USER_VOICE } from '../../../../shared/tts.js';

const PROVIDERS = ['browser', 'openai', 'elevenlabs'];

// Control deslizante que guarda solo cuando dejas de moverlo.
function AutoSlider({ label, hint, min, max, step, value, onCommit, format = (v) => String(v) }) {
  const [local, setLocal] = useState(value);
  useEffect(() => setLocal(value), [value]);
  useEffect(() => {
    if (local === value) return undefined;
    const id = setTimeout(() => onCommit(local), 450);
    return () => clearTimeout(id);
  }, [local, value, onCommit]);
  return (
    <Field label={`${label}: ${format(local)}`} hint={hint}>
      <input type="range" min={min} max={max} step={step} value={local} onChange={(e) => setLocal(Number(e.target.value))} aria-label={label} />
    </Field>
  );
}

function Check({ checked, onChange, label, hint, disabled }) {
  return (
    <label className="check voice-check">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} disabled={disabled} />
      <span>
        <strong>{label}</strong>
        {hint && <small className="muted">{hint}</small>}
      </span>
    </label>
  );
}

const draftOf = (c) => ({
  openai: { baseUrl: c.openai.baseUrl, model: c.openai.model, speed: c.openai.speed, voices: c.openai.voices, apiKey: '', clearKey: false },
  elevenlabs: { model: c.elevenlabs.model, stability: c.elevenlabs.stability, similarity: c.elevenlabs.similarity, apiKey: '', clearKey: false },
});

const patchOf = (d) => ({
  openai: { baseUrl: d.openai.baseUrl, model: d.openai.model, speed: d.openai.speed, voices: d.openai.voices, apiKey: d.openai.clearKey ? '__clear__' : d.openai.apiKey },
  elevenlabs: { model: d.elevenlabs.model, stability: d.elevenlabs.stability, similarity: d.elevenlabs.similarity, apiKey: d.elevenlabs.clearKey ? '__clear__' : d.elevenlabs.apiKey },
});

export default function VoiceTab() {
  const { t } = useT();
  const tts = useTts();
  const { config, update } = tts;
  if (!config) return <div className="empty">{t('common.loading')}</div>;
  return (
    <div className="voice-tab">
      <GeneralCard tts={tts} />
      <ProviderCard key={config.provider} config={config} update={update} />
      <VoicesCard tts={tts} />
    </div>
  );
}

function GeneralCard({ tts }) {
  const { t } = useT();
  const { config, update } = tts;
  const set = (patch) => update(patch);
  const commitVolume = useCallback((v) => update({ volume: v }), [update]);
  return (
    <section className="card stack">
      <div>
        <h3>{t('tts.general.title')}</h3>
        <p className="muted">{t('tts.general.intro')}</p>
      </div>
      <Check checked={config.enabled} onChange={(v) => set({ enabled: v })} label={t('tts.general.enabled')} hint={t('tts.general.enabled_hint')} />
      <div className="voice-opts" aria-disabled={!config.enabled}>
        <Check checked={config.autoplay} onChange={(v) => set({ autoplay: v })} label={t('tts.general.autoplay')} hint={t('tts.general.autoplay_hint')} disabled={!config.enabled} />
        <Check checked={config.narrator} onChange={(v) => set({ narrator: v })} label={t('tts.general.narrator')} hint={t('tts.general.narrator_hint')} disabled={!config.enabled} />
        <Check checked={config.narrateUser} onChange={(v) => set({ narrateUser: v })} label={t('tts.general.narrate_user')} hint={t('tts.general.narrate_user_hint')} disabled={!config.enabled} />
        <Check checked={config.skipCode} onChange={(v) => set({ skipCode: v })} label={t('tts.general.skip_code')} disabled={!config.enabled} />
        <Field label={t('tts.general.unquoted')} hint={t('tts.general.unquoted_hint')}>
          <select value={config.unquoted} onChange={(e) => set({ unquoted: e.target.value })} disabled={!config.enabled}>
            <option value="narrator">{t('tts.general.unquoted_narrator')}</option>
            <option value="speech">{t('tts.general.unquoted_speech')}</option>
          </select>
        </Field>
        <AutoSlider label={t('tts.general.volume')} min={0} max={100} step={5} value={config.volume} onCommit={commitVolume} format={(v) => `${v}%`} />
      </div>
      <p className="voice-rule muted">{t('tts.general.rule')}</p>
    </section>
  );
}

function ProviderCard({ config, update }) {
  const { t } = useT();
  const { toast } = useData();
  const [draft, setDraft] = useState(() => draftOf(config));
  const [busy, setBusy] = useState(false);
  const [test, setTest] = useState(null);
  const provider = config.provider;

  // Al guardar (o cambiar desde otra pestaña) el borrador vuelve a reflejar lo guardado.
  const savedKey = JSON.stringify(draftOf(config));
  const lastSaved = useRef(savedKey);
  useEffect(() => {
    if (lastSaved.current === savedKey) return;
    lastSaved.current = savedKey;
    setDraft(draftOf(config));
  }, [savedKey, config]);

  const dirty = JSON.stringify(draft) !== savedKey;
  const setSection = (section, patch) => setDraft((d) => ({ ...d, [section]: { ...d[section], ...patch } }));
  const commitBrowser = useCallback((patch) => update({ browser: patch }), [update]);

  async function save() {
    setBusy(true);
    const next = await update(patchOf(draft));
    setBusy(false);
    if (next) {
      setDraft(draftOf(next));
      toast(t('tts.provider.saved'));
    }
  }

  async function runTest() {
    setTest({ running: true });
    try {
      const r = await api.testTts({ provider, ...patchOf(draft) });
      setTest({ ok: true, message: r.message });
    } catch (e) {
      setTest({ ok: false, message: e.message });
    }
  }

  const keyField = (section, hasKey) => {
    const d = draft[section];
    const placeholder = d.clearKey ? t('tts.provider.key_cleared') : hasKey ? t('tts.provider.key_saved') : t('tts.provider.key_none');
    return (
      <div className="field">
        <label className="field">
          <span className="field-label">{t('tts.provider.key')}</span>
          <input type="password" autoComplete="new-password" value={d.apiKey} placeholder={placeholder} onChange={(e) => setSection(section, { apiKey: e.target.value, clearKey: false })} />
        </label>
        {hasKey && !d.clearKey && (
          <button type="button" className="btn small" onClick={() => setSection(section, { apiKey: '', clearKey: true })}>
            {t('tts.provider.key_clear')}
          </button>
        )}
        {d.clearKey && (
          <button type="button" className="btn small" onClick={() => setSection(section, { clearKey: false })}>
            {t('tts.provider.key_keep')}
          </button>
        )}
      </div>
    );
  };

  return (
    <section className="card stack">
      <div>
        <h3>{t('tts.provider.title')}</h3>
        <p className="muted">{t('tts.provider.intro')}</p>
      </div>
      <Field label={t('tts.provider.label')}>
        <select value={provider} onChange={(e) => update({ provider: e.target.value })}>
          {PROVIDERS.map((p) => (
            <option key={p} value={p}>
              {t(`tts.provider.names.${p}`)}
            </option>
          ))}
        </select>
      </Field>

      {provider === 'browser' && (
        <>
          <p className="muted">{t('tts.provider.browser_hint')}</p>
          {!supportsBrowserTts() && <p className="err">{t('tts.errors.unsupported')}</p>}
          <AutoSlider label={t('tts.provider.rate')} min={0.5} max={2} step={0.05} value={config.browser.rate} onCommit={(v) => commitBrowser({ rate: v })} format={(v) => `${v}×`} />
          <AutoSlider label={t('tts.provider.pitch')} min={0} max={2} step={0.05} value={config.browser.pitch} onCommit={(v) => commitBrowser({ pitch: v })} format={(v) => `${v}`} />
        </>
      )}

      {provider === 'openai' && (
        <>
          <p className="muted">{t('tts.provider.openai_hint')}</p>
          <label className="field">
            <span className="field-label">{t('tts.provider.url')}</span>
            <input type="url" inputMode="url" autoComplete="off" spellCheck={false} value={draft.openai.baseUrl} placeholder="https://api.openai.com/v1" onChange={(e) => setSection('openai', { baseUrl: e.target.value })} />
            <span className="field-hint">{t('tts.provider.url_hint')}</span>
          </label>
          {keyField('openai', config.openai.hasKey)}
          <label className="field">
            <span className="field-label">{t('tts.provider.model')}</span>
            <input type="text" autoComplete="off" spellCheck={false} value={draft.openai.model} placeholder="tts-1" onChange={(e) => setSection('openai', { model: e.target.value })} />
          </label>
          <Field label={`${t('tts.provider.speed')}: ${draft.openai.speed}×`}>
            <input type="range" min={0.25} max={4} step={0.05} value={draft.openai.speed} onChange={(e) => setSection('openai', { speed: Number(e.target.value) })} aria-label={t('tts.provider.speed')} />
          </Field>
          <label className="field">
            <span className="field-label">{t('tts.provider.voice_list')}</span>
            <textarea rows={2} spellCheck={false} value={draft.openai.voices} placeholder="alloy, nova, af_bella" onChange={(e) => setSection('openai', { voices: e.target.value })} />
            <span className="field-hint">{t('tts.provider.voice_list_hint')}</span>
          </label>
        </>
      )}

      {provider === 'elevenlabs' && (
        <>
          <p className="muted">{t('tts.provider.elevenlabs_hint')}</p>
          {keyField('elevenlabs', config.elevenlabs.hasKey)}
          <label className="field">
            <span className="field-label">{t('tts.provider.model')}</span>
            <input type="text" autoComplete="off" spellCheck={false} value={draft.elevenlabs.model} placeholder="eleven_multilingual_v2" onChange={(e) => setSection('elevenlabs', { model: e.target.value })} />
          </label>
          <Field label={`${t('tts.provider.stability')}: ${draft.elevenlabs.stability}`}>
            <input type="range" min={0} max={1} step={0.05} value={draft.elevenlabs.stability} onChange={(e) => setSection('elevenlabs', { stability: Number(e.target.value) })} aria-label={t('tts.provider.stability')} />
          </Field>
          <Field label={`${t('tts.provider.similarity')}: ${draft.elevenlabs.similarity}`}>
            <input type="range" min={0} max={1} step={0.05} value={draft.elevenlabs.similarity} onChange={(e) => setSection('elevenlabs', { similarity: Number(e.target.value) })} aria-label={t('tts.provider.similarity')} />
          </Field>
        </>
      )}

      {provider !== 'browser' && (
        <>
          <div className="btn-row">
            <button type="button" className="btn primary" onClick={save} disabled={!dirty || busy}>
              {t('common.save')}
            </button>
            <button type="button" className="btn" onClick={runTest} disabled={test?.running}>
              {test?.running ? t('tts.provider.testing') : t('tts.provider.test')}
            </button>
            {dirty && <span className="muted">{t('tts.provider.unsaved')}</span>}
          </div>
          <div role="status" aria-live="polite">
            {test && !test.running && test.ok && <p className="voice-result ok">✓ {test.message}</p>}
            {test && !test.running && !test.ok && <p className="voice-result err">✗ {test.message}</p>}
          </div>
        </>
      )}
    </section>
  );
}

function VoicesCard({ tts }) {
  const { t } = useT();
  const { characters } = useData();
  const { config, play, stop, isActive, update } = tts;
  const provider = config.provider;
  const browserVoices = useBrowserVoices();
  const [remote, setRemote] = useState({ status: 'idle', voices: [], source: '', error: '' });
  const [query, setQuery] = useState('');

  const loadRemote = useCallback(async () => {
    if (provider === 'browser') return;
    setRemote((r) => ({ ...r, status: 'loading', error: '' }));
    try {
      const out = await api.ttsVoices(provider);
      setRemote({ status: 'done', voices: out.voices, source: out.source, error: '' });
    } catch (e) {
      setRemote({ status: 'error', voices: [], source: '', error: e.message });
    }
  }, [provider]);

  // Las voces dependen de la conexión guardada: se vuelven a pedir al cambiar lo que influye en ellas.
  const connKey = provider === 'openai' ? `${config.openai.baseUrl}|${config.openai.voices}|${config.openai.hasKey}` : provider === 'elevenlabs' ? String(config.elevenlabs.hasKey) : '';
  useEffect(() => {
    loadRemote();
  }, [loadRemote, connKey]);

  const voices = provider === 'browser' ? browserVoices : remote.voices;
  const map = config.voices[provider];
  const setVoice = (slot, id, value) => update({ voices: { [provider]: slot === 'chars' ? { chars: { [id]: value } } : { [slot]: value } } });

  const sorted = useMemo(() => [...characters].sort((a, b) => a.name.localeCompare(b.name)), [characters]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? sorted.filter((c) => c.name.toLowerCase().includes(q)) : sorted;
  }, [sorted, query]);

  const preview = (key) => {
    const pid = `preview:${key}`;
    if (isActive(pid)) return stop();
    return play([{ voice: key, text: t('tts.voices.sample') }], pid);
  };

  const row = (slot, id, label, hint, key) => {
    const value = slot === 'chars' ? map.chars[id] || '' : map[slot] || '';
    const missing = value && !voices.some((v) => v.id === value);
    const active = isActive(`preview:${key}`);
    return (
      <div className="voice-row" key={key}>
        <div className="voice-who">
          <strong>{label}</strong>
          {hint && <small className="muted">{hint}</small>}
        </div>
        <select value={value} onChange={(e) => setVoice(slot, id, e.target.value)} aria-label={t('tts.voices.voice_for', { name: label })}>
          <option value="">{slot === 'chars' ? t('tts.voices.inherit') : t('tts.voices.system_default')}</option>
          {missing && <option value={value}>{value}</option>}
          {voices.map((v) => (
            <option key={v.id} value={v.id}>
              {v.lang ? `${v.name} (${v.lang})` : v.name}
            </option>
          ))}
        </select>
        <button type="button" className={`icon-btn ${active ? 'on' : ''}`} onClick={() => preview(key)} aria-label={active ? t('tts.stop') : t('tts.voices.preview', { name: label })} title={active ? t('tts.stop') : t('tts.voices.preview', { name: label })}>
          <Icon name={active ? 'stop' : 'volume'} size={20} />
        </button>
      </div>
    );
  };

  return (
    <section className="card stack">
      <div>
        <h3>{t('tts.voices.title')}</h3>
        <p className="muted">{t('tts.voices.intro')}</p>
      </div>
      <div className="btn-row">
        {provider !== 'browser' && (
          <button type="button" className="btn small" onClick={loadRemote} disabled={remote.status === 'loading'}>
            <Icon name="refresh" size={16} /> {remote.status === 'loading' ? t('tts.voices.loading') : t('tts.voices.refresh')}
          </button>
        )}
        {provider !== 'browser' && remote.status === 'done' && <span className="muted">{t(`tts.voices.source_${remote.source}`, { count: voices.length })}</span>}
        {provider === 'browser' && <span className="muted">{t('tts.voices.browser_count', { count: browserVoices.length })}</span>}
      </div>
      {remote.status === 'error' && <p className="err">{remote.error}</p>}
      {provider === 'browser' && supportsBrowserTts() && browserVoices.length === 0 && <p className="muted">{t('tts.voices.browser_none')}</p>}

      <div className="voice-rows">
        {row(NARRATOR_VOICE, null, t('tts.voices.narrator'), config.narrator ? t('tts.voices.narrator_hint') : t('tts.voices.narrator_off'), NARRATOR_VOICE)}
        {row(USER_VOICE, null, t('tts.voices.user'), t('tts.voices.user_hint'), USER_VOICE)}
        {row('default', null, t('tts.voices.default'), t('tts.voices.default_hint'), 'default')}
      </div>

      <h4 className="voice-sub">{t('tts.voices.characters')}</h4>
      {sorted.length > 6 && <SearchBox value={query} onChange={setQuery} placeholder={t('tts.voices.search')} />}
      {sorted.length === 0 ? (
        <p className="muted">{t('tts.voices.no_characters')}</p>
      ) : (
        <div className="voice-rows">{shown.map((c) => row('chars', c.id, c.name, '', charVoice(c.id)))}</div>
      )}
    </section>
  );
}
