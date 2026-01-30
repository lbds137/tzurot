import { defineConfig } from 'vitest/config';
import { resolve } from 'path';
import { TEST_TIMEOUTS } from './packages/common-types/src/constants/timing.js';

// Set up test environment variables before anything else
// This prevents config validation errors when importing services
process.env.PROD_DATABASE_URL ??= process.env.DATABASE_URL ?? '';

/**
 * Vitest configuration for integration tests (*.int.test.ts)
 *
 * Integration tests use:
 * - Real timing (no fake timers)
 * - Longer timeouts
 * - PGLite in-memory database (local) or real Postgres (CI)
 * - Global setup/teardown for environment initialization
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

    // Run integration tests - co-located *.int.test.ts files
    include: ['**/*.int.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/*.d.ts'],

    // Integration tests need longer timeouts
    testTimeout: TEST_TIMEOUTS.INTEGRATION_TEST,
    hookTimeout: TEST_TIMEOUTS.INTEGRATION_HOOK,

    // Use REAL timers for integration tests (not fake timers)
    // Integration tests verify real behavior including timing
    fakeTimers: {
      toFake: [],
    },

    // Run integration tests sequentially (not in parallel)
    // This prevents database conflicts and makes debugging easier
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },

    // Coverage configuration for integration tests
    // Upload separately to Codecov with 'integration' flag
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'lcov'],
      reportsDirectory: './coverage/integration',
      enabled: false, // Enable with --coverage flag
      include: ['src/**/*.ts', 'packages/**/src/**/*.ts'],
      exclude: ['**/*.test.ts', '**/*.int.test.ts', '**/node_modules/**'],
    },
  },
});
