import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, worldGenerate, worldImpersonate } from '../../api.js';
import { useData } from '../../data.jsx';
import { useDialog } from '../../dialogs.jsx';
import { useT } from '../../i18n.jsx';
import { Icon } from '../../components/Icon.jsx';
import { Modal } from '../../components/ui.jsx';
import WorldEditor from '../../components/novel/WorldEditor.jsx';
import Stage from './Stage.jsx';
import DialogueBox from './DialogueBox.jsx';
import ScenePanel from './ScenePanel.jsx';
import HistoryLog from './HistoryLog.jsx';
import StatToasts from './StatToasts.jsx';
import { VnIcon, appendDelta, buildBeats, isTypingTarget, scriptLines, sceneDiff, sceneForMessage, useLocalPref, useMedia, useTypewriter } from './vnUtils.js';
import '../../styles/novel-view.css';

const EMPTY = [];
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SETUP_CODE = /not_ready|no_connection|setup|not_configured|connection_not/i;
const SETUP_TEXT = /falta configurar|not configured|isn'?t ready|no est[aá] lista|not ready/i;

// Aplica una versión nueva de la configuración del mundo (y su escena) sobre el payload.
function syncWorld(p, w) {
  const scene = { ...p.state.scene, background: w.background ?? '', active: w.active ?? [], outfits: w.outfits ?? {} };
  return { ...p, world: { ...p.world, ...w }, state: { ...p.state, scene } };
}

function replaceMessage(p, index, message) {
  const messages = [...p.messages];
  if (index < messages.length) messages[index] = message;
  else messages.push(message);
  return { ...p, messages };
}

/** Vista de novela visual de un mundo (/novel/:worldId). Props: { worldId, onExit }. */
export default function NovelView({ worldId, onExit }) {
  return <NovelViewInner key={worldId} worldId={worldId} onExit={onExit} />;
}

function NovelViewInner({ worldId, onExit }) {
  const navigate = useNavigate();
  const { settings, refresh, toast } = useData();
  const { confirm, prompt } = useDialog();
  const { t } = useT();

  const phone = useMedia('(max-width: 767px)');
  const reducedMotion = useMedia('(prefers-reduced-motion: reduce)');
  const [instantPref, setInstantPref] = useLocalPref('chatpuccino.vn.instant', false);
  const [focus, setFocus] = useLocalPref('chatpuccino.vn.focus', 'normal');
  const [panelOpen, setPanelOpen] = useLocalPref('chatpuccino.vn.panel', true);

  const [payload, setPayload] = useState(null);
  const payloadRef = useRef(null);
  const [cur, setCur] = useState(null); // null = última línea de la historia
  const [nonce, setNonce] = useState(0);
  const [streaming, setStreaming] = useState(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [impersonating, setImpersonating] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [charExpanded, setCharExpanded] = useState(false);
  const [statToasts, setStatToasts] = useState([]);
  const [setupError, setSetupError] = useState(false);

  const mounted = useRef(true);
  const abortRef = useRef(null);
  const impAbort = useRef(null);
  const toastId = useRef(0);
  const boxRef = useRef(null);
  const wheelAt = useRef(0);
  const actions = useRef({});
  const flags = useRef({});
  const sceneRef = useRef(null);

  const setData = useCallback((update) => {
    const next = typeof update === 'function' ? update(payloadRef.current) : update;
    payloadRef.current = next;
    setPayload(next);
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      abortRef.current?.abort();
      impAbort.current?.abort();
    };
  }, []);

  const load = useCallback(async () => {
    try {
      const data = await api.world(worldId);
      if (!mounted.current) return null;
      setData(data);
      return data;
    } catch (e) {
      if (mounted.current) toast(e.message, 'error');
      return null;
    }
  }, [worldId, setData, toast]);

  const exitRef = useRef(onExit);
  exitRef.current = onExit;
  useEffect(() => {
    load().then((data) => {
      if (!data && mounted.current) exitRef.current?.();
    });
  }, [load]);

  const world = payload?.world;
  const cast = payload?.cast || EMPTY;
  const messages = payload?.messages || EMPTY;
  const state = payload?.state;
  const stats = payload?.stats || EMPTY;
  const backgrounds = payload?.backgrounds || EMPTY;
  const personaName = payload?.persona?.name || '';

  /* ---------- lectura: beats y cursor ---------- */

  const baseBeats = useMemo(() => buildBeats(messages, cast), [messages, cast]);
  const beats = useMemo(() => {
    if (!streaming) return baseBeats;
    const beat = { index: streaming.replaceIndex ?? messages.length, kind: 'assistant', swipeId: 0, streaming: true, lines: scriptLines(streaming.text, cast, true) };
    if (streaming.replaceIndex != null) return baseBeats.map((b, i) => (i === streaming.replaceIndex ? beat : b));
    return [...baseBeats, beat];
  }, [baseBeats, streaming, messages.length, cast]);

  const pos = useMemo(() => {
    if (!beats.length) return null;
    const c = cur || { mi: beats.length - 1, li: Infinity, seen: true };
    const mi = clamp(c.mi, 0, beats.length - 1);
    const beat = beats[mi];
    return { mi, li: clamp(c.li, 0, Math.max(0, beat.lines.length - 1)), seen: c.seen };
  }, [beats, cur]);

  const beat = pos ? beats[pos.mi] : null;
  const line = beat?.lines.length ? beat.lines[pos.li] : null;
  const thinking = Boolean(beat?.streaming && beat.lines.length === 0);
  const empty = !beats.length;
  const lastBeat = beats.length - 1;
  const atLatest = !pos || (pos.mi === lastBeat && pos.li >= beats[lastBeat].lines.length - 1);
  const generating = streaming !== null;
  const atEnd = atLatest && !generating;

  const typeKey = `${pos?.mi ?? 'x'}:${pos?.li ?? 0}:${nonce}`;
  const typing = useTypewriter(line?.text ?? '', typeKey, instantPref || reducedMotion || Boolean(pos?.seen));

  const lastMsg = messages.at(-1);
  const committed = pos && pos.mi < messages.length ? messages[pos.mi] : null;
  const isLastBot = Boolean(lastMsg && !lastMsg.is_user && !lastMsg.is_system && pos?.mi === messages.length - 1 && !generating);
  const swipeCount = lastMsg?.swipes?.length || 1;
  const swipe = isLastBot ? { current: (lastMsg.swipe_id ?? 0) + 1, total: swipeCount } : null;
  const canRegenerate = Boolean(lastMsg && !lastMsg.is_user && !lastMsg.is_system && atEnd);

  const scene = useMemo(() => (state ? sceneForMessage(messages, pos?.mi ?? messages.length, state.scene) : null), [messages, pos?.mi, state]);
  const backgroundUrl = useMemo(() => backgrounds.find((b) => b.id === scene?.background)?.url || null, [backgrounds, scene?.background]);

  const goEnd = useCallback(() => setCur(null), []);

  /* ---------- navegación ---------- */

  const advance = useCallback(() => {
    if (!pos) return;
    if (!typing.done) {
      typing.finish();
      return;
    }
    if (pos.li < beat.lines.length - 1) setCur({ mi: pos.mi, li: pos.li + 1, seen: false });
    else if (pos.mi < beats.length - 1) setCur({ mi: pos.mi + 1, li: 0, seen: false });
    setCharExpanded(false);
  }, [pos, beat, beats.length, typing]);

  const back = useCallback(() => {
    if (!pos) return;
    if (pos.li > 0) setCur({ mi: pos.mi, li: pos.li - 1, seen: true });
    else if (pos.mi > 0) setCur({ mi: pos.mi - 1, li: Math.max(0, beats[pos.mi - 1].lines.length - 1), seen: true });
    setCharExpanded(false);
  }, [pos, beats]);

  const jump = useCallback((mi, li) => {
    setCur({ mi, li, seen: true });
    setHistoryOpen(false);
    setCharExpanded(false);
  }, []);

  actions.current = { advance, back };
  flags.current = { composerOpen };

  useEffect(() => {
    const onKey = (e) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || flags.current.composerOpen) return;
      if (isTypingTarget(e.target) || document.querySelector('.overlay, .lightbox')) return;
      const onControl = e.target?.closest?.('button, a, summary, [role="menuitem"]');
      if (e.key === ' ' || e.key === 'Enter') {
        if (onControl || e.repeat) return;
        e.preventDefault();
        actions.current.advance();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        actions.current.advance();
      } else if (e.key === 'ArrowLeft' || e.key === 'Backspace') {
        e.preventDefault();
        actions.current.back();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const onWheel = (e) => {
    if (e.deltaY >= 0 || composerOpen) return;
    const text = e.target.closest?.('.vn-text');
    if (text && text.scrollTop > 0) return;
    if (e.target.closest?.('.vn-composer, .vn-panel, select')) return;
    const now = Date.now();
    if (now - wheelAt.current < 300) return;
    wheelAt.current = now;
    back();
  };

  /* ---------- notificaciones ---------- */

  const dismissToast = useCallback((id) => setStatToasts((l) => l.filter((x) => x.id !== id)), []);
  const pushChanges = useCallback((changes) => {
    if (!Array.isArray(changes) || !changes.length) return;
    setStatToasts((l) => [...l, ...changes.map((change) => ({ id: ++toastId.current, change }))].slice(-6));
  }, []);

  /* ---------- generación ---------- */

  async function generate(body, { swipe: isSwipe = false } = {}) {
    if (streaming || !payloadRef.current) return;
    const ac = new AbortController();
    abortRef.current = ac;
    const idx = isSwipe ? payloadRef.current.messages.length - 1 : payloadRef.current.messages.length;
    const before = payloadRef.current.state?.scene;
    setStreaming({ text: '', replaceIndex: isSwipe ? idx : null });
    setCur({ mi: idx, li: 0, seen: false });
    setCharExpanded(false);
    try {
      const out = await worldGenerate(worldId, body, ac.signal, (d) => setStreaming((s) => (s ? { ...s, text: appendDelta(s.text, d) } : s)));
      if (!mounted.current) return;
      if (!out?.message) throw new Error(t('novelview.errors.no_result'));
      const nextScene = out.scene || out.state?.scene;
      setData((p) => {
        const next = replaceMessage(p, out.index ?? idx, out.message);
        const st = out.state ? { ...out.state, scene: nextScene || out.state.scene } : p.state;
        const w = nextScene ? { ...p.world, background: nextScene.background ?? '', active: nextScene.active ?? p.world.active, outfits: nextScene.outfits ?? {} } : p.world;
        return { ...next, state: st, world: w };
      });
      pushChanges(out.changes || out.message.extra?.vn?.changes);
      sceneDiff(before, nextScene, { cast: payloadRef.current.cast, backgrounds: payloadRef.current.backgrounds, t }).forEach((m) => toast(m));
      refresh('worlds');
    } catch (e) {
      if (!mounted.current) return;
      if (e.name !== 'AbortError') {
        toast(e.message, 'error');
        if (SETUP_CODE.test(e.code || '') || SETUP_TEXT.test(e.message || '')) setSetupError(true);
      } else {
        await sleep(400);
      }
      await load();
      if (mounted.current) setCur(null);
    } finally {
      abortRef.current = null;
      if (mounted.current) setStreaming(null);
    }
  }

  const stop = () => abortRef.current?.abort();
  const begin = () => generate({ start: true });
  const continueStory = () => generate({});
  const regenerate = () => generate({ swipe: true }, { swipe: true });

  /* ---------- responder ---------- */

  const closeComposer = useCallback(() => {
    setComposerOpen(false);
    requestAnimationFrame(() => (boxRef.current?.querySelector('.vn-main-actions .primary') || boxRef.current)?.focus());
  }, []);

  const openComposer = () => {
    if (generating) return;
    setComposerOpen(true);
  };

  async function sendReply() {
    const text = draft.trim();
    if (!text || generating || impersonating) return;
    try {
      const { message } = await api.addWorldMessage(worldId, text);
      setData((p) => ({ ...p, messages: [...p.messages, message] }));
      setDraft('');
      closeComposer();
    } catch (e) {
      toast(e.message, 'error');
      return;
    }
    await generate({});
  }

  async function impersonateMe() {
    if (generating || impersonating) return;
    const base = draft.trim();
    const ac = new AbortController();
    impAbort.current = ac;
    setImpersonating(true);
    setDraft('');
    let text = '';
    try {
      const out = await worldImpersonate(worldId, { draft: base }, ac.signal, (d) => {
        text = appendDelta(text, d);
        setDraft(text);
      });
      if (out?.text) setDraft(out.text);
    } catch (e) {
      if (e.name !== 'AbortError' && mounted.current) toast(e.message, 'error');
      if (!text.trim()) setDraft(base);
    } finally {
      impAbort.current = null;
      if (mounted.current) setImpersonating(false);
    }
  }

  /* ---------- variantes, edición, borrado, ramas ---------- */

  // Al cambiar de variante los stats y la escena vuelven a los de ese mensaje (snapshot en extra.vn.state).
  function applyVariant(index, message) {
    setData((p) => {
      const next = replaceMessage(p, index, message);
      const snap = message.extra?.vn?.state;
      if (!snap || index !== p.messages.length - 1) return next;
      return { ...next, state: snap, world: { ...next.world, background: snap.scene?.background ?? '', active: snap.scene?.active ?? next.world.active, outfits: snap.scene?.outfits ?? {} } };
    });
    setNonce((n) => n + 1);
    setCur({ mi: index, li: 0, seen: false });
  }

  async function swipeTo(delta) {
    if (!isLastBot) return;
    const index = messages.length - 1;
    const id = (lastMsg.swipe_id ?? 0) + delta;
    if (id < 0 || id >= swipeCount) return;
    try {
      const updated = await api.setWorldSwipe(worldId, index, id);
      applyVariant(index, updated);
      pushChanges(updated.extra?.vn?.changes);
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  async function removeVariant() {
    const index = messages.length - 1;
    const ok = await confirm({
      title: t('chat.swipes.delete_title'),
      message: t('chat.swipes.delete_message', { current: (lastMsg.swipe_id ?? 0) + 1, total: swipeCount }),
      confirmLabel: t('chat.swipes.delete_title'),
      danger: true,
    });
    if (!ok) return;
    try {
      applyVariant(index, await api.deleteWorldSwipe(worldId, index));
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  async function saveEdit() {
    try {
      const updated = await api.editWorldMessage(worldId, editing.index, editing.text);
      setData((p) => replaceMessage(p, editing.index, updated));
      setNonce((n) => n + 1);
      setEditing(null);
      refresh('worlds');
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  async function removeMessage() {
    const index = beat.index;
    const ok = await confirm({ title: t('chat.messages.delete_title'), message: t('chat.messages.delete_message'), confirmLabel: t('chat.messages.delete'), danger: true });
    if (!ok) return;
    try {
      await api.deleteWorldMessage(worldId, index);
      const data = await load();
      if (data && mounted.current) setCur(index > 0 ? { mi: index - 1, li: Number.MAX_SAFE_INTEGER, seen: true } : null);
      refresh('worlds');
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  async function branchFrom() {
    const name = await prompt({
      title: t('novelview.branch.title'),
      message: t('novelview.branch.message'),
      label: t('novelview.branch.label'),
      defaultValue: t('novelview.branch.default_name', { base: world.name }),
      confirmLabel: t('novelview.branch.confirm'),
    });
    if (name === null) return;
    try {
      const created = await api.branchWorld(worldId, beat.index, name);
      await refresh('worlds');
      toast(t('novelview.toasts.branch_created'));
      navigate(`/novel/${created.id}`);
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  async function copyWorld() {
    const name = await prompt({
      title: t('novelview.copy.title'),
      message: t('novelview.copy.message'),
      label: t('novelview.copy.label'),
      defaultValue: t('novelview.copy.default_name', { base: world.name }),
      confirmLabel: t('novelview.copy.confirm'),
    });
    if (name === null) return;
    try {
      await api.copyWorld(worldId, name);
      await refresh('worlds');
      toast(t('novelview.toasts.copy_created'));
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  /* ---------- panel de escena ---------- */

  const updateWorld = useCallback(
    async (patch) => {
      try {
        const w = await api.updateWorld(worldId, patch);
        if (mounted.current) setData((p) => syncWorld(p, w));
        refresh('worlds');
      } catch (e) {
        toast(e.message, 'error');
      }
    },
    [worldId, setData, refresh, toast],
  );

  const setStat = useCallback(
    async (character, stat, value) => {
      try {
        const res = await api.setWorldStat(worldId, { ...(character ? { character } : {}), stat, value });
        const next = res?.stats ? res : res?.state;
        if (next && mounted.current) setData((p) => ({ ...p, state: next }));
      } catch (e) {
        toast(e.message, 'error');
      }
    },
    [worldId, setData, toast],
  );

  const openEditor = () => {
    setSheetOpen(false);
    setEditorOpen(true);
  };

  async function onEditorClose(result) {
    setEditorOpen(false);
    if (result?.deleted) {
      await refresh('worlds');
      onExit?.();
      return;
    }
    if (result?.changed) {
      await load();
      refresh('worlds');
    }
  }

  /* ---------- render ---------- */

  // En escritorio la caja de diálogo se superpone al escenario: se reserva su altura para que los rostros nunca queden tapados.
  const ready = Boolean(payload);
  useEffect(() => {
    const scene = sceneRef.current;
    const box = boxRef.current;
    if (!scene || !box) return undefined;
    if (phone) {
      scene.style.setProperty('--vn-box-h', '0px');
      return undefined;
    }
    const measure = () => scene.style.setProperty('--vn-box-h', `${box.offsetHeight}px`);
    measure();
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    ro?.observe(box);
    return () => ro?.disconnect();
  }, [ready, phone, composerOpen]);

  if (!payload) return <div className="empty">{t('common.loading')}</div>;

  const needsSetup = (settings && !settings.ready) || setupError;
  const collapsed = phone && focus === 'char' && !charExpanded && !empty;
  const castNames = cast.map((c) => c.name).join(', ');
  const onTextClick = collapsed ? () => setCharExpanded(true) : advance;
  const toggleFocus = (mode) => setFocus((f) => (f === mode ? 'normal' : mode));

  const menuItems = [
    committed && !generating && { label: t('common.edit'), icon: <Icon name="edit" size={18} />, onClick: () => setEditing({ index: pos.mi, text: committed.mes }) },
    committed && !generating && { label: t('novelview.menu.branch'), icon: <Icon name="branch" size={18} />, onClick: branchFrom },
    isLastBot && swipeCount > 1 && { label: t('chat.swipes.delete_this'), icon: <Icon name="trash" size={18} />, danger: true, onClick: removeVariant },
    committed && !generating && { label: t('chat.messages.delete'), icon: <Icon name="trash" size={18} />, danger: true, onClick: removeMessage },
    committed && !generating && { separator: true },
    !empty && { label: t('novelview.actions.history'), icon: <VnIcon name="history" size={18} />, onClick: () => setHistoryOpen(true) },
    phone && { label: t('novelview.panel.open'), icon: <VnIcon name="panel" size={18} />, onClick: () => setSheetOpen(true) },
    { label: t('novelview.menu.instant'), checked: instantPref, onClick: () => setInstantPref((v) => !v) },
    { separator: true },
    { label: t('novelview.menu.copy_world'), icon: <Icon name="copy" size={18} />, onClick: copyWorld },
    { label: t('novelview.panel.edit_world'), icon: <Icon name="edit" size={18} />, onClick: openEditor },
  ];

  const composer = composerOpen
    ? { draft, setDraft, onSend: sendReply, onCancel: closeComposer, onImpersonate: impersonateMe, onStopImpersonate: () => impAbort.current?.abort(), impersonating, personaName, busy: generating }
    : null;

  const panel = (
    <ScenePanel world={world} cast={cast} stats={stats} backgrounds={backgrounds} state={state} lorebooks={payload.lorebooks} persona={payload.persona} onUpdate={updateWorld} onSetStat={setStat} onEditWorld={openEditor} />
  );

  const panelButtonOpen = phone ? sheetOpen : panelOpen;
  const rootClass = ['novel-view', phone ? 'is-phone' : 'is-desktop', `focus-${focus}`, composerOpen ? 'composing' : '', panelOpen && !phone ? 'panel-open' : ''].filter(Boolean).join(' ');

  return (
    <div className={rootClass}>
      {needsSetup && (
        <div className="banner">
          {settings?.setupHint ? t('chat.banner.setup_missing', { hint: settings.setupHint }) : t('novelview.banner.not_ready')} <Link to="/settings/conexion">{t('chat.banner.go_to_settings')}</Link>
        </div>
      )}
      <div className="vn-body">
        <div className="vn-scene" ref={sceneRef} onWheel={onWheel}>
          <header className="vn-head">
            <button className="icon-btn" onClick={onExit} aria-label={t('common.back')}>
              <Icon name="back" />
            </button>
            <h1 className="vn-title">{world.name}</h1>
            <div className="vn-head-actions">
              {phone && (
                <>
                  <button className={`icon-btn ${focus === 'text' ? 'on' : ''}`} aria-pressed={focus === 'text'} onClick={() => toggleFocus('text')} aria-label={t('novelview.focus.text')} title={t('novelview.focus.text')}>
                    <VnIcon name="text" />
                  </button>
                  <button className={`icon-btn ${focus === 'char' ? 'on' : ''}`} aria-pressed={focus === 'char'} onClick={() => toggleFocus('char')} aria-label={t('novelview.focus.character')} title={t('novelview.focus.character')}>
                    <VnIcon name="person" />
                  </button>
                </>
              )}
              {!empty && !phone && (
                <button className="icon-btn" onClick={() => setHistoryOpen(true)} aria-label={t('novelview.actions.history')} title={t('novelview.actions.history')}>
                  <VnIcon name="history" />
                </button>
              )}
              <button
                className={`icon-btn ${panelButtonOpen ? 'on' : ''}`}
                aria-expanded={panelButtonOpen}
                onClick={() => (phone ? setSheetOpen(true) : setPanelOpen((o) => !o))}
                aria-label={panelButtonOpen && !phone ? t('novelview.panel.hide') : t('novelview.panel.open')}
                title={panelButtonOpen && !phone ? t('novelview.panel.hide') : t('novelview.panel.open')}
              >
                <VnIcon name="panel" />
              </button>
            </div>
          </header>

          <Stage cast={cast} active={scene?.active} outfits={scene?.outfits} backgroundUrl={backgroundUrl} line={line} lines={beat?.lines} lineIndex={pos?.li} messageKey={`${pos?.mi}:${beat?.swipeId ?? 0}`} hidden={phone && focus === 'text'} />

          <DialogueBox
            boxRef={boxRef}
            empty={empty && !generating}
            thinking={thinking}
            name={line?.name}
            html={typing.html}
            textKey={typeKey}
            typingDone={typing.done}
            premise={world.description}
            castNames={castNames}
            atEnd={atEnd}
            atLatest={atLatest}
            hasPrev={Boolean(pos && (pos.li > 0 || pos.mi > 0))}
            generating={generating}
            canRegenerate={canRegenerate}
            swipe={swipe}
            swipeEnabled={isLastBot && atEnd && !composerOpen}
            collapsed={collapsed}
            onTextClick={onTextClick}
            onAdvance={advance}
            onBack={back}
            onHistory={() => setHistoryOpen(true)}
            onJumpLatest={goEnd}
            onReply={openComposer}
            onContinue={continueStory}
            onRegenerate={regenerate}
            onStop={stop}
            onBegin={begin}
            onSwipe={swipeTo}
            menuItems={menuItems}
            composer={composer}
          />
          <StatToasts items={statToasts} stats={stats} worldName={world.name} onDismiss={dismissToast} />
        </div>

        {!phone && panelOpen && (
          <aside className="vn-panel" aria-label={t('novelview.panel.title')}>
            <header className="vn-panel-head">
              <strong>{t('novelview.panel.title')}</strong>
              <button className="icon-btn" onClick={() => setPanelOpen(false)} aria-label={t('novelview.panel.hide')}>
                <Icon name="close" size={20} />
              </button>
            </header>
            {panel}
          </aside>
        )}
      </div>

      {phone && sheetOpen && (
        <Modal title={t('novelview.panel.title')} onClose={() => setSheetOpen(false)}>
          {panel}
        </Modal>
      )}

      {historyOpen && <HistoryLog beats={beats} cur={pos} onJump={jump} onClose={() => setHistoryOpen(false)} />}

      {editing && (
        <Modal
          title={t('novelview.edit.title')}
          onClose={() => setEditing(null)}
          wide
          footer={
            <>
              <span className="spacer" />
              <button className="btn" onClick={() => setEditing(null)}>
                {t('common.cancel')}
              </button>
              <button className="btn primary" onClick={saveEdit}>
                {t('common.save')}
              </button>
            </>
          }
        >
          <label className="field">
            <span className="field-label">{t('novelview.edit.label')}</span>
            <textarea className="edit-area vn-edit-area" autoFocus value={editing.text} onChange={(e) => setEditing({ ...editing, text: e.target.value })} rows={10} />
            <span className="field-hint">{t('novelview.edit.hint')}</span>
          </label>
        </Modal>
      )}

      {editorOpen && <WorldEditor world={world} onClose={onEditorClose} />}
    </div>
  );
}
