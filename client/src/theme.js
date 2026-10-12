// Motor de apariencia: convierte los ajustes guardados en variables CSS sobre <html>.

export const STORAGE_KEY = 'chatpuccino.appearance';

export const DEFAULT_COLORS = {
  dark: { accent: '#00a884', mine: '#005c4b', theirs: '#202c33', chat: '#0b141a' },
  light: { accent: '#008069', mine: '#d9fdd3', theirs: '#ffffff', chat: '#efeae2' },
};

// Colores base de cada modo (deben coincidir con el CSS); se usan para calcular mezclas y contraste.
const BASE = {
  dark: { panel: '#111b21', lightText: '#e9edef', darkText: '#111b21', dim: '0, 0, 0' },
  light: { panel: '#ffffff', lightText: '#ffffff', darkText: '#111b21', dim: '255, 255, 255' },
};

export const DEFAULT_APPEARANCE = {
  mode: 'dark',
  colors: {
    dark: { accent: null, mine: null, theirs: null, chat: null },
    light: { accent: null, mine: null, theirs: null, chat: null },
  },
  uiFont: 'system',
  msgFont: 'system',
  uiFontCustom: '',
  msgFontCustom: '',
  uiSize: 15,
  msgSize: 15,
  bubbles: { mineOpacity: 100, theirsOpacity: 100, blur: 0, radius: 12 },
  wallpaper: { blur: 0, dim: 30 },
  hasWallpaper: false,
  wallpaperVersion: 0,
};

export const FONT_STACKS = {
  system: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  humanist: "'Trebuchet MS', 'Segoe UI', 'Gill Sans', Calibri, sans-serif",
  rounded: "ui-rounded, 'Nunito', 'Varela Round', 'Segoe UI', system-ui, sans-serif",
  serif: "Georgia, 'Iowan Old Style', 'Palatino Linotype', 'Times New Roman', serif",
  mono: "ui-monospace, 'Cascadia Mono', Consolas, 'SF Mono', Menlo, monospace",
  handwritten: "'Segoe Print', 'Bradley Hand', 'Comic Sans MS', cursive",
};

export const FONT_OPTIONS = [
  ['system', 'Sistema'],
  ['humanist', 'Humanista'],
  ['rounded', 'Redondeada'],
  ['serif', 'Serif (lectura)'],
  ['mono', 'Monoespaciada'],
  ['handwritten', 'Manuscrita'],
  ['custom', 'Otra fuente instalada…'],
];

// Paletas rápidas: definen los cuatro colores en ambos modos.
export const PALETTES = [
  { id: 'classic', name: 'Clásico', colors: { dark: { accent: null, mine: null, theirs: null, chat: null }, light: { accent: null, mine: null, theirs: null, chat: null } } },
  {
    id: 'cafe',
    name: 'Café',
    colors: {
      dark: { accent: '#d99a5b', mine: '#6b4226', theirs: '#2b2420', chat: '#16110e' },
      light: { accent: '#a8642a', mine: '#f1dcc4', theirs: '#ffffff', chat: '#f5ece1' },
    },
  },
  {
    id: 'ocean',
    name: 'Océano',
    colors: {
      dark: { accent: '#3b9cff', mine: '#0f4c81', theirs: '#1b2a3a', chat: '#0a121c' },
      light: { accent: '#1c6fd1', mine: '#cfe6ff', theirs: '#ffffff', chat: '#e6eef7' },
    },
  },
  {
    id: 'rose',
    name: 'Rosa',
    colors: {
      dark: { accent: '#ff6fa5', mine: '#7a1f4a', theirs: '#2e2030', chat: '#170f18' },
      light: { accent: '#d6336c', mine: '#ffd9e6', theirs: '#ffffff', chat: '#fbeff3' },
    },
  },
  {
    id: 'forest',
    name: 'Bosque',
    colors: {
      dark: { accent: '#7bc67e', mine: '#2f5d34', theirs: '#232b22', chat: '#0f150f' },
      light: { accent: '#3f8f46', mine: '#dcefd2', theirs: '#ffffff', chat: '#eef3e8' },
    },
  },
  {
    id: 'violet',
    name: 'Púrpura',
    colors: {
      dark: { accent: '#a78bfa', mine: '#4c2f8a', theirs: '#29243a', chat: '#120f1c' },
      light: { accent: '#6d4bd8', mine: '#e4dcff', theirs: '#ffffff', chat: '#f1eefb' },
    },
  },
];

// ---------- color ----------

const parse = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const toHex = (rgb) => `#${rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
export const mix = (a, b, t) => {
  const A = parse(a);
  const B = parse(b);
  return toHex(A.map((v, i) => v * (1 - t) + B[i] * t));
};
const luminance = (h) => {
  const [r, g, b] = parse(h).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
// Elige el texto (claro u oscuro) con mejor contraste sobre `bg`.
const readable = (bg, light, dark) => (contrast(bg, dark) >= contrast(bg, light) ? dark : light);
const rgba = (h, a) => `rgba(${parse(h).join(', ')}, ${a})`;

// ---------- estado ----------

export function withDefaults(a) {
  const d = DEFAULT_APPEARANCE;
  const src = a || {};
  return {
    ...d,
    ...src,
    colors: {
      dark: { ...d.colors.dark, ...src.colors?.dark },
      light: { ...d.colors.light, ...src.colors?.light },
    },
    bubbles: { ...d.bubbles, ...src.bubbles },
    wallpaper: { ...d.wallpaper, ...src.wallpaper },
  };
}

export function loadCachedAppearance() {
  try {
    return withDefaults(JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'));
  } catch {
    return withDefaults({});
  }
}

export function cacheAppearance(a) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(a));
  } catch {
    /* almacenamiento no disponible */
  }
}

const systemQuery = () => (typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: light)') : null);
export const resolveMode = (mode) => (mode === 'system' ? (systemQuery()?.matches ? 'light' : 'dark') : mode === 'light' ? 'light' : 'dark');

export function fontStack(kind, custom) {
  if (kind === 'custom' && custom?.trim()) {
    const c = custom.trim();
    const list = c.includes(',') ? c : `"${c.replace(/["']/g, '')}"`;
    return `${list}, ${FONT_STACKS.system}`;
  }
  return FONT_STACKS[kind] || FONT_STACKS.system;
}

let current = null;
let listening = false;

function render(a) {
  const root = document.documentElement;
  const mode = resolveMode(a.mode);
  const base = BASE[mode];
  const c = { ...DEFAULT_COLORS[mode] };
  for (const [k, v] of Object.entries(a.colors[mode])) if (v) c[k] = v;
  const set = (k, v) => root.style.setProperty(k, v);

  root.dataset.theme = mode;
  set('--accent', c.accent);
  set('--on-accent', readable(c.accent, '#ffffff', '#04130f'));
  set('--accent-soft', mix(c.accent, base.panel, mode === 'dark' ? 0.62 : 0.78));
  set('--chat-bg', c.chat);
  set('--chat-bg-2', mix(c.chat, mode === 'dark' ? '#ffffff' : '#000000', 0.05));

  for (const [who, key, opacity] of [['mine', 'mine', a.bubbles.mineOpacity], ['theirs', 'theirs', a.bubbles.theirsOpacity]]) {
    const alpha = opacity / 100;
    const effective = mix(c.chat, c[key], alpha);
    const text = readable(effective, base.lightText, base.darkText);
    set(`--bubble-${who}-bg`, rgba(c[key], alpha));
    set(`--bubble-${who}-text`, text);
    set(`--bubble-${who}-meta`, mix(text, effective, 0.4));
    set(`--bubble-${who}-quote`, readable(effective, '#a8d5ff', '#0b62b8'));
    if (who === 'theirs') set('--sender-l', text === base.darkText ? '32%' : '72%');
  }
  set('--bubble-blur', `${a.bubbles.blur}px`);
  set('--bubble-r', `${a.bubbles.radius}px`);

  set('--font-ui', fontStack(a.uiFont, a.uiFontCustom));
  set('--font-msg', fontStack(a.msgFont, a.msgFontCustom));
  set('--ui-scale', String(a.uiSize / 15));
  set('--msg-size', `${a.msgSize}px`);

  root.classList.toggle('has-wallpaper', Boolean(a.hasWallpaper));
  if (a.hasWallpaper) set('--wp-url', `url("/api/appearance/wallpaper?v=${a.wallpaperVersion}")`);
  set('--wp-blur', String(a.wallpaper.blur));
  set('--wp-dim', String(a.wallpaper.dim / 100));
  set('--wp-dim-rgb', base.dim);

  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', mode === 'dark' ? '#111b21' : '#ffffff');
}

/** Aplica la apariencia (y se mantiene al día si el modo es «sistema»). */
export function applyAppearance(input) {
  current = withDefaults(input);
  render(current);
  const q = systemQuery();
  if (q && !listening) {
    listening = true;
    q.addEventListener('change', () => current?.mode === 'system' && render(current));
  }
}
