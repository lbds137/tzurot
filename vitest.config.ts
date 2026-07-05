import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // Limit worker threads to reduce memory usage (default uses all CPU cores).
    // With heavy mocking each worker can consume 500MB-1GB (v8 coverage pushes
    // higher). On CI / capable machines we run 3 workers (~2.1GB).
    //
    // Under LOW_RESOURCE_MODE=1 (Steam Deck — set via .env or shell, exported by
    // .husky/pre-push) we drop to a SINGLE worker. This is the piece the other
    // throttles miss: `turbo --concurrency=1` serializes packages and
    // NODE_OPTIONS caps each process heap at 2GB, but neither reduces vitest's
    // intra-package thread count — so 3 workers × up to 2GB = ~6GB still OOM'd
    // the Deck (repeated IDE crashes). One worker keeps a package's run near the
    // 2GB heap cap. Trades speed for stability; only engages when the flag is set.
    // Note: Vitest 4 moved poolOptions to top-level options.
    pool: 'threads',
    maxWorkers: process.env.LOW_RESOURCE_MODE === '1' ? 1 : 3,
    minWorkers: 1,
    // Note: mockReset/restoreMocks were attempted but broke 57+ tests across
    // api-gateway and bot-client that rely on module-level mock persistence.
    // The thread limits above are the main memory optimization.
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/*.d.ts',
      '**/tzurot-legacy/**',
      '**/*.component.test.ts', // Component tests use vitest.component.config.ts
      '**/*.integration.test.ts', // Integration tier uses vitest.integration.config.ts
      '**/*.contract.test.ts', // Contract tier uses vitest.integration.config.ts (colocated or under tests/e2e/)
      '**/*.eval.test.ts', // Eval measurements use vitest.eval.config.ts (manual, never CI)
      'tests/e2e/**', // Belt-and-suspenders for anything else under tests/e2e/
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
