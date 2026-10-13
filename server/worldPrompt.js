// Prompts del Modo Novela: escena, mensaje del usuario (impersonar) y análisis de estadísticas. Todo el andamiaje pasa por i18n.
import { DEFAULT_EXPRESSIONS } from '../shared/vn.js';
import { currentLang, languages, t } from './i18n.js';
import { activateEntries, estimateTokens } from './lore.js';
import { applyMacros, collectLoreEntries, squash } from './prompt.js';

const cost = (content) => estimateTokens(content) + 4;
const DESC_MAX = 200;
const clip = (s, n) => {
  const x = String(s ?? '').replace(/\s+/g, ' ').trim();
  return x.length > n ? `${x.slice(0, n - 1)}…` : x;
};

function languageName() {
  const code = currentLang();
  return languages().find((l) => l.code === code)?.name || code;
}

const range = (s) => `${s.min}–${s.max}`;

function onStageOf(cast, state) {
  return (state.scene.active || []).map((id) => cast.find((c) => c.id === id)).filter(Boolean);
}

/** Definiciones de las estadísticas y sus valores actuales para `chars` (las de mundo, una sola vez). */
export function statsBlock({ stats, state, chars, withRule = true }) {
  if (!stats.length) return '';
  const out = [t('server.worlds.prompt.stats_title'), t('server.worlds.prompt.stats_intro')];
  for (const s of stats) {
    const key = s.scope === 'world' ? 'server.worlds.prompt.stat_world' : 'server.worlds.prompt.stat_character';
    out.push(t(key, { name: s.name, id: s.id, min: s.min, max: s.max, description: clip(s.description, DESC_MAX) || '—' }));
  }
  out.push(t('server.worlds.prompt.stats_values'));
  const fmt = (list, bag) => list.map((s) => `${s.name} ${bag?.[s.id]}`).join(', ');
  const worldStats = stats.filter((s) => s.scope === 'world');
  const charStats = stats.filter((s) => s.scope !== 'world');
  if (worldStats.length) out.push(t('server.worlds.prompt.stat_value_world', { values: fmt(worldStats, state.stats.world) }));
  if (charStats.length) for (const c of chars) out.push(t('server.worlds.prompt.stat_value_character', { name: c.name, values: fmt(charStats, state.stats.characters[c.id]) }));
  if (withRule) out.push(t('server.worlds.prompt.stats_rule'));
  return out.join('\n');
}

function expressionLabels(c, state) {
  const current = state.scene.outfits?.[c.id] || c.defaultOutfit;
  const outfit = c.outfits.find((o) => o.id === current) || c.outfits[0];
  return Object.entries(outfit?.expressions || {}).filter(([, files]) => files?.length).map(([label]) => label);
}

function expressionsBlock(chars, state) {
  if (!chars.length) return '';
  const out = [t('server.worlds.prompt.expressions_title'), t('server.worlds.prompt.expressions_intro')];
  const plain = [];
  for (const c of chars) {
    const labels = expressionLabels(c, state);
    if (labels.length) out.push(t('server.worlds.prompt.expressions_line', { name: c.name, labels: labels.join(', ') }));
    else plain.push(c.name);
  }
  if (plain.length) out.push(t('server.worlds.prompt.expressions_line', { name: plain.join(', '), labels: DEFAULT_EXPRESSIONS.join(', ') }));
  return out.join('\n');
}

const outfitLabel = (o) => (o.id === o.name ? o.name : `${o.name} [${o.id}]`);

function outfitsBlock(chars, state) {
  const lines = [];
  for (const c of chars) {
    if (c.outfits.length < 2) continue;
    const current = c.outfits.find((o) => o.id === (state.scene.outfits?.[c.id] || c.defaultOutfit)) || c.outfits[0];
    lines.push(t('server.worlds.prompt.outfit_line', { name: c.name, current: outfitLabel(current), list: c.outfits.map(outfitLabel).join(', ') }));
  }
  return lines.length ? [t('server.worlds.prompt.outfits_title'), t('server.worlds.prompt.outfits_intro'), ...lines].join('\n') : '';
}

const MAX_BACKGROUNDS = 40;

function backgroundsBlock(backgrounds, state) {
  if (!backgrounds.length) return '';
  const current = backgrounds.find((b) => b.id === state.scene.background);
  const out = [t('server.worlds.prompt.backgrounds_title'), t('server.worlds.prompt.backgrounds_intro', { current: current ? current.name : t('server.worlds.prompt.none') })];
  for (const b of backgrounds.slice(0, MAX_BACKGROUNDS)) {
    out.push(t('server.worlds.prompt.background_line', { id: b.id, name: b.name, description: b.description ? ` — ${clip(b.description, 120)}` : '' }));
  }
  return out.join('\n');
}

function controlBlock({ chars, cast, stats, backgrounds }) {
  const hasOutfits = chars.some((c) => c.outfits.length > 1);
  const hasBackgrounds = backgrounds.length > 0;
  const canMove = cast.length > 0;
  if (!stats.length && !hasOutfits && !hasBackgrounds && !canMove) return '';
  const example = {};
  const who = chars[0]?.name || cast[0]?.name;
  const out = [t('server.worlds.prompt.control_title'), t('server.worlds.prompt.control_intro')];
  if (stats.length) {
    const s = stats.find((x) => x.scope !== 'world') || stats[0];
    example.stats = [s.scope === 'world' ? { stat: s.id, change: 3, reason: t('server.worlds.prompt.example_reason') } : { character: who, stat: s.id, change: 3, reason: t('server.worlds.prompt.example_reason') }];
    out.push(t('server.worlds.prompt.control_stats'));
  }
  const scene = {};
  if (hasBackgrounds) {
    scene.background = backgrounds[0].id;
    out.push(t('server.worlds.prompt.control_background'));
  }
  if (hasOutfits) {
    const c = chars.find((x) => x.outfits.length > 1);
    scene.outfits = { [c.name]: c.outfits[c.outfits.length - 1].id };
    out.push(t('server.worlds.prompt.control_outfits'));
  }
  if (canMove) {
    out.push(t('server.worlds.prompt.control_move'));
    if (cast.length > chars.length) scene.enter = [cast.find((c) => !chars.includes(c)).name];
  }
  if (Object.keys(scene).length) example.scene = scene;
  out.push(t('server.worlds.prompt.control_example', { example: JSON.stringify(example) }));
  return out.join('\n');
}

function cardBlock(c, ctx) {
  const d = c.data || {};
  const sub = (s) => applyMacros(s, ctx).trim();
  const out = [t('server.worlds.prompt.character_title', { name: c.name })];
  if (sub(d.description)) out.push(sub(d.description));
  if (sub(d.personality)) out.push(t('server.worlds.prompt.personality', { text: sub(d.personality) }));
  if (sub(d.scenario)) out.push(t('server.worlds.prompt.scenario', { text: sub(d.scenario) }));
  const examples = sub(String(d.mes_example || '').replace(/<START>/gi, '\n'));
  if (examples) out.push(t('server.worlds.prompt.examples', { text: examples }));
  return out.join('\n');
}

async function loreBlock({ world, settings, preset, chars, history, macroCtx }) {
  const cards = chars.map((c) => c.data).filter(Boolean);
  const entries = await collectLoreEntries({ settings: { activeLorebooks: world.lorebooks || [] }, cards });
  if (!entries.length) return '';
  const lore = activateEntries(entries, history.map((m) => String(m.mes)), { scanDepth: settings.scanDepth, budgetTokens: settings.loreBudget });
  const text = lore.map((e) => applyMacros(e.content, macroCtx).trim()).filter(Boolean).join('\n');
  if (!text) return '';
  const body = preset?.wi_format ? preset.wi_format.replace('{0}', () => text) : text;
  return `${t('server.worlds.prompt.lore_title')}\n${body}`;
}

/**
 * Mensajes para el modelo.
 * @param world configuración del mundo
 * @param cast reparto completo: [{ id, name, data (tarjeta), defaultOutfit, outfits:[{ id, name, expressions }] }]
 * @param stats estadísticas adjuntas
 * @param backgrounds biblioteca de fondos
 * @param state estado ANTES del mensaje que se va a generar (estadísticas + escena)
 * @param history mensajes anteriores (sin el que se genera)
 * @param mode 'scene' (guion del narrador) | 'impersonate' (mensaje del usuario)
 */
export async function buildSceneMessages({
  world, settings, preset, persona, cast, stats, backgrounds, state, history,
  mode = 'scene', speakerId = '', instruction = '', start = false, draft = '',
}) {
  const userName = persona.name;
  const chars = onStageOf(cast, state);
  const offstage = cast.filter((c) => !chars.includes(c));
  const names = chars.map((c) => c.name);
  const macroCtx = { char: names[0] || world.name, user: userName, group: names.join(', ') };
  const visible = history.filter((m) => !m.is_system);
  const impersonate = mode === 'impersonate';
  const language = languageName();

  const sections = [];
  if (impersonate) {
    sections.push(t('server.worlds.prompt.impersonate_role', { user: userName }));
    sections.push(t('server.worlds.prompt.impersonate_rules', { user: userName, language }));
  } else {
    sections.push(t('server.worlds.prompt.role', { user: userName }));
    sections.push(t('server.worlds.prompt.format', { user: userName, language, example: names[0] || cast[0]?.name || 'Name' }));
  }
  if (world.description?.trim()) sections.push(`${t('server.worlds.prompt.premise_title')}\n${applyMacros(world.description, macroCtx).trim()}`);
  sections.push(
    [
      t('server.worlds.prompt.scene_title'),
      t('server.worlds.prompt.scene_line', {
        background: backgrounds.find((b) => b.id === state.scene.background)?.name || t('server.worlds.prompt.none'),
        names: names.join(', ') || t('server.worlds.prompt.nobody'),
      }),
    ].join('\n'),
  );
  if (chars.length) sections.push([t('server.worlds.prompt.characters_title'), ...chars.map((c) => cardBlock(c, { char: c.name, user: userName, group: names.join(', ') }))].join('\n\n'));
  const personaText = persona.description?.trim() ? applyMacros(persona.description, macroCtx).trim() : '';
  sections.push([t('server.worlds.prompt.persona_title', { user: userName }), personaText].filter(Boolean).join('\n'));
  if (offstage.length) sections.push(t('server.worlds.prompt.offstage', { names: offstage.map((c) => c.name).join(', ') }));
  const lore = await loreBlock({ world, settings, preset, chars, history: visible, macroCtx });
  if (lore) sections.push(lore);
  sections.push(statsBlock({ stats, state, chars, withRule: !impersonate }));
  if (!impersonate) {
    sections.push(expressionsBlock(chars, state));
    sections.push(outfitsBlock(chars, state));
    sections.push(backgroundsBlock(backgrounds, state));
    sections.push(controlBlock({ chars, cast, stats, backgrounds }));
  }
  const system = { role: 'system', content: sections.filter(Boolean).join('\n\n') };

  let msgs = visible.map((m) => ({ role: m.is_user ? 'user' : 'assistant', content: String(m.mes) }));

  const directive = [];
  if (impersonate) {
    directive.push(t('server.worlds.prompt.impersonate_directive', { user: userName }));
    if (draft.trim()) directive.push(t('server.worlds.prompt.impersonate_draft', { text: draft.trim() }));
  } else {
    if (start) directive.push(t('server.worlds.prompt.directive_start', { user: userName }));
    else if (!msgs.length || msgs[msgs.length - 1].role !== 'user') directive.push(t('server.worlds.prompt.directive_continue'));
    const speaker = speakerId && chars.find((c) => c.id === speakerId);
    if (speaker) directive.push(t('server.worlds.prompt.directive_speaker', { name: speaker.name }));
    if (instruction.trim()) directive.push(t('server.worlds.prompt.directive_instruction', { text: instruction.trim() }));
  }
  const tail = directive.length ? [{ role: 'user', content: directive.join('\n') }] : [];

  const fixed = [system, ...tail].reduce((n, m) => n + cost(m.content), 0);
  const budget = Math.max(512, preset.openai_max_context - preset.openai_max_tokens) - fixed;
  let used = 0;
  let from = msgs.length;
  while (from > 0) {
    const c = cost(msgs[from - 1].content);
    if (used + c > budget && from < msgs.length) break;
    used += c;
    from--;
  }
  msgs = msgs.slice(from);

  const all = [system, ...msgs, ...tail];
  return preset.squash_system_messages ? squash(all) : all;
}

/** Llamada pequeña que pide solo los cambios de estadísticas de una escena cuando el modelo no escribió el bloque de control. */
export function buildAnalysisMessages({ persona, cast, stats, state, scriptText, userMessage }) {
  const language = languageName();
  const defs = stats.map((s) =>
    t(s.scope === 'world' ? 'server.worlds.prompt.stat_world' : 'server.worlds.prompt.stat_character', { name: s.name, id: s.id, min: s.min, max: s.max, description: clip(s.description, DESC_MAX) || '—' }),
  );
  const values = statsBlock({ stats, state, chars: cast, withRule: false }).split('\n');
  // Solo las líneas de valores: las definiciones ya van arriba.
  const valueLines = values.slice(values.findIndex((l) => l === t('server.worlds.prompt.stats_values')) + 1);
  return [
    { role: 'system', content: t('server.worlds.prompt.analysis_system', { language }) },
    {
      role: 'user',
      content: t('server.worlds.prompt.analysis_user', {
        user: persona.name,
        stats: defs.join('\n'),
        values: valueLines.join('\n'),
        message: clip(userMessage, 1500) || '—',
        scene: scriptText,
      }),
    },
  ];
}
