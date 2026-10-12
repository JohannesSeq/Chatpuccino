import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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

export function Lightbox({ src, name, onClose }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return createPortal(
    <div className="lightbox" role="dialog" aria-label={name} onClick={onClose}>
      <button className="icon-btn lightbox-close" onClick={onClose} aria-label="Cerrar">
        <Icon name="close" size={26} />
      </button>
      <img src={src} alt={name} onClick={(e) => e.stopPropagation()} />
      {name && <div className="lightbox-caption">{name}</div>}
    </div>,
    document.body,
  );
}

// Avatar de personaje que al tocarlo muestra la imagen completa.
export function ViewableAvatar({ character, name, size }) {
  const [open, setOpen] = useState(false);
  const avatar = <CharAvatar character={character} name={name} size={size} />;
  if (!character) return avatar;
  return (
    <>
      <button className="avatar-btn zoomable" onClick={() => setOpen(true)} aria-label={`Ver imagen de ${character.name}`} title="Ver imagen completa">
        {avatar}
      </button>
      {open && <Lightbox src={avatarUrl.character(character)} name={character.name} onClose={() => setOpen(false)} />}
    </>
  );
}

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

export function Menu({ items, trigger, label = 'Más opciones', className = '', up = false }) {
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
  const content = (it) => (
    <>
      {it.icon}
      <span className="grow">{it.label}</span>
      {it.checked && <Icon name="check" size={18} />}
    </>
  );
  return (
    <div className={`menu ${className}`} ref={ref}>
      <button className={trigger ? 'menu-trigger' : 'icon-btn'} onClick={() => setOpen((o) => !o)} aria-label={label} aria-haspopup="menu" aria-expanded={open}>
        {trigger || <Icon name="dots" />}
      </button>
      {open && (
        <div className={`menu-list ${up ? 'up' : ''}`} role="menu">
          {items
            .filter(Boolean)
            .map((it, i) => {
              if (it.header) return <div key={`h${i}`} className="menu-header">{it.header}</div>;
              if (it.separator) return <hr key={`s${i}`} className="menu-sep" />;
              return it.href ? (
                <a key={`${i}${it.label}`} href={it.href} download={it.download} onClick={() => setOpen(false)}>
                  {content(it)}
                </a>
              ) : (
                <button
                  key={`${i}${it.label}`}
                  role="menuitem"
                  className={it.danger ? 'danger' : ''}
                  onClick={() => {
                    setOpen(false);
                    it.onClick();
                  }}
                >
                  {content(it)}
                </button>
              );
            })}
        </div>
      )}
    </div>
  );
}

export function DropOverlay({ title, hint }) {
  return (
    <div className="drop-overlay" aria-hidden="true">
      <div className="drop-box">
        <Icon name="upload" size={40} />
        <strong>{title}</strong>
        {hint && <span>{hint}</span>}
      </div>
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
