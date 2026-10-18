import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    root: './apps/api',
    include: ['test/**/*.test.ts'],
    environment: 'node',
    // Each file boots its own in-memory Postgres (PGlite, a large WebAssembly
    // module). Optimising that module with V8's TurboFan tier needs a lot of
    // memory, and with several workers at once it can exhaust a busy machine. The
    // baseline (Liftoff) tier is plenty fast for tests, so stay on it and run
    // files one at a time.
    execArgv: ['--liftoff-only', '--no-turbofan', '--max-old-space-size=1536'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
