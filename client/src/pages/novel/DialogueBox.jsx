import React, { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { useT } from '../../i18n.jsx';
import { isTouch } from '../../util.js';
import { Icon } from '../../components/Icon.jsx';
import { Menu } from '../../components/ui.jsx';
import Swipeable from '../../components/Swipeable.jsx';
import { VnIcon, nameHue } from './vnUtils.js';

export function ReplyComposer({ draft, setDraft, onSend, onCancel, onImpersonate, onStopImpersonate, impersonating, personaName, busy }) {
  const { t } = useT();
  const ref = useRef(null);

  // El cuadro crece con el contenido hasta un tope relativo al área visible (con el teclado abierto es menor).
  const fit = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    const visible = window.visualViewport?.height || window.innerHeight;
    el.style.maxHeight = `${Math.max(88, Math.min(220, Math.round(visible * 0.35)))}px`;
    el.style.height = `${el.scrollHeight + el.offsetHeight - el.clientHeight}px`;
  }, []);
  useLayoutEffect(fit, [draft, fit]);
  useEffect(() => {
    ref.current?.focus();
    window.addEventListener('resize', fit);
    window.visualViewport?.addEventListener('resize', fit);
    return () => {
      window.removeEventListener('resize', fit);
      window.visualViewport?.removeEventListener('resize', fit);
    };
  }, [fit]);

  const canSend = draft.trim() && !impersonating && !busy;
  const onKeyDown = (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onCancel();
    } else if (e.key === 'Enter' && !e.shiftKey && !isTouch() && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (canSend) onSend();
    }
  };

  return (
    <div className="vn-composer">
      <div className="vn-name-row">
        <span className="vn-name vn-you">{personaName}</span>
      </div>
      <textarea
        ref={ref}
        value={draft}
        rows={2}
        readOnly={impersonating}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        aria-label={t('novelview.composer.aria', { name: personaName })}
        placeholder={impersonating ? t('novelview.composer.impersonating') : t('novelview.composer.placeholder')}
      />
      <div className="vn-composer-actions">
        <button className="btn" onClick={onCancel}>
          {t('common.cancel')}
        </button>
        <span className="spacer" />
        {impersonating ? (
          <button className="icon-btn on" onClick={onStopImpersonate} aria-label={t('common.stop')} title={t('common.stop')}>
            <Icon name="stop" />
          </button>
        ) : (
          <button className="icon-btn" onClick={onImpersonate} disabled={busy} aria-label={t('novelview.composer.impersonate')} title={t('novelview.composer.impersonate_hint')}>
            <Icon name="wand" />
          </button>
        )}
        <button className="btn primary" onClick={onSend} disabled={!canSend}>
          <Icon name="send" size={18} /> {t('novelview.composer.send')}
        </button>
      </div>
    </div>
  );
}

/**
 * Caja de diálogo.
 * Modos: `empty` (historia sin empezar: premisa + botón de empezar), `thinking` (esperando el primer delta) o texto normal.
 */
export default function DialogueBox({
  empty,
  thinking,
  name,
  html,
  textKey,
  typingDone,
  premise,
  castNames,
  atEnd,
  atLatest,
  hasPrev,
  generating,
  canRegenerate,
  swipe,
  swipeEnabled,
  collapsed,
  onTextClick,
  onAdvance,
  onBack,
  onHistory,
  onJumpLatest,
  onReply,
  onContinue,
  onRegenerate,
  onStop,
  onBegin,
  onSwipe,
  menuItems,
  composer,
  boxRef,
}) {
  const { t } = useT();
  const textRef = useRef(null);

  useLayoutEffect(() => {
    const el = textRef.current;
    if (el && !typingDone) el.scrollTop = el.scrollHeight;
  }, [html, typingDone]);

  const hue = nameHue(name);
  const hasNext = !atLatest;
  const compactAction = hasNext ? onAdvance : generating ? onStop : empty ? onBegin : onReply;
  const compactIcon = hasNext ? null : generating ? 'stop' : 'send';
  const compactLabel = hasNext ? t('novelview.actions.next') : generating ? t('common.stop') : empty ? t('novelview.actions.begin') : t('novelview.actions.reply');

  if (composer) {
    return (
      <section className="vn-dialogue composing" ref={boxRef} tabIndex={-1} aria-label={t('novelview.dialogue.aria')}>
        <ReplyComposer {...composer} />
      </section>
    );
  }

  return (
    <section className={`vn-dialogue ${collapsed ? 'collapsed' : ''}`} ref={boxRef} tabIndex={-1} aria-label={t('novelview.dialogue.aria')}>
      <div className="vn-name-row">
        {name ? (
          <span className="vn-name" style={{ color: `hsl(${hue} 65% var(--sender-l, 72%))` }}>
            {name}
          </span>
        ) : (
          <span className="vn-name-spacer" />
        )}
        <span className="spacer" />
        {swipe && swipe.total > 1 && (
          <span className="vn-variants">
            <button className="icon-btn" disabled={swipe.current <= 1} onClick={() => onSwipe(-1)} aria-label={t('chat.swipes.previous')}>
              <Icon name="left" size={18} />
            </button>
            <span aria-label={t('novelview.variants.of', { current: swipe.current, total: swipe.total })}>
              {swipe.current}/{swipe.total}
            </span>
            <button className="icon-btn" disabled={swipe.current >= swipe.total} onClick={() => onSwipe(1)} aria-label={t('chat.swipes.next')}>
              <Icon name="right" size={18} />
            </button>
          </span>
        )}
      </div>

      <Swipeable className="vn-text-wrap" enabled={Boolean(swipeEnabled)} canPrev={Boolean(swipe && swipe.current > 1)} canNext={Boolean(swipe && swipe.current < swipe.total)} onSwipe={onSwipe} onOverswipe={canRegenerate ? onRegenerate : undefined} onClick={onTextClick}>
        <div className="vn-text" ref={textRef} key={textKey}>
          {thinking ? (
            <div className="vn-thinking" role="status">
              <div className="typing">
                <i />
                <i />
                <i />
              </div>
              <span>{t('novelview.thinking')}</span>
            </div>
          ) : empty ? (
            <div className="vn-empty-text">
              <p>{premise || t('novelview.empty.no_premise')}</p>
              {castNames && <p className="vn-empty-cast">{t('novelview.empty.cast', { names: castNames })}</p>}
            </div>
          ) : (
            <>
              <div className="vn-text-inner" dangerouslySetInnerHTML={{ __html: html }} />
              {typingDone && hasNext && (
                <span className="vn-next" aria-hidden="true">
                  <VnIcon name="caret" size={18} />
                </span>
              )}
            </>
          )}
        </div>
      </Swipeable>

      {collapsed && (
        <button className="vn-compact-next icon-btn" onClick={compactAction} aria-label={compactLabel} title={compactLabel}>
          {compactIcon ? <Icon name={compactIcon} /> : <VnIcon name="next" />}
        </button>
      )}

      <div className="vn-actions">
        {!empty && (
          <div className="vn-nav">
            <button className="icon-btn" onClick={onBack} disabled={!hasPrev} aria-label={t('novelview.actions.back')} title={t('novelview.actions.back')}>
              <Icon name="left" />
            </button>
            <button className="icon-btn" onClick={onHistory} aria-label={t('novelview.actions.history')} title={t('novelview.actions.history')}>
              <VnIcon name="history" />
            </button>
            {!atLatest && (
              <button className="icon-btn" onClick={onJumpLatest} aria-label={t('novelview.actions.latest')} title={t('novelview.actions.latest')}>
                <VnIcon name="skip" />
              </button>
            )}
          </div>
        )}
        <div className="vn-main-actions">
          {generating ? (
            <>
              {hasNext && (
                <button className="btn primary" onClick={onAdvance}>
                  {typingDone ? t('novelview.actions.next') : t('novelview.actions.skip_typing')} <VnIcon name="next" size={18} />
                </button>
              )}
              <button className="btn danger" onClick={onStop}>
                <Icon name="stop" size={18} /> {t('common.stop')}
              </button>
            </>
          ) : empty ? (
            <button className="btn primary" onClick={onBegin}>
              <Icon name="sparkle" size={18} /> {t('novelview.actions.begin')}
            </button>
          ) : atEnd ? (
            <>
              <button className="btn primary" onClick={onReply}>
                <Icon name="send" size={18} /> {t('novelview.actions.reply')}
              </button>
              <button className="btn" onClick={onContinue} title={t('novelview.actions.continue_hint')} aria-label={t('novelview.actions.continue')}>
                <VnIcon name="next" size={18} /> <span className="vn-lbl">{t('novelview.actions.continue')}</span>
              </button>
              {canRegenerate && (
                <button className="btn" onClick={onRegenerate} title={t('chat.swipes.regenerate_hint')} aria-label={t('chat.swipes.regenerate')}>
                  <Icon name="refresh" size={18} /> <span className="vn-lbl">{t('chat.swipes.regenerate')}</span>
                </button>
              )}
            </>
          ) : (
            <button className="btn primary" onClick={onAdvance}>
              {typingDone ? t('novelview.actions.next') : t('novelview.actions.skip_typing')} <VnIcon name="next" size={18} />
            </button>
          )}
        </div>
        <Menu items={menuItems} up className="vn-menu" />
      </div>
    </section>
  );
}

