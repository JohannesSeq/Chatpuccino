// Clasificador local de emociones (gratis, sin red) para elegir el sprite de un personaje en el chat.
// No es un modelo: puntúa palabras clave en español e inglés, signos de puntuación y emojis, y devuelve las emociones
// ordenadas. Con la opción «IA» de la interfaz, es el modelo de lenguaje quien elige entre las expresiones disponibles.

const norm = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

// Raíces de palabras (se comparan como prefijo de palabra) y frases por emoción.
const WORDS = {
  joy: ['feliz', 'felicidad', 'alegr', 'content', 'encant', 'genial', 'maravill', 'sonri', 'rie', 'rien', 'risa', 'happy', 'joy', 'glad', 'smile', 'laugh', 'giggle', 'grin', 'delight', 'cheer', 'wonderful'],
  amusement: ['carcaj', 'jaja', 'jeje', 'haha', 'lol', 'divertid', 'gracios', 'chiste', 'bromea', 'burla', 'ocurrent', 'funny', 'amus', 'joke', 'chuckle', 'snicker', 'smirk', 'smug', 'tease'],
  love: ['te quiero', 'te amo', 'amor', 'querid', 'cariñ', 'carin', 'corazon', 'beso', 'besa', 'abraz', 'love', 'darling', 'sweetheart', 'kiss', 'hug', 'adore', 'beloved', 'cuddle'],
  desire: ['deseo', 'desea', 'anhel', 'ansi', 'tentad', 'seduc', 'sensual', 'susurra', 'ronronea', 'desire', 'crave', 'longing', 'seduc', 'tempt', 'purr', 'flirt', 'coquet'],
  caring: ['cuidar', 'cuida', 'tranquil', 'esta bien', 'estoy aqui', 'no te preocupes', 'consuel', 'protege', 'acarici', 'tender', 'care', 'comfort', 'gentle', 'soothe', 'worry about you', 'its okay', 'it is okay', 'here for you', 'safe'],
  gratitude: ['gracias', 'agradec', 'te debo', 'thank', 'grateful', 'appreciate', 'indebted'],
  admiration: ['admira', 'increible', 'impresion', 'asombr', 'maravill', 'magnific', 'fascin', 'wow', 'amazing', 'impressive', 'awe', 'admire', 'incredible', 'remarkable', 'astonish'],
  approval: ['bien hecho', 'buen trabajo', 'de acuerdo', 'claro que si', 'asiente', 'aprueba', 'correcto', 'exacto', 'perfecto', 'good job', 'well done', 'agree', 'nods', 'approve', 'exactly', 'precisely', 'indeed', 'right you are'],
  excitement: ['emocion', 'entusias', 'impaciente', 'no puedo esperar', 'vamos', 'salta de', 'excit', 'thrill', "can't wait", 'cannot wait', 'hurray', 'yay', 'eager', 'pumped', 'let\'s go', 'lets go', 'brilla', 'sparkl'],
  optimism: ['esperanza', 'esperanzad', 'optimis', 'todo saldra bien', 'confia', 'seguro que', 'hope', 'optimis', 'brighter', 'bright side', 'will be fine', 'will work out', 'believe in'],
  pride: ['orgull', 'presume', 'altiv', 'arrogan', 'superior', 'orgulloso', 'proud', 'pride', 'boast', 'brag', 'haughty', 'triumph', 'victori', 'lifts her chin', 'lifts his chin'],
  relief: ['alivio', 'aliviad', 'menos mal', 'por fin', 'suspira aliv', 'respira hondo', 'relief', 'relieved', 'thank goodness', 'finally', 'at last', 'phew', 'exhales'],
  surprise: ['sorpres', 'sorprend', 'asombrad', 'no puede ser', 'de repente', 'jadea', 'abre los ojos', 'ojos como platos', 'surpris', 'shock', 'gasp', 'startl', 'suddenly', 'eyes widen', 'wide eyes', 'what?!', 'no way'],
  confusion: ['confus', 'no entiendo', 'desconcert', 'extran', 'perplej', 'ladea la cabeza', 'que?', 'confus', 'puzzl', "don't understand", 'dont understand', 'bewilder', 'huh', 'what do you mean', 'tilts her head', 'tilts his head', 'baffl'],
  curiosity: ['curios', 'interesante', 'me pregunto', 'dime', 'cuentame', 'por que', 'como asi', 'curious', 'wonder', 'interesting', 'tell me', 'intrigu', 'why', 'how come', 'leans in', 'se inclina'],
  nervousness: ['nervios', 'ansios', 'tartamude', 'titube', 'inquiet', 'sonroj', 'balbuce', 'tiembl', 'nervous', 'anxious', 'stammer', 'stutter', 'fidget', 'blush', 'hesita', 'uneasy', 'trembl', 'gulps', 'traga saliva', 'um,', 'eh...', 'umm'],
  embarrassment: ['verguenza', 'avergonz', 'apenad', 'pena', 'ruboriz', 'se sonroja', 'embarrass', 'ashamed', 'mortified', 'flustered', 'blushes', 'cheeks burn', 'mejillas'],
  fear: ['miedo', 'terror', 'asustad', 'asusta', 'temor', 'pavor', 'horror', 'huye', 'cuidado', 'afraid', 'scared', 'fear', 'terrif', 'frighten', 'panic', 'dread', 'run!', 'tiembla de miedo', 'shiver'],
  anger: ['enojad', 'enfad', 'furios', 'ira', 'rabia', 'maldit', 'gruñ', 'grun', 'golpea', 'grita', 'cabr', 'idiota', 'odio', 'angry', 'furious', 'rage', 'damn', 'growl', 'snarl', 'hate', 'bastard', 'idiot', 'shouts', 'slams', 'glares'],
  annoyance: ['molest', 'fastidi', 'irrita', 'harta', 'hartazg', 'pesad', 'rueda los ojos', 'resopla', 'chasquea', 'tsk', 'annoy', 'irritat', 'fed up', 'ugh', 'rolls her eyes', 'rolls his eyes', 'sighs', 'scoff', 'tch', 'bother'],
  disapproval: ['no apruebo', 'desaprueb', 'no deberias', 'inaceptable', 'mal hecho', 'niega con la cabeza', 'frunce el ceño', 'frunce el ceno', 'disapprov', 'unacceptable', 'shakes her head', 'shakes his head', 'frown', 'should not', "shouldn't", 'tut'],
  disgust: ['asco', 'repugn', 'asquer', 'nauseab', 'puaj', 'iugh', 'disgust', 'gross', 'revolt', 'ew', 'yuck', 'sicken', 'repuls', 'nause', 'vile'],
  sadness: ['trist', 'llora', 'lagrim', 'llanto', 'sollozo', 'deprimid', 'melanc', 'soledad', 'nostalg', 'lo siento mucho', 'sad', 'cry', 'tear', 'sob', 'weep', 'sorrow', 'depress', 'lonely', 'heartbroken', 'miserable', 'mourn'],
  grief: ['luto', 'duelo', 'muert', 'perdi a', 'fallec', 'funeral', 'desconsolad', 'devastad', 'grief', 'death', 'died', 'lost him', 'lost her', 'mourning', 'funeral', 'devastat', 'bereave'],
  disappointment: ['decepcion', 'desilusion', 'defraud', 'esperaba mas', 'que lastima', 'lastima', 'disappoint', 'let down', 'expected more', 'what a pity', 'what a shame', 'sigh', 'suspira'],
  remorse: ['perdon', 'lo siento', 'disculp', 'arrepent', 'culpa', 'remordim', 'fue mi error', 'sorry', 'apolog', 'regret', 'my fault', 'forgive me', 'guilt', 'remorse', 'ashamed of what'],
  realization: ['ahora entiendo', 'ya veo', 'me doy cuenta', 'comprend', 'caigo en cuenta', 'claro!', 'ahora lo', 'de pronto lo', 'realiz', 'i see', 'now i understand', 'it dawns', 'dawn on', 'that explains', 'aha', 'oh!', 'eureka', 'so that is'],
};

// Emoticonos y emojis habituales.
const EMOJI = [
  [/[😀😃😄😁😆😊🙂😍🥰😘❤💕💖💗💓💞☺]/u, 'joy', 1.2],
  [/[😂🤣😹😜😝😛😏]/u, 'amusement', 1.4],
  [/[😢😭😿😞😔🥺💔]/u, 'sadness', 1.6],
  [/[😡😠🤬👿💢]/u, 'anger', 1.6],
  [/[😱😨😰😧]/u, 'fear', 1.6],
  [/[😮😲🤯😳]/u, 'surprise', 1.4],
  [/[🤢🤮]/u, 'disgust', 1.6],
  [/[🤔🧐]/u, 'curiosity', 1.2],
  [/[😅😬]/u, 'nervousness', 1.2],
  [/[😒🙄😤]/u, 'annoyance', 1.4],
  [/[:;]-?[)D]|\^_\^|\^\^/, 'joy', 1.0],
  [/[:;]-?\(|;_;|T_T/, 'sadness', 1.0],
];

// Si la emoción pedida no está entre los sprites, se prueban estas parecidas (en orden).
export const RELATED = {
  joy: ['amusement', 'excitement', 'optimism', 'admiration', 'love', 'approval'],
  amusement: ['joy', 'excitement', 'optimism', 'approval'],
  excitement: ['joy', 'amusement', 'optimism', 'admiration', 'surprise'],
  optimism: ['joy', 'approval', 'caring', 'relief'],
  admiration: ['approval', 'joy', 'surprise', 'excitement'],
  approval: ['joy', 'optimism', 'admiration', 'gratitude'],
  gratitude: ['joy', 'caring', 'love', 'approval', 'relief'],
  love: ['caring', 'joy', 'desire', 'gratitude'],
  desire: ['love', 'nervousness', 'embarrassment', 'excitement'],
  caring: ['love', 'gratitude', 'optimism', 'sadness'],
  pride: ['joy', 'approval', 'amusement'],
  relief: ['joy', 'gratitude', 'optimism'],
  surprise: ['confusion', 'fear', 'excitement', 'realization'],
  realization: ['surprise', 'curiosity', 'confusion'],
  curiosity: ['confusion', 'surprise', 'realization'],
  confusion: ['curiosity', 'surprise', 'nervousness'],
  nervousness: ['fear', 'embarrassment', 'confusion', 'sadness'],
  embarrassment: ['nervousness', 'joy', 'sadness'],
  fear: ['nervousness', 'surprise', 'sadness'],
  anger: ['annoyance', 'disapproval', 'disgust'],
  annoyance: ['anger', 'disapproval', 'disappointment'],
  disapproval: ['annoyance', 'anger', 'disappointment', 'disgust'],
  disgust: ['disapproval', 'annoyance', 'anger'],
  sadness: ['grief', 'disappointment', 'remorse', 'fear'],
  grief: ['sadness', 'remorse', 'disappointment'],
  disappointment: ['sadness', 'annoyance', 'remorse'],
  remorse: ['sadness', 'embarrassment', 'grief'],
};

const PRECOMPILED = Object.fromEntries(
  Object.entries(WORDS).map(([label, list]) => [label, [...new Set(list.map((w) => norm(w).trim()).filter(Boolean))]]),
);

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Una raíz coincide al inicio de una palabra; las palabras cortas (sad, ira…) deben ir completas para no confundirse con otras (sigh/sight).
const MATCHERS = Object.fromEntries(
  Object.entries(PRECOMPILED).map(([label, list]) => [label, list.map((w) => new RegExp(w.length <= 4 && /^[a-z]+$/.test(w) ? `(?:^|[^a-z0-9])${w}(?:s|es|ed|ing)?(?![a-z0-9])` : `(?:^|[^a-z0-9])${escapeRe(w)}`, 'g'))]),
);

/**
 * Emociones puntuadas de un texto: [{ label, score }] de mayor a menor (solo las que puntúan).
 * Lo que aparece al final del mensaje pesa más, porque suele ser el estado con el que termina de hablar.
 */
export function scoreExpressions(text) {
  const raw = String(text ?? '');
  const t = norm(raw);
  if (!t.trim()) return [];
  const tailStart = Math.max(0, t.length - 220);
  const scores = {};
  const add = (label, n) => {
    scores[label] = (scores[label] || 0) + n;
  };
  for (const [label, regs] of Object.entries(MATCHERS)) {
    for (const re of regs) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(t))) {
        add(label, m.index >= tailStart ? 1.5 : 1);
        if (m[0].length === 0) re.lastIndex += 1;
      }
    }
  }
  for (const [re, label, weight] of EMOJI) if (re.test(raw)) add(label, weight);
  // Puntuación: una pista débil, solo cuando no hay nada mejor que la contradiga.
  const bang = (raw.match(/!/g) || []).length;
  const q = (raw.match(/\?/g) || []).length;
  const dots = (raw.match(/\.{3}|…/g) || []).length;
  if (bang >= 2) add('excitement', 0.6);
  if (q >= 2) add('confusion', 0.5);
  else if (q === 1 && /\?\s*(?:["»”*]|$)/.test(raw.trim().slice(-6))) add('curiosity', 0.4);
  if (dots >= 2) add('nervousness', 0.35);
  if (/[A-ZÁÉÍÓÚÑ]{4,}/.test(raw) && bang) add('anger', 0.5);
  return Object.entries(scores)
    .filter(([, s]) => s > 0)
    .map(([label, score]) => ({ label, score }))
    .sort((a, b) => b.score - a.score);
}

/**
 * Expresión para un texto. `available` son las etiquetas que tiene el personaje (array o conjunto); si se indica, se devuelve
 * la mejor emoción cuyo sprite exista (o una parecida) y si no hay ninguna, `fallback`.
 */
export function classifyExpression(text, available = null, fallback = 'neutral') {
  const ranked = scoreExpressions(text);
  const has = available ? (() => {
    const set = available instanceof Set ? available : new Set(available);
    return (l) => set.has(l);
  })() : () => true;
  for (const { label } of ranked) {
    if (has(label)) return label;
    const alt = (RELATED[label] || []).find(has);
    if (alt) return alt;
  }
  return fallback;
}
