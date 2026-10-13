// Abre una respuesta Server-Sent Events. Devuelve un AbortController (se aborta si el cliente cierra) y `send`.
export function startSse(res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  const ac = new AbortController();
  res.on('close', () => {
    if (!res.writableEnded) ac.abort();
  });
  return { ac, send: (obj) => !res.writableEnded && res.write(`data: ${JSON.stringify(obj)}\n\n`) };
}
