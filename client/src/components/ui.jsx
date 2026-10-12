import React, { useEffect, useRef, useState } from 'react';
import { avatarUrl } from '../api.js';
import { Icon } from './Icon.jsx';

function hue(name) {
  let h = 0;
  for (const ch of name || '?') h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % 360;
}

export function Avatar({ src, name, size = 48, className = '' }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  const style = { width: size, height: size, fontSize: size * 0.42 };
  if (src && !failed) {
    return <img className={`avatar ${className}`} style={style} src={src} alt="" loading="lazy" onError={() => setFailed(true)} />;
  }
  return (
    <div className={`avatar ${className}`} style={{ ...style, background: `hsl(${hue(name)} 40% 32%)` }}>
      {(name || '?').trim().charAt(0).toUpperCase()}
    </div>
  );
}

export const CharAvatar = ({ character, name, size }) => (
  <Avatar src={character ? avatarUrl.character(character) : null} name={name || character?.name} size={size} />
);

export const PersonaAvatar = ({ persona, size }) => <Avatar src={persona ? avatarUrl.persona(persona) : null} name={persona?.name} size={size} />;

export function GroupAvatar({ members, size = 48 }) {
  const shown = members.slice(0, 4);
  return (
    <div className="avatar group-avatar" style={{ width: size, height: size }}>
      {shown.map((m) => (
        <CharAvatar key={m.id} character={m} size={size / 2} />
      ))}
    </div>
  );
}

export function Modal({ title, onClose, children, footer, wide }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`sheet ${wide ? 'wide' : ''}`} role="dialog" aria-label={title}>
        <header className="sheet-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Cerrar">
            <Icon name="close" />
          </button>
        </header>
        <div className="sheet-body">{children}</div>
        {footer && <footer className="sheet-foot">{footer}</footer>}
      </div>
    </div>
  );
}

export function Menu({ items }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => !ref.current?.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('touchstart', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('touchstart', close);
    };
  }, [open]);
  return (
    <div className="menu" ref={ref}>
      <button className="icon-btn" onClick={() => setOpen((o) => !o)} aria-label="Más opciones">
        <Icon name="dots" />
      </button>
      {open && (
        <div className="menu-list">
          {items
            .filter(Boolean)
            .map((it) =>
              it.href ? (
                <a key={it.label} href={it.href} download={it.download} onClick={() => setOpen(false)}>
                  {it.label}
                </a>
              ) : (
                <button
                  key={it.label}
                  className={it.danger ? 'danger' : ''}
                  onClick={() => {
                    setOpen(false);
                    it.onClick();
                  }}
                >
                  {it.label}
                </button>
              ),
            )}
        </div>
      )}
    </div>
  );
}

export function SearchBox({ value, onChange, placeholder = 'Buscar' }) {
  return (
    <label className="search">
      <Icon name="search" size={18} />
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </label>
  );
}

export function Field({ label, hint, children }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}
