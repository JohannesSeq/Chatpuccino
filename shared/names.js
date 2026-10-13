// Sustituye {{user}} / {{char}} (y los antiguos <USER> / <BOT>) por los nombres actuales.
// Es determinista a propósito: se usa tanto al mostrar mensajes como al enviarlos al modelo.
export function fillNames(text, { user, char } = {}) {
  if (!text || typeof text !== 'string') return text;
  let out = text;
  if (char) out = out.replace(/\{\{\s*char\s*\}\}|<BOT>/gi, () => char);
  if (user) out = out.replace(/\{\{\s*user\s*\}\}|<USER>/gi, () => user);
  return out;
}
