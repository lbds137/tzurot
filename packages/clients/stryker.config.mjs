/**
 * Stryker mutation-testing config — clients (suite-wide rollout of the
 * config-resolver pilot; see that package for the original rationale).
 *
 * Grades test EFFECTIVENESS, not coverage: each mutant (flipped conditional,
 * deleted statement, swapped operator) must be killed by a failing test, or it
 * "survives" and marks an assertion gap. Line coverage marks code as covered
 * when it merely RAN; a surviving mutant proves no test noticed the behavior
 * change — the deterministic answer to "are these tests a real net."
 *
 * The score is gated in CI by `pnpm ops mutation:check` (an audit-class tool
 * per docs/reference/audit-enforcement.md): CI runs this config to produce
 * the JSON report, then the checker compares the score against the baseline
 * in .github/baselines/mutation-baseline.json. Stryker itself stays
 * report-only (no `break` threshold) — the ratchet semantics, grace margin,
 * and config-drift detection live in the checker.
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
  // specifier from this package. The local ignorer plugin skips logger-call
  // statements (see its header for the rationale + measured noise numbers).
  plugins: ['@stryker-mutator/vitest-runner', './stryker-logger-ignorer.mjs'],
  ignorers: ['logger-calls'],
  mutate: [
    'src/**/*.ts',
    '!src/**/*.test.ts',
    // Pure re-export barrel — no behavior to mutate.
    '!src/index.ts',
    // Machine-generated clients: their correctness is the GENERATOR's
    // concern (and the contract tier covers the wire behavior). Mutating
    // output nobody hand-maintains only measures noise (727 no-coverage
    // mutants on the first report-only run).
    '!src/clients/_generated/**',
  ],
  reporters: ['clear-text', 'progress', 'html', 'json'],
  // Root /reports/ is gitignored; keep all analysis output in one place.
  htmlReporter: { fileName: '../../reports/mutation/clients/index.html' },
  jsonReporter: { fileName: '../../reports/mutation/clients/mutation.json' },
  // Advisory coloring for the clear-text/html reports only — no `break`
  // threshold in the pilot, so a low score reports rather than fails.
  thresholds: { high: 80, low: 60 },
  // Two concurrent test runners by default: mutation runs are memory-
  // multiplicative (each runner is a full vitest process) and the Steam Deck
  // dev machine OOMs under default all-cores concurrency. CI runners have
  // more headroom — the workflow raises this via STRYKER_CONCURRENCY.
  concurrency: process.env.STRYKER_CONCURRENCY !== undefined ? Number(process.env.STRYKER_CONCURRENCY) : 2,
  tempDirName: '.stryker-tmp',
};
