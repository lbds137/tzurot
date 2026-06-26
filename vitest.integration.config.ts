import { defineConfig } from 'vitest/config';
import { resolve } from 'path';
import { TEST_TIMEOUTS } from './packages/common-types/src/constants/timing.js';

// Set up test environment variables before anything else
// This prevents config validation errors when importing services
process.env.PROD_DATABASE_URL ??= process.env.DATABASE_URL ?? '';

/**
 * Vitest configuration for the real-dependency tiers run from tests/:
 * integration (*.integration.test.ts) and contract (*.contract.test.ts).
 *
 * Both share one runtime profile:
 * - Test cross-service flows / live external deps (real DB, BullMQ contracts)
 * - Live under tests/e2e/ (contract tests under tests/e2e/contracts/)
 * - Use real timing (no fake timers)
 * - Coverage disabled (tests real external services)
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

    // Run the integration + contract tiers under tests/
    include: ['tests/e2e/**/*.integration.test.ts', 'tests/e2e/**/*.contract.test.ts'],
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
