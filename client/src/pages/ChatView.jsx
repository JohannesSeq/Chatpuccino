import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useMatch, useNavigate } from 'react-router-dom';
import { api, chatUrl, generate } from '../api.js';
import { useData } from '../data.jsx';
import { formatRP, formatTime, isTouch } from '../util.js';
import { Icon } from '../components/Icon.jsx';
import { CharAvatar, GroupAvatar, Menu, Modal, PersonaAvatar } from '../components/ui.jsx';
import GroupEditor from '../components/GroupEditor.jsx';

const nameHue = (name) => {
  let h = 0;
  for (const ch of name || '?') h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % 360;
};

export default function ChatView() {
  const { params } = useMatch('/chats/:kind/:owner/:file');
  const ref = useMemo(() => ({ kind: params.kind, ownerId: params.owner, file: params.file }), [params.kind, params.owner, params.file]);
  const navigate = useNavigate();
  const { charById, groupById, personas, settings, refresh, toast } = useData();

  const [chat, setChat] = useState(null);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(null);
  const [selected, setSelected] = useState(null);
  const [editing, setEditing] = useState(null);
  const [personaSheet, setPersonaSheet] = useState(false);
  const [groupSheet, setGroupSheet] = useState(false);

  const abortRef = useRef(null);
  const stopRef = useRef(false);
  const listRef = useRef(null);
  const stick = useRef(true);
  const generating = streaming !== null;

  const isGroup = ref.kind === 'g';
  const group = isGroup ? groupById[ref.ownerId] : null;
  const character = !isGroup ? charById[ref.ownerId] : null;
  const members = useMemo(() => (isGroup ? (group?.members || []).map((id) => charById[id]).filter(Boolean) : character ? [character] : []), [isGroup, group, character, charById]);
  const title = isGroup ? group?.name || ref.ownerId : character?.name || ref.ownerId;

  const load = useCallback(async () => {
    try {
      setChat(await api.chat(ref));
    } catch (e) {
      toast(e.message, 'error');
      navigate('/chats');
    }
  }, [ref, navigate, toast]);

  useEffect(() => {
    stick.current = true;
    load();
  }, [load]);

  useLayoutEffect(() => {
    const el = listRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [chat?.messages.length, streaming?.text, streaming?.replaceIndex]);

  const onScroll = () => {
    const el = listRef.current;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 140;
  };

  const speakerOf = (msg) => {
    if (!isGroup) return character;
    const id = msg.original_avatar?.replace(/\.png$/i, '');
    return members.find((m) => m.id === id) || members.find((m) => m.name === msg.name);
  };

  async function runGeneration(speaker, swipe) {
    const ac = new AbortController();
    abortRef.current = ac;
    const replaceIndex = swipe ? chat.messages.length - 1 : null;
    stick.current = true;
    setStreaming({ name: speaker?.name || title, characterId: speaker?.id, text: '', replaceIndex });
    try {
      const out = await generate(ref, { speakerId: speaker?.id, swipe }, ac.signal, (d) => setStreaming((s) => (s ? { ...s, text: s.text + d } : s)));
      if (out) {
        setChat((c) => {
          const messages = [...c.messages];
          if (swipe) messages[out.index] = out.message;
          else messages.push(out.message);
          return { ...c, messages };
        });
      }
    } catch (e) {
      if (e.name !== 'AbortError') toast(e.message, 'error');
      else await new Promise((r) => setTimeout(r, 400));
      await load();
    } finally {
      setStreaming(null);
      abortRef.current = null;
    }
  }

  async function runReplies(speakers, swipe = false) {
    stopRef.current = false;
    for (const s of speakers) {
      if (stopRef.current) break;
      await runGeneration(s, swipe);
    }
    refresh('chats');
  }

  function pickSpeakers(text) {
    if (!isGroup) return [character];
    const mode = group?.replyMode || 'smart';
    if (mode === 'manual') return [];
    if (mode === 'all') return members;
    const lower = text.toLowerCase();
    const mentioned = members.filter((m) => {
      const names = [m.name, m.name.split(/\s+/)[0]].filter((n) => n.length > 1);
      return names.some((n) => new RegExp(`(^|[^\\p{L}])${n.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}])`, 'u').test(lower));
    });
    if (mentioned.length) return mentioned;
    const lastNpc = [...chat.messages].reverse().find((m) => !m.is_user);
    const lastIdx = lastNpc ? members.indexOf(speakerOf(lastNpc)) : -1;
    return [members[(lastIdx + 1) % members.length]];
  }

  async function send() {
    if (generating) return;
    const text = input.trim();
    if (text) {
      setInput('');
      try {
        const { message } = await api.addMessage(ref, text);
        stick.current = true;
        setChat((c) => ({ ...c, messages: [...c.messages, message] }));
      } catch (e) {
        setInput(text);
        toast(e.message, 'error');
        return;
      }
    }
    const lastIsUser = text || chat.messages.at(-1)?.is_user;
    if (!lastIsUser && !text) return;
    const speakers = text ? pickSpeakers(text) : pickSpeakers(chat.messages.at(-1)?.mes || '');
    if (speakers.length) await runReplies(speakers);
    else refresh('chats');
  }

  const stop = () => {
    stopRef.current = true;
    abortRef.current?.abort();
  };

  async function swipeTo(i, delta) {
    const m = chat.messages[i];
    const id = (m.swipe_id ?? 0) + delta;
    if (id < 0 || id >= (m.swipes?.length || 1)) return;
    try {
      const updated = await api.setSwipe(ref, i, id);
      setChat((c) => ({ ...c, messages: c.messages.map((x, k) => (k === i ? updated : x)) }));
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  async function saveEdit() {
    try {
      const updated = await api.editMessage(ref, editing.index, editing.text);
      setChat((c) => ({ ...c, messages: c.messages.map((x, k) => (k === editing.index ? updated : x)) }));
      setEditing(null);
      setSelected(null);
      refresh('chats');
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  async function removeMessage(i) {
    if (!window.confirm('¿Borrar este mensaje?')) return;
    try {
      await api.deleteMessage(ref, i);
      setSelected(null);
      await load();
      refresh('chats');
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  async function renameChat() {
    const t = window.prompt('Nombre del chat', chat.title);
    if (t === null) return;
    try {
      await api.patchChat(ref, { title: t });
      await load();
      refresh('chats');
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  async function deleteChat() {
    if (!window.confirm('¿Eliminar este chat? No se puede deshacer.')) return;
    try {
      await api.deleteChat(ref);
      await refresh('chats');
      navigate('/chats');
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  async function choosePersona(id) {
    setPersonaSheet(false);
    try {
      await api.patchChat(ref, { personaId: id });
      await load();
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !isTouch()) {
      e.preventDefault();
      send();
    }
  };

  if (!chat) return <div className="empty">Cargando chat…</div>;

  const messages = chat.messages;
  const lastIdx = messages.length - 1;
  const needsSetup = settings && (!settings.hasKey || !settings.model);
  const lastIsUser = messages.at(-1)?.is_user;

  return (
    <div className="chat-view">
      <header className="chat-head">
        <button className="icon-btn back" onClick={() => navigate('/chats')} aria-label="Volver">
          <Icon name="back" />
        </button>
        {isGroup ? <GroupAvatar members={members} size={40} /> : <CharAvatar character={character} name={title} size={40} />}
        <div className="chat-head-text">
          <strong>{title}</strong>
          <small>{generating ? `${streaming.name} está escribiendo…` : isGroup ? members.map((m) => m.name).join(', ') : chat.title || `Tú: ${chat.persona.name}`}</small>
        </div>
        <Menu
          items={[
            { label: 'Renombrar chat', onClick: renameChat },
            { label: `Persona: ${chat.persona.name}`, onClick: () => setPersonaSheet(true) },
            isGroup && group && { label: 'Editar grupo', onClick: () => setGroupSheet(true) },
            { label: 'Exportar chat (.jsonl)', href: `/api${chatUrl(ref)}/export`, download: `${ref.file}.jsonl` },
            { label: 'Eliminar chat', danger: true, onClick: deleteChat },
          ]}
        />
      </header>

      {needsSetup && (
        <div className="banner">
          Falta configurar {!settings.hasKey ? 'la API key' : 'el modelo'} de OpenRouter. <Link to="/settings/conexion">Ir a Ajustes</Link>
        </div>
      )}

      <div className="messages" ref={listRef} onScroll={onScroll}>
        {messages.map((m, i) => {
          if (streaming?.replaceIndex === i) return null;
          if (m.is_system) return <div key={i} className="system-msg">{m.mes}</div>;
          const speaker = m.is_user ? null : speakerOf(m);
          const isLastBot = i === lastIdx && !m.is_user;
          const swipes = m.swipes?.length || 1;
          return (
            <div key={i} className={`msg ${m.is_user ? 'me' : 'them'} ${selected === i ? 'selected' : ''}`}>
              {!m.is_user && isGroup && <CharAvatar character={speaker} name={m.name} size={32} />}
              <div className="bubble-wrap">
                <div className="bubble" onClick={() => setSelected(selected === i ? null : i)}>
                  {!m.is_user && isGroup && (
                    <div className="sender" style={{ color: `hsl(${nameHue(m.name)} 70% 70%)` }}>
                      {m.name}
                    </div>
                  )}
                  {editing?.index === i ? (
                    <div onClick={(e) => e.stopPropagation()}>
                      <textarea className="edit-area" autoFocus value={editing.text} onChange={(e) => setEditing({ ...editing, text: e.target.value })} rows={Math.min(12, editing.text.split('\n').length + 1)} />
                      <div className="edit-actions">
                        <button className="btn small" onClick={() => setEditing(null)}>
                          Cancelar
                        </button>
                        <button className="btn small primary" onClick={saveEdit}>
                          Guardar
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="text" dangerouslySetInnerHTML={{ __html: formatRP(m.mes) }} />
                  )}
                  <time>{formatTime(m.send_date)}</time>
                </div>
                {selected === i && !editing && (
                  <div className="actions">
                    <button onClick={() => setEditing({ index: i, text: m.mes })}>
                      <Icon name="edit" size={16} /> Editar
                    </button>
                    <button onClick={() => navigator.clipboard?.writeText(m.mes).then(() => toast('Copiado'))}>
                      <Icon name="copy" size={16} /> Copiar
                    </button>
                    <button className="danger" onClick={() => removeMessage(i)}>
                      <Icon name="trash" size={16} /> Borrar
                    </button>
                  </div>
                )}
                {isLastBot && !generating && (
                  <div className="swipes">
                    <button disabled={(m.swipe_id ?? 0) <= 0} onClick={() => swipeTo(i, -1)} aria-label="Anterior">
                      <Icon name="left" size={18} />
                    </button>
                    <span>
                      {(m.swipe_id ?? 0) + 1}/{swipes}
                    </span>
                    <button disabled={(m.swipe_id ?? 0) >= swipes - 1} onClick={() => swipeTo(i, 1)} aria-label="Siguiente">
                      <Icon name="right" size={18} />
                    </button>
                    <button onClick={() => runReplies([speaker || members[0]], true)} aria-label="Regenerar" title="Generar otra respuesta">
                      <Icon name="refresh" size={18} />
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
        {streaming && (
          <div className="msg them">
            {isGroup && <CharAvatar character={charById[streaming.characterId]} name={streaming.name} size={32} />}
            <div className="bubble-wrap">
              <div className="bubble">
                {isGroup && (
                  <div className="sender" style={{ color: `hsl(${nameHue(streaming.name)} 70% 70%)` }}>
                    {streaming.name}
                  </div>
                )}
                {streaming.text ? <div className="text" dangerouslySetInnerHTML={{ __html: formatRP(streaming.text) }} /> : <div className="typing"><i /><i /><i /></div>}
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="composer">
        {isGroup && (
          <div className="chips">
            {members.map((m) => (
              <button key={m.id} className="chip" disabled={generating} onClick={() => runReplies([m])} title={`Hacer que responda ${m.name}`}>
                <CharAvatar character={m} size={22} /> {m.name.split(/\s+/)[0]}
              </button>
            ))}
          </div>
        )}
        {!isGroup && lastIsUser && !generating && (
          <div className="chips">
            <button className="chip" onClick={() => runReplies([character])}>
              Generar respuesta
            </button>
          </div>
        )}
        <div className="input-row">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Escribe un mensaje"
            rows={1}
            style={{ height: Math.min(140, 24 + Math.max(0, input.split('\n').length - 1) * 22) }}
          />
          {generating ? (
            <button className="send stop" onClick={stop} aria-label="Detener">
              <Icon name="stop" />
            </button>
          ) : (
            <button className="send" onClick={send} disabled={!input.trim() && !lastIsUser} aria-label="Enviar">
              <Icon name="send" />
            </button>
          )}
        </div>
      </div>

      {personaSheet && (
        <Modal title="Persona de este chat" onClose={() => setPersonaSheet(false)}>
          <ul className="rows">
            {personas.map((p) => (
              <li key={p.id} className={`row ${chat.persona.id === p.id ? 'active' : ''}`}>
                <button className="row-main" onClick={() => choosePersona(p.id)}>
                  <PersonaAvatar persona={p} />
                  <div className="row-text">
                    <strong>{p.name}</strong>
                    <div className="row-sub">{p.description || 'Sin descripción'}</div>
                  </div>
                </button>
              </li>
            ))}
            {!personas.length && <li className="empty small">Crea personas en Ajustes → Personas.</li>}
          </ul>
        </Modal>
      )}
      {groupSheet && group && (
        <GroupEditor
          group={group}
          onClose={() => setGroupSheet(false)}
          onSaved={() => setGroupSheet(false)}
          onDeleted={() => {
            setGroupSheet(false);
            navigate('/chats');
          }}
        />
      )}
    </div>
  );
}
