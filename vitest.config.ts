import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

import { liveMachineFacts } from './packages/tooling/src/resource/machineFacts.js';
import { resolveVitestResourceProfile } from './packages/tooling/src/resource/vitestProfile.js';

const resourceProfile = resolveVitestResourceProfile({
  env: process.env,
  rootDir: dirname(fileURLToPath(import.meta.url)),
  ...liveMachineFacts(),
});

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // Chalk resolves its color level from supports-color at import time, so a caller
    // shell exporting FORCE_COLOR (the Claude Code shell sets FORCE_COLOR=3) leaks into
    // every chalk-formatted CLI-output assertion. Force level 0 for runs through this config
    // and the package configs that merge it (the component, integration and eval configs are
    // standalone and do not), whatever the shell exports; tooling's lines-check.test.ts's
    // delta-shape test reddens under FORCE_COLOR=3 without this.
    env: {
      FORCE_COLOR: '0',
    },
    // Worker count comes from the resource-profile resolver (contract:
    // docs/reference/tooling/resource-profiles.md), not a raw env read. The
    // resolver decides, in order: RESOURCE_PROFILE, then LOW_RESOURCE_MODE
    // (process env ahead of .env for both), then the .env layer, then the
    // auto rule (CI -> full; <= 16 GiB total memory -> low; <= 4 cpus ->
    // cloud; else full). Runs through the exec wrapper (the wrapped root
    // scripts) arrive with RESOURCE_PROFILE and VITEST_MAX_WORKERS exported,
    // which win. Every other run that loads this config — a bare vitest,
    // `pnpm --filter <pkg> test`, an unwrapped turbo task — resolves here WITH
    // the .env layer: the two profile keys are read key-scoped from the
    // directory holding this config file (the repo root), falling back per key
    // to the main checkout's .env for linked worktrees. The .env-layer cases
    // are pinned by src/resource/vitestProfile.test.ts in packages/tooling;
    // not pinned here: that the call above stays anchored on this file's own
    // directory (no test imports this config — it sits outside every package's
    // spec rootDir).
    pool: 'threads',
    maxWorkers: resourceProfile.knobs.vitestMaxWorkers,
    minWorkers: 1,
    // Note: mockReset/restoreMocks were attempted but broke 57+ tests across
    // api-gateway and bot-client that rely on module-level mock persistence.
    // The thread limits above are the main memory optimization.
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/*.d.ts',
      '**/tzurot-legacy/**',
      '**/.claude/**', // Live agent worktrees are full checkouts of this repo — never collect their copies
      '**/*.component.test.ts', // Component tests use vitest.component.config.ts
      '**/*.integration.test.ts', // Integration tier uses vitest.integration.config.ts
      '**/*.contract.test.ts', // Contract tier uses vitest.integration.config.ts (colocated or under tests/e2e/)
      '**/*.e2e.test.ts', // Local transport tests use vitest.e2e.config.ts (under tests/e2e/machloket/)
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
