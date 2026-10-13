// [clave, etiqueta, mínimo, máximo, paso] de los parámetros de muestreo (presets y asistente de personajes).
export const SAMPLERS = [
  ['temperature', 'Temperatura', 0, 2, 0.05],
  ['top_p', 'Top P', 0, 1, 0.01],
  ['top_k', 'Top K (0 = desactivado)', 0, 200, 1],
  ['top_a', 'Top A (0 = desactivado)', 0, 1, 0.01],
  ['min_p', 'Min P (0 = desactivado)', 0, 1, 0.01],
  ['frequency_penalty', 'Penalización de frecuencia', -2, 2, 0.05],
  ['presence_penalty', 'Penalización de presencia', -2, 2, 0.05],
  ['repetition_penalty', 'Penalización de repetición (1 = ninguna)', 0, 2, 0.05],
  ['openai_max_tokens', 'Máx. tokens de respuesta', 16, 32768, 16],
  ['openai_max_context', 'Contexto máximo (tokens)', 1024, 2000000, 512],
];
