import React, { useCallback, useEffect, useRef } from 'react';
import { api } from '../../api.js';
import { useData } from '../../data.jsx';
import { useDialog } from '../../dialogs.jsx';
import { DEFAULT_APPEARANCE, DEFAULT_COLORS, FONT_OPTIONS, PALETTES, resolveMode, withDefaults } from '../../theme.js';
import { formatRP, loadImage } from '../../util.js';
import { Field } from '../../components/ui.jsx';

const COLOR_FIELDS = [
  ['accent', 'Color de acento', 'Botones, enlaces y elementos activos.'],
  ['mine', 'Tus burbujas', 'Los mensajes que envías.'],
  ['theirs', 'Burbujas del personaje', 'Las respuestas de los personajes.'],
  ['chat', 'Fondo del chat', 'Se ve detrás de los mensajes (si no hay imagen de fondo).'],
];

const cleanFont = (v) => v.replace(/[^\p{L}\p{N}\s,'"-]/gu, '').slice(0, 80);

function Range({ label, value, min, max, step = 1, unit = '', onChange }) {
  return (
    <div className="range-row">
      <span className="field-label">{label}</span>
      <output>
        {value}
        {unit}
      </output>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} aria-label={label} />
    </div>
  );
}

function FontPicker({ label, kind, custom, onKind, onCustom }) {
  return (
    <>
      <Field label={label}>
        <select value={kind} onChange={(e) => onKind(e.target.value)}>
          {FONT_OPTIONS.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
      </Field>
      {kind === 'custom' && (
        <Field label="Nombre de la fuente" hint="Debe estar instalada en el dispositivo desde el que usas la app. Puedes poner varias separadas por coma.">
          <input value={custom} onChange={(e) => onCustom(cleanFont(e.target.value))} placeholder="Por ejemplo: Fira Sans" autoCapitalize="none" />
        </Field>
      )}
    </>
  );
}

// Reduce la imagen para que el fondo cargue rápido también en el móvil.
async function prepareWallpaper(file) {
  const img = await loadImage(file);
  const scale = Math.min(1, 1920 / Math.max(img.width, img.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('No se pudo procesar la imagen'))), 'image/jpeg', 0.86));
}

export default function AppearanceTab() {
  const { appearance: a, setAppearance, toast } = useData();
  const { confirm } = useDialog();
  const mode = resolveMode(a.mode);
  const fileRef = useRef(null);
  const latest = useRef(a);
  const timer = useRef(null);
  latest.current = a;

  const persist = useCallback(async () => {
    timer.current = null;
    try {
      await api.saveAppearance(latest.current);
    } catch (e) {
      toast(e.message, 'error');
    }
  }, [toast]);

  // Los cambios se ven al instante y se guardan en el servidor poco después.
  const change = useCallback(
    (update) => {
      setAppearance(update);
      clearTimeout(timer.current);
      timer.current = setTimeout(persist, 500);
    },
    [setAppearance, persist],
  );

  useEffect(
    () => () => {
      if (timer.current) {
        clearTimeout(timer.current);
        persist();
      }
    },
    [persist],
  );

  const set = (patch) => change((p) => ({ ...p, ...patch }));
  const setColor = (key, value) => change((p) => ({ ...p, colors: { ...p.colors, [mode]: { ...p.colors[mode], [key]: value } } }));
  const setBubble = (key, value) => change((p) => ({ ...p, bubbles: { ...p.bubbles, [key]: value } }));
  const setWallpaper = (key, value) => change((p) => ({ ...p, wallpaper: { ...p.wallpaper, [key]: value } }));
  const applyPalette = (palette) => change((p) => ({ ...p, colors: structuredClone(palette.colors) }));
  const paletteActive = (palette) => JSON.stringify(withDefaults({ colors: palette.colors }).colors) === JSON.stringify(a.colors);

  async function pickWallpaper(e) {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const saved = await api.uploadWallpaper(await prepareWallpaper(file));
      setAppearance((p) => ({ ...p, hasWallpaper: saved.hasWallpaper, wallpaperVersion: saved.wallpaperVersion }));
      toast('Fondo actualizado');
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function removeWallpaper() {
    try {
      const saved = await api.deleteWallpaper();
      setAppearance((p) => ({ ...p, hasWallpaper: saved.hasWallpaper, wallpaperVersion: saved.wallpaperVersion }));
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function resetAll() {
    const ok = await confirm({
      title: 'Restablecer apariencia',
      message: 'Vuelven los valores por defecto (modo, colores, fuentes, tamaños y burbujas). La imagen de fondo no se borra.',
      confirmLabel: 'Restablecer',
      danger: true,
    });
    if (!ok) return;
    change((p) => ({ ...DEFAULT_APPEARANCE, hasWallpaper: p.hasWallpaper, wallpaperVersion: p.wallpaperVersion }));
  }

  const color = (key) => a.colors[mode][key] || DEFAULT_COLORS[mode][key];

  return (
    <div className="stack">
      <section className="card">
        <h3>Vista previa</h3>
        <div className="preview-chat">
          <div className="msg them">
            <div className="bubble-wrap">
              <div className="bubble">
                <div className="text" dangerouslySetInnerHTML={{ __html: formatRP('*Levanta la vista del libro.* "Oh, no esperaba visitas", dice con calma.') }} />
                <time>09:26</time>
              </div>
            </div>
          </div>
          <div className="msg me">
            <div className="bubble-wrap">
              <div className="bubble">
                <div className="text" dangerouslySetInnerHTML={{ __html: formatRP('Hola, vengo a pedirte ayuda con un hechizo. *Sonríe.*') }} />
                <time>09:27</time>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="card">
        <h3>Modo</h3>
        <div className="tabs">
          {[
            ['light', 'Claro'],
            ['dark', 'Oscuro'],
            ['system', 'Automático'],
          ].map(([id, label]) => (
            <button key={id} className={a.mode === id ? 'active' : ''} onClick={() => set({ mode: id })}>
              {label}
            </button>
          ))}
        </div>
        <p className="muted">«Automático» sigue el modo claro u oscuro de tu dispositivo.</p>
      </section>

      <section className="card">
        <h3>Colores</h3>
        <div className="swatches">
          {PALETTES.map((p) => {
            const c = p.colors[mode];
            const shown = { ...DEFAULT_COLORS[mode], ...Object.fromEntries(Object.entries(c).filter(([, v]) => v)) };
            return (
              <button key={p.id} className={`swatch ${paletteActive(p) ? 'active' : ''}`} onClick={() => applyPalette(p)}>
                <span className="dots">
                  {['accent', 'mine', 'theirs'].map((k) => (
                    <i key={k} style={{ background: shown[k] }} />
                  ))}
                </span>
                {p.name}
              </button>
            );
          })}
        </div>
        <p className="muted">Colores del modo {mode === 'dark' ? 'oscuro' : 'claro'}. Cada modo guarda los suyos: cambia de modo arriba para editar el otro.</p>
        {COLOR_FIELDS.map(([key, label, hint]) => (
          <div key={key} className="color-row">
            <input type="color" value={color(key)} onChange={(e) => setColor(key, e.target.value)} aria-label={label} />
            <div className="grow">
              <strong>{label}</strong>
              <span className="field-hint">{hint}</span>
            </div>
            <button className="btn small" disabled={!a.colors[mode][key]} onClick={() => setColor(key, null)}>
              Restablecer
            </button>
          </div>
        ))}
        <p className="muted">El color del texto dentro de las burbujas se ajusta solo para que siempre se lea bien.</p>
      </section>

      <section className="card">
        <h3>Texto</h3>
        <FontPicker label="Fuente de la interfaz" kind={a.uiFont} custom={a.uiFontCustom} onKind={(v) => set({ uiFont: v })} onCustom={(v) => set({ uiFontCustom: v })} />
        <FontPicker label="Fuente de los mensajes" kind={a.msgFont} custom={a.msgFontCustom} onKind={(v) => set({ msgFont: v })} onCustom={(v) => set({ msgFontCustom: v })} />
        <Range label="Tamaño de la interfaz" value={a.uiSize} min={12} max={22} unit=" px" onChange={(v) => set({ uiSize: v })} />
        <Range label="Tamaño de los mensajes" value={a.msgSize} min={12} max={28} unit=" px" onChange={(v) => set({ msgSize: v })} />
      </section>

      <section className="card">
        <h3>Burbujas de mensaje</h3>
        <Range label="Opacidad de tus burbujas" value={a.bubbles.mineOpacity} min={0} max={100} unit="%" onChange={(v) => setBubble('mineOpacity', v)} />
        <Range label="Opacidad de las burbujas del personaje" value={a.bubbles.theirsOpacity} min={0} max={100} unit="%" onChange={(v) => setBubble('theirsOpacity', v)} />
        <Range label="Desenfoque detrás de las burbujas" value={a.bubbles.blur} min={0} max={24} unit=" px" onChange={(v) => setBubble('blur', v)} />
        <Range label="Redondeo" value={a.bubbles.radius} min={2} max={28} unit=" px" onChange={(v) => setBubble('radius', v)} />
        <p className="muted">Con opacidad baja se nota mejor el fondo de pantalla; el desenfoque ayuda a leer el texto encima de imágenes con detalle.</p>
      </section>

      <section className="card">
        <h3>Fondo de pantalla</h3>
        <div className="wallpaper-row">
          {a.hasWallpaper ? <img className="wallpaper-thumb" src={`/api/appearance/wallpaper?v=${a.wallpaperVersion}`} alt="Fondo actual" /> : <div className="wallpaper-thumb">Sin imagen</div>}
          <div className="grow">
            <p className="muted">Se muestra detrás de los mensajes en todos los chats.</p>
            <div className="btn-row">
              <button className="btn primary" onClick={() => fileRef.current.click()}>
                {a.hasWallpaper ? 'Cambiar imagen' : 'Elegir imagen'}
              </button>
              {a.hasWallpaper && (
                <button className="btn danger" onClick={removeWallpaper}>
                  Quitar
                </button>
              )}
              <input ref={fileRef} type="file" accept="image/*" hidden onChange={pickWallpaper} />
            </div>
          </div>
        </div>
        {a.hasWallpaper && (
          <>
            <Range label="Desenfoque del fondo" value={a.wallpaper.blur} min={0} max={24} unit=" px" onChange={(v) => setWallpaper('blur', v)} />
            <Range label={mode === 'dark' ? 'Oscurecer el fondo' : 'Aclarar el fondo'} value={a.wallpaper.dim} min={0} max={90} unit="%" onChange={(v) => setWallpaper('dim', v)} />
          </>
        )}
      </section>

      <div className="btn-row">
        <button className="btn danger" onClick={resetAll}>
          Restablecer todo
        </button>
      </div>
    </div>
  );
}
