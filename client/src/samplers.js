// [clave, mínimo, máximo, paso] de los parámetros de muestreo (presets y asistente de personajes).
// El nombre de cada parámetro se traduce con la clave `samplers.<clave>`.
export const SAMPLERS = [
  ['temperature', 0, 2, 0.05],
  ['top_p', 0, 1, 0.01],
  ['top_k', 0, 200, 1],
  ['top_a', 0, 1, 0.01],
  ['min_p', 0, 1, 0.01],
  ['frequency_penalty', -2, 2, 0.05],
  ['presence_penalty', -2, 2, 0.05],
  ['repetition_penalty', 0, 2, 0.05],
  ['openai_max_tokens', 16, 32768, 16],
  ['openai_max_context', 1024, 2000000, 512],
];
