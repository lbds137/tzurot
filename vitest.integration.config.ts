import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

// Set up test environment variables before anything else
// This prevents config validation errors when importing services
process.env.PROD_DATABASE_URL ??= process.env.DATABASE_URL ?? '';

/**
 * Vitest configuration for integration tests
 *
 * Integration tests use:
 * - Real timing (no fake timers)
 * - Longer timeouts
 * - Real databases (CI) or in-process databases (local)
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

    // Only run integration tests
    include: ['tests/integration/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/*.d.ts'],

    // Integration tests need longer timeouts
    testTimeout: 30000, // 30 seconds
    hookTimeout: 30000,

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

    // Coverage configuration
    // Integration tests focus on behavior, not coverage metrics
    coverage: {
      provider: 'v8',
      reporter: ['text'],
      enabled: false, // Disable by default, enable with --coverage flag
    },
  },
});
