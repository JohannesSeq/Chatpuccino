import { t } from './i18n.js';

// Explica por qué una respuesta del modelo salió vacía: lo registra en la consola del servidor y devuelve
// un mensaje para el usuario (con el motivo y qué hacer) más los datos de diagnóstico.

/** Motivo más probable según lo que devolvió el proveedor (`meta` lo rellena providers.streamChat). */
export function diagnoseEmpty(meta = {}, { cleanedEmpty = false } = {}) {
  if (meta.refusal || meta.finishReason === 'content_filter') return 'refusal';
  if (cleanedEmpty) return 'cleaned_empty';
  if (meta.finishReason === 'length') return meta.reasoningChars > 0 ? 'length_reasoning' : 'length';
  if (meta.reasoningChars > 0 && !meta.contentChars) return 'reasoning_only';
  if (!meta.events) return 'no_events';
  return 'empty';
}

/**
 * @param where 'assistant' | 'chat' | 'world' (qué ajuste de tokens mencionar)
 * @returns objeto listo para enviar por SSE: { error, code, reason, details }
 */
export function reportEmpty({ where, conn, meta = {}, maxTokens, cleanedEmpty = false }) {
  const reason = diagnoseEmpty(meta, { cleanedEmpty });
  const model = meta.responseModel || conn?.model || '?';
  const details = {
    reason,
    model,
    provider: meta.provider || undefined,
    finishReason: meta.finishReason || undefined,
    contentChars: meta.contentChars || 0,
    reasoningChars: meta.reasoningChars || 0,
    maxTokens,
  };
  // Registro completo para depurar (no incluye claves ni la petición, solo la forma de la respuesta).
  console.warn(
    `[IA] Respuesta vacía en «${where}» (${reason}):`,
    JSON.stringify(
      {
        ...details,
        requestedModel: conn?.model,
        endpoint: conn?.type === 'local' ? conn.baseUrl : 'openrouter',
        status: meta.status,
        contentType: meta.contentType,
        nativeFinishReason: meta.nativeFinishReason,
        refusal: meta.refusal ? String(meta.refusal).slice(0, 200) : undefined,
        usage: meta.usage || undefined,
        events: meta.events,
        nonStream: meta.nonStream || undefined,
        ms: meta.ms,
        responseId: meta.id || undefined,
        sample: meta.sample,
      },
      null,
      2,
    ),
  );
  const error = t(`server.empty.${reason}`, { model, maxTokens: maxTokens ?? '?', setting: t(`server.empty.setting_${where}`) });
  return { error, code: 'EMPTY_RESPONSE', reason, details };
}
