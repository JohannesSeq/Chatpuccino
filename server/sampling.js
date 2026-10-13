// Parámetros de muestreo de un preset en el formato de la API de chat/completions.
export function samplingParams(p, userName, stop = userName ? [`\n${userName}:`] : []) {
  const body = { temperature: p.temperature, top_p: p.top_p, max_tokens: p.openai_max_tokens };
  if (stop?.length) body.stop = stop;
  if (p.top_k > 0) body.top_k = p.top_k;
  if (p.top_a > 0) body.top_a = p.top_a;
  if (p.min_p > 0) body.min_p = p.min_p;
  if (p.frequency_penalty) body.frequency_penalty = p.frequency_penalty;
  if (p.presence_penalty) body.presence_penalty = p.presence_penalty;
  if (p.repetition_penalty && p.repetition_penalty !== 1) body.repetition_penalty = p.repetition_penalty;
  return body;
}
