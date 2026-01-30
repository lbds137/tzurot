import { defineConfig } from 'vitest/config';
import { resolve } from 'path';
import { TEST_TIMEOUTS } from './packages/common-types/src/constants/timing.js';

// Set up test environment variables before anything else
// This prevents config validation errors when importing services
process.env.PROD_DATABASE_URL ??= process.env.DATABASE_URL ?? '';

/**
 * Vitest configuration for E2E tests (*.e2e.test.ts)
 *
 * E2E tests:
 * - Test cross-service flows (api-gateway + ai-worker, BullMQ contracts)
 * - Live in tests/e2e/ directory
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

    // Only run E2E tests in tests/e2e/
    include: ['tests/e2e/**/*.e2e.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/*.d.ts'],

    // E2E tests need longer timeouts
    testTimeout: TEST_TIMEOUTS.INTEGRATION_TEST,
    hookTimeout: TEST_TIMEOUTS.INTEGRATION_HOOK,

    // Use REAL timers for E2E tests
    fakeTimers: {
      toFake: [],
    },

    // Run E2E tests sequentially
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },

    // E2E tests don't contribute coverage (test real external services)
    coverage: {
      enabled: false,
    },
  },
});
