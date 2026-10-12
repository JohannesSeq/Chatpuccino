import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useMatch, useNavigate } from 'react-router-dom';
import { api, chatUrl, generate, impersonate } from '../api.js';
import { useData } from '../data.jsx';
import { useDialog } from '../dialogs.jsx';
import { formatRP, formatTime, isTouch } from '../util.js';
import { Icon } from '../components/Icon.jsx';
import { CharAvatar, GroupAvatar, Menu, Modal, PersonaAvatar, ViewableAvatar } from '../components/ui.jsx';
import GroupEditor from '../components/GroupEditor.jsx';
import { CharacterEditor } from './settings/CharactersTab.jsx';

const nameHue = (name) => {
  let h = 0;
  for (const ch of name || '?') h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % 360;
};

export default function ChatView() {
  const { params } = useMatch('/chats/:kind/:owner/:file');
  const ref = useMemo(() => ({ kind: params.kind, ownerId: params.owner, file: params.file }), [params.kind, params.owner, params.file]);
  const navigate = useNavigate();
  const { charById, groupById, personas, settings, chats, refresh, toast } = useData();
  const { confirm, prompt } = useDialog();

  const [chat, setChat] = useState(null);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(null);
  const [selected, setSelected] = useState(null);
  const [editing, setEditing] = useState(null);
  const [personaSheet, setPersonaSheet] = useState(false);
  const [modelSheet, setModelSheet] = useState(false);
  const [presetSheet, setPresetSheet] = useState(false);
  const [inspector, setInspector] = useState(false);
  const [groupSheet, setGroupSheet] = useState(false);
  const [convertSheet, setConvertSheet] = useState(false);
  const [cardId, setCardId] = useState(null);

  const abortRef = useRef(null);
  const impersonateAbort = useRef(null);
  const inputRef = useRef(null);
  const [impersonating, setImpersonating] = useState(false);
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

  // Otras partes de la app (p. ej. el selector de persona) piden recargar el chat abierto.
  useEffect(() => {
    const reload = () => load();
    window.addEventListener('chat:reload', reload);
    return () => window.removeEventListener('chat:reload', reload);
  }, [load]);

  useLayoutEffect(() => {
    const el = listRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [chat?.messages.length, streaming?.text, streaming?.replaceIndex]);

  // El cuadro de texto crece con su contenido (incluidas las líneas envueltas) hasta su max-height y luego hace scroll.
  const fitInput = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + el.offsetHeight - el.clientHeight}px`;
    const list = listRef.current;
    if (list && stick.current) list.scrollTop = list.scrollHeight;
  }, []);
  const chatReady = chat !== null;
  useLayoutEffect(fitInput, [input, chatReady, fitInput]);
  useEffect(() => {
    window.addEventListener('resize', fitInput);
    return () => window.removeEventListener('resize', fitInput);
  }, [fitInput]);

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

  // Impersonar: el modelo escribe tu mensaje en la caja de texto; lo que ya hubieras escrito sirve de punto de partida.
  async function impersonateMe() {
    if (generating || impersonating) return;
    const draft = input.trim();
    const ac = new AbortController();
    impersonateAbort.current = ac;
    setImpersonating(true);
    setInput('');
    let text = '';
    try {
      const out = await impersonate(ref, { draft }, ac.signal, (d) => {
        text += d;
        setInput(text);
      });
      if (out?.text) setInput(out.text);
    } catch (e) {
      if (e.name !== 'AbortError') toast(e.message, 'error');
      if (!text.trim()) setInput(draft);
    } finally {
      impersonateAbort.current = null;
      setImpersonating(false);
      inputRef.current?.focus();
    }
  }

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

  async function removeSwipe(i) {
    const m = chat.messages[i];
    const ok = await confirm({
      title: 'Eliminar variante',
      message: `Se eliminará la variante ${(m.swipe_id ?? 0) + 1} de ${m.swipes.length}. El mensaje conserva las demás.`,
      confirmLabel: 'Eliminar variante',
      danger: true,
    });
    if (!ok) return;
    try {
      const updated = await api.deleteSwipe(ref, i);
      setChat((c) => ({ ...c, messages: c.messages.map((x, k) => (k === i ? updated : x)) }));
      refresh('chats');
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  async function branchFrom(i) {
    const base = String(chat.title || chat.meta.create_date || ref.file).replace(/ \(rama\)$/, '');
    const title = await prompt({
      title: 'Ramificar chat',
      message: 'Se creará una copia del chat con los mensajes hasta este punto (inclusive). El chat original no cambia.',
      label: 'Nombre de la rama',
      defaultValue: `${base} (rama)`,
      confirmLabel: 'Crear rama',
    });
    if (title === null) return;
    try {
      const created = await api.branchChat(ref, i, title);
      setSelected(null);
      await refresh('chats');
      toast('Rama creada: ahora estás en la copia');
      navigate(chatUrl(created));
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
    if (!(await confirm({ title: 'Borrar mensaje', message: 'Este mensaje se eliminará del chat.', confirmLabel: 'Borrar', danger: true }))) return;
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
    const t = await prompt({ title: 'Renombrar chat', label: 'Nombre del chat', defaultValue: chat.title, placeholder: 'Sin nombre', allowEmpty: true, confirmLabel: 'Guardar' });
    if (t === null) return;
    try {
      await api.patchChat(ref, { title: t });
      await load();
      refresh('chats');
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  const pinned = chats.some((c) => c.kind === ref.kind && c.ownerId === ref.ownerId && c.file === ref.file && c.pinned);

  async function togglePin() {
    try {
      await api.pinChat(ref, !pinned);
      await refresh('chats');
      toast(pinned ? 'Chat desfijado' : 'Chat fijado');
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  async function copyChat() {
    const base = String(chat.title || chat.meta.create_date || ref.file).replace(/ \((rama|copia)\)$/, '');
    const title = await prompt({
      title: 'Copiar chat',
      message: 'Se duplicará la conversación completa como un chat independiente. Este chat no cambia.',
      label: 'Nombre de la copia',
      defaultValue: `${base} (copia)`,
      confirmLabel: 'Crear copia',
    });
    if (title === null) return;
    try {
      await api.copyChat(ref, title);
      await refresh('chats');
      toast('Copia creada');
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  async function deleteChat() {
    if (!(await confirm({ title: 'Eliminar chat', message: 'Se borrará toda la conversación. No se puede deshacer.', confirmLabel: 'Eliminar', danger: true }))) return;
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
  const needsSetup = settings && !settings.ready;
  const lastIsUser = messages.at(-1)?.is_user;

  return (
    <div className="chat-view">
      <header className="chat-head">
        <button className="icon-btn back" onClick={() => navigate('/chats')} aria-label="Volver">
          <Icon name="back" />
        </button>
        {isGroup ? <GroupAvatar members={members} size={40} /> : <ViewableAvatar character={character} name={title} size={40} />}
        <div className="chat-head-text">
          {!isGroup && character ? (
            <button className="name-link head-name" onClick={() => setCardId(character.id)} title="Ver tarjeta del personaje">
              <strong>{title}</strong>
            </button>
          ) : (
            <strong>{title}</strong>
          )}
          <small>{generating ? `${streaming.name} está escribiendo…` : isGroup ? members.map((m) => m.name).join(', ') : chat.title || `Tú: ${chat.persona.name}`}</small>
        </div>
        <Menu
          items={[
            { label: pinned ? 'Quitar de fijados' : 'Fijar chat', onClick: togglePin },
            { label: 'Renombrar chat', onClick: renameChat },
            { label: 'Copiar chat', onClick: copyChat },
            { label: `Persona: ${chat.persona.name}`, onClick: () => setPersonaSheet(true) },
            { label: `Modelo: ${settings.model || 'sin elegir'}`, onClick: () => setModelSheet(true) },
            { label: `Preset: ${settings.activePreset || '—'}`, onClick: () => setPresetSheet(true) },
            { label: 'Ver prompt que se enviará', onClick: () => setInspector(true) },
            isGroup && group && { label: 'Editar grupo', onClick: () => setGroupSheet(true) },
            !isGroup && character && { label: 'Convertir en grupo…', onClick: () => setConvertSheet(true) },
            { label: 'Exportar chat (.jsonl)', href: `/api${chatUrl(ref)}/export`, download: `${ref.file}.jsonl` },
            { label: 'Eliminar chat', danger: true, onClick: deleteChat },
          ]}
        />
      </header>

      {needsSetup && (
        <div className="banner">
          Falta configurar {settings.setupHint} de la conexión activa. <Link to="/settings/conexion">Ir a Ajustes</Link>
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
              {!m.is_user && isGroup && <ViewableAvatar character={speaker} name={m.name} size={32} />}
              <div className="bubble-wrap">
                <div className="bubble" onClick={() => setSelected(selected === i ? null : i)}>
                  {!m.is_user && isGroup && (
                    <div className="sender" style={{ color: `hsl(${nameHue(m.name)} 65% var(--sender-l))` }}>
                      {speaker ? (
                        <button
                          className="name-link"
                          onClick={(e) => {
                            e.stopPropagation();
                            setCardId(speaker.id);
                          }}
                          title="Ver tarjeta del personaje"
                        >
                          {m.name}
                        </button>
                      ) : (
                        m.name
                      )}
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
                    <button onClick={() => branchFrom(i)} title="Crear una copia del chat hasta este mensaje">
                      <Icon name="branch" size={16} /> Ramificar
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
                    {swipes > 1 && (
                      <button className="danger" onClick={() => removeSwipe(i)} aria-label="Eliminar esta variante" title="Eliminar esta variante">
                        <Icon name="trash" size={18} />
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
        {streaming && (
          <div className="msg them">
            {isGroup && <ViewableAvatar character={charById[streaming.characterId]} name={streaming.name} size={32} />}
            <div className="bubble-wrap">
              <div className="bubble">
                {isGroup && (
                  <div className="sender" style={{ color: `hsl(${nameHue(streaming.name)} 65% var(--sender-l))` }}>
                    {charById[streaming.characterId] ? (
                      <button className="name-link" onClick={() => setCardId(streaming.characterId)} title="Ver tarjeta del personaje">
                        {streaming.name}
                      </button>
                    ) : (
                      streaming.name
                    )}
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
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            readOnly={impersonating}
            placeholder={impersonating ? 'Escribiendo por ti…' : 'Escribe un mensaje'}
            rows={1}
          />
          {impersonating ? (
            <button className="icon-btn impersonate on" onClick={() => impersonateAbort.current?.abort()} aria-label="Detener" title="Detener">
              <Icon name="stop" />
            </button>
          ) : (
            <button className="icon-btn impersonate" onClick={impersonateMe} disabled={generating} aria-label="Impersonar" title="Impersonar: la IA escribe un mensaje por ti (lo que ya hayas escrito sirve de inicio)">
              <Icon name="wand" />
            </button>
          )}
          {generating ? (
            <button className="send stop" onClick={stop} aria-label="Detener">
              <Icon name="stop" />
            </button>
          ) : (
            <button className="send" onClick={send} disabled={impersonating || (!input.trim() && !lastIsUser)} aria-label="Enviar">
              <Icon name="send" />
            </button>
          )}
        </div>
      </div>

      {modelSheet && <ModelSheet onClose={() => setModelSheet(false)} />}
      {presetSheet && <PresetSheet onClose={() => setPresetSheet(false)} />}
      {inspector && <PromptInspector chatRef={ref} members={members} isGroup={isGroup} onClose={() => setInspector(false)} />}
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
      {convertSheet && character && <ConvertToGroupSheet chatRef={ref} character={character} onClose={() => setConvertSheet(false)} />}
      {cardId && (
        <Modal title="Tarjeta de personaje" wide onClose={() => setCardId(null)}>
          <CharacterEditor
            key={cardId}
            id={cardId}
            onClose={async (changed, info) => {
              setCardId(null);
              if (!changed) return;
              await refresh('characters', 'lorebooks', 'groups', 'chats');
              if (info?.deleted && cardId === ref.ownerId) navigate('/chats');
            }}
          />
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

function ConvertToGroupSheet({ chatRef, character, onClose }) {
  const { characters, refresh, toast } = useData();
  const navigate = useNavigate();
  const [name, setName] = useState(`${character.name} y amigos`);
  const [chosen, setChosen] = useState([]);
  const [replyMode, setReplyMode] = useState('smart');
  const [keepOriginal, setKeepOriginal] = useState(false);
  const [busy, setBusy] = useState(false);
  const others = characters.filter((c) => c.id !== character.id);
  const toggle = (id) => setChosen((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));

  async function submit(e) {
    e.preventDefault();
    if (busy || !name.trim() || !chosen.length) return;
    setBusy(true);
    try {
      const created = await api.chatToGroup(chatRef, { name: name.trim(), members: chosen, replyMode, keepOriginal });
      await refresh('groups', 'chats');
      toast('Chat convertido en grupo');
      onClose();
      navigate(chatUrl(created));
    } catch (err) {
      toast(err.message, 'error');
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Convertir en grupo"
      onClose={onClose}
      footer={
        <>
          <span className="spacer" />
          <button className="btn" type="button" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn primary" disabled={busy || !name.trim() || !chosen.length} onClick={submit}>
            Convertir
          </button>
        </>
      }
    >
      <form onSubmit={submit}>
        <p className="muted">
          Se crea un grupo con {character.name} y los personajes que elijas, y esta conversación pasa a ser un chat del grupo con todo su historial.
        </p>
        <label className="field">
          <span className="field-label">Nombre del grupo</span>
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <div className="field-label">Añadir personajes ({chosen.length})</div>
        <div className="pick-list">
          {others.map((c) => (
            <label key={c.id} className="pick-row">
              <input type="checkbox" checked={chosen.includes(c.id)} onChange={() => toggle(c.id)} />
              <CharAvatar character={c} size={36} />
              <span>{c.name}</span>
            </label>
          ))}
          {!others.length && <p className="muted">No hay otros personajes. Crea o importa más en Ajustes → Personajes.</p>}
        </div>
        <label className="field">
          <span className="field-label">Quién responde</span>
          <select value={replyMode} onChange={(e) => setReplyMode(e.target.value)}>
            <option value="smart">Inteligente: el mencionado, o el siguiente por turnos</option>
            <option value="all">Todos, uno tras otro</option>
            <option value="manual">Manual: yo elijo quién responde</option>
          </select>
        </label>
        <label className="check">
          <input type="checkbox" checked={keepOriginal} onChange={(e) => setKeepOriginal(e.target.checked)} /> Conservar también el chat original con {character.name}
        </label>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

function ModelSheet({ onClose }) {
  const { settings, refresh, toast } = useData();
  const active = settings.connections.find((c) => c.id === settings.activeConnection);

  async function run(fn) {
    try {
      await fn();
      await refresh('settings');
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  return (
    <Modal title="Modelo" onClose={onClose}>
      {settings.connections.length > 1 && (
        <label className="field">
          <span className="field-label">Conexión</span>
          <select value={active?.id || ''} onChange={(e) => run(() => api.activateConnection(e.target.value))}>
            {settings.connections.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.type === 'local' ? 'local' : 'OpenRouter'})
              </option>
            ))}
          </select>
        </label>
      )}
      {active ? (
        <>
          <div className="field-label">Favoritos de {active.name}</div>
          <ul className="rows">
            {[...new Set([active.model, ...active.favorites].filter(Boolean))].map((id) => (
              <li key={id} className={`row ${active.model === id ? 'active' : ''}`}>
                <button
                  className="row-main"
                  onClick={() =>
                    run(async () => {
                      await api.updateConnection(active.id, { model: id });
                      onClose();
                    })
                  }
                >
                  <div className="row-text">
                    <strong>{id}</strong>
                    <div className="row-sub">{active.model === id ? 'En uso' : active.favorites.includes(id) ? '★ Favorito' : ''}</div>
                  </div>
                </button>
              </li>
            ))}
            {!active.favorites.length && <li className="empty small">Marca modelos con la estrella en Ajustes → Conexión y modelo para verlos aquí.</li>}
          </ul>
        </>
      ) : (
        <p className="muted">No hay conexiones configuradas.</p>
      )}
      <Link className="btn" to="/settings/conexion" onClick={onClose}>
        Ver todos los modelos
      </Link>
    </Modal>
  );
}

function PresetSheet({ onClose }) {
  const { settings, refresh, toast } = useData();
  const [list, setList] = useState(null);

  useEffect(() => {
    api.presets().then(setList).catch((e) => toast(e.message, 'error'));
  }, [toast]);

  async function pick(name) {
    try {
      await api.saveSettings({ activePreset: name });
      await refresh('settings');
      onClose();
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  return (
    <Modal title="Preset de generación" onClose={onClose}>
      <ul className="rows">
        {(list?.presets || []).map((n) => (
          <li key={n} className={`row ${settings.activePreset === n ? 'active' : ''}`}>
            <button className="row-main" onClick={() => pick(n)}>
              <div className="row-text">
                <strong>{n}</strong>
                <div className="row-sub">{settings.activePreset === n ? 'En uso' : ''}</div>
              </div>
            </button>
          </li>
        ))}
        {!list && <li className="empty small">Cargando…</li>}
      </ul>
      <Link className="btn" to="/settings/presets" onClick={onClose}>
        Editar presets
      </Link>
    </Modal>
  );
}

function PromptInspector({ chatRef, members, isGroup, onClose }) {
  const { toast } = useData();
  const [speakerId, setSpeakerId] = useState(members[0]?.id || '');
  const [data, setData] = useState(null);

  useEffect(() => {
    setData(null);
    api.inspectPrompt(chatRef, { speakerId }).then(setData).catch((e) => {
      toast(e.message, 'error');
      onClose();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatRef, speakerId]);

  return (
    <Modal title="Prompt que se enviará" onClose={onClose} wide>
      {isGroup && (
        <label className="field">
          <span className="field-label">Si responde…</span>
          <select value={speakerId} onChange={(e) => setSpeakerId(e.target.value)}>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {!data ? (
        <p className="muted">Cargando…</p>
      ) : (
        <>
          <p className="muted">
            Preset «{data.preset}» · ~{data.totalTokens} tokens + hasta {data.maxTokens} de respuesta
          </p>
          <ol className="inspector">
            {data.messages.map((m, i) => (
              <li key={i} className={`insp-${m.role}`}>
                <div className="insp-head">
                  <span className="tag">{m.role}</span>
                  <span className="muted">~{m.tokens} tokens</span>
                </div>
                <pre>{m.content}</pre>
              </li>
            ))}
          </ol>
        </>
      )}
    </Modal>
  );
}
