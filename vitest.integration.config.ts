import { defineConfig } from 'vitest/config';
import { resolve } from 'path';
import { TEST_TIMEOUTS } from './packages/common-types/src/constants/timing.js';

// Set up test environment variables before anything else
// This prevents config validation errors when importing services
process.env.PROD_DATABASE_URL ??= process.env.DATABASE_URL ?? '';
// Real-Redis integration tests (vision fallback loop) import service modules whose
// module-level singletons connect at load time — point them at the local container.
process.env.REDIS_URL ??= 'redis://127.0.0.1:6379';

/**
 * Vitest configuration for the real-dependency tiers run from tests/:
 * integration (*.integration.test.ts) and contract (*.contract.test.ts).
 *
 * Both share one runtime profile:
 * - Test cross-service flows / live external deps (real DB, BullMQ contracts)
 * - May be colocated with the code they lock (*.contract.test.ts anywhere) or
 *   live under tests/e2e/ (e.g. the BullMQ pair) — matched by suffix, repo-wide
 * - Use real timing (no fake timers)
 * - Coverage disabled — these tiers verify cross-service behavior / contracts,
 *   not in-service line coverage (the component + unit tiers carry coverage)
 *
 * CI note: the `component-integration-tests` job runs this config but provisions ONLY Redis
 * (no Postgres) — every current test here uses in-process PGLite or static
 * fixtures. A real-Postgres `*.integration.test.ts` would hit ECONNREFUSED and
 * needs a Postgres service added to that job (or its own job) first.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@tzurot/common-types': resolve(__dirname, './packages/common-types/src'),
      '@tzurot/api-clients': resolve(__dirname, './packages/api-clients/src'),
    },
  },
  test: {
    globals: true,
    environment: 'node',

    // Run the integration + contract tiers. Contract tests may be colocated with
    // the code they lock (e.g. the golden-fixture consumer test in ai-worker) or
    // live under tests/e2e/ (the BullMQ pair) — match both by suffix, repo-wide.
    include: ['**/*.integration.test.ts', '**/*.contract.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/*.d.ts'],

    // These tiers need longer timeouts
    testTimeout: TEST_TIMEOUTS.INTEGRATION_TEST,
    hookTimeout: TEST_TIMEOUTS.INTEGRATION_HOOK,

    // Use REAL timers (no fake timers)
    fakeTimers: {
      toFake: [],
    },

    // Run test files sequentially (no parallel forks). Real-dependency tiers must
    // not race each other on shared state. Replaces the Vitest-3
    // `poolOptions.forks.singleFork`, which Vitest 4 ignores.
    pool: 'forks',
    fileParallelism: false,

    // These tiers don't contribute coverage (test real external services)
    coverage: {
      enabled: false,
    },
  },
});
