// Web-side tests for live text: the build transform (apps/web/vite/test) and the runtime, sync and
// editor helpers (apps/web/src/**/*.test.ts). Run with `npm run test:copy` (also part of `npm test`).
// Light on memory: no database, no DOM, one file at a time.
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { loreCopy } from './copyPlugin.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  root: fileURLToPath(new URL('..', import.meta.url)),
  // The render fixtures go through the real plugin and the real runtime (lib/copy/runtime.ts);
  // `?nocopy` imports skip the plugin. Nothing under apps/web/src is transformed here.
  plugins: [
    loreCopy({
      srcRoot: `${here}test/fixtures`,
      runtime: `${here}../src/lib/copy/runtime.ts`,
      vocabulary: false,
      server: false,
      catalog: false,
    }),
  ],
  oxc: { jsx: { runtime: 'automatic', importSource: 'react' } },
  cacheDir: fileURLToPath(new URL('../../../node_modules/.vite/copy-tests', import.meta.url)),
  test: {
    include: ['vite/test/**/*.test.ts', 'src/**/*.test.ts'],
    environment: 'node',
    fileParallelism: false,
    execArgv: ['--max-old-space-size=1024'],
    testTimeout: 30_000,
  },
});
