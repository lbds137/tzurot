/**
 * Stryker mutation-testing config — config-resolver pilot.
 *
 * Grades test EFFECTIVENESS, not coverage: each mutant (flipped conditional,
 * deleted statement, swapped operator) must be killed by a failing test, or it
 * "survives" and marks an assertion gap. Line coverage marks code as covered
 * when it merely RAN; a surviving mutant proves no test noticed the behavior
 * change — the deterministic answer to "are these tests a real net."
 *
 * Pilot scope: report-only (no `break` threshold). A CI ratchet gate is a
 * follow-up once score + runtime characteristics are known — a threshold gate
 * makes this an audit-class tool per docs/reference/audit-enforcement.md
 * (WHY.md, canary, JSONL summary, baseline drift contract).
 *
 * Run from this package: `pnpm test:mutation`. The vitest runner resolves the
 * repo-root vitest.config.ts by cwd, same as `pnpm test` does — including its
 * LOW_RESOURCE_MODE worker throttle.
 */

/** @type {import('@stryker-mutator/core').PartialStrykerOptions} */
export default {
  testRunner: 'vitest',
  // pnpm's strict node_modules layout breaks Stryker's default
  // `@stryker-mutator/*` plugin glob (core can't see sibling plugins from its
  // own .pnpm nesting) — name the runner explicitly so it resolves as a bare
  // specifier from this package.
  plugins: ['@stryker-mutator/vitest-runner'],
  mutate: [
    'src/**/*.ts',
    '!src/**/*.test.ts',
    // Pure re-export barrel — no behavior to mutate.
    '!src/index.ts',
  ],
  reporters: ['clear-text', 'progress', 'html', 'json'],
  // Root /reports/ is gitignored; keep all analysis output in one place.
  htmlReporter: { fileName: '../../reports/mutation/config-resolver/index.html' },
  jsonReporter: { fileName: '../../reports/mutation/config-resolver/mutation.json' },
  // Advisory coloring for the clear-text/html reports only — no `break`
  // threshold in the pilot, so a low score reports rather than fails.
  thresholds: { high: 80, low: 60 },
  // Two concurrent test runners: mutation runs are memory-multiplicative
  // (each runner is a full vitest process) and the Steam Deck dev machine
  // OOMs under default all-cores concurrency.
  concurrency: 2,
  tempDirName: '.stryker-tmp',
};
