import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const root = fileURLToPath(new URL('.', import.meta.url));
const appVersion: string = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version;

// Every production build gets an id. The server hands the built web app to the
// Android app as a live update, and the id is how a phone knows it's out of date.
const buildId = `${new Date().toISOString().replace(/\D/g, '').slice(0, 12)}-${randomBytes(3).toString('hex')}`;

function buildInfo(): Plugin {
  return {
    name: 'lore-build-info',
    apply: 'build',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'build.json',
        source: JSON.stringify({ build: buildId, version: appVersion }),
      });
    },
  };
}

export default defineConfig({
  root,
  // Keep Vite's dependency cache inside the repo (on D:), not in a temp folder.
  cacheDir: fileURLToPath(new URL('../../node_modules/.vite/web', import.meta.url)),
  define: {
    __LORE_BUILD__: JSON.stringify(buildId),
    __LORE_VERSION__: JSON.stringify(appVersion),
  },
  plugins: [
    react(),
    buildInfo(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'LORE',
        short_name: 'LORE',
        description: 'LORE: Life Of Regular Epics. No scrolling. Only rolling. Plan experiences together and keep the stories.',
        theme_color: '#d9481f',
        background_color: '#f4eee3',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // The app shell works offline; API data always comes from the server.
        navigateFallbackDenylist: [/^\/api\//],
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
      },
    }),
  ],
  server: {
    port: 5173,
    strictPort: true,
    proxy: { '/api': 'http://127.0.0.1:4000' },
  },
  preview: { port: 5173, proxy: { '/api': 'http://127.0.0.1:4000' } },
  build: { outDir: 'dist', emptyOutDir: true },
});
