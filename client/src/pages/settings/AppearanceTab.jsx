import React, { useCallback, useEffect, useRef } from 'react';
import { api } from '../../api.js';
import { useData } from '../../data.jsx';
import { useDialog } from '../../dialogs.jsx';
import { DEFAULT_APPEARANCE, DEFAULT_COLORS, FONT_OPTIONS, PALETTES, resolveMode, withDefaults } from '../../theme.js';
import { formatRP, loadImage } from '../../util.js';
import { Field } from '../../components/ui.jsx';
import LanguageSettings from '../../components/LanguageSettings.jsx';
import { t, useT } from '../../i18n.jsx';

const COLOR_FIELDS = ['accent', 'mine', 'theirs', 'chat'];
const MODES = ['light', 'dark', 'system'];

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
  const { t } = useT();
  return (
    <>
      <Field label={label}>
        <select value={kind} onChange={(e) => onKind(e.target.value)}>
          {FONT_OPTIONS.map((id) => (
            <option key={id} value={id}>
              {t(`appearance.fonts.${id}`)}
            </option>
          ))}
        </select>
      </Field>
      {kind === 'custom' && (
        <Field label={t('appearance.text.font_name')} hint={t('appearance.text.font_name_hint')}>
          <input value={custom} onChange={(e) => onCustom(cleanFont(e.target.value))} placeholder={t('appearance.text.font_placeholder')} autoCapitalize="none" />
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
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error(t('appearance.wallpaper.process_error')))), 'image/jpeg', 0.86));
}

export default function AppearanceTab() {
  const { t } = useT();
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
      toast(t('appearance.wallpaper.updated'));
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
      title: t('appearance.reset_title'),
      message: t('appearance.reset_message'),
      confirmLabel: t('common.reset'),
      danger: true,
    });
    if (!ok) return;
    change((p) => ({ ...DEFAULT_APPEARANCE, hasWallpaper: p.hasWallpaper, wallpaperVersion: p.wallpaperVersion }));
  }

  const color = (key) => a.colors[mode][key] || DEFAULT_COLORS[mode][key];

  return (
    <div className="stack">
      <LanguageSettings value={a.language} onChange={(language) => set({ language })} />
      <section className="card">
        <h3>{t('appearance.preview.title')}</h3>
        <div className="preview-chat">
          <div className="msg them">
            <div className="bubble-wrap">
              <div className="bubble">
                <div className="text" dangerouslySetInnerHTML={{ __html: formatRP(t('appearance.preview.sample_them')) }} />
                <time>09:26</time>
              </div>
            </div>
          </div>
          <div className="msg me">
            <div className="bubble-wrap">
              <div className="bubble">
                <div className="text" dangerouslySetInnerHTML={{ __html: formatRP(t('appearance.preview.sample_me')) }} />
                <time>09:27</time>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="card">
        <h3>{t('appearance.mode.title')}</h3>
        <div className="tabs">
          {MODES.map((id) => (
            <button key={id} className={a.mode === id ? 'active' : ''} onClick={() => set({ mode: id })}>
              {t(`appearance.mode.${id}`)}
            </button>
          ))}
        </div>
        <p className="muted">{t('appearance.mode.system_hint')}</p>
      </section>

      <section className="card">
        <h3>{t('appearance.colors.title')}</h3>
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
                {t(`appearance.palettes.${p.id}`)}
              </button>
            );
          })}
        </div>
        <p className="muted">{t('appearance.colors.mode_hint', { mode: t(mode === 'dark' ? 'appearance.colors.mode_dark' : 'appearance.colors.mode_light') })}</p>
        {COLOR_FIELDS.map((key) => (
          <div key={key} className="color-row">
            <input type="color" value={color(key)} onChange={(e) => setColor(key, e.target.value)} aria-label={t(`appearance.colors.fields.${key}.label`)} />
            <div className="grow">
              <strong>{t(`appearance.colors.fields.${key}.label`)}</strong>
              <span className="field-hint">{t(`appearance.colors.fields.${key}.hint`)}</span>
            </div>
            <button className="btn small" disabled={!a.colors[mode][key]} onClick={() => setColor(key, null)}>
              {t('common.reset')}
            </button>
          </div>
        ))}
        <p className="muted">{t('appearance.colors.text_note')}</p>
      </section>

      <section className="card">
        <h3>{t('appearance.text.title')}</h3>
        <FontPicker label={t('appearance.text.ui_font')} kind={a.uiFont} custom={a.uiFontCustom} onKind={(v) => set({ uiFont: v })} onCustom={(v) => set({ uiFontCustom: v })} />
        <FontPicker label={t('appearance.text.msg_font')} kind={a.msgFont} custom={a.msgFontCustom} onKind={(v) => set({ msgFont: v })} onCustom={(v) => set({ msgFontCustom: v })} />
        <Range label={t('appearance.text.ui_size')} value={a.uiSize} min={12} max={22} unit=" px" onChange={(v) => set({ uiSize: v })} />
        <Range label={t('appearance.text.msg_size')} value={a.msgSize} min={12} max={28} unit=" px" onChange={(v) => set({ msgSize: v })} />
      </section>

      <section className="card">
        <h3>{t('appearance.bubbles.title')}</h3>
        <Range label={t('appearance.bubbles.mine_opacity')} value={a.bubbles.mineOpacity} min={0} max={100} unit="%" onChange={(v) => setBubble('mineOpacity', v)} />
        <Range label={t('appearance.bubbles.theirs_opacity')} value={a.bubbles.theirsOpacity} min={0} max={100} unit="%" onChange={(v) => setBubble('theirsOpacity', v)} />
        <Range label={t('appearance.bubbles.blur')} value={a.bubbles.blur} min={0} max={24} unit=" px" onChange={(v) => setBubble('blur', v)} />
        <Range label={t('appearance.bubbles.radius')} value={a.bubbles.radius} min={2} max={28} unit=" px" onChange={(v) => setBubble('radius', v)} />
        <p className="muted">{t('appearance.bubbles.hint')}</p>
      </section>

      <section className="card">
        <h3>{t('appearance.wallpaper.title')}</h3>
        <div className="wallpaper-row">
          {a.hasWallpaper ? <img className="wallpaper-thumb" src={`/api/appearance/wallpaper?v=${a.wallpaperVersion}`} alt={t('appearance.wallpaper.current_alt')} /> : <div className="wallpaper-thumb">{t('appearance.wallpaper.none')}</div>}
          <div className="grow">
            <p className="muted">{t('appearance.wallpaper.hint')}</p>
            <div className="btn-row">
              <button className="btn primary" onClick={() => fileRef.current.click()}>
                {a.hasWallpaper ? t('appearance.wallpaper.change') : t('appearance.wallpaper.choose')}
              </button>
              {a.hasWallpaper && (
                <button className="btn danger" onClick={removeWallpaper}>
                  {t('common.remove')}
                </button>
              )}
              <input ref={fileRef} type="file" accept="image/*" hidden onChange={pickWallpaper} />
            </div>
          </div>
        </div>
        {a.hasWallpaper && (
          <>
            <Range label={t('appearance.wallpaper.blur')} value={a.wallpaper.blur} min={0} max={24} unit=" px" onChange={(v) => setWallpaper('blur', v)} />
            <Range label={mode === 'dark' ? t('appearance.wallpaper.darken') : t('appearance.wallpaper.lighten')} value={a.wallpaper.dim} min={0} max={90} unit="%" onChange={(v) => setWallpaper('dim', v)} />
          </>
        )}
      </section>

      <div className="btn-row">
        <button className="btn danger" onClick={resetAll}>
          {t('appearance.reset_all')}
        </button>
      </div>
    </div>
  );
}
