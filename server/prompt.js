import { activateEntries, estimateTokens, getBookOrNull, normalizeBook } from './lore.js';
import { getOrder } from './presets.js';
import { HttpError } from './util.js';
import { t } from './i18n.js';

export function applyMacros(text, ctx) {
  if (!text) return '';
  const now = new Date();
  return String(text)
    .replace(/\{\{\s*\/\/[\s\S]*?\}\}/g, '')
    .replace(/\{\{\s*char\s*\}\}|<BOT>/gi, () => ctx.char)
    .replace(/\{\{\s*user\s*\}\}|<USER>/gi, () => ctx.user)
    .replace(/\{\{\s*group\s*\}\}/gi, () => ctx.group ?? ctx.char)
    .replace(/\{\{\s*date\s*\}\}/gi, now.toLocaleDateString())
    .replace(/\{\{\s*time\s*\}\}/gi, now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))
    .replace(/\{\{\s*random\s*:\s*([^}]*)\}\}/gi, (_, list) => {
      const opts = list.split(',').map((s) => s.trim()).filter(Boolean);
      return opts.length ? opts[Math.floor(Math.random() * opts.length)] : '';
    });
}

async function collectLoreEntries({ settings, cards }) {
  const names = new Set(settings.activeLorebooks || []);
  for (const c of cards) if (c.extensions?.world) names.add(c.extensions.world);
  const entries = [];
  for (const name of names) {
    const book = await getBookOrNull(name);
    if (book) entries.push(...Object.values(book.entries));
  }
  for (const c of cards) {
    if (c.character_book?.entries) {
      try {
        entries.push(...Object.values(normalizeBook(c.character_book).entries));
      } catch {
        /* libro embebido inválido */
      }
    }
  }
  return entries;
}

const cost = (content) => estimateTokens(content) + 4;

function squash(messages) {
  const out = [];
  for (const m of messages) {
    const last = out[out.length - 1];
    if (last && last.role === 'system' && m.role === 'system') last.content += `\n\n${m.content}`;
    else out.push({ ...m });
  }
  return out;
}

/**
 * Construye los mensajes para el modelo siguiendo el preset activo.
 * @param settings ajustes (profundidad y presupuesto de lorebooks, lorebooks globales)
 * @param preset preset normalizado: parámetros, lista de prompts y su orden
 * @param speaker tarjeta del personaje que va a responder
 * @param members tarjetas de todos los miembros del grupo (null en chat individual)
 * @param history mensajes del chat (sin el que se está generando)
 * @param trigger 'normal' | 'swipe' — filtra prompts con `injection_trigger`
 */
export async function buildPrompt({ settings, preset, speaker, members, persona, userName, history, trigger = 'normal', impersonate = false, draft = '' }) {
  const cards = members?.length ? members : [speaker];
  const isGroup = cards.length > 1;
  const groupNames = cards.map((c) => c.name).join(', ');
  const ctxFor = (c) => ({ char: c.name, user: userName, group: groupNames });
  const sub = (t) => applyMacros(t, ctxFor(speaker));
  const active = trigger === 'swipe' ? ['swipe', 'regenerate'] : ['normal'];
  const triggered = (p) => !p.injection_trigger.length || p.injection_trigger.some((t) => active.includes(t));

  const visible = history.filter((m) => !m.is_system);
  const lore = activateEntries(
    await collectLoreEntries({ settings, cards }),
    visible.map((m) => String(m.mes)),
    { scanDepth: settings.scanDepth, budgetTokens: settings.loreBudget },
  );
  const loreText = (positions) => {
    const t = lore.filter((e) => positions.includes(e.position)).map((e) => sub(e.content)).join('\n');
    return t && preset.wi_format ? preset.wi_format.replace('{0}', () => t) : t;
  };
  const formatted = (format, placeholder, field) =>
    cards
      .filter((c) => c[field].trim())
      .map((c) => applyMacros(format.replace(placeholder, () => c[field]), ctxFor(c)))
      .join('\n');

  const markerText = {
    worldInfoBefore: () => loreText([0, 2, 5]),
    worldInfoAfter: () => loreText([1, 3, 6]),
    charDescription: () =>
      cards
        .map((c) => {
          const d = applyMacros(c.description, ctxFor(c)).trim();
          return d && (isGroup ? `[${c.name}]\n${d}` : d);
        })
        .filter(Boolean)
        .join('\n\n'),
    charPersonality: () => formatted(preset.personality_format, /\{\{personality\}\}/gi, 'personality'),
    scenario: () => formatted(preset.scenario_format, /\{\{scenario\}\}/gi, 'scenario'),
    personaDescription: () => (persona?.description?.trim() ? sub(persona.description) : ''),
    dialogueExamples: () =>
      cards
        .flatMap((c) => applyMacros(c.mes_example, ctxFor(c)).split(/<START>/i))
        .map((b) => b.trim())
        .filter(Boolean)
        .map((b) => (preset.new_example_chat_prompt ? `${preset.new_example_chat_prompt}\n${b}` : b))
        .join('\n'),
  };

  // Una pieza es un mensaje fijo o el hueco donde va el historial.
  const pieces = [];
  const injections = [];
  const byId = new Map(preset.prompts.map((p) => [p.identifier, p]));
  for (const entry of getOrder(preset)) {
    const p = byId.get(entry.identifier);
    if (!entry.enabled || !p || !triggered(p)) continue;
    if (p.identifier === 'chatHistory') {
      pieces.push({ history: true });
      continue;
    }
    if (p.marker) {
      const content = (markerText[p.identifier]?.() ?? '').trim();
      if (content) pieces.push({ role: 'system', content });
      continue;
    }
    // La tarjeta puede reemplazar el prompt principal y las instrucciones posteriores al historial.
    let raw = p.content;
    const override = p.identifier === 'main' ? speaker.system_prompt : p.identifier === 'jailbreak' ? speaker.post_history_instructions : '';
    if (override?.trim() && !p.forbid_overrides) raw = override.replace(/\{\{\s*original\s*\}\}/gi, () => p.content);
    const content = sub(raw).trim();
    if (!content) continue;
    if (p.injection_position === 1) injections.push({ depth: p.injection_depth, order: p.injection_order, role: p.role, content });
    else pieces.push({ role: p.role, content });
  }

  for (const e of lore.filter((x) => x.position === 4)) {
    injections.push({ depth: e.depth ?? 4, order: e.order, role: ['system', 'user', 'assistant'][e.role] || 'system', content: sub(e.content) });
  }
  const dp = speaker.extensions?.depth_prompt;
  if (dp?.prompt?.trim()) injections.push({ depth: dp.depth ?? 4, order: 100, role: dp.role || 'system', content: sub(dp.prompt) });

  const toMessage = (m) => {
    if (m.is_user) return { role: 'user', content: isGroup ? `${m.name}: ${m.mes}` : String(m.mes) };
    if (!isGroup || m.name === speaker.name) return { role: 'assistant', content: String(m.mes) };
    return { role: 'user', content: `${m.name}: ${m.mes}` };
  };
  let msgs = visible.map(toMessage);

  const intro = msgs.length ? sub(isGroup ? preset.new_group_chat_prompt : preset.new_chat_prompt).trim() : '';
  const afterHistory = [];
  if (impersonate) {
    // El modelo escribe por el usuario: la última instrucción va como mensaje de usuario para que el historial termine en un turno válido.
    const instruction = sub(preset.impersonation_prompt).trim() || `[Write your next reply from the point of view of ${userName}.]`;
    const start = draft.trim() ? `Begin your reply with the following text and continue naturally from it:\n${draft.trim()}` : '';
    afterHistory.push({ role: 'user', content: [instruction, start].filter(Boolean).join('\n\n') });
  } else {
    if (!msgs.length || msgs[msgs.length - 1].role !== 'user') {
      afterHistory.push({ role: 'user', content: `[Continue the roleplay. Write ${speaker.name}'s next reply.]` });
    }
    const nudge = isGroup ? sub(preset.group_nudge_prompt).trim() : '';
    if (nudge) afterHistory.push({ role: 'system', content: nudge });
  }

  const fixed = [...pieces.filter((p) => !p.history), ...injections, ...afterHistory, ...(intro ? [{ content: intro }] : [])].reduce((n, m) => n + cost(m.content), 0);
  const budget = Math.max(512, preset.openai_max_context - preset.openai_max_tokens) - fixed;
  let used = 0;
  let start = msgs.length;
  while (start > 0) {
    const c = cost(msgs[start - 1].content);
    if (used + c > budget && start < msgs.length) break;
    used += c;
    start--;
  }
  msgs = msgs.slice(start);

  // Los prompts "en el chat" se insertan contando mensajes desde el final del historial.
  const buckets = new Map();
  for (const inj of injections) {
    const at = Math.min(msgs.length, Math.max(0, msgs.length - inj.depth));
    buckets.set(at, [...(buckets.get(at) || []), inj]);
  }
  const withInjections = [];
  for (let i = 0; i <= msgs.length; i++) {
    const here = (buckets.get(i) || []).sort((a, b) => a.order - b.order);
    withInjections.push(...here.map(({ role, content }) => ({ role, content })));
    if (i < msgs.length) withInjections.push(msgs[i]);
  }

  const historyBlock = [...(intro ? [{ role: 'system', content: intro }] : []), ...withInjections, ...afterHistory];
  const messages = pieces.flatMap((p) => (p.history ? historyBlock : [{ role: p.role, content: p.content }]));
  if (!messages.length) throw new HttpError(400, t('server.presets.no_prompt'));
  return preset.squash_system_messages ? squash(messages) : messages;
}

// Si el modelo antepone "Nombre: " en un chat de grupo, se elimina.
export function stripSpeakerPrefix(text, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text.replace(new RegExp(`^\\s*${escaped}\\s*:\\s*`, 'i'), '');
}
