import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useMatch, useNavigate } from 'react-router-dom';
import { api, chatUrl, generate, impersonate } from '../api.js';
import { useData } from '../data.jsx';
import { useDialog } from '../dialogs.jsx';
import { formatRP, formatTime, isTouch } from '../util.js';
import { useT } from '../i18n.jsx';
import { Icon } from '../components/Icon.jsx';
import { CharAvatar, GroupAvatar, Menu, Modal, PersonaAvatar, ViewableAvatar } from '../components/ui.jsx';
import GroupEditor from '../components/GroupEditor.jsx';
import Swipeable from '../components/Swipeable.jsx';
import { CharacterEditor } from './catalog/CharactersTab.jsx';

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
  const { t } = useT();

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
  const [swipeAnim, setSwipeAnim] = useState(null);

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
    // Tope relativo al área realmente visible (con el teclado abierto en móvil es mucho menor que la pantalla).
    const visible = window.visualViewport?.height || window.innerHeight;
    el.style.maxHeight = `${Math.max(88, Math.min(240, Math.round(visible * 0.4)))}px`;
    el.style.height = `${el.scrollHeight + el.offsetHeight - el.clientHeight}px`;
    const list = listRef.current;
    if (list && stick.current) list.scrollTop = list.scrollHeight;
  }, []);
  const chatReady = chat !== null;
  useLayoutEffect(fitInput, [input, chatReady, fitInput]);
  // En móvil el ancho útil cambia con el teclado, al girar la pantalla o al cargar las fuentes: se reajusta en esos casos.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return undefined;
    let width = el.offsetWidth;
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => {
      if (el.offsetWidth !== width) {
        width = el.offsetWidth;
        fitInput();
      }
    }) : null;
    ro?.observe(el);
    window.addEventListener('resize', fitInput);
    window.visualViewport?.addEventListener('resize', fitInput);
    document.fonts?.ready.then(fitInput);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', fitInput);
      window.visualViewport?.removeEventListener('resize', fitInput);
    };
  }, [chatReady, fitInput]);

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
        if (swipe) setSwipeAnim({ index: out.index, id: out.message.swipe_id ?? 0, dir: 'next' });
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
      setSwipeAnim({ index: i, id, dir: delta > 0 ? 'next' : 'prev' });
      setChat((c) => ({ ...c, messages: c.messages.map((x, k) => (k === i ? updated : x)) }));
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  async function removeSwipe(i) {
    const m = chat.messages[i];
    const ok = await confirm({
      title: t('chat.swipes.delete_title'),
      message: t('chat.swipes.delete_message', { current: (m.swipe_id ?? 0) + 1, total: m.swipes.length }),
      confirmLabel: t('chat.swipes.delete_title'),
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
    const base = String(chat.title || chat.meta.create_date || ref.file).    replace(/ \((rama|branch)\)$/, '');
    const title = await prompt({
          title: t('chat.branch.title'),
          message: t('chat.branch.message'),
          label: t('chat.branch.label'),
          defaultValue: t('chat.branch.default_name', { base }),
          confirmLabel: t('chat.branch.confirm'),
    });
    if (title === null) return;
    try {
      const created = await api.branchChat(ref, i, title);
      setSelected(null);
      await refresh('chats');
      toast(t('chat.toasts.branch_created'));
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
    if (!(await confirm({ title: t('chat.messages.delete_title'), message: t('chat.messages.delete_message'), confirmLabel: t('chat.messages.delete'), danger: true }))) return;
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
    const newTitle = await prompt({ title: t('chat.rename.title'), label: t('chat.rename.label'), defaultValue: chat.title, placeholder: t('chat.rename.placeholder'), allowEmpty: true, confirmLabel: t('common.save') });
    if (newTitle === null) return;
    try {
      await api.patchChat(ref, { title: newTitle });
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
      toast(pinned ? t('chat.toasts.unpinned') : t('chat.toasts.pinned'));
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  async function copyChat() {
    const base = String(chat.title || chat.meta.create_date || ref.file).    replace(/ \((rama|branch|copia|copy)\)$/, '');
    const title = await prompt({
          title: t('chat.copy.title'),
          message: t('chat.copy.message'),
          label: t('chat.copy.label'),
          defaultValue: t('chat.copy.default_name', { base }),
          confirmLabel: t('chat.copy.confirm'),
    });
    if (title === null) return;
    try {
      await api.copyChat(ref, title);
      await refresh('chats');
      toast(t('chat.toasts.copy_created'));
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  async function deleteChat() {
    if (!(await confirm({ title: t('chat.delete.title'), message: t('chat.delete.message'), confirmLabel: t('common.delete'), danger: true }))) return;
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

  if (!chat) return <div className="empty">{t('chat.loading')}</div>;

  const messages = chat.messages;
  const lastIdx = messages.length - 1;
  const needsSetup = settings && !settings.ready;
  const lastIsUser = messages.at(-1)?.is_user;

  return (
    <div className="chat-view">
      <header className="chat-head">
        <button className="icon-btn back" onClick={() => navigate('/chats')} aria-label={t('common.back')}>
          <Icon name="back" />
        </button>
        {isGroup ? <GroupAvatar members={members} size={40} /> : <ViewableAvatar character={character} name={title} size={40} />}
        <div className="chat-head-text">
          {!isGroup && character ? (
            <button className="name-link head-name" onClick={() => setCardId(character.id)} title={t('chat.header.view_card')}>
              <strong>{title}</strong>
            </button>
          ) : (
            <strong>{title}</strong>
          )}
          <small>{generating ? t('chat.header.typing', { name: streaming.name }) : isGroup ? members.map((m) => m.name).join(', ') : chat.title || t('chat.header.you', { name: chat.persona.name })}</small>
        </div>
        <Menu
          items={[
            { label: pinned ? t('chat.menu.unpin') : t('chat.menu.pin'), onClick: togglePin },
            { label: t('chat.menu.rename'), onClick: renameChat },
            { label: t('chat.menu.copy'), onClick: copyChat },
            { label: t('chat.menu.persona', { name: chat.persona.name }), onClick: () => setPersonaSheet(true) },
            { label: t('chat.menu.model', { name: settings.model || t('chat.menu.model_none') }), onClick: () => setModelSheet(true) },
            { label: t('chat.menu.preset', { name: settings.activePreset || '—' }), onClick: () => setPresetSheet(true) },
            { label: t('chat.menu.view_prompt'), onClick: () => setInspector(true) },
            isGroup && group && { label: t('chat.menu.edit_group'), onClick: () => setGroupSheet(true) },
            !isGroup && character && { label: t('chat.menu.convert_to_group'), onClick: () => setConvertSheet(true) },
            { label: t('chat.menu.export'), href: `/api${chatUrl(ref)}/export`, download: `${ref.file}.jsonl` },
            { label: t('chat.menu.delete'), danger: true, onClick: deleteChat },
          ]}
        />
      </header>

      {needsSetup && (
        <div className="banner">
          {t('chat.banner.setup_missing', { hint: settings.setupHint })} <Link to="/settings/conexion">{t('chat.banner.go_to_settings')}</Link>
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
                <Swipeable
                  className="bubble"
                  enabled={isLastBot && !generating && editing?.index !== i && swipes > 0}
                  canPrev={(m.swipe_id ?? 0) > 0}
                  canNext={(m.swipe_id ?? 0) < swipes - 1}
                  onSwipe={(delta) => swipeTo(i, delta)}
                  onOverswipe={isLastBot ? () => runReplies([speaker || members[0]], true) : undefined}
                  onClick={() => setSelected(selected === i ? null : i)}
                >
                  {!m.is_user && isGroup && (
                    <div className="sender" style={{ color: `hsl(${nameHue(m.name)} 65% var(--sender-l))` }}>
                      {speaker ? (
                        <button
                          className="name-link"
                          onClick={(e) => {
                            e.stopPropagation();
                            setCardId(speaker.id);
                          }}
                          title={t('chat.header.view_card')}
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
                          {t('common.cancel')}
                        </button>
                        <button className="btn small primary" onClick={saveEdit}>
                          {t('common.save')}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div key={`${i}-${m.swipe_id ?? 0}`} className={`text ${swipeAnim?.index === i && swipeAnim.id === (m.swipe_id ?? 0) ? `swipe-${swipeAnim.dir}` : ''}`} dangerouslySetInnerHTML={{ __html: formatRP(m.mes, { user: chat.persona.name, char: speaker?.name || (m.is_user ? members[0]?.name : m.name) }) }} />
                  )}
                  <time>{formatTime(m.send_date)}</time>
                </Swipeable>
                {selected === i && !editing && (
                  <div className="actions">
                    <button onClick={() => setEditing({ index: i, text: m.mes })}>
                      <Icon name="edit" size={16} /> {t('common.edit')}
                    </button>
                    <button onClick={() => navigator.clipboard?.writeText(m.mes).then(() => toast(t('chat.toasts.copied')))}>
                      <Icon name="copy" size={16} /> {t('common.copy')}
                    </button>
                    <button onClick={() => branchFrom(i)} title={t('chat.messages.branch_hint')}>
                      <Icon name="branch" size={16} /> {t('chat.messages.branch')}
                    </button>
                    <button className="danger" onClick={() => removeMessage(i)}>
                      <Icon name="trash" size={16} /> {t('chat.messages.delete')}
                    </button>
                  </div>
                )}
                {isLastBot && !generating && (
                  <div className="swipes">
                    <button disabled={(m.swipe_id ?? 0) <= 0} onClick={() => swipeTo(i, -1)} aria-label={t('chat.swipes.previous')}>
                      <Icon name="left" size={18} />
                    </button>
                    <span>
                      {(m.swipe_id ?? 0) + 1}/{swipes}
                    </span>
                    <button disabled={(m.swipe_id ?? 0) >= swipes - 1} onClick={() => swipeTo(i, 1)} aria-label={t('chat.swipes.next')}>
                      <Icon name="right" size={18} />
                    </button>
                    <button onClick={() => runReplies([speaker || members[0]], true)} aria-label={t('chat.swipes.regenerate')} title={t('chat.swipes.regenerate_hint')}>
                      <Icon name="refresh" size={18} />
                    </button>
                    {swipes > 1 && (
                      <button className="danger" onClick={() => removeSwipe(i)} aria-label={t('chat.swipes.delete_this')} title={t('chat.swipes.delete_this')}>
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
                      <button className="name-link" onClick={() => setCardId(streaming.characterId)} title={t('chat.header.view_card')}>
                        {streaming.name}
                      </button>
                    ) : (
                      streaming.name
                    )}
                  </div>
                )}
                {streaming.text ? <div className="text" dangerouslySetInnerHTML={{ __html: formatRP(streaming.text, { user: chat.persona.name, char: streaming.name }) }} /> : <div className="typing"><i /><i /><i /></div>}
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="composer">
        {isGroup && (
          <div className="chips">
            {members.map((m) => (
              <button key={m.id} className="chip" disabled={generating} onClick={() => runReplies([m])} title={t('chat.composer.reply_as', { name: m.name })}>
                <CharAvatar character={m} size={22} /> {m.name.split(/\s+/)[0]}
              </button>
            ))}
          </div>
        )}
        {!isGroup && lastIsUser && !generating && (
          <div className="chips">
            <button className="chip" onClick={() => runReplies([character])}>
              {t('chat.composer.generate_reply')}
            </button>
          </div>
        )}
        <div className="input-row">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onInput={fitInput}
            onKeyDown={onKeyDown}
            readOnly={impersonating}
            placeholder={impersonating ? t('chat.composer.impersonating') : t('chat.composer.placeholder')}
            rows={1}
          />
          {impersonating ? (
            <button className="icon-btn impersonate on" onClick={() => impersonateAbort.current?.abort()} aria-label={t('common.stop')} title={t('common.stop')}>
              <Icon name="stop" />
            </button>
          ) : (
            <button className="icon-btn impersonate" onClick={impersonateMe} disabled={generating} aria-label={t('chat.composer.impersonate')} title={t('chat.composer.impersonate_hint')}>
              <Icon name="wand" />
            </button>
          )}
          {generating ? (
            <button className="send stop" onClick={stop} aria-label={t('common.stop')}>
              <Icon name="stop" />
            </button>
          ) : (
            <button className="send" onClick={send} disabled={impersonating || (!input.trim() && !lastIsUser)} aria-label={t('chat.composer.send')}>
              <Icon name="send" />
            </button>
          )}
        </div>
      </div>

      {modelSheet && <ModelSheet onClose={() => setModelSheet(false)} />}
      {presetSheet && <PresetSheet onClose={() => setPresetSheet(false)} />}
      {inspector && <PromptInspector chatRef={ref} members={members} isGroup={isGroup} onClose={() => setInspector(false)} />}
      {personaSheet && (
        <Modal title={t('chat.persona_sheet.title')} onClose={() => setPersonaSheet(false)}>
          <ul className="rows">
            {personas.map((p) => (
              <li key={p.id} className={`row ${chat.persona.id === p.id ? 'active' : ''}`}>
                <button className="row-main" onClick={() => choosePersona(p.id)}>
                  <PersonaAvatar persona={p} />
                  <div className="row-text">
                    <strong>{p.name}</strong>
                    <div className="row-sub">{p.description || t('chat.persona_sheet.no_description')}</div>
                  </div>
                </button>
              </li>
            ))}
            {!personas.length && <li className="empty small">{t('chat.persona_sheet.empty')}</li>}
          </ul>
        </Modal>
      )}
      {convertSheet && character && <ConvertToGroupSheet chatRef={ref} character={character} onClose={() => setConvertSheet(false)} />}
      {cardId && (
        <Modal title={t('chat.card_modal.title')} wide onClose={() => setCardId(null)}>
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
  const { t } = useT();
  const navigate = useNavigate();
  const [name, setName] = useState(t('chat.convert.default_name', { name: character.name }));
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
      toast(t('chat.convert.done'));
      onClose();
      navigate(chatUrl(created));
    } catch (err) {
      toast(err.message, 'error');
      setBusy(false);
    }
  }

  return (
    <Modal
      title={t('chat.convert.title')}
      onClose={onClose}
      footer={
        <>
          <span className="spacer" />
          <button className="btn" type="button" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className="btn primary" disabled={busy || !name.trim() || !chosen.length} onClick={submit}>
            {t('chat.convert.submit')}
          </button>
        </>
      }
    >
      <form onSubmit={submit}>
        <p className="muted">
          {t('chat.convert.description', { name: character.name })}
        </p>
        <label className="field">
          <span className="field-label">{t('chat.convert.group_name')}</span>
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <div className="field-label">{t('chat.convert.add_characters', { count: chosen.length })}</div>
        <div className="pick-list">
          {others.map((c) => (
            <label key={c.id} className="pick-row">
              <input type="checkbox" checked={chosen.includes(c.id)} onChange={() => toggle(c.id)} />
              <CharAvatar character={c} size={36} />
              <span>{c.name}</span>
            </label>
          ))}
          {!others.length && <p className="muted">{t('chat.convert.no_others')}</p>}
        </div>
        <label className="field">
          <span className="field-label">{t('chat.convert.who_replies')}</span>
          <select value={replyMode} onChange={(e) => setReplyMode(e.target.value)}>
            <option value="smart">{t('chat.convert.reply_smart')}</option>
            <option value="all">{t('chat.convert.reply_all')}</option>
            <option value="manual">{t('chat.convert.reply_manual')}</option>
          </select>
        </label>
        <label className="check">
          <input type="checkbox" checked={keepOriginal} onChange={(e) => setKeepOriginal(e.target.checked)} /> {t('chat.convert.keep_original', { name: character.name })}
        </label>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

function ModelSheet({ onClose }) {
  const { settings, refresh, toast } = useData();
  const { t } = useT();
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
    <Modal title={t('chat.model_sheet.title')} onClose={onClose}>
      {settings.connections.length > 1 && (
        <label className="field">
          <span className="field-label">{t('chat.model_sheet.connection')}</span>
          <select value={active?.id || ''} onChange={(e) => run(() => api.activateConnection(e.target.value))}>
            {settings.connections.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.type === 'local' ? t('chat.model_sheet.type_local') : 'OpenRouter'})
              </option>
            ))}
          </select>
        </label>
      )}
      {active ? (
        <>
          <div className="field-label">{t('chat.model_sheet.favorites_of', { name: active.name })}</div>
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
                    <div className="row-sub">{active.model === id ? t('chat.model_sheet.in_use') : active.favorites.includes(id) ? t('chat.model_sheet.favorite') : ''}</div>
                  </div>
                </button>
              </li>
            ))}
            {!active.favorites.length && <li className="empty small">{t('chat.model_sheet.empty_favorites')}</li>}
          </ul>
        </>
      ) : (
        <p className="muted">{t('chat.model_sheet.no_connections')}</p>
      )}
      <Link className="btn" to="/settings/conexion" onClick={onClose}>
        {t('chat.model_sheet.all_models')}
      </Link>
    </Modal>
  );
}

function PresetSheet({ onClose }) {
  const { settings, refresh, toast } = useData();
  const { t } = useT();
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
    <Modal title={t('chat.preset_sheet.title')} onClose={onClose}>
      <ul className="rows">
        {(list?.presets || []).map((n) => (
          <li key={n} className={`row ${settings.activePreset === n ? 'active' : ''}`}>
            <button className="row-main" onClick={() => pick(n)}>
              <div className="row-text">
                <strong>{n}</strong>
                <div className="row-sub">{settings.activePreset === n ? t('chat.preset_sheet.in_use') : ''}</div>
              </div>
            </button>
          </li>
        ))}
        {!list && <li className="empty small">{t('common.loading')}</li>}
      </ul>
      <Link className="btn" to="/settings/presets" onClick={onClose}>
        {t('chat.preset_sheet.edit')}
      </Link>
    </Modal>
  );
}

function PromptInspector({ chatRef, members, isGroup, onClose }) {
  const { toast } = useData();
  const { t } = useT();
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
    <Modal title={t('chat.inspector.title')} onClose={onClose} wide>
      {isGroup && (
        <label className="field">
          <span className="field-label">{t('chat.inspector.if_replies')}</span>
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
        <p className="muted">{t('common.loading')}</p>
      ) : (
        <>
          <p className="muted">
            {t('chat.inspector.summary', { preset: data.preset, total: data.totalTokens, max: data.maxTokens })}
          </p>
          <ol className="inspector">
            {data.messages.map((m, i) => (
              <li key={i} className={`insp-${m.role}`}>
                <div className="insp-head">
                  <span className="tag">{m.role}</span>
                  <span className="muted">{t('chat.inspector.tokens', { count: m.tokens })}</span>
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
