import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api.js';
import { useData } from '../../data.jsx';
import { useDialog } from '../../dialogs.jsx';
import { Icon } from '../../components/Icon.jsx';
import { Field, Modal, SearchBox } from '../../components/ui.jsx';

const LOCAL_SERVERS = [
  ['LM Studio', 'http://localhost:1234/v1'],
  ['Ollama', 'http://localhost:11434/v1'],
  ['KoboldCpp', 'http://localhost:5001/v1'],
  ['llama.cpp', 'http://localhost:8080/v1'],
  ['text-generation-webui', 'http://127.0.0.1:5000/v1'],
];

const price = (perToken) => (perToken === 0 ? 'gratis' : `$${(perToken * 1e6).toFixed(2)}/M`);

export default function ConnectionTab() {
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

  return (
    <div className="stack">
      <section className="card">
        <h3>Conexiones</h3>
        <p className="muted">Puedes tener varias: cuentas de OpenRouter o servidores locales compatibles con la API de OpenAI (LM Studio, Ollama, KoboldCpp…). Se usa la conexión activa.</p>
        <ul className="rows">
          {settings.connections.map((c) => {
            const isActive = c.id === active?.id;
            return (
              <li key={c.id} className={`row ${isActive ? 'active' : ''}`}>
                <button className="row-main" onClick={() => setEditing(c)}>
                  <div className="row-text">
                    <strong>
                      {c.name} <span className="tag">{c.type === 'local' ? 'Local' : 'OpenRouter'}</span>
                    </strong>
                    <div className="row-sub">
                      {c.type === 'local' ? c.baseUrl : c.hasKey ? `Key ${c.keyPreview}` : 'Sin API key'} · {c.model || 'sin modelo'}
                    </div>
                  </div>
                </button>
                {isActive ? (
                  <span className="tag ok-tag">Activa</span>
                ) : (
                  <button className="btn small" onClick={() => activate(c.id)}>
                    Usar
                  </button>
                )}
              </li>
            );
          })}
          {!settings.connections.length && <li className="empty small">No hay conexiones. Añade una para poder chatear.</li>}
        </ul>
        <button className="btn" onClick={() => setEditing('new')}>
          <Icon name="plus" size={18} /> Añadir conexión
        </button>
      </section>

      {active && <ModelPicker key={active.id} conn={active} />}
      <p className="muted">
        Los parámetros de generación y los prompts de sistema se configuran en la pestaña <Link to="/settings/presets">Presets</Link>.
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
      toast('API key eliminada');
      onClose(true);
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  async function remove() {
    if (!(await confirm({ title: 'Eliminar conexión', message: `Se eliminará la conexión «${conn.name}», incluida su API key y sus favoritos.`, confirmLabel: 'Eliminar', danger: true }))) return;
    try {
      await api.deleteConnection(conn.id);
      onClose(true);
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  return (
    <Modal
      title={conn ? 'Editar conexión' : 'Nueva conexión'}
      onClose={() => onClose(false)}
      footer={
        <>
          {conn && (
            <button className="btn danger" onClick={remove}>
              Eliminar
            </button>
          )}
          <span className="spacer" />
          <button className="btn" disabled={busy} onClick={test}>
            Probar
          </button>
          <button className="btn primary" disabled={busy || (isLocal && !baseUrl.trim()) || (!conn && !isLocal && !apiKey.trim())} onClick={save}>
            Guardar
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
            Servidor local
          </button>
        </div>
      )}
      <Field label="Nombre">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder={isLocal ? 'Mi servidor local' : 'OpenRouter'} />
      </Field>
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
        label={isLocal ? 'API key (opcional)' : conn?.hasKey ? `API key guardada: ${conn.keyPreview}` : 'API key'}
        hint={isLocal ? 'Solo si tu servidor la exige.' : conn?.hasKey ? 'Déjalo vacío para conservar la actual.' : 'Consíguela en openrouter.ai/keys. Se guarda en el servidor y no vuelve al navegador.'}
      >
        <input type="password" autoComplete="off" placeholder={isLocal ? '' : 'sk-or-v1-…'} value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
      </Field>
      {conn?.hasKey && (
        <button className="btn small danger" onClick={clearKey}>
          Quitar API key guardada
        </button>
      )}
      {!conn && !isFirst && (
        <label className="check">
          <input type="checkbox" checked={useIt} onChange={(e) => setUseIt(e.target.checked)} /> Usar esta conexión ahora
        </label>
      )}
      {status && <p className={status.ok ? 'ok' : 'err'}>{status.text}</p>}
    </Modal>
  );
}

function ModelPicker({ conn }) {
  const { refresh, toast } = useData();
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
    api.connectionModels(conn.id).then(setModels).catch((e) => setError(e.message));
  };
  useEffect(load, [conn.id, conn.baseUrl, conn.hasKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const favs = conn.favorites;
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const known = new Map((models || []).map((m) => [m.id, m]));
    let list = tab === 'fav' ? favs.map((id) => known.get(id) || { id, name: id, context: 0, promptPrice: 0, completionPrice: 0, unknown: true }) : models || [];
    list = list.filter((m) => (!q || m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q)) && (!freeOnly || (m.promptPrice === 0 && m.completionPrice === 0)));
    if (tab === 'all') list = [...list.filter((m) => favs.includes(m.id)), ...list.filter((m) => !favs.includes(m.id))];
    return list;
  }, [models, query, tab, freeOnly, favs]);

  async function select(id) {
    try {
      await api.updateConnection(conn.id, { model: id });
      await refresh('settings');
      toast('Modelo seleccionado');
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  async function toggleFav(id) {
    try {
      await api.toggleFavorite(conn.id, id);
      await refresh('settings');
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  const isLocal = conn.type === 'local';
  return (
    <section className="card">
      <h3>Modelo — {conn.name}</h3>
      <p>
        Actual: <strong>{conn.model || 'ninguno seleccionado'}</strong>
      </p>
      <div className="tabs">
        <button className={tab === 'all' ? 'active' : ''} onClick={() => setTab('all')}>
          Todos{models ? ` (${models.length})` : ''}
        </button>
        <button className={tab === 'fav' ? 'active' : ''} onClick={() => setTab('fav')}>
          ★ Favoritos ({favs.length})
        </button>
      </div>
      {error && (
        <p className="err">
          {error}{' '}
          <button className="btn small" onClick={load}>
            Reintentar
          </button>
        </p>
      )}
      {!error && !models && tab === 'all' && <p className="muted">Cargando modelos…</p>}
      {(models || tab === 'fav') && (
        <>
          <SearchBox
            value={query}
            onChange={(v) => {
              setQuery(v);
              setLimit(60);
            }}
            placeholder="Buscar modelo"
          />
          {!isLocal && (
            <label className="check">
              <input type="checkbox" checked={freeOnly} onChange={(e) => setFreeOnly(e.target.checked)} /> Solo gratuitos
            </label>
          )}
          <ul className="rows model-list">
            {rows.slice(0, limit).map((m) => (
              <li key={m.id} className={`row ${conn.model === m.id ? 'active' : ''}`}>
                <button className={`icon-btn star ${favs.includes(m.id) ? 'on' : ''}`} onClick={() => toggleFav(m.id)} aria-label={favs.includes(m.id) ? 'Quitar de favoritos' : 'Añadir a favoritos'}>
                  <Icon name={favs.includes(m.id) ? 'star' : 'starOutline'} />
                </button>
                <button className="row-main" onClick={() => select(m.id)}>
                  <div className="row-text">
                    <strong>{m.name}</strong>
                    <div className="row-sub">
                      {m.id}
                      {m.unknown ? ' · no está en la lista' : ''}
                      {m.context ? ` · ${Math.round(m.context / 1000)}K ctx` : ''}
                      {!isLocal && !m.unknown ? ` · ${price(m.promptPrice)} entrada · ${price(m.completionPrice)} salida` : ''}
                    </div>
                  </div>
                </button>
              </li>
            ))}
            {!rows.length && <li className="empty small">{tab === 'fav' && !favs.length ? 'Marca modelos con la estrella para tenerlos aquí.' : 'Sin resultados'}</li>}
          </ul>
          {rows.length > limit && (
            <button className="btn" onClick={() => setLimit((l) => l + 100)}>
              Mostrar más ({rows.length - limit})
            </button>
          )}
        </>
      )}
      <Field label="O escribe el ID del modelo" hint={isLocal ? 'Útil si tu servidor no lista sus modelos.' : 'Por ejemplo: anthropic/claude-3.5-sonnet'}>
        <div className="inline">
          <input value={manual} onChange={(e) => setManual(e.target.value)} placeholder="id-del-modelo" autoCapitalize="none" />
          <button
            className="btn"
            disabled={!manual.trim()}
            onClick={async () => {
              await select(manual.trim());
              setManual('');
            }}
          >
            Usar
          </button>
        </div>
      </Field>
    </section>
  );
}
