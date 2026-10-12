import { activateEntries, estimateTokens, getBookOrNull, normalizeBook } from './lore.js';

export function applyMacros(text, ctx) {
  if (!text) return '';
  const now = new Date();
  return String(text)
    .replace(/\{\{\s*\/\/[\s\S]*?\}\}/g, '')
    .replace(/\{\{\s*char\s*\}\}|<BOT>/gi, ctx.char)
    .replace(/\{\{\s*user\s*\}\}|<USER>/gi, ctx.user)
    .replace(/\{\{\s*date\s*\}\}/gi, now.toLocaleDateString())
    .replace(/\{\{\s*time\s*\}\}/gi, now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))
    .replace(/\{\{\s*random\s*:\s*([^}]*)\}\}/gi, (_, list) => {
      const opts = list.split(',').map((s) => s.trim()).filter(Boolean);
      return opts.length ? opts[Math.floor(Math.random() * opts.length)] : '';
    });
}

async function collectLoreEntries({ settings, speaker, members }) {
  const names = new Set(settings.activeLorebooks || []);
  const cards = members?.length ? members : [speaker];
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

/**
 * Construye los mensajes para el modelo.
 * @param speaker datos de la tarjeta del personaje que va a responder
 * @param members tarjetas de todos los miembros del grupo (null en chat individual)
 * @param history mensajes del chat (sin el que se está generando)
 */
export async function buildPrompt({ settings, speaker, members, persona, userName, history }) {
  const ctx = { char: speaker.name, user: userName };
  const sub = (t) => applyMacros(t, ctx);
  const isGroup = Boolean(members && members.length > 1);

  const visible = history.filter((m) => !m.is_system);
  const loreEntries = await collectLoreEntries({ settings, speaker, members });
  const lore = activateEntries(
    loreEntries,
    visible.map((m) => String(m.mes)),
    { scanDepth: settings.scanDepth, budgetTokens: settings.loreBudget },
  );
  const bucket = (pred) => lore.filter(pred).map((e) => sub(e.content)).join('\n');
  const loreBefore = bucket((e) => [0, 2, 5].includes(e.position));
  const loreAfter = bucket((e) => [1, 3, 6].includes(e.position));
  const loreDepth = lore.filter((e) => e.position === 4);

  const defaultPrompt = sub(settings.systemPrompt);
  const mainPrompt = speaker.system_prompt?.trim() ? sub(speaker.system_prompt).replace(/\{\{\s*original\s*\}\}/gi, defaultPrompt) : defaultPrompt;

  const sections = [mainPrompt];
  if (isGroup) {
    sections.push(
      `This is a group roleplay chat. Participants: ${members.map((m) => m.name).join(', ')}, and ${userName}. You are writing only as ${speaker.name}. Do not write replies for any other participant. Do not start your message with your own name.`,
    );
  }
  if (loreBefore) sections.push(loreBefore);
  for (const c of isGroup ? members : [speaker]) {
    const cs = (t) => applyMacros(t, { char: c.name, user: userName });
    const parts = [];
    if (c.description.trim()) parts.push(cs(c.description));
    if (c.personality.trim()) parts.push(`${c.name}'s personality: ${cs(c.personality)}`);
    if (c.scenario.trim()) parts.push(`Scenario: ${cs(c.scenario)}`);
    if (parts.length) sections.push(isGroup ? `[${c.name}]\n${parts.join('\n')}` : parts.join('\n'));
  }
  if (persona?.description?.trim()) sections.push(`${userName}'s description:\n${sub(persona.description)}`);
  if (loreAfter) sections.push(loreAfter);
  const examples = (isGroup ? members : [speaker]).filter((c) => c.mes_example.trim());
  if (examples.length) {
    sections.push(
      examples
        .map((c) => applyMacros(c.mes_example, { char: c.name, user: userName }).replace(/<START>/gi, '[Example chat]').trim())
        .join('\n\n'),
    );
  }
  const system = sections.filter(Boolean).join('\n\n');

  const toMessage = (m) => {
    if (m.is_user) return { role: 'user', content: isGroup ? `${m.name}: ${m.mes}` : String(m.mes) };
    if (!isGroup || m.name === speaker.name) return { role: 'assistant', content: String(m.mes) };
    return { role: 'user', content: `${m.name}: ${m.mes}` };
  };
  let msgs = visible.map(toMessage);

  const tail = [];
  if (!msgs.length || msgs[msgs.length - 1].role !== 'user') {
    tail.push({ role: 'user', content: `[Continue the roleplay. Write ${speaker.name}'s next reply.]` });
  }
  const post = speaker.post_history_instructions?.trim() ? sub(speaker.post_history_instructions) : '';
  if (post) tail.push({ role: 'system', content: post });

  const depthPrompt = speaker.extensions?.depth_prompt;
  const depthMsgs = loreDepth.map((e) => ({ depth: e.depth ?? 4, role: ['system', 'user', 'assistant'][e.role] || 'system', content: sub(e.content) }));
  if (depthPrompt?.prompt?.trim()) {
    depthMsgs.push({ depth: depthPrompt.depth ?? 4, role: depthPrompt.role || 'system', content: sub(depthPrompt.prompt) });
  }

  const reserved = estimateTokens(system) + tail.reduce((n, m) => n + estimateTokens(m.content), 0) + depthMsgs.reduce((n, m) => n + estimateTokens(m.content), 0);
  const budget = Math.max(512, (settings.maxContext || 16000) - (settings.max_tokens || 400)) - reserved;
  let used = 0;
  let start = msgs.length;
  while (start > 0) {
    const cost = estimateTokens(msgs[start - 1].content) + 4;
    if (used + cost > budget && start < msgs.length) break;
    used += cost;
    start--;
  }
  msgs = msgs.slice(start);

  for (const d of depthMsgs) msgs.splice(Math.max(0, msgs.length - d.depth), 0, { role: d.role, content: d.content });

  return [{ role: 'system', content: system }, ...msgs, ...tail];
}

// Si el modelo antepone "Nombre: " en un chat de grupo, se elimina.
export function stripSpeakerPrefix(text, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text.replace(new RegExp(`^\\s*${escaped}\\s*:\\s*`, 'i'), '');
}
