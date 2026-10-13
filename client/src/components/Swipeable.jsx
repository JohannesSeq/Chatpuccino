import React, { useRef } from 'react';
import { Icon } from './Icon.jsx';

const THRESHOLD = 56;
const GENERATE_THRESHOLD = 80;
const LOCK = 12;

// Burbuja que reacciona a un deslizamiento horizontal táctil: izquierda = siguiente, derecha = anterior.
// Si ya no hay siguiente y se pasa `onOverswipe`, deslizar a la izquierda lo dispara (p. ej. generar otra variante).
// El contenido desliza dentro de la burbuja (que no se mueve, así no se sale de la pantalla).
// Con touch-action: pan-y el scroll vertical del chat sigue funcionando con normalidad.
export default function Swipeable({ enabled, canPrev, canNext, onSwipe, onOverswipe, onClick, className, children }) {
  const ref = useRef(null);
  const innerRef = useRef(null);
  const hintRef = useRef(null);
  const state = useRef(null);
  const swiped = useRef(false);

  const settle = () => {
    const inner = innerRef.current;
    if (inner) {
      inner.style.transition = 'transform 0.18s ease';
      inner.style.transform = '';
    }
    if (hintRef.current) hintRef.current.style.opacity = '0';
  };

  const down = (e) => {
    if (!enabled || e.pointerType !== 'touch') return;
    state.current = { x: e.clientX, y: e.clientY, id: e.pointerId, locked: false, dx: 0, armed: false };
  };

  const move = (e) => {
    const s = state.current;
    if (!s || e.pointerId !== s.id) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (!s.locked) {
      if (Math.abs(dy) > LOCK && Math.abs(dy) > Math.abs(dx)) {
        state.current = null;
        return;
      }
      if (Math.abs(dx) < LOCK || Math.abs(dx) < Math.abs(dy) * 1.5) return;
      s.locked = true;
      ref.current.setPointerCapture?.(e.pointerId);
      innerRef.current.style.transition = 'none';
    }
    s.dx = dx;
    const generating = dx < 0 && !canNext && Boolean(onOverswipe);
    const allowed = dx < 0 ? canNext : canPrev;
    let shown;
    if (generating) {
      shown = Math.max(dx * 0.4, -48);
      const progress = Math.min(1, -dx / GENERATE_THRESHOLD);
      const armed = progress >= 1;
      if (armed !== s.armed) {
        s.armed = armed;
        navigator.vibrate?.(8);
      }
      if (hintRef.current) {
        hintRef.current.style.opacity = String(progress);
        hintRef.current.style.transform = `translateY(-50%) rotate(${progress * 180}deg) scale(${0.7 + progress * 0.3})`;
        hintRef.current.classList.toggle('armed', armed);
      }
    } else {
      shown = allowed ? dx * 0.6 : Math.sign(dx) * Math.min(Math.abs(dx) * 0.2, 24);
    }
    innerRef.current.style.transform = `translateX(${shown}px)`;
  };

  const up = () => {
    const s = state.current;
    state.current = null;
    if (!s?.locked) return;
    swiped.current = true;
    setTimeout(() => {
      swiped.current = false;
    }, 60);
    settle();
    if (s.dx < 0 && !canNext && onOverswipe) {
      if (-s.dx >= GENERATE_THRESHOLD) onOverswipe();
    } else if (Math.abs(s.dx) >= THRESHOLD && (s.dx < 0 ? canNext : canPrev)) {
      onSwipe(s.dx < 0 ? 1 : -1);
    }
  };

  const cancel = () => {
    const s = state.current;
    state.current = null;
    if (s?.locked) settle();
  };

  return (
    <div
      ref={ref}
      className={className}
      style={enabled ? { touchAction: 'pan-y', overflow: 'hidden' } : undefined}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={cancel}
      onClick={(e) => {
        if (!swiped.current) onClick?.(e);
      }}
    >
      <div ref={innerRef}>{children}</div>
      {enabled && onOverswipe && (
        <span ref={hintRef} className="swipe-hint" aria-hidden="true">
          <Icon name="refresh" size={18} />
        </span>
      )}
    </div>
  );
}
