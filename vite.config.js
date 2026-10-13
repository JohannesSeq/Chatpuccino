import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'client',
  plugins: [react()],
  build: { outDir: '../dist', emptyOutDir: true },
  server: {
    host: true,
    port: 5173,
    // /locales (idiomas compartidos con el servidor) está fuera de la carpeta `client`.
    fs: { allow: ['..'] },
    proxy: { '/api': 'http://localhost:3001' },
  },
});
