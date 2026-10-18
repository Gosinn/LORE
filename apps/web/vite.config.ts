import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  root,
  // Keep Vite's dependency cache inside the repo (on D:), not in a temp folder.
  cacheDir: fileURLToPath(new URL('../../node_modules/.vite/web', import.meta.url)),
  plugins: [
    react(),
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
