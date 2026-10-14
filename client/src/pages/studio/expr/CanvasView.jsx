import React, { useEffect, useRef } from 'react';

/** Pinta una copia de `canvas` (que puede cambiar) en un <canvas> adaptable al ancho; `onPick(x, y)` recibe píxeles de la imagen. */
export default function CanvasView({ canvas, onPick, className = '', label, picking }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !canvas) return;
    el.width = canvas.width;
    el.height = canvas.height;
    const ctx = el.getContext('2d');
    ctx.clearRect(0, 0, el.width, el.height);
    ctx.drawImage(canvas, 0, 0);
  }, [canvas]);

  const handle = (e) => {
    if (!onPick || !canvas) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.floor(((e.clientX - rect.left) / rect.width) * canvas.width);
    const y = Math.floor(((e.clientY - rect.top) / rect.height) * canvas.height);
    if (x >= 0 && y >= 0 && x < canvas.width && y < canvas.height) onPick(x, y);
  };

  return <canvas ref={ref} className={`expr-canvas ${picking ? 'picking' : ''} ${className}`} role="img" aria-label={label} onClick={handle} />;
}
