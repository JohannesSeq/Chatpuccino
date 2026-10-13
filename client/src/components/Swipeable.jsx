import React, { useRef } from 'react';

const THRESHOLD = 56;
const LOCK = 12;

// Burbuja que reacciona a un deslizamiento horizontal táctil: izquierda = siguiente, derecha = anterior.
// Con touch-action: pan-y el scroll vertical del chat sigue funcionando con normalidad.
export default function Swipeable({ enabled, canPrev, canNext, onSwipe, onClick, className, children }) {
  const ref = useRef(null);
  const state = useRef(null);
  const swiped = useRef(false);

  const settle = () => {
    const el = ref.current;
    if (!el) return;
    el.style.transition = 'transform 0.18s ease';
    el.style.transform = '';
  };

  const down = (e) => {
    if (!enabled || e.pointerType !== 'touch') return;
    state.current = { x: e.clientX, y: e.clientY, id: e.pointerId, locked: false, dx: 0 };
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
      ref.current.style.transition = 'none';
    }
    s.dx = dx;
    const allowed = dx < 0 ? canNext : canPrev;
    const shown = allowed ? dx * 0.6 : Math.sign(dx) * Math.min(Math.abs(dx) * 0.2, 24);
    ref.current.style.transform = `translateX(${shown}px)`;
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
    if (Math.abs(s.dx) >= THRESHOLD && (s.dx < 0 ? canNext : canPrev)) onSwipe(s.dx < 0 ? 1 : -1);
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
      style={enabled ? { touchAction: 'pan-y' } : undefined}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={cancel}
      onClick={(e) => {
        if (!swiped.current) onClick?.(e);
      }}
    >
      {children}
    </div>
  );
}
