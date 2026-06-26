import { defineConfig } from 'vitest/config';
import { resolve } from 'path';
import { TEST_TIMEOUTS } from './packages/common-types/src/constants/timing.js';

// Set up test environment variables before anything else
// This prevents config validation errors when importing services
process.env.PROD_DATABASE_URL ??= process.env.DATABASE_URL ?? '';
// 127.0.0.1, not `localhost`: on hosts where `localhost` resolves to ::1 (IPv6)
// first, an IPv4-only Redis bind refuses the connection (ECONNREFUSED ::1). CI
// sets REDIS_URL explicitly, so this default only affects local runs.
process.env.REDIS_URL ??= 'redis://127.0.0.1:6379';

/**
 * Vitest configuration for component tests (*.component.test.ts)
 *
 * Component tests (one whole service in isolation over a real datastore) use:
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

    // Run component tests - co-located *.component.test.ts files
    include: ['**/*.component.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/*.d.ts'],

    // Component tests need longer timeouts
    testTimeout: TEST_TIMEOUTS.INTEGRATION_TEST,
    hookTimeout: TEST_TIMEOUTS.INTEGRATION_HOOK,

    // Use REAL timers for component tests (not fake timers)
    // Component tests verify real behavior including timing
    fakeTimers: {
      toFake: [],
    },

    // Run test files sequentially (no parallel forks). REQUIRED for correctness:
    // the Redis-backed component tests share one real Redis test DB, so concurrent
    // files would let one file's flushdb wipe another's data mid-test. Also lowers
    // peak memory (parallel forks OOM constrained machines). Replaces the Vitest-3
    // `poolOptions.forks.singleFork`, which Vitest 4 ignores.
    pool: 'forks',
    fileParallelism: false,

    // Coverage configuration for component tests
    // Upload separately to Codecov with the 'component' flag
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'lcov'],
      reportsDirectory: './coverage/component',
      enabled: false, // Enable with --coverage flag
      // All three roots must be listed: this config runs from the repo root,
      // so a bare 'src/**' matches nothing — without the services glob, no
      // services/*/src file ever appeared in the component coverage upload
      // (the 'integration' codecov flag claimed services/ but received no data).
      include: ['src/**/*.ts', 'packages/**/src/**/*.ts', 'services/**/src/**/*.ts'],
      exclude: ['**/*.test.ts', '**/*.component.test.ts', '**/node_modules/**'],
    },
  },
});
