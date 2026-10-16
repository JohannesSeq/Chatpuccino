// Estudio de imágenes: valores por defecto y rangos compartidos entre servidor y cliente.
import { DEFAULT_EXPRESSIONS } from './vn.js';

export const PROFILE_KINDS = ['character', 'expression', 'background'];

/** [min, max, paso] de cada parámetro numérico (los sliders del cliente y la validación del servidor usan lo mismo). */
export const PARAM_RANGES = {
  width: [64, 2048, 64],
  height: [64, 2048, 64],
  steps: [1, 150, 1],
  cfg: [1, 30, 0.5],
  seed: [-1, 4294967295, 1],
  clipSkip: [1, 12, 1],
  batchCount: [1, 16, 1],
  hiresScale: [1, 4, 0.05],
  hiresSteps: [0, 150, 1],
  hiresDenoise: [0, 1, 0.01],
  denoise: [0.05, 1, 0.01],
  maskBlur: [0, 64, 1],
  padding: [0, 256, 4],
};

/** Qué hace Stable Diffusion con la zona enmascarada antes de regenerarla (`inpainting_fill`). */
export const INPAINT_FILLS = ['original', 'fill', 'noise', 'nothing'];

const NEGATIVE = 'lowres, bad anatomy, bad hands, extra fingers, text, error, worst quality, low quality, blurry, watermark, signature';

const baseProfile = {
  width: 512,
  height: 768,
  steps: 25,
  cfg: 7,
  sampler: 'Euler a',
  scheduler: 'Automatic',
  seed: -1,
  batchCount: 2,
  hires: { enabled: false, scale: 1.5, upscaler: 'Latent', steps: 0, denoise: 0.45 },
  restoreFaces: false,
  prompt: '',
  negative: NEGATIVE,
};

export const DEFAULT_PROFILES = {
  character: { ...baseProfile, prompt: 'masterpiece, best quality, full body, standing, simple background, white background' },
  expression: {
    ...baseProfile,
    width: 512,
    height: 512,
    batchCount: 2,
    prompt: 'masterpiece, best quality, detailed face',
    inpaint: { denoise: 0.55, maskBlur: 8, fill: 'original', onlyMasked: true, padding: 48 },
  },
  background: {
    ...baseProfile,
    width: 768,
    height: 448,
    batchCount: 2,
    prompt: 'masterpiece, best quality, scenery, no humans, detailed background',
    negative: `people, person, character, ${NEGATIVE}`,
  },
};

export const DEFAULT_MODEL = { checkpoint: '', vae: '', clipSkip: 2, favorites: [] };
export const DEFAULT_CONNECTION = { baseUrl: 'http://127.0.0.1:7860', user: '', pass: '' };

// Región de la cara (elipse en proporciones de la imagen) usada como máscara inicial al generar expresiones.
export const DEFAULT_FACE_REGION = { cx: 0.5, cy: 0.24, rx: 0.17, ry: 0.15 };

// Etiquetas de Stable Diffusion que describen cada expresión (las de SillyTavern). Se pueden editar en la configuración.
export const DEFAULT_EXPRESSION_PROMPTS = {
  admiration: 'admiring, wide eyes, sparkling eyes, slight smile',
  amusement: 'amused, laughing, closed eyes, smile',
  anger: 'angry, furrowed brow, clenched teeth, glaring',
  annoyance: 'annoyed, half-closed eyes, frown, irritated',
  approval: 'approving, gentle smile, confident look',
  caring: 'caring, soft smile, gentle eyes, warm expression',
  confusion: 'confused, raised eyebrow, puzzled, tilted head',
  curiosity: 'curious, wide eyes, head tilt, slight smile',
  desire: 'desire, half-lidded eyes, blush, parted lips',
  disappointment: 'disappointed, downcast eyes, slight frown',
  disapproval: 'disapproving, frown, narrowed eyes, stern look',
  disgust: 'disgusted, wrinkled nose, grimace, disgust',
  embarrassment: 'embarrassed, blush, looking away, nervous smile',
  excitement: 'excited, open mouth smile, sparkling eyes, blush',
  fear: 'scared, wide eyes, trembling, pale, open mouth',
  gratitude: 'grateful, warm smile, soft eyes, slight blush',
  grief: 'grieving, crying, tears, sorrowful, closed eyes',
  joy: 'happy, big smile, open mouth, cheerful',
  love: 'loving gaze, gentle smile, blush, half-lidded eyes',
  nervousness: 'nervous, sweatdrop, worried smile, looking away',
  optimism: 'optimistic, confident smile, bright eyes',
  pride: 'proud, confident smirk, chin up',
  realization: 'realization, wide eyes, open mouth, surprised',
  relief: 'relieved, soft smile, closed eyes, exhaling',
  remorse: 'remorseful, guilty, downcast eyes, frown',
  sadness: 'sad, teary eyes, downturned mouth, frown',
  surprise: 'surprised, wide eyes, open mouth, raised eyebrows',
  neutral: 'neutral expression, calm, closed mouth',
};

// Por si el servidor de Stable Diffusion no responde a la lista de muestreadores (nombres de AUTOMATIC1111).
export const FALLBACK_SAMPLERS = ['Euler a', 'Euler', 'DPM++ 2M', 'DPM++ 2M Karras', 'DPM++ SDE', 'DPM++ 2M SDE', 'DPM++ 3M SDE', 'DDIM', 'UniPC', 'LMS', 'Heun'];
export const FALLBACK_SCHEDULERS = ['Automatic', 'Karras', 'Exponential', 'Polyexponential', 'SGM Uniform', 'Simple', 'Normal', 'DDIM', 'Beta'];
export const FALLBACK_UPSCALERS = ['Latent', 'Latent (antialiased)', 'Latent (bicubic)', 'Latent (nearest)', 'Lanczos', 'Nearest', 'ESRGAN_4x', 'R-ESRGAN 4x+', 'R-ESRGAN 4x+ Anime6B'];

/** Une trozos de prompt separados por comas sin repetir etiquetas (sin distinguir mayúsculas). */
export function joinPrompts(...parts) {
  const seen = new Set();
  const out = [];
  for (const part of parts) {
    for (const raw of String(part ?? '').split(/,|\n/)) {
      const tag = raw.trim();
      const key = tag.toLowerCase();
      if (!tag || seen.has(key)) continue;
      seen.add(key);
      out.push(tag);
    }
  }
  return out.join(', ');
}

export { DEFAULT_EXPRESSIONS };
