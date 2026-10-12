import React, { useEffect, useMemo, useState } from 'react';
import { useMatch, useNavigate } from 'react-router-dom';
import { api, chatRoute } from '../api.js';
import { useData } from '../data.jsx';
import { useDialog } from '../dialogs.jsx';
import { formatListDate } from '../util.js';
import { Icon } from '../components/Icon.jsx';
import { CharAvatar, GroupAvatar, Menu, Modal, PersonaAvatar, SearchBox } from '../components/ui.jsx';
import GroupEditor from '../components/GroupEditor.jsx';
import PersonaEditor from '../components/PersonaEditor.jsx';
import PasswordBanner from '../components/PasswordBanner.jsx';
import ChatView from './ChatView.jsx';

export default function ChatsPage() {
  const match = useMatch('/chats/:kind/:owner/:file');
  const { refresh } = useData();
  useEffect(() => {
    refresh('chats');
  }, [refresh]);
  return (
    <div className={`chats-page ${match ? 'has-chat' : ''}`}>
      <ChatList active={match?.params} />
      <section className="chat-pane">
        {match ? (
          <ChatView key={`${match.params.kind}/${match.params.owner}/${match.params.file}`} />
        ) : (
          <div className="empty">
            <Icon name="chat" size={64} />
            <p>Selecciona un chat o inicia uno nuevo</p>
          </div>
        )}
      </section>
    </div>
  );
}

function ChatList({ active }) {
  const { chats, charById, groupById, refresh, toast } = useData();
  const { confirm, prompt } = useDialog();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return chats
      .map((c) => {
        const char = c.kind === 'c' ? charById[c.ownerId] : null;
        const group = c.kind === 'g' ? groupById[c.ownerId] : null;
        return { ...c, char, group, name: char?.name || group?.name || c.ownerId };
      })
      .filter((c) => !q || c.name.toLowerCase().includes(q) || (c.lastMessage?.text || '').toLowerCase().includes(q))
      .sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned))); // estable: dentro de cada grupo sigue el orden por actividad
  }, [chats, charById, groupById, query]);
  const hasPinned = rows.some((c) => c.pinned);

  async function togglePin(c) {
    try {
      await api.pinChat(c, !c.pinned);
      await refresh('chats');
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  async function rename(c) {
    const title = await prompt({ title: 'Renombrar chat', label: `Chat con ${c.name}`, defaultValue: c.title, placeholder: 'Sin nombre', allowEmpty: true, confirmLabel: 'Guardar' });
    if (title === null) return;
    try {
      await api.patchChat(c, { title });
      await refresh('chats');
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  async function copy(c) {
    const base = String(c.title || c.createdAt || c.file).replace(/ \((rama|copia)\)$/, '');
    const title = await prompt({
      title: 'Copiar chat',
      message: `Se duplicará la conversación completa con ${c.name}. El original no cambia.`,
      label: 'Nombre de la copia',
      defaultValue: `${base} (copia)`,
      confirmLabel: 'Crear copia',
    });
    if (title === null) return;
    try {
      await api.copyChat(c, title);
      await refresh('chats');
      toast('Copia creada');
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  async function remove(c) {
    if (!(await confirm({ title: 'Eliminar chat', message: `Se borrará esta conversación con ${c.name}. No se puede deshacer.`, confirmLabel: 'Eliminar', danger: true }))) return;
    try {
      await api.deleteChat(c);
      await refresh('chats');
      if (active && active.kind === c.kind && active.owner === c.ownerId && active.file === c.file) navigate('/chats');
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  return (
    <aside className="chat-list">
      <header className="topbar head-row">
        <h1>Chats</h1>
        <button className="icon-btn" onClick={() => setImporting(true)} aria-label="Importar chat" title="Importar chat (.jsonl)">
          <Icon name="upload" />
        </button>
      </header>
      <PasswordBanner />
      <div className="pad-x">
        <SearchBox value={query} onChange={setQuery} placeholder="Buscar chats" />
      </div>
      <ul className="rows">
        {rows.map((c, i) => {
          const isActive = active && active.kind === c.kind && active.owner === c.ownerId && active.file === c.file;
          const members = c.group ? c.group.members.map((id) => charById[id]).filter(Boolean) : [];
          const label = hasPinned && (i === 0 ? (c.pinned ? 'Fijados' : 'Chats') : !c.pinned && rows[i - 1].pinned ? 'Chats' : null);
          return (
            <React.Fragment key={`${c.kind}/${c.ownerId}/${c.file}`}>
              {label && <li className="section-label">{label}</li>}
            <li className={`row ${isActive ? 'active' : ''}`}>
              <button className="row-main" onClick={() => navigate(chatRoute(c))}>
                {c.kind === 'g' ? <GroupAvatar members={members} /> : <CharAvatar character={c.char} name={c.name} />}
                <div className="row-text">
                  <div className="row-top">
                    <strong>{c.name}</strong>
                    <time>
                      {c.pinned && <Icon name="pin" size={13} />} {formatListDate(c.mtime)}
                    </time>
                  </div>
                  <div className="row-sub">
                    {c.title && <span className="tag">{c.title}</span>}
                    {c.lastMessage ? `${c.lastMessage.isUser ? 'Tú' : c.kind === 'g' ? c.lastMessage.name : ''}${c.lastMessage.isUser || c.kind === 'g' ? ': ' : ''}${c.lastMessage.text.replace(/\*+/g, '')}` : 'Sin mensajes'}
                  </div>
                </div>
              </button>
              <Menu
                items={[
                  { label: c.pinned ? 'Quitar de fijados' : 'Fijar chat', onClick: () => togglePin(c) },
                  { label: 'Renombrar chat', onClick: () => rename(c) },
                  { label: 'Copiar chat', onClick: () => copy(c) },
                  { label: 'Eliminar chat', danger: true, onClick: () => remove(c) },
                ]}
              />
            </li>
            </React.Fragment>
          );
        })}
        {!rows.length && (
          <li className="empty small">
            {chats.length ? 'Sin resultados' : 'Aún no tienes chats. Toca + para empezar uno.'}
          </li>
        )}
      </ul>
      <PersonaCorner active={active} />
      <button className="fab" onClick={() => setCreating(true)} aria-label="Nuevo chat">
        <Icon name="plus" size={28} />
      </button>
      {creating && (
        <NewChatSheet
          onClose={() => setCreating(false)}
          onCreated={(ref) => {
            setCreating(false);
            refresh('chats');
            navigate(chatRoute(ref));
          }}
        />
      )}
      {importing && (
        <ImportChatSheet
          onClose={() => setImporting(false)}
          onDone={(refs) => {
            setImporting(false);
            refresh('chats');
            if (refs.length === 1) navigate(chatRoute(refs[0]));
          }}
        />
      )}
    </aside>
  );
}

// Persona activa: la del chat abierto (o la predeterminada si no hay ninguno). Elegirla también la fija para los chats nuevos.
function PersonaCorner({ active }) {
  const { personas, settings, chats, refresh, toast } = useData();
  const [editing, setEditing] = useState(null);
  const openChat = active ? chats.find((c) => c.kind === active.kind && c.ownerId === active.owner && c.file === active.file) : null;
  const activeId = openChat?.personaId || settings.defaultPersona || '';
  const current = personas.find((p) => p.id === activeId) || null;

  const reloadChat = () => window.dispatchEvent(new Event('chat:reload'));

  async function choose(p) {
    try {
      await api.saveSettings({ defaultPersona: p.id });
      if (openChat) await api.patchChat({ kind: openChat.kind, ownerId: openChat.ownerId, file: openChat.file }, { personaId: p.id });
      await refresh('settings', 'chats');
      reloadChat();
      toast(`Ahora eres ${p.name}`);
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  const items = [
    { header: openChat ? 'Persona activa (este chat y los nuevos)' : 'Persona para los chats nuevos' },
    ...personas.map((p) => ({ label: p.name, icon: <PersonaAvatar persona={p} size={28} />, checked: p.id === activeId, onClick: () => choose(p) })),
    ...(personas.length ? [] : [{ header: 'Aún no tienes personas' }]),
    { separator: true },
    current && { label: `Editar «${current.name}»`, icon: <Icon name="edit" size={20} />, onClick: () => setEditing(current) },
    { label: 'Nueva persona…', icon: <Icon name="plus" size={20} />, onClick: () => setEditing('new') },
  ];

  return (
    <>
      <div className="persona-corner">
        <Menu
          up
          items={items}
          label="Persona activa"
          trigger={
            <span className="persona-trigger-inner">
              <PersonaAvatar persona={current} size={40} />
              <span>{current?.name || 'Usuario'}</span>
            </span>
          }
          className="persona-menu"
        />
      </div>
      {editing && (
        <PersonaEditor
          persona={editing === 'new' ? null : editing}
          onClose={async (changed) => {
            setEditing(null);
            if (changed) {
              await refresh('personas', 'settings', 'chats');
              reloadChat();
            }
          }}
        />
      )}
    </>
  );
}

function ImportChatSheet({ onClose, onDone }) {
  const { characters, groups, toast } = useData();
  const [kind, setKind] = useState('c');
  const [ownerId, setOwnerId] = useState('');
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const owners = kind === 'c' ? characters : groups;

  // Los chats de SillyTavern traen el nombre del personaje en la primera línea.
  async function onFiles(e) {
    const list = [...e.target.files];
    e.target.value = '';
    setFiles(list);
    if (!list[0]) return;
    try {
      const first = (await list[0].slice(0, 300000).text()).split(/\r?\n/)[0];
      const name = String(JSON.parse(first).character_name || '').trim().toLowerCase();
      const char = characters.find((c) => c.name.toLowerCase() === name || c.id.toLowerCase() === name);
      const group = groups.find((g) => g.name.toLowerCase() === name);
      if (char) {
        setKind('c');
        setOwnerId(char.id);
      } else if (group) {
        setKind('g');
        setOwnerId(group.id);
      }
    } catch {
      /* sin cabecera reconocible: el usuario elige destino */
    }
  }

  async function run() {
    setBusy(true);
    const refs = [];
    for (const f of files) {
      try {
        refs.push(await api.importChat(kind, ownerId, f));
      } catch (e) {
        toast(e.message, 'error');
      }
    }
    if (refs.length) toast(`${refs.length} chat(s) importado(s)`);
    setBusy(false);
    if (refs.length) onDone(refs);
  }

  return (
    <Modal
      title="Importar chat"
      onClose={onClose}
      footer={
        <>
          <span className="spacer" />
          <button className="btn primary" disabled={busy || !ownerId || !files.length} onClick={run}>
            Importar{files.length > 1 ? ` (${files.length})` : ''}
          </button>
        </>
      }
    >
      <p className="muted">Archivos .jsonl de SillyTavern (o exportados desde aquí). Se añaden como chats nuevos; no se mezclan con los existentes.</p>
      <label className="field">
        <span className="field-label">Archivo(s)</span>
        <input type="file" accept=".jsonl,.json,application/json,text/plain" multiple onChange={onFiles} />
      </label>
      {files.length > 0 && <p className="muted">{files.map((f) => f.name).join(', ')}</p>}
      <div className="tabs">
        <button
          className={kind === 'c' ? 'active' : ''}
          onClick={() => {
            setKind('c');
            setOwnerId('');
          }}
        >
          Personaje
        </button>
        <button
          className={kind === 'g' ? 'active' : ''}
          onClick={() => {
            setKind('g');
            setOwnerId('');
          }}
        >
          Grupo
        </button>
      </div>
      <label className="field">
        <span className="field-label">{kind === 'c' ? 'Importar al personaje' : 'Importar al grupo'}</span>
        <select value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
          <option value="">Elegir…</option>
          {owners.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      </label>
    </Modal>
  );
}

function NewChatSheet({ onClose, onCreated }) {
  const { characters, groups, personas, settings, charById, toast } = useData();
  const [tab, setTab] = useState('c');
  const [query, setQuery] = useState('');
  const [personaId, setPersonaId] = useState(settings?.defaultPersona || personas[0]?.id || '');
  const [editingGroup, setEditingGroup] = useState(null);
  const [busy, setBusy] = useState(false);

  const persona = personas.find((p) => p.id === personaId);
  const q = query.trim().toLowerCase();

  async function start(kind, ownerId) {
    if (busy) return;
    setBusy(true);
    try {
      const { file } = await api.createChat(kind, ownerId, personaId);
      onCreated({ kind, ownerId, file });
    } catch (e) {
      toast(e.message, 'error');
      setBusy(false);
    }
  }

  return (
    <>
      <Modal title="Nuevo chat" onClose={onClose}>
        <div className="tabs">
          <button className={tab === 'c' ? 'active' : ''} onClick={() => setTab('c')}>
            Personaje
          </button>
          <button className={tab === 'g' ? 'active' : ''} onClick={() => setTab('g')}>
            Grupo
          </button>
        </div>
        <label className="field persona-pick">
          <span className="field-label">Hablar como</span>
          <div className="inline">
            <PersonaAvatar persona={persona} size={32} />
            <select value={personaId} onChange={(e) => setPersonaId(e.target.value)}>
              <option value="">Usuario (sin persona)</option>
              {personas.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
        </label>
        {tab === 'c' ? (
          <>
            <SearchBox value={query} onChange={setQuery} placeholder="Buscar personaje" />
            <ul className="rows">
              {characters
                .filter((c) => !q || c.name.toLowerCase().includes(q) || c.tags.some((t) => t.toLowerCase().includes(q)))
                .map((c) => (
                  <li key={c.id} className="row">
                    <button className="row-main" disabled={busy} onClick={() => start('c', c.id)}>
                      <CharAvatar character={c} />
                      <div className="row-text">
                        <strong>{c.name}</strong>
                        <div className="row-sub">{(c.description || 'Sin descripción').replace(/\{\{char\}\}/gi, c.name)}</div>
                      </div>
                    </button>
                  </li>
                ))}
              {!characters.length && <li className="empty small">No hay personajes. Créalos o impórtalos en Ajustes → Personajes.</li>}
            </ul>
          </>
        ) : (
          <>
            <button className="btn" onClick={() => setEditingGroup('new')}>
              <Icon name="group" size={18} /> Crear grupo
            </button>
            <ul className="rows">
              {groups.map((g) => (
                <li key={g.id} className="row">
                  <button className="row-main" disabled={busy} onClick={() => start('g', g.id)}>
                    <GroupAvatar members={g.members.map((id) => charById[id]).filter(Boolean)} />
                    <div className="row-text">
                      <strong>{g.name}</strong>
                      <div className="row-sub">{g.members.map((id) => charById[id]?.name || id).join(', ')}</div>
                    </div>
                  </button>
                </li>
              ))}
              {!groups.length && <li className="empty small">Aún no hay grupos.</li>}
            </ul>
          </>
        )}
      </Modal>
      {editingGroup && (
        <GroupEditor
          onClose={() => setEditingGroup(null)}
          onSaved={(g) => {
            setEditingGroup(null);
            start('g', g.id);
          }}
        />
      )}
    </>
  );
}
