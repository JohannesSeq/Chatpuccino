import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api.js';
import { useData } from '../../data.jsx';
import { useDialog } from '../../dialogs.jsx';
import { Icon } from '../../components/Icon.jsx';
import { Field, Modal, SearchBox } from '../../components/ui.jsx';
import { useT } from '../../i18n.jsx';

export const LOCAL_SERVERS = [
  ['LM Studio', 'http://localhost:1234/v1'],
  ['Ollama', 'http://localhost:11434/v1'],
  ['KoboldCpp', 'http://localhost:5001/v1'],
  ['llama.cpp', 'http://localhost:8080/v1'],
  ['text-generation-webui', 'http://127.0.0.1:5000/v1'],
];

const price = (perToken, t) => (perToken === 0 ? t('connection.picker.price_free') : `$${(perToken * 1e6).toFixed(2)}/M`);

export default function ConnectionTab() {
  const { t } = useT();
  const { settings, refresh, toast } = useData();
  const [editing, setEditing] = useState(null);
  const active = settings.connections.find((c) => c.id === settings.activeConnection);

  async function activate(id) {
    try {
      await api.activateConnection(id);
      await refresh('settings');
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  async function selectModel(model) {
    try {
      await api.updateConnection(active.id, { model });
      await refresh('settings');
      toast(t('connection.model_selected'));
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  async function toggleFavorite(model) {
    try {
      await api.toggleFavorite(active.id, model);
      await refresh('settings');
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  return (
    <div className="stack">
      <section className="card">
        <h3>{t('connection.title')}</h3>
        <p className="muted">{t('connection.intro')}</p>
        <ul className="rows">
          {settings.connections.map((c) => {
            const isActive = c.id === active?.id;
            return (
              <li key={c.id} className={`row ${isActive ? 'active' : ''}`}>
                <button className="row-main" onClick={() => setEditing(c)}>
                  <div className="row-text">
                    <strong>
                      {c.name} <span className="tag">{c.type === 'local' ? t('connection.type_local') : 'OpenRouter'}</span>
                    </strong>
                    <div className="row-sub">
                      {c.type === 'local' ? c.baseUrl : c.hasKey ? t('connection.key_preview', { preview: c.keyPreview }) : t('connection.no_key')} · {c.model || t('connection.no_model')}
                    </div>
                  </div>
                </button>
                {isActive ? (
                  <span className="tag ok-tag">{t('connection.active')}</span>
                ) : (
                  <button className="btn small" onClick={() => activate(c.id)}>
                    {t('common.use')}
                  </button>
                )}
              </li>
            );
          })}
          {!settings.connections.length && <li className="empty small">{t('connection.empty')}</li>}
        </ul>
        <button className="btn" onClick={() => setEditing('new')}>
          <Icon name="plus" size={18} /> {t('connection.add')}
        </button>
      </section>

      {active && (
        <ModelPicker
          key={active.id}
          conn={active}
          title={t('connection.model_title', { name: active.name })}
          loadModels={() => api.connectionModels(active.id)}
          onSelect={selectModel}
          onToggleFavorite={toggleFavorite}
        />
      )}
      <p className="muted">
        {t('connection.presets_hint_before')}
        <Link to="/settings/presets">{t('settings.tabs.presets')}</Link>
        {t('connection.presets_hint_after')}
      </p>

      {editing && (
        <ConnectionEditor
          conn={editing === 'new' ? null : editing}
          isFirst={!settings.connections.length}
          onClose={async (changed) => {
            setEditing(null);
            if (changed) await refresh('settings');
          }}
        />
      )}
    </div>
  );
}

function ConnectionEditor({ conn, isFirst, onClose }) {
  const { t } = useT();
  const { toast } = useData();
  const { confirm } = useDialog();
  const [type, setType] = useState(conn?.type || 'openrouter');
  const [name, setName] = useState(conn?.name || '');
  const [baseUrl, setBaseUrl] = useState(conn?.baseUrl || '');
  const [apiKey, setApiKey] = useState('');
  const [useIt, setUseIt] = useState(true);
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const isLocal = type === 'local';

  async function test() {
    setBusy(true);
    setStatus(null);
    try {
      const r = await api.testConnection({ id: conn?.id, type, baseUrl, apiKey });
      setStatus({ ok: true, text: r.message });
    } catch (e) {
      setStatus({ ok: false, text: e.message });
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    setBusy(true);
    try {
      if (conn) {
        await api.updateConnection(conn.id, { name: name || conn.name, baseUrl, apiKey });
      } else {
        const created = await api.createConnection({ type, name, baseUrl, apiKey });
        if (useIt && !isFirst) await api.activateConnection(created.id);
      }
      onClose(true);
    } catch (e) {
      toast(e.message, 'error');
      setBusy(false);
    }
  }

  async function clearKey() {
    try {
      await api.updateConnection(conn.id, { apiKey: '__clear__' });
      toast(t('connection.key_removed'));
      onClose(true);
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  async function remove() {
    if (!(await confirm({ title: t('connection.editor.delete_title'), message: t('connection.editor.delete_message', { name: conn.name }), confirmLabel: t('common.delete'), danger: true }))) return;
    try {
      await api.deleteConnection(conn.id);
      onClose(true);
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  return (
    <Modal
      title={conn ? t('connection.editor.edit_title') : t('connection.editor.new_title')}
      onClose={() => onClose(false)}
      footer={
        <>
          {conn && (
            <button className="btn danger" onClick={remove}>
              {t('common.delete')}
            </button>
          )}
          <span className="spacer" />
          <button className="btn" disabled={busy} onClick={test}>
            {t('common.test')}
          </button>
          <button className="btn primary" disabled={busy || (isLocal && !baseUrl.trim()) || (!conn && !isLocal && !apiKey.trim())} onClick={save}>
            {t('common.save')}
          </button>
        </>
      }
    >
      {!conn && (
        <div className="tabs">
          <button className={!isLocal ? 'active' : ''} onClick={() => setType('openrouter')}>
            OpenRouter
          </button>
          <button className={isLocal ? 'active' : ''} onClick={() => setType('local')}>
            {t('connection.local_server')}
          </button>
        </div>
      )}
      <Field label={t('connection.editor.name')}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder={isLocal ? t('connection.editor.name_placeholder_local') : 'OpenRouter'} />
      </Field>
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
        label={isLocal ? t('connection.api_key_optional') : conn?.hasKey ? t('connection.api_key_saved', { preview: conn.keyPreview }) : t('connection.api_key')}
        hint={isLocal ? t('connection.api_key_hint_local') : conn?.hasKey ? t('connection.api_key_hint_keep') : t('connection.api_key_hint_new')}
      >
        <input type="password" autoComplete="off" placeholder={isLocal ? '' : 'sk-or-v1-…'} value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
      </Field>
      {conn?.hasKey && (
        <button className="btn small danger" onClick={clearKey}>
          {t('connection.clear_key')}
        </button>
      )}
      {!conn && !isFirst && (
        <label className="check">
          <input type="checkbox" checked={useIt} onChange={(e) => setUseIt(e.target.checked)} /> {t('connection.editor.use_now')}
        </label>
      )}
      {status && <p className={status.ok ? 'ok' : 'err'}>{status.text}</p>}
    </Modal>
  );
}

export function ModelPicker({ conn, title, loadModels, onSelect, onToggleFavorite }) {
  const { t } = useT();
  const [models, setModels] = useState(null);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState('all');
  const [freeOnly, setFreeOnly] = useState(false);
  const [limit, setLimit] = useState(60);
  const [manual, setManual] = useState('');

  const load = () => {
    setError('');
    setModels(null);
    loadModels().then(setModels).catch((e) => setError(e.message));
  };
  useEffect(load, [conn.id, conn.type, conn.baseUrl, conn.hasKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const favs = conn.favorites;
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const known = new Map((models || []).map((m) => [m.id, m]));
    let list = tab === 'fav' ? favs.map((id) => known.get(id) || { id, name: id, context: 0, promptPrice: 0, completionPrice: 0, unknown: true }) : models || [];
    list = list.filter((m) => (!q || m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q)) && (!freeOnly || (m.promptPrice === 0 && m.completionPrice === 0)));
    if (tab === 'all') list = [...list.filter((m) => favs.includes(m.id)), ...list.filter((m) => !favs.includes(m.id))];
    return list;
  }, [models, query, tab, freeOnly, favs]);

  const select = onSelect;
  const toggleFav = onToggleFavorite;

  const isLocal = conn.type === 'local';
  return (
    <section className="card">
      <h3>{title}</h3>
      <p>
        {t('connection.picker.current')} <strong>{conn.model || t('connection.picker.none_selected')}</strong>
      </p>
      <div className="tabs">
        <button className={tab === 'all' ? 'active' : ''} onClick={() => setTab('all')}>
          {models ? t('connection.picker.tab_all_count', { count: models.length }) : t('connection.picker.tab_all')}
        </button>
        <button className={tab === 'fav' ? 'active' : ''} onClick={() => setTab('fav')}>
          {t('connection.picker.tab_favorites', { count: favs.length })}
        </button>
      </div>
      {error && (
        <p className="err">
          {error}{' '}
          <button className="btn small" onClick={load}>
            {t('common.retry')}
          </button>
        </p>
      )}
      {!error && !models && tab === 'all' && <p className="muted">{t('connection.picker.loading')}</p>}
      {(models || tab === 'fav') && (
        <>
          <SearchBox
            value={query}
            onChange={(v) => {
              setQuery(v);
              setLimit(60);
            }}
            placeholder={t('connection.picker.search')}
          />
          {!isLocal && (
            <label className="check">
              <input type="checkbox" checked={freeOnly} onChange={(e) => setFreeOnly(e.target.checked)} /> {t('connection.picker.free_only')}
            </label>
          )}
          <ul className="rows model-list">
            {rows.slice(0, limit).map((m) => (
              <li key={m.id} className={`row ${conn.model === m.id ? 'active' : ''}`}>
                <button className={`icon-btn star ${favs.includes(m.id) ? 'on' : ''}`} onClick={() => toggleFav(m.id)} aria-label={favs.includes(m.id) ? t('connection.picker.remove_favorite') : t('connection.picker.add_favorite')}>
                  <Icon name={favs.includes(m.id) ? 'star' : 'starOutline'} />
                </button>
                <button className="row-main" onClick={() => select(m.id)}>
                  <div className="row-text">
                    <strong>{m.name}</strong>
                    <div className="row-sub">
                      {m.id}
                      {m.unknown ? ` · ${t('connection.picker.not_listed')}` : ''}
                      {m.context ? ` · ${t('connection.picker.context', { size: Math.round(m.context / 1000) })}` : ''}
                      {!isLocal && !m.unknown ? ` · ${t('connection.picker.price_line', { input: price(m.promptPrice, t), output: price(m.completionPrice, t) })}` : ''}
                    </div>
                  </div>
                </button>
              </li>
            ))}
            {!rows.length && <li className="empty small">{tab === 'fav' && !favs.length ? t('connection.picker.empty_favorites') : t('connection.picker.no_results')}</li>}
          </ul>
          {rows.length > limit && (
            <button className="btn" onClick={() => setLimit((l) => l + 100)}>
              {t('connection.picker.show_more', { count: rows.length - limit })}
            </button>
          )}
        </>
      )}
      <Field label={t('connection.picker.manual_label')} hint={isLocal ? t('connection.picker.manual_hint_local') : t('connection.picker.manual_hint_example')}>
        <div className="inline">
          <input value={manual} onChange={(e) => setManual(e.target.value)} placeholder={t('connection.picker.manual_placeholder')} autoCapitalize="none" />
          <button
            className="btn"
            disabled={!manual.trim()}
            onClick={async () => {
              await select(manual.trim());
              setManual('');
            }}
          >
            {t('common.use')}
          </button>
        </div>
      </Field>
    </section>
  );
}
