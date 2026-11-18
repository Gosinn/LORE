import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { loreCopy } from './vite/copyPlugin.ts';

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

// The owner's text editor (components/copyEditor) is its own chunk with a fixed name, so the
// service worker can leave it out of the precache: no other Lorer downloads it.
const EDITOR = /[\\/]components[\\/]copyEditor[\\/]/;
const isEditorChunk = (c: { facadeModuleId?: string | null; moduleIds?: readonly string[] }) =>
  EDITOR.test(c.facadeModuleId ?? '') || (!!c.moduleIds?.length && c.moduleIds.every((id) => EDITOR.test(id)));

export default defineConfig({
  root,
  // Keep Vite's dependency cache inside the repo (on D:), not in a temp folder.
  cacheDir: fileURLToPath(new URL('../../node_modules/.vite/web', import.meta.url)),
  define: {
    __LORE_BUILD__: JSON.stringify(buildId),
    __LORE_VERSION__: JSON.stringify(appVersion),
  },
  plugins: [
    // Live text: every static word becomes a lookup the owner can reword from the app (before React's
    // transform: it reads the raw TSX). Emits copy-catalog.json next to the build.
    loreCopy({ legal: ['pages/Legal'], build: buildId }),
    react(),
    buildInfo(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'LORE',
        short_name: 'LORE',
        description: 'LORE: Life Of Regular Epics. No scrolling. Only rolling. Plan experiences together and keep the stories.',
        // The dark base every world sits on (the black star sky, the default world); D34.
        theme_color: '#030409',
        background_color: '#030409',
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
        // Only the owner loads the text editor.
        globIgnores: ['**/node_modules/**/*', '**/copy-editor-*'],
      },
    }),
  ],
  server: {
    port: 5173,
    strictPort: true,
    proxy: { '/api': 'http://127.0.0.1:4000' },
  },
  preview: { port: 5173, proxy: { '/api': 'http://127.0.0.1:4000' } },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rolldownOptions: {
      output: {
        chunkFileNames: (c) => (isEditorChunk(c) ? 'assets/copy-editor-[hash].js' : 'assets/[name]-[hash].js'),
        assetFileNames: (a) =>
          a.originalFileNames.some((f) => EDITOR.test(f)) || a.names.some((n) => /^copyEditor\.css$|^CopyEditor/.test(n))
            ? 'assets/copy-editor-[hash][extname]'
            : 'assets/[name]-[hash][extname]',
      },
    },
  },
});
