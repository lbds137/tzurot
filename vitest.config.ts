import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // Limit worker threads to reduce memory usage (default uses all CPU cores)
    // With heavy mocking, each worker can consume 500MB-1GB
    // 3 workers × ~700MB = ~2.1GB (safe for 5GB available RAM)
    // Note: Vitest 4 moved poolOptions to top-level options
    pool: 'threads',
    maxWorkers: 3,
    minWorkers: 1,
    // Note: mockReset/restoreMocks were attempted but broke 57+ tests across
    // api-gateway and bot-client that rely on module-level mock persistence.
    // The thread limits above are the main memory optimization.
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/*.d.ts',
      '**/tzurot-legacy/**',
      '**/*.int.test.ts', // Integration tests use vitest.int.config.ts
      'tests/e2e/**', // E2E tests use vitest.e2e.config.ts
    ],
    coverage: {
      provider: 'v8',
      // json-summary provides machine-readable coverage data for tooling
      reporter: ['text', 'json', 'json-summary', 'html', 'lcov'],
      all: true,
      include: ['src/**/*.ts'],
      exclude: [
        'node_modules/',
        'dist/',
        '**/*.d.ts',
        '**/*.config.*',
        '**/scripts/**',
        'tzurot-legacy/',
        '**/*.test.ts',
        '**/*.spec.ts',
        '**/test/**',
      ],
    },
    // Output test results in JUnit format for Codecov test-results-action
    reporters: ['default', 'junit'],
    outputFile: {
      junit: 'junit.xml',
    },
    // Use fake timers by default for consistent testing
    fakeTimers: {
      toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
    },
  },
});
