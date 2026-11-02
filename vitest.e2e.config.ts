import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

/**
 * Vitest configuration for the Machloket E2E transport tier
 * (the .e2e.test.ts files under tests/e2e/machloket).
 *
 * This tier is local only because the server harness lives in a private
 * checkout outside this repository. Set MACHLOKET_SERVER_DIR to a built
 * machloket-server checkout before running `pnpm test:e2e`.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@tzurot/common-types': resolve(import.meta.dirname, './packages/common-types/src'),
    },
  },
  test: {
    globals: true,
    environment: 'node',

    include: ['tests/e2e/machloket/**/*.e2e.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/*.d.ts', '**/.claude/**'],

    testTimeout: 60_000,
    hookTimeout: 300_000,

    // Use REAL timers (no fake timers)
    fakeTimers: {
      toFake: [],
    },

    pool: 'forks',
    fileParallelism: false,

    coverage: {
      enabled: false,
    },
  },
});
