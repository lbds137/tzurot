import { defineConfig } from 'vitest/config';

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
