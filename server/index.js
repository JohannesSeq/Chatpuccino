import express from 'express';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { DATA, ROOT, ensureDirs } from './config.js';
import authRoutes, { loadAuth, requireAuth } from './auth.js';
import settingsRoutes from './routes/settings.js';
import connectionRoutes from './routes/connections.js';
import presetRoutes from './routes/presets.js';
import appearanceRoutes from './routes/appearance.js';
import assistantRoutes from './routes/assistant.js';
import { listPresets } from './presets.js';
import characterRoutes from './routes/characters.js';
import chatRoutes from './routes/chats.js';
import { groups, lorebooks, personas } from './routes/library.js';

export function createApp() {
  ensureDirs();
  loadAuth().catch((e) => console.error('No se pudo inicializar la autenticación', e));
  listPresets().catch((e) => console.error('No se pudo inicializar los presets', e));
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '50mb' }));
  app.use(express.raw({ type: ['image/png', 'application/octet-stream'], limit: '50mb' }));

  app.use('/api/auth', authRoutes);
  app.use('/api', requireAuth);
  app.use('/api', settingsRoutes);
  app.use('/api/connections', connectionRoutes);
  app.use('/api/presets', presetRoutes);
  app.use('/api/appearance', appearanceRoutes);
  app.use('/api/assistant', assistantRoutes);
  app.use('/api/characters', characterRoutes);
  app.use('/api/personas', personas);
  app.use('/api/groups', groups);
  app.use('/api/lorebooks', lorebooks);
  app.use('/api/chats', chatRoutes);
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Ruta no encontrada' }));

  const dist = path.join(ROOT, 'dist');
  if (fs.existsSync(dist)) {
    app.use(express.static(dist));
    app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  }

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (res.headersSent) return res.end();
    const status = err.status || (err.type === 'entity.too.large' ? 413 : 500);
    if (status >= 500) console.error(err);
    if (err.retryAfter) res.setHeader('Retry-After', String(err.retryAfter));
    res.status(status).json({ error: err.message || 'Error interno', ...(err.code ? { code: err.code } : {}) });
  });
  return app;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  const port = Number(process.env.PORT) || 3001;
  const host = process.env.HOST || '0.0.0.0';
  createApp().listen(port, host, () => {
    console.log(`\nChatpuccino escuchando en http://localhost:${port}`);
    for (const list of Object.values(os.networkInterfaces())) {
      for (const i of list || []) if (i.family === 'IPv4' && !i.internal) console.log(`  En tu red local:   http://${i.address}:${port}`);
    }
    console.log(`Datos en: ${DATA}\n`);
  });
}
