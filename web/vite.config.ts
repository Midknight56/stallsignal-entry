import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'web',
  plugins: [react(), {
    name: 'studio-route',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        if (req.url && /^\/studio\/?(?:\?|$)/.test(req.url)) req.url = req.url.replace(/^\/studio\/?/, '/studio.html');
        next();
      });
    },
  }],
  build: {
    outDir: '../public/dist',
    emptyOutDir: true,
    rollupOptions: {
      input: { index: 'web/index.html', studio: 'web/studio.html' },
    },
  },
  server: { port: 8799, proxy: { '/api': 'http://127.0.0.1:8787', '/health': 'http://127.0.0.1:8787' } },
});
