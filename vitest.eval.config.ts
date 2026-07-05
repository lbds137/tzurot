import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

/**
 * Vitest configuration for evaluation runners (*.eval.test.ts)
 *
 * Evals are MEASUREMENTS, not CI gates (memory-architecture §3.9): they run
 * the real retrieval stack (real local embeddings + PGLite/pgvector) against
 * a golden corpus and report recall@K. They are invoked manually
 * (`pnpm eval:memory`) before/after each memory-architecture phase — never in
 * CI, never in `pnpm test` — and their numbers drive the phase gates and the
 * design's re-open triggers.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@tzurot/common-types': resolve(__dirname, './packages/common-types/src'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['**/*.eval.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/*.d.ts'],
    // Deliberately NOT the shared TEST_TIMEOUTS constants: real embedding-model
    // load (cold cache) + per-golden embedding calls need more headroom than the
    // shared tiers provide.
    testTimeout: 120_000,
    hookTimeout: 180_000,
  },
});
